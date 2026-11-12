"""Run inside the ASR container: docker exec -w /workspace asr_confucius4-r2t2-asr-1 python -m unittest -q test_asr_session"""
import os
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

import asr_session

VAD_MODEL_DIR = os.getenv("VAD_MODEL_PATH", "/models/vad/Stream-VAD")
ASR_URL = os.getenv("ASR_TEST_URL", "ws://127.0.0.1:8272")  # the running ASR service, seen from its own container
CHUNK = 8000  # 0.5 s of 16 kHz audio


class RequestIdTests(unittest.TestCase):
    def test_identifier_checks(self):
        rows = [  # the "identifier checks" example of the asr-stream spec
            ("3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c", True),
            ("abc_DEF-123", True),
            ("../../outside", False),
            ("a/b", False),
            ("", False),
            ("a" * 65, False),
            ("id with space", False),
        ]
        for value, accepted in rows:
            with self.subTest(value=value):
                self.assertIs(asr_session.is_valid_request_id(value), accepted)
        self.assertTrue(asr_session.is_valid_request_id("a" * 64))
        for value in (None, 123, b"abc", "abc\n", "ａｂｃ"):
            with self.subTest(value=value):
                self.assertFalse(asr_session.is_valid_request_id(value))

    def test_request_path_stays_inside_its_directory(self):
        with tempfile.TemporaryDirectory() as base:
            path = asr_session.request_path(base, "abc-123", ".log")
            self.assertEqual(path, os.path.join(os.path.realpath(base), "abc-123.log"))
            for value in ("../../outside", "/etc/passwd", "..", "a/../../b", ""):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    asr_session.request_path(base, value, ".log")


class LogTextTests(unittest.TestCase):
    """Request logs without transcript text."""

    def keep_text(self, log_text, header):
        from unittest.mock import patch
        with patch.dict(os.environ, {"ASR_LOG_TEXT": log_text}):
            return asr_session.keep_request_text(header)

    def test_what_a_result_line_records(self):
        rows = [  # the "what a result line records" example of the asr-stream spec
            ("", {}, "chars=4"),
            ("1", {}, "chars=4 text='你好世界'"),
            ("1", {"retain": False}, "chars=4"),
            ("", {"retain": False}, "chars=4"),
        ]
        for log_text, header, expected in rows:
            with self.subTest(log_text=log_text, header=header):
                self.assertEqual(asr_session.text_note("你好世界", self.keep_text(log_text, header)), expected)
        self.assertFalse(self.keep_text("true", {}))  # only "1" turns it on
        self.assertEqual(asr_session.text_note(None, False), "chars=0")

    def test_reset_logs_only_what_it_adds(self):
        self.assertEqual(asr_session.new_part("今天天氣很好", "今天天氣"), "很好")  # v0 resends the accumulated text
        self.assertEqual(asr_session.new_part("很好", "今天天氣"), "很好")          # v1 sends the new part only
        self.assertEqual(asr_session.new_part("今天", ""), "今天")
        self.assertEqual(asr_session.new_part(None, "x"), "")

    def test_reason_kind_drops_the_quoted_text(self):
        self.assertEqual(asr_session.reason_kind("tail_pattern:'嗯'x5+"), "tail_pattern")
        self.assertEqual(asr_session.reason_kind("tail_pattern_norm:'ab'x5+"), "tail_pattern_norm")
        self.assertEqual(asr_session.reason_kind(""), "")


class RetentionTests(unittest.TestCase):
    """Request log retention."""

    NOW = 1_800_000_000.0

    def make(self, directory, name, age_days):
        path = os.path.join(directory, name)
        with open(path, "w") as handle:
            handle.write("x")
        stamp = self.NOW - age_days * 86400
        os.utime(path, (stamp, stamp))
        return path

    def test_retention_decisions(self):
        rows = [  # the "retention decisions" example of the asr-stream spec
            (None, "a.log", 15, False),
            (None, "b.log", 13, True),
            (None, "notes.txt", 30, True),
            ("0", "a.log", 400, True),
            ("30", "a.log", 15, True),
            ("abc", "a.log", 15, False),
        ]
        for setting, name, age, kept in rows:
            with self.subTest(setting=setting, name=name, age=age), tempfile.TemporaryDirectory() as directory:
                path = self.make(directory, name, age)
                if setting == "abc":
                    with self.assertLogs("asr_session", "ERROR"):
                        days = asr_session.retention_days(setting)
                else:
                    days = asr_session.retention_days(setting)
                asr_session.prune_request_logs(directory, days, now=self.NOW)
                self.assertEqual(os.path.exists(path), kept)

    def test_subdirectories_are_left_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            os.mkdir(os.path.join(directory, "old.log"))
            nested = os.path.join(directory, "nested")
            os.mkdir(nested)
            inner = self.make(nested, "a.log", 100)
            removed = asr_session.prune_request_logs(directory, 14, now=self.NOW)
            self.assertEqual(removed, 0)
            self.assertTrue(os.path.isdir(os.path.join(directory, "old.log")))
            self.assertTrue(os.path.exists(inner))


