"""
Bibliography Generator — collects all citations gathered during draft generation,
deduplicates, formats as APA, and returns a References section HTML block.

Does not require an LLM for basic APA formatting. Falls back to an LLM cleanup pass
when citation strings are inconsistently formatted.
"""
import re
from app.ai.client import chat_complete
import json


def _normalise_citation(raw: str) -> str:
    """Strip leading dashes, extra whitespace, markdown artefacts."""
    return re.sub(r"^[-•*\s]+", "", raw).strip()


def _citation_key(raw: str) -> str:
    """Create a deduplication key: lowercase first 60 chars stripped of punctuation."""
    stripped = re.sub(r"[^\w\s]", "", raw.lower())
    return " ".join(stripped.split())[:60]


def _is_valid(citation: str) -> bool:
    return bool(citation) and len(citation) > 15


def _collect_from_results(draft_results: list[dict]) -> list[str]:
    """
    Pull citation strings from section draft outputs.

    Each result may have:
      - "sources_used": list of strings
      - "citations_used": list of strings
      - "suggested_citations": list of strings
    """
    seen = set()
    citations = []
    for result in draft_results:
        for field in ("citations_used", "sources_used", "suggested_citations"):
            for raw in result.get(field, []):
                if isinstance(raw, dict):
                    raw = raw.get("formatted_citation") or raw.get("title") or ""
                text = _normalise_citation(str(raw))
                if _is_valid(text):
                    key = _citation_key(text)
                    if key not in seen:
                        seen.add(key)
                        citations.append(text)
    return citations


def _sort_apa(citations: list[str]) -> list[str]:
    """
    Sort alphabetically by first author surname (best-effort from raw citation strings).
    """
    def _key(c: str) -> str:
        m = re.match(r"([A-Za-z]+)", c)
        return m.group(1).lower() if m else c.lower()

    return sorted(citations, key=_key)


def _render_references_html(citations: list[str]) -> str:
    if not citations:
        return ""
    items = "\n".join(f"<p>{i + 1}. {c}</p>" for i, c in enumerate(citations))
    return f"<h2>References</h2>\n{items}"


async def generate_bibliography(
    draft_results: list[dict],
    extra_citations: list[str] | None = None,
    use_llm_cleanup: bool = False,
) -> dict:
    """
    Generate an APA bibliography from all citation strings accumulated during drafting.

    Parameters
    ----------
    draft_results  : list of section draft result dicts (from section_drafter/intro_architect)
    extra_citations: additional raw citation strings to include
    use_llm_cleanup: if True, run an LLM pass to standardise inconsistent citation formats

    Returns
    -------
    {
        "references_html": "<h2>References</h2>...",
        "citation_count": N,
        "citations": ["APA string", ...]
    }
    """
    collected = _collect_from_results(draft_results)
    if extra_citations:
        for raw in extra_citations:
            text = _normalise_citation(str(raw))
            if _is_valid(text):
                key = _citation_key(text)
                if key not in {_citation_key(c) for c in collected}:
                    collected.append(text)

    if not collected:
        return {"references_html": "", "citation_count": 0, "citations": []}

    if use_llm_cleanup and len(collected) > 0:
        collected = await _llm_format_citations(collected)

    sorted_cits = _sort_apa(collected)
    references_html = _render_references_html(sorted_cits)

    return {
        "references_html": references_html,
        "citation_count": len(sorted_cits),
        "citations": sorted_cits,
    }


async def _llm_format_citations(citations: list[str]) -> list[str]:
    """
    Use an LLM to standardise citation formats to APA 7th edition.
    Falls back to the original list on error.
    """
    prompt = f"""You are a citations librarian. Convert the following citation strings to proper APA 7th edition format.
Preserve all available information (authors, year, title, journal, DOI, URL).
If a citation lacks enough information to format properly, keep it as-is.
Return a JSON array of formatted citation strings, one per input.

Input citations:
{json.dumps(citations[:40], indent=2)}

Return JSON: {{"formatted": ["...", "..."]}}"""

    try:
        response = await chat_complete(
            messages=[{"role": "user", "content": prompt}],
            agent_name="citation_agent",
            json_mode=True,
        )
        result = json.loads(response)
        formatted = result.get("formatted", [])
        if isinstance(formatted, list) and len(formatted) == len(citations):
            return [_normalise_citation(str(c)) for c in formatted if c]
    except Exception:
        pass
    return citations
