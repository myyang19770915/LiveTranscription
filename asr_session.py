"""Per-connection pieces of the ASR stream service (ws_server.py) that can be tested without loading vLLM.

A stream's requestId names its log file and saved-audio folder, so it is checked before any path is built.
Each stream gets its own VAD state, so connections cannot change each other's speech detection.
Request logs record lengths and timings, not recognized text, and are deleted after a retention period.
"""
import copy
import logging
import os
import re
import time

_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


def is_valid_request_id(value) -> bool:
    """1-64 characters from A-Z, a-z, 0-9, '-' and '_'; anything else (including non-strings) is refused."""
    return isinstance(value, str) and _REQUEST_ID.fullmatch(value) is not None


def request_path(base_dir: str, request_id: str, suffix: str = "") -> str:
    """The file or folder `<base_dir>/<request_id><suffix>`, which must resolve to a direct child of base_dir.

    Raises ValueError for an invalid request_id or a path that would leave base_dir.
    """
    if not is_valid_request_id(request_id):
        raise ValueError("invalid requestId")
    base = os.path.realpath(base_dir)
    path = os.path.realpath(os.path.join(base, request_id + suffix))
    if os.path.dirname(path) != base:
        raise ValueError("requestId path leaves its directory")
    return path


def log_text_enabled() -> bool:
    """ASR_LOG_TEXT=1 lets request logs carry newly recognized text (never for streams with "retain": false)."""
    return os.getenv("ASR_LOG_TEXT", "") == "1"


def keep_request_text(header: dict) -> bool:
    """May this stream's request log carry recognized text: only with ASR_LOG_TEXT=1, never for "retain": false."""
    return log_text_enabled() and header.get("retain") is not False


def new_part(text: str, already_logged: str) -> str:
    """The part of text after what was already logged (results that repeat the accumulated text log only the rest)."""
    text = text or ""
    return text[len(already_logged):] if already_logged and text.startswith(already_logged) else text


def text_note(text: str, keep_text: bool) -> str:
    """What a request log line says about recognized text: its length, and the text itself only when allowed."""
    text = text or ""
    return f"chars={len(text)} text={text!r}" if keep_text else f"chars={len(text)}"


def reason_kind(reason: str) -> str:
    """The kind of a hallucination reason without the repeated text it quotes: tail_pattern:'嗯'x5+ -> tail_pattern."""
    return (reason or "").split(":", 1)[0]


DEFAULT_RETENTION_DAYS = 14


def retention_days(value) -> int:
    """ASR_LOG_RETENTION_DAYS: empty means 14; 0 keeps logs forever; anything but a non-negative integer is an error."""
    if value is None or str(value).strip() == "":
        return DEFAULT_RETENTION_DAYS
    text = str(value).strip()
    if text.isdigit():
        return int(text)
    logging.getLogger(__name__).error("ASR_LOG_RETENTION_DAYS=%r is not a non-negative integer; using %d",
                                      value, DEFAULT_RETENTION_DAYS)
    return DEFAULT_RETENTION_DAYS


def prune_request_logs(directory: str, days: int, now: float = None) -> int:
    """Delete *.log files directly in directory last modified more than `days` days ago; returns how many."""
    if days <= 0 or not os.path.isdir(directory):
        return 0
    cutoff = (time.time() if now is None else now) - days * 86400
    removed = 0
    for entry in os.scandir(directory):
        if entry.name.endswith(".log") and entry.is_file(follow_symlinks=False) and entry.stat().st_mtime < cutoff:
            os.remove(entry.path)
            removed += 1
    return removed


DEFAULT_RECV_QUEUE_MAX = 500   # about 80 s of audio in the browser's 0.16 s chunks


def recv_queue_max(value) -> int:
    """ASR_RECV_QUEUE_MAX: how many received messages a connection may hold unprocessed; a positive integer, else 500."""
    text = str(value or "").strip()
    if text.isdigit() and int(text) > 0:
        return int(text)
    if text:
        logging.getLogger(__name__).error("ASR_RECV_QUEUE_MAX=%r is not a positive integer; using %d", value, DEFAULT_RECV_QUEUE_MAX)
    return DEFAULT_RECV_QUEUE_MAX


def new_recv_queue(maxsize: int):
    """A connection's queue of received messages: holding `maxsize` at most, a full queue stops the reader."""
    import asyncio
    return asyncio.Queue(maxsize=maxsize)


def new_stream_vad(template):
    """A FireRedStreamVad for one connection: the template's model weights, its own streaming state.

    The state is the model cache and the post-processor (smoothing window, speech/silence counters). The feature
    extractor keeps no state between calls; each connection still gets its own object, sharing the read-only CMVN.
    """
    from fireredvad import FireRedStreamVad
    from fireredvad.core.stream_vad_postprocessor import StreamVadPostprocessor

    config = template.config
    postprocessor = StreamVadPostprocessor(
        config.smooth_window_size,
        config.speech_threshold,
        config.pad_start_frame,
        config.min_speech_frame,
        config.max_speech_frame,
        config.min_silence_frame)
    return FireRedStreamVad(copy.copy(template.audio_feat), template.vad_model, postprocessor, config)
