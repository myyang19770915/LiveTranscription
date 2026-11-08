"""Full-text search (meeting-search): transcript segments (original or translation), minutes items (proposed or
confirmed, board items included) and meeting topics of the user's teams. Terms are substrings matched with ILIKE
(pg_trgm indexes, migration 010), all terms in the same field; results are grouped by meeting, newest first.
"""
from datetime import date

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

import auth
import db
import team_access

router = APIRouter()
QUERY_MAX = 100
MAX_TERMS = 5
LIMIT = 300
KINDS = ("all", "segments", "items", "meetings")
EMPTY_QUERY = "請輸入要搜尋的字"
SERIES_NOT_FOUND = "找不到這個系列"


def terms_of(q: str) -> list[str]:
    return q.split()


def too_many_terms(count: int) -> str:
    """The message for a query over MAX_TERMS terms; search.js shows the same words before sending."""
    return f"搜尋詞最多 {MAX_TERMS} 個（目前 {count} 個），請刪減後再搜尋"


def all_terms(column: str, terms: list[str]) -> str:
    """SQL requiring every term (parameters %(t0)s…) in column."""
    return "(" + " AND ".join(f"{column} ILIKE %(t{n})s ESCAPE '\\'" for n in range(len(terms))) + ")"


@router.get("/search")
async def search_page(user: auth.CurrentUser):
    return FileResponse(auth.STATIC_DIR / "search.html", headers={"Cache-Control": "no-cache"})


