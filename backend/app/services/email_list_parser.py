"""Parse a pasted recipient list (an email To:/Cc: header, a column of
addresses, a thread) into contacts.

Handles the shapes mail clients actually produce:
  Lario Viljoen <lario@sun.ac.za>
  "Redfern, A, Dr" <redfern@sun.ac.za>
  "Beth Amato (beth.amato3@wits.ac.za)" <beth.amato3@wits.ac.za>
  abdallah <abdallah.mwaduga@aol.com>
  plain@address.org

Deterministic — no LLM — so a list of a hundred addresses parses instantly and
the preview matches exactly what will be created. When the display name is
missing or is just the mailbox (e.g. "hharmon"), the name is guessed from the
local part and flagged `name_guessed` so research knows to confirm it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# `Display Name <addr>` — the display name may be quoted and contain commas.
_ANGLE_RE = re.compile(r'("(?:[^"\\]|\\.)*"|[^<>,;"\r\n]*?)[ \t]*<\s*([^<>\s]+@[^<>\s]+)\s*>')
_HONORIFICS = {"dr", "prof", "mr", "mrs", "ms", "mnr", "mev", "me", "phd", "md", "pr"}
# Lowercase surname particles ("James van Duuren") that stay lowercase.
_PARTICLES = {"van", "von", "de", "der", "den", "du", "da", "di", "del", "della", "le", "la", "bin", "binti", "al", "el", "dos", "das"}
_HEADER_RE = re.compile(r"^\s*(to|cc|bcc|from|reply-to)\s*:\s*", re.I | re.M)

# Consumer mailbox domains: the domain says nothing about where they work.
PERSONAL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "yahoo.co.uk",
    "hotmail.com", "hotmail.fr", "outlook.com", "live.com", "msn.com",
    "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
    "gmx.com", "gmx.de", "mail.com", "ymail.com",
}


@dataclass
class ParsedContact:
    email: str
    name: str
    name_guessed: bool
    domain: str
    personal_domain: bool

    def to_dict(self) -> dict:
        return asdict(self)


def _clean_display_name(raw: str, email: str) -> str:
    name = raw.strip().strip('"').strip("'").strip()
    # "Beth Amato (beth.amato3@wits.ac.za)" → "Beth Amato"
    name = re.sub(r"\([^)]*@[^)]*\)", "", name)
    # A display name that is itself an address (possibly mangled with spaces,
    # e.g. "enya. seguin@epfl. ch") carries no name.
    if "@" in name:
        return ""
    name = re.sub(r"\s+", " ", name).strip(" ,;")
    # "Redfern, A, Dr" / "Doe, Jane" → "A Redfern" / "Jane Doe"
    if "," in name:
        parts = [p.strip() for p in name.split(",") if p.strip()]
        parts = [p for p in parts if p.rstrip(".").lower() not in _HONORIFICS]
        if len(parts) >= 2:
            name = " ".join(parts[1:] + parts[:1])
        elif parts:
            name = parts[0]
    # "Lamore Grayson Mnr" / "Dr Jane Doe" → drop leading/trailing honorifics.
    words = name.split()
    while len(words) > 1 and words[-1].rstrip(".").lower() in _HONORIFICS:
        words.pop()
    while len(words) > 1 and words[0].rstrip(".").lower() in _HONORIFICS:
        words.pop(0)
    return " ".join(words)


def _name_from_local_part(local: str) -> str:
    local = re.sub(r"\d+", "", local.split("+")[0])
    pieces = [p for p in re.split(r"[._-]+", local) if p]
    return " ".join(p.capitalize() for p in pieces)


def _looks_like_mailbox(name: str) -> bool:
    """True when the display name is a single token ("hharmon", "Djite",
    "Marie") rather than a person's full name."""
    return " " not in name.strip()


def _smart_title(name: str) -> str:
    # Mail clients often send SHOUTED surnames ("Amadou Mansour DJITE") or an
    # all-lowercase mailbox as the name ("hharmon").
    words = name.split()
    return " ".join(
        w if (i > 0 and w in _PARTICLES)
        else w.capitalize() if (w.isupper() and len(w) > 1) or w.islower()
        else w
        for i, w in enumerate(words)
    )


def parse_email_list(text: str) -> list[ParsedContact]:
    """Extract unique contacts from pasted text, in order of first appearance."""
    if not text:
        return []
    text = _HEADER_RE.sub("", text)

    found: list[tuple[int, str, str]] = []
    consumed: list[tuple[int, int]] = []
    for m in _ANGLE_RE.finditer(text):
        found.append((m.start(), m.group(1), m.group(2)))
        consumed.append(m.span())

    # Bare addresses not already inside a `Name <addr>` pair.
    def inside(pos: int) -> bool:
        return any(a <= pos < b for a, b in consumed)

    for m in _EMAIL_RE.finditer(text):
        if not inside(m.start()):
            found.append((m.start(), "", m.group(0)))
    found.sort(key=lambda f: f[0])

    seen: set[str] = set()
    out: list[ParsedContact] = []
    for _, raw_name, raw_email in found:
        email = raw_email.strip().strip(".,;:").lower()
        if not _EMAIL_RE.fullmatch(email) or email in seen:
            continue
        seen.add(email)
        local, _, domain = email.partition("@")

        name = _clean_display_name(raw_name, email)
        guessed = not name or _looks_like_mailbox(name)
        if not name:
            name = _name_from_local_part(local)
        elif guessed:
            # A single-token display name is still better than nothing, but a
            # dotted local part ("aita.signorell") usually carries more.
            from_local = _name_from_local_part(local)
            if len(from_local.split()) > len(name.split()):
                name = from_local
        name = _smart_title(name) or email

        out.append(ParsedContact(
            email=email,
            name=name,
            name_guessed=guessed,
            domain=domain,
            personal_domain=domain in PERSONAL_DOMAINS,
        ))
    return out
