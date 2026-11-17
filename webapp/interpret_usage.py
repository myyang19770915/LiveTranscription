"""How much translated audio came back from Azure GPT-Realtime-Translate, and what it costs (realtime-interpret).

The 即時口譯 page is billed by the length of the translated speech (Global Output, USD per hour). Each finished
session adds its seconds to one row per date and purpose; nothing else is kept. The cost is an estimate
(seconds x price), not the bill, and it is not part of the MAI budget (mai-usage).

Usage outside the app (the lab test bench) is entered by hand, in the app container:
    python -m interpret_usage add <seconds> <purpose>      python -m interpret_usage
"""
import asyncio
import logging
import math
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter

import db
import mai_usage
import team_access

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
USD_PER_HOUR = float(os.getenv("INTERPRET_USD_PER_HOUR", "") or 2.04)


def cost(seconds: float) -> float:
    return round(seconds / 3600 * USD_PER_HOUR, 2)


async def record(purpose: str, seconds: float) -> float:
    """Add to today's row of this purpose; returns the seconds recorded in all rows."""
    if not mai_usage.PURPOSE.fullmatch(purpose) or not (math.isfinite(seconds) and seconds > 0):
        raise ValueError("purpose: 1-40 of a-z, 0-9 and '-'; seconds: more than 0")
    today = datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE)).date()
    async with db.connect() as conn:
        await conn.execute("INSERT INTO interpret_usage (day, purpose, seconds) VALUES (%s, %s, %s) "
                           "ON CONFLICT (day, purpose) DO UPDATE SET seconds = interpret_usage.seconds + EXCLUDED.seconds",
                           (today, purpose, seconds))
        return (await (await conn.execute("SELECT coalesce(sum(seconds), 0) AS seconds FROM interpret_usage")).fetchone())["seconds"]


async def add(purpose: str, seconds: float) -> bool:
    """record() for a session: saving the session goes on whatever happens here."""
    if not seconds > 0:
        return True
    try:
        await record(purpose, seconds)
        return True
    except Exception as error:   # the database is down, or the table is not there yet
        logger.warning("interpret usage not recorded (%.1f s, %s): %s", seconds, purpose, type(error).__name__)
        return False


async def summary() -> dict:
    async with db.connect() as conn:
        rows = await (await conn.execute("SELECT purpose, sum(seconds) AS seconds FROM interpret_usage GROUP BY purpose ORDER BY purpose")).fetchall()
    seconds = sum(row["seconds"] for row in rows)
    return {"seconds": round(seconds, 1), "usd": cost(seconds), "usdPerHour": USD_PER_HOUR,
            "byPurpose": {row["purpose"]: round(row["seconds"], 1) for row in rows}}


@router.get("/api/admin/interpret-usage")
async def usage(_admin: team_access.Admin):
    return await summary()


def main(argv: list[str]) -> int:
    async def run() -> int:
        await db.check()
        if argv[:1] == ["add"] and len(argv) == 3:
            try:
                await record(argv[2], float(argv[1]))
            except ValueError as error:
                print(error, file=sys.stderr)
                return 2
        elif argv:
            print(__doc__, file=sys.stderr)
            return 2
        total = await summary()
        print(f"{total['seconds'] / 3600:.2f} h of translated audio from GPT-Realtime-Translate, about {total['usd']:.2f} USD "
              f"({total['usdPerHour']} USD per hour); by purpose (seconds): {total['byPurpose']}")
        return 0
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
