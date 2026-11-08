"""The meeting recording: the same 16 kHz mono PCM16 the gateway forwards to ASR or MAI, as WAV.

Recording and transcript share one timeline because they are the same bytes: the gateway's audio
position (bytes / 32 = ms) is what every recognition event is stamped with. The header's length
fields are written when the meeting ends; a file left without them (the app stopped mid-meeting)
is repaired from its size the next time it is read.
"""
import struct
from pathlib import Path

SAMPLE_RATE = 16000
BYTES_PER_MS = SAMPLE_RATE * 2 // 1000   # 16-bit mono: 32 bytes per millisecond
HEADER_BYTES = 44
_open: set[Path] = set()   # recordings being written by this process


def wav_header(data_bytes: int) -> bytes:
    return (b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
            + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16)
            + b"data" + struct.pack("<I", data_bytes))


class MeetingAudio:
    """Appends PCM to path; bytes counts what was received, so position_ms is the gateway's audio clock."""

    def __init__(self, path: Path):
        self.path = path
        self.bytes = 0
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open("xb")   # never overwrite an existing recording
        self.file.write(wav_header(0))
        _open.add(path)

    @property
    def position_ms(self) -> int:
        return self.bytes // BYTES_PER_MS

    def write(self, pcm: bytes) -> None:
        if self.file is None or not pcm:
            return
        self.file.write(pcm)
        self.bytes += len(pcm)

    def close(self) -> int:
        """Write the final lengths; returns the PCM byte count."""
        if self.file is not None:
            self.file.seek(0)
            self.file.write(wav_header(self.bytes))
            self.file.close()
            self.file = None
            _open.discard(self.path)
        return self.bytes


def is_recording(path: Path) -> bool:
    """Whether a meeting is still writing this recording (after a restart nothing is)."""
    return path in _open


def repair_header(path: Path) -> int:
    """Make the header match the file size (after an unclean stop); returns the PCM byte count."""
    size = path.stat().st_size
    data = max(0, size - HEADER_BYTES)
    data -= data % 2
    with path.open("r+b") as file:
        header = file.read(HEADER_BYTES)
        if len(header) < HEADER_BYTES or struct.unpack("<I", header[40:44])[0] != data:
            file.seek(0)
            file.write(wav_header(data))
    return data


def read_range(path: Path, start_ms: int, end_ms: int) -> bytes:
    """A standalone WAV of [start_ms, end_ms), clamped to 0 and the end of the recording."""
    total = repair_header(path)
    start = min(max(0, start_ms), total // BYTES_PER_MS) * BYTES_PER_MS
    end = min(max(start_ms, end_ms), total // BYTES_PER_MS) * BYTES_PER_MS
    end = max(start, end)
    with path.open("rb") as file:
        file.seek(HEADER_BYTES + start)
        pcm = file.read(end - start)
    return wav_header(len(pcm)) + pcm


def duration_ms(path: Path) -> int:
    return repair_header(path) // BYTES_PER_MS
