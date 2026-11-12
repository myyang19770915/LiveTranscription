"""Limits on the recognition WebSocket (stream-limits), for the local and the MAI engine alike.

transcribe() takes a place for the user (at most MAX_STREAMS_PER_USER at once), waits STREAM_HEADER_TIMEOUT seconds
for the start message, and hands the engines a StreamGuard instead of the browser socket. The guard counts the audio
(at most MAX_STREAM_HOURS) and re-checks the session and, for a meeting, the team membership every
STREAM_RECHECK_MINUTES while audio arrives. A limit ends the stream with StreamStopped(code, reason).
"""
import json
import logging
import os
import time

from fastapi import HTTPException

import auth
import db
import team_access

logger = logging.getLogger("uvicorn.error")
BYTES_PER_HOUR = 16000 * 2 * 3600   # 16 kHz, 16-bit mono PCM


def setting(name: str, default: float) -> float:
    """A positive number from the environment; anything else is logged and the default is used."""
    value = os.getenv(name, "").strip()
    if not value:
        return default
    try:
        number = float(value)
        if number > 0:
            return number
    except ValueError:
        pass
    logger.error("%s=%r is not a positive number; using %s", name, value, default)
    return default


STREAM_HEADER_TIMEOUT = setting("STREAM_HEADER_TIMEOUT", 30)
MAX_STREAMS_PER_USER = auth.positive_int("MAX_STREAMS_PER_USER", 2)   # a whole number: 0.5 must not become 0
MAX_STREAM_HOURS = setting("MAX_STREAM_HOURS", 4)
STREAM_RECHECK_MINUTES = setting("STREAM_RECHECK_MINUTES", 5)

RECHECK_RETRY_SECONDS = 30
TOO_MANY = "同時進行的辨識已達上限（{n} 條）"
TOO_LONG = "已達單場上限 {hours:g} 小時，錄音已停止"
NOT_MEMBER = "你已不是這個團隊的成員，錄音已停止"
NO_START = "沒有收到開始訊息，連線已關閉"

active: dict[str, int] = {}   # username -> open streams; one event loop, so no lock is needed


class StreamStopped(Exception):
    """End the stream and close the browser socket with this code (the message, if any, was already sent)."""

    def __init__(self, code: int, reason: str):
        super().__init__(reason)
        self.code, self.reason = code, reason


def take_place(username: str) -> bool:
    if active.get(username, 0) >= MAX_STREAMS_PER_USER:
        return False
    active[username] = active.get(username, 0) + 1
    return True


def free_place(username: str) -> None:
    left = active.get(username, 0) - 1
    if left > 0:
        active[username] = left
    else:
        active.pop(username, None)


def max_stream_bytes() -> int:
    return int(MAX_STREAM_HOURS * BYTES_PER_HOUR)


def accepts(received: int, chunk: int) -> bool:
    """Whether a chunk of `chunk` bytes still fits after `received` bytes of this stream."""
    return received + chunk <= max_stream_bytes()


class StreamGuard:
    """The browser socket as the engines see it: same methods, with the audio counted and access re-checked."""

    def __init__(self, browser, user: auth.User, token: str | None, meeting: dict | None):
        self._browser, self._user, self._token, self._meeting = browser, user, token, meeting
        self.received = 0
        self._checked = time.monotonic()

    def __getattr__(self, name):
        return getattr(self._browser, name)

    async def _stop(self, code: int, message: str | None, reason: str):
        if message:
            try:
                await self._browser.send_text(json.dumps({"status": "error", "msg": message}, ensure_ascii=False))
            except Exception:   # noqa: BLE001 - the browser may be gone already
                pass
        raise StreamStopped(code, reason)

    async def _recheck(self):
        """Only a session that is gone or a membership that is gone ends the stream; when the database cannot answer
        the check is tried again 30 seconds later, so a database restart does not cut running meetings."""
        self._checked = time.monotonic()
        try:
            user = await auth.session_user(self._token)
            member = True
            if user is not None and self._meeting is not None:
                try:
                    async with db.connect() as conn:
                        await team_access.require_member(conn, self._user, str(self._meeting["id"]))
                except HTTPException:
                    member = False
        except Exception as exc:   # noqa: BLE001 - database unreachable: keep streaming, check again soon
            logger.warning("stream access check failed, retrying in 30 s: %s", exc)
            self._checked = time.monotonic() - STREAM_RECHECK_MINUTES * 60 + RECHECK_RETRY_SECONDS
            return
        if user is None:
            await self._stop(4401, None, "session ended")
        if not member:
            await self._stop(4403, NOT_MEMBER, NOT_MEMBER)

    async def receive(self):
        event = await self._browser.receive()
        chunk = event.get("bytes")
        if chunk is not None:
            if not accepts(self.received, len(chunk)):
                message = TOO_LONG.format(hours=MAX_STREAM_HOURS)
                await self._stop(4413, message, message)
            self.received += len(chunk)
            if time.monotonic() - self._checked >= STREAM_RECHECK_MINUTES * 60:
                await self._recheck()
        return event
