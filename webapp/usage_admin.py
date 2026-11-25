"""The usage management page and its figures (usage-admin).

Two paid services are recorded by the length of audio: cloud recognition (mai_usage) and realtime interpreting
(interpret_usage). This module adds them up for administrators by month, day, purpose and user, and keeps the
budget of each service (app_settings, key usage_budgets). Every amount is an estimate (seconds x the current price),
not the bill, and reaching a budget disables nothing.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, StrictFloat, StrictInt

import auth
import db
import interpret_usage
import mai_usage
import team_access

router = APIRouter()
SERVICES = (("mai", mai_usage), ("interpret", interpret_usage))   # in the order the page shows them
DAYS, MONTHS = 30, 6
MAX_BUDGET_USD = 1_000_000
BUDGET_RULE = "上限要是大於 0 的金額，留空表示不設上限"


def today() -> date:
    return datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE)).date()


def month_of(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def last_months(day: date, count: int) -> list[str]:
    """The `count` calendar months ending with the month of `day`, oldest first."""
    months, first = [], day.replace(day=1)
    for _ in range(count):
        months.append(month_of(first))
        first = (first - timedelta(days=1)).replace(day=1)
    return months[::-1]


def ranked(seconds: dict[str, float], in_month: dict[str, float], name: str) -> list[dict]:
    return [{name: key, "seconds": round(value, 1), "monthSeconds": round(in_month.get(key, 0), 1)}
            for key, value in sorted(seconds.items(), key=lambda item: (-item[1], item[0]))]


async def figures(day: date) -> dict:
    budgets = await mai_usage.budgets()
    month, months = month_of(day), last_months(day, MONTHS)
    previous = months[-2]
    days = [(day - timedelta(days=back)).isoformat() for back in range(DAYS - 1, -1, -1)]
    daily = {iso: {"day": iso, "mai": 0.0, "interpret": 0.0} for iso in days}
    monthly = {name: {"month": name, "mai": 0.0, "interpret": 0.0} for name in months}
    services = []
    async with db.connect() as conn:
        for key, module in SERVICES:
            user = "username" if key == "interpret" else "'' AS username"
            rows = await (await conn.execute(f"SELECT day, purpose, {user}, seconds FROM {key}_usage")).fetchall()
            total = in_month = before = 0.0
            purposes, purposes_month = defaultdict(float), defaultdict(float)
            users, users_month = defaultdict(float), defaultdict(float)
            for row in rows:
                seconds, name = row["seconds"], month_of(row["day"])
                total += seconds
                purposes[row["purpose"]] += seconds
                users[row["username"]] += seconds
                if name == month:
                    in_month += seconds
                    purposes_month[row["purpose"]] += seconds
                    users_month[row["username"]] += seconds
                elif name == previous:
                    before += seconds
                if name in monthly:
                    monthly[name][key] += seconds
                if row["day"].isoformat() in daily:
                    daily[row["day"].isoformat()][key] += seconds
            usd = module.cost(total)
            services.append({
                "key": key, "usdPerHour": module.USD_PER_HOUR, "budgetUsd": budgets[key], "state": mai_usage.state(usd, budgets[key]),
                "total": {"seconds": round(total, 1), "usd": usd},
                "month": {"seconds": round(in_month, 1), "usd": module.cost(in_month)},
                "previousMonth": {"seconds": round(before, 1), "usd": module.cost(before)},
                "byPurpose": ranked(purposes, purposes_month, "purpose"),
                "byUser": ranked(users, users_month, "username") if key == "interpret" else []})
    rounded = lambda entry: {name: round(value, 1) if isinstance(value, float) else value for name, value in entry.items()}   # noqa: E731
    return {"today": day.isoformat(), "month": month, "services": services,
            "daily": [rounded(daily[iso]) for iso in days], "months": [rounded(monthly[name]) for name in months]}


@router.get("/admin/usage")
async def usage_page(user: auth.CurrentUser):
    if not user.admin:
        return HTMLResponse(team_access.FORBIDDEN_PAGE, status_code=403)
    return FileResponse(auth.STATIC_DIR / "usage.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/admin/usage")
async def usage(_admin: team_access.Admin):
    return await figures(today())


class Budgets(BaseModel):
    mai: StrictFloat | StrictInt | None
    interpret: StrictFloat | StrictInt | None


@router.put("/api/admin/usage/budgets")
async def set_budgets(body: Budgets, admin: team_access.Admin):
    budgets = {"mai": body.mai, "interpret": body.interpret}
    # The comparison also refuses NaN and infinity, and an integer of any size.
    if any(value is not None and not 0 < value <= MAX_BUDGET_USD for value in budgets.values()):
        raise HTTPException(status_code=422, detail=BUDGET_RULE)
    async with db.connect() as conn:
        await conn.execute("INSERT INTO app_settings (key, value, updated_by) VALUES (%s, %s, %s) "
                           "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
                           (mai_usage.BUDGETS_KEY, Jsonb(budgets), admin.username))
    return budgets
