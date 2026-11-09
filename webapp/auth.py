"""Sign-in with the company LDAP, server-side sessions, and the signed-in user of a request.

Passwords are only ever passed to an LDAP bind; the database keeps the SHA-256 of session tokens.
Run inside the app container:
    python -m auth issue-session <username> [--hours N]   token for scripts (YUQIAO_SESSION)
    python -m auth check-ldap <username>                  try a sign-in against the configured LDAP
"""
import argparse
import asyncio
import getpass
import hashlib
import os
import re
import secrets
import ssl
import sys
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Annotated
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocketException
from fastapi.responses import FileResponse
from starlette.requests import HTTPConnection
from ldap3 import Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.dn import escape_rdn
from pydantic import BaseModel, Field

import db

LDAP_URL = os.getenv("LDAP_URL", "")
LDAP_BASE_DN = os.getenv("LDAP_BASE_DN", "")
LDAP_BIND_DN = os.getenv("LDAP_BIND_DN", "")
LDAP_BIND_PASSWORD = os.getenv("LDAP_BIND_PASSWORD", "")
LDAP_USER_FILTER = os.getenv("LDAP_USER_FILTER", "") or "(sAMAccountName={username})"
LDAP_USER_DN_TEMPLATE = os.getenv("LDAP_USER_DN_TEMPLATE", "")
LDAP_DISPLAY_ATTR = os.getenv("LDAP_DISPLAY_ATTR", "") or "displayName"
# The member's e-mail address (minutes-mail); an empty attribute leaves the member to enter their own.
LDAP_MAIL_ATTR = os.getenv("LDAP_MAIL_ATTR", "") or "mail"
LDAP_CA_FILE = os.getenv("LDAP_CA_FILE", "")
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "") == "1"
ADMIN_USERS = frozenset(name.strip().lower() for name in os.getenv("ADMIN_USERS", "").split(",") if name.strip())

STATIC_DIR = Path(__file__).resolve().parent / "static"
SESSION_COOKIE = "yq_session"
SESSION_LIFETIME = timedelta(hours=12)
MAX_FAILURES = 5
FAILURE_WINDOW = timedelta(minutes=5)

WRONG_CREDENTIALS = "帳號或密碼錯誤"
TOO_MANY_ATTEMPTS = "嘗試次數過多，請稍後再試"
LDAP_UNREACHABLE = "無法連線登入伺服器"

router = APIRouter()


class LdapUnavailable(Exception):
    """The LDAP server could not be reached or the service account was rejected."""


def ldap_server() -> Server:
    tls = Tls(ca_certs_file=LDAP_CA_FILE, validate=ssl.CERT_REQUIRED) if LDAP_CA_FILE else None
    return Server(LDAP_URL, use_ssl=LDAP_URL.lower().startswith("ldaps://"), tls=tls, connect_timeout=5)


def ldap_connection(user: str, password: str) -> Connection:
    """Tests replace this with an ldap3 MOCK_SYNC connection."""
    return Connection(ldap_server(), user=user, password=password, receive_timeout=10, raise_exceptions=False)


def first_value(entry_attributes: dict, attribute: str) -> str:
    value = entry_attributes.get(attribute)
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value or "").strip()


@dataclass(frozen=True)
class Profile:
    """What LDAP says about a user who signed in: "" for an attribute it does not have."""
    display_name: str
    email: str


def profile_of(entry_attributes: dict) -> Profile:
    email = first_value(entry_attributes, LDAP_MAIL_ATTR)
    return Profile(first_value(entry_attributes, LDAP_DISPLAY_ATTR), email if valid_email(email) else "")


