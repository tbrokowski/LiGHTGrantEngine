"""Add NIHR funding opportunities as a scraper source."""

import uuid
from alembic import op

revision = "043_add_nihr_source"
down_revision = "042_opportunity_type"
branch_labels = None
depends_on = None

_NIHR_ID = str(uuid.uuid4())


def upgrade() -> None:
    op.execute(
        f"""
        INSERT INTO sources (
            id, name, category, url, source_type,
            scraper_config, refresh_frequency, status,
            is_high_priority, relevant_themes, relevant_geographies,
            error_log, opportunities_discovered, opportunities_added,
            duplicates_detected
        )
        SELECT
            '{_NIHR_ID}',
            'NIHR Funding Opportunities',
            'Science & Research',
            'https://www.nihr.ac.uk/funding-opportunities',
            'ai_scraper',
            '{{"use_playwright": true, "crawl_depth": 1, "paginate": true}}'::jsonb,
            'weekly',
            'active',
            false,
            '["health", "clinical research", "biomedical"]'::jsonb,
            '["UK"]'::jsonb,
            '[]'::jsonb,
            0, 0, 0
        WHERE NOT EXISTS (
            SELECT 1 FROM sources WHERE url = 'https://www.nihr.ac.uk/funding-opportunities'
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM sources WHERE url = 'https://www.nihr.ac.uk/funding-opportunities'
        """
    )
