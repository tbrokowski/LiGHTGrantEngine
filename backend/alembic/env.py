import asyncio
from logging.config import fileConfig

from sqlalchemy import pool, create_engine
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

from app.database import Base
import app.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from app.config import get_settings
    settings = get_settings()

    # Use synchronous psycopg2 for migrations — avoids asyncpg checkfirst bugs
    sync_url = (
        settings.database_url
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("asyncpg://", "postgresql://")
    )

    connectable = create_engine(sync_url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        do_run_migrations(connection)

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