def ldap_authenticate(username: str, password: str) -> Profile | None:
    """The user's Profile when the password is right, None when it is not.

    Raises LdapUnavailable when LDAP cannot answer. Callers must have rejected empty passwords:
    an empty simple bind is an anonymous bind on many servers and would succeed.
    """
    if not username or not password:
        return None
    if not LDAP_URL:
        raise LdapUnavailable("LDAP_URL is not set")
    try:
        if LDAP_USER_DN_TEMPLATE:
            user_dn = LDAP_USER_DN_TEMPLATE.format(username=escape_rdn(username))
            user = ldap_connection(user_dn, password)
            if not user.bind():
                return None
            user.search(user_dn, "(objectClass=*)", search_scope="BASE", attributes=[LDAP_DISPLAY_ATTR, LDAP_MAIL_ATTR])
            profile = profile_of(user.entries[0].entry_attributes_as_dict) if user.entries else Profile("", "")
            user.unbind()
            return profile
        service = ldap_connection(LDAP_BIND_DN, LDAP_BIND_PASSWORD)
        if not service.bind():
            raise LdapUnavailable("the LDAP service account was rejected")
        service.search(LDAP_BASE_DN, LDAP_USER_FILTER.format(username=escape_filter_chars(username)), attributes=[LDAP_DISPLAY_ATTR, LDAP_MAIL_ATTR])
        entries = list(service.entries)
        service.unbind()
        if len(entries) != 1:
            return None
        user = ldap_connection(entries[0].entry_dn, password)
        if not user.bind():
            return None
        user.unbind()
        return profile_of(entries[0].entry_attributes_as_dict)
    except LDAPException as exc:
        raise LdapUnavailable(str(exc)) from exc


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


@dataclass(frozen=True)
class User:
    username: str
    display_name: str
    admin: bool
    teams: list = field(default_factory=list, compare=False)


async def user_teams(conn, username: str) -> list[dict]:
    rows = await conn.execute(
        "SELECT t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.username = %s ORDER BY t.name", (username,))
    return [{"id": row["id"], "name": row["name"]} for row in await rows.fetchall()]


async def create_session(conn, username: str, lifetime: timedelta = SESSION_LIFETIME) -> str:
    token = secrets.token_urlsafe(32)
    await conn.execute("INSERT INTO sessions (token_hash, username, expires_at) VALUES (%s, %s, now() + %s)",
                       (token_hash(token), username, lifetime))
    return token


async def session_user(token: str | None) -> User | None:
    if not token:
        return None
    async with db.connect() as conn:
        row = await (await conn.execute(
            "SELECT s.username, coalesce(u.display_name, '') AS display_name FROM sessions s LEFT JOIN users u USING (username) "
            "WHERE s.token_hash = %s AND s.expires_at > now()", (token_hash(token),))).fetchone()
        if not row:
            return None
        return User(row["username"], row["display_name"], row["username"] in ADMIN_USERS, await user_teams(conn, row["username"]))


async def claim_attempt(conn, username: str) -> bool:
    """Count this attempt before LDAP is asked, in one statement; False while the username is locked.

    Claiming first means parallel attempts cannot all pass the check before any failure is recorded.
    A run counts while it stays within the window of its first attempt; after the fifth, further
    attempts are refused until 5 minutes after the last counted one. Success deletes the row.
    """
    # SET expressions read the conflicting row as committed by any concurrent attempt (the upsert waits for it).
    locked = "(login_failures.count >= %(max)s AND login_failures.last_failed_at > now() - %(window)s)"
    running = "login_failures.first_failed_at > now() - %(window)s"
    row = await (await conn.execute(
        "INSERT INTO login_failures (username, count, first_failed_at, last_failed_at) VALUES (%(user)s, 1, now(), now()) "
        "ON CONFLICT (username) DO UPDATE SET "
        f"count = CASE WHEN {locked} OR {running} THEN login_failures.count + 1 ELSE 1 END, "
        f"first_failed_at = CASE WHEN {locked} OR {running} THEN login_failures.first_failed_at ELSE now() END, "
        f"last_failed_at = CASE WHEN {locked} THEN login_failures.last_failed_at ELSE now() END "
        "RETURNING count", {"user": username, "max": MAX_FAILURES, "window": FAILURE_WINDOW})).fetchone()
    return row["count"] <= MAX_FAILURES


async def release_attempt(conn, username: str) -> None:
    """LDAP could not answer: this attempt says nothing about the password, so it does not count."""
    await conn.execute("UPDATE login_failures SET count = greatest(count - 1, 0) WHERE username = %s", (username,))


