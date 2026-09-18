"""Feature-based grant fit scoring with per-institution distribution calibration.

Replaces the previous `relevance_ranker.semantic_fit` blend, which folded a raw
cosine similarity straight into a weighted average. Because embedding cosines
between an org profile and a grant description realistically live in ~0.25-0.55
(they never approach 1.0), that blend compressed every opportunity into the
20s-50s — below the 75 "high" tier threshold — so the tiers were dead and the
sort ran on a ~20-point band of noise.

Three changes fix that:

  1. **Calibration.** Raw blended scores are mapped through the institution's own
     score distribution (quantile breakpoints computed offline) to a percentile.
     The displayed 0-100 becomes a rank within *this org's* pool, so the badge
     and the tiers mean something again. A confidence damp (see `_quality_damp`)
     keeps a uniformly-poor pool from producing 95s.

  2. **Multi-prototype similarity.** Instead of averaging every positive into one
     centroid — which for a multi-interest lab yields a midpoint representing
     neither interest — similarity is `max` over a small set of prototypes
     derived from the institution's archive and pursued history.

  3. **Practical signals.** Funder affinity, deadline feasibility and award fit
     now actually reach the score. They were declared in `FitScoringConfig` but
     only ever read by the `deep_reviewer` LLM prompt.

Everything here is pure/sync and numpy-only so it is safe to call from Celery
workers and the request path alike. Vector-heavy inputs arrive pre-unpacked via
`InstitutionRankingContext`, built once per institution rather than per row.
"""
from __future__ import annotations

import base64
import math
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any, Iterable, Sequence

import numpy as np

# Number of quantile breakpoints stored per institution (0th..100th in 5% steps).
QUANTILE_STEPS = 21

# Max prototypes retained per institution. Keeps the per-opportunity cost at a
# handful of dot products and the stored payload well under ~50KB.
MAX_POSITIVE_PROTOTYPES = 8
MAX_NEGATIVE_PROTOTYPES = 4

# Absolute-quality anchor for the confidence damp. Cosines below this are weak
# matches regardless of how they rank within the pool.
_QUALITY_ANCHOR = 0.34
_QUALITY_TEMP = 0.09

# Score assigned to opportunities hitting an exclusion keyword.
EXCLUDED_SCORE = 5


# ── Compact vector storage ───────────────────────────────────────────────────
# Prototypes are read on every single-opportunity rescore, so they are stored as
# base64'd float32 rather than JSON float lists: ~49KB instead of ~245KB for 8
# vectors, and decode is a single frombuffer.

def pack_vectors(vectors: Sequence[Sequence[float]]) -> str | None:
    """Pack a list of equal-length vectors into a base64 float32 blob.

    Accepts a list of lists or a 2-D array — `len` rather than truthiness, since
    a numpy array raises on `not arr`.
    """
    if vectors is None or len(vectors) == 0:
        return None
    arr = np.asarray(vectors, dtype=np.float32)
    if arr.ndim != 2 or arr.size == 0:
        return None
    return base64.b64encode(arr.tobytes()).decode("ascii")


def unpack_vectors(blob: str | None, dim: int = 1536) -> np.ndarray:
    """Inverse of `pack_vectors`. Returns a (0, dim) array when empty/invalid."""
    if not blob:
        return np.zeros((0, dim), dtype=np.float32)
    try:
        raw = np.frombuffer(base64.b64decode(blob), dtype=np.float32)
        if raw.size == 0 or raw.size % dim != 0:
            return np.zeros((0, dim), dtype=np.float32)
        return raw.reshape(-1, dim)
    except Exception:
        return np.zeros((0, dim), dtype=np.float32)


def l2_normalize(arr: np.ndarray) -> np.ndarray:
    """Row-wise L2 normalization; zero rows are left as zeros."""
    if arr.size == 0:
        return arr
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms < 1e-10] = 1.0
    return arr / norms


# ── Context + features ───────────────────────────────────────────────────────

@dataclass
class InstitutionRankingContext:
    """Everything the scorer needs about one institution, built once per batch.

    `positive` / `negative` are L2-normalized prototype matrices; similarity is a
    single matmul per opportunity. `labels` parallels `positive` and is used to
    cite concrete prior work in the rationale ("resembles <archive title>").
    """

    positive: np.ndarray = field(default_factory=lambda: np.zeros((0, 1536), dtype=np.float32))
    negative: np.ndarray = field(default_factory=lambda: np.zeros((0, 1536), dtype=np.float32))
    labels: list[str] = field(default_factory=list)
    won_mask: np.ndarray = field(default_factory=lambda: np.zeros((0,), dtype=bool))
    profile_embedding: np.ndarray | None = None
    funder_affinity: dict[str, float] = field(default_factory=dict)
    award_median: float | None = None
    quantiles: list[float] = field(default_factory=list)

    @property
    def has_prototypes(self) -> bool:
        return self.positive.shape[0] > 0

    @property
    def has_calibration(self) -> bool:
        return len(self.quantiles) >= 3


