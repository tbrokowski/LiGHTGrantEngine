"""Source connector registry."""
from app.scrapers.base import BaseScraper
from app.scrapers.rss_scraper import RSScraper
from app.scrapers.html_scraper import HTMLScraper
from app.scrapers.api_connector import APIConnector


def get_scraper(source) -> BaseScraper:
    """Return the appropriate scraper for a source."""
    type_map = {
        "rss": RSScraper,
        "api": APIConnector,
        "html_static": HTMLScraper,
        "html_dynamic": HTMLScraper,
        "manual": BaseScraper,
    }
    cls = type_map.get(source.source_type, HTMLScraper)
    return cls(source)
