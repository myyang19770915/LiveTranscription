import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from server import (TO_TRADITIONAL, TranslationRequest, app, detect_pair_language, resolve_translation_direction,
                    translation_backend, translation_payload)
from translation_quality import consolidate_terms, parse_discovered_terms, policy


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
            yield json.dumps(message if isinstance(message, dict) else {"msg": {"text": message}})


class FakeTranslationClient:
    request = None

    def __init__(self, **_):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def post(self, _url, json, headers=None):
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
    def stream(self, _method, _url, json, headers=None):
        FakeTranslationClient.request = json
        return FakeStreamResponse()


class WebAppTests(unittest.TestCase):
    def test_bilingual_detection_falls_back_when_asr_mislabels_chinese(self):
        self.assertEqual(detect_pair_language("谢谢，我会准时参加", "English"), "zh")
        self.assertEqual(detect_pair_language("こんにちは", ""), "ja")
        self.assertEqual(detect_pair_language("明日", "Japanese"), "ja")
        self.assertEqual(detect_pair_language("", "English", "zh"), "zh")
    def test_bilingual_direction_uses_acoustic_language_for_shared_kanji(self):
        for text, detected, expected in [("你好", "zh", ("zh", "ja")), ("明日", "ja", ("ja", "zh")), ("こんにちは", "", ("ja", "zh")), ("謝謝", "", ("zh", "ja"))]:
            with self.subTest(text=text):
                self.assertEqual(resolve_translation_direction(TranslationRequest(text=text, source="zh_ja", target="zh", detected_language=detected)), expected)

    def test_bilingual_gateway_restarts_language_at_pauses_and_preserves_japanese(self):
        upstream = FakeUpstream([
            {"msg": {"text": "这个会议", "language": "Chinese", "reset": True}},
            {"msg": {"text": "日本語の体験", "language": "Japanese", "reset": True}},
        ])
        with patch("server.websockets.connect", return_value=upstream):
            with TestClient(app).websocket_connect("/ws/transcribe") as socket:
                socket.send_json({"language": "zh_ja"})
                first, second = socket.receive_json(), socket.receive_json()
        self.assertEqual(first["detectedLanguage"], "zh")
        self.assertEqual(second["detectedLanguage"], "ja")
        self.assertEqual(second["displayText"], "這個會議日本語の体験")
        header = json.loads(upstream.sent[0])
        self.assertEqual(header["language"], "zhen")
        self.assertTrue(header["use_vad"])

    def test_bilingual_translation_resolves_opposite_target(self):
        with patch("server.httpx.AsyncClient", FakeTranslationClient):
            response = TestClient(app).post("/api/translate", json={"text": "你好", "source": "zh_ja", "target": "zh", "detected_language": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["target"], "ja")
        self.assertIn("Japanese", FakeTranslationClient.request["messages"][1]["content"])

    def test_bilingual_streaming_reports_direction_and_traditional_output(self):
        with patch("server.httpx.AsyncClient", FakeStreamingClient):
            response = TestClient(app).post("/api/translate/stream", json={"text": "明日", "source": "zh_ja", "target": "ja", "detected_language": "ja"})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        self.assertEqual(events[-1]["source"], "ja")
        self.assertEqual(events[-1]["target"], "zh")
        self.assertEqual(events[-1]["text"], "這個會議可以實時翻譯。")

    def test_traditional_conversion(self):
        self.assertEqual(TO_TRADITIONAL.convert("这个会议支持翻译。"), "這個會議支持翻譯。")
        self.assertEqual(TO_TRADITIONAL.convert("我向店员说明了付款方式，很明了。"), "我向店員說明了付款方式，很明瞭。")
        # Characters only: no IT-jargon phrase rewrites, no doubled 演演算法.
        self.assertEqual(TO_TRADITIONAL.convert("恶性循环，扩展功能，用一个演算法"), "惡性循環，擴展功能，用一個演算法")

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
        self.assertEqual(second["displayText"], "這個會議支持實時翻譯。")
        self.assertEqual(json.loads(upstream.sent[0])["language"], "zhen")

    def test_websocket_corrects_listed_mishearings_and_sends_asr_only_correct_terms(self):
        upstream = FakeUpstream(["我有一个耐的官方账号，", "接到nine，不是ninety。"])
        with patch("server.websockets.connect", return_value=upstream):
            with TestClient(app).websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"language": "zhen", "system_prompt": "LINE=耐/nine、n8n"})
                websocket.receive_json()
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "我有一個LINE的官方賬號，接到LINE，不是ninety。")
        self.assertEqual(json.loads(upstream.sent[0])["system_prompt"], "LINE、n8n")

    def test_translation_source_corrects_mishearings_and_glossary_lists_terms_only(self):
        body = TranslationRequest(text="耐的官方帳號接到nine", source="zh", target="ja", glossary="LINE=耐/nine、n8n")
        messages = translation_payload(body)["messages"]
        self.assertTrue(messages[1]["content"].endswith("Speech: LINE的官方帳號接到LINE"))
        self.assertIn("LINE, n8n", messages[0]["content"])
        self.assertNotIn("nine", messages[0]["content"])

    def test_previous_span_is_context_only_and_not_part_of_the_speech(self):
        body = TranslationRequest(text="它會自動安裝好。", source="zh", target="ja", history="點上面一鍵安裝推理引擎。", history_translation="上の推論エンジンをインストールします。")
        user = translation_payload(body)["messages"][1]["content"]
        self.assertIn("do not translate or repeat): 點上面一鍵安裝推理引擎。", user)
        self.assertIn("推論エンジン", user)
        self.assertTrue(user.endswith("Speech: 它會自動安裝好。"))
        self.assertNotIn("Already translated", translation_payload(TranslationRequest(text="你好", source="zh", target="ja"))["messages"][1]["content"])

    def test_cloud_refinement_is_opt_in_and_sends_only_openai_options(self):
        body = TranslationRequest(text="它會自動安裝好。", source="zh", target="ja", refine=True)
        payload = translation_payload(body)
        with patch.multiple("server", REFINE_URL="", REFINE_MODEL=""):
            url, headers, sent = translation_backend(body, payload)
            self.assertTrue(url.endswith("/v1/chat/completions") and "translate" in url)
            self.assertFalse(TestClient(app).get("/api/config").json()["cloudRefine"])
        with patch.multiple("server", REFINE_URL="https://cloud.example/v1", REFINE_MODEL="big", REFINE_KEY="k"):
            url, headers, sent = translation_backend(body, payload)
            self.assertEqual(url, "https://cloud.example/v1/chat/completions")
            self.assertEqual((sent["model"], headers["Authorization"]), ("big", "Bearer k"))
            self.assertNotIn("chat_template_kwargs", sent)
            # Live drafts and finals never leave the machine.
            self.assertIn("translate", translation_backend(body.model_copy(update={"refine": False}), payload)[0])
            self.assertTrue(TestClient(app).get("/api/config").json()["cloudRefine"])

    def test_following_speech_is_context_after_the_speech_and_never_the_speech(self):
        body = TranslationRequest(text="它沒有兩歲孩子的，", source="zh", target="ja", following="物理知識的擁有，比如說斜坡會滾")
        user = translation_payload(body)["messages"][1]["content"]
        # Before Speech: after it, the model translated the next words as part of this span.
        note, _, speech = user.partition("Speech: ")
        self.assertEqual(speech, "它沒有兩歲孩子的，")
        self.assertIn("do not include them", note)
        self.assertTrue(note.endswith("物理知識的擁有，比如說斜坡會滾\n"))
        # Drafts carry no following text, so they share the final's cached prefix up to Speech.
        draft = translation_payload(body.model_copy(update={"following": "", "draft": True}))["messages"][1]["content"]
        self.assertTrue(draft.endswith("Speech: 它沒有兩歲孩子的，"))

    def test_learned_terms_are_grounded_voted_and_only_hints(self):
        text = "こちらのサンザジャパンの袋です。アナザージャパンは店の名前です。クレジットカードで払います。"
        output = json.dumps({"terms": [
            {"said": "アナザージャパン", "heard": ["サンザジャパン", "ガッツァジャパン"]},  # ガッツァ is not in this text
            {"said": "クレジットカード", "heard": ["クレジット"]},  # an abbreviation, not a mishearing
            {"said": "6655円", "heard": ["2.06655円"]},  # numbers are never touched
        ]}, ensure_ascii=False)
        found = parse_discovered_terms(output, text)
        self.assertEqual(found, "アナザージャパン=サンザジャパン")
        url = json.dumps({"terms": [{"said": "Local Model", "heard": ["localmodel.com"]}, {"said": "MiniMax", "heard": ["迷你max"]}]})
        self.assertEqual(parse_discovered_terms(url, "到localmodel.com下載，迷你max也可以"), "MiniMax=迷你max")
        # One pass is not enough, and the spelling most passes chose wins over an early wrong guess.
        self.assertEqual(consolidate_terms([found]), "")
        self.assertEqual(consolidate_terms(["サンザジャパン=アナザージapan", found, found, "Luma=LTX"]), "アナザージャパン=サンザジャパン")
        # A long misheard name is replaced; an everyday word is only a hint, and only where it occurs.
        learned = "アナザージャパン=サンザジャパン、一括=一ヶ月/活で"
        messages = translation_payload(TranslationRequest(text="サンザジャパンの袋を生活で使う。一ヶ月で。", source="ja", target="zh", learned=learned))["messages"]
        self.assertTrue(messages[1]["content"].endswith("Speech: アナザージャパンの袋を生活で使う。一ヶ月で。"))
        self.assertRegex(messages[0]["content"], r"一ヶ月[^\n]*→ 一括")
        self.assertNotIn("アナザージャパン", messages[0]["content"])
        self.assertNotIn("一括", policy("袋です。", "zh", learned=learned))

    def test_terms_endpoint_returns_this_pass_and_the_voted_glossary(self):
        class TermsClient(FakeTranslationClient):
            async def post(self, _url, json, headers=None):
                FakeTranslationClient.request = json
                return type("R", (), {"raise_for_status": lambda s: None, "json": lambda s: {"choices": [{"message": {"content":
                    '{"terms":[{"said":"MiniMax","heard":["迷你max"]}]}'}}]}})()
        with patch("server.httpx.AsyncClient", TermsClient):
            response = TestClient(app).post("/api/terms", json={"text": "我們用迷你max生成影片", "source": "zh", "previous": ["MiniMax=迷你max"]})
        self.assertEqual(response.json(), {"found": "MiniMax=迷你max", "learned": "MiniMax=迷你max", "replaced": ["迷你max"]})
        self.assertEqual(FakeTranslationClient.request["response_format"]["type"], "json_schema")

    def test_spoken_decimal_split_by_asr_punctuation_is_rejoined(self):
        upstream = FakeUpstream(["請下載flash二。", "點零就可以了。版本二。接著點選"])
        with patch("server.websockets.connect", return_value=upstream):
            with TestClient(app).websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"language": "zhen"})
                websocket.receive_json()
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "請下載flash二點零就可以了。版本二。接著點選")

    def test_meeting_files_are_saved_to_output_and_names_are_restricted(self):
        with tempfile.TemporaryDirectory() as folder, patch("server.OUTPUT_DIR", Path(folder)):
            client = TestClient(app)
            saved = client.put("/api/meetings/meeting-2026-11-01T00-41-23.webm", content=b"audio")
            rejected = client.put("/api/meetings/notes.sh", content=b"x")
            self.assertEqual(saved.status_code, 200)
            self.assertEqual((Path(folder) / "meeting-2026-11-01T00-41-23.webm").read_bytes(), b"audio")
            self.assertEqual(rejected.status_code, 400)
            self.assertEqual(sorted(p.name for p in Path(folder).iterdir()), ["meeting-2026-11-01T00-41-23.webm"])

    def test_asr_echo_of_the_context_prompt_is_removed_from_the_transcript(self):
        upstream = FakeUpstream(["白色T恤LocalModel、Hugging", " Face、Qwen、Wan、需要下載模型，Qwen、Wan都可以。"])
        with patch("server.websockets.connect", return_value=upstream):
            with TestClient(app).websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"language": "zhen", "system_prompt": "LocalModel、Hugging Face=浩信飛象、Qwen、Wan"})
                websocket.receive_json()
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "白色T恤需要下載模型，Qwen、Wan都可以。")

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

    def test_streaming_final_failing_checks_after_repair_is_kept_not_rejected(self):
        # A rejected final is retried forever and stalls every later sentence.
        with patch("server.httpx.AsyncClient", FakeStreamingClient):
            response = TestClient(app).post("/api/translate/stream", json={"text": "我們在做資料搬運。", "source": "zh", "target": "ja"})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        self.assertNotIn("error", events[-1])
        self.assertTrue(events[-1]["done"])
        self.assertIn("Mandatory checks", FakeTranslationClient.request["messages"][0]["content"])

    def test_streaming_same_language_skips_model(self):
        response = TestClient(app).post("/api/translate/stream", json={"text": "这个会议", "source": "zh", "target": "zh"})
        event = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
        self.assertEqual(event, {"text": "這個會議", "done": True})


if __name__ == "__main__":
    unittest.main()
