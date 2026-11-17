"""How long saved 即時翻譯 and 即時口譯 records are kept (interpret-mode-on-home).

Administrators set the number of days on the team administration page (default 90). Record folders under
output/interpret/<user>/ whose id date is older are deleted, and so are working folders (.recording-*) left by a
server that stopped mid-session for more than a day: when the server starts, every 6 hours, and right after the
setting changes. Only the count is logged, never what was in a record.
"""
import asyncio
import logging
import shutil
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, StrictInt

import db
import interpret
import team_access

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
KEY = "records_retention_days"
DEFAULT_DAYS = 90
MAX_DAYS = 3650
SWEEP_EVERY_SECONDS = 6 * 3600
WORKING_FOLDER_SECONDS = 24 * 3600


async def days() -> int:
    async with db.connect() as conn:
        row = await (await conn.execute("SELECT value FROM app_settings WHERE key = %s", (KEY,))).fetchone()
    return int(row["value"]) if row else DEFAULT_DAYS


def sweep_folders(keep_days: int, today: date, now: float) -> int:
    """Delete what is past its time; returns how many folders went. A folder that cannot go is logged and skipped."""
    root, cutoff, removed = team_access.OUTPUT_DIR / "interpret", today - timedelta(days=keep_days), 0
    if not root.is_dir():
        return 0
    for owner in root.iterdir():
        if not owner.is_dir():
            continue
        for folder in owner.iterdir():
            if not folder.is_dir():
                continue
            if interpret.SESSION_ID.fullmatch(folder.name):
                try:
                    old = datetime.strptime(folder.name[:8], "%Y%m%d").date() < cutoff
                except ValueError:
                    continue
            elif folder.name.startswith(".recording-"):
                try:
                    old = now - folder.stat().st_mtime > WORKING_FOLDER_SECONDS
                except OSError:   # renamed into a record while the sweep ran
                    continue
            else:
                continue
            if old:
                try:
                    shutil.rmtree(folder)
                    removed += 1
                except OSError as error:
                    logger.warning("records retention: %s not removed: %s", folder.name, type(error).__name__)
    return removed


async def sweep() -> int:
    keep = await days()
    today = datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE)).date()
    removed = await asyncio.to_thread(sweep_folders, keep, today, time.time())
    if removed:
        logger.info("records retention: %d record folder(s) older than %d days removed", removed, keep)
    return removed


async def worker() -> None:
    while True:
        try:
            await sweep()
        except Exception as error:   # noqa: BLE001 - the database is down: try again at the next round
            logger.warning("records retention: sweep failed: %s", type(error).__name__)
        await asyncio.sleep(SWEEP_EVERY_SECONDS)


class Retention(BaseModel):
    days: StrictInt


@router.get("/api/admin/records-retention")
async def get_retention(_admin: team_access.Admin):
    return {"days": await days()}


@router.put("/api/admin/records-retention")
async def set_retention(body: Retention, admin: team_access.Admin):
    if not 1 <= body.days <= MAX_DAYS:
        raise HTTPException(status_code=422, detail=f"保存天數要在 1 到 {MAX_DAYS} 之間")
    async with db.connect() as conn:
        await conn.execute("INSERT INTO app_settings (key, value, updated_by) VALUES (%s, %s, %s) "
                           "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
                           (KEY, Jsonb(body.days), admin.username))
    await sweep()
    return {"days": body.days}
