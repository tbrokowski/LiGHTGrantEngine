"""Source connector registry."""
from app.scrapers.base import BaseScraper
from app.scrapers.rss_scraper import RSScraper
from app.scrapers.html_scraper import HTMLScraper
from app.scrapers.api_connector import APIConnector
from app.scrapers.ai_scraper import AIScraper
from app.scrapers.grants_gov_scraper import GrantsGovScraper
from app.scrapers.nih_reporter_scraper import NIHReporterScraper
from app.scrapers.nsf_scraper import NSFScraper
from app.scrapers.sbir_scraper import SBIRScraper
from app.scrapers.eu_funding_scraper import EUFundingScraper
from app.scrapers.ukri_gtr_scraper import UKRIGtRScraper
from app.scrapers.iati_scraper import IATIScraper
from app.scrapers.three60giving_scraper import ThreeSixtyGivingScraper
from app.scrapers.openalex_scraper import OpenAlexScraper
from app.scrapers.propublica_scraper import ProPublicaScraper
from app.scrapers.openreview_scraper import OpenReviewScraper


def get_scraper(source) -> BaseScraper:
    """Return the appropriate scraper for a source."""
    type_map = {
        # Generic scrapers
        "rss": RSScraper,
        "api": APIConnector,
        "html_static": HTMLScraper,
        "html_dynamic": HTMLScraper,
        "manual": BaseScraper,
        # AI-powered general-purpose scraper
        "ai_scraper": AIScraper,
        # Legacy alias from earlier frontend versions
        "scraper": AIScraper,
        # Dedicated API scrapers for major grant sources
        "grants_gov": GrantsGovScraper,
        "nih_reporter": NIHReporterScraper,
        "nsf": NSFScraper,
        "sbir": SBIRScraper,
        "eu_funding": EUFundingScraper,
        "ukri_gtr": UKRIGtRScraper,
        "iati": IATIScraper,
        "three60giving": ThreeSixtyGivingScraper,
        "openalex": OpenAlexScraper,
        "propublica": ProPublicaScraper,
        "openreview": OpenReviewScraper,
    }
    cls = type_map.get(source.source_type, AIScraper)
    return cls(source)
