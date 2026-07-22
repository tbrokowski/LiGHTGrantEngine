"""HTML page scraper with configurable selectors."""
from bs4 import BeautifulSoup
from app.scrapers.base import BaseScraper, resolve_absolute_url
from app.scrapers.fetch import fetch_page

class HTMLScraper(BaseScraper):
    def _collect_page_links(self, soup) -> None:
        links: list[tuple[str, str]] = []
        seen: set[str] = set()
        for anchor in soup.find_all("a", href=True):
            href = resolve_absolute_url(anchor["href"], self.source.url)
            if not href or href in seen:
                continue
            seen.add(href)
            text = anchor.get_text(separator=" ", strip=True)
            if text:
                links.append((text, href))
        self._page_links = links

    def fetch(self) -> list[dict]:
        if not self.source.url:
            return []
        cfg = self.source.scraper_config or {}
        try:
            result = fetch_page(
                self.source.url,
                force_playwright=bool(cfg.get("use_playwright", False)),
            )
            if not result.html:
                return []
            soup = BeautifulSoup(result.html, "lxml")
            self._collect_page_links(soup)
            results = []

            # Use configured CSS selector or fall back to generic extraction
            item_selector = cfg.get("item_selector")
            if item_selector:
                items = soup.select(item_selector)
                for item in items[:50]:
                    title = item.select_one(cfg.get("title_selector", "h2,h3,a"))
                    link = item.select_one(cfg.get("link_selector", "a"))
                    desc = item.select_one(cfg.get("desc_selector", "p"))
                    results.append(self._normalize({
                        "title": title.get_text(strip=True) if title else "",
                        "description": desc.get_text(strip=True) if desc else "",
                        "url": resolve_absolute_url(link.get("href", ""), self.source.url) if link else "",
                        "funder": self.source.name,
                    }))
            else:
                # Generic: extract all links with surrounding context
                for link in soup.find_all("a", href=True)[:30]:
                    text = link.get_text(strip=True)
                    if len(text) > 20:
                        results.append(self._normalize({
                            "title": text,
                            "url": resolve_absolute_url(link["href"], self.source.url),
                            "funder": self.source.name,
                        }))
            return results
        except Exception as e:
            return []
