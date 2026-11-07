"""Outcome metrics of the closed meeting loop (outcome-metrics): action completion, overdue and on-time rates,
time from a meeting's end to the first confirmed item, how AI extraction is used, a 12-week trend, and how much
transcripts are corrected. Computed on request over the user's teams (or one of them) for the last N days,
dates judged in MEETING_TIMEZONE. A rate is a fraction, or None when its denominator is 0.
"""
import asyncio
import statistics
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import auth
import db
import minutes
import team_access

router = APIRouter()
WEEKS = 12
PERIODS = (30, 90, 365)
OPEN = list(minutes.OPEN_STATUSES)


def rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def edit_distance(a: str, b: str) -> int:
    """Levenshtein distance in characters (insert, delete, substitute)."""
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def transcript_groups(segments: list[dict]) -> dict[tuple, dict]:
    """Per (engine, language): meetings, segments, corrected segments, recognised characters, edited characters."""
    groups: dict[tuple, dict] = {}
    for s in segments:
        g = groups.setdefault((s["engine"], s["language"]), {"meetings": set(), "segments": 0, "editedSegments": 0, "chars": 0, "editedChars": 0})
        g["meetings"].add(s["id"])
        g["segments"] += 1
        g["chars"] += s["chars"]
        if s["changed"]:
            g["editedSegments"] += 1
            g["editedChars"] += edit_distance(s["asr_text"], s["source"])
    return groups


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


@router.get("/metrics")
async def metrics_page(user: auth.CurrentUser):
    return FileResponse(auth.STATIC_DIR / "metrics.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/metrics")
async def get_metrics(user: auth.CurrentUser, team: int | None = None, days: int = 30):
    if days not in PERIODS:
        raise HTTPException(status_code=422, detail="期間只能是 30、90 或 365 天")
    today = minutes.local_today()
    start = today - timedelta(days=days - 1)
    first_week = week_start(today) - timedelta(weeks=WEEKS - 1)
    tz = team_access.MEETING_TIMEZONE
    async with db.connect() as conn:
        teams = await (await conn.execute(
            "SELECT t.id, t.name FROM teams t JOIN team_members m ON m.team_id = t.id AND m.username = %s ORDER BY t.name",
            (user.username,))).fetchall()
        if team is not None and team not in {t["id"] for t in teams}:
            raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
        scope = [team] if team is not None else [t["id"] for t in teams]
        local = lambda column: f"({column} AT TIME ZONE %(tz)s)::date"  # noqa: E731
        p = {"teams": scope, "tz": tz, "start": start, "today": today, "open": OPEN, "first_week": first_week}

        actions = await (await conn.execute(
            "SELECT status, due_date, " + local("confirmed_at") + " AS created_on, " + local("status_at") + " AS status_on "
            "FROM minute_items WHERE kind = 'action' AND state = 'confirmed' AND team_id = ANY(%(teams)s)", p)).fetchall()
        lags = await (await conn.execute(
            "SELECT extract(epoch FROM min(i.confirmed_at) - m.ended_at) / 3600 AS hours FROM meetings m "
            "JOIN minute_items i ON i.meeting_id = m.id AND i.confirmed_at IS NOT NULL "
            "WHERE m.team_id = ANY(%(teams)s) AND m.ended_at IS NOT NULL AND " + local("m.ended_at") + " BETWEEN %(start)s AND %(today)s "
            "GROUP BY m.id, m.ended_at", p)).fetchall()
        ai = await (await conn.execute(
            "SELECT i.state, i.edited FROM minute_items i JOIN meetings m ON m.id = i.meeting_id "
            "WHERE i.origin = 'ai' AND m.team_id = ANY(%(teams)s) AND " + local("m.started_at") + " BETWEEN %(start)s AND %(today)s", p)).fetchall()
        # Text only for corrected segments; the edit distances are computed off the event loop (live transcription
        # shares this process).
        segments = await (await conn.execute(
            "SELECT m.id, m.engine, m.language, length(s.asr_text) AS chars, s.asr_text <> s.source AS changed, "
            "CASE WHEN s.asr_text <> s.source THEN s.asr_text END AS asr_text, CASE WHEN s.asr_text <> s.source THEN s.source END AS source "
            "FROM segments s JOIN meetings m ON m.id = s.meeting_id "
            "WHERE m.team_id = ANY(%(teams)s) AND " + local("m.started_at") + " BETWEEN %(start)s AND %(today)s ORDER BY m.engine, m.language", p)).fetchall()
        since = await (await conn.execute("SELECT applied_at FROM schema_migrations WHERE version = 9")).fetchone()

    in_period = lambda day: day is not None and start <= day <= today  # noqa: E731
    created = [a for a in actions if in_period(a["created_on"]) and a["status"] != "cancelled"]
    open_due = [a for a in actions if a["status"] in OPEN and a["due_date"]]
    finished = [a for a in actions if a["status"] == "done" and in_period(a["status_on"]) and a["due_date"]]
    done_count = sum(a["status"] == "done" for a in created)
    overdue = sum(a["due_date"] < today for a in open_due)
    on_time = sum(a["status_on"] <= a["due_date"] for a in finished)

    weekly = {first_week + timedelta(weeks=n): {"created": 0, "done": 0} for n in range(WEEKS)}
    for a in actions:
        if a["created_on"] and week_start(a["created_on"]) in weekly:
            weekly[week_start(a["created_on"])]["created"] += 1
        if a["status"] == "done" and a["status_on"] and week_start(a["status_on"]) in weekly:
            weekly[week_start(a["status_on"])]["done"] += 1

    hours = [max(0.0, float(row["hours"])) for row in lags]
    groups = await asyncio.to_thread(transcript_groups, segments)

    return {
        "days": days, "from": start.isoformat(), "to": today.isoformat(), "teams": [{"id": t["id"], "name": t["name"]} for t in teams],
        "actions": {"created": len(created), "done": done_count, "cancelled": sum(a["status"] == "cancelled" and in_period(a["created_on"]) for a in actions),
                    "completionRate": rate(done_count, len(created)),
                    "open": sum(a["status"] in OPEN for a in actions), "openWithDue": len(open_due), "overdue": overdue,
                    "overdueRate": rate(overdue, len(open_due)),
                    "finishedWithDue": len(finished), "onTime": on_time, "onTimeRate": rate(on_time, len(finished))},
        "minutesLag": {"meetings": len(hours), "medianHours": round(statistics.median(hours), 2) if hours else None},
        "ai": {"adopted": sum(r["state"] == "confirmed" and not r["edited"] for r in ai),
               "edited": sum(r["state"] == "confirmed" and r["edited"] for r in ai),
               "rejected": sum(r["state"] == "rejected" for r in ai), "pending": sum(r["state"] == "proposed" for r in ai)},
        "weekly": [{"week": week.isoformat(), **counts} for week, counts in weekly.items()],
        "transcript": [{"engine": engine, "language": language, "meetings": len(g["meetings"]), "segments": g["segments"],
                        "editedSegments": g["editedSegments"], "chars": g["chars"], "editedChars": g["editedChars"],
                        "per100": round(g["editedChars"] / g["chars"] * 100, 1) if g["chars"] else None}
                       for (engine, language), g in groups.items()],
        "editedSince": since["applied_at"].isoformat() if since else None,
    }
