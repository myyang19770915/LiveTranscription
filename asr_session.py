"""Per-connection pieces of the ASR stream service (ws_server.py) that can be tested without loading vLLM.

A stream's requestId names its log file and saved-audio folder, so it is checked before any path is built.
Each stream gets its own VAD state, so connections cannot change each other's speech detection.
"""
import copy
import os
import re

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
