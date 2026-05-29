"""
Concept Extractor — lightweight named-concept extraction from skeleton/idea text.

Identifies proper nouns, acronyms, and multi-word named entities (programs, methodologies,
geographies, technologies) that the team explicitly references. These are used to
proactively pre-fetch RAG archive content so section drafters have specific context
(e.g. if the skeleton mentions "MOOVE", the drafters get all archive content about MOOVE).

No LLM needed — uses regex heuristics optimised for scientific/health grant text.
"""
import re

# Patterns that strongly signal named concepts:
# - ALL-CAPS acronyms (2+ chars): MOOVE, WASH, WHO, OneHealth, AIR, LiGHT
# - Title-case multi-word phrases: Community Health Worker, Digital Health
# - Camel-case program names: OneHealth, DataWise
_ACRONYM_RE = re.compile(r"\b[A-Z]{2,}\b")
_TITLE_MULTI_RE = re.compile(r"\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\b")
_CAMEL_RE = re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z]+\b")

# Words to exclude — generic proposal language, not named concepts
_STOPWORDS = {
    "This", "The", "Our", "We", "In", "To", "For", "Of", "And", "With",
    "That", "Are", "Has", "Have", "Will", "By", "At", "An", "As",
    "From", "On", "Or", "Be", "A", "It", "Is", "Was", "Were", "All",
    # Common section heading words
    "Introduction", "Background", "Methods", "Results", "Discussion",
    "Abstract", "Summary", "Conclusion", "Objectives", "Approach",
    "Evaluation", "Timeline", "Budget", "References", "Appendix",
    # Grant boilerplate
    "Grant", "Project", "Study", "Program", "Proposal", "Research",
    "Activity", "Activities", "Deliverable", "Deliverables", "Report",
    # Generic descriptors
    "Global", "Local", "National", "International", "Key", "New",
    "High", "Low", "Large", "Small", "Primary", "Secondary",
    # Common health words (too generic to be useful concept queries)
    "Health", "Disease", "Patient", "Clinical", "Medical", "Public",
    "Community", "Population", "Impact", "Evidence", "Data", "Model",
}

# Minimum token length for multi-word phrases
_MIN_MULTI_WORD_LEN = 3  # chars per word component


def extract_concepts(grant_idea: str, sections: list[dict]) -> list[str]:
    """
    Extract named concepts from the grant idea and skeleton section content.

    Returns a deduplicated list of concept strings, ordered by approximate importance
    (frequency × specificity heuristic).

    Concepts are suitable as search queries for `retrieve_content_exemplars`.
    """
    all_text = _collect_text(grant_idea, sections)

    candidates: dict[str, int] = {}

    # Acronyms
    for match in _ACRONYM_RE.finditer(all_text):
        token = match.group()
        if token not in _STOPWORDS and len(token) >= 2:
            candidates[token] = candidates.get(token, 0) + 2  # weight acronyms higher

    # CamelCase names
    for match in _CAMEL_RE.finditer(all_text):
        token = match.group()
        if token not in _STOPWORDS:
            candidates[token] = candidates.get(token, 0) + 2

    # Title-case multi-word phrases
    for match in _TITLE_MULTI_RE.finditer(all_text):
        phrase = match.group()
        words = phrase.split()
        if (
            len(words) >= 2
            and not all(w in _STOPWORDS for w in words)
            and all(len(w) >= _MIN_MULTI_WORD_LEN for w in words)
        ):
            candidates[phrase] = candidates.get(phrase, 0) + 1

    # Sort by frequency score descending, then alphabetically for stability
    sorted_concepts = sorted(candidates.items(), key=lambda x: (-x[1], x[0]))

    # Return top concepts, deduplicated (remove phrases whose words are sub-strings of a longer entry)
    return _deduplicate([c for c, _ in sorted_concepts])[:12]


def _collect_text(grant_idea: str, sections: list[dict]) -> str:
    parts = [grant_idea or ""]
    for sec in sections:
        parts.append(sec.get("content") or "")
        parts.append(sec.get("name") or sec.get("title") or "")
    return " ".join(parts)


def _deduplicate(concepts: list[str]) -> list[str]:
    """Remove shorter entries that are fully contained within a longer entry."""
    result = []
    for c in concepts:
        c_upper = c.upper()
        dominated = any(
            c != other and c_upper in other.upper()
            for other in concepts
            if len(other) > len(c)
        )
        if not dominated:
            result.append(c)
    return result
