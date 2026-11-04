"""Postgres access for meetings, accounts and teams.

Each request opens its own short connection: traffic is a handful of requests per meeting, and a
per-loop pool would break under the test client, which runs every request on a fresh event loop.
Schema changes live in migrations/NNN_*.sql and are applied once, in order, before first use.
"""
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row, tuple_row

DATABASE_URL = os.getenv("DATABASE_URL", "")
MIGRATIONS = Path(__file__).resolve().parent / "migrations"
MIGRATION_FILE = re.compile(r"(\d{3})_[a-z0-9_]+\.sql")
# Any constant shared by every app process; serializes concurrent migration runs.
MIGRATION_LOCK = 7_031_204
_migrated: set[str] = set()
logger = logging.getLogger("uvicorn.error")


def migration_files() -> list[tuple[int, Path]]:
    files = [(int(match.group(1)), path) for path in MIGRATIONS.iterdir() if (match := MIGRATION_FILE.fullmatch(path.name))]
    return sorted(files)


async def migrate(conn: psycopg.AsyncConnection) -> list[int]:
    """Apply migrations not yet recorded in schema_migrations; returns the versions applied now."""
    applied_now = []
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK,))
        await conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        done = {row[0] for row in await (await conn.cursor(row_factory=tuple_row).execute("SELECT version FROM schema_migrations")).fetchall()}
        for version, path in migration_files():
            if version in done:
                continue
            await conn.execute(path.read_text(encoding="utf-8"))
            await conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
            applied_now.append(version)
    return applied_now


@asynccontextmanager
async def connect():
    """One connection with dict rows; commits on success, rolls back on error."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, row_factory=dict_row) as conn:
        if DATABASE_URL not in _migrated:
            await migrate(conn)
            _migrated.add(DATABASE_URL)
        yield conn


async def check() -> None:
    """Fail loudly at startup when the database is unreachable or a migration fails."""
    try:
        async with connect() as conn:
            await conn.execute("SELECT 1")
    except psycopg.OperationalError as exc:
        logger.error("DATABASE_URL 無法連線（%s）：%s", DATABASE_URL.split("@")[-1], exc)
        raise