def user_payload(user: User) -> dict:
    return {"username": user.username, "displayName": user.display_name, "admin": user.admin, "teams": user.teams}


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=int(SESSION_LIFETIME.total_seconds()), httponly=True,
                        samesite="lax", secure=SESSION_COOKIE_SECURE or request.url.scheme == "https", path="/")


class LoginRequest(BaseModel):
    username: str = Field(default="", max_length=256)
    password: str = Field(default="", max_length=1024)


@router.get("/login")
async def login_page():
    return FileResponse(STATIC_DIR / "login.html", headers={"Cache-Control": "no-cache"})


@router.post("/api/login")
async def login(body: LoginRequest, request: Request, response: Response):
    username = body.username.strip().lower()
    if not username or not body.password:
        raise HTTPException(status_code=401, detail=WRONG_CREDENTIALS)
    # Each step commits on its own: raising inside a transaction would roll the count back.
    async with db.connect() as conn:
        allowed = await claim_attempt(conn, username)
    if not allowed:
        raise HTTPException(status_code=429, detail=TOO_MANY_ATTEMPTS)
    try:
        profile = await asyncio.to_thread(ldap_authenticate, username, body.password)
    except LdapUnavailable as exc:
        async with db.connect() as conn:
            await release_attempt(conn, username)
        raise HTTPException(status_code=503, detail=LDAP_UNREACHABLE) from exc
    if profile is None:
        raise HTTPException(status_code=401, detail=WRONG_CREDENTIALS)
    display_name = profile.display_name
    async with db.connect() as conn:
        await conn.execute("DELETE FROM login_failures WHERE username = %s", (username,))
        # An address from LDAP replaces whatever was stored; without one, only an address that came from LDAP is
        # cleared (minutes-mail), so an address the member entered stays.
        await conn.execute(
            "INSERT INTO users (username, display_name, email, email_source) VALUES (%(user)s, %(name)s, %(email)s, %(source)s) "
            "ON CONFLICT (username) DO UPDATE SET display_name = excluded.display_name, last_seen = now(), "
            "email = CASE WHEN excluded.email IS NOT NULL THEN excluded.email WHEN users.email_source = 'ldap' THEN NULL ELSE users.email END, "
            "email_source = CASE WHEN excluded.email IS NOT NULL THEN 'ldap' WHEN users.email_source = 'ldap' THEN NULL ELSE users.email_source END",
            {"user": username, "name": display_name or username, "email": profile.email or None, "source": "ldap" if profile.email else None})
        token = await create_session(conn, username)
        user = User(username, display_name or username, username in ADMIN_USERS, await user_teams(conn, username))
    set_session_cookie(response, request, token)
    return user_payload(user)


@router.post("/api/logout", status_code=204)
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        async with db.connect() as conn:
            await conn.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.status_code = 204
    return None


