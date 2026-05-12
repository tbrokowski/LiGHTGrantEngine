"""RSS feed scraper."""
import feedparser
from app.scrapers.base import BaseScraper

class RSScraper(BaseScraper):
    def fetch(self) -> list[dict]:
        if not self.source.url:
            return []
        feed = feedparser.parse(self.source.url)
        results = []
        for entry in feed.entries:
            results.append(self._normalize({
                "title": entry.get("title", ""),
                "description": entry.get("summary", ""),
                "url": entry.get("link", ""),
                "funder": self.source.name,
                "deadline": entry.get("published"),
            }))
        return results