def speech_or_synthetic(name, seconds, seed):
    """int16 16 kHz mono: a bench clip when present (bench/data is not in git), otherwise noise bursts and silence."""
    clip = Path(__file__).resolve().parent / "bench" / "data" / name / "clip.wav"
    if clip.exists():
        with wave.open(str(clip)) as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2):
                return np.frombuffer(w.readframes(seconds * 16000), dtype=np.int16).copy()
    rng = np.random.default_rng(seed)
    audio = np.zeros(seconds * 16000, dtype=np.int16)
    for start in range(0, len(audio), 32000):
        audio[start:start + 16000] = rng.normal(0, 3000, 16000).astype(np.int16)  # 1 s on, 1 s off
    return audio


def chunks(audio):
    return [audio[i:i + CHUNK] for i in range(0, len(audio), CHUNK)]


@unittest.skipUnless(os.path.exists(os.path.join(VAD_MODEL_DIR, "cmvn.ark")), "VAD model not found (run in the ASR container)")
class PerConnectionVadTests(unittest.TestCase):
    """Per-connection speech detection: one connection's audio never changes another's detection."""

    @classmethod
    def setUpClass(cls):
        from fireredvad import FireRedStreamVad, FireRedStreamVadConfig
        config = FireRedStreamVadConfig(use_gpu=False, smooth_window_size=5, speech_threshold=0.4, pad_start_frame=5,
                                        min_speech_frame=8, max_speech_frame=2000, min_silence_frame=70, chunk_max_frame=30000)
        cls.template = FireRedStreamVad.from_pretrained(VAD_MODEL_DIR, config)
        cls.a = speech_or_synthetic("en_sinek", 12, 1)
        cls.b = speech_or_synthetic("ja_bluu", 12, 2)
        clips = Path(__file__).resolve().parent / "bench" / "data"
        cls.real_speech = all((clips / name / "clip.wav").exists() for name in ("en_sinek", "ja_bluu"))

    def alone(self, audio):
        vad = asr_session.new_stream_vad(self.template)
        return [r for chunk in chunks(audio) for r in vad.detect_chunk(chunk)]

    def test_connections_share_the_weights_but_not_the_state(self):
        first, second = asr_session.new_stream_vad(self.template), asr_session.new_stream_vad(self.template)
        self.assertIs(first.vad_model, second.vad_model)
        self.assertIs(first.vad_model, self.template.vad_model)
        self.assertIsNot(first.audio_feat, second.audio_feat)
        self.assertIsNot(first.postprocessor, second.postprocessor)
        self.assertIsNone(first.model_caches)

    def test_interleaved_audio_gives_the_same_detection_as_separate_audio(self):
        vad_a, vad_b = asr_session.new_stream_vad(self.template), asr_session.new_stream_vad(self.template)
        got_a, got_b = [], []
        for chunk_a, chunk_b in zip(chunks(self.a), chunks(self.b)):
            got_a += vad_a.detect_chunk(chunk_a)
            got_b += vad_b.detect_chunk(chunk_b)
        expected_a, expected_b = self.alone(self.a), self.alone(self.b)
        self.assertEqual(got_a, expected_a)
        self.assertEqual(got_b, expected_b)
        if self.real_speech:  # the spec's example uses speech recordings; synthetic noise need not count as speech
            self.assertTrue(any(r.is_speech_end for r in expected_a), "recording A should contain a detected sentence end")
            self.assertTrue(any(r.is_speech for r in expected_b), "recording B should contain detected speech")

    def test_a_new_connection_does_not_reset_an_ongoing_one(self):
        expected = self.alone(self.a)
        ongoing = asr_session.new_stream_vad(self.template)
        parts = chunks(self.a)
        got = []
        for index, chunk in enumerate(parts):
            if index == len(parts) // 2:
                newcomer = asr_session.new_stream_vad(self.template)
                newcomer.reset()  # what a connection with use_vad does when it starts
                newcomer.detect_chunk(self.b[:CHUNK])
            got += ongoing.detect_chunk(chunk)
        self.assertEqual(got, expected)



def asr_reachable():
    import socket
    from urllib.parse import urlsplit
    parts = urlsplit(ASR_URL)
    try:
        socket.create_connection((parts.hostname, parts.port or 80), timeout=2).close()
        return bool(os.getenv("ASR_SECRET_KEY"))
    except OSError:
        return False


