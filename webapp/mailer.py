"""Sending the meeting minutes by e-mail (minutes-mail) through the company SMTP server.

Each team chooses where its minutes go: every member's own address (`members`) or one team address (`team`), and
whether finalizing the minutes sends them automatically. A member finalizes the minutes once; anyone in the team can
send them again at any time. Only confirmed items are mailed. Sending happens inside the request (smtplib in a
thread, 15 s timeout) so the sender sees the result at once; every attempt that reaches the mail server is kept in
minutes_mail. Tests replace send_message.
"""
import asyncio
import html
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import auth
import db
import minutes
import team_access

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "") or 587)
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")
TLS_MODES = ("starttls", "ssl", "none")


def tls_mode(value: str) -> str:
    """starttls | ssl | none; anything else is a mistake, and falls back to starttls so a password is never sent in
    the clear because of a typo."""
    mode = (value or "starttls").strip().lower()
    if mode not in TLS_MODES:
        logging.getLogger("uvicorn.error").error("SMTP_TLS %r is not starttls, ssl or none; using starttls", value)
        return "starttls"
    return mode


SMTP_TLS = tls_mode(os.getenv("SMTP_TLS", ""))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
SMTP_TIMEOUT = 15
ERROR_MAX = 300

NOT_CONFIGURED = "尚未設定寄信伺服器"
NOTHING_TO_SEND = "紀要還沒有內容可寄送"
NO_RECIPIENT = "沒有可寄送的收件人"
SEND_FAILED = "寄送失敗"

router = APIRouter()


def configured() -> bool:
    return bool(SMTP_HOST)


def sender() -> str:
    return SMTP_FROM or SMTP_USER or "yuqiao-live@localhost"


def send_message(message: EmailMessage) -> dict:
    """Hand one message to the SMTP server (blocking); returns the recipients it refused while accepting others
    (smtplib raises only when it refuses them all). Tests replace this."""
    if SMTP_TLS == "ssl":
        client = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT, context=ssl.create_default_context())
    else:
        client = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT)
    with client:
        if SMTP_TLS == "starttls":
            client.starttls(context=ssl.create_default_context())
        if SMTP_USER:
            client.login(SMTP_USER, SMTP_PASSWORD)
        return client.send_message(message) or {}


def refused_text(refused: dict) -> str:
    return "部分收件人被拒收：" + "、".join(f"{address}（{code}）" for address, (code, _reply) in refused.items())


async def deliver(message: EmailMessage) -> str:
    """"" when every recipient was accepted, otherwise the error to record and show. SMTP and connection errors keep
    the server's reply (smtplib never puts the password in it); any other error is recorded by its type only, so a
    message cannot carry a setting's value."""
    try:
        refused = await asyncio.to_thread(send_message, message)
    except (smtplib.SMTPException, OSError) as exc:
        return f"{type(exc).__name__}: {exc}"[:ERROR_MAX]
    except Exception as exc:   # noqa: BLE001 - recorded as a failed send instead of a 500
        return type(exc).__name__
    return refused_text(refused)[:ERROR_MAX] if refused else ""


# --- Recipients and settings -----------------------------------------------------------------------

async def team_settings(conn, team_id: int) -> dict:
    return await (await conn.execute("SELECT id, name, mail_target, mail_address, mail_auto FROM teams WHERE id = %s", (team_id,))).fetchone()


async def recipients(conn, team: dict) -> tuple[list[str], list[str]]:
    """(addresses, usernames not reached): the team address, or every member with an address."""
    if team["mail_target"] == "team":
        address = team["mail_address"]
        return ([address] if address and auth.valid_email(address) else []), []
    rows = await (await conn.execute(
        "SELECT m.username, u.email FROM team_members m LEFT JOIN users u USING (username) WHERE m.team_id = %s ORDER BY m.username",
        (team["id"],))).fetchall()
    # An address stored before the stricter rule that no longer passes counts as none: it must not spoil the mail.
    usable = lambda r: bool(r["email"]) and auth.valid_email(r["email"])
    return [r["email"] for r in rows if usable(r)], [r["username"] for r in rows if not usable(r)]


def last_payload(row: dict | None, members: dict) -> dict | None:
    if row is None:
        return None
    return {"trigger": row["trigger"], "sentAt": row["sent_at"].isoformat(), "sentBy": members.get(row["sent_by"], row["sent_by"]),
            "recipients": len(row["recipients"]), "skipped": [members.get(u, u) for u in row["skipped"]],
            "ok": row["ok"], "error": row["error"]}


async def mail_state(conn, meeting: dict, members: dict) -> dict:
    """The minutes page's sending block: settings, who would receive the mail now, and the latest send."""
    team = await team_settings(conn, meeting["team_id"])
    to, skipped = await recipients(conn, team)
    last = await (await conn.execute("SELECT * FROM minutes_mail WHERE meeting_id = %s ORDER BY id DESC LIMIT 1", (meeting["id"],))).fetchone()
    return {"configured": configured(), "teamId": team["id"], "target": team["mail_target"], "address": team["mail_address"],
            "auto": team["mail_auto"], "recipients": len(to), "missing": [members.get(u, u) for u in skipped],
            "last": last_payload(last, members), "lastChange": await last_change(conn, team["id"])}


