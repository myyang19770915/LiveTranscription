"""Browser security headers and asset caching on every HTTP response (response-headers)."""
from urllib.parse import parse_qs

from starlette.responses import PlainTextResponse

SECURITY = (
    (b"x-frame-options", b"DENY"),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"same-origin"),
)
# No includeSubDomains: other services share the domain and decide for themselves.
TRANSPORT = (b"strict-transport-security", b"max-age=31536000")
# 30 days, not immutable: asset versions are bumped by hand, so a forgotten bump heals on its own.
ASSET_CACHE = (b"cache-control", b"public, max-age=2592000")


async def server_error(request, _error):
    """The 500 for an unhandled error is written outside every middleware, so it carries the headers itself."""
    headers = dict(SECURITY + ((TRANSPORT,) if request.url.scheme == "https" else ()))
    return PlainTextResponse("Internal Server Error", status_code=500, headers={k.decode(): v.decode() for k, v in headers.items()})


class ResponseHeaders:
    """ASGI middleware: adds the headers a route did not set itself. WebSocket scopes pass through untouched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # The scheme uvicorn resolved, X-Forwarded-Proto from a trusted proxy included.
        wanted = list(SECURITY) + ([TRANSPORT] if scope.get("scheme") == "https" else [])
        versioned = scope["path"].startswith("/assets/") and bool(parse_qs(scope.get("query_string", b"").decode("latin-1")).get("v"))

        async def add(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {name.lower() for name, _ in headers}
                extra = wanted + ([ASSET_CACHE] if versioned and message["status"] == 200 else [])
                headers += [(name, value) for name, value in extra if name not in present]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, add)
