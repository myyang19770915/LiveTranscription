"""How much audio went to Azure MAI, and what it costs (mai-usage).

MAI is billed by the length of audio sent. Every connection that sends audio there counts its bytes with a Meter;
the seconds are added to one row per date and purpose. Only seconds are kept: no meeting, user or text.
The cost is an estimate (seconds x price), not the bill. Reaching the budget never disables MAI: administrators
see it on the team page and decide.

Usage outside the app (benchmark scripts that talk to MAI directly) is entered by hand, in the app container:
    python -m mai_usage add <seconds> <purpose>      python -m mai_usage
"""
import asyncio
import logging
import math
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter

import db
import team_access

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
USD_PER_HOUR = float(os.getenv("MAI_USD_PER_HOUR", "") or 0.54)
BUDGET_USD = float(os.getenv("MAI_BUDGET_USD", "") or 50)
NEAR = 0.8                      # of the budget
BYTES_PER_SECOND = 32000        # 16 kHz PCM16 mono
WRITE_EVERY = 300               # seconds of audio a connection may hold before writing them down
PURPOSE = re.compile(r"[a-z0-9-]{1,40}")
_told: set[str] = set()         # the states already logged by this process
_writing: set[asyncio.Task] = set()


def cost(seconds: float) -> float:
    """In USD, to the cent: the figure shown and the figure the state is judged by are the same."""
    return round(seconds / 3600 * USD_PER_HOUR, 2)


def state(usd: float) -> str:
    return "over" if usd >= BUDGET_USD else "near" if usd >= NEAR * BUDGET_USD else "ok"


async def record(purpose: str, seconds: float) -> float:
    """Add to today's row of this purpose; returns the seconds recorded in all rows."""
    if not PURPOSE.fullmatch(purpose) or not (math.isfinite(seconds) and seconds > 0):   # an infinite entry could never be summed again
        raise ValueError("purpose: 1-40 of a-z, 0-9 and '-'; seconds: more than 0")
    today = datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE)).date()
    async with db.connect() as conn:
        await conn.execute("INSERT INTO mai_usage (day, purpose, seconds) VALUES (%s, %s, %s) "
                           "ON CONFLICT (day, purpose) DO UPDATE SET seconds = mai_usage.seconds + EXCLUDED.seconds", (today, purpose, seconds))
        return (await (await conn.execute("SELECT coalesce(sum(seconds), 0) AS seconds FROM mai_usage")).fetchone())["seconds"]


async def add(purpose: str, seconds: float) -> None:
    """record() for a connection: recognition goes on whatever happens here, and the budget is announced once."""
    if not seconds > 0:
        return
    try:
        usd = cost(await record(purpose, seconds))
    except Exception as error:   # the database is down, or the table is not there yet
        logger.warning("MAI usage not recorded (%.0f s, %s): %s", seconds, purpose, type(error).__name__)
        return
    now = state(usd)
    if now != "ok" and now not in _told:
        _told.add(now)
        logger.warning("MAI usage is %s the budget: about %.2f USD of %.2f USD (estimate from audio sent)",
                       "at or over" if now == "over" else "at 80% of", usd, BUDGET_USD)


class Meter:
    """Counts the audio one connection sends to MAI and writes it down every WRITE_EVERY seconds and at the end."""

    def __init__(self, purpose: str):
        self.purpose, self.unwritten = purpose, 0

    def _take(self) -> float:
        seconds, self.unwritten = self.unwritten / BYTES_PER_SECOND, 0
        return seconds

    def count(self, size: int) -> None:
        self.unwritten += size
        if self.unwritten >= WRITE_EVERY * BYTES_PER_SECOND:
            self.finish_soon()

    def finish_soon(self) -> None:
        """For places that cannot wait (a cancelled stream): the write runs on its own."""
        if self.unwritten:
            task = asyncio.ensure_future(add(self.purpose, self._take()))
            _writing.add(task)
            task.add_done_callback(_writing.discard)

    async def finish(self) -> None:
        await add(self.purpose, self._take())


async def summary() -> dict:
    async with db.connect() as conn:
        rows = await (await conn.execute("SELECT purpose, sum(seconds) AS seconds FROM mai_usage GROUP BY purpose ORDER BY purpose")).fetchall()
    seconds = sum(row["seconds"] for row in rows)
    return {"seconds": round(seconds, 1), "usd": cost(seconds), "budgetUsd": BUDGET_USD, "usdPerHour": USD_PER_HOUR,
            "state": state(cost(seconds)), "byPurpose": {row["purpose"]: round(row["seconds"], 1) for row in rows}}


@router.get("/api/admin/mai-usage")
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
        print(f"{total['seconds'] / 3600:.2f} h of audio sent to MAI, about {total['usd']:.2f} USD of a {total['budgetUsd']:.2f} USD budget "
              f"({total['state']}); by purpose (seconds): {total['byPurpose']}")
        return 0
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