async def last_change(conn, team_id: int) -> dict | None:
    """The latest change of the team's mail settings (mail-settings-audit), or None."""
    row = await (await conn.execute(
        "SELECT c.*, coalesce(nullif(u.display_name, ''), c.changed_by) AS name FROM team_mail_changes c "
        "LEFT JOIN users u ON u.username = c.changed_by WHERE c.team_id = %s ORDER BY c.id DESC LIMIT 1", (team_id,))).fetchone()
    if row is None:
        return None
    return {"at": row["changed_at"].isoformat(), "by": row["name"], "member": row["by_member"],
            "target": row["target_after"], "address": row["address_after"], "auto": row["auto_after"]}


class MailSettings(BaseModel):
    target: Literal["members", "team"]
    address: str = Field(default="", max_length=320)
    auto: bool = False


@router.put("/api/teams/{team_id}/mail")
async def change_settings(team_id: int, body: MailSettings, user: auth.CurrentUser):
    """Any member of the team (or an administrator) changes where its minutes go."""
    address = body.address.strip()
    async with db.connect() as conn:
        if not await team_access.team_exists(conn, team_id):
            raise HTTPException(status_code=404, detail=team_access.TEAM_NOT_FOUND)
        member = await team_access.is_member(conn, user.username, team_id)
        if not (user.admin or member):
            raise HTTPException(status_code=403, detail="只有團隊成員可以修改寄送設定")
        if (address or body.target == "team") and not auth.valid_email(address):
            raise HTTPException(status_code=422, detail=auth.BAD_EMAIL)
        # Locked until this transaction ends, so two saves at once record what each one really replaced.
        before = await (await conn.execute("SELECT mail_target, mail_address, mail_auto FROM teams WHERE id = %s FOR UPDATE",
                                           (team_id,))).fetchone()
        await conn.execute("UPDATE teams SET mail_target = %s, mail_address = %s, mail_auto = %s WHERE id = %s",
                           (body.target, address, body.auto, team_id))
        if (before["mail_target"], before["mail_address"], before["mail_auto"]) != (body.target, address, body.auto):
            # Kept so the team sees who changed where its minutes go, above all an administrator from outside the team.
            await conn.execute(
                "INSERT INTO team_mail_changes (team_id, changed_by, by_member, target_before, address_before, auto_before, "
                "target_after, address_after, auto_after) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (team_id, user.username, member, before["mail_target"], before["mail_address"], before["mail_auto"],
                 body.target, address, body.auto))
    return {"target": body.target, "address": address, "auto": body.auto}


# --- The message -----------------------------------------------------------------------------------

def minutes_link(meeting: dict) -> str:
    return f"{PUBLIC_BASE_URL}/meetings/{meeting['id']}/minutes" if PUBLIC_BASE_URL else ""


def html_body(meeting: dict, team: str, summary: str, items: list[dict], members: dict, link: str) -> str:
    """The same content as the Markdown export, as simple inline-styled HTML; every text from the meeting is escaped."""
    e = html.escape
    start = minutes.local_start(meeting)
    parts = [f'<h1 style="font-size:20px;margin:0 0 4px">{e(minutes.display_title(meeting))}</h1>',
             f'<p style="color:#666;margin:0 0 16px">{start:%Y/%m/%d %H:%M}（星期{minutes.WEEKDAYS[start.weekday()]}）・{e(team)}</p>',
             '<h2 style="font-size:16px;margin:16px 0 6px">摘要</h2>',
             f'<p style="margin:0;white-space:pre-wrap">{e(summary) if summary else "（無）"}</p>']
    for kind in minutes.KINDS:
        chosen = [i for i in items if i["kind"] == kind and i["state"] == "confirmed"]
        if not chosen:
            continue
        rows = []
        for i in chosen:
            text = e(i["content"])
            if kind == "action":
                owner = members.get(i["owner"], i["owner"]) if i["owner"] else "未指派"
                text += f'<br><span style="color:#666">負責人：{e(owner)}・到期：{e(minutes.due_label(i["due_date"], i["due_text"]))}</span>'
            rows.append(f'<li style="margin:0 0 6px">{text}</li>')
        parts.append(f'<h2 style="font-size:16px;margin:16px 0 6px">{minutes.LABELS[kind]}</h2><ul style="margin:0;padding-left:20px">{"".join(rows)}</ul>')
    if link:
        parts.append(f'<p style="margin:20px 0 0"><a href="{e(link)}">開啟紀要</a></p>')
    parts.append('<p style="color:#999;font-size:12px;margin:20px 0 0">此信由語橋 Live 寄出，只包含已確認的條目。</p>')
    return f'<!doctype html><html><body style="font-family:sans-serif;font-size:14px;color:#222;line-height:1.6">{"".join(parts)}</body></html>'


