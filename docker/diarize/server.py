"""Speaker diarization service (speaker-diarization): runs transcribe-cli --diarize on one meeting recording at a time.

GET  /health   200 {"ok": true} once the model file is present; 503 while it downloads (or after a failed download).
POST /diarize  {"file": "teams/<team>/<meeting uuid>/audio.wav", "language": "zh" | "en" | ""}
               200 {"output": <transcribe-cli stdout>, "seconds": <float>}; 400 bad request; 404 no such recording;
               500 {"error": <end of stderr>} when transcribe-cli fails. Requests wait for the one running before them.
Recordings are read from OUTPUT_DIR (the app's output folder, mounted read-only); nothing else can be named.
Standard library only, so the image needs no Python packages.
"""
import json
import logging
import os
import re
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/output"))
MODEL_URL = os.getenv("DIARIZE_MODEL_URL", "https://huggingface.co/handy-computer/MOSS-Transcribe-Diarize-gguf/resolve/main/"
                      "MOSS-Transcribe-Diarize-Q8_0.gguf")
MODEL = Path(os.getenv("DIARIZE_MODEL", "/models/" + MODEL_URL.rsplit("/", 1)[-1]))
THREADS = os.getenv("DIARIZE_THREADS", "16")
CLI = os.getenv("TRANSCRIBE_CLI", "/opt/transcribe/bin/transcribe-cli")
PORT = int(os.getenv("PORT", "5002"))
RECORDING = re.compile(r"teams/\d+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/audio\.wav")
LANGUAGES = {"zh", "en"}   # what transcribe.cpp accepts for MOSS; anything else is detected automatically
logger = logging.getLogger("diarize")
job_lock = threading.Lock()
running: dict[Path, subprocess.Popen] = {}   # the recording being processed now
running_lock = threading.Lock()


class BadRequest(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def resolve(file: object, root: Path = OUTPUT_DIR) -> Path:
    """The recording a request names; only teams/<n>/<uuid>/audio.wav inside root, and it must exist."""
    if not isinstance(file, str) or not RECORDING.fullmatch(file):
        raise BadRequest(400, "file must be teams/<team>/<meeting>/audio.wav")
    path = (root / file).resolve()
    if root.resolve() not in path.parents:
        raise BadRequest(400, "file must be inside the output folder")
    if not path.is_file():
        raise BadRequest(404, "recording not found")
    return path


def command(path: Path, language: str) -> list[str]:
    cmd = [CLI, "-m", str(MODEL), "--diarize", "--threads", THREADS, "-q"]
    if language in LANGUAGES:
        cmd += ["-l", language]
    return cmd + [str(path)]


def run_job(path: Path, language: str) -> tuple[int, str, str, float]:
    """(exit code, stdout, stderr, seconds). A newer request for the same recording means its earlier requester is gone
    (the app restarted and queued it again), so the earlier run is stopped instead of holding the queue."""
    with running_lock:
        if path in running:
            logger.info("stopping the earlier run of %s", path)
            running[path].kill()
    with job_lock:
        started = time.monotonic()
        with running_lock:
            process = running[path] = subprocess.Popen(command(path, language), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                                       text=True, encoding="utf-8")
        try:
            out, err = process.communicate()
        finally:
            with running_lock:
                if running.get(path) is process:
                    del running[path]
        return process.returncode, out, err, round(time.monotonic() - started, 1)


def download_model() -> None:
    if MODEL.exists():
        return
    part = MODEL.with_suffix(".part")
    try:
        logger.info("downloading %s", MODEL_URL)
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response, part.open("wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
        part.replace(MODEL)
        logger.info("model ready: %s", MODEL)
    except Exception:   # health stays 503; a restart retries
        logger.exception("model download failed")
        part.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802 (http.server naming)
        if self.path != "/health":
            return self.reply(404, {"error": "not found"})
        self.reply(200 if MODEL.exists() else 503, {"ok": MODEL.exists()})

    def do_POST(self):  # noqa: N802
        if self.path != "/diarize":
            return self.reply(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 4096)) or b"{}")
            if not isinstance(body, dict):
                raise BadRequest(400, "JSON object expected")
            path = resolve(body.get("file"))
        except json.JSONDecodeError:
            return self.reply(400, {"error": "invalid JSON"})
        except BadRequest as exc:
            return self.reply(exc.status, {"error": str(exc)})
        if not MODEL.exists():
            return self.reply(503, {"error": "model not ready"})
        code, out, err, seconds = run_job(path, str(body.get("language") or ""))
        if code != 0:
            logger.warning("transcribe-cli failed (%s) for %s", code, path)
            return self.reply(500, {"error": (err or f"exit {code}")[-500:]})
        logger.info("diarized %s in %.1f s", path, seconds)
        self.reply(200, {"output": out, "seconds": seconds})

    def log_message(self, fmt, *args):  # requests are logged by the handlers above
        pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    threading.Thread(target=download_model, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