@dataclass
class RankFeatures:
    """Per-(opportunity, institution) signals. Persisted for explainability."""

    proto_sim: float = 0.0          # max cosine to any positive prototype
    won_sim: float = 0.0            # max cosine to an *awarded* prototype
    profile_sim: float = 0.0        # cosine to the declared-profile embedding
    neg_sim: float = 0.0            # max cosine to a negative prototype
    keyword_coverage: float = 0.0   # saturating share of profile keywords matched
    funder_affinity: float = 0.0    # prior success with this funder
    # Neutral defaults: 0.0 on these two means "scored and found bad" (a closed
    # call), not "never computed", so the rationale can trust them.
    deadline_feasibility: float = 0.6
    award_fit: float = 0.6
    best_prototype: str | None = None
    raw: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in asdict(self).items()}


# ── Signal helpers ───────────────────────────────────────────────────────────

def normalize_funder(name: str | None) -> str:
    """Loose funder key so 'The Wellcome Trust' and 'Wellcome Trust' agree."""
    if not name:
        return ""
    cleaned = "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in name)
    tokens = [t for t in cleaned.split() if t not in {"the", "of", "for", "and", "foundation", "fund"}]
    return " ".join(tokens).strip()


def deadline_feasibility(deadline: date | None, today: date | None = None) -> float:
    """Inverted-U on days-to-deadline: too soon is unpreparable, too far is not
    yet actionable. Missing deadlines get a neutral score rather than a penalty
    (rolling calls are common and shouldn't be buried)."""
    if deadline is None:
        return 0.6
    today = today or date.today()
    days = (deadline - today).days
    if days < 0:
        return 0.0
    if days < 10:
        return 0.2
    if days < 21:
        return 0.55
    if days <= 120:
        return 1.0
    if days <= 240:
        return 0.85
    return 0.7


def award_fit(award_min: float | None, award_max: float | None, median: float | None) -> float:
    """How close this award size is to what the institution actually wins.

    Scored on log scale — the difference between 50k and 500k matters, the
    difference between 500k and 520k does not. Neutral when either side is
    unknown, so orgs without award history are never penalized."""
    if median is None or median <= 0:
        return 0.6
    candidate = None
    if award_max and award_min:
        candidate = (float(award_min) + float(award_max)) / 2.0
    elif award_max:
        candidate = float(award_max)
    elif award_min:
        candidate = float(award_min)
    if not candidate or candidate <= 0:
        return 0.6
    ratio = abs(math.log10(candidate / median))
    # 0 decades off -> 1.0; 1 decade off -> ~0.5; 2 decades -> ~0.2
    return float(max(0.1, min(1.0, 1.0 / (1.0 + ratio * ratio))))


def _quality_damp(sem: float) -> float:
    """Absolute-quality factor in [0.55, 1.0].

    Percentile calibration alone guarantees that ~10% of any pool scores >=90,
    even a pool with no good matches in it. Damping the percentile by an absolute
    sigmoid on semantic similarity keeps the top of a genuinely weak pool from
    claiming to be an excellent fit, while leaving a strong pool untouched.
    """
    z = (sem - _QUALITY_ANCHOR) / _QUALITY_TEMP
    sigmoid = 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, z))))
    return 0.55 + 0.45 * sigmoid


# ── Feature extraction ───────────────────────────────────────────────────────

