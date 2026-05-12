"""Base scraper interface."""
from typing import Any

class BaseScraper:
    def __init__(self, source):
        self.source = source

    def fetch(self) -> list[dict]:
        """Fetch raw listings from the source. Override in subclasses."""
        return []

    def _normalize(self, raw: dict) -> dict:
        return {
            "title": raw.get("title", ""),
            "description": raw.get("description", ""),
            "url": raw.get("url") or raw.get("link", ""),
            "funder": raw.get("funder", self.source.name),
            "deadline": raw.get("deadline"),
            "raw_text": str(raw),
        }
