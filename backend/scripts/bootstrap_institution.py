"""
One-time setup script: creates the EPFL institution (if not exists),
links the admin user to it, fans out all sources, and bootstraps the
institution's grant feed from existing opportunities in the DB.

Usage:
    docker compose exec backend python /app/scripts/bootstrap_institution.py
"""
import sys
import uuid
import logging
from pathlib import Path

# Support running locally or inside Docker at /app/scripts
_docker_app = Path(__file__).parent.parent  # /app when script is at /app/scripts
_local_backend = Path(__file__).parent.parent / "backend"
for _p in [_docker_app, _local_backend]:
    if (_p / "app").exists():
        sys.path.insert(0, str(_p))
        break

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    from sqlalchemy import create_engine, select, text
    from sqlalchemy.orm import Session
    from app.config import get_settings
    from app.models.institution import Institution
    from app.models.user import User
    from app.services.grant_bootstrap import (
        fan_out_sources_to_institutions,
        bootstrap_institution_feed,
    )

    settings = get_settings()
    cfg = settings.fit_scoring
    engine = create_engine(settings.database_url)

    with Session(engine) as db:
        # ── 1. Create institution ─────────────────────────────────────────────
        inst_name = cfg.institution_name or "LiGHT"
        existing_inst = db.execute(
            select(Institution).where(Institution.name == inst_name)
        ).scalar_one_or_none()

        if existing_inst:
            inst = existing_inst
            logger.info("Institution already exists: %s (id=%s)", inst.name, inst.id)
        else:
            inst = Institution(
                id=str(uuid.uuid4()),
                name=inst_name,
                grant_profile={
                    "institution_name": inst_name,
                    "keywords": cfg.team_themes or [],
                    "geographies": cfg.team_geographies or [],
                    "projects": "",
                    "excluded_keywords": [],
                    "auto_queue_threshold": settings.discovery.get("auto_queue_threshold", 40),
                },
            )
            db.add(inst)
            db.commit()
            logger.info("Created institution: %s (id=%s)", inst.name, inst.id)

        # ── 2. Link admin users to institution ────────────────────────────────
        users = db.execute(select(User)).scalars().all()
        linked_count = 0
        for user in users:
            if not user.institution_id:
                user.institution_id = inst.id
                # Promote institution_role to admin for system admin users
                if user.role == "admin":
                    user.institution_role = "admin"
                linked_count += 1
                logger.info("Linked user %s to institution (institution_role=%s)",
                            user.email, user.institution_role)
        db.commit()
        if linked_count == 0:
            logger.info("All users already linked to an institution.")

        # ── 3. Fan out sources ────────────────────────────────────────────────
        linked_sources = fan_out_sources_to_institutions(db)
        logger.info("Institution-source links created: %d", linked_sources)

        # ── 4. Bootstrap institution feed from existing opportunities ─────────
        surfaced = bootstrap_institution_feed(db, inst.id)
        logger.info("Surfaced %d opportunities to institution feed", surfaced)

    logger.info("Bootstrap complete.")


if __name__ == "__main__":
    main()
