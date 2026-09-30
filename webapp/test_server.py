import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from server import TO_TRADITIONAL, app


class FakeUpstream:
    def __init__(self, messages=None):
        self.sent = []
        self.messages = messages or ["这个会议", "支持实时翻译。"]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def send(self, message):
        self.sent.append(message)

    async def __aiter__(self):
        for message in self.messages:
            yield json.dumps({"msg": {"text": message}})


class FakeTranslationClient:
    request = None

    def __init__(self, **_):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def post(self, _url, json):
        FakeTranslationClient.request = json
        return FakeTranslationResponse()


class FakeTranslationResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": "这个会议可以实时翻译。"}}]}


class FakeStreamResponse:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def raise_for_status(self):
        pass

    async def aiter_lines(self):
        for part in ("这个", "会议", "可以实时翻译。"):
            yield "data: " + json.dumps({"choices": [{"delta": {"content": part}}]}, ensure_ascii=False)
        yield "data: [DONE]"


class FakeStreamingClient(FakeTranslationClient):
    def stream(self, _method, _url, json):
        FakeTranslationClient.request = json
        return FakeStreamResponse()


class WebAppTests(unittest.TestCase):
    def test_traditional_conversion(self):
        self.assertEqual(TO_TRADITIONAL.convert("这个会议支持翻译。"), "這個會議支援翻譯。")

    def test_same_language_translation_is_traditional(self):
        response = TestClient(app).post("/api/translate", json={"text": "这个会议", "source": "zh", "target": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translatedText"], "這個會議")

    def test_websocket_sends_cumulative_traditional_transcript(self):
        upstream = FakeUpstream()
        with patch("server.websockets.connect", return_value=upstream):
            with TestClient(app).websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"language": "zhen"})
                first = websocket.receive_json()
                second = websocket.receive_json()
        self.assertEqual(first["displayText"], "這個會議")
        self.assertEqual(second["displayText"], "這個會議支援實時翻譯。")
        self.assertEqual(json.loads(upstream.sent[0])["language"], "zhen")

    def test_japanese_websocket_does_not_convert_kanji(self):
        upstream = FakeUpstream(["日本語の体験"])
        with patch("server.websockets.connect", return_value=upstream):
            with TestClient(app).websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"language": "ja"})
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "日本語の体験")
        self.assertEqual(json.loads(upstream.sent[0])["language"], "Japanese")

    def test_japanese_to_chinese_translation(self):
        with patch("server.httpx.AsyncClient", FakeTranslationClient):
            response = TestClient(app).post("/api/translate", json={"text": "この会議を翻訳します。", "source": "ja", "target": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translatedText"], "這個會議可以實時翻譯。")
        self.assertIn("Japanese", FakeTranslationClient.request["messages"][1]["content"])
        self.assertIn("Traditional Chinese", FakeTranslationClient.request["messages"][1]["content"])
        self.assertFalse(FakeTranslationClient.request["chat_template_kwargs"]["enable_thinking"])

    def test_streaming_draft_emits_traditional_snapshots(self):
        with patch("server.httpx.AsyncClient", FakeStreamingClient):
            response = TestClient(app).post("/api/translate/stream", json={"text": "This meeting", "source": "en", "target": "zh", "draft": True})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        self.assertEqual(response.status_code, 200)
        self.assertEqual(events[-1], {"text": "這個會議可以實時翻譯。", "done": True})
        self.assertTrue(any(not event["done"] for event in events))
        self.assertTrue(FakeTranslationClient.request["stream"])
        self.assertIn("unfinished speech", FakeTranslationClient.request["messages"][1]["content"])

    def test_streaming_same_language_skips_model(self):
        response = TestClient(app).post("/api/translate/stream", json={"text": "这个会议", "source": "zh", "target": "zh"})
        event = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
        self.assertEqual(event, {"text": "這個會議", "done": True})


if __name__ == "__main__":
    unittest.main()
