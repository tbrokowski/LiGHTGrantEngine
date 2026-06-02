"""
Load and expose configuration from config.yaml + environment variables.
Environment variables always override config.yaml values.
"""
from pathlib import Path
from functools import lru_cache
from typing import Any, Optional

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings


# ── Load raw YAML ─────────────────────────────────────────────────────────────
def _load_yaml(path: str = "/app/config.yaml") -> dict:
    config_path = Path(path)
    if not config_path.exists():
        # Try relative path for local dev
        config_path = Path(__file__).parent.parent.parent / "config.yaml"
    try:
        with open(config_path) as f:
            data = yaml.safe_load(f)
            # yaml.safe_load returns None for empty files
            return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}


_raw: dict = _load_yaml()


# ── Pydantic config models ────────────────────────────────────────────────────
class EmbeddingsConfig(BaseModel):
    base_url: str = "https://api.openai.com/v1"
    model: str = "text-embedding-3-small"
    dimension: int = 1536


class GenerationConfig(BaseModel):
    temperature: float = 0.3
    max_tokens: int = 4096
    top_p: float = 0.9
    timeout_seconds: int = 120


class AIConfig(BaseModel):
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    api_key: str = "EMPTY"
    embeddings: EmbeddingsConfig = EmbeddingsConfig()
    generation: GenerationConfig = GenerationConfig()
    agent_overrides: dict[str, Any] = {}


class FitScoringConfig(BaseModel):
    background_llm: bool = False  # use LLM fit_scorer for every new opportunity (slower, costs tokens)
    thematic_alignment: int = 35
    eligibility_match: int = 20
    deadline_feasibility: int = 10
    strategic_funder_priority: int = 10
    award_size: int = 10
    geographic_relevance: int = 10
    partner_feasibility: int = 5
    tiers: dict[str, int] = {"high_priority": 80, "worth_reviewing": 60, "watchlist": 40}
    team_themes: list[str] = []
    team_geographies: list[str] = []
    institution_type: str = "academic"
    institution_name: str = "EPFL"


class RAGConfig(BaseModel):
    chunk_size: int = 800
    chunk_overlap: int = 100
    top_k: int = 8
    keyword_weight: float = 0.3
    vector_weight: float = 0.7
    min_similarity: float = 0.60
    enforce_ai_permissions: bool = True


class NotificationConfig(BaseModel):
    email: dict[str, Any] = {}
    slack: dict[str, Any] = {}
    teams: dict[str, Any] = {}
    reminders: dict[str, list[int]] = {
        "external_deadline": [60, 30, 14, 7, 3, 1],
        "internal_deadline": [14, 7, 3, 1],
        "task_deadline": [7, 3, 1, 0],
    }


class GoogleDriveConfig(BaseModel):
    enabled: bool = False
    service_account_file: str = ""
    parent_folder_id: str = ""
    share_with: list[str] = []


class CitationsConfig(BaseModel):
    openalex_base_url: str = "https://api.openalex.org"
    pubmed_email: str = "team@light.epfl.ch"
    max_results_per_query: int = 5
    cache_ttl_hours: int = 24


class WebSearchConfig(BaseModel):
    enabled: bool = True
    tavily_max_results: int = 5
    cache_ttl_hours: int = 24


class SourceDiscoveryConfig(BaseModel):
    enabled: bool = True
    n_queries_per_run: int = 40
    auto_approve_confidence: int = 70
    query_rotation_ttl_days: int = 30
    max_candidates_per_run: int = 200


class Settings(BaseSettings):
    """
    Main settings object. Values come from:
    1. config.yaml (loaded above)
    2. Environment variables (override config.yaml)
    """
    # Database
    database_url: str = (_raw.get("database") or {}).get("url", "postgresql://light:light@localhost:5432/light_grants")

    # Redis
    redis_url: str = (_raw.get("redis") or {}).get("url", "redis://localhost:6379/0")

    # Auth
    secret_key: str = (_raw.get("auth") or {}).get("secret_key", "CHANGE_ME")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # App
    app_name: str = (_raw.get("app") or {}).get("name", "LiGHT Grant System")
    environment: str = (_raw.get("app") or {}).get("environment", "development")
    debug: bool = (_raw.get("app") or {}).get("debug", False)
    log_level: str = (_raw.get("app") or {}).get("log_level", "INFO")
    base_url: str = (_raw.get("app") or {}).get("base_url", "http://localhost:3000")
    api_url: str = (_raw.get("app") or {}).get("api_url", "http://localhost:8000")
    default_page_size: int = (_raw.get("app") or {}).get("default_page_size", 25)
    max_page_size: int = (_raw.get("app") or {}).get("max_page_size", 200)

    # OpenAI API key override
    openai_api_key: Optional[str] = None

    # Cloudflare R2 object storage
    r2_account_id: Optional[str] = None
    r2_access_key_id: Optional[str] = None
    r2_secret_access_key: Optional[str] = None
    r2_bucket_name: str = "grantengine"

    # Email (Resend HTTP API)
    resend_api_key: Optional[str] = None
    smtp_from: str = "onboarding@resend.dev"

    # Legacy SMTP fields (unused — kept so existing .env files don't break)
    smtp_host: str = "smtp.resend.com"
    smtp_port: int = 587
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None

    # Google OAuth
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None

    # Slack
    slack_webhook_url: Optional[str] = None
    slack_bot_token: Optional[str] = None
    slack_signing_secret: Optional[str] = None

    # Tavily web search
    tavily_api_key: Optional[str] = None

    # Exa.ai neural search (source discovery)
    exa_api_key: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = False

    @property
    def ai(self) -> AIConfig:
        cfg = dict(_raw.get("ai") or {})
        if self.openai_api_key:
            cfg["api_key"] = self.openai_api_key
        return AIConfig(**cfg)

    @property
    def fit_scoring(self) -> FitScoringConfig:
        return FitScoringConfig(**(_raw.get("fit_scoring") or {}))

    @property
    def rag(self) -> RAGConfig:
        return RAGConfig(**(_raw.get("rag") or {}))

    @property
    def notifications(self) -> NotificationConfig:
        return NotificationConfig(**(_raw.get("notifications") or {}))

    @property
    def google_drive(self) -> GoogleDriveConfig:
        return GoogleDriveConfig(**(_raw.get("google_drive") or {}))

    @property
    def citations(self) -> CitationsConfig:
        return CitationsConfig(**(_raw.get("citations") or {}))

    @property
    def web_search(self) -> "WebSearchConfig":
        return WebSearchConfig(**(_raw.get("web_search") or {}))

    @property
    def source_discovery(self) -> "SourceDiscoveryConfig":
        return SourceDiscoveryConfig(**(_raw.get("source_discovery") or {}))

    @property
    def discovery(self) -> dict:
        return _raw.get("discovery") or {}

    @property
    def parsing(self) -> dict:
        return _raw.get("parsing") or {}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
