"""Due-date reminders (action-reminders): once a day, after REMIND_AT in MEETING_TIMEZONE, the owner of every open
action item gets an e-mail while the item is due in one to three days (once per due date), on its due date (once),
and every day while it is overdue. One mail per owner per run. Reminders can be switched off per item
(minute_items.remind) by its owner or an administrator.

Every reminder sent is kept in reminder_log: a run first claims the reminders it is about to send, so two runs never
send the same one, and a failed send gives its claims back so the next run retries.
Run inside the app container:
    python -m reminders run [--today YYYY-MM-DD]   send today's reminders now
"""
import argparse
import asyncio
import html
import logging
import os
import re
from datetime import date, datetime, time, timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from zoneinfo import ZoneInfo

import db
import mailer
import minutes
import team_access

DAYS_BEFORE = 3
STATUS_LABEL = {"todo": "未開始", "doing": "進行中"}
logger = logging.getLogger("uvicorn.error")


def remind_at(value: str) -> time:
    match = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", value.strip())
    if not match:
        logger.error("REMIND_AT %r is not HH:MM; reminders go out at 09:00", value)
        return time(9, 0)
    return time(int(match.group(1)), int(match.group(2)))


REMIND_AT = remind_at(os.getenv("REMIND_AT", "") or "09:00")


def reminder_kind(due: date, today: date) -> tuple[str, date] | None:
    """(kind, day) of the reminder an item due on `due` gets today, or None. day is the reminder_log key: the due
    date for 'soon' and 'due' (once per due date), today for 'overdue' (once a day)."""
    if due < today:
        return "overdue", today
    if due == today:
        return "due", due
    if (due - today).days <= DAYS_BEFORE:
        return "soon", due
    return None


def next_run(now: datetime) -> datetime:
    """The next REMIND_AT after now, in now's time zone."""
    at = datetime.combine(now.date(), REMIND_AT, tzinfo=now.tzinfo)
    return at if at > now else datetime.combine(now.date() + timedelta(days=1), REMIND_AT, tzinfo=now.tzinfo)


# --- Choosing and claiming -------------------------------------------------------------------------

async def candidates(conn, today: date) -> list[dict]:
    """Open, confirmed action items with reminders on, due within DAYS_BEFORE days or earlier, whose owner is still a
    member of the item's team and has an address."""
    return await (await conn.execute(
        "SELECT i.id, i.content, i.due_date, i.status, i.owner, i.meeting_id, t.name AS team, m.title AS meeting_title, "
        "m.started_at, u.email, coalesce(nullif(u.display_name, ''), i.owner) AS owner_name "
        "FROM minute_items i JOIN teams t ON t.id = i.team_id "
        "JOIN team_members tm ON tm.team_id = i.team_id AND tm.username = i.owner "
        "JOIN users u ON u.username = i.owner LEFT JOIN meetings m ON m.id = i.meeting_id "
        "WHERE i.kind = 'action' AND i.state = 'confirmed' AND i.status IN ('todo', 'doing') AND i.remind "
        "AND i.due_date IS NOT NULL AND i.due_date <= %s AND u.email IS NOT NULL "
        "ORDER BY i.owner, i.due_date, i.id", (today + timedelta(days=DAYS_BEFORE),))).fetchall()


async def claim(conn, item: dict, kind: str, day: date) -> bool:
    row = await (await conn.execute(
        "INSERT INTO reminder_log (item_id, kind, day, owner, due_date) VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT DO NOTHING RETURNING item_id", (item["id"], kind, day, item["owner"], item["due_date"]))).fetchone()
    return row is not None


# --- The message -----------------------------------------------------------------------------------

GROUPS = (("overdue", "逾期"), ("due", "今天到期"), ("soon", f"{DAYS_BEFORE} 天內到期"))


def board_link(item: dict) -> str:
    return f"{mailer.PUBLIC_BASE_URL}/actions?item={item['id']}" if mailer.PUBLIC_BASE_URL else ""


def source(item: dict) -> str:
    if not item["meeting_id"]:
        return f"{item['team']}・看板新增"
    title = minutes.display_title({"title": item["meeting_title"], "started_at": item["started_at"]})
    return f"{item['team']}・{title}"


def due_phrase(item: dict, kind: str, today: date) -> str:
    due = item["due_date"]
    if kind == "overdue":
        return f"到期 {due.month}/{due.day}（逾期 {(today - due).days} 天）"
    if kind == "due":
        return f"今天到期（{due.month}/{due.day}）"
    return f"到期 {due.month}/{due.day}（還有 {(due - today).days} 天）"


def subject(groups: dict) -> str:
    counts = "、".join(f"{label} {len(groups[kind])} 件" for kind, label in GROUPS if groups.get(kind))
    return f"[語橋 Live] 待辦提醒：{counts}"