def compute_features(
    embedding: Sequence[float] | None,
    ctx: InstitutionRankingContext,
    *,
    keyword_coverage: float,
    funder: str | None,
    deadline: date | None,
    award_min: float | None = None,
    award_max: float | None = None,
    today: date | None = None,
) -> RankFeatures:
    """Extract every ranking signal for one opportunity. O(prototypes) dot
    products — a few dozen microseconds, not an LLM call."""
    feats = RankFeatures(keyword_coverage=max(0.0, min(1.0, keyword_coverage)))

    if embedding is not None:
        vec = np.asarray(embedding, dtype=np.float32)
        norm = float(np.linalg.norm(vec))
        if norm > 1e-10:
            vec = vec / norm
            if ctx.positive.shape[0]:
                sims = ctx.positive @ vec
                best = int(np.argmax(sims))
                feats.proto_sim = float(max(0.0, sims[best]))
                if best < len(ctx.labels):
                    feats.best_prototype = ctx.labels[best]
                if ctx.won_mask.shape[0] == sims.shape[0] and ctx.won_mask.any():
                    feats.won_sim = float(max(0.0, sims[ctx.won_mask].max()))
            if ctx.negative.shape[0]:
                feats.neg_sim = float(max(0.0, (ctx.negative @ vec).max()))
            if ctx.profile_embedding is not None and ctx.profile_embedding.size:
                feats.profile_sim = float(max(0.0, float(ctx.profile_embedding @ vec)))

    feats.funder_affinity = ctx.funder_affinity.get(normalize_funder(funder), 0.0)
    feats.deadline_feasibility = deadline_feasibility(deadline, today)
    feats.award_fit = award_fit(award_min, award_max, ctx.award_median)
    # Populate `raw` here, not in `calibrated_score`. The calibration pass builds
    # the institution's score distribution from these values *before* any score
    # is calibrated, so deferring it leaves every quantile at 0.0 — which maps
    # every opportunity to the 100th percentile and silently collapses the feed.
    feats.raw = raw_score(feats)
    return feats


def raw_score(
    feats: RankFeatures,
    *,
    sem_weight: float = 0.55,
    kw_weight: float = 0.20,
    ctx_weight: float = 0.25,
    neg_weight: float = 0.25,
    won_weight: float = 0.25,
) -> float:
    """Blend features into an uncalibrated 0..1 score.

    Weights are renormalized over whichever signals are actually present, so an
    org with no embedding, no archive, or no funder history degrades smoothly
    instead of silently scoring everything low.
    """
    has_sem = feats.proto_sim > 0.0 or feats.profile_sim > 0.0

    # `max` rather than a blend: strong archive evidence shouldn't be dragged
    # down by a weak keyword-bag profile vector, and a cold-start org with no
    # archive still ranks off its declared profile.
    sem = max(feats.proto_sim, feats.profile_sim)
    if feats.won_sim > 0.0:
        sem = (1.0 - won_weight) * sem + won_weight * feats.won_sim

    ctx_parts = [
        (0.40, feats.funder_affinity),
        (0.35, feats.deadline_feasibility),
        (0.25, feats.award_fit),
    ]
    ctx_val = sum(w * v for w, v in ctx_parts)

    total_w = kw_weight + ctx_weight + (sem_weight if has_sem else 0.0)
    if total_w <= 0:
        return 0.0
    blended = ((sem_weight * sem if has_sem else 0.0) + kw_weight * feats.keyword_coverage + ctx_weight * ctx_val) / total_w
    blended -= neg_weight * feats.neg_sim
    return float(max(0.0, min(1.0, blended)))


# ── Calibration ──────────────────────────────────────────────────────────────

def build_quantiles(raw_scores: Iterable[float], steps: int = QUANTILE_STEPS) -> list[float]:
    """Quantile breakpoints of an institution's raw-score distribution."""
    arr = np.asarray([s for s in raw_scores if s is not None], dtype=np.float64)
    if arr.size < steps:
        return []
    qs = np.linspace(0.0, 100.0, steps)
    return [float(v) for v in np.percentile(arr, qs)]


def percentile_of(raw: float, quantiles: Sequence[float]) -> float:
    """Where `raw` falls in the stored distribution, 0..100, linearly
    interpolated between breakpoints. Falls back to a fixed stretch when the
    institution has too few scored opportunities to have a distribution yet."""
    if len(quantiles) < 3:
        # Cold start: stretch the realistic 0.15-0.65 raw band across 0-100 so
        # early users still see differentiated scores.
        return float(max(0.0, min(100.0, (raw - 0.15) / 0.50 * 100.0)))
    arr = np.asarray(quantiles, dtype=np.float64)
    step = 100.0 / (len(arr) - 1)
    if raw <= arr[0]:
        return 0.0
    if raw >= arr[-1]:
        return 100.0
    idx = int(np.searchsorted(arr, raw, side="right")) - 1
    idx = max(0, min(len(arr) - 2, idx))
    lo, hi = arr[idx], arr[idx + 1]
    frac = 0.0 if hi <= lo else (raw - lo) / (hi - lo)
    return float(max(0.0, min(100.0, (idx + frac) * step)))


def calibrated_score(feats: RankFeatures, ctx: InstitutionRankingContext, **weights) -> float:
    """Final 0-100 fit score: percentile within the org's own distribution,
    damped by the absolute quality of the semantic match.

    Reads `feats.raw`, which `compute_features` populates. Recomputes it only if
    custom weights are supplied or the caller built the features by hand.
    """
    raw = raw_score(feats, **weights) if (weights or not feats.raw) else feats.raw
    feats.raw = raw
    pct = percentile_of(raw, ctx.quantiles)
    sem = max(feats.proto_sim, feats.profile_sim, feats.won_sim)
    return float(max(0.0, min(100.0, pct * _quality_damp(sem))))


