"""
Figure Generator — generates a scientific overview figure for a grant proposal
using DALL-E 3 / gpt-image-1. The image is suitable for use as a visual abstract
or conceptual overview figure in the Introduction section.

The prompt is constructed from the grant's key themes, theory of change,
methodology type, and funder context to produce a clear, professional scientific
diagram style image rather than decorative art.
"""
import json
import logging

from openai import AsyncOpenAI
from app.config import get_settings

logger = logging.getLogger(__name__)

# Default image model — can be overridden in config.yaml under agent_overrides.figure_generator
DEFAULT_IMAGE_MODEL = "dall-e-3"
DEFAULT_IMAGE_SIZE = "1024x1024"
DEFAULT_IMAGE_QUALITY = "hd"


async def generate_overview_figure(
    opportunity_title: str,
    grant_idea: str,
    call_strategy: dict | None = None,
    call_analysis: dict | None = None,
    aligned_concept: dict | None = None,
    funder: str = "",
    custom_instructions: str = "",
) -> dict:
    """
    Generate a scientific overview figure for a grant proposal.

    Returns:
      {
        "image_url": str,          # OpenAI temporary URL (must be downloaded promptly)
        "revised_prompt": str,     # DALL-E's actual prompt after revision
        "alt_text": str,           # Descriptive alt text for the figure
        "prompt_used": str,        # The prompt we sent
      }
    """
    prompt = _build_figure_prompt(
        opportunity_title=opportunity_title,
        grant_idea=grant_idea,
        call_strategy=call_strategy,
        call_analysis=call_analysis,
        aligned_concept=aligned_concept,
        funder=funder,
        custom_instructions=custom_instructions,
    )

    settings = get_settings()
    client = AsyncOpenAI(
        api_key=settings.ai.api_key,
        base_url=None,  # Always use OpenAI's real image endpoint, not a proxy
    )

    # Check config for model override
    image_model = DEFAULT_IMAGE_MODEL
    image_size = DEFAULT_IMAGE_SIZE
    image_quality = DEFAULT_IMAGE_QUALITY

    try:
        agent_cfg = settings.ai.agent_overrides.get("figure_generator", {}) if hasattr(settings, "ai") else {}
        if agent_cfg.get("image_model"):
            image_model = agent_cfg["image_model"]
        if agent_cfg.get("size"):
            image_size = agent_cfg["size"]
    except (AttributeError, TypeError):
        pass

    logger.info("Generating overview figure with %s for grant: %s", image_model, opportunity_title)

    response = await client.images.generate(
        model=image_model,
        prompt=prompt,
        size=image_size,
        quality=image_quality,
        n=1,
        response_format="url",
    )

    image_data = response.data[0]
    image_url = image_data.url
    revised_prompt = getattr(image_data, "revised_prompt", prompt)

    alt_text = _build_alt_text(opportunity_title, call_strategy, call_analysis)

    return {
        "image_url": image_url,
        "revised_prompt": revised_prompt,
        "alt_text": alt_text,
        "prompt_used": prompt,
    }


def _build_figure_prompt(
    opportunity_title: str,
    grant_idea: str,
    call_strategy: dict | None,
    call_analysis: dict | None,
    aligned_concept: dict | None,
    funder: str,
    custom_instructions: str,
) -> str:
    """Construct a high-quality scientific figure prompt."""

    # Extract key visual elements
    themes = []
    if call_strategy:
        themes = (call_strategy.get("critical_themes") or [])[:4]
    elif call_analysis:
        themes = (call_analysis.get("funder_priorities") or [])[:3]

    methodology_hint = ""
    if call_analysis:
        areas = call_analysis.get("key_focus_areas") or []
        if areas and isinstance(areas[0], dict):
            methodology_hint = areas[0].get("area", "")

    framing = ""
    if aligned_concept:
        framing = (aligned_concept.get("aligned_framing") or "")[:300]
    if not framing and grant_idea:
        framing = grant_idea[:300]

    theory_of_change = ""
    if call_strategy:
        theory_of_change = (call_strategy.get("narrative_framing") or "")[:200]

    themes_str = "; ".join(themes) if themes else ""

    # Build the core prompt
    prompt_parts = [
        "Create a professional scientific overview figure suitable for a grant proposal.",
        "Style: Clean infographic/diagram style with minimal text labels, white background,",
        "professional scientific illustration, no decorative elements, suitable for academic publication.",
        "Do NOT include: people, faces, realistic photography, flags, logos, or text paragraphs.",
        "Do include: flow diagrams, system diagrams, conceptual frameworks, data visualisations, process flows.",
    ]

    prompt_parts.append(f"\nGRANT TOPIC: {opportunity_title}")

    if framing:
        prompt_parts.append(f"CONCEPT: {framing}")

    if theory_of_change:
        prompt_parts.append(f"THEORY OF CHANGE: {theory_of_change}")

    if themes_str:
        prompt_parts.append(f"KEY THEMES: {themes_str}")

    if methodology_hint:
        prompt_parts.append(f"METHODOLOGY FOCUS: {methodology_hint}")

    if funder:
        prompt_parts.append(f"CONTEXT: Research proposal for {funder}")

    prompt_parts.append(
        "\nThe figure should illustrate the conceptual framework or logic model of this grant proposal "
        "— showing how inputs lead to activities, outputs, and impact. "
        "Use 3-5 connected diagram elements. Clean, modern scientific style with a clear visual hierarchy."
    )

    if custom_instructions:
        prompt_parts.append(f"\nADDITIONAL INSTRUCTIONS: {custom_instructions}")

    return " ".join(prompt_parts)


def _build_alt_text(
    opportunity_title: str,
    call_strategy: dict | None,
    call_analysis: dict | None,
) -> str:
    """Generate descriptive alt text for the figure."""
    themes = []
    if call_strategy:
        themes = (call_strategy.get("critical_themes") or [])[:3]
    elif call_analysis:
        themes = (call_analysis.get("funder_priorities") or [])[:2]

    if themes:
        return f"Overview figure for {opportunity_title}: conceptual framework showing {', '.join(themes)}"
    return f"Overview figure for {opportunity_title}: conceptual framework and logic model"