def compose(owner: dict, groups: dict, today: date) -> EmailMessage:
    """One mail for one owner; groups: kind -> items, overdue ones longest overdue first."""
    e = html.escape
    text = [f"{owner['owner_name']} 您好，以下待辦需要留意：", ""]
    page = [f'<p style="margin:0 0 12px">{e(owner["owner_name"])} 您好，以下待辦需要留意：</p>']
    for kind, label in GROUPS:
        items = groups.get(kind)
        if not items:
            continue
        text += [f"■ {label}（{len(items)}）"]
        rows = []
        for item in items:
            details = f"{due_phrase(item, kind, today)}・{STATUS_LABEL[item['status']]}・{source(item)}"
            link = board_link(item)
            text += [f"- {item['content']}", f"  {details}"] + ([f"  {link}"] if link else [])
            rows.append(f'<li style="margin:0 0 8px">{e(item["content"])}<br><span style="color:#666">{e(details)}</span>'
                        + (f' <a href="{e(link)}">在看板開啟</a>' if link else "") + "</li>")
        text.append("")
        color = "#c62828" if kind == "overdue" else "#222"
        page.append(f'<h2 style="font-size:16px;margin:16px 0 6px;color:{color}">{label}（{len(items)}）</h2>'
                    f'<ul style="margin:0;padding-left:20px">{"".join(rows)}</ul>')
    footer = "不想再收到某件事的提醒：在待辦看板打開該事項，按「關閉提醒」；完成或取消的待辦不會再提醒。"
    text.append(footer)
    page.append(f'<p style="color:#999;font-size:12px;margin:20px 0 0">{footer}</p>')
    message = EmailMessage()
    message["Subject"] = subject(groups)
    message["From"] = mailer.sender()
    message["To"] = owner["email"]
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=mailer.sender().rpartition("@")[2] or None)
    message.set_content("\n".join(text) + "\n")
    message.add_alternative('<!doctype html><html><body style="font-family:sans-serif;font-size:14px;color:#222;line-height:1.6">'
                            + "".join(page) + "</body></html>", subtype="html")
    return message


# --- Running ---------------------------------------------------------------------------------------

async def run(today: date | None = None) -> dict:
    """Send today's reminders; returns {"owners", "items", "failed"} (owners mailed, items reminded, owners whose
    mail failed). Without a mail server nothing is sent."""
    today = today or minutes.local_today()
    result = {"owners": 0, "items": 0, "failed": 0}
    if not mailer.configured():
        return result
    async with db.connect() as conn:
        claimed: dict[str, dict] = {}
        for item in await candidates(conn, today):
            found = reminder_kind(item["due_date"], today)
            if found and await claim(conn, item, *found):
                entry = claimed.setdefault(item["owner"], {"owner": item, "groups": {}, "claims": []})
                entry["groups"].setdefault(found[0], []).append(item)
                entry["claims"].append((item["id"], *found))
    for owner, entry in claimed.items():
        groups = entry["groups"]
        groups.get("overdue", []).sort(key=lambda i: (i["due_date"], i["id"]))
        error = await mailer.deliver(compose(entry["owner"], groups, today))
        if error:
            logger.warning("reminder mail to %s failed, retried on the next run: %s", owner, error)
            async with db.connect() as conn:
                for item_id, kind, day in entry["claims"]:
                    await conn.execute("DELETE FROM reminder_log WHERE item_id = %s AND kind = %s AND day = %s", (item_id, kind, day))
            result["failed"] += 1
        else:
            result["owners"] += 1
            result["items"] += len(entry["claims"])
    return result


async def worker() -> None:
    """Run once at start-up when today's REMIND_AT has passed (the reminders that day are still due), then every
    day at REMIND_AT. A failure is logged and the next day runs as usual."""
    zone = ZoneInfo(team_access.MEETING_TIMEZONE)
    logger.info("action reminders at %s (%s) every day", REMIND_AT.strftime("%H:%M"), team_access.MEETING_TIMEZONE)
    now = datetime.now(zone)
    due_now = now >= datetime.combine(now.date(), REMIND_AT, tzinfo=zone)
    while True:
        if due_now:
            try:
                result = await run()
                if result["owners"] or result["failed"]:
                    logger.info("action reminders: %s", result)
            except Exception:   # noqa: BLE001 - the worker must survive a bad day
                logger.exception("action reminders failed")
        now = datetime.now(zone)
        await asyncio.sleep(max(1.0, (next_run(now) - now).total_seconds()))
        due_now = True


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m reminders")
    sub = parser.add_subparsers(dest="command", required=True)
    once = sub.add_parser("run", help="send today's reminders now")
    once.add_argument("--today", type=date.fromisoformat, help="pretend today is this date (YYYY-MM-DD)")
    args = parser.parse_args()
    if not mailer.configured():
        print("SMTP_HOST 未設定，不寄提醒")
    print(asyncio.run(run(args.today)))


if __name__ == "__main__":
    main()