async def current_user(request: Request) -> User:
    user = getattr(request.state, "user", None) or await session_user(request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(status_code=401, detail="請先登入")
    return user


CurrentUser = Annotated[User, Depends(current_user)]

# Everything else needs a session. Static files under /assets are mounted outside the routes and stay
# public: the sign-in page needs them, and they hold no meeting data.
PUBLIC_PATHS = frozenset({"/login", "/api/login", "/api/logout", "/api/health", "/favicon.ico"})


STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def cross_site(connection: HTTPConnection) -> bool:
    """A browser names the page's origin; another site's page must not use this user's cookie."""
    origin = connection.headers.get("origin")
    if not origin:
        return False
    return urlsplit(origin).netloc.lower() != connection.headers.get("host", "").lower()


async def require_signed_in(connection: HTTPConnection) -> None:
    """App-wide guard: API 401, pages to /login; cross-site handshakes and state-changing requests 403.

    A signed-out WebSocket is let through with state.user = None: the handler accepts it and closes it
    with 4401 before any upstream connection. Closing before accept would reach the browser only as 1006.
    """
    websocket = connection.scope["type"] == "websocket"
    if (websocket or connection.scope.get("method") in STATE_CHANGING) and cross_site(connection):
        if websocket:
            raise WebSocketException(code=4403, reason="cross-site request")
        raise HTTPException(status_code=403, detail="cross-site request")
    if connection.url.path in PUBLIC_PATHS:
        return
    user = await session_user(connection.cookies.get(SESSION_COOKIE))
    if user is not None:
        connection.state.user = user
        return
    if websocket:
        connection.state.user = None
        return
    if connection.url.path.startswith("/api/"):
        raise HTTPException(status_code=401, detail="請先登入")
    raise HTTPException(status_code=303, headers={"Location": "/login"})


def avatar_url(username: str, updated_at) -> str | None:
    """A profile photo's address (member-avatars), versioned by its update time so a new photo gets a new
    (long-cached) address."""
    if updated_at is None:
        return None
    return f"/api/users/{quote(username, safe='')}/avatar?v={int(updated_at.timestamp() * 1000)}"


@router.get("/api/me")
async def me(user: CurrentUser):
    async with db.connect() as conn:
        row = await (await conn.execute("SELECT updated_at FROM user_avatars WHERE username = %s", (user.username,))).fetchone()
        mail = await (await conn.execute("SELECT email, email_source FROM users WHERE username = %s", (user.username,))).fetchone()
    return {**user_payload(user), "avatarUrl": avatar_url(user.username, row and row["updated_at"]),
            "email": mail and mail["email"], "emailSource": mail and mail["email_source"]}


# --- E-mail address (minutes-mail) -----------------------------------------------------------------

EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
BAD_EMAIL = "Email 格式不正確"
EMAIL_FROM_DIRECTORY = "Email 由公司目錄提供，無法修改"


def valid_email(value: str) -> bool:
    return len(value) <= 254 and EMAIL_PATTERN.fullmatch(value) is not None


class EmailIn(BaseModel):
    email: str = Field(default="", max_length=320)


@router.put("/api/me/email")
async def set_own_email(body: EmailIn, user: CurrentUser):
    """Set or clear ("") one's own address; an address from LDAP cannot be changed here."""
    email = body.email.strip()
    if email and not valid_email(email):
        raise HTTPException(status_code=422, detail=BAD_EMAIL)
    async with db.connect() as conn:
        await conn.execute("INSERT INTO users (username) VALUES (%s) ON CONFLICT DO NOTHING", (user.username,))
        row = await (await conn.execute("SELECT email_source FROM users WHERE username = %s FOR UPDATE", (user.username,))).fetchone()
        if row["email_source"] == "ldap":
            raise HTTPException(status_code=409, detail=EMAIL_FROM_DIRECTORY)
        await conn.execute("UPDATE users SET email = %s, email_source = %s WHERE username = %s",
                           (email or None, "self" if email else None, user.username))
    return {"email": email or None, "emailSource": "self" if email else None}


async def issue_session(username: str, hours: float) -> str:
    async with db.connect() as conn:
        await conn.execute("INSERT INTO users (username) VALUES (%s) ON CONFLICT DO NOTHING", (username,))
        return await create_session(conn, username, timedelta(hours=hours))


async def check_ldap(username: str) -> None:
    password = getpass.getpass(f"{username} 的密碼（不會顯示）：")
    try:
        profile = await asyncio.to_thread(ldap_authenticate, username.strip().lower(), password)
    except LdapUnavailable as exc:
        print(f"無法連線登入伺服器：{exc}")
        raise SystemExit(2) from exc
    if profile is None:
        print("帳號或密碼錯誤（或篩選條件找不到這個帳號）")
        raise SystemExit(1)
    print(f"登入成功：{username}（{profile.display_name or '沒有顯示名稱'}；Email：{profile.email or '沒有'}）")


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m auth")
    commands = parser.add_subparsers(dest="command", required=True)
    issue = commands.add_parser("issue-session", help="print a session token for scripts (YUQIAO_SESSION)")
    issue.add_argument("username")
    issue.add_argument("--hours", type=float, default=12)
    check = commands.add_parser("check-ldap", help="try a sign-in against the configured LDAP")
    check.add_argument("username")
    args = parser.parse_args(argv)
    if args.command == "issue-session":
        if not 0 < args.hours <= 24 * 30:
            parser.error("--hours must be between 0 and 720")
        print(asyncio.run(issue_session(args.username.strip().lower(), args.hours)))
    else:
        asyncio.run(check_ldap(args.username))


if __name__ == "__main__":
    main(sys.argv[1:])
