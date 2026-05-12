"""API connector for grant sources with REST APIs (e.g., Grants.gov)."""
import httpx
from app.scrapers.base import BaseScraper

class APIConnector(BaseScraper):
    def fetch(self) -> list[dict]:
        endpoint = self.source.api_endpoint or self.source.url
        if not endpoint:
            return []
        cfg = self.source.scraper_config or {}
        try:
            headers = {}
            if cfg.get("api_key_header") and cfg.get("api_key"):
                headers[cfg["api_key_header"]] = cfg["api_key"]
            resp = httpx.get(endpoint, params=cfg.get("params", {}), headers=headers, timeout=30)
            data = resp.json()
            items = data if isinstance(data, list) else data.get(cfg.get("items_key", "opportunities"), [])
            results = []
            for item in items[:100]:
                results.append(self._normalize({
                    "title": item.get(cfg.get("title_field", "title"), ""),
                    "description": item.get(cfg.get("desc_field", "description"), ""),
                    "url": item.get(cfg.get("url_field", "url"), ""),
                    "deadline": item.get(cfg.get("deadline_field", "closeDate")),
                    "funder": self.source.name,
                }))
            return results
        except Exception:
            return []