# ── Rationale ────────────────────────────────────────────────────────────────

def build_rationale(feats: RankFeatures, matched_keywords: Sequence[str], funder: str | None) -> str:
    """Human-readable justification citing the strongest concrete evidence.

    Evidence is ordered by how convincing it is: prior *awarded* work first,
    then resemblance to anything in the archive, then funder track record, then
    keywords. Caveats (tight deadline, resemblance to passed-over work) are
    appended separately — a caveat alone is not evidence of fit, so an item with
    no positive signal still reads as a weak match rather than as "deadline has
    passed", which says nothing about whether the grant suits the team.
    """
    evidence: list[str] = []
    caveats: list[str] = []

    if feats.won_sim >= 0.55 and feats.best_prototype:
        evidence.append(f'closely resembles "{feats.best_prototype}", which this team was awarded')
    elif feats.proto_sim >= 0.50 and feats.best_prototype:
        evidence.append(f'similar to prior work "{feats.best_prototype}"')
    elif feats.profile_sim >= 0.45:
        evidence.append("strong thematic match to the org profile")

    if feats.funder_affinity >= 0.5 and funder:
        evidence.append(f"prior funding history with {funder}")

    if matched_keywords:
        kws = ", ".join(f"'{k}'" for k in list(matched_keywords)[:4])
        evidence.append(f"matched {kws}")

    if feats.deadline_feasibility == 0.0:
        caveats.append("deadline has passed")
    elif feats.deadline_feasibility <= 0.25:
        caveats.append("deadline is tight")

    if feats.neg_sim >= 0.55:
        caveats.append("resembles opportunities previously passed on")

    lead = (
        "Weak match — no strong thematic, funder, or keyword signal"
        if not evidence
        else "; ".join(evidence)
    )
    # Sentence-case only the first character: `.capitalize()` would lowercase the
    # rest, mangling the grant titles quoted above.
    lead = lead[:1].upper() + lead[1:]
    if caveats:
        return f"{lead} ({'; '.join(caveats)})."
    return f"{lead}."


# ── Context construction ─────────────────────────────────────────────────────

def context_from_profile(profile_row: Any) -> InstitutionRankingContext:
    """Build a ranking context from an `InstitutionTasteProfile` ORM row.

    Unpacks prototypes once per institution rather than per opportunity — the
    single most important thing to get right for throughput, since a rescore
    touches thousands of rows per org. Missing/legacy profiles degrade to
    whatever signal is present (declared-profile embedding, then keywords only).
    """
    ctx = InstitutionRankingContext()
    if profile_row is None:
        return ctx

    protos = getattr(profile_row, "prototypes", None) or {}
    dim = int(protos.get("dim") or 1536)
    ctx.positive = l2_normalize(unpack_vectors(protos.get("positive"), dim))
    ctx.negative = l2_normalize(unpack_vectors(protos.get("negative"), dim))
    ctx.labels = list(protos.get("labels") or [])
    won = list(protos.get("won") or [])
    ctx.won_mask = np.asarray(
        (won + [False] * ctx.positive.shape[0])[: ctx.positive.shape[0]], dtype=bool
    )

    # Fall back to the legacy single positive centroid when no prototypes exist
    # yet (pre-migration profiles, or an org whose task hasn't run).
    if ctx.positive.shape[0] == 0 and getattr(profile_row, "positive_embedding", None) is not None:
        ctx.positive = l2_normalize(np.asarray([profile_row.positive_embedding], dtype=np.float32))
        ctx.labels = []
        ctx.won_mask = np.zeros((1,), dtype=bool)
    if ctx.negative.shape[0] == 0 and getattr(profile_row, "negative_embedding", None) is not None:
        ctx.negative = l2_normalize(np.asarray([profile_row.negative_embedding], dtype=np.float32))

    pe = getattr(profile_row, "profile_embedding", None)
    if pe is not None:
        vec = np.asarray(pe, dtype=np.float32)
        norm = float(np.linalg.norm(vec))
        ctx.profile_embedding = vec / norm if norm > 1e-10 else None

    meta = getattr(profile_row, "ranking_meta", None) or {}
    ctx.funder_affinity = dict(meta.get("funder_affinity") or {})
    ctx.award_median = meta.get("award_median")
    ctx.quantiles = list(meta.get("quantiles") or [])
    return ctx
