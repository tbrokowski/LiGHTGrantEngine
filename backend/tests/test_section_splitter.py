"""The section splitter asks the LLM for an outline only and cuts the text locally."""
import asyncio
import json

import app.ai.agents.section_splitter as splitter

PROPOSAL = """Improving Neonatal Care in Rural Clinics
Submitted to the Example Foundation

Abstract
We propose a low-cost monitoring program for newborns.
It reaches 40 clinics.

Specific Aims
Aim 1: Deploy monitors.
Aim 2: Train nurses.

Methods
We will run a stepped-wedge trial.
Data are collected weekly.
"""


def _run(coro):
    return asyncio.run(coro)


def _fake_llm(outline_for):
    calls = []

    async def fake(messages, agent_name=None, json_mode=False, **kw):
        prompt = messages[-1]["content"]
        calls.append(prompt)
        return json.dumps({"sections": outline_for(prompt)})

    return fake, calls


def test_sections_are_cut_from_source_text(monkeypatch):
    lines = PROPOSAL.strip().splitlines()
    idx = {line: i for i, line in enumerate(lines)}
    fake, calls = _fake_llm(lambda _p: [
        {"start_line": idx["Abstract"], "title": "Abstract", "section_type": "abstract", "heading_level": 1},
        {"start_line": idx["Specific Aims"], "title": "Specific Aims", "section_type": "specific_aims"},
        {"start_line": idx["Methods"], "title": "Methods", "section_type": "methods"},
    ])
    monkeypatch.setattr(splitter, "chat_complete", fake)

    sections, warnings = _run(splitter.split_proposal_into_sections(PROPOSAL, "Example"))

    assert [s["title"] for s in sections] == ["Abstract", "Specific Aims", "Methods"]
    # Title-page text before the first section is kept, not dropped.
    assert sections[0]["text"].startswith("Improving Neonatal Care")
    assert "low-cost monitoring" in sections[0]["text"]
    # The heading line itself isn't repeated in the body.
    assert not sections[1]["text"].startswith("Specific Aims")
    assert sections[1]["text"] == "Aim 1: Deploy monitors.\nAim 2: Train nurses."
    assert sections[2]["text"].endswith("Data are collected weekly.")
    assert [s["order"] for s in sections] == [1, 2, 3]
    assert len(calls) == 1
    assert "[0] Improving Neonatal Care" in calls[0]
    assert not warnings


def test_bad_outline_entries_are_ignored(monkeypatch):
    fake, _ = _fake_llm(lambda _p: [
        {"start_line": 9999, "title": "Out of range"},
        {"start_line": "x", "title": "Not a number"},
        {"start_line": 3, "title": "Abstract", "section_type": "not_a_type"},
        {"start_line": 3, "title": "Duplicate"},
    ])
    monkeypatch.setattr(splitter, "chat_complete", fake)
    sections, _ = _run(splitter.split_proposal_into_sections(PROPOSAL))
    assert [s["title"] for s in sections] == ["Abstract"]
    assert sections[0]["section_type"] == "abstract"  # inferred from the title


def test_llm_failure_falls_back_to_regex(monkeypatch):
    async def boom(*a, **k):
        raise TimeoutError("slow")
    monkeypatch.setattr(splitter, "chat_complete", boom)
    sections, warnings = _run(splitter.split_proposal_into_sections(PROPOSAL))
    assert sections and any("regex" in w for w in warnings)


def test_long_documents_are_outlined_in_parallel_windows(monkeypatch):
    monkeypatch.setattr(splitter, "WINDOW_CHARS", 2_000)
    body = "\n".join(f"Paragraph {i} " + "words " * 40 for i in range(200))
    text = "Background\n" + body + "\nMethods\n" + body

    def outline(prompt):
        found = []
        for line in prompt.splitlines():
            if line.endswith("] Background") or line.endswith("] Methods"):
                n = int(line[1:line.index("]")])
                found.append({"start_line": n, "title": line.split("] ", 1)[1], "section_type": "other"})
        return found

    fake, calls = _fake_llm(outline)
    monkeypatch.setattr(splitter, "chat_complete", fake)
    sections, _ = _run(splitter.split_proposal_into_sections(text))
    assert len(calls) > 2
    assert [s["title"] for s in sections] == ["Background", "Methods"]
    assert sum(s["word_count"] for s in sections) == len(text.split()) - 2  # everything but the two headings


def test_one_line_text_is_broken_into_sentences():
    text = " ".join(f"Sentence number {i} is here." for i in range(400))
    lines = splitter._source_lines(text)
    assert len(lines) > 10
    assert all(len(line) <= 600 for line in lines)
    assert " ".join(lines) == text
