"""SQLAlchemy async engine + session factory."""
import os

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from pgvector.sqlalchemy import Vector  # noqa: F401 – registers type

from app.config import get_settings

settings = get_settings()

# Convert sync postgres:// to async postgresql+asyncpg://
_db_url = settings.database_url.replace(
    "postgresql://", "postgresql+asyncpg://"
).replace(
    "postgres://", "postgresql+asyncpg://"
)

# Bounded, env-tunable async pool. Previously 10 + 20 overflow = up to 30
# connections for the web service alone, which — combined with the sync
# worker engines — exhausted Postgres. Defaults now cap the web process at
# ~10 concurrent connections; raise DB_ASYNC_POOL_SIZE / DB_ASYNC_MAX_OVERFLOW
# per service if a plan with more headroom is used.
engine = create_async_engine(
    _db_url,
    echo=settings.debug,
    pool_pre_ping=True,
    pool_size=int(os.environ.get("DB_ASYNC_POOL_SIZE", "5")),
    max_overflow=int(os.environ.get("DB_ASYNC_MAX_OVERFLOW", "5")),
    pool_recycle=int(os.environ.get("DB_POOL_RECYCLE", "1800")),
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
