"""Sign scripts in to Yuqiao Live without a password.

Get a session token inside the app container and export it:
    docker exec -w /app asr_confucius4-r2t2-app-1 python -m auth issue-session <username> --hours 12
    YUQIAO_SESSION=<token>     the session cookie value
    YUQIAO_TEAM=<team name>    which team new meetings belong to (optional when the user has one team)
"""
import json
import os
import sys
import urllib.request
from urllib.parse import urlsplit, urlunsplit

COOKIE = "yq_session"


def token() -> str:
    value = os.getenv("YUQIAO_SESSION", "").strip()
    if not value:
        sys.exit("Set YUQIAO_SESSION first: docker exec -w /app asr_confucius4-r2t2-app-1 python -m auth issue-session <username>")
    return value


def headers() -> dict:
    return {"Cookie": f"{COOKIE}={token()}"}


def http_base(url: str) -> str:
    """http://host:port/ for any app URL, including ws://host:port/ws/transcribe."""
    parts = urlsplit(url)
    scheme = {"ws": "http", "wss": "https"}.get(parts.scheme, parts.scheme)
    return urlunsplit((scheme, parts.netloc, "/", "", ""))


def api(base: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(http_base(base) + path.lstrip("/"), data, {**headers(), "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read() or b"null")


def team(base: str) -> dict:
    teams = api(base, "api/me")["teams"]
    wanted = os.getenv("YUQIAO_TEAM", "").strip()
    matches = [t for t in teams if t["name"] == wanted] if wanted else teams
    if len(matches) != 1:
        names = ", ".join(t["name"] for t in teams) or "none"
        sys.exit(f"Set YUQIAO_TEAM to one of this user's teams ({names})")
    return matches[0]


def create_meeting(base: str, language: str, engine: str = "local") -> str:
    return api(base, "api/meetings", {"team_id": team(base)["id"], "language": language, "engine": engine})["id"]
