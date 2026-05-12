"""
Load and expose configuration from config.yaml + environment variables.
Environment variables always override config.yaml values.
"""
import os
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
    with open(config_path) as f:
        return yaml.safe_load(f)


_raw: dict = _load_yaml()


# ── Pydantic config models ────────────────────────────────────────────────────
class QwenEmbeddingsConfig(BaseModel):
    base_url: str = "http://localhost:8000/v1"
    model: str = "Qwen/Qwen2.5-72B-Instruct"
    dimension: int = 4096


class QwenGenerationConfig(BaseModel):
    temperature: float = 0.3
    max_tokens: int = 4096
    top_p: float = 0.9
    timeout_seconds: int = 120


class AIConfig(BaseModel):
    base_url: str = "http://localhost:8000/v1"
    model: str = "Qwen/Qwen2.5-72B-Instruct"
    api_key: str = "EMPTY"
    embeddings: QwenEmbeddingsConfig = QwenEmbeddingsConfig()
    generation: QwenGenerationConfig = QwenGenerationConfig()
    agent_overrides: dict[str, Any] = {}


class FitScoringConfig(BaseModel):
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


class Settings(BaseSettings):
    """
    Main settings object. Values come from:
    1. config.yaml (loaded above)
    2. Environment variables (override config.yaml)
    """
    # Database
    database_url: str = _raw.get("database", {}).get("url", "postgresql://light:light@localhost:5432/light_grants")

    # Redis
    redis_url: str = _raw.get("redis", {}).get("url", "redis://localhost:6379/0")

    # Auth
    secret_key: str = _raw.get("auth", {}).get("secret_key", "CHANGE_ME")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # App
    app_name: str = _raw.get("app", {}).get("name", "LiGHT Grant System")
    environment: str = _raw.get("app", {}).get("environment", "development")
    debug: bool = _raw.get("app", {}).get("debug", False)
    log_level: str = _raw.get("app", {}).get("log_level", "INFO")
    base_url: str = _raw.get("app", {}).get("base_url", "http://localhost:3000")
    api_url: str = _raw.get("app", {}).get("api_url", "http://localhost:8000")
    default_page_size: int = _raw.get("app", {}).get("default_page_size", 25)
    max_page_size: int = _raw.get("app", {}).get("max_page_size", 200)

    # Qwen API key override
    qwen_api_key: Optional[str] = None

    # SMTP
    smtp_password: Optional[str] = None

    # Google OAuth
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None

    # Slack
    slack_webhook_url: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = False

    @property
    def ai(self) -> AIConfig:
        cfg = _raw.get("ai", {})
        if self.qwen_api_key:
            cfg["api_key"] = self.qwen_api_key
        return AIConfig(**cfg)

    @property
    def fit_scoring(self) -> FitScoringConfig:
        return FitScoringConfig(**_raw.get("fit_scoring", {}))

    @property
    def rag(self) -> RAGConfig:
        return RAGConfig(**_raw.get("rag", {}))

    @property
    def notifications(self) -> NotificationConfig:
        return NotificationConfig(**_raw.get("notifications", {}))

    @property
    def discovery(self) -> dict:
        return _raw.get("discovery", {})

    @property
    def parsing(self) -> dict:
        return _raw.get("parsing", {})


@lru_cache()
def get_settings() -> Settings:
    return Settings()