def compose(meeting: dict, team: str, summary: str, items: list[dict], members: dict, times: dict, to: list[str]) -> EmailMessage:
    link = minutes_link(meeting)
    text = minutes.markdown(meeting, team, summary, items, members, times)
    if link:
        text += f"\n開啟紀要：{link}\n"
    message = EmailMessage()
    title = " ".join(minutes.display_title(meeting).split())   # no line breaks in a header
    message["Subject"] = f"[語橋 Live] 會議紀要：{title}"
    message["From"] = sender()
    message["To"] = ", ".join(to)
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=sender().rpartition("@")[2] or None)
    message.set_content(text)
    message.add_alternative(html_body(meeting, team, summary, items, members, link), subtype="html")
    return message


# --- Finalize and send -----------------------------------------------------------------------------

async def send_minutes(meeting: dict, user: auth.User, trigger: Literal["auto", "manual"]) -> dict:
    """Mail the minutes now and record the attempt; raises 422 before contacting the server when there is nothing
    to send or nobody to send it to. Returns the latest-send payload (ok false when the server refused)."""
    async with db.connect() as conn:
        row = await (await conn.execute("SELECT summary FROM minutes WHERE meeting_id = %s", (meeting["id"],))).fetchone()
        summary = row["summary"] if row else ""
        items = await (await conn.execute("SELECT * FROM minute_items WHERE meeting_id = %s ORDER BY id", (meeting["id"],))).fetchall()
        if not summary.strip() and not any(i["state"] == "confirmed" for i in items):
            raise HTTPException(status_code=422, detail=NOTHING_TO_SEND)
        team = await team_settings(conn, meeting["team_id"])
        to, skipped = await recipients(conn, team)
        if not to:
            raise HTTPException(status_code=422, detail=NO_RECIPIENT)
        members, times = await minutes.item_context(conn, meeting)
    try:
        message = compose(meeting, team["name"], summary, items, members, times, to)
    except Exception as exc:   # noqa: BLE001 - recorded as a failed send
        message, error = None, type(exc).__name__
    if message is not None:
        error = await deliver(message)
    async with db.connect() as conn:
        record = await (await conn.execute(
            "INSERT INTO minutes_mail (meeting_id, trigger, recipients, skipped, sent_by, ok, error) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (meeting["id"], trigger, to, skipped, user.username, not error, error))).fetchone()
    return last_payload(record, members)


async def member_meeting(meeting_id: str, user: auth.User) -> dict:
    async with db.connect() as conn:
        return await team_access.require_member(conn, user, meeting_id)


@router.post("/api/meetings/{meeting_id}/minutes/send")
async def send(meeting_id: str, user: auth.CurrentUser):
    meeting = await member_meeting(meeting_id, user)
    if not configured():
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
    last = await send_minutes(meeting, user, "manual")
    if not last["ok"]:
        raise HTTPException(status_code=502, detail=f"{SEND_FAILED}：{last['error']}")
    return {"last": last}


@router.post("/api/meetings/{meeting_id}/minutes/finalize")
async def finalize(meeting_id: str, user: auth.CurrentUser):
    """Finalize once; the first finalize sends automatically when the team asks for it. A failed or impossible
    automatic send does not undo the finalize: the minutes page shows why."""
    async with db.connect() as conn:
        meeting = await team_access.require_member(conn, user, meeting_id)
        await conn.execute("INSERT INTO minutes (meeting_id) VALUES (%s) ON CONFLICT DO NOTHING", (meeting["id"],))
        # Concurrent finalizes: only the one whose UPDATE changed the row goes on to send.
        first = await (await conn.execute(
            "UPDATE minutes SET finalized_at = now(), finalized_by = %s WHERE meeting_id = %s AND finalized_at IS NULL RETURNING meeting_id",
            (user.username, meeting["id"]))).fetchone()
        team = await team_settings(conn, meeting["team_id"])
        sent_before = await (await conn.execute(
            "SELECT 1 FROM minutes_mail WHERE meeting_id = %s AND trigger = 'auto'", (meeting["id"],))).fetchone()
    notice = ""
    if first and team["mail_auto"] and not sent_before:
        if not configured():
            notice = f"已定稿；{NOT_CONFIGURED}，沒有自動寄送"
        else:
            try:
                last = await send_minutes(meeting, user, "auto")
                notice = "已定稿並寄出紀要" if last["ok"] else f"已定稿；{SEND_FAILED}：{last['error']}"
            except HTTPException as exc:
                notice = f"已定稿；{exc.detail}，沒有自動寄送"
    payload = await minutes.get_minutes(meeting_id, user)
    return {**payload, "notice": notice or ("已定稿" if first else "")}