@router.get("/api/search")
async def search(user: auth.CurrentUser, q: str = Query("", max_length=QUERY_MAX * 4), team: int | None = None, series: int | None = None,
                 start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"), kind: str = "all"):
    # The length counts after trimming; the Query bound only stops absurd inputs.
    if len(q.strip()) > QUERY_MAX:
        raise HTTPException(status_code=422, detail=f"搜尋字最多 {QUERY_MAX} 個字")
    terms = terms_of(q.strip())
    if not terms:
        raise HTTPException(status_code=422, detail=EMPTY_QUERY)
    if len(terms) > MAX_TERMS:   # rejected, never cut: the user would think every term was matched
        raise HTTPException(status_code=422, detail=too_many_terms(len(terms)))
    if kind not in KINDS:
        raise HTTPException(status_code=422, detail="不支援的類型")
    # One more than the cap per kind, so a single kind over the cap is still reported as truncated.
    params = {"user": user.username, "tz": team_access.MEETING_TIMEZONE, "limit": LIMIT + 1,
              **{f"t{n}": team_access.like_pattern(term) for n, term in enumerate(terms)}}
    # Shared meeting filters (m = meetings); a board item (no meeting) is filtered by its own team, series and creation.
    meeting_where = ["tm.username = %(user)s"]
    item_scope = ["tm.username = %(user)s"]
    async with db.connect() as conn:
        if team is not None:
            if not await team_access.is_member(conn, user.username, team):
                raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
            params["team"] = team
            meeting_where.append("m.team_id = %(team)s")
            item_scope.append("i.team_id = %(team)s")
        if series is not None:
            row = await (await conn.execute(
                "SELECT s.team_id FROM meeting_series s JOIN team_members tm ON tm.team_id = s.team_id AND tm.username = %s WHERE s.id = %s",
                (user.username, series))).fetchone()
            if row is None or (team is not None and row["team_id"] != team):
                raise HTTPException(status_code=404, detail=SERIES_NOT_FOUND)
            params["series"] = series
            meeting_where.append("m.series_id = %(series)s")
            item_scope.append("coalesce(m.series_id, i.series_id) = %(series)s")
        for bound, op, value in (("start", ">=", start), ("end", "<=", end)):
            if value:
                params[bound] = value
                meeting_where.append(f"(m.started_at AT TIME ZONE %(tz)s)::date {op} %({bound})s")
                item_scope.append(f"(coalesce(m.started_at, i.confirmed_at) AT TIME ZONE %(tz)s)::date {op} %({bound})s")
        meetings_sql = " AND ".join(meeting_where)
        hits: list[dict] = []
        if kind in ("all", "segments"):
            rows = await (await conn.execute(
                "SELECT s.meeting_id, s.seq, s.start_ms, s.source, s.target, m.started_at AS at FROM segments s "
                "JOIN meetings m ON m.id = s.meeting_id JOIN team_members tm ON tm.team_id = m.team_id "
                f"WHERE {meetings_sql} AND ({all_terms('s.source', terms)} OR {all_terms('s.target', terms)}) "
                "ORDER BY m.started_at DESC, s.seq LIMIT %(limit)s", params)).fetchall()
            hits += [{"meeting": r["meeting_id"], "at": r["at"], "order": (0, r["seq"]),
                      "hit": {"type": "segment", "seq": r["seq"], "startMs": r["start_ms"], "source": r["source"], "target": r["target"]}} for r in rows]
        if kind in ("all", "items"):
            rows = await (await conn.execute(
                "SELECT i.id, i.meeting_id, i.team_id, i.kind, i.content, i.state, i.status, coalesce(m.started_at, i.confirmed_at) AS at "
                "FROM minute_items i LEFT JOIN meetings m ON m.id = i.meeting_id JOIN team_members tm ON tm.team_id = i.team_id "
                f"WHERE {' AND '.join(item_scope)} AND i.state IN ('proposed', 'confirmed') AND {all_terms('i.content', terms)} "
                "ORDER BY at DESC, i.id LIMIT %(limit)s", params)).fetchall()
            hits += [{"meeting": r["meeting_id"], "board": None if r["meeting_id"] else r["team_id"], "at": r["at"], "order": (1, r["id"]),
                      "hit": {"type": "item", "id": r["id"], "kind": r["kind"], "content": r["content"], "state": r["state"],
                              "status": r["status"] if r["kind"] == "action" and r["state"] == "confirmed" else None}} for r in rows]
        if kind in ("all", "meetings"):
            rows = await (await conn.execute(
                "SELECT m.id, m.started_at AS at FROM meetings m JOIN team_members tm ON tm.team_id = m.team_id "
                f"WHERE {meetings_sql} AND {all_terms('m.title', terms)} ORDER BY m.started_at DESC LIMIT %(limit)s", params)).fetchall()
            hits += [{"meeting": r["id"], "at": r["at"], "order": (-1, 0), "hit": {"type": "title"}} for r in rows]

        # Newest first; within a meeting the topic, then segments in order, then items.
        hits.sort(key=lambda h: (-h["at"].timestamp(), str(h["meeting"] or ""), h.get("board") or 0, h["order"]))
        truncated = len(hits) > LIMIT
        hits = hits[:LIMIT]
        ids = sorted({h["meeting"] for h in hits if h["meeting"]}, key=str)
        info = {r["id"]: r for r in await (await conn.execute(
            "SELECT m.id, m.title, m.started_at, t.name AS team, ms.name AS series FROM meetings m JOIN teams t ON t.id = m.team_id "
            "LEFT JOIN meeting_series ms ON ms.id = m.series_id WHERE m.id = ANY(%s)", (ids,))).fetchall()} if ids else {}
        boards = {r["id"]: r["name"] for r in await (await conn.execute(
            "SELECT id, name FROM teams WHERE id = ANY(%s)", (sorted({h["board"] for h in hits if h.get("board")}),))).fetchall()}

    groups: list[dict] = []
    for h in hits:
        key = h["meeting"] or f"board-{h['board']}"
        if not groups or groups[-1]["key"] != key:
            if h["meeting"]:
                m = info[h["meeting"]]
                groups.append({"key": key, "meetingId": str(m["id"]), "title": m["title"] or None, "startedAt": m["started_at"].isoformat(),
                               "team": m["team"], "series": m["series"], "hits": []})
            else:
                groups.append({"key": key, "meetingId": None, "title": None, "startedAt": None, "team": boards[h["board"]], "series": None, "hits": []})
        groups[-1]["hits"].append(h["hit"])
    # A board group may be split by the time order; merge the pieces so each source is listed once.
    merged: dict[str, dict] = {}
    for g in groups:
        if g["key"] in merged:
            merged[g["key"]]["hits"] += g["hits"]
        else:
            merged[g["key"]] = g
    return {"query": q.strip(), "terms": terms, "total": len(hits), "truncated": truncated,
            "groups": [{k: v for k, v in g.items() if k != "key"} for g in merged.values()]}
