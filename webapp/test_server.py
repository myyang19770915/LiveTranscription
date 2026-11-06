import asyncio
import base64
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import time
import wave
import zipfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import psycopg
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from ldap3 import MOCK_SYNC, OFFLINE_AD_2012_R2, Connection, Server
from ldap3.core.exceptions import LDAPSocketOpenError

import auth
import db
import mai_asr
import meeting_audio
import minutes
from server import (TO_TRADITIONAL, TranscriptDisplay, TranslationRequest, app, asr_engine, detect_pair_language,
                    resolve_translation_direction, translation_backend, translation_payload)
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


def test_database_url() -> str:
    """The compose database, but its separate yuqiao_test database, created on first use."""
    main = db.DATABASE_URL or os.environ["DATABASE_URL"]
    with psycopg.connect(main, autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = 'yuqiao_test'").fetchone():
            conn.execute("CREATE DATABASE yuqiao_test")
    return main.rsplit("/", 1)[0] + "/yuqiao_test"


TEST_DATABASE_URL = test_database_url()
db.DATABASE_URL = TEST_DATABASE_URL


class DatabaseTestCase(unittest.TestCase):
    """Every test starts from empty application tables in yuqiao_test."""

    def setUp(self):
        asyncio.run(db.check())
        with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
            tables = [row[0] for row in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'")]
            if tables:
                conn.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")

    def query(self, sql, params=()):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute(sql, params).fetchall()


class FakeLdap:
    """An ldap3 MOCK_SYNC directory with a service account; counts every bind attempt."""

    def __init__(self):
        self.server = Server("fake", get_info=OFFLINE_AD_2012_R2)
        self.binds = 0
        self.unreachable = False
        seed = Connection(self.server, user="cn=svc,dc=corp", password="svcpw", client_strategy=MOCK_SYNC)
        seed.strategy.add_entry("cn=svc,dc=corp", {"userPassword": "svcpw", "sAMAccountName": "svc"})
        self.seed = seed

    def add(self, username, password, display_name=""):
        attributes = {"userPassword": password, "sAMAccountName": username, "objectClass": "person"}
        if display_name:
            attributes["displayName"] = display_name
        self.seed.strategy.add_entry(f"cn={username},ou=people,dc=corp", attributes)

    def connection(self, user, password):
        if self.unreachable:
            raise LDAPSocketOpenError("unreachable")
        fake = self

        class Counted(Connection):
            def bind(self, *args, **kwargs):
                fake.binds += 1
                return super().bind(*args, **kwargs)
        return Counted(self.server, user=user, password=password, client_strategy=MOCK_SYNC)

    def patches(self):
        return [patch("auth.ldap_connection", self.connection), patch("auth.LDAP_URL", "ldap://fake"),
                patch("auth.LDAP_BIND_DN", "cn=svc,dc=corp"), patch("auth.LDAP_BIND_PASSWORD", "svcpw"),
                patch("auth.LDAP_BASE_DN", "dc=corp"), patch("auth.LDAP_USER_DN_TEMPLATE", ""),
                patch("auth.LDAP_USER_FILTER", "(sAMAccountName={username})"), patch("auth.LDAP_DISPLAY_ATTR", "displayName"),
                patch("auth.ADMIN_USERS", frozenset({"admin"}))]


class AccountTestCase(DatabaseTestCase):
    """A fake LDAP with alice/pw-alice (王愛麗), bob/pw-bob and admin/pw-admin."""

    def setUp(self):
        super().setUp()
        self.ldap = FakeLdap()
        self.ldap.add("alice", "pw-alice", "王愛麗")
        self.ldap.add("bob", "pw-bob")
        self.ldap.add("admin", "pw-admin", "管理員")
        for fake in self.ldap.patches():
            fake.start()
            self.addCleanup(fake.stop)
        # Meeting files (recordings included) go to a scratch folder, never the real output/.
        self.output = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.output, ignore_errors=True)
        output = patch("team_access.OUTPUT_DIR", self.output)
        output.start()
        self.addCleanup(output.stop)

    def team(self, name, *members):
        """Create a team directly in the database; returns its id."""
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            team_id = conn.execute("INSERT INTO teams (name, name_key) VALUES (%s, %s) RETURNING id", (name, name.casefold())).fetchone()[0]
            for member in members:
                conn.execute("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, %s, 'admin')", (team_id, member))
        return team_id

    def meeting_id(self, username="alice"):
        """A meeting of a team the user belongs to (created once per test)."""
        if not hasattr(self, "_meeting"):
            team_id = self.team("測試團隊", username)
            self._meeting = self.signed_in(username).post("/api/meetings", json={"team_id": team_id, "language": "zh"}).json()["id"]
        return self._meeting

    def signed_in(self, username, password=None):
        client = TestClient(app)
        response = client.post("/api/login", json={"username": username, "password": password or f"pw-{username}"})
        self.assertEqual(response.status_code, 200, response.text)
        return client


class WebAppTests(AccountTestCase):
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
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as socket:
                socket.send_json({"meeting_id": self.meeting_id(), "language": "zh_ja"})
                first, second = socket.receive_json(), socket.receive_json()
        self.assertEqual(first["detectedLanguage"], "zh")
        self.assertEqual(second["detectedLanguage"], "ja")
        self.assertEqual(second["displayText"], "這個會議日本語の体験")
        header = json.loads(upstream.sent[0])
        self.assertEqual(header["language"], "zhen")
        self.assertTrue(header["use_vad"])

    def test_bilingual_translation_resolves_opposite_target(self):
        with patch("server.httpx.AsyncClient", FakeTranslationClient):
            response = self.signed_in("alice").post("/api/translate", json={"text": "你好", "source": "zh_ja", "target": "zh", "detected_language": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["target"], "ja")
        self.assertIn("Japanese", FakeTranslationClient.request["messages"][1]["content"])

    def test_bilingual_streaming_reports_direction_and_traditional_output(self):
        with patch("server.httpx.AsyncClient", FakeStreamingClient):
            response = self.signed_in("alice").post("/api/translate/stream", json={"text": "明日", "source": "zh_ja", "target": "ja", "detected_language": "ja"})
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
        response = self.signed_in("alice").post("/api/translate", json={"text": "这个会议", "source": "zh", "target": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translatedText"], "這個會議")

    def test_websocket_sends_cumulative_traditional_transcript(self):
        upstream = FakeUpstream()
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": self.meeting_id(), "language": "zhen"})
                first = websocket.receive_json()
                second = websocket.receive_json()
        self.assertEqual(first["displayText"], "這個會議")
        self.assertEqual(second["displayText"], "這個會議支持實時翻譯。")
        self.assertEqual(json.loads(upstream.sent[0])["language"], "zhen")

    def test_websocket_corrects_listed_mishearings_and_sends_asr_only_correct_terms(self):
        upstream = FakeUpstream(["我有一个耐的官方账号，", "接到nine，不是ninety。"])
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": self.meeting_id(), "language": "zhen", "system_prompt": "LINE=耐/nine、n8n"})
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
            self.assertFalse(self.signed_in("alice").get("/api/config").json()["cloudRefine"])
        with patch.multiple("server", REFINE_URL="https://cloud.example/v1", REFINE_MODEL="big", REFINE_KEY="k"):
            url, headers, sent = translation_backend(body, payload)
            self.assertEqual(url, "https://cloud.example/v1/chat/completions")
            self.assertEqual((sent["model"], headers["Authorization"]), ("big", "Bearer k"))
            self.assertNotIn("chat_template_kwargs", sent)
            # Live drafts and finals never leave the machine.
            self.assertIn("translate", translation_backend(body.model_copy(update={"refine": False}), payload)[0])
            self.assertTrue(self.signed_in("alice").get("/api/config").json()["cloudRefine"])

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
            response = self.signed_in("alice").post("/api/terms", json={"text": "我們用迷你max生成影片", "source": "zh", "previous": ["MiniMax=迷你max"]})
        self.assertEqual(response.json(), {"found": "MiniMax=迷你max", "learned": "MiniMax=迷你max", "replaced": ["迷你max"]})
        self.assertEqual(FakeTranslationClient.request["response_format"]["type"], "json_schema")

    def test_spoken_decimal_split_by_asr_punctuation_is_rejoined(self):
        upstream = FakeUpstream(["請下載flash二。", "點零就可以了。版本二。接著點選"])
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": self.meeting_id(), "language": "zhen"})
                websocket.receive_json()
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "請下載flash二點零就可以了。版本二。接著點選")

    def test_meeting_files_are_saved_per_team_and_meeting_and_kinds_are_restricted(self):
        with tempfile.TemporaryDirectory() as folder, patch("team_access.OUTPUT_DIR", Path(folder)):
            client, meeting = self.signed_in("alice"), self.meeting_id()
            saved = client.put(f"/api/meetings/{meeting}/files/recording", content=b"audio", headers={"content-type": "audio/webm;codecs=opus"})
            text = client.put(f"/api/meetings/{meeting}/files/transcript", content="原文".encode(), headers={"content-type": "text/plain"})
            self.assertEqual((saved.status_code, text.status_code), (200, 200))
            team_id = self.query("SELECT team_id FROM meetings")[0][0]
            base = Path(folder) / "teams" / str(team_id) / meeting
            self.assertEqual((base / "recording.webm").read_bytes(), b"audio")
            self.assertEqual((base / "transcript.txt").read_text(encoding="utf-8"), "原文")
            self.assertEqual(client.put(f"/api/meetings/{meeting}/files/notes.sh", content=b"x").status_code, 422)
            self.assertEqual(client.put(f"/api/meetings/{meeting}/files/recording", content=b"x", headers={"content-type": "text/x-sh"}).status_code, 415)
            self.assertEqual(sorted(p.name for p in base.iterdir()), ["recording.webm", "transcript.txt"])
            self.assertEqual(sorted(self.query("SELECT kind, bytes FROM meeting_files")), [("recording", 5), ("transcript", 6)])

    def test_saving_to_another_teams_meeting_is_404_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as folder, patch("team_access.OUTPUT_DIR", Path(folder)):
            theirs = self.team("業務", "bob")
            meeting = self.signed_in("bob").post("/api/meetings", json={"team_id": theirs, "language": "zh"}).json()["id"]
            response = self.signed_in("alice").put(f"/api/meetings/{meeting}/files/transcript", content=b"x")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(list(Path(folder).iterdir()), [])
            self.assertEqual(self.query("SELECT count(*) FROM meeting_files"), [(0,)])

    def test_asr_echo_of_the_context_prompt_is_removed_from_the_transcript(self):
        upstream = FakeUpstream(["白色T恤LocalModel、Hugging", " Face、Qwen、Wan、需要下載模型，Qwen、Wan都可以。"])
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": self.meeting_id(), "language": "zhen", "system_prompt": "LocalModel、Hugging Face=浩信飛象、Qwen、Wan"})
                websocket.receive_json()
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "白色T恤需要下載模型，Qwen、Wan都可以。")

    def test_japanese_websocket_does_not_convert_kanji(self):
        upstream = FakeUpstream(["日本語の体験"])
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": self.meeting_id(), "language": "ja"})
                result = websocket.receive_json()
        self.assertEqual(result["displayText"], "日本語の体験")
        self.assertEqual(json.loads(upstream.sent[0])["language"], "Japanese")

    def test_japanese_to_chinese_translation(self):
        with patch("server.httpx.AsyncClient", FakeTranslationClient):
            response = self.signed_in("alice").post("/api/translate", json={"text": "この会議を翻訳します。", "source": "ja", "target": "zh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["translatedText"], "這個會議可以實時翻譯。")
        self.assertIn("Japanese", FakeTranslationClient.request["messages"][1]["content"])
        self.assertIn("Traditional Chinese", FakeTranslationClient.request["messages"][1]["content"])
        self.assertFalse(FakeTranslationClient.request["chat_template_kwargs"]["enable_thinking"])

    def test_streaming_draft_emits_traditional_snapshots(self):
        with patch("server.httpx.AsyncClient", FakeStreamingClient):
            response = self.signed_in("alice").post("/api/translate/stream", json={"text": "This meeting", "source": "en", "target": "zh", "draft": True})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        self.assertEqual(response.status_code, 200)
        self.assertEqual(events[-1], {"text": "這個會議可以實時翻譯。", "done": True})
        self.assertTrue(any(not event["done"] for event in events))
        self.assertTrue(FakeTranslationClient.request["stream"])
        self.assertIn("unfinished speech", FakeTranslationClient.request["messages"][1]["content"])

    def test_streaming_final_failing_checks_after_repair_is_kept_not_rejected(self):
        # A rejected final is retried forever and stalls every later sentence.
        with patch("server.httpx.AsyncClient", FakeStreamingClient):
            response = self.signed_in("alice").post("/api/translate/stream", json={"text": "我們在做資料搬運。", "source": "zh", "target": "ja"})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        self.assertNotIn("error", events[-1])
        self.assertTrue(events[-1]["done"])
        self.assertIn("Mandatory checks", FakeTranslationClient.request["messages"][0]["content"])

    def test_streaming_same_language_skips_model(self):
        response = self.signed_in("alice").post("/api/translate/stream", json={"text": "这个会议", "source": "zh", "target": "zh"})
        event = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
        self.assertEqual(event, {"text": "這個會議", "done": True})


class FakeBrowser:
    def __init__(self):
        self.sent = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


class MaiTests(AccountTestCase):
    def test_realtime_url_comes_from_the_portal_rest_endpoint(self):
        rest = "https://res1.openai.azure.com/openai/deployments/MAI/audio/transcriptions?api-version=2025-03-01-preview"
        self.assertEqual(mai_asr.realtime_url(rest), "wss://res1.services.ai.azure.com/mai/v1/realtime?intent=transcription")
        self.assertEqual(mai_asr.realtime_url("wss://x.example/mai/v1/realtime"), "wss://x.example/mai/v1/realtime")
        self.assertEqual(mai_asr.realtime_url(""), "")

    def test_merge_marks_takes_only_punctuation_from_the_model(self):
        merge = lambda a, b: mai_asr.merge_marks(a, b, TO_TRADITIONAL.convert)
        self.assertEqual(merge("或许你会说那是你的年代", "或許你會說，那是你的年代。"), "或许你会说，那是你的年代。")
        self.assertEqual(merge("用AI agent做", "用 AI agent 做，"), "用AI agent做，")
        self.assertEqual(merge("我们，开始", "我们，开始。"), "我们，开始。")
        self.assertEqual(merge("三人陈尸浴室", "三人沉屍於世。"), "")  # a changed word drops the answer
        self.assertEqual(merge("开始", "开始研究。"), "")

    def test_engine_choice_keeps_chinese_local_in_hybrid_mode(self):
        with patch("mai_asr.configured", return_value=True):
            self.assertEqual(asr_engine("hybrid", "ja"), "mai")
            self.assertEqual(asr_engine("hybrid", "en"), "mai")
            for language in ("zh", "auto", "zh_ja"):
                self.assertEqual(asr_engine("hybrid", language), "local")
            self.assertEqual(asr_engine("mai", "zh"), "mai")
            self.assertEqual(asr_engine("local", "ja"), "local")
        with patch("mai_asr.configured", return_value=False):
            self.assertEqual(asr_engine("mai", "ja"), "local")
        self.assertIn("mai", self.signed_in("alice").get("/api/config").json())

    def run_items(self, language, events, punctuate=None, speech=False):
        browser = FakeBrowser()
        bridge = mai_asr.MaiBridge(browser, language, TranscriptDisplay(language, ""), punctuate)
        bridge.vad.speech, bridge.vad.silence = speech, 1.0
        bridge.items.extend(True for event in events if event["type"].endswith("completed"))

        async def go():
            for event in events + [None]:
                await bridge.events.put(event)
            await bridge.process()
        asyncio.run(go())
        return browser.sent

    @staticmethod
    def item(*deltas):
        events = [{"type": "conversation.item.input_audio_transcription.delta", "delta": d} for d in deltas]
        return events + [{"type": "conversation.item.input_audio_transcription.completed", "transcript": "".join(deltas)}]

    def test_mai_chinese_item_is_shown_in_traditional_and_closed_at_the_pause(self):
        sent = self.run_items("zh", self.item("这个会议", "支持实时翻译"))
        self.assertEqual(sent[1]["displayText"], "這個會議支持實時翻譯")
        self.assertEqual((sent[-1]["displayText"], sent[-1]["msg"]["speech_end"]), ("這個會議支持實時翻譯。", True))
        resumed = self.run_items("ja", self.item("お腹に今二人目がいるんですけれども"), speech=True)
        self.assertEqual(resumed[-1]["displayText"], "お腹に今二人目がいるんですけれども、")

    def test_cloud_punctuation_rewrites_only_the_committed_item(self):
        async def punctuate(context, text, pause):
            self.assertEqual((context, text), ("第一句。", "或许你会说那是你的年代"))
            return mai_asr.merge_marks(text, "或許你會說，那是你的年代？", TO_TRADITIONAL.convert)
        sent = self.run_items("zh", self.item("第一句") + self.item("或许你会说", "那是你的年代"), punctuate=self.first_then(punctuate))
        self.assertEqual(sent[-1]["displayText"], "第一句。或許你會說，那是你的年代？")
        self.assertTrue(sent[-1]["msg"]["speech_end"])

    @staticmethod
    def first_then(punctuate):
        calls = []

        async def wrapper(context, text, pause):
            calls.append(text)
            return text + "。" if len(calls) == 1 else await punctuate(context, text, pause)
        return wrapper

    def test_english_is_left_to_mai_and_never_committed_at_pauses(self):
        self.assertNotIn("en", mai_asr.PAUSE_COMMITS)
        sent = self.run_items("en", self.item("That means that despite", " all of these things."))
        self.assertEqual(sent[-1]["msg"], {"text": "", "reset": False, "speech_end": True, "language": ""})
        self.assertEqual(sent[-2]["displayText"], "That means that despite all of these things.")


class MeetingAudioTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)

    def test_ten_seconds_of_audio_make_a_ten_second_wav(self):
        audio = meeting_audio.MeetingAudio(self.folder / "audio.wav")
        for _ in range(10):
            audio.write(b"\x01\x00" * 16000)
        self.assertEqual(audio.position_ms, 10000)
        audio.close()
        with wave.open(str(self.folder / "audio.wav")) as w:
            self.assertEqual((w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()), (16000, 1, 2, 160000))

    def test_file_left_without_final_header_is_repaired_and_readable(self):
        audio = meeting_audio.MeetingAudio(self.folder / "audio.wav")
        audio.write(bytes(range(256)) * 250)       # 64000 bytes = 2 s
        audio.file.flush()                          # the app stops here: header still says 0 bytes
        clip = meeting_audio.read_range(self.folder / "audio.wav", 500, 1500)
        with wave.open(io.BytesIO(clip)) as w:
            self.assertEqual(w.getnframes(), 16000)
        self.assertEqual(meeting_audio.duration_ms(self.folder / "audio.wav"), 2000)

    def test_range_is_clamped_to_the_recording(self):
        audio = meeting_audio.MeetingAudio(self.folder / "audio.wav")
        audio.write(b"\x00\x00" * 16000 * 3)      # 3 s
        audio.close()
        for (start, end), expected_ms in {(-1500, 500): 500, (2500, 9000): 500, (5000, 6000): 0, (1000, 1000): 0}.items():
            with wave.open(io.BytesIO(meeting_audio.read_range(self.folder / "audio.wav", start, end))) as w:
                self.assertEqual(w.getnframes() // 16, expected_ms, (start, end))


class AudioAfter(FakeUpstream):
    """Answers once it has received `wait` bytes of audio, as ASR answers after hearing speech."""

    def __init__(self, wait):
        super().__init__(["這個會議"])
        self.wait, self.received, self.heard = wait, 0, asyncio.Event()

    async def send(self, message):
        await super().send(message)
        if isinstance(message, bytes):
            self.received += len(message)
            if self.received >= self.wait:
                self.heard.set()

    async def __aiter__(self):
        await self.heard.wait()
        async for message in super().__aiter__():
            yield message


class MeetingTimelineTests(AccountTestCase):
    def recording(self):
        meeting = self.meeting_id()
        team_id = self.query("SELECT team_id FROM meetings WHERE id = %s", (meeting,))[0][0]
        return meeting, self.output / "teams" / str(team_id) / meeting / "audio.wav"

    def test_local_engine_records_what_asr_receives_and_stamps_audio_ms(self):
        meeting, path = self.recording()
        pcm = bytes(range(256)) * 375  # 96000 bytes = 3 s
        upstream = AudioAfter(len(pcm))
        # A running client keeps its event loop alive, as uvicorn does, so the gateway can finish the recording.
        with patch("server.websockets.connect", return_value=upstream), self.signed_in("alice") as client:
            with client.websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": meeting, "language": "zh"})
                for i in range(0, len(pcm), 5120):
                    websocket.send_bytes(pcm[i:i + 5120])
                event = websocket.receive_json()
            for _ in range(50):  # the gateway finishes the recording just after the socket closes
                if self.query("SELECT ended_at IS NOT NULL FROM meetings")[0][0]:
                    break
                time.sleep(0.05)
        self.assertEqual(event["audioMs"], 3000)
        self.assertEqual(b"".join(m for m in upstream.sent if isinstance(m, bytes)), pcm)
        with wave.open(str(path)) as w:
            self.assertEqual(w.readframes(w.getnframes()), pcm)
        self.assertEqual(self.query("SELECT audio_bytes, ended_at IS NOT NULL FROM meetings"), [(96000, True)])

    def test_a_second_connection_cannot_overwrite_the_recording(self):
        meeting, path = self.recording()
        with patch("server.websockets.connect", return_value=FakeUpstream()):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": meeting, "language": "zh"})
                websocket.send_bytes(b"\x01\x00" * 100)
                websocket.receive_json()
        size = path.stat().st_size
        with patch("server.websockets.connect") as upstream:
            with self.assertRaises(WebSocketDisconnect) as closed:
                with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                    websocket.send_json({"meeting_id": meeting, "language": "zh"})
                    websocket.receive_json()
        self.assertEqual(closed.exception.code, 4409)
        upstream.assert_not_called()
        self.assertEqual(path.stat().st_size, size)

    def test_mai_engine_records_the_frames_it_sends_to_mai(self):
        path = self.output / "mai.wav"
        audio = meeting_audio.MeetingAudio(path)
        frames = [b"\x02\x00" * 1600, b"\x03\x00" * 1600]

        class Browser(FakeBrowser):
            def __init__(self):
                super().__init__()
                self.events = [{"bytes": f} for f in frames] + [{"text": mai_asr.EOS}]

            async def receive(self):
                return self.events.pop(0)
        bridge = mai_asr.MaiBridge(Browser(), "en", TranscriptDisplay("en", "", audio), None)
        sent = []

        async def send(message):
            sent.append(message)
        bridge.send = send
        asyncio.run(bridge.browser_to_mai())
        audio.close()
        appended = b"".join(base64.b64decode(m["audio"]) for m in sent if m["type"] == "input_audio_buffer.append")
        self.assertEqual(appended, b"".join(frames))
        with wave.open(str(path)) as w:
            self.assertEqual(w.readframes(w.getnframes()), appended)


class ReviewTestCase(AccountTestCase):
    """alice's meeting with segments 1..n saved the way the meeting page saves them."""

    def save(self, client, meeting, segments, **extra):
        body = {"glossary": "LINE=耐", "learned": "MiniMax=迷你max", "sourceLanguage": "zh", "targetLanguage": "en", **extra,
                "segments": [{"seq": i + 1, "startMs": i * 1000, "endMs": (i + 1) * 1000, "source": source, "target": target, "detected": ""}
                             for i, (source, target) in enumerate(segments)]}
        return client.put(f"/api/meetings/{meeting}/segments", json=body)

    def segment(self, seq):
        return self.query("SELECT asr_text, source, live_target, target, state, version FROM segments WHERE seq = %s", (seq,))[0]


class SegmentStorageTests(ReviewTestCase):
    def test_new_segments_keep_asr_text_and_live_translation(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.assertEqual(self.save(client, meeting, [("第一句。", "First."), ("第二句。", "Second.")]).status_code, 200)
        self.assertEqual(self.segment(2), ("第二句。", "第二句。", "Second.", "Second.", "unreviewed", 1))
        stored = self.query("SELECT glossary, learned_terms, source_language, target_language FROM meetings")[0]
        self.assertEqual(stored, ("LINE=耐", "MiniMax=迷你max", "zh", "en"))

    def test_refinement_after_the_meeting_updates_only_the_current_translation(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.save(client, meeting, [("一", "One."), ("二", "Two."), ("三", "Three."), ("四", "Four."), ("五", "Five."), ("六", "Six."), ("七", "Seven (live).")])
        self.save(client, meeting, [("一", "One."), ("二", "Two."), ("三", "Three."), ("四", "Four."), ("五", "Five."), ("六", "Six."), ("七", "Seven (refined).")])
        self.assertEqual(self.segment(7)[2:], ("Seven (live).", "Seven (refined).", "unreviewed", 2))
        self.assertEqual(self.segment(1)[5], 1)  # unchanged segments keep their version

    def test_late_save_never_overwrites_a_reviewed_segment(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.save(client, meeting, [("城市設計", "urban design")])
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE segments SET source = '程式設計', target = 'programming', state = 'edited', version = 3")
        self.save(client, meeting, [("城市設計", "city planning")])
        self.assertEqual(self.segment(1), ("城市設計", "程式設計", "urban design", "programming", "edited", 3))

    def test_saving_segments_of_another_teams_meeting_is_404(self):
        theirs = self.team("業務", "bob")
        meeting = self.signed_in("bob").post("/api/meetings", json={"team_id": theirs, "language": "zh"}).json()["id"]
        self.assertEqual(self.save(self.signed_in("alice"), meeting, [("x", "y")]).status_code, 404)
        self.assertEqual(self.query("SELECT count(*) FROM segments"), [(0,)])


class ReviewApiTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.alice, self.meeting = self.signed_in("alice"), self.meeting_id()
        team_id = self.query("SELECT team_id FROM meetings")[0][0]
        folder = self.output / "teams" / str(team_id) / self.meeting
        audio = meeting_audio.MeetingAudio(folder / "audio.wav")
        audio.write(b"\x00\x00" * 16000 * 60)  # 60 s
        audio.close()
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE meetings SET audio_bytes = %s", (60 * 32000,))
        self.save(self.alice, self.meeting, [(f"第{i}句", f"Sentence {i}") for i in range(1, 16)])

    def post(self, client, seq, action, **body):
        return client.post(f"/api/meetings/{self.meeting}/segments/{seq}/{action}", json=body)

    def foreign(self):
        return self.signed_in("bob") if self.team("業務", "bob") else None

    def test_meeting_list_counts_segments_and_reviews_for_both_teams(self):
        other = self.team("業務", "alice", "bob")
        self.signed_in("bob").post("/api/meetings", json={"team_id": other, "language": "ja"})
        self.team("人資", "carol")
        self.post(self.alice, 3, "confirm", version=1)
        listed = self.alice.get("/api/meetings").json()
        self.assertEqual([m["team"] for m in listed], ["業務", "測試團隊"])  # newest first, no other team
        self.assertEqual((listed[1]["segments"], listed[1]["reviewed"], listed[1]["durationMs"]), (15, 1, 60000))

    def test_meeting_detail_lists_segments_in_order(self):
        detail = self.alice.get(f"/api/meetings/{self.meeting}").json()
        self.assertEqual([s["seq"] for s in detail["segments"]], list(range(1, 16)))
        self.assertEqual((detail["segments"][0]["startMs"], detail["segments"][0]["endMs"], detail["hasRecording"]), (0, 1000, True))

    def test_audio_range_is_wav_for_the_requested_span(self):
        response = self.alice.get(f"/api/meetings/{self.meeting}/audio", params={"start": 1200, "end": 9600})
        self.assertEqual(response.headers["content-type"], "audio/wav")
        with wave.open(io.BytesIO(response.content)) as w:
            self.assertEqual(w.getnframes(), 8400 * 16)

    def test_audio_of_another_team_or_without_recording_is_404(self):
        self.assertEqual(self.foreign().get(f"/api/meetings/{self.meeting}/audio", params={"start": 0, "end": 1000}).status_code, 404)
        silent = self.alice.post("/api/meetings", json={"team_id": self.query("SELECT team_id FROM meetings LIMIT 1")[0][0], "language": "zh"}).json()["id"]
        self.assertEqual(self.alice.get(f"/api/meetings/{silent}/audio", params={"start": 0, "end": 1000}).status_code, 404)

    def test_edit_then_retranslation_are_two_history_entries_and_asr_text_stays(self):
        edited = self.post(self.alice, 12, "edit", version=1, source="程式設計比賽").json()
        self.assertEqual((edited["source"], edited["state"], edited["version"], edited["asrText"]), ("程式設計比賽", "edited", 2, "第12句"))
        done = self.post(self.alice, 12, "translation", version=2, target="programming contest", refine=True).json()
        self.assertEqual((done["target"], done["state"], done["version"]), ("programming contest", "edited", 3))
        history = self.alice.get(f"/api/meetings/{self.meeting}/segments/12/history").json()
        self.assertEqual([(h["kind"], h["username"], h["sourceAfter"], h["targetAfter"], h["refine"]) for h in history],
                         [("edit", "alice", "程式設計比賽", "Sentence 12", False), ("retranslate", "alice", "程式設計比賽", "programming contest", True)])

    def test_two_reviewers_editing_in_turn_keep_both_entries(self):
        self.team_member("bob")
        bob = self.signed_in("bob")
        self.post(self.alice, 5, "edit", version=1, source="第五句（alice）")
        self.post(bob, 5, "edit", version=2, source="第五句（bob）")
        history = self.alice.get(f"/api/meetings/{self.meeting}/segments/5/history").json()
        self.assertEqual([(h["username"], h["sourceBefore"], h["sourceAfter"]) for h in history],
                         [("alice", "第5句", "第五句（alice）"), ("bob", "第五句（alice）", "第五句（bob）")])
        self.assertEqual(self.segment(5)[0], "第5句")

    def test_confirming_unchanged_is_recorded_and_editing_makes_it_edited(self):
        confirmed = self.post(self.alice, 3, "confirm", version=1).json()
        self.assertEqual((confirmed["state"], confirmed["version"]), ("confirmed", 2))
        self.assertEqual([h["kind"] for h in self.alice.get(f"/api/meetings/{self.meeting}/segments/3/history").json()], ["confirm"])
        self.assertEqual(self.post(self.alice, 3, "edit", version=2, source="第三句").json()["state"], "edited")

    def test_stale_version_is_409_with_the_current_segment(self):
        self.team_member("bob")
        bob = self.signed_in("bob")
        self.assertEqual(self.post(self.alice, 5, "edit", version=1, source="alice 的版本").status_code, 200)
        refused = self.post(bob, 5, "edit", version=1, source="bob 的版本")
        self.assertEqual(refused.status_code, 409)
        self.assertEqual((refused.json()["detail"], refused.json()["segment"]["source"]), ("這段已被其他人修改，已重新載入", "alice 的版本"))
        self.assertEqual(self.segment(5)[1], "alice 的版本")

    def test_every_review_api_is_404_for_another_team(self):
        bob, base = self.foreign(), f"/api/meetings/{self.meeting}"
        calls = [("GET", base, None), ("GET", f"{base}/audio?start=0&end=10", None), ("GET", f"{base}/segments/1/history", None),
                 ("POST", f"{base}/segments/1/edit", {"version": 1, "source": "x"}),
                 ("POST", f"{base}/segments/1/translation", {"version": 1, "target": "x"}),
                 ("POST", f"{base}/segments/1/confirm", {"version": 1}), ("PUT", f"{base}/segments", {"segments": []}),
                 ("GET", f"/meetings/{self.meeting}", None)]
        for method, path, body in calls:
            self.assertEqual(bob.request(method, path, json=body, follow_redirects=False).status_code, 404, f"{method} {path}")
        self.assertEqual(self.query("SELECT count(*) FROM segment_history"), [(0,)])
        self.assertEqual(self.segment(1)[1:], ("第1句", "Sentence 1", "Sentence 1", "unreviewed", 1))

    def team_member(self, username):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO team_members (team_id, username, added_by) SELECT team_id, %s, 'admin' FROM meetings LIMIT 1", (username,))


class UncleanStopTests(ReviewTestCase):
    def test_recording_left_by_a_stopped_app_still_plays(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        team_id = self.query("SELECT team_id FROM meetings")[0][0]
        audio = meeting_audio.MeetingAudio(self.output / "teams" / str(team_id) / meeting / "audio.wav")
        audio.write(b"\x00\x00" * 16000 * 5)
        audio.file.flush()   # the app stops here: no final header, audio_bytes stays 0
        self.save(client, meeting, [("一", "One.")])
        detail = client.get(f"/api/meetings/{meeting}").json()
        self.assertEqual((detail["hasRecording"], detail["durationMs"]), (True, 5000))
        self.assertEqual(client.get("/api/meetings").json()[0]["durationMs"], 5000)
        clip = client.get(f"/api/meetings/{meeting}/audio", params={"start": 1000, "end": 3000})
        with wave.open(io.BytesIO(clip.content)) as w:
            self.assertEqual(w.getnframes(), 32000)
        audio.file.close()

    def test_meeting_without_segments_is_listed_with_zero_segments(self):
        client = self.signed_in("alice")
        self.meeting_id()
        listed = client.get("/api/meetings").json()
        self.assertEqual((listed[0]["segments"], listed[0]["reviewed"], listed[0]["durationMs"]), (0, 0, 0))


class AsrExportTests(ReviewApiTests):
    def test_manifest_line_matches_the_spec_example(self):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE segments SET start_ms = 4200, end_ms = 9100, asr_text = '城市設計比賽', source = '城市設計比賽' WHERE seq = 12")
        self.post(self.alice, 12, "edit", version=1, source="程式設計比賽")
        team_id = self.query("SELECT team_id FROM meetings")[0][0]
        archive = zipfile.ZipFile(io.BytesIO(self.export(self.alice, team_id).content))
        line = json.loads(archive.read("manifest.jsonl").decode().splitlines()[0])
        self.assertEqual(line, {"audio": f"clips/{self.meeting}_0012.wav", "text": "程式設計比賽", "asr_text": "城市設計比賽", "language": "zh",
                                "engine": "local", "meeting_id": self.meeting, "seq": 12, "start_ms": 4200, "end_ms": 9100,
                                "edited": True, "reviewed_by": "alice"})
        with wave.open(io.BytesIO(archive.read(line["audio"]))) as w:
            self.assertEqual(w.getnframes(), 4900 * 16)

    def export(self, client, team_id, **dates):
        today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
        return client.get(f"/api/teams/{team_id}/asr-export", params={"from": dates.get("start", today), "to": dates.get("end", today)})

    def test_only_confirmed_or_edited_segments_are_exported(self):
        for seq in (1, 2, 3):
            self.post(self.alice, seq, "edit", version=1, source=f"修正{seq}")
        for seq in (4, 5):
            self.post(self.alice, seq, "confirm", version=1)
        team_id = self.query("SELECT team_id FROM meetings")[0][0]
        response = self.export(self.alice, team_id)
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        lines = [json.loads(line) for line in archive.read("manifest.jsonl").decode().splitlines()]
        self.assertEqual(len([n for n in archive.namelist() if n.startswith("clips/")]), 5)
        self.assertEqual(len(lines), 5)
        first = lines[0]
        self.assertEqual(first, {"audio": f"clips/{self.meeting}_0001.wav", "text": "修正1", "asr_text": "第1句", "language": "zh",
                                 "engine": "local", "meeting_id": self.meeting, "seq": 1, "start_ms": 0, "end_ms": 1000,
                                 "edited": True, "reviewed_by": "alice"})
        self.assertFalse(lines[3]["edited"])
        with wave.open(io.BytesIO(archive.read(first["audio"]))) as w:
            self.assertEqual(w.getnframes(), 16000)  # its own span, no playback padding

    def test_export_of_another_team_or_outside_the_dates_is_empty_or_404(self):
        team_id = self.query("SELECT team_id FROM meetings")[0][0]
        self.post(self.alice, 1, "confirm", version=1)
        self.assertEqual(self.export(self.foreign(), team_id).status_code, 404)
        old = zipfile.ZipFile(io.BytesIO(self.export(self.alice, team_id, start="2020-01-01", end="2020-01-31").content))
        self.assertEqual(old.read("manifest.jsonl"), b"")


class MeetingCatalogTests(AccountTestCase):
    """Topics, filters and creators of the meeting list (spec meeting-catalog)."""

    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol")
        self.rd = self.team("研發", "alice", "bob")
        self.sales = self.team("業務", "alice")
        self.hr = self.team("人資", "carol")

    def create(self, username, team_id, title="", started=None):
        response = self.signed_in(username).post("/api/meetings", json={"team_id": team_id, "language": "zh", "title": title})
        if started and response.status_code == 201:
            with psycopg.connect(TEST_DATABASE_URL) as conn:
                conn.execute("UPDATE meetings SET started_at = %s WHERE id = %s", (started, response.json()["id"]))
        return response

    def titles(self, client, **params):
        return sorted(m["title"] for m in client.get("/api/meetings", params=params).json())

    def test_topic_input_is_trimmed_optional_and_limited(self):
        self.assertEqual(self.create("alice", self.rd, "  週會  ").status_code, 201)
        self.assertEqual(self.create("alice", self.rd, "").status_code, 201)
        self.assertEqual(self.create("alice", self.rd, "長" * 101).status_code, 422)
        self.assertEqual(self.create("alice", self.rd, " " + "長" * 100 + " ").status_code, 201)  # trimmed first
        self.assertEqual(sorted(r[0] for r in self.query("SELECT title FROM meetings")), ["", "週會", "長" * 100])
        meeting = self.query("SELECT id::text FROM meetings WHERE title = '週會'")[0][0]
        self.assertEqual(self.signed_in("alice").get(f"/api/meetings/{meeting}").json()["title"], "週會")

    def test_member_renames_and_clears_the_topic(self):
        meeting = self.create("alice", self.rd, "週會").json()["id"]
        bob = self.signed_in("bob")
        self.assertEqual(bob.patch(f"/api/meetings/{meeting}", json={"title": " Q4 規劃 "}).json(), {"id": meeting, "title": "Q4 規劃"})
        self.assertEqual(self.titles(bob), ["Q4 規劃"])
        bob.patch(f"/api/meetings/{meeting}", json={"title": ""})
        self.assertEqual(self.titles(bob), [""])
        self.assertEqual(bob.patch(f"/api/meetings/{meeting}", json={"title": "長" * 101}).status_code, 422)

    def test_member_of_another_team_cannot_rename(self):
        meeting = self.create("alice", self.rd, "週會").json()["id"]
        self.assertEqual(self.signed_in("carol").patch(f"/api/meetings/{meeting}", json={"title": "改掉"}).status_code, 404)
        self.assertEqual(self.query("SELECT title FROM meetings"), [("週會",)])

    def test_keyword_matches_topics_case_insensitively(self):
        for title in ("研發週會", "業務週會", "客戶訪談", "Weekly Sync"):
            self.create("alice", self.rd, title)
        alice = self.signed_in("alice")
        self.assertEqual(self.titles(alice, q="週會"), ["業務週會", "研發週會"])
        self.assertEqual(self.titles(alice, q="weekly"), ["Weekly Sync"])

    def test_keyword_wildcards_are_literal(self):
        for title in ("成長 50%", "成長 50 倍", "a_b", "axb"):
            self.create("alice", self.rd, title)
        alice = self.signed_in("alice")
        self.assertEqual(self.titles(alice, q="50%"), ["成長 50%"])
        self.assertEqual(self.titles(alice, q="a_b"), ["a_b"])

    def test_combined_filters(self):
        self.create("alice", self.rd, "研發 1101", "2026-11-01 10:00+08")
        self.create("bob", self.rd, "研發週會", "2026-11-03 10:00+08")
        self.create("alice", self.sales, "業務 1104", "2026-11-04 10:00+08")
        self.create("carol", self.hr, "人資週會", "2026-11-02 10:00+08")
        alice = self.signed_in("alice")
        self.assertEqual(self.titles(alice, team=self.rd), ["研發 1101", "研發週會"])
        self.assertEqual(self.titles(alice, **{"from": "2026-11-01", "to": "2026-11-03"}), ["研發 1101", "研發週會"])
        self.assertEqual(self.titles(alice, creator="bob", q="週會"), ["研發週會"])
        self.assertEqual(alice.get("/api/meetings", params={"team": self.hr}).status_code, 404)

    def test_local_date_boundary(self):
        self.create("alice", self.rd, "跨日", "2026-11-03 23:30+08")  # 15:30 UTC, still 11/03 in Taipei
        self.assertEqual(self.titles(self.signed_in("alice"), **{"from": "2026-11-03", "to": "2026-11-03"}), ["跨日"])

    def test_filters_apply_before_the_500_limit(self):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO meetings (team_id, created_by, language, engine, title, started_at) "
                         "SELECT %s, 'alice', 'zh', 'local', 'old ' || g, timestamptz '2026-01-01 10:00+08' + g * interval '1 hour' "
                         "FROM generate_series(1, 10) g", (self.rd,))
            conn.execute("INSERT INTO meetings (team_id, created_by, language, engine, title, started_at) "
                         "SELECT %s, 'alice', 'zh', 'local', 'new ' || g, timestamptz '2026-06-01 10:00+08' + g * interval '1 hour' "
                         "FROM generate_series(1, 500) g", (self.rd,))
        alice = self.signed_in("alice")
        self.assertFalse(any(m["title"].startswith("old") for m in alice.get("/api/meetings").json()))
        self.assertEqual(len(self.titles(alice, **{"from": "2026-01-01", "to": "2026-01-31"})), 10)

    def test_creators_are_only_from_the_users_teams(self):
        self.create("bob", self.rd, "a")
        self.create("alice", self.sales, "b")
        self.create("carol", self.hr, "c")
        creators = self.signed_in("alice").get("/api/meetings/creators").json()
        self.assertEqual([c["username"] for c in creators], ["alice", "bob"])


MEMBERS = [{"username": "alice", "display_name": "王愛麗"}, {"username": "bob", "display_name": "bob"}]


class MinutesRulesTests(unittest.TestCase):
    """Pure validation rules of meeting-minutes (the spec's example tables)."""

    def item(self, **kw):
        return {"kind": "action", "content": "整理報價", "owner": "", "due_text": "", "due_date": "", "evidence": [3], **kw}

    def test_evidence_filtering(self):
        seqs = set(range(1, 21))
        for cited, stored in (([3, 7], [3, 7]), ([7, 99], [7]), ([99], None), ([], None)):
            items, dropped = minutes.clean_items([self.item(evidence=cited)], seqs, MEMBERS)
            self.assertEqual(items[0]["evidence"] if items else None, stored, cited)
            self.assertEqual(dropped, 0 if stored else 1, cited)

    def test_owner_matching(self):
        for name, owner, hint in (("Alice", "alice", ""), ("王愛麗", "alice", ""), ("小王", None, "小王"), ("", None, "")):
            self.assertEqual(minutes.match_owner(name, MEMBERS), (owner, hint), name)

    def test_due_dates_keep_the_phrase(self):
        for due_text, due_date, stored in (("下週五", "2026-11-13", date(2026, 11, 13)), ("月底前", "2026-11-31", None)):
            items, _ = minutes.clean_items([self.item(due_text=due_text, due_date=due_date)], {3}, MEMBERS)
            self.assertEqual((items[0]["due_date"], items[0]["due_text"]), (stored, due_text))

    def test_same_item_twice_is_stored_once_with_merged_evidence(self):
        items, _ = minutes.clean_items([self.item(content="整理報價。", evidence=[3]), self.item(content="整理 報價", evidence=[5]),
                                        self.item(kind="risk", content="整理報價", evidence=[5]), {"kind": "memo", "content": "x", "evidence": [3]}],
                                       {3, 5}, MEMBERS)
        self.assertEqual([(i["kind"], i["evidence"]) for i in items], [("action", [3, 5]), ("risk", [5])])

    def test_prompt_sends_the_whole_meeting_once(self):
        meeting = {"started_at": datetime(2026, 11, 4, 15, 37, tzinfo=timezone.utc), "title": "週會"}
        segments = [{"seq": i, "source": f"第{i}句"} for i in range(1, 43)]
        messages = minutes.build_messages(meeting, segments, MEMBERS)
        user = messages[-1]["content"]
        self.assertEqual(len(messages), 2)
        self.assertIn("會議日期：2026-11-04（星期三）", user)
        self.assertIn("- alice（王愛麗）", user)
        self.assertEqual([line for line in user.splitlines() if line.startswith("[")], [f"[{i}] 第{i}句" for i in range(1, 43)])

    def test_answer_in_a_code_fence_is_read(self):
        self.assertEqual(minutes.parse_answer('```json\n{"summary": "s", "items": []}\n```'), {"summary": "s", "items": []})


class MinutesApiTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol")
        self.alice, self.meeting = self.signed_in("alice"), self.meeting_id()
        self.team_id = self.query("SELECT team_id FROM meetings")[0][0]
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, 'bob', 'admin')", (self.team_id,))
        self.save(self.alice, self.meeting, [(f"第{i}句", f"S{i}") for i in range(1, 21)])
        for name, value in (("minutes.MINUTES_URL", "http://model"), ("minutes.MINUTES_MODEL", "m")):
            p = patch(name, value)
            p.start()
            self.addCleanup(p.stop)

    def answer(self, items, summary="本次討論報價。"):
        return json.dumps({"summary": summary, "items": items}, ensure_ascii=False)

    def generate(self, answer, client=None, observe=None):
        """Start generation with a fake model and wait for it inside a running client.

        observe(client) runs while the model call is still in progress."""
        calls, release = [], asyncio.Event() if observe else None

        async def model(messages):
            calls.append(messages)
            if release:
                for _ in range(500):
                    if release.is_set():
                        break
                    await asyncio.sleep(0.01)
            if isinstance(answer, Exception):
                raise answer
            return answer
        with patch("minutes.call_model", model), (client or self.signed_in("alice")) as running:
            response = running.post(f"/api/meetings/{self.meeting}/minutes/generate")
            if observe:
                observe(running)
                release.set()
            for _ in range(100):
                state = running.get(f"/api/meetings/{self.meeting}/minutes").json()
                if state["status"] != "running":
                    break
                time.sleep(0.02)
        return response, state, calls

    def items(self):
        return self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["items"]

    def test_generation_sends_all_segments_once_and_finishes(self):
        seen = []

        def while_running(client):
            seen.append(client.get(f"/api/meetings/{self.meeting}/minutes").json()["status"])
            second = client.post(f"/api/meetings/{self.meeting}/minutes/generate")
            seen.append((second.status_code, second.json()["detail"]))
            seen.append(client.get(f"/api/meetings/{self.meeting}/minutes").json()["status"])
        response, state, calls = self.generate(observe=while_running, answer=self.answer([
            {"kind": "decision", "content": "採用新報價", "evidence": [2]},
            {"kind": "action", "content": "寄出報價", "owner": "王愛麗", "due_text": "下週五", "due_date": "2026-11-13", "evidence": [4, 99]},
            {"kind": "risk", "content": "沒有證據的風險", "evidence": [99]}]))
        self.assertEqual(response.status_code, 202)
        # Running until the model answers; a second start is refused and the first one carries on.
        self.assertEqual(seen, ["running", (409, "紀要正在產生中"), "running"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(sum(1 for line in calls[0][-1]["content"].splitlines() if line.startswith("[")), 20)
        self.assertEqual((state["status"], state["dropped"], state["summary"]), ("done", 1, "本次討論報價。"))
        action = next(i for i in state["items"] if i["kind"] == "action")
        self.assertEqual((action["owner"], action["ownerName"], action["dueDate"], action["dueText"], action["state"]),
                         ("alice", "王愛麗", "2026-11-13", "下週五", "proposed"))
        self.assertEqual([e["seq"] for e in action["evidence"]], [4])

    def test_second_start_while_running_is_409(self):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO minutes (meeting_id, status) VALUES (%s, 'running')", (self.meeting,))
        response = self.alice.post(f"/api/meetings/{self.meeting}/minutes/generate")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "紀要正在產生中"))
        self.assertEqual(self.query("SELECT status FROM minutes"), [("running",)])

    def test_failed_model_keeps_existing_items(self):
        self.alice.post(f"/api/meetings/{self.meeting}/minutes/items", json={"kind": "decision", "content": "手動決議", "evidence": [1]})
        _, state, _ = self.generate(httpx.ConnectError("refused"))
        self.assertEqual(state["status"], "failed")
        self.assertIn("產生失敗", state["message"])
        self.assertEqual([i["content"] for i in state["items"]], ["手動決議"])

    def test_model_not_configured_is_400(self):
        with patch("minutes.MINUTES_URL", ""):
            response = self.alice.post(f"/api/meetings/{self.meeting}/minutes/generate")
        self.assertEqual((response.status_code, response.json()["detail"]), (400, "紀要模型未設定"))
        self.assertEqual(self.query("SELECT count(*) FROM minutes"), [(0,)])

    def test_meeting_without_segments_is_422(self):
        empty = self.alice.post("/api/meetings", json={"team_id": self.team_id, "language": "zh"}).json()["id"]
        self.assertEqual(self.alice.post(f"/api/meetings/{empty}/minutes/generate").status_code, 422)

    def test_interrupted_generation_is_failed_after_restart(self):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO minutes (meeting_id, status) VALUES (%s, 'running')", (self.meeting,))
        asyncio.run(minutes.recover_interrupted())
        self.assertEqual(self.query("SELECT status, message FROM minutes"), [("failed", "產生中斷，請重新產生")])

    def test_regenerating_keeps_human_decisions(self):
        self.generate(self.answer([{"kind": "decision", "content": "採用新報價", "evidence": [2]},
                                   {"kind": "risk", "content": "供應延遲", "evidence": [3]},
                                   {"kind": "action", "content": "寄出報價", "evidence": [4]},
                                   {"kind": "action", "content": "安排會議", "evidence": [5]}]))
        by = {i["content"]: i for i in self.items()}
        base = f"/api/meetings/{self.meeting}/minutes/items"
        self.alice.post(f"{base}/{by['採用新報價']['id']}/confirm", json={"version": 1})
        self.alice.post(f"{base}/{by['供應延遲']['id']}/reject", json={"version": 1})
        self.alice.patch(f"/api/meetings/{self.meeting}/minutes/summary", json={"version": 2, "summary": "人寫的摘要"})
        _, state, _ = self.generate(self.answer([{"kind": "decision", "content": "採用新報價。", "evidence": [2]},
                                                 {"kind": "action", "content": "更新合約", "evidence": [6]}], summary="新摘要"))
        self.assertEqual(sorted((i["content"], i["state"]) for i in state["items"]),
                         [("供應延遲", "rejected"), ("採用新報價", "confirmed"), ("更新合約", "proposed")])
        self.assertEqual(state["summary"], "人寫的摘要")

    def test_confirming_an_edited_proposal(self):
        self.generate(self.answer([{"kind": "action", "content": "寄出報價", "owner": "小王", "evidence": [4]}]))
        item = self.items()[0]
        self.assertEqual((item["owner"], item["ownerHint"]), (None, "小王"))
        base = f"/api/meetings/{self.meeting}/minutes/items/{item['id']}"
        changed = self.alice.patch(base, json={"version": 1, "owner": "bob", "dueDate": "2026-11-20"}).json()
        self.assertEqual((changed["owner"], changed["ownerHint"], changed["dueDate"], changed["state"]), ("bob", "", "2026-11-20", "proposed"))
        confirmed = self.alice.post(f"{base}/confirm", json={"version": 2}).json()
        self.assertEqual((confirmed["state"], confirmed["confirmedBy"]), ("confirmed", "王愛麗"))
        self.assertEqual(self.query("SELECT confirmed_at IS NOT NULL FROM minute_items"), [(True,)])

    def test_owner_outside_the_team_is_422(self):
        added = self.alice.post(f"/api/meetings/{self.meeting}/minutes/items", json={"kind": "action", "content": "x", "evidence": [1]}).json()
        response = self.alice.patch(f"/api/meetings/{self.meeting}/minutes/items/{added['id']}", json={"version": 1, "owner": "carol"})
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "負責人必須是團隊成員"))
        self.assertEqual(self.query("SELECT owner FROM minute_items"), [(None,)])

    def test_stale_edit_is_409_with_the_current_item(self):
        added = self.alice.post(f"/api/meetings/{self.meeting}/minutes/items", json={"kind": "action", "content": "原本", "evidence": [1]}).json()
        base = f"/api/meetings/{self.meeting}/minutes/items/{added['id']}"
        self.assertEqual(self.signed_in("bob").patch(base, json={"version": 1, "content": "bob 改的"}).status_code, 200)
        refused = self.alice.patch(base, json={"version": 1, "content": "alice 改的"})
        self.assertEqual((refused.status_code, refused.json()["item"]["content"]), (409, "bob 改的"))

    def test_hand_added_item_is_confirmed(self):
        added = self.alice.post(f"/api/meetings/{self.meeting}/minutes/items",
                                json={"kind": "question", "content": "  預算誰批？ ", "evidence": [2, 99]}).json()
        self.assertEqual((added["content"], added["state"], added["origin"], [e["seq"] for e in added["evidence"]]),
                         ("預算誰批？", "confirmed", "manual", [2]))

    def test_markdown_lists_only_confirmed_items(self):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE meetings SET title = '週會', started_at = '2026-11-04 23:37+08'")
            conn.execute("UPDATE segments SET start_ms = seq * 61000, end_ms = seq * 61000 + 1000")
        self.generate(self.answer([{"kind": "decision", "content": "待確認的決議", "evidence": [1]},
                                   {"kind": "risk", "content": "被駁回的風險", "evidence": [2]}]))
        base = f"/api/meetings/{self.meeting}/minutes/items"
        risk = next(i for i in self.items() if i["kind"] == "risk")
        self.alice.post(f"{base}/{risk['id']}/reject", json={"version": 1})
        self.alice.post(base, json={"kind": "action", "content": "寄出報價。", "owner": "alice", "dueDate": "2026-11-13", "dueText": "下週五", "evidence": [3]})
        self.alice.post(base, json={"kind": "action", "content": "安排驗收", "evidence": [4, 5]})
        response = self.alice.get(f"/api/meetings/{self.meeting}/minutes.md")
        self.assertIn("text/markdown", response.headers["content-type"])
        self.assertIn("attachment", response.headers["content-disposition"])
        self.assertEqual(response.text, "\n".join([
            "# 週會", "", "- 日期：2026/11/04 23:37（星期三）", "- 團隊：測試團隊", "", "## 摘要", "", "本次討論報價。", "", "## 待辦", "",
            "- 寄出報價；負責人：王愛麗；到期：2026-11-13（下週五）；錄音 03:03",
            "- 安排驗收；負責人：未指派；到期：未定；錄音 04:04、05:05"]) + "\n")

    def test_every_minutes_api_is_404_for_another_team(self):
        added = self.alice.post(f"/api/meetings/{self.meeting}/minutes/items", json={"kind": "decision", "content": "x", "evidence": [1]}).json()
        carol, base = self.signed_in("carol"), f"/api/meetings/{self.meeting}/minutes"
        calls = [("GET", base, None), ("POST", f"{base}/generate", None), ("PATCH", f"{base}/summary", {"version": 1, "summary": "x"}),
                 ("POST", f"{base}/items", {"kind": "risk", "content": "y"}), ("PATCH", f"{base}/items/{added['id']}", {"version": 1, "content": "z"}),
                 ("POST", f"{base}/items/{added['id']}/confirm", {"version": 1}), ("POST", f"{base}/items/{added['id']}/reject", {"version": 1}),
                 ("GET", f"/api/meetings/{self.meeting}/minutes.md", None), ("GET", f"/meetings/{self.meeting}/minutes", None)]
        for method, path, body in calls:
            self.assertEqual(carol.request(method, path, json=body, follow_redirects=False).status_code, 404, f"{method} {path}")
        self.assertEqual(self.query("SELECT count(*), max(version) FROM minute_items"), [(1, 1)])
        self.assertEqual(self.query("SELECT count(*) FROM minutes"), [(0,)])

    def test_item_of_another_meeting_is_404(self):
        other = self.alice.post("/api/meetings", json={"team_id": self.team_id, "language": "zh"}).json()["id"]
        added = self.alice.post(f"/api/meetings/{self.meeting}/minutes/items", json={"kind": "decision", "content": "x"}).json()
        self.assertEqual(self.alice.patch(f"/api/meetings/{other}/minutes/items/{added['id']}", json={"version": 1, "content": "z"}).status_code, 404)


class ActionTrackingTests(ReviewTestCase):
    """action-tracking: alice and bob share 測試團隊; carol is in no team; today is 2026-11-06 (Asia/Taipei)."""
    TODAY = date(2026, 11, 6)

    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol")
        self.alice, self.meeting = self.signed_in("alice"), self.meeting_id()
        self.team_id = self.query("SELECT team_id FROM meetings")[0][0]
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, 'bob', 'admin')", (self.team_id,))
        self.save(self.alice, self.meeting, [(f"第{i}句", f"S{i}") for i in range(1, 6)])
        today = patch("minutes.local_today", lambda: self.TODAY)
        today.start()
        self.addCleanup(today.stop)

    def item(self, content="寄合約", kind="action", state="confirmed", status="todo", owner=None, due=None, meeting=None, version=1):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute(
                "INSERT INTO minute_items (meeting_id, kind, content, origin, state, status, owner, due_date, evidence, version) "
                "VALUES (%s, %s, %s, 'ai', %s, %s, %s, %s, '{1}', %s) RETURNING id",
                (meeting or self.meeting, kind, content, state, status, owner, due, version)).fetchone()[0]

    def change(self, item_id, status, note="", version=None, client=None, meeting=None):
        if version is None:
            version = self.query("SELECT version FROM minute_items WHERE id = %s", (item_id,))[0][0]
        return (client or self.alice).post(f"/api/meetings/{meeting or self.meeting}/minutes/items/{item_id}/status",
                                           json={"version": version, "status": status, "note": note})

    def test_starting_work_increments_the_version(self):
        item_id = self.item(version=3)
        response = self.change(item_id, "doing", version=3)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["status"], response.json()["version"]), ("doing", 4))
        self.assertEqual(self.query("SELECT status, status_by FROM minute_items"), [("doing", "alice")])

    def test_status_change_rules(self):
        rows = [  # spec example "status change rules"
            (("action", "confirmed", "todo"), "doing", "", 200, None),
            (("action", "confirmed", "doing"), "done", "已寄出", 200, None),
            (("action", "confirmed", "todo"), "cancelled", "", 422, "取消待辦請填寫原因"),
            (("action", "confirmed", "todo"), "cancelled", "客戶取消訂單", 200, None),
            (("action", "confirmed", "doing"), "doing", "", 422, "狀態沒有改變"),
            (("action", "proposed", "todo"), "doing", "", 409, "只有已確認的待辦可以更新狀態"),
            (("decision", "confirmed", "todo"), "done", "", 409, "只有已確認的待辦可以更新狀態"),
        ]
        for (kind, state, current), requested, note, code, detail in rows:
            with self.subTest(kind=kind, state=state, current=current, requested=requested, note=note):
                item_id = self.item(kind=kind, state=state, status=current)
                response = self.change(item_id, requested, note)
                self.assertEqual(response.status_code, code, response.text)
                stored = self.query("SELECT status, status_note FROM minute_items WHERE id = %s", (item_id,))[0]
                if code == 200:
                    self.assertEqual(stored, (requested, note))
                    self.assertEqual(response.json()["statusNote"], note)
                else:
                    self.assertEqual(response.json()["detail"], detail)
                    self.assertEqual(stored, (current, ""))
                    self.assertEqual(self.query("SELECT count(*) FROM item_updates WHERE item_id = %s", (item_id,)), [(0,)])

    def test_stale_status_change(self):
        item_id = self.item(version=3)
        bob = self.signed_in("bob")
        self.assertEqual(self.change(item_id, "doing", version=3).status_code, 200)
        response = self.change(item_id, "done", version=3, client=bob)
        self.assertEqual(response.status_code, 409)
        self.assertEqual((response.json()["item"]["status"], response.json()["item"]["version"]), ("doing", 4))
        self.assertEqual(self.query("SELECT status FROM minute_items"), [("doing",)])

    def test_another_team_gets_404(self):
        item_id = self.item()
        carol = self.signed_in("carol")
        self.assertEqual(self.change(item_id, "doing", client=carol).status_code, 404)
        self.assertEqual(carol.get(f"/api/meetings/{self.meeting}/minutes/items/{item_id}/updates").status_code, 404)
        self.assertEqual(self.query("SELECT status FROM minute_items"), [("todo",)])

    def test_history_newest_first(self):
        item_id = self.item()
        self.assertEqual(self.change(item_id, "doing").status_code, 200)
        self.assertEqual(self.change(item_id, "done", "已寄出", client=self.signed_in("bob")).status_code, 200)
        history = self.alice.get(f"/api/meetings/{self.meeting}/minutes/items/{item_id}/updates").json()
        self.assertEqual([(h["from"], h["to"], h["note"], h["by"]) for h in history],
                         [("doing", "done", "已寄出", "bob"), ("todo", "doing", "", "王愛麗")])
        self.assertEqual(history[0]["meetingId"], None)
        self.assertEqual(self.alice.get(f"/api/meetings/{self.meeting}/minutes/items/999999/updates").status_code, 404)

    def test_overdue_days(self):
        rows = [("todo", date(2026, 11, 4), 2), ("doing", date(2026, 11, 5), 1), ("todo", date(2026, 11, 6), 0),
                ("done", date(2026, 11, 1), 0), ("cancelled", date(2026, 11, 1), 0), ("todo", None, 0)]  # spec "overdue on 2026-11-06"
        ids = {self.item(content=f"事項{i}", status=status, due=due): want for i, (status, due, want) in enumerate(rows)}
        minutes_items = {i["id"]: i["overdueDays"] for i in self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["items"]}
        board = {i["id"]: i["overdueDays"] for i in self.alice.get("/api/actions?status=todo,doing,done,cancelled").json()["items"]}
        self.assertEqual(minutes_items, ids)
        self.assertEqual(board, ids)

    def board(self, query="", client=None):
        response = (client or self.alice).get(f"/api/actions{query}")
        self.assertEqual(response.status_code, 200, response.text)
        return [i["content"] for i in response.json()["items"]]

    def test_board_shows_both_teams_and_no_other(self):
        sales = self.team("業務部", "alice")
        sales_meeting = self.alice.post("/api/meetings", json={"team_id": sales, "language": "zh"}).json()["id"]
        other = self.team("財務部", "carol")
        other_meeting = self.signed_in("carol").post("/api/meetings", json={"team_id": other, "language": "zh"}).json()["id"]
        self.item("研發待辦")
        self.item("業務待辦", meeting=sales_meeting)
        self.item("財務待辦", meeting=other_meeting)
        self.item("未確認", state="proposed")
        self.item("已駁回", state="rejected")
        self.item("一個決議", kind="decision")
        self.assertEqual(sorted(self.board()), ["業務待辦", "研發待辦"])
        body = self.alice.get("/api/actions").json()
        self.assertEqual(sorted(t["name"] for t in body["teams"]), ["業務部", "測試團隊"])
        self.assertEqual([p["username"] for p in body["people"]], ["alice", "bob"])
        self.assertEqual(self.board(f"?team={sales}"), ["業務待辦"])
        self.assertEqual(self.alice.get(f"/api/actions?team={other}").status_code, 404)

    def test_board_filters(self):
        # spec example "filtering on 2026-11-06"
        self.item("A", owner="alice", status="todo", due=date(2026, 11, 4))
        self.item("B", owner="alice", status="doing", due=date(2026, 11, 10))
        self.item("C", owner="bob", status="todo", due=date(2026, 11, 13))
        self.item("D", status="todo")
        self.item("E", owner="alice", status="done", due=date(2026, 11, 1))
        self.assertEqual(sorted(self.board("?owner=me")), ["A", "B", "E"])
        self.assertEqual(self.board("?due=overdue"), ["A"])
        self.assertEqual(sorted(self.board("?due=week")), ["B", "C"])
        self.assertEqual(self.board("?due=none"), ["D"])
        self.assertEqual(self.board("?owner=none"), ["D"])
        self.assertEqual(self.board("?owner=bob"), ["C"])
        self.assertEqual(self.board("?owner=nobody"), [])
        self.assertEqual(self.board("?owner=me&due=overdue"), ["A"])  # "My overdue items"
        self.assertEqual(self.board("?status=done"), ["E"])
        self.assertEqual(self.alice.get("/api/actions?status=open").status_code, 422)
        self.assertEqual(self.alice.get("/api/actions?due=later").status_code, 422)

    def test_board_order_and_keyword(self):
        self.item("晚一點", due=date(2026, 11, 20))
        self.item("沒有日期")
        self.item("逾期一天", due=date(2026, 11, 5))
        self.item("逾期三天", due=date(2026, 11, 3))
        self.item("100% 完成報表", due=date(2026, 11, 8))
        self.assertEqual(self.board(), ["逾期三天", "逾期一天", "100% 完成報表", "晚一點", "沒有日期"])
        self.assertEqual(self.board("?q=%25"), ["100% 完成報表"])
        self.assertEqual(self.board("?q=逾期"), ["逾期三天", "逾期一天"])

    def test_board_page_requires_sign_in(self):
        self.assertEqual(self.alice.get("/actions").status_code, 200)
        self.assertNotEqual(TestClient(app).get("/actions", follow_redirects=False).status_code, 200)


class DatabaseTests(DatabaseTestCase):
    def test_migrations_apply_once(self):
        with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
            conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")

        async def migrate_twice():
            async with await psycopg.AsyncConnection.connect(TEST_DATABASE_URL) as conn:
                return await db.migrate(conn), await db.migrate(conn)
        everything = [version for version, _ in db.migration_files()]
        self.assertEqual(asyncio.run(migrate_twice()), (everything, []))
        versions = [row[0] for row in self.query("SELECT version FROM schema_migrations ORDER BY version")]
        self.assertEqual(versions, [version for version, _ in db.migration_files()])
        tables = {row[0] for row in self.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")}
        self.assertLessEqual({"users", "teams", "team_members", "sessions", "login_failures", "meetings", "meeting_files",
                              "segments", "segment_history", "minutes", "minute_items", "item_updates"}, tables)
        columns = {row[0] for row in self.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings'")}
        self.assertLessEqual({"source_language", "target_language", "glossary", "learned_terms", "audio_bytes", "ended_at", "title"}, columns)


class ActionMigrationTests(DatabaseTestCase):
    def test_existing_items_start_as_todo_and_status_is_checked(self):
        with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
            conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        before = [entry for entry in db.migration_files() if entry[0] < 5]

        async def migrate(files):
            async with await psycopg.AsyncConnection.connect(TEST_DATABASE_URL) as conn:
                with patch("db.migration_files", lambda: files):
                    return await db.migrate(conn)
        asyncio.run(migrate(before))
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            team = conn.execute("INSERT INTO teams (name, name_key) VALUES ('研發部', '研發部') RETURNING id").fetchone()[0]
            meeting = conn.execute("INSERT INTO meetings (team_id, created_by, language, engine) VALUES (%s, 'alice', 'zh', 'local') RETURNING id",
                                   (team,)).fetchone()[0]
            conn.execute("INSERT INTO minute_items (meeting_id, kind, content, origin, state) VALUES (%s, 'action', '寄合約', 'ai', 'confirmed')",
                         (meeting,))
        self.assertEqual(asyncio.run(migrate(db.migration_files())), [5])
        self.assertEqual(self.query("SELECT status, status_note FROM minute_items"), [("todo", "")])
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.query("UPDATE minute_items SET status = 'open'")
        self.assertEqual(self.query("SELECT count(*) FROM item_updates"), [(0,)])


class SignInTests(AccountTestCase):
    def login(self, username, password):
        return TestClient(app).post("/api/login", json={"username": username, "password": password})

    def test_correct_credentials_create_a_session_and_return_the_display_name(self):
        response = self.login("Alice", "pw-alice")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"username": "alice", "displayName": "王愛麗", "admin": False, "teams": []})
        cookie = response.headers["set-cookie"]
        self.assertIn("yq_session=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=lax", cookie)
        self.assertEqual(self.query("SELECT username FROM sessions"), [("alice",)])

    def test_wrong_password_is_401_without_cookie(self):
        response = self.login("alice", "nope")
        self.assertEqual((response.status_code, response.json()["detail"]), (401, "帳號或密碼錯誤"))
        self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(self.query("SELECT count(*) FROM sessions"), [(0,)])

    def test_empty_username_or_password_never_reaches_ldap(self):
        for username, password in (("alice", ""), ("", "x"), ("   ", "x")):
            self.assertEqual(self.login(username, password).status_code, 401)
        self.assertEqual(self.ldap.binds, 0)

    def test_filter_characters_in_the_username_are_escaped(self):
        for username in ("a*)(sAMAccountName=*", "a*)(uid=*"):
            self.ldap.binds = 0
            self.assertEqual(self.login(username, "pw-alice").status_code, 401)
            self.assertEqual(self.ldap.binds, 1)  # only the service account; no user matched the escaped filter

    def test_unreachable_ldap_is_503(self):
        self.ldap.unreachable = True
        response = self.login("alice", "pw-alice")
        self.assertEqual((response.status_code, response.json()["detail"]), (503, "無法連線登入伺服器"))
        self.assertNotIn("set-cookie", response.headers)

    def test_session_is_known_by_its_hash_only(self):
        client = self.signed_in("alice")
        token = client.cookies.get("yq_session")
        self.assertGreaterEqual(len(token), 43)  # 32 random bytes, base64url
        stored = self.query("SELECT token_hash FROM sessions")[0][0]
        self.assertEqual(bytes(stored), hashlib.sha256(token.encode()).digest())
        self.assertEqual(client.get("/api/me").json()["username"], "alice")

    def test_cookie_is_secure_over_https(self):
        response = TestClient(app, base_url="https://testserver").post("/api/login", json={"username": "alice", "password": "pw-alice"})
        self.assertIn("Secure", response.headers["set-cookie"])
        self.assertNotIn("Secure", self.login("alice", "pw-alice").headers["set-cookie"])

    def test_expired_session_is_signed_out(self):
        client = self.signed_in("alice")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE sessions SET created_at = now() - interval '13 hours', expires_at = now() - interval '1 hour'")
        self.assertEqual(client.get("/api/me").status_code, 401)

    def test_session_lasts_twelve_hours(self):
        self.signed_in("alice")
        hours = self.query("SELECT extract(epoch FROM expires_at - created_at) / 3600 FROM sessions")[0][0]
        self.assertAlmostEqual(float(hours), 12, places=2)

    def test_sign_out_deletes_the_session(self):
        client = self.signed_in("alice")
        token = client.cookies.get("yq_session")
        self.assertEqual(client.post("/api/logout").status_code, 204)
        self.assertEqual(self.query("SELECT count(*) FROM sessions"), [(0,)])
        stale = TestClient(app)
        stale.cookies.set("yq_session", token)
        self.assertEqual(stale.get("/api/me").status_code, 401)

    def test_sixth_attempt_after_five_failures_is_429_without_ldap(self):
        for _ in range(5):
            self.assertEqual(self.login("alice", "nope").status_code, 401)
        binds = self.ldap.binds
        response = self.login("alice", "pw-alice")
        self.assertEqual((response.status_code, response.json()["detail"]), (429, "嘗試次數過多，請稍後再試"))
        self.assertEqual(self.ldap.binds, binds)

    def test_parallel_attempts_cannot_pass_the_limit(self):
        async def attempt():
            async with db.connect() as conn:
                return await auth.claim_attempt(conn, "carol")

        async def burst():
            return await asyncio.gather(*(attempt() for _ in range(20)))
        self.assertEqual(sum(asyncio.run(burst())), 5)

    def test_unreachable_ldap_does_not_count_as_a_failure(self):
        self.ldap.unreachable = True
        for _ in range(6):
            self.assertEqual(self.login("alice", "pw-alice").status_code, 503)
        self.ldap.unreachable = False
        self.assertEqual(self.login("alice", "pw-alice").status_code, 200)

    def test_cookie_secure_flag_can_be_forced_behind_a_proxy(self):
        with patch("auth.SESSION_COOKIE_SECURE", True):
            self.assertIn("Secure", self.login("alice", "pw-alice").headers["set-cookie"])

    def test_lockout_ends_after_five_minutes_and_success_resets_the_count(self):
        for _ in range(5):
            self.login("alice", "nope")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE login_failures SET first_failed_at = now() - interval '6 minutes', last_failed_at = now() - interval '6 minutes'")
        self.assertEqual(self.login("alice", "pw-alice").status_code, 200)
        self.assertEqual(self.query("SELECT count(*) FROM login_failures"), [(0,)])

    def test_failures_spread_beyond_the_window_do_not_lock(self):
        for _ in range(4):
            self.login("alice", "nope")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE login_failures SET first_failed_at = now() - interval '6 minutes'")
        self.login("alice", "nope")
        self.assertEqual(self.query("SELECT count FROM login_failures"), [(1,)])
        self.assertEqual(self.login("alice", "pw-alice").status_code, 200)

    def test_dn_template_mode_binds_directly(self):
        with patch("auth.LDAP_USER_DN_TEMPLATE", "cn={username},ou=people,dc=corp"):
            self.assertEqual(self.login("bob", "pw-bob").json()["displayName"], "bob")
            self.assertEqual(self.login("bob", "bad").status_code, 401)



class SignedOutTests(AccountTestCase):
    def test_translation_api_without_a_session_is_401_and_never_reaches_the_model(self):
        with patch("server.httpx.AsyncClient") as client:
            response = TestClient(app).post("/api/translate/stream", json={"text": "你好", "source": "zh", "target": "en"})
        self.assertEqual((response.status_code, response.json()["detail"]), (401, "請先登入"))
        client.assert_not_called()

    def test_transcription_websocket_without_a_session_closes_4401_before_asr(self):
        with patch("server.websockets.connect") as upstream, patch("server.mai_asr.MaiBridge") as mai:
            with self.assertRaises(WebSocketDisconnect) as closed:
                with TestClient(app).websocket_connect("/ws/transcribe") as websocket:
                    websocket.send_json({"language": "zh"})
                    websocket.receive_json()
        self.assertEqual(closed.exception.code, 4401)
        upstream.assert_not_called()
        mai.assert_not_called()

    def test_main_page_redirects_to_sign_in(self):
        response = TestClient(app).get("/", follow_redirects=False)
        self.assertEqual((response.status_code, response.headers["location"]), (303, "/login"))

    def test_public_paths_stay_open(self):
        client = TestClient(app)
        self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertIn("登入", client.get("/login").text)
        self.assertEqual(client.get("/assets/login.html").status_code, 200)

    def test_every_other_route_requires_a_session(self):
        public = {"/login", "/api/login", "/api/logout", "/api/health"}
        client = TestClient(app)
        for route in app.routes:
            path, methods = getattr(route, "path", ""), getattr(route, "methods", None) or set()
            if path in public or not methods or path.startswith(("/docs", "/redoc", "/openapi")):
                continue
            concrete = re.sub(r"\{[^}]+\}", "x", path)
            for method in methods - {"HEAD"}:
                response = client.request(method, concrete, follow_redirects=False)
                self.assertIn(response.status_code, (401, 303), f"{method} {path}")



class CrossSiteTests(AccountTestCase):
    def test_websocket_from_another_site_is_refused_before_asr(self):
        client = self.signed_in("alice")
        with patch("server.websockets.connect") as upstream:
            with self.assertRaises(WebSocketDisconnect) as closed:
                with client.websocket_connect("/ws/transcribe", headers={"origin": "https://evil.example"}) as websocket:
                    websocket.send_json({"language": "zh"})
                    websocket.receive_json()
        self.assertEqual(closed.exception.code, 4403)
        upstream.assert_not_called()

    def test_state_changing_request_from_another_site_is_403(self):
        client = self.signed_in("alice")
        response = client.post("/api/logout", headers={"origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.query("SELECT count(*) FROM sessions"), [(1,)])

    def test_same_origin_and_originless_requests_pass(self):
        client = self.signed_in("alice")
        self.assertEqual(client.post("/api/logout", headers={"origin": "http://testserver"}).status_code, 204)
        login = TestClient(app).post("/api/login", json={"username": "bob", "password": "pw-bob"})
        self.assertEqual(login.status_code, 200)

    def test_sign_in_from_another_site_is_403(self):
        response = TestClient(app).post("/api/login", json={"username": "bob", "password": "pw-bob"}, headers={"origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.ldap.binds, 0)



class TeamAdminTests(AccountTestCase):
    def test_non_administrator_cannot_manage_teams(self):
        client = self.signed_in("alice")
        team = self.signed_in("admin").post("/api/admin/teams", json={"name": "研發"}).json()
        calls = [("GET", "/api/admin/teams", None), ("POST", "/api/admin/teams", {"name": "業務"}),
                 ("PATCH", f"/api/admin/teams/{team['id']}", {"name": "改名"}),
                 ("POST", f"/api/admin/teams/{team['id']}/members", {"username": "alice"}),
                 ("DELETE", f"/api/admin/teams/{team['id']}/members/alice", None)]
        for method, path, body in calls:
            self.assertEqual(client.request(method, path, json=body).status_code, 403, f"{method} {path}")
        self.assertEqual(self.query("SELECT name FROM teams"), [("研發",)])
        self.assertEqual(self.query("SELECT count(*) FROM team_members"), [(0,)])
        self.assertEqual(client.get("/admin", follow_redirects=False).status_code, 403)

    def test_duplicate_team_name_ignoring_case_and_spaces_is_409(self):
        admin = self.signed_in("admin")
        self.assertEqual(admin.post("/api/admin/teams", json={"name": "R&D Team"}).status_code, 201)
        self.assertEqual(admin.post("/api/admin/teams", json={"name": "  r&d team "}).status_code, 409)
        other = admin.post("/api/admin/teams", json={"name": "業務"}).json()
        self.assertEqual(admin.patch(f"/api/admin/teams/{other['id']}", json={"name": "R&D TEAM"}).status_code, 409)
        self.assertEqual(self.query("SELECT name FROM teams ORDER BY id"), [("R&D Team",), ("業務",)])

    def test_member_added_before_first_sign_in_gets_the_team(self):
        admin = self.signed_in("admin")
        team = admin.post("/api/admin/teams", json={"name": "研發"}).json()
        self.assertEqual(admin.post(f"/api/admin/teams/{team['id']}/members", json={"username": " Bob "}).status_code, 201)
        listed = admin.get("/api/admin/teams").json()
        self.assertEqual(listed[0]["members"], [{"username": "bob", "displayName": "", "signedIn": False}])
        bob = TestClient(app).post("/api/login", json={"username": "bob", "password": "pw-bob"}).json()
        self.assertEqual(bob["teams"], [{"id": team["id"], "name": "研發"}])

    def test_a_user_can_belong_to_several_teams_and_be_removed(self):
        admin = self.signed_in("admin")
        ids = [admin.post("/api/admin/teams", json={"name": name}).json()["id"] for name in ("研發", "業務")]
        for team_id in ids:
            admin.post(f"/api/admin/teams/{team_id}/members", json={"username": "alice"})
        self.assertEqual([t["name"] for t in self.signed_in("alice").get("/api/me").json()["teams"]], ["業務", "研發"])
        self.assertEqual(admin.delete(f"/api/admin/teams/{ids[0]}/members/alice").status_code, 204)
        self.assertEqual([t["name"] for t in self.signed_in("alice").get("/api/me").json()["teams"]], ["業務"])
        self.assertEqual(admin.delete(f"/api/admin/teams/{ids[0]}/members/alice").status_code, 404)

    def test_administrator_flag_comes_from_admin_users(self):
        self.assertTrue(self.signed_in("admin").get("/api/me").json()["admin"])
        self.assertFalse(self.signed_in("alice").get("/api/me").json()["admin"])



class MeetingOwnershipTests(AccountTestCase):
    def test_meeting_stores_the_chosen_team_and_creator(self):
        team_id = self.team("研發", "alice")
        response = self.signed_in("alice").post("/api/meetings", json={"team_id": team_id, "language": "ja", "engine": "hybrid"})
        self.assertEqual(response.status_code, 201)
        stored = self.query("SELECT id::text, team_id, created_by, language, engine FROM meetings")
        self.assertEqual(stored, [(response.json()["id"], team_id, "alice", "ja", "hybrid")])

    def test_team_the_user_is_not_in_is_404_and_creates_nothing(self):
        other = self.team("業務", "bob")
        for team_id in (other, 99999):
            response = self.signed_in("alice").post("/api/meetings", json={"team_id": team_id, "language": "zh"})
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])

    def test_websocket_without_or_with_a_foreign_meeting_closes_4404_before_asr(self):
        foreign = self.team("業務", "bob")
        foreign_meeting = self.signed_in("bob").post("/api/meetings", json={"team_id": foreign, "language": "zh"}).json()["id"]
        for header in ({"language": "zh"}, {"language": "zh", "meeting_id": foreign_meeting}, {"language": "zh", "meeting_id": "not-a-uuid"}):
            with patch("server.websockets.connect") as upstream, patch("server.mai_asr.MaiBridge") as mai:
                with self.assertRaises(WebSocketDisconnect) as closed:
                    with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                        websocket.send_json(header)
                        websocket.receive_json()
                self.assertEqual(closed.exception.code, 4404, header)
                upstream.assert_not_called()
                mai.assert_not_called()

    def test_meeting_list_shows_only_the_users_teams(self):
        mine, theirs = self.team("研發", "alice"), self.team("業務", "bob")
        self.signed_in("alice").post("/api/meetings", json={"team_id": mine, "language": "zh"})
        self.signed_in("bob").post("/api/meetings", json={"team_id": theirs, "language": "zh"})
        listed = self.signed_in("alice").get("/api/meetings").json()
        self.assertEqual([(m["team"], m["createdBy"]) for m in listed], [("研發", "alice")])


class TeamIsolationTests(AccountTestCase):
    def test_member_of_another_team_gets_404_like_a_missing_meeting(self):
        theirs = self.team("業務", "bob")
        meeting = self.signed_in("bob").post("/api/meetings", json={"team_id": theirs, "language": "zh"}).json()["id"]
        self.team("研發", "alice")
        alice = self.signed_in("alice")
        foreign, missing = alice.get(f"/api/meetings/{meeting}"), alice.get("/api/meetings/00000000-0000-0000-0000-000000000000")
        self.assertEqual((foreign.status_code, foreign.json()), (missing.status_code, missing.json()))
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(alice.get("/api/meetings").json(), [])

    def test_removed_member_loses_access_on_the_next_request(self):
        team_id = self.team("研發", "alice")
        alice = self.signed_in("alice")
        meeting = alice.post("/api/meetings", json={"team_id": team_id, "language": "zh"}).json()["id"]
        self.assertEqual(alice.get(f"/api/meetings/{meeting}").status_code, 200)
        self.assertEqual(self.signed_in("admin").delete(f"/api/admin/teams/{team_id}/members/alice").status_code, 204)
        self.assertEqual(alice.get(f"/api/meetings/{meeting}").status_code, 404)
        self.assertEqual(alice.get("/api/meetings").json(), [])

    def test_administrator_outside_the_team_gets_404(self):
        team_id = self.team("業務", "bob")
        meeting = self.signed_in("bob").post("/api/meetings", json={"team_id": team_id, "language": "zh"}).json()["id"]
        admin = self.signed_in("admin")
        self.assertEqual(admin.get(f"/api/meetings/{meeting}").status_code, 404)
        self.assertEqual(admin.get("/api/meetings").json(), [])
        self.assertEqual(admin.post("/api/meetings", json={"team_id": team_id, "language": "zh"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