@unittest.skipUnless(asr_reachable(), "the ASR service is not reachable (run in the ASR container while it is up)")
class StreamHeaderTests(unittest.TestCase):
    """Stream request identifier against the running service: refused connections leave no file behind."""

    ROOT = Path(__file__).resolve().parent

    def connect(self, endpoint, request_id, secret_key):
        """How the service ended the connection: (close code, first message or None)."""
        import asyncio
        import json
        import websockets

        async def run():
            header = {"requestId": request_id, "secret_key": secret_key, "language": "zhen", "mode": "slow",
                      "channels": 1, "sample_rate": 16000, "use_vad": False, "system_prompt": ""}
            async with websockets.connect(f"{ASR_URL}/{endpoint}", ping_interval=None) as ws:
                await ws.send(json.dumps(header))
                first = None
                try:
                    while True:
                        message = await asyncio.wait_for(ws.recv(), 15)
                        first = first or json.loads(message)
                except websockets.ConnectionClosed as closed:
                    return (closed.rcvd.code if closed.rcvd else None), first
        return asyncio.run(run())

    def files(self):
        return set((self.ROOT / "logs" / "requests").glob("*")) | set(self.ROOT.glob("*.log")) | set((self.ROOT / "logs").glob("*.log"))

    def test_unsafe_identifier_is_rejected_before_any_file_is_created(self):
        for endpoint in ("asr_stream_api_v0", "asr_stream_api_v1"):
            with self.subTest(endpoint=endpoint):
                before = self.files()
                code, first = self.connect(endpoint, "../../outside", os.environ["ASR_SECRET_KEY"])
                self.assertEqual((code, first), (1008, {"status": "error", "msg": "invalid requestId"}))
                self.assertEqual(self.files(), before)
                self.assertFalse((self.ROOT / "outside.log").exists())

    def stream_clip(self, request_id, retain):
        """Stream 15 s of a bench recording; returns every text the service sent back."""
        import asyncio
        import json
        import websockets
        audio = speech_or_synthetic("en_sinek", 15, 1)
        header = {"requestId": request_id, "secret_key": os.environ["ASR_SECRET_KEY"], "language": "zhen", "mode": "slow",
                  "channels": 1, "sample_rate": 16000, "use_vad": False, "system_prompt": ""}
        if retain is not None:
            header["retain"] = retain

        async def run():
            texts = []
            async with websockets.connect(f"{ASR_URL}/asr_stream_api_v1", ping_interval=None, max_size=None) as ws:
                await ws.send(json.dumps(header))
                pcm = audio.tobytes()
                for i in range(0, len(pcm), 5120):  # 0.16 s, like the browser, sent as fast as the service takes it
                    await ws.send(pcm[i:i + 5120])
                await ws.send("YOUDAO_ONETIME_ASR_STREAM_EOS")
                try:
                    while True:
                        msg = json.loads(await asyncio.wait_for(ws.recv(), 30)).get("msg")
                        if isinstance(msg, dict) and msg.get("text"):
                            texts.append(msg["text"])
                except (websockets.ConnectionClosed, asyncio.TimeoutError):
                    pass
            return texts
        return asyncio.run(run())

    @unittest.skipUnless((Path(__file__).resolve().parent / "bench" / "data" / "en_sinek" / "clip.wav").exists(),
                         "bench/data/en_sinek/clip.wav is not here (bench/data is not in git)")
    def test_request_logs_hold_no_recognized_text(self):
        import uuid
        for retain in (False, None):  # 即時翻譯, then a meeting
            with self.subTest(retain=retain):
                request_id = f"log-text-test-{uuid.uuid4().hex[:8]}"
                texts = self.stream_clip(request_id, retain)
                self.assertTrue(texts, "the recording should be recognized")
                log = (self.ROOT / "logs" / "requests" / f"{request_id}.log").read_text(encoding="utf-8")
                self.assertIn("chars=", log)
                self.assertNotIn("text=", log)
                # Short pieces ("for") also occur in the fixed log wording ("for next"); 8+ characters cannot.
                long_texts = [text.strip() for text in texts if len(text.strip()) >= 8]
                self.assertTrue(long_texts)
                for text in long_texts:
                    self.assertNotIn(text, log)

    def test_wrong_secret_creates_no_log_file(self):
        for endpoint in ("asr_stream_api_v0", "asr_stream_api_v1"):
            with self.subTest(endpoint=endpoint):
                request_id = f"wrong-secret-test-{endpoint[-2:]}"
                code, _ = self.connect(endpoint, request_id, os.environ["ASR_SECRET_KEY"] + "-wrong")
                self.assertEqual(code, 4401)
                self.assertFalse((self.ROOT / "logs" / "requests" / f"{request_id}.log").exists())


if __name__ == "__main__":
    unittest.main()
