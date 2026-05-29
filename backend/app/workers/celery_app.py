"""Celery application factory — reads broker URL from config.yaml."""
from celery import Celery
from celery.schedules import crontab
from kombu import Queue
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "light_grants",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.workers.discovery_tasks",
        "app.workers.enrichment_tasks",
        "app.workers.notification_tasks",
        "app.workers.embedding_tasks",
        "app.workers.org_tasks",
        "app.workers.surfacing_tasks",
        "app.workers.archive_tasks",
        "app.workers.clustering_tasks",
        "app.workers.archive_clustering_tasks",
        "app.workers.grant_writing_tasks",
        "app.workers.partner_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_queues=(
        Queue("celery"),          # default — discovery, enrichment, scoring
        Queue("call_analysis"),   # dedicated — never starved by bulk tasks
        Queue("summaries"),       # low-priority — AI summaries (bulk, deferrable)
    ),
    task_routes={
        "app.workers.grant_writing_tasks.analyze_grant_call":    {"queue": "call_analysis"},
        "app.workers.grant_writing_tasks.generate_skeleton_task": {"queue": "call_analysis"},
        "app.workers.grant_writing_tasks.generate_draft_task":        {"queue": "call_analysis"},
        "app.workers.grant_writing_tasks.summarize_conversation_task":      {"queue": "summaries"},
        "app.workers.grant_writing_tasks.synthesize_call_intelligence_task": {"queue": "summaries"},
        "app.workers.enrichment_tasks.generate_ai_summary":            {"queue": "summaries"},
    },
)

# ── Celery Beat schedule ──────────────────────────────────────────────────────
disc = settings.discovery
hour = disc.get("weekly_scan_hour", 5)
day = disc.get("weekly_scan_day", "monday")
day_map = {"monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "sunday": 0}

celery_app.conf.beat_schedule = {
    "weekly-source-scan": {
        "task": "app.workers.discovery_tasks.scan_all_sources",
        "schedule": crontab(hour=hour, minute=0, day_of_week=day_map.get(day, 1)),
    },
    "daily-high-priority-scan": {
        "task": "app.workers.discovery_tasks.scan_high_priority_sources",
        "schedule": crontab(hour=disc.get("daily_scan_hour", 6), minute=0),
    },
    "deadline-reminders": {
        "task": "app.workers.notification_tasks.send_deadline_reminders",
        "schedule": crontab(hour=7, minute=0),
    },
    "source-health-check": {
        "task": "app.workers.discovery_tasks.check_source_health",
        "schedule": crontab(hour=8, minute=0, day_of_week=1),
    },
    "resurface-missing-institution-opps": {
        "task": "app.workers.surfacing_tasks.surface_missing_institution_links_all",
        "schedule": crontab(hour=3, minute=0),
    },
    "recluster-opportunities": {
        "task": "app.workers.clustering_tasks.cluster_opportunities",
        # Run every 6 hours — keeps graph communities fresh as new grants arrive
        "schedule": crontab(hour="*/6", minute=30),
    },
    "recluster-archives": {
        "task": "app.workers.archive_clustering_tasks.cluster_archives",
        # Run every 6 hours, offset by 15 minutes from opportunity clustering
        "schedule": crontab(hour="*/6", minute=45),
    },
    "recover-stale-archive-tasks": {
        "task": "app.workers.archive_tasks.recover_stale_archive_tasks",
        "schedule": crontab(minute="*/15"),
    },
    "recover-stale-call-analysis": {
        "task": "app.workers.grant_writing_tasks.recover_stale_call_analysis_tasks",
        "schedule": crontab(minute="*/5"),
    },
    "partner-reminders": {
        "task": "app.workers.partner_tasks.send_partner_reminders",
        "schedule": crontab(hour=8, minute=30),
    },
    "pre-meeting-preps": {
        "task": "app.workers.partner_tasks.generate_pre_meeting_preps",
        "schedule": crontab(hour=7, minute=0),
    },
    # Runs nightly to suppress duplicate rows that slipped through ingest dedup.
    # Safe to re-run (idempotent); already-marked rows are skipped.
    "nightly-dedup-pool": {
        "task": "app.workers.discovery_tasks.deduplicate_opportunity_pool",
        "schedule": crontab(hour=2, minute=0),
    },
}
