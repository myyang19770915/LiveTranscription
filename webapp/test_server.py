import array
import asyncio
import base64
import contextlib
import hashlib
import io
import json
import logging
import math
import os
import re
import shutil
import ssl
import struct
import tempfile
import time
import wave
import zipfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import httpx
import psycopg
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from ldap3 import MOCK_SYNC, OFFLINE_AD_2012_R2, Connection, Server, Tls
from ldap3.core.exceptions import LDAPSocketOpenError

import auth
import db
import diarize
import interpret
import interpret_usage
import mai_asr
import mailer
import meeting_audio
import minutes
import qa
import record_meeting
import records_retention
import team_access
import chunk_asr
import mai_usage
import quality_pass
import revise_pass
import reminders
import search
import server
import stream_limits
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


MAIN_DATABASE_URL = db.DATABASE_URL or os.environ.get("DATABASE_URL", "")
# The compose database server, but its separate yuqiao_test database. Importing connects to nothing, so the tests that
# need no database (LDAP settings, minutes rules…) also run when it is down; setUpModule creates it if needed.
TEST_DATABASE_URL = MAIN_DATABASE_URL.rsplit("/", 1)[0] + "/yuqiao_test"
db.DATABASE_URL = TEST_DATABASE_URL


def setUpModule():
    """Create yuqiao_test if needed. unittest runs this once, before any test of this module; when the database is
    down it only prints why, and each test that needs the database then fails on its own while the others pass."""
    if not MAIN_DATABASE_URL:
        print("DATABASE_URL is not set: the tests that need yuqiao_test will fail (run them in the app container)")
        return
    try:
        with psycopg.connect(MAIN_DATABASE_URL, autocommit=True, connect_timeout=5) as conn:
            if not conn.execute("SELECT 1 FROM pg_database WHERE datname = 'yuqiao_test'").fetchone():
                conn.execute("CREATE DATABASE yuqiao_test")
    except psycopg.OperationalError as exc:
        print(f"yuqiao_test unavailable: {exc}")


# Nor do tests depend on how this container is deployed: the translation model is the local one and 精準模式 is
# unconfigured unless a test says otherwise (cloud-translation, quality-pass).
server.TRANSLATE_URL, server.TRANSLATE_KEY, server.TRANSLATE_EXTRA = "http://translate:5000", "", {}
server.TRANSLATE_HEALTH_URL = "http://translate:5000/health"
quality_pass.URL = quality_pass.KEY = quality_pass.ASR_MODEL = quality_pass.MODEL = quality_pass.ASR = ""
quality_pass.ASR_URL = quality_pass.ASR_KEY = ""
quality_pass.EXTRA, quality_pass.ASR_EXTRA = {}, {}
quality_pass.REVISE, quality_pass.REVISE_EXTRA = False, {}
# Tests never reach the real diarize service; DiarizeApiTests turn it on with a fake service call.
diarize.DIARIZE_URL = ""
# Nor a mail server: tests that send replace mailer.send_message (the container may point SMTP_HOST at dev-mail).
mailer.SMTP_HOST = ""


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
        # A verifying Tls, like auth.ldap_server() gives: secure_bind refuses StartTLS without one.
        self.server = Server("fake", get_info=OFFLINE_AD_2012_R2, tls=Tls(validate=ssl.CERT_REQUIRED))
        self.binds = 0
        self.unreachable = False
        self.starttls_ok = True  # what start_tls() answers when LDAP_TLS is starttls
        self.starttls_calls = 0
        self.starttls_error = None  # raised by start_tls() instead of answering, like a failed certificate check
        seed = Connection(self.server, user="cn=svc,dc=corp", password="svcpw", client_strategy=MOCK_SYNC)
        seed.strategy.add_entry("cn=svc,dc=corp", {"userPassword": "svcpw", "sAMAccountName": "svc"})
        self.seed = seed

    def add(self, username, password, display_name="", mail=""):
        attributes = {"userPassword": password, "sAMAccountName": username, "objectClass": "person"}
        if display_name:
            attributes["displayName"] = display_name
        if mail:
            attributes["mail"] = mail
        self.seed.strategy.add_entry(f"cn={username},ou=people,dc=corp", attributes)

    def connection(self, user, password):
        if self.unreachable:
            raise LDAPSocketOpenError("unreachable")
        fake = self

        class Counted(Connection):
            def bind(self, *args, **kwargs):
                fake.binds += 1
                return super().bind(*args, **kwargs)

            def start_tls(self, read_server_info=True):
                fake.starttls_calls += 1
                if fake.starttls_error is not None:
                    raise fake.starttls_error
                return fake.starttls_ok
        return Counted(self.server, user=user, password=password, client_strategy=MOCK_SYNC)

    def patches(self):
        return [patch("auth.ldap_connection", self.connection), patch("auth.LDAP_URL", "ldap://fake"), patch("auth.LDAP_TLS", "none"),
                patch("auth.LDAP_BIND_DN", "cn=svc,dc=corp"), patch("auth.LDAP_BIND_PASSWORD", "svcpw"),
                patch("auth.LDAP_BASE_DN", "dc=corp"), patch("auth.LDAP_USER_DN_TEMPLATE", ""),
                patch("auth.LDAP_USER_FILTER", "(sAMAccountName={username})"), patch("auth.LDAP_DISPLAY_ATTR", "displayName"), patch("auth.LDAP_MAIL_ATTR", "mail"),
                patch("auth.ADMIN_USERS", frozenset({"admin"}))]


class LdapEncryptionTests(unittest.TestCase):
    """Encrypted LDAP connection: which encryption each setting gives, and that certificates are always checked."""

    def settings(self, url, tls="", ca=""):
        stack = [patch("auth.LDAP_URL", url), patch("auth.LDAP_TLS", tls), patch("auth.LDAP_CA_FILE", ca)]
        for fake in stack:
            fake.start()
            self.addCleanup(fake.stop)

    def test_encryption_chosen_from_settings(self):
        with tempfile.NamedTemporaryFile(suffix=".pem", delete=False) as handle:
            ca_pem = handle.name  # ldap3 only checks that the CA file exists when the Server is built
        self.addCleanup(os.remove, ca_pem)
        rows = [  # LDAP_URL, LDAP_TLS, LDAP_CA_FILE -> encryption, CA file (None: system CAs; "-": no TLS)
            ("ldaps://h", "", "", "LDAPS", None),
            ("ldaps://h", "none", ca_pem, "LDAPS", ca_pem),
            ("ldap://h", "", "", "StartTLS", None),
            ("ldap://h", "starttls", ca_pem, "StartTLS", ca_pem),
            ("ldap://h", "none", "", "明文", "-"),
            ("ldap://h", "yes", "", "StartTLS", None),
        ]
        for url, tls, ca, encryption, ca_file in rows:
            with self.subTest(url=url, tls=tls, ca=ca):
                with patch("auth.LDAP_URL", url), patch("auth.LDAP_TLS", tls), patch("auth.LDAP_CA_FILE", ca):
                    self.assertEqual(auth.ldap_encryption(), encryption)
                    server = auth.ldap_server()
                    self.assertEqual(server.ssl, encryption == "LDAPS")
                    if ca_file == "-":
                        self.assertIsNone(server.tls)
                    else:
                        self.assertEqual(server.tls.validate, ssl.CERT_REQUIRED)
                        self.assertEqual(server.tls.ca_certs_file, ca_file)

    def test_unknown_ldap_tls_value_is_logged_as_an_error(self):
        for url, used in (("ldap://h", "StartTLS"), ("ldaps://h", "LDAPS")):
            with self.subTest(url=url):
                self.settings(url, "yes")
                with self.assertLogs("uvicorn.error", "ERROR") as logs:
                    auth.log_ldap_tls_setting()
                self.assertIn("'yes'", logs.output[0])
                self.assertIn(f"connecting with {used}", logs.output[0])

    def test_plaintext_is_logged_as_a_warning(self):
        self.settings("ldap://dev-ldap:389", "none")
        with self.assertLogs("uvicorn.error", "WARNING") as logs:
            auth.log_ldap_tls_setting()
        self.assertIn("unencrypted", logs.output[0])

    def test_encrypted_settings_log_nothing(self):
        self.settings("ldap://h", "starttls")
        with self.assertNoLogs("uvicorn.error", "WARNING"):
            auth.log_ldap_tls_setting()

    def test_check_ldap_reports_the_encryption(self):
        self.settings("ldap://ldap.corp.example", "")
        profile = auth.Profile("愛麗", "")
        with patch("auth.getpass.getpass", return_value="pw"), patch("auth.ldap_authenticate", return_value=profile), \
                patch("sys.stdout", new_callable=io.StringIO) as out:
            asyncio.run(auth.check_ldap("alice"))
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], "加密方式：StartTLS")
        self.assertTrue(lines[1].startswith("登入成功：alice"))


class AccountTestCase(DatabaseTestCase):
    """A fake LDAP with alice/pw-alice (王愛麗), bob/pw-bob and admin/pw-admin."""

    def setUp(self):
        super().setUp()
        auth.ip_failures.clear()   # every test client signs in from the same address
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

    def test_asr_request_id_is_the_gateways_never_the_browsers(self):
        upstream = FakeUpstream(["好。"])
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as socket:
                socket.send_json({"requestId": "../../outside", "meeting_id": self.meeting_id(), "language": "zh"})
                socket.receive_json()  # the header has reached the ASR side by now
        self.assertNotIn("retain", json.loads(upstream.sent[0]))   # meetings are kept; only 即時翻譯 says retain: false
        request_id = json.loads(upstream.sent[0])["requestId"]
        self.assertRegex(request_id, r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        self.assertNotIn("outside", request_id)

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

    def test_a_draft_continues_the_draft_already_shown(self):
        # smooth-subtitles: the shown draft goes to the model with a draft request only.
        body = TranslationRequest(text="So it kind of depends on what your definition of scale is", source="en", target="zh", draft=True, previous_draft="所以這有點取決於")
        user = translation_payload(body)["messages"][1]["content"]
        self.assertIn("The reader already sees this draft for the beginning of the speech: 所以這有點取決於\n", user)
        self.assertIn("keep its wording for the part it covers unless it is wrong", user)
        without = translation_payload(body.model_copy(update={"previous_draft": ""}))["messages"][1]["content"]
        self.assertNotIn("already sees", without)
        self.assertEqual(without, translation_payload(TranslationRequest(text=body.text, source="en", target="zh", draft=True))["messages"][1]["content"])
        final = translation_payload(body.model_copy(update={"draft": False}))["messages"][1]["content"]
        self.assertNotIn("所以這有點取決於", final)
        with self.assertRaises(ValueError):
            TranslationRequest(text="x", source="en", target="zh", previous_draft="字" * 601)

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

    def test_a_keyed_translation_service_gets_the_key_and_only_openai_options(self):
        """cloud-translation: drafts, finals, single sentences and term discovery go to the keyed external service."""
        body = TranslationRequest(text="它會自動安裝好。", source="zh", target="ja", draft=True)
        payload = translation_payload(body)
        url, headers, sent = translation_backend(body, payload)   # no key: local llama.cpp, unchanged
        self.assertEqual((headers, sent), ({}, payload))
        self.assertIn("chat_template_kwargs", sent)
        self.assertIs(self.signed_in("alice").get("/api/config").json()["cloudTranslate"], False)
        with patch.multiple("server", TRANSLATE_URL="http://gateway:4001", TRANSLATE_KEY="k", TRANSLATE_EXTRA={"thinking": {"type": "disabled"}}):
            url, headers, sent = translation_backend(body, payload)
            self.assertEqual((url, headers), ("http://gateway:4001/v1/chat/completions", {"Authorization": "Bearer k"}))
            self.assertEqual(sent["thinking"], {"type": "disabled"})
            self.assertFalse({"repeat_penalty", "chat_template_kwargs", "top_p"} & set(sent))
            self.assertEqual(sent["messages"], payload["messages"])
            self.assertIs(self.signed_in("alice").get("/api/config").json()["cloudTranslate"], True)
            # 雲端精修 keeps its own service and key.
            with patch.multiple("server", REFINE_URL="https://cloud.example/v1", REFINE_MODEL="big", REFINE_KEY="r"):
                url, headers, sent = translation_backend(body.model_copy(update={"refine": True}), payload)
                self.assertEqual((url, headers["Authorization"]), ("https://cloud.example/v1/chat/completions", "Bearer r"))

    def test_term_discovery_asks_a_keyed_service_for_a_json_object(self):
        seen = {}

        class Client(FakeTranslationClient):
            async def post(self, url, json, headers=None):
                seen.update(url=url, json=json, headers=headers)
                return type("R", (), {"raise_for_status": lambda self: None, "json": lambda self: {"choices": [{"message": {"content": __import__("json").dumps(
                    {"terms": [{"said": "アナザージャパン", "heard": ["サンザジャパン"]}]}, ensure_ascii=False)}}]}})()
        text = "こちらのサンザジャパンの袋です。アナザージャパンは店の名前です。アナザージャパンで買いました。"
        with patch.multiple("server", TRANSLATE_URL="http://gateway:4001", TRANSLATE_KEY="k", TRANSLATE_EXTRA={}), patch("server.httpx.AsyncClient", Client):
            found = self.signed_in("alice").post("/api/terms", json={"text": text, "source": "ja"}).json()["found"]
        self.assertEqual(seen["headers"], {"Authorization": "Bearer k"})
        self.assertEqual(seen["json"]["response_format"], {"type": "json_object"})
        self.assertNotIn("chat_template_kwargs", seen["json"])
        self.assertIn("JSON object of this schema: " + json.dumps(server.TERMS_SCHEMA), seen["json"]["messages"][0]["content"])
        self.assertIn("アナザージャパン", found)

    def test_single_sentence_translation_and_repair_use_the_keyed_service(self):
        sent = []

        class Client(FakeStreamingClient):
            async def post(self, url, json, headers=None):
                sent.append((url, json, headers))
                return FakeTranslationResponse()
        with patch.multiple("server", TRANSLATE_URL="http://gateway:4001", TRANSLATE_KEY="k", TRANSLATE_EXTRA={"thinking": {"type": "disabled"}}), \
                patch("server.httpx.AsyncClient", Client), patch("server.violations", side_effect=[["Output is not Japanese."], []]):
            client = self.signed_in("alice")
            self.assertEqual(client.post("/api/translate", json={"text": "Good morning.", "source": "en", "target": "zh"}).status_code, 200)
            # A final whose first attempt fails a check is repaired with one more request.
            client.post("/api/translate/stream", json={"text": "它會自動安裝好。", "source": "zh", "target": "ja"})
        self.assertEqual(len(sent), 2)   # the single sentence and the repair
        for url, body, headers in sent:
            self.assertEqual((url, headers), ("http://gateway:4001/v1/chat/completions", {"Authorization": "Bearer k"}))
            self.assertEqual(body["thinking"], {"type": "disabled"})
            self.assertFalse({"repeat_penalty", "chat_template_kwargs", "top_p"} & set(body))

    def test_translate_extra_must_be_a_json_object(self):
        self.assertEqual(server.translate_extra('{"thinking": {"type": "disabled"}}'), {"thinking": {"type": "disabled"}})
        self.assertEqual(server.translate_extra(""), {})
        for bad in ("{bad", "[1]", "3"):
            with self.assertLogs("uvicorn.error", level="WARNING"):
                self.assertEqual(server.translate_extra(bad), {})

    def test_the_translation_health_url_can_be_set(self):
        """service-status: the Translation health URL example table."""
        self.assertEqual(server.translation_health_url("http://translate:5000"), "http://translate:5000/health")
        self.assertEqual(server.translation_health_url("http://gateway:4001", "http://gateway:4001/health/liveliness"), "http://gateway:4001/health/liveliness")
        asked = []

        async def ok(url):
            asked.append(url)
            return True
        with patch("server.service_ok", ok), patch("server.TRANSLATE_HEALTH_URL", "http://gateway:4001/health/liveliness"):
            self.assertTrue(self.signed_in("alice").get("/api/services").json()["ready"])
        self.assertIn("http://gateway:4001/health/liveliness", asked)

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

    def test_mai_intermediate_text_is_sent_as_tentative_until_its_delta(self):
        inter = lambda text: {"type": "conversation.item.input_audio_transcription.intermediate", "intermediate": text}
        delta = lambda text: {"type": "conversation.item.input_audio_transcription.delta", "delta": text}
        done = {"type": "conversation.item.input_audio_transcription.completed", "transcript": "这个会议支持实时翻译"}
        sent = self.run_items("zh", [inter("这个会议"), delta("这个会议"), inter("支持实时"), delta("支持实时翻译"), done])
        self.assertEqual([(p["msg"]["text"], p["tentative"]) for p in sent],
                         [("", "這個會議"), ("这个会议", ""), ("", "支持實時"), ("支持实时翻译", ""), ("。", "")])
        self.assertEqual(sent[-1]["displayText"], "這個會議支持實時翻譯。")

    def test_mai_tentative_text_is_cut_at_word_boundaries_and_cleared_on_reconnect(self):
        inter = lambda text: {"type": "conversation.item.input_audio_transcription.intermediate", "intermediate": text}
        delta = lambda text: {"type": "conversation.item.input_audio_transcription.delta", "delta": text}
        sent = self.run_items("en", [inter(" FSD and robotaxis?"), delta(" FSD"), delta(" and robotaxi"), inter(" or do we"), {"type": "reconnected"}])
        self.assertEqual([p["tentative"] for p in sent], [" FSD and robotaxis?", " and robotaxis?", "", " or do we", ""])

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


class AudioUntilEos(AudioAfter):
    """AudioAfter that stays open until the page sends the end-of-stream text, as ASR does."""

    def __init__(self, wait):
        super().__init__(wait)
        self.ended = asyncio.Event()

    async def send(self, message):
        await super().send(message)
        if isinstance(message, str) and message.endswith("_EOS"):
            self.ended.set()

    async def __aiter__(self):
        async for message in super().__aiter__():
            yield message
        await self.ended.wait()


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


class HoldUpstream(FakeUpstream):
    """An engine that stays connected and silent until the browser leaves."""

    def __init__(self):
        super().__init__([])

    async def __aiter__(self):
        await asyncio.Event().wait()
        yield ""


class StreamLimitTests(AccountTestCase):
    """stream-limits: start message, streams per user, stream length, access re-checked while streaming."""

    def setUp(self):
        super().setUp()
        self.addCleanup(stream_limits.active.clear)

    def wait_for(self, condition):
        for _ in range(100):
            if condition():
                return
            time.sleep(0.02)
        self.fail("condition not reached")

    def closed_code(self, websocket):
        with self.assertRaises(WebSocketDisconnect) as closed:
            for _ in range(10):
                websocket.receive_json()
        return closed.exception.code

    def test_a_third_stream(self):
        client = self.signed_in("alice")
        with patch("server.websockets.connect", side_effect=lambda *a, **k: HoldUpstream()):
            with client.websocket_connect("/ws/transcribe") as first:
                first.send_json({"mode": "translate", "language": "zh"})
                with client.websocket_connect("/ws/transcribe") as second:
                    second.send_json({"mode": "translate", "language": "zh"})
                    self.wait_for(lambda: stream_limits.active.get("alice") == 2)
                    with client.websocket_connect("/ws/transcribe") as third:
                        self.assertEqual(self.closed_code(third), 4429)
                self.wait_for(lambda: stream_limits.active.get("alice") == 1)   # the second one ended
                with client.websocket_connect("/ws/transcribe") as again:
                    again.send_json({"mode": "translate", "language": "zh"})
                    self.wait_for(lambda: stream_limits.active.get("alice") == 2)
        self.wait_for(lambda: "alice" not in stream_limits.active)

    def test_no_start_message(self):
        with patch("stream_limits.STREAM_HEADER_TIMEOUT", 0.2), patch("server.websockets.connect") as upstream:
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                self.assertEqual(self.closed_code(websocket), 4408)
        upstream.assert_not_called()

    def test_audio_accepted(self):
        rows = [(4, 460_799_000, 1_000, True), (4, 460_800_000, 2, False), (1, 115_199_999, 2, False)]   # spec example
        for hours, received, chunk, accepted in rows:
            with self.subTest(hours=hours, received=received), patch("stream_limits.MAX_STREAM_HOURS", hours):
                self.assertIs(stream_limits.accepts(received, chunk), accepted)

    def recorded(self, meeting):
        team_id = self.query("SELECT team_id FROM meetings WHERE id = %s", (meeting,))[0][0]
        self.wait_for(lambda: self.query("SELECT ended_at IS NOT NULL FROM meetings")[0][0])
        with wave.open(str(self.output / "teams" / str(team_id) / meeting / "audio.wav")) as w:
            return w.readframes(w.getnframes())

    @staticmethod
    def forwarded(upstream):
        return b"".join(m for m in upstream.sent if isinstance(m, bytes))

    def test_a_stream_reaches_its_length_limit(self):
        meeting = self.meeting_id()
        upstream = HoldUpstream()
        with patch("stream_limits.MAX_STREAM_HOURS", 3200 / stream_limits.BYTES_PER_HOUR), \
                patch("server.websockets.connect", return_value=upstream), self.signed_in("alice") as client:
            with client.websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": meeting, "language": "zh"})
                websocket.send_bytes(b"\x01\x00" * 1600)   # exactly the limit
                websocket.send_bytes(b"\x02\x00")          # one sample too many
                self.assertTrue(websocket.receive_json()["msg"].startswith("已達單場上限"))
                self.assertEqual(self.closed_code(websocket), 4413)
            self.assertEqual(self.recorded(meeting), b"\x01\x00" * 1600)
        self.assertEqual(self.forwarded(upstream), b"\x01\x00" * 1600)

    def test_signed_out_in_another_tab(self):
        meeting = self.meeting_id()
        upstream = HoldUpstream()
        with patch("stream_limits.STREAM_RECHECK_MINUTES", 0), patch("server.websockets.connect", return_value=upstream), \
                self.signed_in("alice") as client:
            with client.websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": meeting, "language": "zh"})
                websocket.send_bytes(b"\x01\x00" * 160)
                self.wait_for(lambda: len(self.forwarded(upstream)) == 320)
                run_sql("DELETE FROM sessions")
                websocket.send_bytes(b"\x02\x00" * 160)
                self.assertEqual(self.closed_code(websocket), 4401)
            self.assertEqual(self.recorded(meeting), b"\x01\x00" * 160)

    def test_removed_from_the_team(self):
        meeting = self.meeting_id()
        upstream = HoldUpstream()
        with patch("stream_limits.STREAM_RECHECK_MINUTES", 0), patch("server.websockets.connect", return_value=upstream), \
                self.signed_in("alice") as client:
            with client.websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"meeting_id": meeting, "language": "zh"})
                websocket.send_bytes(b"\x01\x00" * 160)
                self.wait_for(lambda: len(self.forwarded(upstream)) == 320)
                run_sql("DELETE FROM team_members WHERE username = 'alice'")
                websocket.send_bytes(b"\x02\x00" * 160)
                self.assertEqual(websocket.receive_json()["msg"], "你已不是這個團隊的成員，錄音已停止")
                self.assertEqual(self.closed_code(websocket), 4403)
            self.assertEqual(self.recorded(meeting), b"\x01\x00" * 160)

    def test_a_database_outage_does_not_end_the_stream(self):
        class Browser(FakeBrowser):
            async def receive(self):
                return {"bytes": b"\x01\x00" * 160}
        guard = stream_limits.StreamGuard(Browser(), auth.User("alice", "", False, []), "token", None)

        async def unreachable(_token):
            raise psycopg.OperationalError("database restarting")
        with patch("stream_limits.STREAM_RECHECK_MINUTES", 0), patch("auth.session_user", unreachable), \
                self.assertLogs("uvicorn.error", "WARNING"):
            event = asyncio.run(guard.receive())   # the check fails: the chunk still goes through
        self.assertEqual(event["bytes"], b"\x01\x00" * 160)
        self.assertGreater(guard._checked, time.monotonic() - 1)   # …and the check is due again in 30 s, not now

    def test_the_mai_engine_reads_through_the_guard(self):
        frames = [b"\x02\x00" * 1600, b"\x03\x00" * 1600]

        class Browser(FakeBrowser):
            def __init__(self):
                super().__init__()
                self.events = [{"bytes": f} for f in frames] + [{"text": mai_asr.EOS}]

            async def receive(self):
                return self.events.pop(0)
        browser = Browser()
        guard = stream_limits.StreamGuard(browser, auth.User("alice", "", False, []), None, None)
        bridge = mai_asr.MaiBridge(guard, "en", TranscriptDisplay("en", ""), None)
        sent = []

        async def send(message):
            sent.append(message)
        bridge.send = send
        with patch("stream_limits.MAX_STREAM_HOURS", 3200 / stream_limits.BYTES_PER_HOUR):
            with self.assertRaises(stream_limits.StreamStopped) as stopped:
                asyncio.run(bridge.browser_to_mai())
        self.assertEqual(stopped.exception.code, 4413)
        appended = b"".join(base64.b64decode(m["audio"]) for m in sent if m["type"] == "input_audio_buffer.append")
        self.assertEqual(appended, frames[0])
        self.assertTrue(browser.sent[-1]["msg"].startswith("已達單場上限"))


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

    def test_a_revised_source_is_saved_and_the_recognizer_text_stays(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.save(client, meeting, [("一", "One."), ("跟先生的感情變得穩定。", "became stable.")])
        self.save(client, meeting, [("一", "One."), ("跟先生的感情變得不穩定。", "became unstable.")])
        self.assertEqual(self.segment(2), ("跟先生的感情變得穩定。", "跟先生的感情變得不穩定。", "became stable.", "became unstable.", "unreviewed", 2))
        self.save(client, meeting, [("一", "One."), ("跟先生的感情變得不穩定！", "became unstable.")])   # the source alone
        self.assertEqual(self.segment(2)[1::4], ("跟先生的感情變得不穩定！", 3))
        self.assertEqual(self.segment(1)[5], 1)

    def test_a_revised_source_never_replaces_a_reviewers_correction(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.save(client, meeting, [("城市設計", "urban design")])
        self.assertEqual(client.post(f"/api/meetings/{meeting}/segments/1/confirm", json={"version": 1}).status_code, 200)
        before = self.segment(1)
        self.save(client, meeting, [("程式設計", "programming")])
        self.assertEqual(self.segment(1), before)

    # revision-merge: segments the live page merged become one stored segment.
    CUT = [(1, 0, 6000, "一", "One."), (2, 6000, 9000, "所以我們決定", "So we decided"), (3, 9000, 12000, "在下個月開始。", "Start next month."),
           (4, 12000, 15000, "四", "Four.")]
    JOINED = [(1, 0, 6000, "一", "One."), (2, 6000, 12000, "所以我們決定在下個月開始。", "So we decided to start next month."), (4, 12000, 15000, "四", "Four.")]

    def put(self, client, meeting, segments, merged=(), detected="zh"):
        body = {"sourceLanguage": "zh", "targetLanguage": "en", "merged": [{"into": into, "from": gone} for into, gone in merged],
                "segments": [{"seq": seq, "startMs": start, "endMs": end, "source": source, "target": target, "detected": detected}
                             for seq, start, end, source, target in segments]}
        return client.put(f"/api/meetings/{meeting}/segments", json=body)

    def stored(self):
        return self.query("SELECT seq, end_ms, asr_text, source, live_target, target, version FROM segments ORDER BY seq")

    def test_two_stored_segments_are_merged_into_one(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.put(client, meeting, self.CUT)
        self.assertEqual(self.put(client, meeting, self.JOINED, [(2, 3)]).status_code, 200)
        merged = [(1, 6000, "一", "一", "One.", "One.", 1),
                  (2, 12000, "所以我們決定在下個月開始。", "所以我們決定在下個月開始。", "So we decided Start next month.", "So we decided to start next month.", 2),
                  (4, 15000, "四", "四", "Four.", "Four.", 1)]
        self.assertEqual(self.stored(), merged)
        self.put(client, meeting, self.JOINED, [(2, 3)])   # the same save again changes nothing
        self.assertEqual(self.stored(), merged)

    def test_a_merge_with_a_segment_a_reviewer_handled_changes_neither(self):
        for handle in ("edit", "speaker", "confirm-into"):
            client, meeting = self.signed_in("alice"), self.meeting_id()
            self.put(client, meeting, self.CUT)
            if handle == "edit":
                self.assertEqual(client.post(f"/api/meetings/{meeting}/segments/3/edit", json={"version": 1, "source": "在下個月開始！"}).status_code, 200)
            elif handle == "speaker":
                with psycopg.connect(TEST_DATABASE_URL) as conn:
                    conn.execute("UPDATE segments SET speaker_manual = true WHERE seq = 3")
            else:
                self.assertEqual(client.post(f"/api/meetings/{meeting}/segments/2/confirm", json={"version": 1}).status_code, 200)
            before = self.stored()
            self.assertEqual(self.put(client, meeting, self.JOINED, [(2, 3)]).status_code, 200)
            self.assertEqual(self.stored(), before, handle)
            with psycopg.connect(TEST_DATABASE_URL) as conn:
                conn.execute("DELETE FROM segments")

    def test_a_merge_of_a_segment_that_was_never_saved(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.put(client, meeting, self.CUT[:2])
        self.put(client, meeting, self.JOINED[:2], [(2, 3)])
        self.assertEqual([row[:4] for row in self.stored()], [(1, 6000, "一", "一"), (2, 12000, "所以我們決定", "所以我們決定在下個月開始。")])

    def test_three_segments_merged_and_the_first_saved_texts_joined_by_language(self):
        for detected, parts, joined in (("ja", ("それで私たちは", "来月から", "始めます。"), "それで私たちは来月から始めます。"),
                                        ("en", ("So we decided", "to start", "next month."), "So we decided to start next month.")):
            client, meeting = self.signed_in("alice"), self.meeting_id()
            self.put(client, meeting, [(n + 1, n * 1000, n * 1000 + 1000, part, f"t{n + 1}") for n, part in enumerate(parts)], detected=detected)
            self.put(client, meeting, [(1, 0, 3000, joined, "all")], [(1, 2), (1, 3)], detected=detected)
            self.assertEqual(self.stored(), [(1, 3000, joined, joined, "t1 t2 t3", "all", 2)])
            with psycopg.connect(TEST_DATABASE_URL) as conn:
                conn.execute("DELETE FROM segments")

    def test_three_parts_with_one_a_reviewer_handled_all_stay(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        parts = [(1, 0, 1000, "甲", "A"), (2, 1000, 2000, "乙", "B"), (3, 2000, 3000, "丙", "C")]
        for handled in (2, 3):
            self.put(client, meeting, parts)
            self.assertEqual(client.post(f"/api/meetings/{meeting}/segments/{handled}/confirm", json={"version": 1}).status_code, 200)
            before = self.stored()
            self.put(client, meeting, [(1, 0, 3000, "甲乙丙", "A B C")], [(1, 2), (1, 3)])
            self.assertEqual(self.stored(), before, handled)
            with psycopg.connect(TEST_DATABASE_URL) as conn:
                conn.execute("DELETE FROM segments")

    def test_a_merge_of_a_part_never_saved_extends_the_stored_segment(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.put(client, meeting, self.CUT[:2])
        self.put(client, meeting, self.JOINED[:2], [(2, 3)])
        self.assertEqual(self.stored()[1][:2], (2, 12000))

    def test_a_merge_into_a_later_segment_is_refused(self):
        client, meeting = self.signed_in("alice"), self.meeting_id()
        self.put(client, meeting, self.CUT)
        for into, gone in ((3, 2), (2, 2), (0, 1)):
            self.assertEqual(self.put(client, meeting, self.JOINED, [(into, gone)]).status_code, 422, (into, gone))
        self.assertEqual(len(self.stored()), 4)

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
        self.assertEqual(bob.patch(f"/api/meetings/{meeting}", json={"title": " Q4 規劃 "}).json(),
                         {"id": meeting, "title": "Q4 規劃", "seriesId": None, "series": None})
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
        self.assertEqual((response.status_code, response.json()["detail"]), (400, "紀要功能尚未設定"))
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

    def test_board_status_time_series_and_people_teams(self):
        changed, untouched = self.item("改過狀態"), self.item("沒改過")
        self.assertEqual(self.change(changed, "doing").status_code, 200)
        weekly = self.alice.post(f"/api/teams/{self.team_id}/series", json={"name": "研發週會"}).json()["id"]
        self.alice.patch(f"/api/meetings/{self.meeting}", json={"series_id": weekly})
        items = {i["content"]: i for i in self.alice.get("/api/actions").json()["items"]}
        self.assertIsNotNone(items["改過狀態"]["statusAt"])
        self.assertIsNone(items["沒改過"]["statusAt"])
        self.assertEqual({i["series"] for i in items.values()}, {"研發週會"})
        sales = self.team("業務部", "alice", "bob")
        self.team("財務部", "bob", "carol")
        people = {p["username"]: p["teams"] for p in self.alice.get("/api/actions").json()["people"]}
        self.assertEqual(people, {"alice": sorted([self.team_id, sales]), "bob": sorted([self.team_id, sales])})

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


class SeriesTests(ReviewTestCase):
    """meeting-series: alice and bob in 研發部, carol in 業務部; today is 2026-11-13 (Asia/Taipei)."""
    TODAY = date(2026, 11, 13)

    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol")
        self.rd, self.sales = self.team("研發部", "alice", "bob"), self.team("業務部", "carol")
        self.alice = self.signed_in("alice")
        for name, value in (("minutes.MINUTES_URL", "http://model"), ("minutes.MINUTES_MODEL", "m"),
                            ("minutes.local_today", lambda: self.TODAY)):
            p = patch(name, value)
            p.start()
            self.addCleanup(p.stop)

    def series(self, name, team=None, client=None):
        return (client or self.alice).post(f"/api/teams/{team or self.rd}/series", json={"name": name})

    def meeting(self, series_id=None, team=None, client=None):
        body = {"team_id": team or self.rd, "language": "zh", **({"series_id": series_id} if series_id else {})}
        response = (client or self.alice).post("/api/meetings", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def item(self, meeting, content, kind="action", state="confirmed", status="todo", due=None):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute(
                "INSERT INTO minute_items (meeting_id, kind, content, origin, state, status, due_date, evidence) "
                "VALUES (%s, %s, %s, 'ai', %s, %s, %s, '{1}') RETURNING id", (meeting, kind, content, state, status, due)).fetchone()[0]

    # --- Team series ---
    def test_creating_series(self):
        # spec example "series names in team 研發部"
        first = self.series("研發週會")
        self.assertEqual((first.status_code, first.json()["name"]), (201, "研發週會"))
        again = self.series(" 研發週會 ")
        self.assertEqual((again.status_code, again.json()["id"]), (200, first.json()["id"]))
        sprint = self.series("Sprint Review")
        same = self.series("sprint review")
        self.assertEqual((same.status_code, same.json()), (200, {"id": sprint.json()["id"], "name": "Sprint Review"}))
        self.assertEqual(self.series("長" * 61).status_code, 422)
        self.assertEqual(self.series("   ").status_code, 422)
        self.assertEqual([s["name"] for s in self.alice.get(f"/api/teams/{self.rd}/series").json()], ["Sprint Review", "研發週會"])

    def test_another_teams_series(self):
        carol = self.signed_in("carol")
        self.assertEqual(carol.get(f"/api/teams/{self.rd}/series").status_code, 404)
        self.assertEqual(self.series("偷建", client=carol).status_code, 404)
        self.assertEqual(self.query("SELECT count(*) FROM meeting_series"), [(0,)])

    # --- Choosing a series ---
    def test_starting_a_meeting_in_a_series(self):
        weekly = self.series("研發週會").json()["id"]
        meeting = self.meeting(weekly)
        listed = self.alice.get("/api/meetings").json()[0]
        self.assertEqual((listed["seriesId"], listed["series"], listed["team"]), (weekly, "研發週會", "研發部"))
        detail = self.alice.get(f"/api/meetings/{meeting}").json()
        self.assertEqual((detail["seriesId"], detail["series"]), (weekly, "研發週會"))

    def test_series_of_another_team(self):
        theirs = self.series("業務週會", team=self.sales, client=self.signed_in("carol")).json()["id"]
        response = self.alice.post("/api/meetings", json={"team_id": self.rd, "language": "zh", "series_id": theirs})
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "系列不屬於這個團隊"))
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])
        meeting = self.meeting()
        response = self.alice.patch(f"/api/meetings/{meeting}", json={"series_id": theirs})
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "系列不屬於這個團隊"))
        self.assertEqual(self.query("SELECT series_id FROM meetings"), [(None,)])

    def test_clearing_and_changing_the_series(self):
        weekly = self.series("研發週會").json()["id"]
        meeting = self.meeting(weekly)
        self.alice.patch(f"/api/meetings/{meeting}", json={"title": "Q4 規劃"})
        self.assertEqual(self.query("SELECT title, series_id FROM meetings"), [("Q4 規劃", weekly)])
        response = self.signed_in("bob").patch(f"/api/meetings/{meeting}", json={"series_id": None})
        self.assertEqual(response.json(), {"id": meeting, "title": "Q4 規劃", "seriesId": None, "series": None})
        self.assertEqual(self.query("SELECT title, series_id FROM meetings"), [("Q4 規劃", None)])

    # --- Unfinished actions ---
    def test_unfinished_actions_before_the_meeting(self):
        # spec example "series 研發週會 before the 11/13 meeting"
        weekly, sales_weekly = self.series("研發週會").json()["id"], self.series("業務週會").json()["id"]
        m1030, m1106, today = self.meeting(weekly), self.meeting(weekly), self.meeting(weekly)
        other = self.meeting(sales_weekly)
        self.item(m1106, "部署腳本", status="doing", due=date(2026, 11, 30))
        self.item(m1106, "寄合約", due=date(2026, 11, 10))
        self.item(m1030, "報價單", status="done", due=date(2026, 11, 1))
        self.item(m1106, "晶片延遲", kind="risk")
        self.item(m1106, "確認預算", state="proposed")
        self.item(other, "客戶拜訪")
        self.item(today, "本場的待辦")
        listed = self.alice.get(f"/api/series/{weekly}/actions?exclude={today}").json()
        self.assertEqual([(i["content"], i["overdueDays"]) for i in listed], [("寄合約", 3), ("部署腳本", 0)])
        self.assertEqual(listed[0]["meetingId"], m1106)
        self.assertEqual(self.signed_in("carol").get(f"/api/series/{weekly}/actions").status_code, 404)

    # --- Progress detection ---
    def detection(self, statuses=("todo", "doing")):
        """Series meeting 11/06 with items #a (todo) and #b (doing); today's meeting has segments 1..35."""
        weekly = self.series("研發週會").json()["id"]
        earlier, self.today = self.meeting(weekly), self.meeting(weekly)
        ids = [self.item(earlier, content, status=status) for content, status in zip(("寄合約", "部署腳本"), statuses)]
        self.save(self.alice, self.today, [(f"第{i}句", f"S{i}") for i in range(1, 36)])
        return ids

    def check(self, answer, after=30, client=None):
        calls = []

        async def model(messages, timeout=None):
            calls.append(messages)
            if isinstance(answer, Exception):
                raise answer
            return json.dumps(answer, ensure_ascii=False)
        with patch("minutes.call_model", model):
            response = (client or self.alice).post(f"/api/meetings/{self.today}/progress/check", json={"after": after})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), calls

    def test_validating_the_model_answer(self):
        # spec example "unfinished items #11 (todo) and #12 (doing); this check sent segments 31–35"
        a, b = self.detection()
        result, calls = self.check({"updates": [
            {"item": a, "status": "done", "note": "合約已寄出", "evidence": [33]},
            {"item": b, "status": "doing", "evidence": [34]},
            {"item": 99999, "status": "done", "evidence": [33]},
            {"item": a, "status": "doing", "evidence": [12]},
            {"item": b, "status": "cancelled", "note": "", "evidence": [35]}]})
        self.assertEqual([(s["itemId"], s["toStatus"], s["note"], [e["seq"] for e in s["evidence"]]) for s in result["suggestions"]],
                         [(a, "done", "合約已寄出", [33])])
        self.assertEqual(result["suggestions"][0]["evidence"][0]["source"], "第33句")
        self.assertEqual(result["checkedThrough"], 35)
        prompt = calls[0][1]["content"]
        self.assertIn(f"[#{a}] 寄合約", prompt)
        self.assertIn("[29] 第29句", prompt)          # context
        self.assertIn("[35] 第35句", prompt)
        self.assertNotIn("[28] 第28句", prompt)
        later, _ = self.check({"updates": [{"item": a, "status": "done", "note": "又說一次", "evidence": [34]}]})
        self.assertEqual(len(later["suggestions"]), 1)
        self.assertEqual(self.query("SELECT count(*) FROM progress_suggestions"), [(1,)])

    def test_nothing_to_check(self):
        self.today = self.meeting()                       # no series
        self.save(self.alice, self.today, [("第1句", "S1")])
        result, calls = self.check({"updates": []}, after=0)
        self.assertEqual((calls, result["suggestions"]), ([], []))
        self.detection(statuses=("done", "cancelled"))   # a series without unfinished items
        _, calls = self.check({"updates": []})
        self.assertEqual(calls, [])
        self.detection()                                 # unfinished items, but no segment after 35
        _, calls = self.check({"updates": []}, after=35)
        self.assertEqual(calls, [])

    def test_model_failure_keeps_the_segments(self):
        self.detection()
        result, _ = self.check(TimeoutError("slow"))
        self.assertEqual((result["checkedThrough"], result["suggestions"], result["error"]), (30, [], "進度偵測暫時失敗，稍後重試"))
        _, calls = self.check({"updates": []}, after=result["checkedThrough"])
        self.assertIn("[31] 第31句", calls[0][1]["content"])

    def test_model_not_configured(self):
        self.detection()
        with patch("minutes.MINUTES_URL", ""):
            response = self.alice.post(f"/api/meetings/{self.today}/progress/check", json={"after": 0})
        self.assertEqual((response.status_code, response.json()["detail"]), (400, "紀要功能尚未設定"))

    def suggest(self, item, status="done", note="合約已寄出", evidence=(33,)):
        result, _ = self.check({"updates": [{"item": item, "status": status, "note": note, "evidence": list(evidence)}]})
        return next(s["id"] for s in result["suggestions"] if s["itemId"] == item and s["toStatus"] == status)

    def test_applying_during_the_meeting(self):
        a, _ = self.detection()
        sid = self.suggest(a)
        response = self.alice.post(f"/api/meetings/{self.today}/progress/{sid}/accept")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["suggestion"]["state"], response.json()["item"]["status"]), ("accepted", "done"))
        self.assertEqual(self.query("SELECT status, status_note FROM minute_items WHERE id = %s", (a,)), [("done", "合約已寄出")])
        earlier = self.query("SELECT meeting_id FROM minute_items WHERE id = %s", (a,))[0][0]
        history = self.alice.get(f"/api/meetings/{earlier}/minutes/items/{a}/updates").json()
        self.assertEqual([(h["from"], h["to"], h["note"], h["by"], h["meetingId"], h["evidence"]) for h in history],
                         [("todo", "done", "合約已寄出", "王愛麗", self.today, [33])])

    def test_applying_when_the_item_already_has_that_status(self):
        a, _ = self.detection()
        sid = self.suggest(a)
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE minute_items SET status = 'done' WHERE id = %s", (a,))
        response = self.alice.post(f"/api/meetings/{self.today}/progress/{sid}/accept")
        self.assertEqual((response.status_code, response.json()["suggestion"]["state"]), (200, "accepted"))
        self.assertEqual(self.query("SELECT count(*) FROM item_updates"), [(0,)])

    def test_applying_dismisses_out_of_date_suggestions(self):
        a, _ = self.detection()
        doing = self.suggest(a, status="doing", note="開始寄了", evidence=(32,))
        done = self.suggest(a, status="done", note="合約已寄出", evidence=(34,))
        pending = {s["id"]: s["fromStatus"] for s in self.alice.get(f"/api/meetings/{self.today}/progress").json()}
        self.assertEqual(pending, {doing: "todo", done: "todo"})
        self.assertEqual(self.alice.post(f"/api/meetings/{self.today}/progress/{done}/accept").status_code, 200)
        states = {s["id"]: s["state"] for s in self.alice.get(f"/api/meetings/{self.today}/progress").json()}
        self.assertEqual(states, {doing: "dismissed", done: "accepted"})
        response = self.alice.post(f"/api/meetings/{self.today}/progress/{doing}/accept")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "這則提示已處理"))
        self.assertEqual(self.query("SELECT status FROM minute_items WHERE id = %s", (a,)), [("done",)])

    def test_handled_twice_and_dismissed_not_suggested_again(self):
        a, _ = self.detection()
        sid = self.suggest(a)
        self.assertEqual(self.alice.post(f"/api/meetings/{self.today}/progress/{sid}/dismiss").json()["suggestion"]["state"], "dismissed")
        response = self.signed_in("bob").post(f"/api/meetings/{self.today}/progress/{sid}/accept")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "這則提示已處理"))
        self.assertEqual(self.query("SELECT status FROM minute_items WHERE id = %s", (a,)), [("todo",)])
        again, _ = self.check({"updates": [{"item": a, "status": "done", "note": "再說一次", "evidence": [34]}]})
        self.assertEqual(again["suggestions"], [])
        listed = self.alice.get(f"/api/meetings/{self.today}/progress").json()
        self.assertEqual([(s["id"], s["state"]) for s in listed], [(sid, "dismissed")])

    def test_item_no_longer_confirmed(self):
        a, _ = self.detection()
        sid = self.suggest(a)
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE minute_items SET state = 'rejected' WHERE id = %s", (a,))
        response = self.alice.post(f"/api/meetings/{self.today}/progress/{sid}/accept")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "只有已確認的待辦可以更新狀態"))
        self.assertEqual(self.query("SELECT state FROM progress_suggestions"), [("pending",)])

    def test_another_team_cannot_check_or_decide(self):
        a, _ = self.detection()
        sid = self.suggest(a)
        carol = self.signed_in("carol")
        self.assertEqual(carol.post(f"/api/meetings/{self.today}/progress/check", json={"after": 0}).status_code, 404)
        self.assertEqual(carol.get(f"/api/meetings/{self.today}/progress").status_code, 404)
        self.assertEqual(carol.post(f"/api/meetings/{self.today}/progress/{sid}/accept").status_code, 404)
        self.assertEqual(self.query("SELECT state FROM progress_suggestions"), [("pending",)])


class BoardItemTests(ReviewTestCase):
    """board-created-actions: alice and bob in 研發部, carol in 業務部; today is 2026-11-13 (Asia/Taipei)."""
    TODAY = SeriesTests.TODAY

    def setUp(self):
        ReviewTestCase.setUp(self)
        self.ldap.add("carol", "pw-carol")
        self.rd, self.sales = self.team("研發部", "alice", "bob"), self.team("業務部", "carol")
        self.alice = self.signed_in("alice")
        for name, value in (("minutes.MINUTES_URL", "http://model"), ("minutes.MINUTES_MODEL", "m"),
                            ("minutes.local_today", lambda: self.TODAY)):
            p = patch(name, value)
            p.start()
            self.addCleanup(p.stop)

    series, meeting, item = SeriesTests.series, SeriesTests.meeting, SeriesTests.item
    detection, check, suggest = SeriesTests.detection, SeriesTests.check, SeriesTests.suggest

    def create(self, client=None, **body):
        return (client or self.alice).post("/api/actions", json={"teamId": self.rd, "content": "寄報價單給客戶", **body})

    def test_creating_on_the_board(self):
        # spec example "Validation"
        response = self.create(owner="bob", dueDate="2026-11-20")
        self.assertEqual(response.status_code, 201, response.text)
        item = response.json()
        self.assertEqual((item["content"], item["status"], item["owner"], item["dueDate"], item["meetingId"], item["origin"], item["team"]),
                         ("寄報價單給客戶", "todo", "bob", "2026-11-20", None, "manual", "研發部"))
        self.assertEqual(self.query("SELECT state, meeting_id, confirmed_by FROM minute_items WHERE id = %s", (item["id"],)),
                         [("confirmed", None, "alice")])
        board = self.signed_in("bob").get("/api/actions").json()["items"]
        self.assertEqual([i["id"] for i in board], [item["id"]])
        self.assertEqual(self.create(teamId=self.sales).status_code, 404)
        self.assertEqual(self.create(owner="carol").status_code, 422)
        other = self.series("業務週會", team=self.sales, client=self.signed_in("carol")).json()["id"]
        self.assertEqual(self.create(seriesId=other).status_code, 422)
        self.assertEqual(self.create(content="   ").status_code, 422)
        self.assertEqual(self.query("SELECT count(*) FROM minute_items"), [(1,)])
        self.assertEqual(self.signed_in("carol").get("/api/actions").json()["items"], [])

    def test_changing_any_action_by_id(self):
        board = self.create().json()
        meeting = self.meeting()
        from_meeting = self.item(meeting, "寄合約")
        for item_id in (board["id"], from_meeting):
            version = self.query("SELECT version FROM minute_items WHERE id = %s", (item_id,))[0][0]
            changed = self.alice.patch(f"/api/actions/{item_id}", json={"version": version, "content": "改過的內容", "owner": "bob"})
            self.assertEqual((changed.status_code, changed.json()["content"], changed.json()["owner"]), (200, "改過的內容", "bob"), changed.text)
            self.assertEqual(changed.json()["version"], version + 1)
            stale = self.alice.patch(f"/api/actions/{item_id}", json={"version": version, "content": "舊版本"})
            self.assertEqual((stale.status_code, stale.json()["item"]["content"]), (409, "改過的內容"))
            status = self.alice.post(f"/api/actions/{item_id}/status", json={"version": changed.json()["version"], "status": "cancelled", "note": ""})
            self.assertEqual(status.status_code, 422)
            status = self.alice.post(f"/api/actions/{item_id}/status", json={"version": changed.json()["version"], "status": "doing", "note": ""})
            self.assertEqual((status.status_code, status.json()["status"]), (200, "doing"))
            history = self.alice.get(f"/api/actions/{item_id}/updates").json()
            self.assertEqual([(h["from"], h["to"]) for h in history], [("todo", "doing")])
            carol = self.signed_in("carol")
            self.assertEqual(carol.get(f"/api/actions/{item_id}/updates").status_code, 404)
            self.assertEqual(carol.post(f"/api/actions/{item_id}/status", json={"version": 1, "status": "done", "note": ""}).status_code, 404)

    def test_deleting_only_board_items(self):
        board = self.create().json()
        self.alice.post(f"/api/actions/{board['id']}/status", json={"version": board["version"], "status": "doing", "note": ""})
        from_meeting = self.item(self.meeting(), "寄合約")
        self.assertEqual(self.signed_in("carol").delete(f"/api/actions/{board['id']}").status_code, 404)
        refused = self.alice.delete(f"/api/actions/{from_meeting}")
        self.assertEqual((refused.status_code, refused.json()["detail"]), (409, "會議產生的待辦請改用已取消"))
        self.assertEqual(self.signed_in("bob").delete(f"/api/actions/{board['id']}").status_code, 204)
        self.assertEqual(self.query("SELECT count(*) FROM minute_items"), [(1,)])
        self.assertEqual(self.query("SELECT count(*) FROM item_updates"), [(0,)])

    def test_board_item_of_a_series_is_carried_and_detected(self):
        a, _ = self.detection()
        weekly = self.query("SELECT series_id FROM meetings WHERE id = %s", (self.today,))[0][0]
        board = self.create(seriesId=weekly, dueDate="2026-11-10").json()
        self.assertEqual(board["series"], "研發週會")
        listed = self.alice.get(f"/api/series/{weekly}/actions?exclude={self.today}").json()
        self.assertIn(board["id"], [i["id"] for i in listed])
        self.assertEqual(next(i for i in listed if i["id"] == board["id"])["overdueDays"], 3)
        sid = self.suggest(board["id"], note="報價單已寄出")
        pending = next(s for s in self.alice.get(f"/api/meetings/{self.today}/progress").json() if s["id"] == sid)
        self.assertIsNone(pending["itemMeetingId"])
        accepted = self.alice.post(f"/api/meetings/{self.today}/progress/{sid}/accept")
        self.assertEqual((accepted.status_code, accepted.json()["item"]["status"]), (200, "done"), accepted.text)
        history = self.alice.get(f"/api/actions/{board['id']}/updates").json()
        self.assertEqual([(h["to"], h["meetingId"]) for h in history], [("done", self.today)])

    def test_meeting_items_get_their_team(self):
        meeting = self.meeting()
        item = self.item(meeting, "寄合約")
        self.assertEqual(self.query("SELECT team_id FROM minute_items WHERE id = %s", (item,)), [(self.rd,)])
        with self.assertRaises(psycopg.errors.CheckViolation):
            with psycopg.connect(TEST_DATABASE_URL) as conn:
                conn.execute("INSERT INTO minute_items (team_id, kind, content, origin) VALUES (%s, 'decision', 'x', 'ai')", (self.rd,))


class MetricsTests(ReviewTestCase):
    """outcome-metrics: alice and bob in 研發部, carol in 業務部; today is 2026-11-13 (Asia/Taipei)."""
    TODAY = date(2026, 11, 13)

    def setUp(self):
        ReviewTestCase.setUp(self)
        self.ldap.add("carol", "pw-carol")
        self.rd, self.sales = self.team("研發部", "alice", "bob"), self.team("業務部", "carol")
        self.alice = self.signed_in("alice")
        today = patch("minutes.local_today", lambda: self.TODAY)
        today.start()
        self.addCleanup(today.stop)
        self.meeting = self.alice.post("/api/meetings", json={"team_id": self.rd, "language": "zh"}).json()["id"]
        # Inside the fixed period whatever the real date is.
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE meetings SET started_at = '2026-11-10 10:00+08' WHERE id = %s", (self.meeting,))

    def action(self, status="todo", created="2026-11-10", status_on=None, due=None, team=None, origin="manual", state="confirmed"):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute(
                "INSERT INTO minute_items (meeting_id, team_id, kind, content, origin, state, status, due_date, confirmed_at, status_at) "
                "VALUES (%s, %s, 'action', 'x', %s, %s, %s, %s, %s::date + time '12:00' AT TIME ZONE 'Asia/Taipei', "
                "%s::date + time '12:00' AT TIME ZONE 'Asia/Taipei') RETURNING id",
                (self.meeting, team or self.rd, origin, state, status, due, created, status_on)).fetchone()[0]

    def metrics(self, query=""):
        response = self.alice.get(f"/api/metrics{query}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_action_metrics(self):
        # spec example "Action metrics (today 2026-11-13, days 30)"
        self.assertIsNone(self.metrics()["actions"]["completionRate"])
        for _ in range(4):
            self.action("done", status_on="2026-11-11")
        self.action("doing", due="2026-11-12")
        self.action("cancelled")
        self.action("todo", created="2026-09-01", due="2026-11-20")
        self.action("todo", created="2026-09-01", due="2026-11-13")
        self.action("done", created="2026-09-01", status_on="2026-11-10", due="2026-11-10")
        self.action("done", created="2026-09-01", status_on="2026-11-12", due="2026-11-11")
        self.action("todo", team=self.sales)
        a = self.metrics()["actions"]
        self.assertEqual((a["created"], a["done"], a["completionRate"]), (5, 4, 0.8))
        self.assertEqual((a["openWithDue"], a["overdue"], a["overdueRate"]), (3, 1, 0.3333))
        self.assertEqual((a["finishedWithDue"], a["onTime"], a["onTimeRate"]), (2, 1, 0.5))
        self.assertEqual(self.metrics("?days=365")["actions"]["created"], 9)

    def test_weekly_trend(self):
        self.action("done", created="2026-11-09", status_on="2026-11-13")
        self.action("todo", created="2026-11-08")
        self.action("todo", created="2026-08-01")
        weekly = self.metrics()["weekly"]
        self.assertEqual(len(weekly), 12)
        self.assertEqual(weekly[-1], {"week": "2026-11-09", "created": 1, "done": 1})
        self.assertEqual(weekly[-2], {"week": "2026-11-02", "created": 1, "done": 0})
        self.assertEqual(weekly[0]["week"], "2026-08-24")
        self.assertEqual(sum(w["created"] for w in weekly), 2)

    def test_ai_extraction_and_edited_marking(self):
        adopted, edited, rejected = (self.action(origin="ai", state="proposed") for _ in range(3))
        self.action(origin="ai", state="proposed")
        url = f"/api/meetings/{self.meeting}/minutes/items"
        version = lambda i: self.query("SELECT version FROM minute_items WHERE id = %s", (i,))[0][0]  # noqa: E731
        self.alice.patch(f"{url}/{edited}", json={"version": version(edited), "owner": "bob"})
        self.alice.patch(f"{url}/{adopted}", json={"version": version(adopted), "owner": None})   # no real change
        for item in (adopted, edited):
            self.assertEqual(self.alice.post(f"{url}/{item}/confirm", json={"version": version(item)}).status_code, 200)
        self.alice.post(f"{url}/{rejected}/reject", json={"version": version(rejected)})
        self.alice.post(f"/api/actions/{adopted}/status", json={"version": version(adopted), "status": "doing", "note": ""})
        self.assertEqual(self.query("SELECT id, edited FROM minute_items WHERE id IN (%s, %s) ORDER BY id", (adopted, edited)),
                         [(adopted, False), (edited, True)])
        self.assertEqual(self.metrics()["ai"], {"adopted": 1, "edited": 1, "rejected": 1, "pending": 1})
        # On the board: an unchanged content does not mark it; a new due date does.
        content = self.query("SELECT content FROM minute_items WHERE id = %s", (adopted,))[0][0]
        self.alice.patch(f"/api/actions/{adopted}", json={"version": version(adopted), "content": content})
        self.assertEqual(self.query("SELECT edited FROM minute_items WHERE id = %s", (adopted,)), [(False,)])
        self.alice.patch(f"/api/actions/{adopted}", json={"version": version(adopted), "dueDate": "2026-11-30"})
        self.assertEqual(self.query("SELECT edited FROM minute_items WHERE id = %s", (adopted,)), [(True,)])

    def test_transcript_correction(self):
        # spec example "Transcript correction"
        self.save(self.alice, self.meeting, [("今天開會", "S1"), ("迷你max很好", "S2")])
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE segments SET source = 'MiniMax很好' WHERE meeting_id = %s AND seq = 2", (self.meeting,))
        engine = self.query("SELECT engine FROM meetings WHERE id = %s", (self.meeting,))[0][0]
        self.assertEqual(self.metrics()["transcript"], [{"engine": engine, "language": "zh", "meetings": 1, "segments": 2, "editedSegments": 1,
                                                         "chars": 11, "editedChars": 5, "per100": 45.5}])

    def test_minutes_lag(self):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE meetings SET ended_at = '2026-11-10 10:00+08' WHERE id = %s", (self.meeting,))
            conn.execute("INSERT INTO minute_items (meeting_id, kind, content, origin, state, confirmed_at) VALUES "
                         "(%s, 'decision', 'a', 'ai', 'confirmed', '2026-11-10 13:00+08'), (%s, 'decision', 'b', 'ai', 'confirmed', '2026-11-11 10:00+08')",
                         (self.meeting, self.meeting))
        self.assertEqual(self.metrics()["minutesLag"], {"meetings": 1, "medianHours": 3.0})

    def test_scope_and_validation(self):
        self.assertEqual(self.alice.get(f"/api/metrics?team={self.sales}").status_code, 404)
        self.assertEqual(self.alice.get("/api/metrics?days=7").status_code, 422)
        result = self.metrics(f"?team={self.rd}&days=90")
        self.assertEqual((result["days"], result["from"], result["to"]), (90, "2026-08-16", "2026-11-13"))
        self.assertEqual([t["name"] for t in result["teams"]], ["研發部"])
        self.assertIsNotNone(result["editedSince"])
        self.assertEqual(TestClient(app).get("/api/metrics").status_code, 401)


class SearchTests(ReviewTestCase):
    """meeting-search: alice and bob in 研發部, carol in 業務部."""

    def setUp(self):
        ReviewTestCase.setUp(self)
        self.ldap.add("carol", "pw-carol")
        self.rd, self.sales = self.team("研發部", "alice", "bob"), self.team("業務部", "carol")
        self.alice, self.carol = self.signed_in("alice"), self.signed_in("carol")
        self.weekly = self.alice.post(f"/api/teams/{self.rd}/series", json={"name": "研發週會"}).json()["id"]

    def meeting(self, title="", day="2026-11-05", team=None, client=None, series=None):
        body = {"team_id": team or self.rd, "language": "zh", **({"series_id": series} if series else {})}
        meeting = (client or self.alice).post("/api/meetings", json=body).json()["id"]
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE meetings SET title = %s, started_at = %s::date + time '10:00' AT TIME ZONE 'Asia/Taipei' WHERE id = %s",
                         (title, day, meeting))
        return meeting

    def segments(self, meeting, *pairs):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            for n, (source, target) in enumerate(pairs, 1):
                conn.execute("INSERT INTO segments (meeting_id, seq, start_ms, end_ms, asr_text, source, live_target, target) "
                             "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", (meeting, n, n * 1000, n * 1000 + 900, source, source, target, target))

    def item(self, meeting, content, state="confirmed", kind="action"):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute("INSERT INTO minute_items (meeting_id, kind, content, origin, state) VALUES (%s, %s, %s, 'ai', %s) RETURNING id",
                                (meeting, kind, content, state)).fetchone()[0]

    def search(self, query, client=None, status=200):
        response = (client or self.alice).get(f"/api/search?{query}")
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def hits(self, result):
        return [(g["meetingId"], h["type"], h.get("seq") or h.get("id")) for g in result["groups"] for h in g["hits"]]

    def test_matching(self):
        # spec example "Matching"
        m = self.meeting("報價單討論")
        self.segments(m, ("合約下週五前寄給客戶", "send the contract by next Friday"), ("合約已寄出", "sent to the client"),
                      ("我們用迷你max", "MiniMax launch"))
        discount, plain = self.item(m, "折扣 100%"), self.item(m, "數量 1000")
        self.item(m, "報價單", state="rejected")
        self.assertEqual(self.hits(self.search("q=合約 客戶")), [(m, "segment", 1)])
        self.assertEqual(self.hits(self.search("q=合約 client")), [])
        self.assertEqual(self.hits(self.search("q=minimax")), [(m, "segment", 3)])
        self.assertEqual(self.hits(self.search("q=100%25")), [(m, "item", discount)])
        self.assertNotIn(plain, [h[2] for h in self.hits(self.search("q=100%25"))])
        self.assertEqual(self.hits(self.search("q=報價單")), [(m, "title", None)])
        self.assertEqual(self.search("q=%20%20", status=422)["detail"], "請輸入要搜尋的字")
        self.search("q=" + "字" * 100 + "%20")                              # 100 after trimming
        self.assertEqual(self.search("q=" + "字" * 101, status=422)["detail"], "搜尋字最多 100 個字")
        # At most 5 terms: more are rejected with the count, never cut to the first 5 (spec example "Matching").
        self.search("q=a b c d e")                                         # 5 terms are searched
        self.assertEqual(self.hits(self.search("q=合約 下週五 寄給 客戶 前")), [(m, "segment", 1)])
        self.assertEqual(self.search("q=合約 下週五 寄給 客戶 前 不存在", status=422)["detail"],
                         "搜尋詞最多 5 個（目前 6 個），請刪減後再搜尋")
        self.assertEqual(self.hits(self.search("q=合約　客戶")), [(m, "segment", 1)])   # a full-width space separates terms
        self.assertEqual(self.search("q=a　b c d e f", status=422)["detail"], "搜尋詞最多 5 個（目前 6 個），請刪減後再搜尋")
        self.search("q=x&kind=people", status=422)

    def test_grouping_newest_first_and_board_items(self):
        old, new = self.meeting("週會", "2026-11-01"), self.meeting("週會", "2026-11-06")
        self.segments(old, ("交貨時間確認", "delivery"))
        self.segments(new, ("交貨改成分批", "split delivery"), ("交貨日期", "date"))
        decided = self.item(new, "交貨方式改為分批", kind="decision")
        board = self.alice.post("/api/actions", json={"teamId": self.rd, "content": "確認交貨倉庫"}).json()["id"]
        result = self.search("q=交貨")
        self.assertEqual([g["meetingId"] for g in result["groups"]][:2], [None, new])   # the board item was created today
        self.assertEqual(self.hits(result)[1:], [(new, "segment", 1), (new, "segment", 2), (new, "item", decided), (old, "segment", 1)])
        self.assertEqual(result["groups"][0]["hits"], [{"type": "item", "id": board, "kind": "action", "content": "確認交貨倉庫",
                                                         "state": "confirmed", "status": "todo"}])
        self.assertEqual((result["groups"][1]["title"], result["groups"][1]["team"]), ("週會", "研發部"))

    def test_other_teams_stay_invisible(self):
        theirs = self.meeting("業務會議", team=self.sales, client=self.carol)
        self.segments(theirs, ("機密報價", "secret quote"))
        self.assertEqual(self.search("q=機密")["groups"], [])
        self.search(f"q=機密&team={self.sales}", status=404)
        their_series = self.carol.post(f"/api/teams/{self.sales}/series", json={"name": "業務週會"}).json()["id"]
        self.search(f"q=機密&series={their_series}", status=404)
        self.assertEqual(len(self.search("q=機密", client=self.carol)["groups"]), 1)

    def test_filters(self):
        inside = self.meeting("A", "2026-11-03", series=self.weekly)
        other_series = self.meeting("B", "2026-11-03")
        too_early = self.meeting("C", "2026-10-20", series=self.weekly)
        for m in (inside, other_series, too_early):
            self.segments(m, ("預算簽核", "budget"))
            self.item(m, "預算簽核流程")
        board = self.alice.post("/api/actions", json={"teamId": self.rd, "content": "預算表", "seriesId": self.weekly}).json()["id"]
        result = self.search(f"q=預算&team={self.rd}&series={self.weekly}&from=2026-11-01&to=2026-11-05&kind=items")
        self.assertEqual({(g["meetingId"], h["type"]) for g in result["groups"] for h in g["hits"]}, {(inside, "item")})
        # A board item is dated by its creation: inside the range it is listed.
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE minute_items SET confirmed_at = '2026-11-03 09:00+08' WHERE id = %s", (board,))
        result = self.search(f"q=預算&team={self.rd}&series={self.weekly}&from=2026-11-01&to=2026-11-05&kind=items")
        self.assertEqual({(g["meetingId"], h.get("id")) for g in result["groups"] for h in g["hits"] if g["meetingId"] is None}, {(None, board)})
        result = self.search(f"q=預算&series={self.weekly}&kind=items")
        self.assertIn(board, [h[2] for h in self.hits(result)])
        self.assertEqual({h[1] for h in self.hits(self.search(f"q=預算&series={self.weekly}&kind=segments"))}, {"segment"})

    def test_truncated(self):
        m = self.meeting("長會議")
        self.segments(m, *[(f"重複的詞 {n}", "repeat") for n in range(305)])
        result = self.search("q=重複")
        self.assertEqual((result["total"], result["truncated"]), (300, True))

    def test_trigram_indexes_exist(self):
        names = {r[0] for r in self.query("SELECT indexname FROM pg_indexes WHERE indexname LIKE '%%_trgm'")}
        self.assertEqual(names, {"segments_source_trgm", "segments_target_trgm", "minute_items_content_trgm", "meetings_title_trgm"})


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
                              "segments", "segment_history", "minutes", "minute_items", "item_updates", "meeting_series",
                              "progress_suggestions"}, tables)
        with self.assertRaises(psycopg.errors.UniqueViolation), psycopg.connect(TEST_DATABASE_URL) as conn:
            team = conn.execute("INSERT INTO teams (name, name_key) VALUES ('研發部', '研發部') RETURNING id").fetchone()[0]
            for name in ("Sprint Review", "sprint review"):
                conn.execute("INSERT INTO meeting_series (team_id, name, name_key, created_by) VALUES (%s, %s, %s, 'alice')",
                             (team, name, name.casefold()))
        columns = {row[0] for row in self.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'meetings'")}
        self.assertLessEqual({"source_language", "target_language", "glossary", "learned_terms", "audio_bytes", "ended_at", "title", "series_id"}, columns)


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
        self.assertEqual(asyncio.run(migrate(db.migration_files()))[0], 5)
        self.assertEqual(self.query("SELECT status, status_note FROM minute_items"), [("todo", "")])
        # board-created-actions: existing items get their meeting's team.
        self.assertEqual(self.query("SELECT team_id, series_id FROM minute_items"), [(team, None)])
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

    # stream-limits: failed sign-ins from one address
    def from_address(self, address, username, password):
        return TestClient(app, client=(address, 50000)).post("/api/login", json={"username": username, "password": password})

    def test_one_address_example(self):
        rows = [(29, None, False), (30, None, True), (30, 6 * 60, False)]   # failures, age of the oldest, blocked (spec example)
        for failures, oldest_age, blocked in rows:
            with self.subTest(failures=failures, oldest_age=oldest_age):
                auth.ip_failures.clear()
                now = 10_000.0
                for i in range(failures):
                    auth.record_ip_failure("10.0.0.9", now - (oldest_age if i == 0 and oldest_age else 1))
                self.assertIs(auth.ip_blocked("10.0.0.9", now), blocked)
        auth.ip_failures.clear()

    def test_guessing_many_usernames_from_one_address(self):
        self.addCleanup(auth.ip_failures.clear)
        with patch("auth.LOGIN_IP_MAX_FAILURES", 3):
            for name in ("u1", "u2", "u3"):
                self.assertEqual(self.from_address("10.0.0.7", name, "x").status_code, 401)
            binds = self.ldap.binds
            response = self.from_address("10.0.0.7", "alice", "pw-alice")
            self.assertEqual((response.status_code, response.json()["detail"]), (429, "嘗試次數過多，請稍後再試"))
            self.assertEqual(self.ldap.binds, binds)                                       # LDAP not contacted
            self.assertEqual(self.from_address("10.0.0.8", "alice", "pw-alice").status_code, 200)   # another address
            auth.ip_failures.clear()
            self.assertEqual(self.from_address("10.0.0.7", "u1", "x").status_code, 401)
            self.assertEqual(self.from_address("10.0.0.7", "alice", "pw-alice").status_code, 200)
            self.assertEqual(len(auth.ip_failures["10.0.0.7"]), 1)                         # success does not clear it
            self.ldap.unreachable = True
            for _ in range(3):
                self.assertEqual(self.from_address("10.0.0.6", "alice", "pw-alice").status_code, 503)
            self.assertNotIn("10.0.0.6", auth.ip_failures)                                  # LDAP down does not count

    def test_starttls_runs_before_every_bind(self):
        with patch("auth.LDAP_TLS", "starttls"):
            self.assertEqual(self.login("alice", "pw-alice").status_code, 200)
        self.assertEqual((self.ldap.starttls_calls, self.ldap.binds), (2, 2))  # service account, then alice

    def test_starttls_failure_sends_no_bind_and_does_not_count(self):
        self.ldap.starttls_ok = False
        with patch("auth.LDAP_TLS", "starttls"):
            for _ in range(6):
                response = self.login("alice", "pw-alice")
                self.assertEqual((response.status_code, response.json()["detail"]), (503, "無法連線登入伺服器"))
                self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(self.ldap.binds, 0)
        self.assertEqual(self.query("SELECT count FROM login_failures WHERE username = 'alice'"), [(0,)])

    def test_certificate_failure_during_starttls_is_503_and_logged(self):
        self.ldap.starttls_error = ssl.SSLError("CERTIFICATE_VERIFY_FAILED")
        with patch("auth.LDAP_TLS", "starttls"), self.assertLogs("uvicorn.error", "WARNING") as logs:
            response = self.login("alice", "pw-alice")
        self.assertEqual((response.status_code, response.json()["detail"]), (503, "無法連線登入伺服器"))
        self.assertNotIn("CERTIFICATE", response.text)  # the reason is for the log only
        self.assertTrue(any("CERTIFICATE_VERIFY_FAILED" in line for line in logs.output))
        self.assertEqual(self.ldap.binds, 0)

    def test_starttls_without_a_verifying_tls_is_refused(self):
        self.ldap.server.tls = None
        with patch("auth.LDAP_TLS", "starttls"):
            self.assertEqual(self.login("alice", "pw-alice").status_code, 503)
        self.assertEqual((self.ldap.starttls_calls, self.ldap.binds), (0, 0))

    def test_plaintext_setting_binds_without_starttls(self):
        self.assertEqual(self.login("alice", "pw-alice").status_code, 200)  # FakeLdap patches LDAP_TLS=none
        self.assertEqual(self.ldap.starttls_calls, 0)

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



class ResponseHeaderTests(AccountTestCase):
    """response-headers: security headers on every response, HSTS on https, cache lifetime on versioned assets."""

    SECURITY = {"x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "same-origin"}

    def assert_security(self, response):
        self.assertEqual({name: response.headers.get(name) for name in self.SECURITY}, self.SECURITY)

    def test_security_headers_on_pages_refusals_redirects_and_unknown_paths(self):
        signed_out = TestClient(app)
        login = signed_out.get("/login")
        self.assertEqual(login.status_code, 200)
        self.assert_security(login)
        refused = signed_out.get("/api/metrics")
        self.assertEqual(refused.status_code, 401)
        self.assert_security(refused)
        redirect = signed_out.get("/", follow_redirects=False)
        self.assertEqual(redirect.status_code, 303)
        self.assert_security(redirect)
        missing = self.signed_in("alice").get("/no-such-page")
        self.assertEqual(missing.status_code, 404)
        self.assert_security(missing)

    def test_strict_transport_security_only_on_https(self):
        secure = TestClient(app, base_url="https://testserver").get("/login")
        self.assertEqual(secure.headers.get("strict-transport-security"), "max-age=31536000")
        self.assert_security(secure)
        self.assertNotIn("strict-transport-security", TestClient(app).get("/login").headers)

    def test_versioned_assets_get_a_cache_lifetime(self):
        client = self.signed_in("alice")
        cached = client.get("/assets/app.js?v=20261113a")
        self.assertEqual((cached.status_code, cached.headers.get("cache-control")), (200, "public, max-age=2592000"))
        self.assert_security(cached)
        for path, status in (("/assets/app.js", 200), ("/assets/app.js?v=", 200), ("/assets/missing.js?v=1", 404)):
            response = client.get(path)
            self.assertEqual(response.status_code, status, path)
            self.assertNotEqual(response.headers.get("cache-control"), "public, max-age=2592000", path)
        page = client.get("/login")   # a route's own header is kept
        self.assertEqual((page.status_code, page.headers.get("cache-control")), (200, "no-cache"))

    def test_an_unhandled_error_still_carries_the_headers(self):
        with patch("auth.session_user", side_effect=RuntimeError("boom")):
            failed = TestClient(app, raise_server_exceptions=False).get("/api/me")
            secure = TestClient(app, base_url="https://testserver", raise_server_exceptions=False).get("/api/me")
        self.assertEqual((failed.status_code, failed.text), (500, "Internal Server Error"))
        self.assert_security(failed)
        self.assertNotIn("strict-transport-security", failed.headers)
        self.assertEqual(secure.headers.get("strict-transport-security"), "max-age=31536000")


class NotFoundPageTests(AccountTestCase):
    """not-found-page: a page request that ends in 404 gets a page; everything else keeps the JSON."""

    HTML = {"accept": "text/html,application/xhtml+xml"}

    def assert_page(self, response):
        self.assertEqual((response.status_code, response.headers["content-type"].split(";")[0]), (404, "text/html"))
        for text in ("找不到這個頁面", 'href="/"', 'href="/meetings"', "返回上一頁", "請團隊管理員確認你在該團隊中", "history.back()", "!=='/login'"):
            self.assertIn(text, response.text)
        self.assertNotIn("account.js", response.text)   # no sign-in needed, no API called

    def assert_json(self, response):
        self.assertEqual((response.status_code, response.json()), (404, {"detail": "Not Found"}))

    def test_unknown_page_is_the_same_for_everyone(self):
        self.assert_page(TestClient(app).get("/no-such-page", headers=self.HTML))
        self.assert_page(self.signed_in("alice").get("/no-such-page", headers=self.HTML))

    def test_a_range_request_is_still_a_404(self):
        self.assert_page(TestClient(app).get("/no-such-page", headers={**self.HTML, "range": "bytes=0-99"}))

    def test_a_meeting_that_does_not_exist(self):
        response = self.signed_in("alice").get("/meetings/00000000-0000-0000-0000-000000000000", headers={"accept": "text/html"})
        self.assert_page(response)

    def test_api_clients_and_other_requests_keep_the_json(self):
        client = self.signed_in("alice")
        self.assert_json(client.get("/no-such-page", headers={"accept": "application/json"}))
        self.assert_json(client.get("/api/no-such-route", headers=self.HTML))
        self.assert_json(client.post("/no-such-page", headers=self.HTML))
        asset = client.get("/assets/missing.js", headers=self.HTML)
        self.assertEqual(asset.status_code, 404)
        self.assertNotIn("找不到這個頁面", asset.text)


def tone(seconds, level=8000):
    """Speech stand-in: a 440 Hz tone as 16 kHz PCM16."""
    return struct.pack(f"<{int(seconds * 16000)}h", *(int(level * math.sin(2 * math.pi * 440 * n / 16000)) for n in range(int(seconds * 16000))))


def silence(seconds):
    return bytes(int(seconds * 16000) * 2)


class QualityChunkerTest(unittest.TestCase):
    """quality-pass: "Audio is cut into chunks at pauses"."""

    def test_pause_after_seven_seconds(self):
        chunks = quality_pass.Chunker().feed(tone(7) + silence(0.5) + tone(2))
        self.assertEqual(len(chunks), 1)
        self.assertTrue(7000 < chunks[0].end_ms < 7500, chunks[0].end_ms)   # inside the silence
        self.assertEqual((chunks[0].start_ms, chunks[0].pause), (0, "short"))
        self.assertEqual(len(chunks[0].pcm), chunks[0].end_ms * 32)
        self.assertAlmostEqual(chunks[0].speech, 7.0, delta=0.1)

    def test_a_pause_of_a_second_becomes_long(self):
        chunker = quality_pass.Chunker()
        first = chunker.feed(tone(7) + silence(0.5))[0]
        self.assertEqual(first.pause, "short")
        chunker.feed(silence(1.0))            # the silence went on: read later, the pause is long
        self.assertEqual(first.pause, "long")
        other = quality_pass.Chunker()
        short = other.feed(tone(7) + silence(0.5))[0]
        other.feed(tone(1) + silence(2))      # speech resumed first: it stays short
        self.assertEqual(short.pause, "short")

    def test_no_pause_for_eighteen_seconds(self):
        chunks = quality_pass.Chunker().feed(tone(19))
        self.assertEqual(len(chunks), 1)
        self.assertTrue(12000 <= chunks[0].end_ms <= 18000, chunks[0].end_ms)
        self.assertEqual(chunks[0].pause, "none")

    def test_the_forced_cut_takes_the_quietest_place(self):
        chunks = quality_pass.Chunker().feed(tone(15) + tone(0.2, 900) + tone(4))   # a dip, not a pause
        self.assertTrue(15000 <= chunks[0].end_ms <= 15200, chunks[0].end_ms)

    def test_a_short_utterance_then_silence_is_cut_at_the_pause(self):
        chunker = quality_pass.Chunker()
        chunks = chunker.feed(tone(3) + silence(8))
        self.assertTrue(3000 < chunks[0].end_ms < 3400, chunks[0].end_ms)   # in the silence right after the speech
        self.assertEqual(chunks[0].pause, "long")
        self.assertAlmostEqual(chunks[0].speech, 3.0, delta=0.1)

    def test_silence_only_is_not_speech(self):
        chunker = quality_pass.Chunker()
        chunks = chunker.feed(silence(11)) + [chunker.flush()]
        self.assertTrue(chunks)
        self.assertTrue(all(chunk.speech < 0.3 for chunk in chunks))

    def test_chunks_are_consecutive_and_the_rest_is_flushed(self):
        chunker = quality_pass.Chunker()
        audio = tone(6) + silence(0.6) + tone(6) + silence(0.6) + tone(3)
        chunks = [c for start in range(0, len(audio), 4096) for c in chunker.feed(audio[start:start + 4096])]
        last = chunker.flush()
        self.assertEqual((last.last, last.pause), (True, "long"))
        chunks.append(last)
        self.assertEqual(len(chunks), 3)
        self.assertEqual([c.start_ms for c in chunks[1:]], [c.end_ms for c in chunks[:-1]])
        self.assertEqual(b"".join(c.pcm for c in chunks), audio[:len(audio) - len(audio) % 640])


class QualityAllocateTest(unittest.TestCase):
    """quality-pass: "Sentences carry an estimated time span" (the example table)."""

    def test_example_rows(self):
        self.assertEqual(quality_pass.allocate(10000, 20000, ["a" * 30, "b" * 50], "c" * 20), ([(10000, 13000), (13000, 18000)], 18000))
        self.assertEqual(quality_pass.allocate(0, 6000, ["a" * 60], ""), ([(0, 6000)], 6000))
        self.assertEqual(quality_pass.allocate(4000, 9000, [], "c" * 40), ([], 4000))


class FakeQualityService:
    """The external recognizer and text model as an httpx transport; records every request."""

    def __init__(self, heard, answers, takes_prompt=True):
        self.heard, self.answers = list(heard), list(answers)   # an answer: dict, str (raw content) or int (HTTP status)
        self.transcriptions, self.chats, self.takes_prompt = [], [], takes_prompt

    def __call__(self, request):
        if request.url.path.endswith("/audio/transcriptions"):
            self.transcriptions.append(request.content)
            if not self.takes_prompt and b'name="prompt"' in request.content:
                return httpx.Response(400, json={"error": "prompt is not supported"})
            return httpx.Response(200, json={"text": self.heard.pop(0) if self.heard else ""})
        self.chats.append(json.loads(request.content))
        answer = self.answers.pop(0) if self.answers else {"sentences": [], "carry": ""}
        if answer == "TIMEOUT":
            raise httpx.ReadTimeout("timed out", request=request)
        if isinstance(answer, int):
            return httpx.Response(answer, json={"error": "no credit"})
        content = answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    def user(self, index):
        return self.chats[index]["messages"][1]["content"]


class QualityPassTest(unittest.TestCase):
    """quality-pass: corrected sentences per chunk, failures keep the live result, logs carry no text."""

    def run_pass(self, service, audio, language="zh", target="en", glossary="", before_finish=None):
        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"):
                quality = quality_pass.QualityPass(send, language, target, glossary, lambda text: text.replace("简", "簡"))
                if before_finish:
                    before_finish(quality)
                for start in range(0, len(audio), 6400):
                    quality.feed(audio[start:start + 6400])
                    await quality.idle.wait()   # as in a meeting: results keep up with the audio
                await quality.finish()
            return events
        return asyncio.run(go())

    def test_a_short_pause_carries_the_sentence_and_the_last_chunk_emits_it(self):
        service = FakeQualityService(["我們下週要上線", "新的系統。"],
                                     [{"sentences": [{"src": "我們下週要上線。", "tgt": "We go live next week."}], "carry": ""},
                                      {"sentences": [{"src": "我們下週要上線新的系統。", "tgt": "We launch the new system next week."}], "carry": "ignored"}])
        events = self.run_pass(service, tone(7) + silence(0.5) + tone(2), glossary="語橋")
        first, last = (event["quality"] for event in events)
        self.assertEqual((first["seq"], first["sentences"], first["final"]), (1, [], False))   # whole text carried, nothing emitted
        self.assertEqual((last["seq"], last["final"]), (2, True))
        self.assertEqual([(s["source"], s["target"], s["lang"]) for s in last["sentences"]],
                         [("我們下週要上線新的系統。", "We launch the new system next week.", "zh")])
        self.assertEqual((last["sentences"][0]["startMs"], last["sentences"][0]["endMs"]), (0, last["throughMs"]))
        self.assertIn("PAUSE: short", service.user(0))
        self.assertIn("LAST: false", service.user(0))
        self.assertIn("CARRY: 我們下週要上線。", service.user(1))     # the model's sentence, forced back
        self.assertIn("LAST: true", service.user(1))
        self.assertIn("TERMS: 語橋", service.user(1))
        self.assertIn("語橋 我們下週要上線".encode(), service.transcriptions[1])   # glossary + earlier text as the prompt
        self.assertEqual(len(service.transcriptions), 2)

    def test_context_is_the_last_eight_sentences(self):
        answers = [{"sentences": [{"src": f"句子{n}。", "tgt": f"Sentence {n}."}], "carry": ""} for n in range(11)]
        service = FakeQualityService([f"句子{n}。" for n in range(11)], answers)
        audio = b"".join(tone(5.2) + silence(1.4) for _ in range(10)) + tone(2)
        events = self.run_pass(service, audio)
        self.assertEqual(sum(len(event["quality"]["sentences"]) for event in events), 11)
        context = service.user(10).split("CARRY:")[0]
        self.assertNotIn("句子1。", context)
        self.assertEqual([n for n in range(11) if f"句子{n}。\n" in context], list(range(2, 10)))

    def test_long_silence_settles_a_carried_sentence(self):
        service = FakeQualityService(["我們先到這裡"], [{"sentences": [], "carry": "我們先到這裡"},
                                                  {"sentences": [{"src": "我們先到這裡。", "tgt": "Let us stop here."}], "carry": ""}])
        events = [event["quality"] for event in self.run_pass(service, tone(6) + silence(20))]
        settled = next(event for event in events if event.get("sentences"))
        self.assertEqual((settled["final"], [s["target"] for s in settled["sentences"]]), (False, ["Let us stop here."]))
        self.assertIn("CARRY: 我們先到這裡\nNEW: \nPAUSE: long", service.user(1))
        self.assertEqual(len(service.transcriptions), 1)             # the silence itself was never sent

    def test_kanji_only_japanese_keeps_the_language_the_model_heard(self):
        self.assertEqual(quality_pass.spoken_language("会議終了。", "zh_ja", "ja"), "ja")
        self.assertEqual(quality_pass.spoken_language("會議結束。", "zh_ja", "zh"), "zh")
        self.assertEqual(quality_pass.spoken_language("ありがとう", "zh_ja", "zh"), "ja")
        self.assertEqual(quality_pass.spoken_language("會議結束。", "zh_ja", "??"), "zh")

    def test_two_way_chinese_and_japanese(self):
        service = FakeQualityService(["今日はありがとうございます"], [{"sentences": [{"src": "今日はありがとうございます。", "tgt": "今天谢谢大家，简单说明。", "lang": "ja"}], "carry": ""}])
        sentence = self.run_pass(service, tone(3), language="zh_ja")[-1]["quality"]["sentences"][0]
        self.assertEqual((sentence["lang"], sentence["source"], sentence["target"]), ("ja", "今日はありがとうございます。", "今天谢谢大家，簡单说明。"))
        self.assertNotIn(b'name="language"', service.transcriptions[0])   # only a single-language stream names it

    def test_a_recognizer_that_takes_no_prompt_is_asked_again_without_one(self):
        answers = [{"sentences": [{"src": f"第{n}段。", "tgt": f"Part {n}."}], "carry": ""} for n in range(3)]
        service = FakeQualityService(["第0段", "第1段", "第2段"], answers, takes_prompt=False)
        with self.assertLogs("uvicorn.error", level="INFO"):
            events = self.run_pass(service, tone(6) + silence(1.5) + tone(6) + silence(1.5) + tone(3))
        self.assertEqual([s["target"] for event in events for s in event["quality"].get("sentences", [])], ["Part 0.", "Part 1.", "Part 2."])
        self.assertFalse(any(event["quality"].get("failed") for event in events))
        # First chunk: nothing to prompt with. Second: refused once, repeated without. Third: no prompt at all.
        self.assertEqual([b'name="prompt"' in body for body in service.transcriptions], [False, True, False, False])

    def test_a_failed_chunk_keeps_going(self):
        service = FakeQualityService(["第一段", "第二段"], ["TIMEOUT", 500, {"sentences": [{"src": "第二段。", "tgt": "Part two."}], "carry": ""}])
        with self.assertLogs("uvicorn.error", level="WARNING"):
            events = [event["quality"] for event in self.run_pass(service, tone(6) + silence(1.5) + tone(3))]
        self.assertEqual((events[0].get("failed"), events[0]["throughMs"] > 6000, events[0]["final"]), (True, True, False))
        self.assertEqual([s["target"] for s in events[1]["sentences"]], ["Part two."])
        self.assertEqual(len(service.chats), 3)                      # one retry, then the next chunk
        self.assertIn("CARRY: \n", service.user(2))                  # the failed range left nothing carried

    def test_an_unusable_answer_fails_the_chunk(self):
        service = FakeQualityService(["只有一段"], ["not json", "still not json"])
        with self.assertLogs("uvicorn.error", level="WARNING"):
            events = self.run_pass(service, tone(3))
        self.assertEqual((events[-1]["quality"].get("failed"), events[-1]["quality"]["final"]), (True, True))

    def test_a_backlog_gives_up_the_oldest_chunk(self):
        def backlog(quality):
            for n in range(5):
                quality.waiting.append(quality_pass.Chunk(n * 6000, (n + 1) * 6000, tone(0.5), 0.5, "long"))
        service = FakeQualityService(["a", "b", "c"], [])
        with self.assertLogs("uvicorn.error", level="WARNING") as logs:
            events = [event["quality"] for event in self.run_pass(service, b"", before_finish=backlog)]
        # Five chunks and the closing one wait: the two oldest are given up, three stay waiting.
        self.assertEqual([bool(event.get("failed")) for event in events], [True, True, False, False, False, False])
        self.assertEqual(len(service.transcriptions), 3)             # the given-up ones were never sent
        self.assertIn("result=backlog", "\n".join(logs.output))

    def test_silence_is_never_sent_to_the_recognizer(self):
        service = FakeQualityService([], [])
        events = self.run_pass(service, silence(12))
        self.assertEqual((service.transcriptions, service.chats), ([], []))
        self.assertTrue(events[-1]["quality"]["final"])

    def test_logs_carry_numbers_only(self):
        service = FakeQualityService(["機密內容"], [{"sentences": [{"src": "機密內容。", "tgt": "Secret content."}], "carry": ""}])
        with self.assertLogs("uvicorn.error", level="INFO") as logs:
            self.run_pass(service, tone(3), glossary="機密詞彙")
        text = "\n".join(logs.output)
        for secret in ("機密內容", "Secret content", "機密詞彙"):
            self.assertNotIn(secret, text)
        self.assertRegex(text, r"quality chunk seq=1 audio_ms=\d+ chars_in=4 chars_out=\d+ ms=\d+ result=ok")

    def test_finish_times_out_with_a_failed_final_event(self):
        async def slow(request):
            await asyncio.sleep(5)
            return httpx.Response(200, json={"text": "x"})

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(slow))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"), \
                    patch("quality_pass.FINISH_TIMEOUT", 0.2):
                quality = quality_pass.QualityPass(send, "zh", "en", "")
                quality.feed(tone(3))
                await quality.finish()
            return events
        with self.assertLogs("uvicorn.error", level="WARNING"):
            events = asyncio.run(go())
        self.assertEqual((events[-1]["quality"].get("failed"), events[-1]["quality"]["final"]), (True, True))


class FakeReviewer:
    """The text model as the reviser asks it: answers in order; without one, the window comes back unchanged."""

    def __init__(self, answers=()):
        self.answers, self.users = list(answers), []

    async def __call__(self, messages, timeout):
        user = messages[1]["content"]
        self.users.append(user)
        window = [{"id": int(number), "src": src, "tgt": tgt} for number, src, tgt in re.findall(r"^(\d+)\. SRC: (.*)\n   TGT: (.*)$", user, re.M)]
        answer = self.answers.pop(0) if self.answers else None
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            answer = answer(window)
            if asyncio.iscoroutine(answer):
                answer = await answer
        return {"sentences": window, "notes": ""} if answer is None else answer

    def numbers(self, index):
        """The window of request `index` as the sentence ids it held (from the test sentences' text)."""
        return [int(n) for n in re.findall(r"SRC: 這是第(\d+)句話。", self.users[index])]


def shown(first, last):
    return [{"id": n, "source": f"這是第{n}句話。", "target": f"This is sentence {n}.", "lang": "zh", "targetLang": "en", "startMs": n * 1000, "endMs": n * 1000 + 900}
            for n in range(first, last + 1)]


def changing(changes, notes=""):
    """An answer that repeats the window except for `changes`: {number: (src, tgt)}; None for either keeps it."""
    def answer(window):
        for item in window:
            src, tgt = changes.get(item["id"], (None, None))
            item["src"], item["tgt"] = src or item["src"], tgt or item["tgt"]
        return {"sentences": window, "notes": notes}
    return answer


def merging(groups, texts=None, notes=""):
    """An answer whose items stand for `groups` of the window's numbers; the parts' texts joined, or `texts[first number]`."""
    def answer(window):
        items = []
        for group in groups:
            parts = [window[number - 1] for number in group]
            src, tgt = (texts or {}).get(group[0] if group else 0, ("".join(p["src"] for p in parts), " ".join(p["tgt"] for p in parts)))
            items.append({"ids": list(group), "src": src, "tgt": tgt})
        return {"sentences": items, "notes": notes}
    return answer


class TranscriptOnlyQualityTest(unittest.TestCase):
    """transcript-only: with the target "none" 精準模式 and its revision settle the spoken text and translate nothing."""

    def test_quality_settles_the_text_without_translating(self):
        service = FakeQualityService(["我們下週上線新的系統"], [{"sentences": [{"src": "我们下週上線新的系統。", "lang": "zh"}], "carry": ""}])

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"):
                quality = quality_pass.QualityPass(send, "zh", "none", "", lambda text: text.replace("们", "們"))
                quality.feed(tone(3))
                await quality.finish()
            return events
        events = asyncio.run(go())
        sentences = [s for event in events for s in event["quality"]["sentences"]]
        self.assertEqual([(s["source"], s["target"], s["lang"]) for s in sentences], [("我們下週上線新的系統。", "", "zh")])
        system, user = service.chats[0]["messages"][0]["content"], service.user(0)
        self.assertNotIn("TRANSLATE INTO", user)
        self.assertNotIn("Translate each item", system)
        self.assertNotIn('"tgt"', system)
        self.assertIn('{"sentences": [{"src": "...", "lang": "zh"}], "carry": "..."}', system)
        self.assertIn("Nothing is translated.", system)

    def test_a_sentence_that_repeats_the_end_of_the_one_before_is_dropped(self):
        service = FakeQualityService(["要我幫你補一份待辦，或是把零零一到零零九移到封存區嗎"], [{"sentences": [
            {"src": "要我幫你補一份待辦，或是把零零一到零零九移到封存區嗎？", "lang": "zh"},
            {"src": "或是把零零一到零零九移到封存區嗎？", "lang": "zh"},   # the end of the one before, again
            {"src": "對。", "lang": "zh"}, {"src": "對。", "lang": "zh"}], "carry": ""}])   # given twice: shown once

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"):
                quality = quality_pass.QualityPass(send, "zh", "none", "")
                quality.feed(tone(3))
                await quality.finish()
            return events
        sentences = [s["source"] for event in asyncio.run(go()) for s in event["quality"]["sentences"]]
        self.assertEqual(sentences, ["要我幫你補一份待辦，或是把零零一到零零九移到封存區嗎？", "對。"])

    def test_a_short_english_confirmation_of_the_end_is_kept(self):
        service = FakeQualityService(["so the deadline is next friday next friday"], [{"sentences": [
            {"src": "So the deadline is next Friday.", "tgt": "所以期限是下週五。"}, {"src": "Next Friday.", "tgt": "下週五。"},
            {"src": "Yes, it is next Friday.", "tgt": "對，是下週五。"}, {"src": "it is next Friday.", "tgt": "是下週五。"}], "carry": ""}])

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"):
                quality = quality_pass.QualityPass(send, "en", "zh", "")
                quality.feed(tone(3))
                await quality.finish()
            return events
        sentences = [s["source"] for event in asyncio.run(go()) for s in event["quality"]["sentences"]]
        # Two words that confirm the end stay; four words that only repeat it go.
        self.assertEqual(sentences, ["So the deadline is next Friday.", "Next Friday.", "Yes, it is next Friday."])

    def test_revision_corrects_the_text_only(self):
        users, systems = [], []

        async def reviewer(messages, timeout):
            systems.append(messages[0]["content"])
            users.append(messages[1]["content"])
            numbers = [int(n) for n in re.findall(r"^(\d+)\. SRC: ", messages[1]["content"], re.M)]
            return {"sentences": [{"ids": [n], "src": "這是第三句話。" if n == 3 else f"這是第{n}句話。"} for n in numbers], "notes": ""}

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            reviser = revise_pass.Reviser(reviewer, send, "English", lambda start, end: "", lambda text: text,
                                          lambda text: quality_pass.units(text, quality_pass.in_words(text)), translate=False)
            reviser.add([dict(s, target="") for s in shown(1, 9)])
            for _ in range(50):
                await asyncio.sleep(0)
            reviser.cancel()
            return events
        events = asyncio.run(go())
        self.assertEqual(systems[0], revise_pass.SYSTEM_TRANSCRIPT)
        self.assertNotIn("TGT:", users[0])
        self.assertNotIn("TRANSLATE INTO", users[0])
        self.assertNotIn("3. Translation.", revise_pass.SYSTEM_TRANSCRIPT)
        self.assertEqual(events, [{"revision": {"seq": 1, "sentences": [{"id": 3, "source": "這是第三句話。", "target": ""}]}}])


class ReviserTest(unittest.TestCase):
    """quality-revision: shown sentences are revised in windows; anything that goes wrong keeps the first result."""

    def run_reviser(self, reviewer, script, glossary=""):
        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            reviser = revise_pass.Reviser(reviewer, send, "English", lambda start, end: f"live text {start}-{end}", lambda text: text.replace("简", "簡"),
                                          lambda text: quality_pass.units(text, quality_pass.in_words(text)), glossary)

            async def settle():
                for _ in range(50):
                    await asyncio.sleep(0)
            await script(reviser, settle)
            reviser.cancel()
            return events
        return asyncio.run(go())

    def test_a_window_is_revised_when_three_more_sentences_exist(self):
        reviewer, asked = FakeReviewer(), []

        async def script(reviser, settle):
            reviser.add(shown(1, 8))
            await settle()
            asked.append(len(reviewer.users))
            reviser.add(shown(9, 9))
            await settle()
        events = self.run_reviser(reviewer, script, glossary="語橋")
        self.assertEqual((asked, len(reviewer.users), reviewer.numbers(0)), ([0], 1, [1, 2, 3, 4, 5, 6]))
        user = reviewer.users[0]
        self.assertIn("AFTER: 這是第7句話。 這是第8句話。 這是第9句話。", user)
        self.assertIn("1. SRC: 這是第1句話。\n   TGT: This is sentence 1.", user)
        self.assertIn("ALT: live text 1000-6900", user)
        self.assertIn("TERMS: 語橋", user)
        self.assertIn("BEFORE:\n(start of meeting)", user)
        self.assertTrue(user.endswith("TRANSLATE INTO: English"))
        self.assertEqual(events, [])   # nothing changed: no event

    def test_only_changed_sentences_are_sent(self):
        reviewer = FakeReviewer([changing({3: ("這是第3句话，简单。", None), 5: (None, "This is the fifth sentence.")})])

        async def script(reviser, settle):
            reviser.add(shown(1, 9))
            await settle()
        with self.assertLogs("uvicorn.error", level="INFO") as logs:
            events = self.run_reviser(reviewer, script)
        self.assertEqual(events, [{"revision": {"seq": 1, "sentences": [{"id": 3, "source": "這是第3句话，簡单。", "target": "This is sentence 3."},
                                                                         {"id": 5, "source": "這是第5句話。", "target": "This is the fifth sentence."}]}}])
        self.assertIn("quality revision sentences=6 changed=2", logs.output[0])
        self.assertTrue(logs.output[0].endswith("result=ok"))
        self.assertNotIn("句", "".join(logs.output))       # no meeting text
        self.assertNotIn("sentence 3", "".join(logs.output))

    def test_notes_and_revised_text_reach_the_next_window(self):
        reviewer = FakeReviewer([changing({6: ("這是第6句話！", None)}, notes="Patient: a woman")])

        async def script(reviser, settle):
            reviser.add(shown(1, 15))
            await settle()
        self.run_reviser(reviewer, script)
        self.assertEqual([reviewer.numbers(0), reviewer.numbers(1)], [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]])
        self.assertIn("NOTES: (nothing yet)", reviewer.users[0])
        self.assertIn("NOTES: Patient: a woman", reviewer.users[1])
        self.assertIn("這是第6句話！\n  => This is sentence 6.\n\nWINDOW:", reviewer.users[1])   # BEFORE holds the revised text

    def test_the_request_and_event_of_the_spec_example(self):
        window = shown(1, 9)
        window[1].update(source="跟先生的感情變得穩定。", target="Her relationship with her husband became stable.")
        reviewer = FakeReviewer([changing({2: ("跟先生的感情變得不穩定。", "Her relationship with her husband became unstable.")})])

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            reviser = revise_pass.Reviser(reviewer, send, "English", lambda start, end: "跟先生的感情变得不稳定", lambda text: text,
                                          lambda text: quality_pass.units(text, quality_pass.in_words(text)))
            reviser.add(window)
            for _ in range(50):
                await asyncio.sleep(0)
            reviser.cancel()
            return events
        events = asyncio.run(go())
        self.assertIn("2. SRC: 跟先生的感情變得穩定。", reviewer.users[0])
        self.assertIn("ALT: 跟先生的感情变得不稳定", reviewer.users[0])
        self.assertEqual(events[0]["revision"]["sentences"],
                         [{"id": 2, "source": "跟先生的感情變得不穩定。", "target": "Her relationship with her husband became unstable."}])

    def test_a_sentence_cut_in_two_is_merged(self):
        # revision-merge, the spec example: one item for sentences 2 and 3.
        window = shown(1, 15)
        window[1].update(source="所以我們決定", target="So we decided", startMs=6000, endMs=9000)
        window[2].update(source="在下個月開始。", target="Start next month.", startMs=9000, endMs=12000)
        reviewer = FakeReviewer([merging([[1], [2, 3], [4], [5], [6]], {2: ("所以我們決定在下個月開始。", "So we decided to start next month.")})])

        async def script(reviser, settle):
            reviser.add(window)
            await settle()
        with self.assertLogs("uvicorn.error", level="INFO") as logs:
            events = self.run_reviser(reviewer, script)
        self.assertEqual(events, [{"revision": {"seq": 1, "sentences": [
            {"id": 2, "source": "所以我們決定在下個月開始。", "target": "So we decided to start next month.", "merged": [3], "endMs": 12000}]}}])
        self.assertIn("quality revision sentences=6 changed=1 merged=1", logs.output[0])
        # The next window starts at sentence 7 and has five sentences before it, the merged one once.
        self.assertEqual(reviewer.numbers(1), [7, 8, 9, 10, 11, 12])
        before = reviewer.users[1].split("BEFORE:\n")[1].split("\n\nWINDOW:")[0]
        self.assertEqual(before.count("\n  => "), 5)
        self.assertEqual(before.count("所以我們決定在下個月開始。\n  => So we decided to start next month."), 1)
        self.assertNotIn("Start next month.", before)

    def test_merges_follow_the_example_table(self):
        mixed = lambda: [dict(s, lang="ja") if s["id"] == 3 else s for s in shown(1, 9)]
        for groups, sentences, used in (([[1], [2, 3], [4], [5], [6]], shown(1, 9), True), ([[1], [2, 3, 4], [5], [6]], shown(1, 9), False),
                                        ([[1], [2, 3, 4, 5], [6]], shown(1, 9), False), ([[1], [2, 4], [3], [5], [6]], shown(1, 9), False),
                                        ([[1], [], [2], [3], [4], [5], [6]], shown(1, 9), False), ([[1], [2, 3], [4], [5], [6]], mixed(), False)):
            reviewer = FakeReviewer([merging(groups), merging(groups)])

            async def script(reviser, settle):
                reviser.add(sentences)
                await settle()
            with self.assertLogs("uvicorn.error", level="INFO") as logs:
                events = self.run_reviser(reviewer, script)
            self.assertEqual(len(events), 1 if used else 0, groups)
            self.assertEqual(len(reviewer.users), 1 if used else 2, groups)   # an unusable answer is asked for once more
            if used:
                self.assertEqual(events[0]["revision"]["sentences"][0]["merged"], groups[1][1:])
            else:
                self.assertRegex(logs.output[0], r"merged=0 ms=\d+ result=failed:(sentences|merge)$")
        self.assertTrue(logs.output[0].endswith("result=failed:merge"))   # the last case: two languages

    def test_the_windows_left_at_the_end_are_asked_together(self):
        asked_at_first_answer = []

        def slow(changes):
            async def answer(window):
                await asyncio.sleep(0.05)
                asked_at_first_answer.append(len(reviewer.users))
                return changing(changes)(window)
            return answer
        reviewer = FakeReviewer([slow({1: (None, "The first.")}), slow({3: (None, "The ninth.")})])

        async def script(reviser, settle):
            reviser.closing = True           # as when the stream has ended: nothing waits for more sentences
            reviser.add(shown(1, 15))
            await reviser.finish()
        events = self.run_reviser(reviewer, script)
        self.assertEqual([reviewer.numbers(0), reviewer.numbers(1)], [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13, 14, 15]])
        self.assertEqual(asked_at_first_answer[0], 2)                # both requests were out before the first answer
        self.assertEqual(sorted(s["id"] for e in events for s in e["revision"]["sentences"]), [1, 9])

    def test_the_rest_is_asked_for_while_a_window_is_still_being_revised(self):
        asked_before_the_first_answer = []

        async def slow(window):
            await asyncio.sleep(0.05)
            asked_before_the_first_answer.append(len(reviewer.users))
        reviewer = FakeReviewer([slow, changing({1: (None, "The seventh.")})])

        async def script(reviser, settle):
            reviser.add(shown(1, 13))        # sentences 1 to 6 are being revised when the stream ends
            await settle()
            self.assertEqual(len(reviewer.users), 1)
            await reviser.finish()
        events = self.run_reviser(reviewer, script)
        self.assertEqual([reviewer.numbers(0), reviewer.numbers(1)], [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12, 13]])
        self.assertEqual(asked_before_the_first_answer, [2])      # sentences 7 to 13 did not wait for the first window
        self.assertEqual(events[0]["revision"]["sentences"], [{"id": 7, "source": "這是第7句話。", "target": "The seventh."}])

    def test_a_merge_at_the_end_and_what_was_not_done_in_time(self):
        async def never(window):
            await asyncio.sleep(5)
        reviewer = FakeReviewer([merging([[1, 2], [3], [4], [5], [6]]), never])

        async def script(reviser, settle):
            reviser.closing = True
            reviser.add(shown(1, 15))
            await reviser.finish()
        with patch("revise_pass.FINISH_TIMEOUT", 0.2), self.assertLogs("uvicorn.error", level="WARNING") as logs:
            events = self.run_reviser(reviewer, script)
        self.assertEqual(events[0]["revision"]["sentences"][0]["merged"], [2])
        self.assertIn("9 sentences were not revised before the stream closed", "".join(logs.output))

    def test_usable_follows_the_example_table(self):
        for given, back, used in ((100, 100, True), (100, 80, True), (100, 79, False), (100, 130, True), (100, 131, False)):
            self.assertIs(revise_pass.usable(given, back), used, (given, back))

    def test_an_answer_that_does_not_cover_the_window_is_asked_again_then_given_up(self):
        def drop_one(window):
            return {"sentences": window[:5], "notes": "wrong"}

        def twice_two(window):
            window[2]["id"] = 2
            return {"sentences": window, "notes": "wrong"}

        def shortened(window):
            for item in window:
                item["src"] = item["src"][:3]
            return {"sentences": window, "notes": "wrong"}

        def emptied(window):
            window[0]["tgt"] = " "
            return {"sentences": window, "notes": "wrong"}
        for first, second, reason in ((drop_one, drop_one, "sentences"), (twice_two, twice_two, "sentences"), (shortened, shortened, "coverage"),
                                      (emptied, "not json", "sentences"), (httpx.ReadTimeout("slow"), emptied, "empty")):
            reviewer = FakeReviewer([first, second, changing({1: (None, "The seventh.")}, notes="kept")])

            async def script(reviser, settle):
                reviser.add(shown(1, 15))
                await settle()
            with self.assertLogs("uvicorn.error", level="WARNING") as logs:
                events = self.run_reviser(reviewer, script)
            self.assertEqual([e["revision"]["sentences"] for e in events], [[{"id": 7, "source": "這是第7句話。", "target": "The seventh."}]], reason)
            self.assertIn(f"quality revision sentences=6 changed=0", logs.output[0])
            self.assertTrue(logs.output[0].endswith(f"result=failed:{reason}"), logs.output[0])
            self.assertEqual(len(reviewer.users), 3)                       # asked twice, then the next window
            self.assertIn("NOTES: (nothing yet)", reviewer.users[2])      # a refused answer's notes are not kept

    def test_the_second_answer_is_used_when_the_first_request_fails(self):
        reviewer = FakeReviewer([httpx.ConnectError("down"), changing({1: (None, "The first.")})])

        async def script(reviser, settle):
            reviser.add(shown(1, 9))
            await settle()
        events = self.run_reviser(reviewer, script)
        self.assertEqual(events[0]["revision"]["sentences"], [{"id": 1, "source": "這是第1句話。", "target": "The first."}])

    def test_far_behind_gives_up_the_oldest_windows(self):
        reviewer = FakeReviewer()

        async def script(reviser, settle):
            reviser.add(shown(1, 43))      # 43 waiting: 13 over the limit, three windows are given up
            await settle()
        with self.assertLogs("uvicorn.error", level="WARNING") as logs:
            self.run_reviser(reviewer, script)
        self.assertEqual([line.split("quality revision ")[1] for line in logs.output], ["sentences=6 changed=0 merged=0 ms=0 result=skipped"] * 3)
        self.assertEqual(reviewer.numbers(0), [19, 20, 21, 22, 23, 24])

    def test_a_short_meeting_is_revised_when_it_ends(self):
        reviewer = FakeReviewer([changing({4: (None, "The last one.")})])

        async def script(reviser, settle):
            reviser.add(shown(1, 4))
            await settle()
            self.assertEqual(reviewer.users, [])
            await reviser.finish()
        events = self.run_reviser(reviewer, script)
        self.assertEqual((reviewer.numbers(0), events[0]["revision"]["sentences"][0]["id"]), ([1, 2, 3, 4], 4))
        self.assertIn("AFTER: (nothing yet)", reviewer.users[0])

    def test_the_rest_at_the_end_is_one_window_up_to_nine(self):
        for count, windows in ((9, [9]), (10, [6, 4]), (16, [6, 6, 4])):
            reviewer = FakeReviewer()

            async def script(reviser, settle):
                reviser.closing = True           # as when the stream has ended: nothing waits for more sentences
                reviser.add(shown(1, count))
                await reviser.finish()
            self.run_reviser(reviewer, script)
            self.assertEqual([len(reviewer.numbers(i)) for i in range(len(reviewer.users))], windows, count)

    def test_a_slow_model_at_the_end_leaves_the_last_sentences(self):
        async def slow(window):
            await asyncio.sleep(5)
        reviewer = FakeReviewer([slow, slow])

        async def script(reviser, settle):
            reviser.add(shown(1, 4))
            began = time.monotonic()
            await reviser.finish()
            self.assertLess(time.monotonic() - began, 2)
        with patch("revise_pass.FINISH_TIMEOUT", 0.2), self.assertLogs("uvicorn.error", level="WARNING") as logs:
            events = self.run_reviser(reviewer, script)
        self.assertEqual(events, [])
        self.assertIn("4 sentences were not revised before the stream closed", "".join(logs.output))

    def test_cancel_stops_without_sending(self):
        async def slow(window):
            await asyncio.sleep(0.05)
            return changing({1: (None, "Late.")})(window)
        reviewer = FakeReviewer([slow])

        async def script(reviser, settle):
            reviser.add(shown(1, 9))
            await settle()
            reviser.cancel()
            await asyncio.sleep(0.1)
        self.assertEqual(self.run_reviser(reviewer, script), [])


class FakeRevisingService(FakeQualityService):
    """The quality service with the reviser's requests answered apart from the chunk requests."""

    def __init__(self, heard, answers, revisions=()):
        super().__init__(heard, answers)
        self.revisions, self.revision_chats = list(revisions), []

    def __call__(self, request):
        if not request.url.path.endswith("/audio/transcriptions") and b"You are the reviewer" in request.content:
            body = json.loads(request.content)
            self.revision_chats.append(body)
            window = [{"id": int(number), "src": src, "tgt": tgt}
                      for number, src, tgt in re.findall(r"^(\d+)\. SRC: (.*)\n   TGT: (.*)$", body["messages"][1]["content"], re.M)]
            answer = self.revisions.pop(0)(window) if self.revisions else {"sentences": window, "notes": ""}
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answer, ensure_ascii=False)}}]})
        return super().__call__(request)


class QualityRevisionTest(unittest.TestCase):
    """quality-revision inside the quality pass: ids, the setting, events after the final one."""
    run_pass = QualityPassTest.run_pass

    @staticmethod
    def heard_live(quality):
        """The live engine has shown text by the first second of audio."""
        quality.fed_ms = 1000
        quality.live("句子即時文字")
        quality.fed_ms = 0

    def eleven(self, revisions=()):
        answers = [{"sentences": [{"src": f"句子{n}。", "tgt": f"Sentence {n}."}], "carry": ""} for n in range(11)]
        service = FakeRevisingService([f"句子{n}。" for n in range(11)], answers, revisions)
        audio = b"".join(tone(5.2) + silence(1.4) for _ in range(10)) + tone(2)
        return service, self.run_pass(service, audio, before_finish=self.heard_live)

    def test_sentences_carry_ids_and_nothing_is_revised_when_the_setting_is_off(self):
        service, events = self.eleven()
        self.assertEqual([s["id"] for event in events for s in event["quality"]["sentences"]], list(range(1, 12)))
        self.assertEqual((service.revision_chats, [e for e in events if "revision" in e]), ([], []))
        self.assertEqual(len(service.chats), 11)

    def test_two_events_with_two_sentences_and_one(self):
        service = FakeQualityService(["第一句。第二句。", "第三句。"],
                                     [{"sentences": [{"src": "第一句。", "tgt": "One."}, {"src": "第二句。", "tgt": "Two."}], "carry": ""},
                                      {"sentences": [{"src": "第三句。", "tgt": "Three."}], "carry": ""}])
        events = self.run_pass(service, tone(5.2) + silence(1.4) + tone(2))
        self.assertEqual([[s["id"] for s in event["quality"]["sentences"]] for event in events if event["quality"]["sentences"]], [[1, 2], [3]])

    def test_revision_events_follow_and_the_last_ones_come_after_the_final_event(self):
        revisions = [changing({2: (None, "The second sentence.")}), changing({5: ("句子10！", None)})]   # windows: sentences 1-6, then 7-11
        with patch("quality_pass.REVISE", True), patch("quality_pass.REVISE_EXTRA", {"thinking": {"type": "enabled"}}), patch("quality_pass.EXTRA", {"thinking": {"type": "disabled"}}):
            service, events = self.eleven(revisions)
        kinds = ["revision" if "revision" in e else "final" if e["quality"]["final"] else "quality" for e in events]
        self.assertEqual((kinds.count("revision"), kinds[-1], kinds.index("final") < len(kinds) - 1), (2, "revision", True))
        first, last = (e for e in events if "revision" in e)
        self.assertEqual((first["revision"], "audioMs" in first), ({"seq": 1, "sentences": [{"id": 2, "source": "句子1。", "target": "The second sentence."}]}, True))
        self.assertEqual(last["revision"], {"seq": 2, "sentences": [{"id": 11, "source": "句子10！", "target": "Sentence 10."}]})
        self.assertEqual([chat["thinking"] for chat in service.revision_chats], [{"type": "enabled"}] * 2)   # its own extra, not the chunks'
        self.assertEqual({chat["thinking"]["type"] for chat in service.chats}, {"disabled"})
        self.assertIn("ALT: 句子即時文字", service.revision_chats[0]["messages"][1]["content"])
        self.assertEqual(len(service.chats), 11)   # chunk requests are not delayed or repeated


class QualityTargetLanguageTest(unittest.TestCase):
    """quality-pass: the translation language is named next to the text, not only in the instructions."""

    def test_each_request_names_the_translation_language(self):
        for language, target, named in (("en", "ja", "Japanese"), ("ja", "zh", "Chinese (Traditional, Taiwan)"), ("zh", "", "English"),
                                        ("zh_ja", "", "Japanese for a Chinese sentence, Chinese (Traditional, Taiwan) for a Japanese one")):
            service = FakeQualityService(["hello there."], [])

            async def go():
                async def send(payload):
                    pass
                with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"):
                    quality = quality_pass.QualityPass(send, language, target, "")
                    quality.feed(tone(3))
                    await quality.finish()
            asyncio.run(go())
            self.assertTrue(service.user(0).endswith("TRANSLATE INTO: " + named), service.user(0)[-80:])
            self.assertIn(f'Every "tgt" is written in ', service.chats[0]["messages"][0]["content"])


class QualityLoopTest(unittest.TestCase):
    """quality-pass: a recognizer's repetition loop at the end of a chunk is kept once."""

    def test_a_loop_at_the_end_is_reduced_to_one_unit(self):
        said = "分かってきたんですね。"
        self.assertEqual(quality_pass.without_loop(said + "はい。" * 40 + "はい"), said + "はい。")   # cut off mid-unit
        self.assertEqual(quality_pass.without_loop(said + "はい。" * 5), said + "はい。")
        self.assertEqual(quality_pass.without_loop("thank you " * 9), "thank you ")

    def test_ordinary_text_is_untouched(self):
        for text in ("はい。はい。はい。そうですね。", "預算是 1000000 元，哈哈哈哈哈。", "no no no no, not that one", "對對對對對，就是這樣", ""):
            self.assertEqual(quality_pass.without_loop(text), text)
        self.assertEqual(quality_pass.without_loop("はい。" * 6 + "では次に進みます。"), "はい。" * 6 + "では次に進みます。")   # not at the end
        # One character repeated is speech however long the run, also at the very end of a chunk.
        for text in ("總共 10000000000", "大家笑了哈哈哈哈哈哈哈哈哈哈", "對對對對對對對對對對對", "aaaaaaaaaaaaaaaaaaaaaaaa"):
            self.assertEqual(quality_pass.without_loop(text), text)

    def test_extra_fields_go_into_the_transcription_request(self):
        service = FakeQualityService(["好。"], [])

        async def go():
            async def send(payload):
                pass
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), patch("quality_pass.URL", "http://quality.test/v1"), \
                    patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"), patch("quality_pass.ASR_EXTRA", {"max_completion_tokens": "400"}):
                quality = quality_pass.QualityPass(send, "zh", "en", "")
                quality.feed(tone(3))
                await quality.finish()
        asyncio.run(go())
        self.assertIn(b'name="max_completion_tokens"\r\n\r\n400', service.transcriptions[0])


class QualityRecognizerElsewhereTest(unittest.TestCase):
    """quality-pass: a recognizer at its own address gets its own key, never the text service's."""

    def test_the_recognizer_address_and_key_are_its_own(self):
        seen = []

        def service(request):
            seen.append((str(request.url), request.headers.get("authorization")))
            if request.url.path.endswith("/audio/transcriptions"):
                return httpx.Response(200, json={"text": "language Chinese<asr_text>新的系統。"})
            chats.append(json.loads(request.content)["messages"][1]["content"])
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"sentences": [], "carry": ""})}}]})

        chats = []

        async def go(key):
            async def send(payload):
                pass
            with patch("quality_pass.KEY", "text-key"), patch("quality_pass.URL", "http://text.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), \
                    patch("quality_pass.MODEL", "text"), patch("quality_pass.ASR_URL", "http://asr.test/v1"), patch("quality_pass.ASR_KEY", key), \
                    patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service), headers={"Authorization": "Bearer text-key"})):
                quality = quality_pass.QualityPass(send, "zh", "en", "")
                quality.feed(tone(3))
                await quality.finish()
        asyncio.run(go(""))
        asyncio.run(go("asr-key"))
        self.assertIn("NEW: 新的系統。" + chr(10), chats[0])   # the recognizer's language tag is not text
        self.assertEqual(seen, [("http://asr.test/v1/audio/transcriptions", None), ("http://text.test/v1/chat/completions", "Bearer text-key"),
                                ("http://asr.test/v1/audio/transcriptions", "Bearer asr-key"), ("http://text.test/v1/chat/completions", "Bearer text-key")])


class FakeMai:
    """A MAI realtime session: each commit is answered with the next transcript. With `drop_at`, the session ends
    at that commit without answering it."""

    def __init__(self, transcripts, drop_at=None, silent_at=None):
        self.sent, self.transcripts, self.drop_at, self.silent_at = [], list(transcripts), drop_at, silent_at
        self.opening = ["session.created", "session.updated"]
        self.commits = asyncio.Queue()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def send(self, message):
        self.sent.append(json.loads(message))
        if self.sent[-1]["type"] == "input_audio_buffer.commit":
            self.commits.put_nowait(True)

    async def recv(self):
        return json.dumps({"type": self.opening.pop(0)})

    async def __aiter__(self):
        answered = 0
        while True:
            await self.commits.get()
            answered += 1
            if answered == self.drop_at:
                return
            if answered == self.silent_at:   # this commit is answered late; the session stays open
                await asyncio.sleep(0.3)
            yield json.dumps({"type": "conversation.item.input_audio_transcription.completed", "transcript": self.transcripts.pop(0)})

    async def close(self):
        pass

    def audio(self):
        return b"".join(base64.b64decode(m["audio"]) for m in self.sent if m["type"] == "input_audio_buffer.append")


class QualityEngineTest(unittest.TestCase):
    """quality-pass: the second recognition by the app's own engines (TRANSLATE_QUALITY_ASR)."""

    def run_pass(self, engine, connection, language="zh"):
        service = FakeQualityService([], [{"sentences": [{"src": "新的系統。", "tgt": "The new system."}], "carry": ""}])

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", ""), patch("quality_pass.MODEL", "text"), \
                    patch("quality_pass.ASR", engine), patch("chunk_asr.websockets.connect", return_value=connection), \
                    patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                quality = quality_pass.QualityPass(send, language, "en", "語橋", lambda text: text, "Chinese")
                quality.feed(tone(3))
                await quality.finish()
            return events
        return service, asyncio.run(go())

    def test_the_local_engine_hears_the_chunk_and_no_transcription_request_is_made(self):
        upstream = FakeUpstream(["新的", "系统。"])
        service, events = self.run_pass("local", upstream)
        self.assertEqual(service.transcriptions, [])
        header = json.loads(upstream.sent[0])
        self.assertEqual((header["retain"], header["language"], header["use_vad"]), (False, "Chinese", False))
        self.assertEqual(b"".join(m for m in upstream.sent if isinstance(m, bytes)), tone(3))   # the whole chunk
        self.assertEqual(upstream.sent[-1], "YOUDAO_ONETIME_ASR_STREAM_EOS")
        self.assertIn("NEW: 新的系统。", service.user(0))
        self.assertEqual([s["target"] for s in events[-1]["quality"]["sentences"]], ["The new system."])

    def run_mai(self, sessions, parts, answers, gap=0):
        """`parts`: audio pieces; after each but the last, wait for the next quality event before going on."""
        service = FakeQualityService([], answers)

        async def go():
            events = []

            async def send(payload):
                events.append(payload)
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), \
                    patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", ""), patch("quality_pass.MODEL", "text"), \
                    patch("quality_pass.ASR", "mai"), patch("chunk_asr.websockets.connect", side_effect=list(sessions)), patch("chunk_asr.RECONNECT_AFTER", 0), \
                    patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                quality = quality_pass.QualityPass(send, "zh", "en", "", lambda text: text, "Chinese")
                for number, part in enumerate(parts):
                    for start in range(0, len(part), 6400):   # 0.2 s messages, as the browser sends them
                        quality.feed(part[start:start + 6400])
                    if number < len(parts) - 1:
                        while len(events) <= number:
                            await asyncio.sleep(0.01)
                        await asyncio.sleep(gap)
                await quality.finish()
            return events
        return service, asyncio.run(go())

    def test_mai_hears_the_audio_as_it_arrives_and_is_committed_at_the_chunk(self):
        session = FakeMai(["新的系統"])
        service, events = self.run_mai([session], [tone(3)], [{"sentences": [{"src": "新的系統。", "tgt": "The new system."}], "carry": ""}])
        self.assertEqual(service.transcriptions, [])
        kinds = [m["type"] for m in session.sent]
        self.assertEqual(kinds, ["session.update"] + ["input_audio_buffer.append"] * 15 + ["input_audio_buffer.commit"])
        self.assertEqual(session.audio(), tone(3))
        self.assertEqual(session.sent[0]["session"]["audio"]["input"]["transcription"]["language"], "zh")
        self.assertIn("NEW: 新的系統", service.user(0))
        self.assertIs(events[-1]["quality"].get("failed"), None)

    def test_a_dropped_mai_session_fails_its_chunk_and_a_new_one_takes_over(self):
        first, second = FakeMai([], drop_at=1), FakeMai(["後面的話"])
        service, events = self.run_mai([first, second], [tone(7) + silence(0.5), tone(6)],
                                       [{"sentences": [{"src": "後面的話。", "tgt": "What came after."}], "carry": ""}])
        self.assertEqual([bool(event["quality"].get("failed")) for event in events], [True, False])
        heard = first.audio()   # up to the commit: the speech and the pause that cut it
        self.assertTrue((tone(7) + silence(0.5)).startswith(heard) and len(heard) >= len(tone(7) + silence(0.3)), len(heard))
        self.assertEqual(second.audio(), tone(6))                         # only what arrived after the drop
        self.assertEqual([m["type"] for m in second.sent].count("input_audio_buffer.commit"), 1)
        self.assertEqual([s["target"] for s in events[-1]["quality"]["sentences"]], ["What came after."])

    def test_silence_is_not_committed_to_mai(self):
        session = FakeMai(["新的系統"])
        service, events = self.run_mai([session], [silence(20) + tone(3)], [{"sentences": [{"src": "新的系統。", "tgt": "The new system."}], "carry": ""}])
        self.assertEqual([m["type"] for m in session.sent].count("input_audio_buffer.commit"), 1)   # the silent chunks made none
        self.assertEqual(session.audio(), silence(20) + tone(3))

    def test_a_session_that_drops_inside_a_chunk_fails_that_chunk_too(self):
        """The new session hears only the end of the chunk: its text would be part of what was said."""
        async def cut_inside():
            first, second = FakeMai([], drop_at=1), FakeMai(["後半", "完整的一段"])
            with patch("chunk_asr.websockets.connect", side_effect=[first, second]), patch("chunk_asr.RECONNECT_AFTER", 0), \
                    patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                live = chunk_asr.MaiLive("zh")
                live.feed(tone(1))
                one = live.commit()
                live.feed(tone(1))                       # queued before the drop is noticed: the start of the next chunk
                with contextlib.suppress(chunk_asr.Refused):
                    await one
                live.feed(tone(1))                       # its end goes to the new session
                partial = live.commit()
                live.feed(tone(1))
                whole = live.commit()
                results = await asyncio.gather(partial, whole, return_exceptions=True)
                live.close()
                return results, second
        (partial, whole), second = asyncio.run(cut_inside())
        self.assertIsInstance(partial, chunk_asr.Refused)
        self.assertEqual(whole, "完整的一段")              # the transcript of the partial commit was dropped, not handed on
        self.assertEqual([m["type"] for m in second.sent].count("input_audio_buffer.commit"), 2)

    def test_a_mai_answer_that_comes_too_late_fails_its_chunk_and_the_stream_goes_on(self):
        session = FakeMai(["來得太晚", "這一段有回來"], silent_at=1)
        with patch("quality_pass.ASR_TIMEOUT", 0.2):
            service, events = self.run_mai([session], [tone(7) + silence(0.5), tone(6)],
                                           [{"sentences": [{"src": "這一段有回來。", "tgt": "This part came back."}], "carry": ""}], gap=0.3)
        self.assertEqual([bool(event["quality"].get("failed")) for event in events], [True, False])
        self.assertEqual((events[-1]["quality"]["final"], [s["target"] for s in events[-1]["quality"]["sentences"]]), (True, ["This part came back."]))

    def test_a_loop_from_the_apps_own_engine_is_kept_once(self):
        service, events = self.run_pass("local", FakeUpstream(["新的系统。"] + ["好的。"] * 30))
        self.assertIn("NEW: 新的系统。好的。\n", service.user(0))

    def test_an_engine_error_fails_the_chunk(self):
        service, events = self.run_pass("local", FakeUpstream([{"status": "error", "msg": "busy"}]))
        self.assertEqual((events[-1]["quality"].get("failed"), service.chats), (True, []))

    def test_configured_follows_the_engine(self):
        with patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", ""), patch("quality_pass.MODEL", "text"):
            with patch("quality_pass.ASR", "local"):
                self.assertTrue(quality_pass.configured())
            with patch("quality_pass.ASR", "mai"), patch("mai_asr.MAI_KEY", ""):
                self.assertFalse(quality_pass.configured())
            with patch("quality_pass.ASR", "mai"), patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                self.assertTrue(quality_pass.configured())
            with patch("quality_pass.ASR", "whisper"), patch("quality_pass.ASR_MODEL", "asr"):
                self.assertFalse(quality_pass.configured())
        # hybrid needs both recognizers: the transcriptions API for Chinese and MAI for the rest.
        with patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.MODEL", "text"), patch("quality_pass.ASR", "hybrid"):
            with patch("quality_pass.ASR_MODEL", "asr"), patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                self.assertTrue(quality_pass.configured())
            with patch("quality_pass.ASR_MODEL", ""), patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                self.assertFalse(quality_pass.configured())
            with patch("quality_pass.ASR_MODEL", "asr"), patch("mai_asr.MAI_KEY", ""):
                self.assertFalse(quality_pass.configured())
            with patch("quality_pass.ASR", "local"), patch("quality_pass.MODEL", ""):
                self.assertFalse(quality_pass.configured())


class QualityRecognizerChoiceTest(unittest.TestCase):
    """quality-pass: the recognizer by setting and stream language (the example table)."""

    def test_example_rows(self):
        for setting, language, expected in (("", "zh", "api"), ("", "ja", "api"), ("mai", "zh", "mai"), ("hybrid", "zh", "api"), ("hybrid", "yue", "api"),
                                            ("hybrid", "ja", "mai"), ("hybrid", "en", "mai"), ("hybrid", "auto", "mai"), ("hybrid", "zh_ja", "mai"),
                                            ("local", "ja", "local"), ("whisper", "zh", "")):
            with patch("quality_pass.ASR", setting):
                self.assertEqual(quality_pass.recognizer(language), expected, (setting, language))

    def test_hybrid_sends_chinese_to_the_api_and_opens_no_mai_session(self):
        service = FakeQualityService(["新的系統。"], [{"sentences": [{"src": "新的系統。", "tgt": "The new system."}], "carry": ""}])

        async def go():
            async def send(payload):
                pass
            with patch("quality_pass.new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service))), patch("quality_pass.URL", "http://quality.test/v1"), \
                    patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"), patch("quality_pass.ASR", "hybrid"), \
                    patch("chunk_asr.websockets.connect") as connect:
                quality = quality_pass.QualityPass(send, "zh", "en", "")
                quality.feed(tone(3))
                await quality.finish()
                return connect.call_count
        self.assertEqual((asyncio.run(go()), len(service.transcriptions)), (0, 1))


class QualityCoverageTest(unittest.TestCase):
    """quality-pass: the text model's answer accounts for its input."""

    FIRST = "we decided last week that the new billing system goes live in March and nobody outside the team was told"   # 20 words
    NEW = "so please keep this to yourselves until the public announcement"   # 10 words

    def test_example_rows(self):
        for given, back, usable in ((30, 26, True), (30, 21, True), (30, 20, False), (30, 10, False), (30, 55, True), (30, 56, False), (11, 2, True), (12, 8, False)):
            self.assertIs(quality_pass.covered(given, back), usable, (given, back))

    def test_units_are_words_for_latin_script_and_characters_otherwise(self):
        self.assertTrue(quality_pass.in_words("We go live in March 三月"))
        self.assertFalse(quality_pass.in_words("我們三月上線 FSD"))
        self.assertEqual(quality_pass.units("It's live, in March 2027.", True), 5)
        self.assertEqual(quality_pass.units("我們 3 月上線。", False), 6)

    def test_a_dropped_carry_is_asked_for_once_more(self):
        both = {"sentences": [{"src": f"{self.FIRST}, {self.NEW}.", "tgt": "甲。"}], "carry": ""}
        service = FakeQualityService([self.FIRST, self.NEW],
                                     [{"sentences": [{"src": self.FIRST + ".", "tgt": "甲。"}], "carry": ""},
                                      {"sentences": [{"src": self.NEW + ".", "tgt": "乙。"}], "carry": ""},   # the carried sentence is gone
                                      both])
        events = QualityPassTest.run_pass(self, service, tone(7) + silence(0.5) + tone(3), language="en", target="zh")
        self.assertEqual(len(service.chats), 3)
        self.assertEqual([s["source"] for s in events[-1]["quality"]["sentences"]], [f"{self.FIRST}, {self.NEW}."])
        self.assertFalse(any(event["quality"].get("failed") for event in events))

    def test_two_answers_that_drop_content_show_nothing_and_the_text_waits_for_the_next_chunk(self):
        dropped = {"sentences": [{"src": self.NEW + ".", "tgt": "乙。"}], "carry": ""}
        whole = {"sentences": [{"src": f"{self.FIRST}, {self.NEW}.", "tgt": "甲乙。"}, {"src": "Thanks everyone.", "tgt": "謝謝大家。"}], "carry": ""}
        service = FakeQualityService([self.FIRST, self.NEW, "Thanks everyone."],
                                     [{"sentences": [{"src": self.FIRST + ".", "tgt": "甲。"}], "carry": ""}, dropped, dropped, whole])
        with self.assertLogs("uvicorn.error", level="WARNING") as logs:
            events = QualityPassTest.run_pass(self, service, tone(7) + silence(0.5) + tone(7) + silence(0.5) + tone(3), language="en", target="zh")
        self.assertEqual([bool(event["quality"].get("failed")) for event in events], [False, False, False])
        self.assertEqual([len(event["quality"]["sentences"]) for event in events], [0, 0, 2])      # nothing shown until an answer covers it
        self.assertIn(f"CARRY: {self.FIRST}. {self.NEW}\n", service.user(3))                      # all of it asked again, once
        self.assertEqual([s["target"] for s in events[-1]["quality"]["sentences"]], ["甲乙。", "謝謝大家。"])
        self.assertTrue(any("did not cover its input" in line for line in logs.output))
        self.assertFalse(any("billing" in line or "announcement" in line for line in logs.output))   # numbers, never the text

    def test_an_uncovered_last_chunk_fails_and_so_does_one_beyond_the_carry_limit(self):
        dropped = {"sentences": [{"src": self.NEW + ".", "tgt": "乙。"}], "carry": ""}
        first = {"sentences": [{"src": self.FIRST + ".", "tgt": "甲。"}], "carry": ""}
        service = FakeQualityService([self.FIRST, self.NEW], [first, dropped, dropped])
        with self.assertLogs("uvicorn.error", level="WARNING") as logs:
            events = QualityPassTest.run_pass(self, service, tone(7) + silence(0.5) + tone(3), language="en", target="zh")
        self.assertEqual([bool(event["quality"].get("failed")) for event in events], [False, True])   # nothing follows the last chunk
        self.assertTrue(any("result=failed:Unusable:coverage" in line for line in logs.output))
        service = FakeQualityService([self.FIRST, self.NEW, "Thanks everyone."],
                                     [first, dropped, dropped, {"sentences": [{"src": "Thanks everyone.", "tgt": "謝謝大家。"}], "carry": ""}])
        with patch("quality_pass.CARRY_LIMIT", 50), self.assertLogs("uvicorn.error", level="WARNING"):
            events = QualityPassTest.run_pass(self, service, tone(7) + silence(0.5) + tone(7) + silence(0.5) + tone(3), language="en", target="zh")
        self.assertEqual([bool(event["quality"].get("failed")) for event in events], [False, True, False])
        self.assertEqual([s["target"] for s in events[-1]["quality"]["sentences"]], ["謝謝大家。"])

    def test_a_sentence_the_model_also_names_in_carry_is_carried_once(self):
        service = FakeQualityService(["我們下週要上線", "新的系統。"],
                                     [{"sentences": [{"src": "我們下週要上線", "tgt": "We go live next week"}], "carry": "我們下週要上線"},   # in both places
                                      {"sentences": [{"src": "我們下週要上線新的系統。", "tgt": "We launch the new system next week."}], "carry": ""}])
        QualityPassTest.run_pass(self, service, tone(7) + silence(0.5) + tone(2))
        self.assertIn("CARRY: 我們下週要上線\nNEW: 新的系統。", service.user(1))

    def test_a_repeated_sentence_does_not_stand_in_for_dropped_content(self):
        half = "we decided last week that the new billing system goes live in March and nobody"   # 15 of the 30 words given
        twice = {"sentences": [{"src": half + ".", "tgt": "甲。"}, {"src": half + ".", "tgt": "甲。"}], "carry": ""}
        service = FakeQualityService([self.FIRST + " " + self.NEW], [twice, twice])
        with self.assertLogs("uvicorn.error", level="WARNING"):
            events = QualityPassTest.run_pass(self, service, tone(3), language="en", target="zh")
        self.assertEqual((len(service.chats), bool(events[-1]["quality"].get("failed"))), (2, True))

    def test_a_sentence_given_twice_is_shown_once(self):
        again = {"src": "我們下週上線。", "tgt": "We go live next week."}
        service = FakeQualityService(["我們下週上線。", "請先確認測試結果。", "謝謝。"],
                                     [{"sentences": [again, {"src": "請先", "tgt": "Please first"}], "carry": ""},
                                      {"sentences": [again, again, {"src": "請先確認測試結果。", "tgt": "Please check the test results first."}, {"src": "謝謝", "tgt": "Thanks"}], "carry": ""},
                                      {"sentences": [{"src": "謝謝。", "tgt": "Thank you."}], "carry": ""}])
        events = QualityPassTest.run_pass(self, service, tone(7) + silence(0.5) + tone(7) + silence(0.5) + tone(2))
        self.assertEqual([s["target"] for event in events for s in event["quality"]["sentences"]],
                         ["We go live next week.", "Please check the test results first.", "Thank you."])

    def test_the_instructions_forbid_deleting_content(self):
        prompt = quality_pass.system_prompt("en", "zh")
        self.assertIn("never delete, summarize, shorten or skip a sentence", prompt)
        self.assertIn("every sentence of CARRY", prompt)


class MaiUsageTests(AccountTestCase):
    """mai-usage: the audio sent to MAI is recorded by date and purpose, and administrators see the cost."""

    def rows(self):
        return dict(self.query("SELECT purpose, sum(seconds) FROM mai_usage GROUP BY purpose"))

    def test_entered_by_hand_and_invalid_entries(self):
        asyncio.run(mai_usage.record("bench", 5400))
        asyncio.run(mai_usage.record("bench", 600))
        self.assertEqual(self.rows(), {"bench": 6000})
        for purpose, seconds in (("bench", -5), ("bench", 0), ("bench", float("inf")), ("bench", float("nan")), ("Bench Run", 60), ("", 60), ("x" * 41, 60)):
            with self.assertRaises(ValueError):
                asyncio.run(mai_usage.record(purpose, seconds))
        self.assertEqual(mai_usage.main(["add", "-5", "bench"]), 2)
        self.assertEqual(mai_usage.main(["add", "60", "Bench Run"]), 2)
        self.assertEqual(mai_usage.main(["add", "inf", "bench"]), 2)
        self.assertEqual(self.rows(), {"bench": 6000})
        self.assertEqual(self.query("SELECT count(*) FROM mai_usage")[0][0], 1)   # one row per date and purpose

    def test_the_command_adds_and_prints(self):
        with patch("builtins.print") as printed:
            self.assertEqual(mai_usage.main(["add", "5400", "bench"]), 0)
        self.assertEqual(self.rows(), {"bench": 5400})
        self.assertIn("1.50 h of audio sent to MAI, about 0.81 USD of a 50.00 USD budget (ok)", printed.call_args[0][0])

    def test_a_meter_writes_every_five_minutes_and_at_the_end(self):
        async def go():
            meter = mai_usage.Meter("live")
            for _ in range(301):
                meter.count(32000)
            await asyncio.gather(*mai_usage._writing)
            first = self.rows().get("live", 0)
            await meter.finish()
            return first
        self.assertEqual((asyncio.run(go()), self.rows()), (300, {"live": 301}))

    def test_a_failed_write_is_logged_and_nothing_is_raised(self):
        with patch("mai_usage.record", side_effect=OSError("database down")), self.assertLogs("uvicorn.error", level="WARNING") as logs:
            asyncio.run(mai_usage.add("live", 2))
        self.assertIn("MAI usage not recorded (2 s, live): OSError", logs.output[0])

    def test_cost_and_state_follow_the_example_table(self):
        for seconds, price, budget, usd, state in ((0, 0.54, 50, 0, "ok"), (5400, 0.54, 50, 0.81, "ok"), (266667, 0.54, 50, 40, "near"),
                                                   (333334, 0.54, 50, 50, "over"), (7200, 1, 2, 2, "over"),
                                                   (333306, 0.54, 50, 50, "over")):   # 49.9959 USD is shown as 50.00: the state says the same
            self.query("DELETE FROM mai_usage RETURNING 1")
            with patch.multiple("mai_usage", USD_PER_HOUR=price, BUDGET_USD=budget):
                if seconds:
                    asyncio.run(mai_usage.record("bench", seconds))
                total = asyncio.run(mai_usage.summary())
            self.assertEqual((total["usd"], total["state"], total["budgetUsd"], total["usdPerHour"]), (usd, state, budget, price), seconds)

    def test_only_administrators_see_the_usage(self):
        asyncio.run(mai_usage.record("bench", 5400))
        asyncio.run(mai_usage.record("live", 1800))
        self.assertEqual(self.signed_in("alice").get("/api/admin/mai-usage").status_code, 403)
        usage = self.signed_in("admin").get("/api/admin/mai-usage").json()
        self.assertEqual((usage["seconds"], usage["usd"], usage["state"], usage["byPurpose"]), (7200, 1.08, "ok", {"bench": 5400, "live": 1800}))

    def test_near_and_over_the_budget_are_each_logged_once(self):
        with patch.multiple("mai_usage", USD_PER_HOUR=1, BUDGET_USD=2, _told=set()), self.assertLogs("uvicorn.error", level="WARNING") as logs:
            for _ in range(5):
                asyncio.run(mai_usage.add("live", 2880))   # 0.8, 1.6 (80%), 2.4 (over), 3.2, 4.0 USD
        self.assertEqual(len(logs.output), 2)
        self.assertIn("MAI usage is at 80% of the budget: about 1.60 USD of 2.00 USD", logs.output[0])
        self.assertIn("MAI usage is at or over the budget: about 2.40 USD of 2.00 USD", logs.output[1])

    def test_a_live_mai_stream_records_what_it_sent_and_the_budget_stops_nothing(self):
        asyncio.run(mai_usage.record("bench", 400000))   # 60 USD: over the budget
        session = FakeMai(["你好"])

        class Browser(FakeBrowser):
            arriving = [{"bytes": tone(1)}, {"bytes": tone(1)}, {"text": "YOUDAO_ONETIME_ASR_STREAM_EOS"}]

            async def receive(self):
                return self.arriving.pop(0) if self.arriving else {"type": "websocket.disconnect"}

        async def connect(*_, **__):
            return session

        async def go():
            with patch("mai_asr.websockets.connect", connect), patch("mai_asr.MAI_ENDPOINT", "https://res.example.com/x"), patch("mai_asr.MAI_KEY", "k"):
                await mai_asr.MaiBridge(Browser(), "en", TranscriptDisplay("en", "")).run()
            await asyncio.gather(*mai_usage._writing)
        asyncio.run(go())
        self.assertEqual(self.rows(), {"bench": 400000, "live": 2})
        self.assertEqual(session.audio(), tone(1) + tone(1))   # recognized as usual

    def test_a_stream_goes_on_when_the_usage_cannot_be_written(self):
        session = FakeMai(["新的系統"])
        with patch("mai_usage.record", side_effect=OSError("database down")), self.assertLogs("uvicorn.error", level="WARNING") as logs:
            service, events = QualityEngineTest.run_mai(self, [session], [tone(3)], [{"sentences": [{"src": "新的系統。", "tgt": "The new system."}], "carry": ""}])
        self.assertEqual(session.audio(), tone(3))                                                   # MAI heard all of it
        self.assertEqual([s["target"] for s in events[-1]["quality"]["sentences"]], ["The new system."])
        self.assertTrue(any("MAI usage not recorded (3 s, quality): OSError" in line for line in logs.output))

    def test_the_quality_pass_records_what_mai_heard(self):
        session = FakeMai(["新的系統"])
        QualityEngineTest.run_mai(self, [session], [tone(3)], [{"sentences": [{"src": "新的系統。", "tgt": "The new system."}], "carry": ""}])
        self.assertEqual(self.rows(), {"quality": 3})


class QualityStreamTests(AccountTestCase):
    """quality-pass in the gateway: opt-in, hidden until configured, final event before the close."""

    def configured(self, service):
        for name, value in (("URL", "http://quality.test/v1"), ("ASR_MODEL", "asr"), ("MODEL", "text"),
                            ("new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(service)))):
            fake = patch(f"quality_pass.{name}", value)
            fake.start()
            self.addCleanup(fake.stop)

    def stream(self, header):
        audio = tone(3)
        messages = []
        with patch("server.websockets.connect", side_effect=lambda *a, **k: AudioAfter(len(audio))):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"mode": "translate", "language": "zh", **header})
                websocket.send_bytes(audio)
                with contextlib.suppress(WebSocketDisconnect):
                    while True:
                        message = websocket.receive_json()
                        if not {"record", "saved"} & message.keys():   # 即時翻譯's own record (tested on its own)
                            messages.append(message)
        return messages

    def test_config_reports_quality_only_when_both_models_are_set(self):
        client = self.signed_in("alice")
        with patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", ""):
            self.assertIs(client.get("/api/config").json()["quality"], False)
        with patch("quality_pass.URL", "http://quality.test/v1"), patch("quality_pass.ASR_MODEL", "asr"), patch("quality_pass.MODEL", "text"):
            self.assertIs(client.get("/api/config").json()["quality"], True)

    def test_not_chosen_means_no_external_request_and_the_same_events(self):
        service = FakeQualityService(["這個會議"], [])
        self.configured(service)
        messages = self.stream({})
        self.assertEqual((service.transcriptions, service.chats), ([], []))
        self.assertFalse(any("quality" in message for message in messages))
        self.assertFalse(any("audioMs" in message for message in messages))   # 即時翻譯 without it: no clock, as before
        self.assertEqual(messages, self.stream({"quality": "yes"}))   # only a real true turns it on

    def test_not_configured_ignores_the_header(self):
        with patch("quality_pass.MODEL", ""), patch("quality_pass.new_client") as client:
            messages = self.stream({"quality": True})
        client.assert_not_called()
        self.assertFalse(any("quality" in message for message in messages))

    def test_chosen_gets_quality_events_and_the_last_one_is_final(self):
        service = FakeQualityService(["這個會議"], [{"sentences": [{"src": "這個會議。", "tgt": "This meeting."}], "carry": ""}])
        self.configured(service)
        messages = self.stream({"quality": True, "target": "en"})
        events = [message["quality"] for message in messages if "quality" in message]
        self.assertTrue(events)
        self.assertEqual([event["final"] for event in events], [False] * (len(events) - 1) + [True])
        self.assertEqual([(s["source"], s["target"]) for s in events[-1]["sentences"]], [("這個會議。", "This meeting.")])
        self.assertIn("quality", messages[-1])                        # nothing after the final event but the close
        self.assertTrue(any(message.get("displayText") == "這個會議" for message in messages))   # the live text is unchanged
        # 即時翻譯 has no recording clock; with the quality pass on, live events carry its audio clock instead.
        live = [message for message in messages if "quality" not in message and message.get("msg")]
        self.assertTrue(live and all(message["audioMs"] == 3000 for message in live), live)


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

    def test_page_redirect_carries_the_requested_path(self):
        response = TestClient(app).get("/meetings/abc/minutes?item=50", follow_redirects=False)
        self.assertEqual((response.status_code, response.headers["location"]),
                         (303, "/login?next=%2Fmeetings%2Fabc%2Fminutes%3Fitem%3D50"))
        self.assertEqual(TestClient(app).get("/?x=1", follow_redirects=False).headers["location"], "/login?next=%2F%3Fx%3D1")
        fits, too_long = "/meetings?" + "a" * 1990, "/meetings?" + "a" * 1991   # 2000 and 2001 characters
        self.assertTrue(TestClient(app).get(fits, follow_redirects=False).headers["location"].startswith("/login?next="))
        self.assertEqual(TestClient(app).get(too_long, follow_redirects=False).headers["location"], "/login")
        # An encoded ? stays encoded: the page asked for is the page returned to.
        self.assertEqual(TestClient(app).get("/meetings/a%3Fb?x=1", follow_redirects=False).headers["location"],
                         "/login?next=%2Fmeetings%2Fa%253Fb%3Fx%3D1")

    def test_no_page_claims_on_device_processing(self):
        for page in (self.signed_in("alice").get("/").text, TestClient(app).get("/login").text,
                     TestClient(app).get("/assets/app.js").text):
            for claim in ("不離開你的設備", "端對端本機處理", "output 資料夾"):
                self.assertNotIn(claim, page)

    def test_sign_in_page_names_no_real_account(self):
        page = TestClient(app).get("/login").text
        self.assertIn('placeholder="公司帳號"', page)
        self.assertNotIn("myyang", page)

    def test_public_paths_stay_open(self):
        client = TestClient(app)
        self.assertEqual(client.get("/api/health").status_code, 200)
        self.assertIn("登入", client.get("/login").text)
        self.assertEqual(client.get("/assets/login.html").status_code, 200)
        icon = client.get("/favicon.ico")   # the browser tab icon (site-favicon), fetched before any sign-in
        self.assertEqual((icon.status_code, icon.headers["content-type"]), (200, "image/x-icon"))
        self.assertTrue(icon.content.startswith(b"\x00\x00\x01\x00"))

    def test_every_other_route_requires_a_session(self):
        public = {"/login", "/api/login", "/api/logout", "/api/health", "/favicon.ico"}
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



class AvatarTests(AccountTestCase):
    """member-avatars: photos keyed by account, set by administrators, read by anyone signed in."""
    PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 2000
    JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 100
    WEBP = b"RIFF\0\0\0\0WEBPVP8 " + b"\0" * (20 * 1024)

    def put(self, client, username, body, content_type):
        return client.put(f"/api/admin/users/{username}/avatar", content=body, headers={"content-type": content_type})

    def test_administrator_sets_reads_and_removes_a_photo(self):
        admin = self.signed_in("admin")
        response = self.put(admin, " Bob ", self.PNG, "image/png")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["avatarUrl"].startswith("/api/users/bob/avatar?v="))
        photo = self.signed_in("alice").get("/api/users/bob/avatar")
        self.assertEqual((photo.status_code, photo.content, photo.headers["content-type"]), (200, self.PNG, "image/png"))
        self.assertEqual(photo.headers["x-content-type-options"], "nosniff")
        self.assertIn("immutable", photo.headers["cache-control"])
        self.assertEqual(self.put(admin, "bob", self.WEBP, "image/webp").status_code, 200)
        self.assertEqual(self.signed_in("alice").get("/api/users/bob/avatar").content, self.WEBP)
        self.assertEqual(admin.delete("/api/admin/users/bob/avatar").status_code, 204)
        self.assertEqual(self.signed_in("alice").get("/api/users/bob/avatar").status_code, 404)
        self.assertEqual(admin.delete("/api/admin/users/bob/avatar").status_code, 404)

    def test_only_administrators_change_photos(self):
        alice = self.signed_in("alice")
        self.assertEqual(self.put(alice, "alice", self.PNG, "image/png").status_code, 403)
        self.put(self.signed_in("admin"), "alice", self.PNG, "image/png")
        self.assertEqual(alice.delete("/api/admin/users/alice/avatar").status_code, 403)
        self.assertEqual(self.query("SELECT count(*) FROM user_avatars"), [(1,)])

    def test_unsafe_or_oversized_images_are_refused(self):
        admin = self.signed_in("admin")
        cases = [(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", 415), (self.JPEG, "image/png", 415),
                 (b"\xff\xd8\xff" + b"\0" * (300 * 1024), "image/jpeg", 413), (b"", "image/png", 422),
                 (self.PNG, "text/html", 415)]
        for body, content_type, status in cases:
            self.assertEqual(self.put(admin, "bob", body, content_type).status_code, status, content_type)
        self.assertEqual(self.query("SELECT count(*) FROM user_avatars"), [(0,)])
        self.assertEqual(self.put(admin, "bob", self.JPEG, "image/jpeg").status_code, 200)

    def test_people_lists_carry_the_photo_address(self):
        admin = self.signed_in("admin")
        team = admin.post("/api/admin/teams", json={"name": "研發"}).json()
        for name in ("alice", "bob"):
            admin.post(f"/api/admin/teams/{team['id']}/members", json={"username": name})
        url = self.put(admin, "bob", self.PNG, "image/png").json()["avatarUrl"]
        members = {m["username"]: m["avatarUrl"] for m in admin.get("/api/admin/teams").json()[0]["members"]}
        self.assertEqual(members, {"alice": None, "bob": url})
        people = {p["username"]: p["avatarUrl"] for p in self.signed_in("alice").get("/api/actions").json()["people"]}
        self.assertEqual(people, {"alice": None, "bob": url})
        admin.delete("/api/admin/users/bob/avatar")
        people = {p["username"]: p["avatarUrl"] for p in self.signed_in("alice").get("/api/actions").json()["people"]}
        self.assertIsNone(people["bob"])

    def test_everyone_changes_their_own_photo(self):
        alice = self.signed_in("alice")
        self.assertIsNone(alice.get("/api/me").json()["avatarUrl"])
        response = alice.put("/api/me/avatar", content=self.PNG, headers={"content-type": "image/png"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "alice")
        self.assertEqual(alice.get("/api/me").json()["avatarUrl"], response.json()["avatarUrl"])
        self.assertEqual(self.signed_in("bob").get("/api/users/alice/avatar").content, self.PNG)
        self.assertEqual(self.query("SELECT updated_by FROM user_avatars"), [("alice",)])
        for body, content_type, status in [(b"<svg/>", "image/svg+xml", 415), (self.JPEG, "image/png", 415),
                                           (b"\xff\xd8\xff" + b"\0" * (300 * 1024), "image/jpeg", 413)]:
            self.assertEqual(alice.put("/api/me/avatar", content=body, headers={"content-type": content_type}).status_code, status, content_type)
        self.assertEqual(self.put(alice, "bob", self.PNG, "image/png").status_code, 403)
        self.assertEqual(alice.delete("/api/me/avatar").status_code, 204)
        self.assertIsNone(alice.get("/api/me").json()["avatarUrl"])
        self.assertEqual(alice.delete("/api/me/avatar").status_code, 404)
        self.assertEqual(TestClient(app).put("/api/me/avatar", content=self.PNG, headers={"content-type": "image/png"}).status_code, 401)

    def test_signed_out_cannot_read_photos(self):
        self.put(self.signed_in("admin"), "bob", self.PNG, "image/png")
        self.assertEqual(TestClient(app).get("/api/users/bob/avatar").status_code, 401)


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
        self.assertEqual(listed[0]["members"], [{"username": "bob", "displayName": "", "signedIn": False, "avatarUrl": None}])
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

    def test_translate_session_is_saved_as_a_record_not_a_meeting(self):
        # live-translation: a user in no team translates a video; it becomes the user's own record, not a meeting.
        upstream = AudioUntilEos(32000)
        self.ldap.add("dave", "pw-dave")   # in no team at all
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("dave").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"mode": "translate", "language": "zh", "target": "en"})
                websocket.send_bytes(b"\x00\x01" * 16000)   # one second at 16 kHz
                events = [websocket.receive_json(), websocket.receive_json()]
                token = next(e["record"] for e in events if "record" in e)
                shown = next(e for e in events if "displayText" in e)
                # The page sends its translation every 30 seconds while the session runs.
                self.assertEqual(self.signed_in("bob").put(f"/api/interpret/live/{token}/translation", json={"text": "x"}).status_code, 404)
                self.assertEqual(self.signed_in("dave").put(f"/api/interpret/live/{token}/translation", json={"text": "This meeting"}).status_code, 200)
                websocket.send_text("YOUDAO_ONETIME_ASR_STREAM_EOS")
                saved = websocket.receive_json()["saved"]
        self.assertEqual(shown["displayText"], "這個會議")
        self.assertNotIn("audioMs", shown)
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])
        self.assertFalse((self.output / "teams").exists())   # no audio.wav, no meeting folder
        self.assertIs(json.loads(upstream.sent[0])["retain"], False)   # the ASR request log keeps no text either
        folder = self.output / "interpret" / "dave" / saved
        data = json.loads((folder / "session.json").read_text(encoding="utf-8"))
        self.assertEqual((data["kind"], data["sourceText"], data["translation"], data["inputSeconds"], data["usd"]),
                         ("translate", "這個會議", "This meeting", 1.0, 0.0))
        with wave.open(str(folder / "input.wav")) as audio:
            self.assertEqual((audio.getframerate(), audio.getnframes()), (16000, 16000))
        self.assertFalse((folder / "output.wav").exists())
        self.assertEqual(json.loads((folder / "bars.json").read_text())["output"], [])
        self.assertEqual(self.signed_in("dave").put(f"/api/interpret/live/{token}/translation", json={"text": "x"}).status_code, 404)   # over

    def test_a_translate_session_stopped_by_its_limit_is_saved_first(self):
        # The stream limit closes the connection; the page still learns the record's id before it does.
        with patch("server.websockets.connect", return_value=AudioUntilEos(10 ** 9)), patch("stream_limits.max_stream_bytes", return_value=3200):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"mode": "translate", "language": "zh", "target": "en"})
                websocket.send_bytes(b"\x00\x01" * 1600)
                websocket.send_bytes(b"\x00\x01" * 1600)   # over the limit
                events = []
                with self.assertRaises(WebSocketDisconnect) as closed:
                    while True:
                        events.append(websocket.receive_json())
        self.assertEqual(closed.exception.code, 4413)
        saved = [e["saved"] for e in events if "saved" in e]
        self.assertEqual(len(saved), 1)
        self.assertTrue((self.output / "interpret" / "alice" / saved[0] / "input.wav").is_file())

    def test_a_closed_tab_keeps_the_last_translation_sent(self):
        upstream = AudioUntilEos(3200)
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"mode": "translate", "language": "zh", "target": "en"})
                websocket.send_bytes(b"\x00\x01" * 1600)
                token = next(e["record"] for e in (websocket.receive_json(), websocket.receive_json()) if "record" in e)
                self.assertEqual(self.signed_in("alice").put(f"/api/interpret/live/{token}/translation", json={"text": "This meeting"}).status_code, 200)
            # the tab went away without the end of the stream
        for _ in range(50):
            saved = [p for p in (self.output / "interpret" / "alice").iterdir() if not p.name.startswith(".")]
            if saved:
                break
            time.sleep(0.05)
        data = json.loads((saved[0] / "session.json").read_text(encoding="utf-8"))
        self.assertEqual((data["kind"], data["translation"], data["sourceText"]), ("translate", "This meeting", "這個會議"))

    def test_interpret_source_saves_nothing(self):
        upstream = AudioAfter(3200)
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"mode": "interpret", "language": "zh"})
                websocket.send_bytes(b"\x00\x01" * 1600)
                event = websocket.receive_json()
                with contextlib.suppress(WebSocketDisconnect):
                    while True:
                        self.assertNotIn("saved", websocket.receive_json())
        self.assertEqual(event["displayText"], "這個會議")
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])
        self.assertEqual(list(self.output.rglob("*")), [])

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


def fake_vector(text: str) -> list[float]:
    """A deterministic stand-in for an embedding: character counts hashed into 64 dimensions."""
    vector = [0.001] * 64
    for ch in text:
        vector[ord(ch) % 64] += 1
    return vector


class QaTestCase(ReviewTestCase):
    """meeting-qa: alice and bob in 研發部, carol in 業務部; a fake embedding service records what it was given."""

    def setUp(self):
        ReviewTestCase.setUp(self)
        self.ldap.add("carol", "pw-carol")
        self.rd, self.sales = self.team("研發部", "alice", "bob"), self.team("業務部", "carol")
        self.alice, self.carol = self.signed_in("alice"), self.signed_in("carol")
        self.embedded: list[str] = []
        for target, value in (("qa.embed", self.fake_embed), ("qa.EMBED_MODEL", "fake-model.gguf"), ("qa.EMBED_URL", "")):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def fake_embed(self, texts, timeout=None):
        self.embedded += [t for t in texts if t != qa.PROBE]
        return [fake_vector(t) for t in texts]

    meeting = SearchTests.meeting
    segments = SearchTests.segments
    item = SearchTests.item

    def index(self):
        self.embedded = []
        return asyncio.run(qa.index_pending(1000))

    def vectors(self):
        return {(str(m) if m else None, s, i) for m, s, i in self.query("SELECT meeting_id, seq, item_id FROM passage_vectors")}


class QaIndexTests(QaTestCase):
    def test_indexes_segments_and_items_then_only_what_changed(self):
        m = self.meeting("報價會議")
        self.segments(m, *[(f"第{n}段內容", f"segment {n}") for n in range(1, 8)])
        kept, rejected = self.item(m, "寄出報價單"), self.item(m, "不要的條目", state="rejected")
        self.assertEqual(self.index(), 8)
        self.assertEqual(self.vectors(), {(m, n, None) for n in range(1, 8)} | {(None, None, kept)})
        self.assertIn("第3段內容\nsegment 3", self.embedded)          # the segment and its translation, nothing else
        self.assertIn("待辦：寄出報價單", self.embedded)
        self.assertEqual(self.index(), 0)
        # spec scenario "A corrected segment is re-indexed": only segment 5.
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE segments SET source = '第5段改過' WHERE meeting_id = %s AND seq = 5", (m,))
        self.assertEqual(self.index(), 1)
        self.assertEqual(self.embedded, ["第5段改過\nsegment 5"])
        # A rejected item loses its embedding; a deleted meeting takes its embeddings along.
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE minute_items SET state = 'rejected' WHERE id = %s", (kept,))
        self.index()
        self.assertNotIn((None, None, kept), self.vectors())
        self.assertNotIn(rejected, [i for _, _, i in self.vectors()])
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("DELETE FROM meetings WHERE id = %s", (m,))
        self.assertEqual(self.vectors(), set())

    def test_status_counts_the_users_teams_and_a_model_change_starts_over(self):
        mine, theirs = self.meeting("研發"), self.meeting("業務", team=self.sales, client=self.carol)
        self.segments(mine, ("一", ""), ("二", ""))
        self.segments(theirs, ("三", ""))
        self.item(mine, "待辦一")
        status = self.alice.get("/api/ask/status").json()
        self.assertEqual((status["indexed"], status["total"], status["model"], status["embedReachable"]), (0, 3, "fake-model.gguf", False))
        self.index()
        self.assertEqual(self.alice.get("/api/ask/status").json()["indexed"], 3)
        self.assertEqual(self.alice.get(f"/api/ask/status?team={self.sales}").status_code, 404)
        # spec scenario "Changing the model"
        with patch("qa.EMBED_MODEL", "other-model.gguf"):
            self.assertEqual(self.alice.get("/api/ask/status").json()["indexed"], 0)
            self.assertEqual(self.index(), 4)
            self.assertEqual(self.alice.get("/api/ask/status").json()["indexed"], 3)
            self.assertEqual({r[0] for r in self.query("SELECT DISTINCT model FROM passage_vectors")}, {"other-model.gguf"})

    def test_a_passage_the_service_refuses_does_not_hold_up_the_others(self):
        m = self.meeting("研發")
        self.segments(m, ("正常一", ""), ("壞段落", ""), ("正常二", ""))

        async def picky(texts, timeout=None):
            if "壞段落" in texts:
                raise httpx.HTTPStatusError("500", request=httpx.Request("POST", "http://embed"), response=httpx.Response(500))
            return [fake_vector(t) for t in texts]

        with patch("qa.embed", picky), patch("qa.refused", set()), self.assertLogs("uvicorn.error", "WARNING"):
            self.assertEqual(self.index(), 3)
            self.assertEqual(self.vectors(), {(m, 1, None), (m, 3, None)})
            self.assertEqual(self.index(), 0)                       # skipped, not retried every round
            with psycopg.connect(TEST_DATABASE_URL) as conn:
                conn.execute("UPDATE segments SET source = '修好了' WHERE meeting_id = %s AND seq = 2", (m,))
            self.index()
        self.assertIn((m, 2, None), self.vectors())

    def test_another_model_under_the_same_name_is_rebuilt_and_not_compared(self):
        m = self.meeting("研發")
        self.segments(m, ("合約寄出", ""), ("報價", ""))
        self.index()

        async def smaller(texts, timeout=None):
            return [fake_vector(t)[:32] for t in texts]

        with patch("qa.embed", smaller), patch("minutes.configured", lambda: True), \
                patch("minutes.call_model", lambda messages, timeout=None: asyncio.sleep(0, '{"answer": "已寄出 [1]。", "notFound": false}')):
            response = self.alice.post("/api/ask", json={"question": "合約寄出了嗎"})   # 64-size vectors are not compared with a 32-size question
            self.assertEqual((response.status_code, response.json()["degraded"]), (200, False))
            self.index()
        self.assertEqual({r[0] for r in self.query("SELECT vector_dims(embedding) FROM passage_vectors")}, {32})

    def test_keywords_rank_rare_words_first(self):
        m = self.meeting("研發")
        self.segments(m, ("預算進度一", ""), ("預算進度二", ""), ("預算火箭", ""), ("人手不夠", ""), ("版本 v3.2 上線", ""))

        async def ranked(question):
            async with db.connect() as conn:
                meetings_sql, items_sql, params = await search.scope(conn, auth.User("alice", "alice", False), None, None, None, None)
                return await qa.keyword_candidates(conn, meetings_sql, items_sql, params, qa.query_terms(question))

        # Among passages with two terms, the rare word decides; one shared everyday word is not enough, a latin term is.
        self.assertEqual(asyncio.run(ranked("預算 進度 火箭"))[0], ("s", m, 3))
        self.assertEqual(asyncio.run(ranked("包裝材料不夠用")), [])
        self.assertEqual(asyncio.run(ranked("v3.2 什麼時候")), [("s", m, 5)])
        self.assertEqual(asyncio.run(ranked("火箭")), [("s", m, 3)])                 # a one-term question needs that term

    def test_a_failing_embedding_service_is_retried_later_and_harms_nothing_else(self):
        self.segments(self.meeting("研發"), ("合約", ""))

        async def down(texts, timeout=None):
            raise httpx.ConnectError("connection refused")

        async def stop(seconds):
            self.assertEqual(seconds, qa.RETRY_AFTER)
            raise asyncio.CancelledError

        with patch("qa.embed", down), patch("qa.asyncio.sleep", stop), self.assertLogs("uvicorn.error", "WARNING"):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(qa.indexer())
        self.assertEqual(self.alice.get("/api/search?q=合約").status_code, 200)


class QaAskTests(QaTestCase):
    def setUp(self):
        QaTestCase.setUp(self)
        self.m = self.meeting("客戶報價討論", "2026-11-03")
        self.segments(self.m, ("今天先確認交期。", "Confirm the delivery date first."), ("報價先壓在八五折，下週三前回覆對方。", "Hold the quote at 85%."),
                      ("包裝改用紙箱。", "Switch to cardboard."))
        self.action = self.item(self.m, "下週三前回覆客戶報價")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE minute_items SET evidence = '{2}' WHERE id = %s", (self.action,))
        self.index()
        self.calls = []
        patcher = patch("minutes.configured", lambda: True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def ask(self, question, reply='{"answer": "", "notFound": true}', client=None, status=200, **filters):
        async def model(messages, timeout=None):
            self.calls.append(messages)
            return reply
        with patch("minutes.call_model", model):
            response = (client or self.alice).post("/api/ask", json={"question": question, **filters})
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def test_citations_are_checked(self):
        # spec example "Citations checked"
        result = self.ask("上次跟客戶談價格的結論是什麼", '{"answer": "報價維持八五折 [2]。", "notFound": false}')
        self.assertEqual((result["answer"], [s["n"] for s in result["sources"]], result["notFound"]), ("報價維持八五折 [2]。", [2], False))
        evidence = self.calls[-1][1]["content"]
        cited = result["sources"][0]
        with patch("qa.fuse", lambda *r, k=60: [("s", self.m, 1), ("s", self.m, 2)]):   # spec scenario "A paraphrased question"
            paraphrased = self.ask("上次跟客戶談價格的結論是什麼", '{"answer": "報價先壓在八五折，下週三前回覆 [2]。", "notFound": false}')
        self.assertEqual((paraphrased["sources"][0]["text"], paraphrased["sources"][0]["href"]),
                         ("報價先壓在八五折，下週三前回覆對方。", f"/meetings/{self.m}#seg-2"))
        block = evidence.split("\n\n[2] ")[1].split("\n\n[")[0]
        self.assertIn(("＞ " if cited["type"] == "segment" else "：") + cited["text"], block)   # source 2 is what the model saw as [2]
        self.assertRegex(cited["href"], rf"^/meetings/{self.m}(#seg-\d+|/minutes#item-\d+)$")
        self.assertIn("問題：上次跟客戶談價格的結論是什麼", evidence)
        self.assertEqual(len(re.findall(r"^\[\d\] ", evidence, re.M)), 4)        # 3 segments and 1 item, all within the top 8
        result = self.ask("報價", '{"answer": "報價維持八五折 [2][9]。", "notFound": false}')
        self.assertEqual((result["answer"], [s["n"] for s in result["sources"]]), ("報價維持八五折 [2]。", [2]))
        self.assertTrue(self.ask("報價", '{"answer": "報價維持八五折。", "notFound": false}')["notFound"])
        for reply, answer in [  # qa-cited-sentences: every sentence must carry a citation
            ("報價維持八五折 [2]。下週三回覆對方。", "報價維持八五折 [2]。"),
            ("結論如下：\n- 八五折 [2]\n- 下週三回覆", "- 八五折 [2]"),
            ("報價維持八五折。[2]", "報價維持八五折。[2]"),
            ("客戶說：「先壓八五折。」[2]下週回覆。", "客戶說：「先壓八五折。」[2]"),   # end mark inside the quote
            ("- 八五折 [2]\n- 下週回覆\n- 先寄報價 [2]", "- 八五折 [2]\n- 先寄報價 [2]"),   # no blank line left behind
        ]:
            with self.subTest(reply=reply):
                result = self.ask("報價", json.dumps({"answer": reply, "notFound": False}, ensure_ascii=False))
                self.assertEqual((result["answer"], [s["n"] for s in result["sources"]]), (answer, [2]))
        self.assertTrue(self.ask("報價", '{"notFound": true}')["notFound"])
        self.assertIsNone(self.ask("報價", "不是 JSON 也沒有出處")["answer"])
        calls = len(self.calls)
        nothing = self.ask("報價", team=self.rd, **{"from": "2026-12-01"})          # no candidates: the model is not called
        self.assertEqual((nothing["notFound"], nothing["sources"], len(self.calls)), (True, [], calls))

    def test_sources_link_to_the_segment_or_item(self):
        reply = json.dumps({"answer": "報價維持八五折 [1]，下週三前回覆 [2]。", "notFound": False}, ensure_ascii=False)
        with patch("qa.fuse", lambda *r, k=60: [("s", self.m, 2), ("i", self.action)]):
            result = self.ask("價格結論", reply)
        segment, item = result["sources"]
        self.assertEqual((segment["type"], segment["href"], segment["startMs"], segment["prev"], segment["next"]),
                         ("segment", f"/meetings/{self.m}#seg-2", 2000, "今天先確認交期。", "包裝改用紙箱。"))
        self.assertEqual((item["type"], item["href"], item["kind"], item["evidence"]),
                         ("item", f"/meetings/{self.m}/minutes#item-{self.action}", "action", [2]))
        evidence = self.calls[-1][1]["content"]
        self.assertIn("＞ 報價先壓在八五折，下週三前回覆對方。（譯文：Hold the quote at 85%.）", evidence)
        self.assertIn("紀要・待辦：下週三前回覆客戶報價", evidence)

    def test_other_teams_stay_invisible(self):
        theirs = self.meeting("業務", team=self.sales, client=self.carol)
        self.segments(theirs, ("火星基地的預算已核准。", ""))
        self.index()
        self.ask("火星基地的預算", '{"answer": "預算已核准 [1]。", "notFound": false}')
        self.assertNotIn("火星基地", self.calls[-1][1]["content"].split("資料：")[1])
        self.ask("火星", client=self.carol)
        self.assertIn("火星基地", self.calls[-1][1]["content"].split("資料：")[1])
        self.ask("報價", team=self.sales, status=404)

    def test_embedding_service_down_uses_keywords(self):
        async def down(texts, timeout=None):
            raise httpx.ConnectError("connection refused")
        self.segments(self.meeting("寄件", "2026-11-04"), ("合約今天已經寄出了。", ""))
        with patch("qa.embed", down), self.assertLogs("uvicorn.error", "WARNING"):
            result = self.ask("合約 寄出 了嗎", '{"answer": "合約已寄出 [1]。", "notFound": false}')   # spec scenario "Embedding service down"
        self.assertTrue(result["degraded"])
        self.assertEqual(result["sources"][0]["text"], "合約今天已經寄出了。")

    def test_a_failing_model_is_502_and_an_unseen_series_404(self):
        async def broken(messages, timeout=None):
            raise httpx.ConnectError("connection refused")
        with patch("minutes.call_model", broken), self.assertLogs("uvicorn.error", "WARNING"):
            response = self.alice.post("/api/ask", json={"question": "報價"})
        self.assertEqual((response.status_code, response.json()["detail"]), (502, "暫時無法回答，請稍後再試"))
        theirs = self.carol.post(f"/api/teams/{self.sales}/series", json={"name": "業務週會"}).json()["id"]
        self.ask("報價", series=theirs, status=404)

    def test_question_limits_and_configuration(self):
        self.assertEqual(self.ask("   ", status=422)["detail"], "請輸入問題")
        self.ask("問" * 300)
        self.assertEqual(self.ask("問" * 301, status=422)["detail"], "問題最多 300 個字")
        with patch("minutes.configured", lambda: False):
            self.assertEqual(self.ask("報價", status=503)["detail"], "問答功能尚未設定")
        self.assertEqual(TestClient(app).post("/api/ask", json={"question": "報價"}).status_code, 401)

    def test_query_terms_and_fusion(self):
        self.assertEqual(qa.query_terms("上次跟客戶談 MiniMax 價格的結論是什麼？"),
                         ["minimax", "上次", "次跟", "跟客", "客戶", "戶談", "價格", "結論"])
        self.assertEqual(qa.query_terms("C++ 與 v2.1 的差異"), ["c++", "v2.1", "差異"])
        self.assertEqual(qa.query_terms("When will version 3.2 be released?"), ["version", "3.2", "released"])
        self.assertEqual(qa.fuse([("a",), ("b",)], [("b",), ("c",)]), [("b",), ("a",), ("c",)])


SERVICE_OUTPUT = """audio: data/x.wav
model: /models/MOSS-Transcribe-Diarize-Q8_0.gguf -> ok
segments: 4
  [   0.48 ->    1.66] S2: 好那就這樣
  [   1.80 ->    5.20] S1: 我们下周五前把报价单寄出去吧
  [   5.40 ->    6.00] S2: 嗯对
  [   6.10 ->   12.00] S3: 下一个议题
"""


class DiarizeRulesTests(unittest.TestCase):
    def test_parse_output_renumbers_speakers_by_first_appearance(self):
        turns = diarize.parse_output(SERVICE_OUTPUT)
        self.assertEqual(turns[0], diarize.Turn(480, 1660, 1, "好那就這樣"))
        self.assertEqual([t.label for t in turns], [1, 2, 1, 3])
        self.assertEqual(turns[1].text, "我们下周五前把报价单寄出去吧")
        self.assertEqual(diarize.parse_output("run: ok\ntext: 你好\n"), [])

    def test_segment_speaker_examples(self):
        """The spec's example table: text first, then the span moved 1 s earlier, else none."""
        T = diarize.Turn
        quote = [T(0, 6000, 1, "好那就這樣"), T(6000, 9000, 2, "我们下周五前把报价单寄出去吧")]
        self.assertEqual(diarize.speaker_of(4000, 7000, "我們下週五前把報價單寄出去", quote), 2)    # shifted 3-6 s: S1 3.0 s, S2 0 s
        self.assertEqual(diarize.speaker_of(1000, 1800, "嗯", [T(0, 2000, 1, "嗯对")]), 1)       # one character: time decides
        other = [T(0, 1400, 1, "前面的话"), T(1400, 10000, 3, "后面"), T(10000, 12000, 2, "下一个议题")]
        self.assertEqual(diarize.speaker_of(2000, 4500, "這個先這樣", other), 3)                   # shifted 1-3.5 s: S1 0.4 s, S3 2.1 s
        self.assertIsNone(diarize.speaker_of(60000, 61000, "好", other))
        # Text beats time: the segment was stamped late, inside the next speaker's turn.
        late = [T(0, 4000, 1, "这个报价我来处理"), T(4000, 9000, 2, "好的谢谢大家")]
        self.assertEqual(diarize.speaker_of(4500, 6000, "這個報價我來處理", late), 1)
        self.assertEqual(diarize.assign([{"seq": 7, "start_ms": 4500, "end_ms": 6000, "source": "好的，謝謝大家"}], late), {7: 2})

    def test_service_language(self):
        self.assertEqual(diarize.service_language({"source_language": "zh", "language": "zh"}), "zh")
        self.assertEqual(diarize.service_language({"source_language": "", "language": "en"}), "en")
        self.assertEqual(diarize.service_language({"source_language": "", "language": "zh_ja"}), "")


class DiarizeApiTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol", "林怡安")
        self.alice, self.meeting = self.signed_in("alice"), self.meeting_id()
        self.team_id = self.query("SELECT team_id FROM meetings")[0][0]
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, 'carol', 'admin')", (self.team_id,))
        self.signed_in("carol")   # carol's display name is known after her first sign-in
        folder = self.output / "teams" / str(self.team_id) / self.meeting
        audio = meeting_audio.MeetingAudio(folder / "audio.wav")
        audio.write(b"\x00\x00" * 16000 * 12)
        audio.close()
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE meetings SET audio_bytes = %s", (12 * 32000,))
        # segments 1..4 at 0-1 s, 1-2 s, ... ; speech of the fake service follows SERVICE_OUTPUT
        self.save(self.alice, self.meeting, [("好，那就這樣。", "OK."), ("我們下週五前把報價單寄出去。", "Quote by Friday."),
                                             ("嗯對。", "Yes."), ("下一個議題。", "Next topic.")])
        configured = patch("diarize.DIARIZE_URL", "http://diarize:5002")
        configured.start()
        self.addCleanup(configured.stop)
        self.calls = []

    def service(self, output=SERVICE_OUTPUT):
        async def fake(file, language):
            self.calls.append((file, language))
            if isinstance(output, Exception):
                raise output
            return output
        return patch("diarize.call_service", fake)

    def run_queue(self, output=SERVICE_OUTPUT):
        with self.service(output):
            while asyncio.run(diarize.run_next()):
                pass

    def speakers(self, client=None):
        return (client or self.alice).get(f"/api/meetings/{self.meeting}/speakers").json()

    def segment_speakers(self):
        return [s["speaker"] for s in self.alice.get(f"/api/meetings/{self.meeting}").json()["segments"]]

    def test_manual_run_labels_segments_and_lists_speakers(self):
        self.assertEqual((self.speakers()["status"], self.speakers()["turns"]), ("none", []))
        response = self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.assertEqual((response.status_code, response.json()), (202, {"status": "queued"}))
        again = self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.assertEqual((again.status_code, again.json()["detail"]), (409, "說話者辨識已在排隊或進行中"))
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE diarizations SET status = 'running'")
        self.assertEqual(self.alice.post(f"/api/meetings/{self.meeting}/speakers/run").status_code, 409)
        self.assertEqual(self.speakers()["status"], "running")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE diarizations SET status = 'queued'")
        self.run_queue()
        team = self.team_id
        self.assertEqual(self.calls, [(f"teams/{team}/{self.meeting}/audio.wav", "zh")])
        state = self.speakers()
        self.assertEqual(state["status"], "done")
        self.assertEqual([(s["label"], s["shown"], s["segments"]) for s in state["speakers"]],
                         [(1, "說話者 1", 2), (2, "說話者 2", 1), (3, "說話者 3", 1)])
        self.assertEqual(self.segment_speakers(), [1, 2, 1, 3])
        self.assertEqual({m["username"] for m in state["members"]}, {"alice", "carol"})

    def test_recording_close_queues_only_long_recordings(self):
        class Audio:
            def __init__(self, recorded):
                self.recorded = recorded

            def close(self):
                return self.recorded
        asyncio.run(server.finish_recording(Audio(6 * 32000), self.meeting))
        self.assertEqual(self.speakers()["status"], "none")
        asyncio.run(server.finish_recording(Audio(25 * 60 * 32000), self.meeting))
        self.assertEqual(self.speakers()["status"], "queued")
        self.assertEqual(self.query("SELECT requested_by FROM diarizations"), [(None,)])
        with patch("diarize.DIARIZE_URL", ""):
            self.assertEqual(self.alice.post(f"/api/meetings/{self.meeting}/speakers/run").json()["detail"], "說話者辨識未設定")

    def test_service_failure_keeps_speakers_and_restart_requeues(self):
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue()
        self.alice.put(f"/api/meetings/{self.meeting}/speakers/1", json={"name": "主持人"})
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue(RuntimeError("辨識服務回應 500：boom"))
        state = self.speakers()
        self.assertEqual((state["status"], state["message"]), ("failed", "辨識失敗（辨識服務回應 500：boom）"))
        self.assertEqual(state["speakers"][0]["shown"], "主持人")
        self.assertEqual(self.segment_speakers(), [1, 2, 1, 3])
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue("run: ok\n")
        self.assertEqual(self.speakers()["message"], "辨識失敗（沒有辨識到任何說話）")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE diarizations SET status = 'running'")
        asyncio.run(diarize.recover())
        self.assertEqual(self.speakers()["status"], "queued")

    def test_naming_correcting_and_new_segments(self):
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue()
        named = self.alice.put(f"/api/meetings/{self.meeting}/speakers/2", json={"username": "Carol"})
        self.assertEqual((named.status_code, named.json()["shown"], named.json()["username"]), (200, "林怡安", "carol"))
        bob = self.alice.put(f"/api/meetings/{self.meeting}/speakers/2", json={"username": "bob"})
        self.assertEqual((bob.status_code, bob.json()["detail"]), (422, "只能指定為這個團隊的成員"))
        self.assertEqual(self.speakers()["speakers"][1]["shown"], "林怡安")
        self.assertEqual(self.alice.put(f"/api/meetings/{self.meeting}/speakers/1", json={"name": "名" * 41}).status_code, 422)
        self.assertEqual(self.alice.put(f"/api/meetings/{self.meeting}/speakers/9", json={"name": "x"}).status_code, 404)
        added = self.alice.post(f"/api/meetings/{self.meeting}/speakers")
        self.assertEqual((added.status_code, added.json()["label"], added.json()["shown"]), (201, 4, "說話者 4"))
        moved = self.alice.put(f"/api/meetings/{self.meeting}/segments/1/speaker", json={"label": 4})
        self.assertEqual((moved.status_code, moved.json()["speaker"]), (200, 4))
        cleared = self.alice.put(f"/api/meetings/{self.meeting}/segments/3/speaker", json={"label": None})
        self.assertIsNone(cleared.json()["speaker"])
        self.assertEqual(self.alice.put(f"/api/meetings/{self.meeting}/segments/2/speaker", json={"label": 8}).status_code, 422)
        # Segments stored later are labelled from the stored turns; hand-picked ones (1 and the cleared 3) stay.
        self.save(self.alice, self.meeting, [("好，那就這樣。", "OK."), ("我們下週五前把報價單寄出去。", "Quote by Friday."),
                                             ("嗯對。", "Yes."), ("下一個議題。", "Next topic."), ("下一個議題", "Next."),
                                             ("沒有對應的話", "-")])
        self.assertEqual(self.segment_speakers(), [4, 2, None, 3, 3, 2])   # 6: no text match; 4-5 s overlaps S2
        # A new diarization replaces names and manual choices.
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue()
        self.assertEqual([s["shown"] for s in self.speakers()["speakers"]], ["說話者 1", "說話者 2", "說話者 3"])
        self.assertEqual(self.segment_speakers()[:4], [1, 2, 1, 3])

    def test_timeline_turns_duration_and_roles(self):
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue(SERVICE_OUTPUT + "  [  12.10 ->   13.00] S4: Quarterly numbers\n")
        state = self.speakers()
        self.assertEqual(state["turns"][0], [480, 1660, 1, "好那就這樣"])
        self.assertEqual(state["turns"][1], [1800, 5200, 2, "我們下週五前把報價單寄出去吧"])
        self.assertEqual(state["turns"][-1], [12100, 13000, 4, "Quarterly numbers"])
        self.assertEqual(state["durationMs"], 12000)
        self.assertEqual([(s["label"], s["turnMs"]) for s in state["speakers"]], [(1, 1180 + 600), (2, 3400), (3, 5900), (4, 900)])
        role = self.alice.put(f"/api/meetings/{self.meeting}/speakers/1", json={"name": "Nora", "note": " 主持人 "})
        self.assertEqual((role.status_code, role.json()["note"], role.json()["shown"], role.json()["turnMs"]), (200, "主持人", "Nora", 1780))
        self.assertEqual(self.alice.put(f"/api/meetings/{self.meeting}/speakers/1", json={"name": "Nora"}).json()["note"], "主持人")
        too_long = self.alice.put(f"/api/meetings/{self.meeting}/speakers/1", json={"name": "Nora", "note": "角" * 41})
        self.assertEqual(too_long.status_code, 422)
        self.assertEqual(self.speakers()["speakers"][0]["note"], "主持人")
        added = self.alice.post(f"/api/meetings/{self.meeting}/speakers").json()
        self.assertEqual((added["turnMs"], added["note"]), (0, ""))
        # A new diarization replaces roles too.
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue()
        self.assertEqual([s["note"] for s in self.speakers()["speakers"]], ["", "", ""])

    def test_timeline_turns_example(self):
        """Spec example table: stored turns come back with Chinese in Traditional script and other text as it is."""
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("INSERT INTO diarizations (meeting_id, status, turns) VALUES (%s, 'done', %s)",
                         (self.meeting, json.dumps([[0, 1660, 1, "好那就这样"], [1800, 5200, 2, "Quarterly numbers"]], ensure_ascii=False)))
        self.assertEqual(self.speakers()["turns"], [[0, 1660, 1, "好那就這樣"], [1800, 5200, 2, "Quarterly numbers"]])

    def test_minutes_lines_carry_speaker_names(self):
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.run_queue()
        self.alice.put(f"/api/meetings/{self.meeting}/speakers/2", json={"username": "carol"})
        self.alice.put(f"/api/meetings/{self.meeting}/segments/3/speaker", json={"label": 2})
        self.alice.put(f"/api/meetings/{self.meeting}/segments/4/speaker", json={"label": None})
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE segments SET source = '我來處理報價' WHERE seq = 3")

        async def rows():
            async with db.connect() as conn:
                return await (await conn.execute(diarize.SEGMENTS_WITH_SPEAKERS, (self.meeting,))).fetchall()
        meeting = {"started_at": datetime(2026, 11, 9, 2, tzinfo=timezone.utc), "title": ""}
        user = minutes.build_messages(meeting, asyncio.run(rows()), [])[-1]["content"]
        self.assertIn("[1] 說話者 1：好，那就這樣。", user)
        self.assertIn("[3] 林怡安：我來處理報價", user)
        self.assertIn("\n[4] 下一個議題。", user)
        self.assertIn("由聲音辨識出的說話者", minutes.SYSTEM_PROMPT)

    def test_only_team_members(self):
        bob = self.signed_in("bob")
        for method, path, body in (("get", "speakers", None), ("post", "speakers/run", None), ("post", "speakers", None),
                                   ("put", "speakers/1", {"name": "x"}), ("put", "segments/1/speaker", {"label": None})):
            response = getattr(bob, method)(f"/api/meetings/{self.meeting}/{path}", **({"json": body} if body is not None else {}))
            self.assertEqual(response.status_code, 404, path)

    def test_meeting_still_recording_is_409(self):
        folder = self.output / "teams" / str(self.team_id) / self.meeting
        (folder / "audio.wav").unlink()
        audio = meeting_audio.MeetingAudio(folder / "audio.wav")
        audio.write(b"\x00\x00" * 16000 * 12)
        response = self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "會議還在錄音，結束後會自動辨識說話者"))
        audio.close()
        self.assertEqual(self.alice.post(f"/api/meetings/{self.meeting}/speakers/run").status_code, 202)

    def test_stuck_run_expires(self):
        self.alice.post(f"/api/meetings/{self.meeting}/speakers/run")
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            conn.execute("UPDATE diarizations SET status = 'running', started_at = now() - interval '5 hours'")
        asyncio.run(diarize.expire_stuck())
        state = self.speakers()
        self.assertEqual((state["status"], state["message"]), ("failed", "辨識超過時限沒有結果"))

    def test_meeting_without_recording_is_422(self):
        other = self.signed_in("alice").post("/api/meetings", json={"team_id": self.team_id, "language": "zh"}).json()["id"]
        response = self.alice.post(f"/api/meetings/{other}/speakers/run")
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "這場會議沒有錄音"))



class ServiceStatusTests(AccountTestCase):
    """service-status: GET /api/services."""

    def services(self, asr, translate, database):
        async def service_ok(url):
            if url == server.ASR_HEALTH_URL:
                return asr
            self.assertEqual(url, f"{server.TRANSLATE_URL}/health")
            return translate

        async def database_ok():
            return database
        with patch("server.service_ok", service_ok), patch("server.database_ok", database_ok):
            response = self.signed_in("alice").get("/api/services")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_responses_example(self):
        # Spec example "Responses": ready only when every service is ready; fixed order, generic names.
        for checks in [(True, True, True), (False, True, True), (True, False, True), (False, False, False)]:
            body = self.services(*checks)
            self.assertEqual(body["ready"], all(checks))
            self.assertEqual([(s["key"], s["name"], s["ok"]) for s in body["services"]],
                             [("asr", "語音辨識", checks[0]), ("translate", "翻譯", checks[1]), ("database", "資料庫", checks[2])])
            self.assertEqual(set(body), {"ready", "services"})

    def test_service_ok_counts_only_http_200(self):
        class Client:
            def __init__(self, result, **_):
                self.result = result
            async def __aenter__(self):
                return self
            async def __aexit__(self, *_):
                return False
            async def get(self, url):
                if isinstance(self.result, Exception):
                    raise self.result
                return httpx.Response(self.result)
        for result, expected in [(200, True), (503, False), (httpx.ConnectError("refused"), False), (httpx.ReadTimeout("slow"), False)]:
            with patch("server.httpx.AsyncClient", lambda timeout, result=result: Client(result)):
                self.assertEqual(asyncio.run(server.service_ok("http://asr:8272/health")), expected, result)

    def test_database_ok_with_the_test_database(self):
        self.assertTrue(asyncio.run(server.database_ok()))
        with patch("server.db.DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none"):
            self.assertFalse(asyncio.run(server.database_ok()))

    def test_health_url_example(self):
        # Spec example "Health URL".
        self.assertEqual(server.asr_health_url("ws://asr:8272/asr_stream_api_v1"), "http://asr:8272/health")
        self.assertEqual(server.asr_health_url("wss://asr.example:443/stream"), "https://asr.example:443/health")
        self.assertEqual(server.asr_health_url("ws://asr:8272/asr_stream_api_v1", "http://asr:9000/ready"), "http://asr:9000/ready")

    def test_signed_out_is_401_and_health_unchanged(self):
        client = TestClient(app)
        self.assertEqual(client.get("/api/services").status_code, 401)
        self.assertEqual(client.get("/api/health").json(), {"status": "ok"})


REAL_SEND = mailer.send_message


def run_sql(sql, params=()):
    with psycopg.connect(TEST_DATABASE_URL) as conn:
        conn.execute(sql, params)


class MemberEmailTests(AccountTestCase):
    """user-auth: Member e-mail address (minutes-mail)."""

    def me(self, client):
        body = client.get("/api/me").json()
        return body["email"], body["emailSource"]

    def test_address_from_the_directory_is_stored_and_cannot_be_changed(self):
        self.ldap.add("dora", "pw-dora", "Dora", mail="dora@corp.example")
        dora = self.signed_in("dora")
        self.assertEqual(self.me(dora), ("dora@corp.example", "ldap"))
        response = dora.put("/api/me/email", json={"email": "other@corp.example"})
        self.assertEqual((response.status_code, response.json()["detail"]), (409, "Email 由公司目錄提供，無法修改"))
        self.assertEqual(self.me(dora), ("dora@corp.example", "ldap"))

    def test_entering_ones_own_address_survives_the_next_sign_in(self):
        bob = self.signed_in("bob")
        self.assertEqual(self.me(bob), (None, None))
        response = bob.put("/api/me/email", json={"email": " bob@corp.example "})
        self.assertEqual(response.json(), {"email": "bob@corp.example", "emailSource": "self"})
        self.assertEqual(self.me(self.signed_in("bob")), ("bob@corp.example", "self"))
        self.assertEqual(bob.put("/api/me/email", json={"email": ""}).json(), {"email": None, "emailSource": None})
        self.assertEqual(self.me(bob), (None, None))

    def test_address_checks(self):
        bob = self.signed_in("bob")
        for bad in ("bob@corp", "a b@corp.example", "@corp.example", "x" * 250 + "@c.example",
                    '"x@corp.example', "a@b.example,root", "測試@corp.example", "a<b>@corp.example", "a;b@corp.example"):
            response = bob.put("/api/me/email", json={"email": bad})
            self.assertEqual((response.status_code, response.json()["detail"]), (422, "Email 格式不正確"), bad)
        self.assertEqual(bob.put("/api/me/email", json={"email": "bob.chen+mt@corp-tw.example"}).json()["email"], "bob.chen+mt@corp-tw.example")

    def test_directory_address_removed_clears_it_but_not_a_self_entered_one(self):
        self.ldap.add("dora", "pw-dora", mail="dora@corp.example")
        self.signed_in("dora")
        self.ldap.seed.strategy.remove_entry("cn=dora,ou=people,dc=corp")
        self.ldap.add("dora", "pw-dora")
        self.assertEqual(self.me(self.signed_in("dora")), (None, None))
        bob = self.signed_in("bob")
        bob.put("/api/me/email", json={"email": "bob@corp.example"})
        self.assertEqual(self.me(self.signed_in("bob")), ("bob@corp.example", "self"))

    def test_a_directory_value_that_is_no_address_is_ignored(self):
        self.ldap.add("dora", "pw-dora", mail="not an address")
        self.assertEqual(self.me(self.signed_in("dora")), (None, None))


class MinutesMailTests(ReviewTestCase):
    """minutes-mail: team settings, finalize, send, the send record."""

    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol")
        self.alice, self.meeting = self.signed_in("alice"), self.meeting_id()
        self.team_id = self.query("SELECT team_id FROM meetings")[0][0]
        run_sql("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, 'bob', 'admin')", (self.team_id,))
        run_sql("UPDATE users SET email = 'alice@corp.example', email_source = 'self' WHERE username = 'alice'")
        run_sql("UPDATE meetings SET title = '報價會議'")
        self.save(self.alice, self.meeting, [("第一句", "S1"), ("第二句", "S2")])
        self.sent = []
        self.refuse = None
        for name, value in (("mailer.SMTP_HOST", "smtp.test"), ("mailer.PUBLIC_BASE_URL", "https://asr.example"),
                            ("mailer.send_message", self.fake_send)):
            p = patch(name, value)
            p.start()
            self.addCleanup(p.stop)

    def fake_send(self, message):
        if self.refuse:
            raise self.refuse
        self.sent.append(message)
        return getattr(self, "refused", {})

    def item(self, kind, content, state="confirmed", owner=None, due=None):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute(
                "INSERT INTO minute_items (meeting_id, kind, content, owner, due_date, origin, state) VALUES (%s, %s, %s, %s, %s, 'ai', %s) RETURNING id",
                (self.meeting, kind, content, owner, due, state)).fetchone()[0]

    def settings(self, client=None, **body):
        return (client or self.alice).put(f"/api/teams/{self.team_id}/mail", json={"target": "members", "address": "", "auto": False, **body})

    def post(self, action, client=None):
        return (client or self.alice).post(f"/api/meetings/{self.meeting}/minutes/{action}")

    def parts(self, message):
        return message.get_body(("plain",)).get_content(), message.get_body(("html",)).get_content()

    # Team mail settings
    def test_a_member_switches_to_the_team_address(self):
        self.assertEqual(self.settings(target="team", address="rd@corp.example", auto=True).status_code, 200)
        self.item("decision", "採用新報價")
        self.assertEqual(self.post("send").status_code, 200)
        self.assertEqual(self.sent[0]["To"], "rd@corp.example")

    def test_a_non_member_cannot_change_the_settings_but_an_administrator_can(self):
        self.assertEqual(self.settings(self.signed_in("carol"), auto=True).status_code, 403)
        self.assertEqual(self.query("SELECT mail_auto FROM teams"), [(False,)])
        self.assertEqual(self.settings(self.signed_in("admin"), auto=True).status_code, 200)
        self.assertEqual(self.query("SELECT mail_auto FROM teams"), [(True,)])

    # mail-settings-audit: who changed where the minutes go
    def last_change(self):
        return self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["mail"]["lastChange"]

    def test_what_is_recorded(self):
        self.assertIsNone(self.last_change())
        # alice, a member: members -> team rd@corp.example
        self.assertEqual(self.settings(target="team", address="rd@corp.example").status_code, 200)
        change = self.last_change()
        self.assertEqual((change["by"], change["member"], change["target"], change["address"], change["auto"]),
                         ("王愛麗", True, "team", "rd@corp.example", False))
        self.assertEqual(self.query("SELECT target_before, address_before, auto_before FROM team_mail_changes ORDER BY id LIMIT 1"),
                         [("members", "", False)])
        # the same settings again: nothing recorded, the previous line is kept
        self.settings(target="team", address="rd@corp.example")
        self.assertEqual(self.query("SELECT count(*) FROM team_mail_changes"), [(1,)])
        self.assertEqual(self.last_change(), change)
        # admin, not a member: -> team someone@outside.example, auto on
        self.assertEqual(self.settings(self.signed_in("admin"), target="team", address="someone@outside.example", auto=True).status_code, 200)
        change = self.last_change()
        self.assertEqual((change["by"], change["member"], change["address"], change["auto"]), ("管理員", False, "someone@outside.example", True))
        self.assertEqual(self.query("SELECT target_before, address_before, auto_before, target_after FROM team_mail_changes ORDER BY id DESC LIMIT 1"),
                         [("team", "rd@corp.example", False, "team")])

    def test_team_target_without_an_address(self):
        for address in ("", "rd@corp"):
            response = self.settings(target="team", address=address)
            self.assertEqual((response.status_code, response.json()["detail"]), (422, "Email 格式不正確"))

    # Finalize minutes
    def test_finalize_with_auto_send_on_sends_once(self):
        self.settings(auto=True)
        self.item("decision", "採用新報價")
        body = self.post("finalize").json()
        self.assertEqual((body["notice"], body["finalizedBy"], body["mail"]["last"]["trigger"]), ("已定稿並寄出紀要", "王愛麗", "auto"))
        again = self.post("finalize", self.signed_in("bob")).json()
        self.assertEqual((again["finalizedAt"], again["finalizedBy"], again["notice"]), (body["finalizedAt"], "王愛麗", ""))
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.query("SELECT trigger, sent_by, ok FROM minutes_mail"), [("auto", "alice", True)])

    def test_finalize_with_auto_send_off(self):
        self.item("decision", "採用新報價")
        body = self.post("finalize").json()
        self.assertEqual((body["notice"], body["mail"]["last"]), ("已定稿", None))
        self.assertIsNotNone(body["finalizedAt"])
        self.assertEqual(self.sent, [])

    def test_a_failed_automatic_send_keeps_the_finalize(self):
        self.settings(auto=True)
        self.item("decision", "採用新報價")
        self.refuse = mailer.smtplib.SMTPRecipientsRefused({"alice@corp.example": (550, b"no such user")})
        body = self.post("finalize").json()
        self.assertIsNotNone(body["finalizedAt"])
        self.assertTrue(body["notice"].startswith("已定稿；寄送失敗：SMTPRecipientsRefused"), body["notice"])
        self.assertFalse(body["mail"]["last"]["ok"])

    def test_finalize_with_nothing_to_send_still_finalizes(self):
        self.settings(auto=True)
        body = self.post("finalize").json()
        self.assertEqual(body["notice"], "已定稿；紀要還沒有內容可寄送，沒有自動寄送")
        self.assertIsNotNone(body["finalizedAt"])

    # Send minutes
    def test_send_to_members_lists_those_without_an_address(self):
        self.item("decision", "採用新報價")
        body = self.post("send").json()
        self.assertEqual(self.sent[0]["To"], "alice@corp.example")
        self.assertEqual(self.sent[0]["Subject"], "[語橋 Live] 會議紀要：報價會議")
        self.assertEqual((body["last"]["recipients"], body["last"]["skipped"], body["last"]["sentBy"]), (1, ["bob"], "王愛麗"))
        mail = self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["mail"]
        self.assertEqual((mail["recipients"], mail["missing"], mail["configured"]), (1, ["bob"], True))

    def test_only_confirmed_items_are_sent(self):
        self.item("decision", "採用新報價")
        self.item("action", "寄出報價單", state="proposed")
        self.item("action", "整理交期", owner="bob", due=date(2026, 11, 20))
        self.post("send")
        text, page = self.parts(self.sent[0])
        for part in (text, page):
            self.assertIn("採用新報價", part)
            self.assertIn("整理交期", part)
            self.assertNotIn("寄出報價單", part)
        self.assertIn("負責人：bob", text)
        self.assertIn("2026-11-20", page)
        self.assertIn(f"https://asr.example/meetings/{self.meeting}/minutes", text)
        self.assertIn(f'href="https://asr.example/meetings/{self.meeting}/minutes"', page)

    def test_nothing_to_send(self):
        self.item("decision", "還沒確認", state="proposed")
        response = self.post("send")
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "紀要還沒有內容可寄送"))
        self.assertEqual((self.sent, self.query("SELECT count(*) FROM minutes_mail")), ([], [(0,)]))

    def test_no_recipient(self):
        run_sql("UPDATE users SET email = NULL, email_source = NULL")
        self.item("decision", "採用新報價")
        response = self.post("send")
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "沒有可寄送的收件人"))
        self.assertEqual(self.sent, [])

    def test_meeting_text_is_escaped_in_the_html_part(self):
        self.item("decision", "<b>報價</b> & 交期")
        run_sql("UPDATE meetings SET title = %s", ("報價\n會議<script>",))
        self.post("send")
        text, page = self.parts(self.sent[0])
        self.assertIn("&lt;b&gt;報價&lt;/b&gt; &amp; 交期", page)
        self.assertNotIn("<b>報價</b>", page)
        self.assertNotIn("<script>", page)
        self.assertIn("<b>報價</b> & 交期", text)
        self.assertEqual(self.sent[0]["Subject"], "[語橋 Live] 會議紀要：報價 會議<script>")

    def test_a_summary_alone_can_be_sent(self):
        self.alice.patch(f"/api/meetings/{self.meeting}/minutes/summary", json={"version": 1, "summary": "討論報價。"})
        self.assertEqual(self.post("send").status_code, 200)

    def test_only_team_members_send(self):
        self.item("decision", "採用新報價")
        self.assertEqual(self.post("send", self.signed_in("carol")).status_code, 404)

    # Mail server configuration
    def test_smtp_not_configured(self):
        self.item("decision", "採用新報價")
        with patch("mailer.SMTP_HOST", ""):
            response = self.post("send")
            self.assertEqual((response.status_code, response.json()["detail"]), (503, "尚未設定寄信伺服器"))
            self.assertFalse(self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["mail"]["configured"])

    def test_mail_server_refuses(self):
        self.item("decision", "採用新報價")
        self.refuse = mailer.smtplib.SMTPAuthenticationError(535, b"5.7.8 authentication failed")
        with patch("mailer.SMTP_PASSWORD", "very-secret-pw"):
            response = self.post("send")
        self.assertEqual(response.status_code, 502)
        self.assertTrue(response.json()["detail"].startswith("寄送失敗：SMTPAuthenticationError"), response.json())
        last = self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["mail"]["last"]
        self.assertFalse(last["ok"])
        self.assertNotIn("very-secret-pw", last["error"])

    def test_connection_errors_count_as_failed_sends(self):
        self.item("decision", "採用新報價")
        self.refuse = ConnectionRefusedError(111, "Connection refused")
        self.assertEqual(self.post("send").status_code, 502)
        self.assertEqual(self.query("SELECT ok FROM minutes_mail"), [(False,)])

    # review-followups
    def test_a_stored_address_that_no_longer_passes_counts_as_none(self):
        run_sql("UPDATE users SET email = %s, email_source = 'self' WHERE username = 'bob'", ('"x@corp.example',))
        self.item("decision", "採用新報價")
        body = self.post("send").json()
        self.assertEqual((self.sent[0]["To"], body["last"]["skipped"]), ("alice@corp.example", ["bob"]))

    def test_some_recipients_refused(self):
        run_sql("UPDATE users SET email = 'bob@corp.example', email_source = 'self' WHERE username = 'bob'")
        self.item("decision", "採用新報價")
        self.refused = {"bob@corp.example": (550, b"no such user")}
        response = self.post("send")
        self.assertEqual(response.status_code, 502)
        self.assertIn("bob@corp.example", response.json()["detail"])
        last = self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["mail"]["last"]
        self.assertFalse(last["ok"])
        self.assertEqual(last["error"], "部分收件人被拒收：bob@corp.example（550）")

    def test_unknown_smtp_tls_value_uses_starttls(self):
        self.assertEqual([mailer.tls_mode(v) for v in ("tls", "true", "", "SSL", " none ")], ["starttls", "starttls", "starttls", "ssl", "none"])
        calls = []

        class FakeSMTP:
            def __init__(self, *_args, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def starttls(self, context):
                calls.append("starttls")

            def login(self, user, _password):
                calls.append("login")

            def send_message(self, message):
                calls.append("send")
        with patch("mailer.smtplib.SMTP", FakeSMTP), patch("mailer.SMTP_TLS", mailer.tls_mode("tls")), patch("mailer.SMTP_USER", "svc"):
            REAL_SEND(mailer.EmailMessage())
        self.assertEqual(calls, ["starttls", "login", "send"])

    def test_a_stored_team_address_that_no_longer_passes_is_no_recipient(self):
        run_sql("UPDATE teams SET mail_target = 'team', mail_address = 'team@corp.example,root'")
        self.item("decision", "採用新報價")
        response = self.post("send")
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "沒有可寄送的收件人"))
        self.assertEqual(self.sent, [])

    def test_an_unexpected_error_while_sending_keeps_the_finalize(self):
        self.settings(auto=True)
        self.item("decision", "採用新報價")
        self.refuse = ValueError("SMTP_PASSWORD=should-not-show")
        body = self.post("finalize").json()
        self.assertIsNotNone(body["finalizedAt"])
        self.assertEqual((body["mail"]["last"]["ok"], body["mail"]["last"]["error"]), (False, "ValueError"))

    # Send record
    def test_the_latest_send_is_shown(self):
        self.settings(auto=True)
        self.item("decision", "採用新報價")
        self.post("finalize")
        self.post("send", self.signed_in("bob"))
        last = self.alice.get(f"/api/meetings/{self.meeting}/minutes").json()["mail"]["last"]
        self.assertEqual((last["trigger"], last["sentBy"], last["recipients"], last["ok"]), ("manual", "bob", 1, True))
        self.assertEqual(self.query("SELECT trigger, sent_by FROM minutes_mail ORDER BY id"), [("auto", "alice"), ("manual", "bob")])

    def test_the_real_sender_uses_the_configured_tls_and_login(self):
        calls = []

        class FakeSMTP:
            def __init__(self, host, port, timeout):
                calls.append(("connect", host, port, timeout))

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def starttls(self, context):
                calls.append(("starttls",))

            def login(self, user, _password):
                calls.append(("login", user))

            def send_message(self, message):
                calls.append(("send", message["To"]))
        message = mailer.EmailMessage()
        message["To"] = "x@corp.example"
        with patch("mailer.smtplib.SMTP", FakeSMTP), patch("mailer.SMTP_HOST", "smtp.corp"), patch("mailer.SMTP_PORT", 587), \
                patch("mailer.SMTP_TLS", "starttls"), patch("mailer.SMTP_USER", "svc"):
            REAL_SEND(message)
        self.assertEqual(calls, [("connect", "smtp.corp", 587, 15), ("starttls",), ("login", "svc"), ("send", "x@corp.example")])


class ActionReminderTests(ReviewTestCase):
    """action-reminders: timing, one mail per owner, switching reminders per item."""
    TODAY = date(2026, 11, 10)

    def setUp(self):
        super().setUp()
        self.ldap.add("carol", "pw-carol")
        self.alice, self.meeting = self.signed_in("alice"), self.meeting_id()
        self.team_id = self.query("SELECT team_id FROM meetings")[0][0]
        for member in ("bob", "carol", "admin"):
            run_sql("INSERT INTO team_members (team_id, username, added_by) VALUES (%s, %s, 'admin')", (self.team_id, member))
        self.bob = self.signed_in("bob")
        run_sql("INSERT INTO users (username) VALUES ('carol'), ('admin') ON CONFLICT DO NOTHING")
        run_sql("UPDATE users SET email = username || '@corp.example', email_source = 'self'")
        run_sql("UPDATE meetings SET title = '週會'")
        self.sent, self.refuse = [], None
        for name, value in (("mailer.SMTP_HOST", "smtp.test"), ("mailer.PUBLIC_BASE_URL", "https://asr.example"),
                            ("mailer.send_message", self.fake_send)):
            p = patch(name, value)
            p.start()
            self.addCleanup(p.stop)

    def fake_send(self, message):
        if self.refuse:
            raise self.refuse
        self.sent.append(message)

    def item(self, content, due, status="todo", owner="bob", state="confirmed", kind="action"):
        with psycopg.connect(TEST_DATABASE_URL) as conn:
            return conn.execute(
                "INSERT INTO minute_items (meeting_id, kind, content, owner, due_date, origin, state, status) VALUES (%s, %s, %s, %s, %s, 'ai', %s, %s) RETURNING id",
                (self.meeting, kind, content, owner, due, state, status)).fetchone()[0]

    def run_on(self, day):
        self.sent.clear()
        return asyncio.run(reminders.run(day))

    def text(self, message):
        return message.get_body(("plain",)).get_content()

    def test_reminder_kind_example(self):
        today = self.TODAY
        cases = [(date(2026, 11, 13), ("soon", date(2026, 11, 13))), (date(2026, 11, 11), ("soon", date(2026, 11, 11))),
                 (date(2026, 11, 14), None), (today, ("due", today)), (date(2026, 11, 8), ("overdue", today))]
        for due, expected in cases:
            self.assertEqual(reminders.reminder_kind(due, today), expected, due)

    def test_the_daily_reminders(self):
        self.item("報價單 A", date(2026, 11, 13))
        self.item("報價單 B", date(2026, 11, 11), status="doing")
        self.item("太遠的", date(2026, 11, 14))
        self.item("今天的", self.TODAY)
        self.item("逾期的", date(2026, 11, 8), status="doing")
        self.item("做完的", date(2026, 11, 8), status="done")
        self.item("沒期限", None)
        self.item("未確認", date(2026, 11, 8), state="proposed")
        self.item("決議不是待辦", date(2026, 11, 8), kind="decision")
        result = self.run_on(self.TODAY)
        self.assertEqual(result, {"owners": 1, "items": 4, "failed": 0, "pending": 0})
        self.assertEqual(len(self.sent), 1)
        text = self.text(self.sent[0])
        for content in ("報價單 A", "報價單 B", "今天的", "逾期的"):
            self.assertIn(content, text)
        for content in ("太遠的", "做完的", "沒期限", "未確認", "決議不是待辦"):
            self.assertNotIn(content, text)
        self.assertIn("逾期 2 天", text)
        self.assertEqual(self.sent[0]["Subject"], "[語橋 Live] 待辦提醒：逾期 1 件、今天到期 1 件、3 天內到期 2 件")
        self.assertEqual(self.sent[0]["To"], "bob@corp.example")

    def test_running_twice_on_one_day(self):
        self.item("逾期的", date(2026, 11, 8))
        self.item("快到期", date(2026, 11, 12))
        self.run_on(self.TODAY)
        self.assertEqual(self.run_on(self.TODAY), {"owners": 0, "items": 0, "failed": 0, "pending": 0})
        self.assertEqual(self.sent, [])

    def test_overdue_every_day_due_soon_only_once(self):
        self.item("逾期的", date(2026, 11, 8))
        self.item("快到期", date(2026, 11, 13))
        self.run_on(self.TODAY)
        self.assertIn("快到期", self.text(self.sent[0]))
        self.run_on(date(2026, 11, 11))
        self.assertEqual(len(self.sent), 1)
        self.assertIn("逾期的", self.text(self.sent[0]))
        self.assertNotIn("快到期", self.text(self.sent[0]))
        self.run_on(date(2026, 11, 13))
        self.assertIn("今天到期", self.text(self.sent[0]))

    def test_a_changed_due_date_is_reminded_again(self):
        item = self.item("快到期", date(2026, 11, 12))
        self.run_on(self.TODAY)
        run_sql("UPDATE minute_items SET due_date = '2026-11-13' WHERE id = %s", (item,))
        self.run_on(date(2026, 11, 11))
        self.assertEqual(len(self.sent), 1)

    def test_a_failed_send_is_retried(self):
        self.item("逾期的", date(2026, 11, 8))
        self.refuse = mailer.smtplib.SMTPServerDisconnected("gone")
        self.assertEqual(self.run_on(self.TODAY), {"owners": 0, "items": 0, "failed": 1, "pending": 0})
        self.assertEqual(self.query("SELECT count(*) FROM reminder_log"), [(0,)])
        self.refuse = None
        self.assertEqual(self.run_on(self.TODAY), {"owners": 1, "items": 1, "failed": 0, "pending": 0})

    # reminder-outbox: a claim left by a killed run
    def killed_run_claims(self, item_id, due, minutes_ago):
        """What a run killed after claiming, before sending, leaves behind."""
        item = {"id": item_id, "owner": "bob", "due_date": due}

        async def leave():
            async with db.connect() as conn:
                self.assertEqual(await reminders.claim(conn, item, *reminders.reminder_kind(due, self.TODAY)), "claimed")
        asyncio.run(leave())
        run_sql("UPDATE reminder_log SET claimed_at = now() - %s * interval '1 minute'", (minutes_ago,))

    def test_claims_seen_by_a_later_run(self):
        due = date(2026, 11, 8)
        rows = [  # minutes since the claim, already sent -> what the later run does (spec example)
            (5, False, {"owners": 0, "items": 0, "failed": 0, "pending": 1}),
            (35, False, {"owners": 1, "items": 1, "failed": 0, "pending": 0}),
            (35, True, {"owners": 0, "items": 0, "failed": 0, "pending": 0}),
        ]
        for minutes_ago, sent, expected in rows:
            with self.subTest(minutes_ago=minutes_ago, sent=sent):
                run_sql("DELETE FROM reminder_log")
                run_sql("DELETE FROM minute_items")
                item = self.item("逾期的", due)
                self.killed_run_claims(item, due, minutes_ago)
                if sent:
                    run_sql("UPDATE reminder_log SET sent_at = claimed_at")
                self.assertEqual(self.run_on(self.TODAY), expected)
                self.assertEqual(len(self.sent), expected["owners"])
                self.assertEqual(self.query("SELECT count(*) FROM reminder_log WHERE sent_at IS NOT NULL"),
                                 [(1 if expected["owners"] or sent else 0,)])

    def test_a_killed_run_is_recovered_by_the_retry(self):
        due = date(2026, 11, 12)   # due soon: keyed by the due date, so a lost claim would never be sent
        item = self.item("快到期", due)
        self.killed_run_claims(item, due, 0)
        self.assertEqual(self.run_on(self.TODAY)["pending"], 1)
        run_sql("UPDATE reminder_log SET claimed_at = claimed_at - interval '30 minutes'")   # the 30-minute retry
        self.assertEqual(self.run_on(self.TODAY)["items"], 1)
        self.assertIn("快到期", self.text(self.sent[0]))

    def test_a_sent_reminder_records_when(self):
        self.item("逾期的", date(2026, 11, 8))
        self.run_on(self.TODAY)
        self.assertEqual(self.query("SELECT count(*) FROM reminder_log WHERE sent_at IS NOT NULL"), [(1,)])

    def stale(self, today):
        async def check():
            async with db.connect() as conn:
                return await reminders.stale_claims(conn, today)
        return asyncio.run(check())

    def test_a_killed_manual_run_is_noticed_by_the_schedule(self):
        due = date(2026, 11, 12)
        item = self.item("快到期", due)
        self.killed_run_claims(item, due, 0)
        self.assertFalse(self.stale(self.TODAY))                 # still being sent, as far as anyone knows
        run_sql("UPDATE reminder_log SET claimed_at = claimed_at - interval '11 minutes'")
        self.assertTrue(self.stale(self.TODAY))                  # the worker runs again because of it
        self.assertEqual(self.run_on(self.TODAY)["items"], 1)
        self.assertFalse(self.stale(self.TODAY))

    def test_a_left_claim_nobody_takes_over_is_cleared(self):
        due = date(2026, 11, 12)
        item = self.item("快到期", due)
        self.killed_run_claims(item, due, 11)
        run_sql("UPDATE minute_items SET status = 'done' WHERE id = %s", (item,))   # finished meanwhile: no reminder
        self.assertEqual(self.run_on(self.TODAY)["items"], 0)
        self.assertEqual(self.query("SELECT count(*) FROM reminder_log"), [(0,)])   # so the schedule stops seeing it
        self.assertFalse(self.stale(self.TODAY))

    def test_a_claim_given_back_meanwhile_counts_as_pending(self):
        due = date(2026, 11, 8)
        item = {"id": self.item("逾期的", due), "owner": "bob", "due_date": due}

        class Gone:   # the other run gave its claim back between our two queries: the follow-up finds no row
            async def fetchone(self):
                return None

        async def race():
            async with db.connect() as conn:
                original = conn.execute

                async def execute(sql, params=()):
                    if sql.startswith("SELECT sent_at FROM reminder_log"):
                        return Gone()
                    return await original(sql, params)
                conn.execute = execute
                return await reminders.claim(conn, item, "overdue", self.TODAY)
        self.killed_run_claims(item["id"], due, 0)
        self.assertEqual(asyncio.run(race()), "pending")

    def test_left_claims_wait_for_the_reminder_time(self):
        zone = timezone(timedelta(hours=8))
        rows = [  # now, last run, left claim -> runs
            (datetime(2026, 11, 10, 8, 30, tzinfo=zone), date(2026, 11, 9), True, False),   # before 09:00: waits
            (datetime(2026, 11, 10, 9, 0, tzinfo=zone), date(2026, 11, 9), False, True),    # the daily run
            (datetime(2026, 11, 10, 11, 0, tzinfo=zone), date(2026, 11, 10), True, True),   # after a killed manual run
            (datetime(2026, 11, 10, 11, 0, tzinfo=zone), date(2026, 11, 10), False, False),
        ]
        with patch("reminders.REMIND_AT", reminders.time(9, 0)):
            for now, ran_on, leftover, runs in rows:
                with self.subTest(now=now, leftover=leftover):
                    self.assertIs(reminders.should_run(now, ran_on, None, leftover), runs)

    def test_the_worker_retries_when_reminders_are_pending_or_failed(self):
        now = datetime(2026, 11, 10, 9, 0)
        base = {"owners": 0, "items": 0, "failed": 0, "pending": 0}
        self.assertIsNone(reminders.retry_time(base, now))
        self.assertEqual(reminders.retry_time(base | {"pending": 2}, now), now + timedelta(minutes=30))
        self.assertEqual(reminders.retry_time(base | {"failed": 1}, now), now + timedelta(minutes=30))

    def test_owners_who_cannot_be_reached(self):
        self.item("沒信箱", date(2026, 11, 8), owner="carol")
        self.item("離開團隊", date(2026, 11, 8), owner="bob")
        run_sql("UPDATE users SET email = NULL WHERE username = 'carol'")
        run_sql("DELETE FROM team_members WHERE username = 'bob'")
        self.assertEqual(self.run_on(self.TODAY)["items"], 0)

    def test_without_a_mail_server_nothing_is_sent(self):
        self.item("逾期的", date(2026, 11, 8))
        with patch("mailer.SMTP_HOST", ""):
            self.assertEqual(self.run_on(self.TODAY), {"owners": 0, "items": 0, "failed": 0, "pending": 0})
        self.assertEqual(self.query("SELECT count(*) FROM reminder_log"), [(0,)])

    def test_one_mail_per_owner(self):
        self.item("逾期的", date(2026, 11, 8))
        self.item("今天的", self.TODAY)
        self.item("carol 的", self.TODAY, owner="carol")
        self.run_on(self.TODAY)
        bob = next(m for m in self.sent if m["To"] == "bob@corp.example")
        self.assertEqual(len(self.sent), 2)
        self.assertEqual(bob["Subject"], "[語橋 Live] 待辦提醒：逾期 1 件、今天到期 1 件")
        self.assertNotIn("carol 的", self.text(bob))

    def test_mail_content_links_and_escapes(self):
        item = self.item("<b>報價</b> & 交期", date(2026, 11, 8))
        self.run_on(self.TODAY)
        text, page = self.text(self.sent[0]), self.sent[0].get_body(("html",)).get_content()
        self.assertIn(f"https://asr.example/actions?item={item}", text)
        self.assertIn("測試團隊・週會", text)
        self.assertIn("&lt;b&gt;報價&lt;/b&gt; &amp; 交期", page)
        self.assertNotIn("<b>報價</b>", page)

    # Reminders per item
    def remind(self, client, item, on):
        return client.post(f"/api/actions/{item}/remind", json={"on": on})

    def test_the_owner_switches_reminders_off(self):
        item = self.item("逾期的", date(2026, 11, 8))
        response = self.remind(self.bob, item, False)
        self.assertEqual((response.status_code, response.json()["remind"]), (200, False))
        self.assertEqual(self.run_on(self.TODAY)["items"], 0)
        board = self.bob.get("/api/actions").json()["items"]
        self.assertEqual([i["remind"] for i in board if i["id"] == item], [False])
        self.assertTrue(self.remind(self.bob, item, True).json()["remind"])

    def test_another_member_cannot_switch_reminders_off(self):
        item = self.item("逾期的", date(2026, 11, 8))
        response = self.remind(self.alice, item, False)
        self.assertEqual((response.status_code, response.json()["detail"]), (403, "只有負責人或系統管理員可以切換提醒"))
        self.assertEqual(self.query("SELECT remind FROM minute_items"), [(True,)])
        self.assertEqual(self.remind(self.signed_in("admin"), item, False).status_code, 200)
        outsider = self.signed_in("bob")
        run_sql("DELETE FROM team_members WHERE username = 'bob'")
        self.assertEqual(self.remind(outsider, item, True).status_code, 404)

    def test_a_new_owner_gets_reminders(self):
        item = self.item("逾期的", date(2026, 11, 8))
        self.remind(self.bob, item, False)
        version = self.query("SELECT version FROM minute_items")[0][0]
        self.alice.patch(f"/api/actions/{item}", json={"version": version, "content": "逾期的（改）"})
        self.assertEqual(self.query("SELECT remind FROM minute_items"), [(False,)])
        version = self.query("SELECT version FROM minute_items")[0][0]
        self.alice.patch(f"/api/actions/{item}", json={"version": version, "owner": "carol"})
        self.assertEqual(self.query("SELECT remind FROM minute_items"), [(True,)])
        self.remind(self.signed_in("carol"), item, False)
        version = self.query("SELECT version FROM minute_items")[0][0]
        self.alice.patch(f"/api/meetings/{self.meeting}/minutes/items/{item}", json={"version": version, "owner": "bob"})
        self.assertEqual(self.query("SELECT remind FROM minute_items"), [(True,)])

    def test_due_now_example(self):
        zone = reminders.ZoneInfo("Asia/Taipei")
        at = lambda d, h, m: datetime(2026, 11, d, h, m, tzinfo=zone)
        rows = [(at(10, 8, 59), date(2026, 11, 9), None, False), (at(10, 9, 0), date(2026, 11, 9), None, True),
                (at(10, 15, 0), date(2026, 11, 10), None, False), (at(10, 9, 40), date(2026, 11, 10), at(10, 9, 35), True),
                (at(11, 9, 10), date(2026, 11, 10), at(10, 9, 35), True), (at(11, 0, 20), date(2026, 11, 10), at(10, 23, 50), False)]
        with patch("reminders.REMIND_AT", reminders.time(9, 0)):
            for now, ran_on, retry_at, expected in rows:
                self.assertEqual(reminders.due_now(now, ran_on, retry_at), expected, now)
        self.assertEqual((reminders.remind_at("7:30"), reminders.remind_at("25:00")), (reminders.time(7, 30), reminders.time(9, 0)))

    def test_an_interrupted_run_loses_nothing(self):
        self.item("bob 的", date(2026, 11, 8))
        self.item("carol 的", date(2026, 11, 8), owner="carol")

        async def interrupted(_message):
            raise asyncio.CancelledError
        with patch("mailer.deliver", interrupted), self.assertRaises(asyncio.CancelledError):
            asyncio.run(reminders.run(self.TODAY))
        self.assertEqual(self.query("SELECT count(*) FROM reminder_log"), [(0,)])
        self.assertEqual(self.run_on(self.TODAY), {"owners": 2, "items": 2, "failed": 0, "pending": 0})

    def test_a_stored_address_that_no_longer_passes_gets_no_reminder(self):
        self.item("逾期的", date(2026, 11, 8))
        run_sql("UPDATE users SET email = 'bob@corp.example,root' WHERE username = 'bob'")
        self.assertEqual(self.run_on(self.TODAY), {"owners": 0, "items": 0, "failed": 0, "pending": 0})
        self.assertEqual(self.sent, [])



class FakeAzureTranslate:
    """Azure's /realtime/translations as interpret.py sees it: the events are sent after the first audio arrives,
    and the stream ends when session.close comes in."""

    def __init__(self, events):
        self.events, self.sent, self.fired = events, [], False
        self.queue = None

    async def send(self, raw):
        if self.queue is None:
            self.queue = asyncio.Queue()
        message = json.loads(raw)
        self.sent.append(message)
        if message["type"] == "session.input_audio_buffer.append" and not self.fired:
            self.fired = True
            for event in self.events:
                self.queue.put_nowait(event)
        if message["type"] == "session.close":
            self.queue.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.queue is None:
            self.queue = asyncio.Queue()
        event = await self.queue.get()
        if event is None:
            raise StopAsyncIteration
        return json.dumps(event)

    async def close(self):
        pass


class InterpretTests(AccountTestCase):
    """realtime-interpret: the 即時口譯 page for administrators, the Azure proxy, saved sessions and their cost."""

    KEY = "test-key-not-real-0123"

    def setUp(self):
        super().setUp()
        for fake in (patch.multiple("interpret", ENDPOINT="https://example-translate.services.ai.azure.com", KEY=self.KEY,
                                    DEPLOYMENT="gpt-realtime-translate", TRANSCRIBE=""),):
            fake.start()
            self.addCleanup(fake.stop)

    def connect_with(self, azure):
        calls = []

        async def connect(url, **kwargs):
            calls.append((url, kwargs))
            return azure
        return patch("interpret.websockets.connect", side_effect=connect), calls

    def closed_code(self, websocket):
        with self.assertRaises(WebSocketDisconnect) as closed:
            for _ in range(50):
                websocket.receive_json()
        return closed.exception.code

    def run_session(self, events, target="en", source="zh", audio=b"\x01\x00" * 24000, source_text=None, client=None):
        """One session: start, one chunk of audio, the source text, stop. Returns (messages, Azure fake, connect calls)."""
        azure = FakeAzureTranslate(events)
        connect, calls = self.connect_with(azure)
        messages = []
        with connect, (client or self.signed_in("admin")).websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": target, "sourceLang": source})
            messages.append(websocket.receive_json())
            websocket.send_bytes(audio)
            if source_text is not None:
                websocket.send_json({"type": "source", "text": source_text})
            websocket.send_json({"type": "stop"})
            try:
                while True:
                    messages.append(websocket.receive_json())
            except WebSocketDisconnect:
                pass
        return messages, azure, calls

    # --- The interpret page is for system administrators

    def test_who_can_open_the_page(self):
        self.assertEqual(self.signed_in("admin").get("/interpret").status_code, 200)
        member = self.signed_in("alice").get("/interpret")   # 我的紀錄: every user's own records
        self.assertEqual(member.status_code, 200)
        self.assertIn("我的紀錄", member.text)
        anonymous = TestClient(app).get("/interpret", follow_redirects=False)
        self.assertEqual((anonymous.status_code, anonymous.headers["location"]), (303, "/login?next=%2Finterpret"))
        for path in ("/api/admin/interpret-usage", "/api/admin/interpret-access"):
            self.assertEqual(self.signed_in("alice").get(path).status_code, 403, path)
            self.assertEqual(TestClient(app).get(path).status_code, 401, path)
        self.assertEqual(self.signed_in("alice").get("/api/interpret/sessions").json(), [])   # every user has records
        self.assertEqual(TestClient(app).get("/api/interpret/sessions").status_code, 401)
        self.assertFalse(self.signed_in("alice").get("/api/interpret/config").json()["allowed"])
        self.assertEqual(TestClient(app).get("/api/interpret/config").status_code, 401)

    # --- Interpreting is open to granted users

    def test_who_may_interpret(self):
        admin = self.signed_in("admin")
        self.assertEqual(admin.post("/api/admin/interpret-access", json={"username": " Alice "}).json(), {"username": "alice"})
        self.assertEqual(self.query("SELECT username, granted_by FROM interpret_access"), [("alice", "admin")])
        for user, expected in (("admin", True), ("alice", True), ("bob", False)):
            self.assertEqual(self.signed_in(user).get("/api/interpret/config").json()["allowed"], expected, user)
        self.assertEqual(admin.post("/api/admin/interpret-access", json={"username": "Bad Name"}).status_code, 422)
        self.assertEqual(self.signed_in("alice").post("/api/admin/interpret-access", json={"username": "bob"}).status_code, 403)
        self.assertEqual([g["username"] for g in admin.get("/api/admin/interpret-access").json()], ["alice"])
        messages, _, calls = self.run_session([], client=self.signed_in("alice"))
        self.assertEqual((messages[0], len(calls)), ({"type": "status", "state": "connected"}, 1))   # granted: interprets
        self.assertEqual(admin.delete("/api/admin/interpret-access/alice").status_code, 200)
        self.assertEqual(admin.delete("/api/admin/interpret-access/alice").status_code, 404)
        self.assertEqual(admin.delete("/api/admin/interpret-access/Bad%20Name").status_code, 422)
        self.assertFalse(self.signed_in("alice").get("/api/interpret/config").json()["allowed"])
        connect, calls = self.connect_with(FakeAzureTranslate([]))
        with connect, self.signed_in("alice").websocket_connect("/ws/interpret") as websocket:
            self.assertEqual(self.closed_code(websocket), 4403)
        self.assertEqual(calls, [])

    def test_every_user_sees_only_their_own_records(self):
        self.signed_in("admin").post("/api/admin/interpret-access", json={"username": "alice"})
        sid = self.run_session([{"type": "session.output_transcript.delta", "delta": "Hi"}], client=self.signed_in("alice"))[0][-1]["saved"]
        self.signed_in("admin").delete("/api/admin/interpret-access/alice")   # records stay readable without access
        alice, bob = self.signed_in("alice"), self.signed_in("bob")
        listed = alice.get("/api/interpret/sessions").json()
        self.assertEqual([(s["id"], s["kind"]) for s in listed], [(sid, "interpret")])
        self.assertEqual(alice.get(f"/api/interpret/sessions/{sid}").json()["kind"], "interpret")
        self.assertEqual(bob.get("/api/interpret/sessions").json(), [])
        for path in (f"/api/interpret/sessions/{sid}", f"/api/interpret/sessions/{sid}/bars", f"/api/interpret/sessions/{sid}/input.wav"):
            self.assertEqual(bob.get(path).status_code, 404, path)
            self.assertEqual(alice.get(path).status_code, 200, path)
        self.assertEqual(bob.put(f"/api/interpret/sessions/{sid}/translation", json={"text": "x"}).status_code, 404)
        self.assertEqual(alice.put(f"/api/interpret/sessions/{sid}/translation", json={"text": "x"}).status_code, 409)   # interpreting
        # A 即時翻譯 record: its translation comes from the page, and it has no translated audio.
        folder = self.output / "interpret" / "alice" / sid
        data = json.loads((folder / "session.json").read_text(encoding="utf-8")) | {"kind": "translate", "sourceText": "大家好"}
        (folder / "session.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        (folder / "output.wav").unlink()
        self.assertEqual(alice.put(f"/api/interpret/sessions/{sid}/translation", json={"text": "Hello everyone."}).status_code, 200)
        self.assertEqual(alice.get(f"/api/interpret/sessions/{sid}").json()["translation"], "Hello everyone.")
        self.assertIn("Hello everyone.", (folder / "transcript.txt").read_text(encoding="utf-8"))
        self.assertEqual(alice.put(f"/api/interpret/sessions/{sid}/translation", json={"text": "x" * 200001}).status_code, 422)
        self.assertEqual(alice.get(f"/api/interpret/sessions/{sid}/output.wav").status_code, 404)
        (folder / "bars.json").unlink()
        self.assertEqual(alice.get(f"/api/interpret/sessions/{sid}/bars").json()["output"], [])
        self.assertEqual(alice.delete(f"/api/interpret/sessions/{sid}").status_code, 200)

    # --- Saved records are kept for a set number of days

    def test_which_folders_a_90_day_sweep_deletes(self):
        owner, now = self.output / "interpret" / "alice", time.time()
        expected = {"20260818-235959": False, "20260819-000000": True, "20261117-101500": True,
                    ".recording-20261115-aaaa": False, ".recording-20261117-bbbb": True}
        for name in expected:
            (owner / name).mkdir(parents=True)
        os.utime(owner / ".recording-20261115-aaaa", (now - 2 * 86400, now - 2 * 86400))
        self.assertEqual(records_retention.sweep_folders(90, date(2026, 11, 17), now), 2)
        self.assertEqual({name: (owner / name).exists() for name in expected}, expected)

    def test_an_administrator_changes_the_period(self):
        admin, today = self.signed_in("admin"), datetime.now(ZoneInfo(team_access.MEETING_TIMEZONE)).date()
        self.assertEqual(admin.get("/api/admin/records-retention").json(), {"days": 90})
        self.assertEqual(self.signed_in("alice").get("/api/interpret/config").json()["retentionDays"], 90)
        owner = self.output / "interpret" / "alice"
        old, kept = (today - timedelta(days=31)).strftime("%Y%m%d-120000"), (today - timedelta(days=30)).strftime("%Y%m%d-000000")
        for name in (old, kept):
            (owner / name).mkdir(parents=True)
        for body in ({"days": 0}, {"days": "90"}, {"days": 3651}, {"days": 30.5}):
            self.assertEqual(admin.put("/api/admin/records-retention", json=body).status_code, 422, body)
        self.assertEqual(self.signed_in("alice").put("/api/admin/records-retention", json={"days": 30}).status_code, 403)
        self.assertTrue((owner / old).exists())   # nothing changed yet
        self.assertEqual(admin.put("/api/admin/records-retention", json={"days": 30}).json(), {"days": 30})
        self.assertEqual((admin.get("/api/admin/records-retention").json(), (owner / old).exists(), (owner / kept).exists()),
                         ({"days": 30}, False, True))   # swept right away
        self.assertEqual(self.signed_in("alice").get("/api/interpret/config").json()["retentionDays"], 30)
        self.assertEqual(self.query("SELECT updated_by FROM app_settings"), [("admin",)])

    def test_access_withdrawn_during_a_session(self):
        self.signed_in("admin").post("/api/admin/interpret-access", json={"username": "alice"})
        connect, _ = self.connect_with(FakeAzureTranslate([{"type": "session.output_transcript.delta", "delta": "Hi"}]))
        with connect, patch("stream_limits.STREAM_RECHECK_MINUTES", 0), \
                self.signed_in("alice").websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            websocket.receive_json()
            websocket.send_bytes(b"\x01\x00" * 2400)
            self.assertEqual(websocket.receive_json(), {"type": "out", "delta": "Hi"})   # the first chunk is in
            with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
                conn.execute("DELETE FROM interpret_access")
            websocket.send_bytes(b"\x01\x00" * 2400)
            self.assertEqual(self.closed_code(websocket), 4403)
        self.assertEqual(len(list((self.output / "interpret" / "alice").iterdir())), 1)   # what there was is saved

    def test_the_config_names_the_languages_and_never_the_key(self):
        response = self.signed_in("admin").get("/api/interpret/config")
        config = response.json()
        self.assertEqual((config["configured"], config["usdPerHour"], len(config["targets"])), (True, 2.04, 58))
        self.assertIn("zh", config["targets"])
        self.assertNotIn("zh-TW", config["targets"])
        self.assertNotIn(self.KEY, response.text)
        self.assertNotIn("example-translate", response.text)

    def test_members_and_strangers_are_closed_before_azure(self):
        connect, calls = self.connect_with(FakeAzureTranslate([]))
        with connect:
            with self.signed_in("alice").websocket_connect("/ws/interpret") as websocket:
                self.assertEqual(self.closed_code(websocket), 4403)
            with TestClient(app).websocket_connect("/ws/interpret") as websocket:
                self.assertEqual(self.closed_code(websocket), 4401)
        self.assertEqual(calls, [])

    # --- Translation is proxied with the key kept on the server

    def test_an_unsupported_language_or_no_configuration_closes_before_azure(self):
        connect, calls = self.connect_with(FakeAzureTranslate([]))
        client = self.signed_in("admin")
        with connect:
            with client.websocket_connect("/ws/interpret") as websocket:
                websocket.send_json({"target": "zh-TW", "sourceLang": "zh"})
                self.assertEqual(self.closed_code(websocket), 4400)
            with patch("interpret.KEY", ""), client.websocket_connect("/ws/interpret") as websocket:
                websocket.send_json({"target": "en", "sourceLang": "zh"})
                self.assertEqual(self.closed_code(websocket), 4503)
            with patch("interpret.KEY", ""):
                self.assertFalse(client.get("/api/interpret/config").json()["configured"])
        self.assertEqual(calls, [])

    def test_no_start_message_closes_4408(self):
        with patch("stream_limits.STREAM_HEADER_TIMEOUT", 0.2), self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            self.assertEqual(self.closed_code(websocket), 4408)

    def test_translating_to_chinese_reaches_the_page_in_taiwan_wording(self):
        pcm = b"\x02\x00" * 4800
        events = [{"type": "session.output_transcript.delta", "delta": "这个软件"},
                  {"type": "session.output_audio.delta", "delta": base64.b64encode(pcm).decode()}]
        with self.assertLogs("uvicorn.error", level="DEBUG") as logs:
            logging.getLogger("uvicorn.error").debug("interpret test")
            messages, azure, calls = self.run_session(events, target="zh", source="en", source_text="This software")
        self.assertIn({"type": "out", "delta": "這個軟體"}, messages)
        self.assertIn({"type": "audio", "audio": base64.b64encode(pcm).decode()}, messages)
        url, kwargs = calls[0]
        self.assertEqual(url, "wss://example-translate.services.ai.azure.com/openai/v1/realtime/translations?model=gpt-realtime-translate")
        self.assertEqual(kwargs["additional_headers"], {"api-key": self.KEY})
        self.assertEqual(azure.sent[0], {"type": "session.update", "session": {"audio": {"output": {"language": "zh"}}}})
        self.assertEqual(azure.sent[1]["type"], "session.input_audio_buffer.append")
        self.assertEqual(base64.b64decode(azure.sent[1]["audio"]), b"\x01\x00" * 24000)
        self.assertEqual(azure.sent[-1], {"type": "session.close"})
        self.assertNotIn(self.KEY, json.dumps(messages, ensure_ascii=False) + "\n".join(logs.output))

    def test_too_much_audio_closes_4413(self):
        with patch("stream_limits.MAX_STREAM_HOURS", 1 / 3600):   # one second: 48,000 bytes at 24 kHz
            azure = FakeAzureTranslate([])
            connect, _ = self.connect_with(azure)
            with connect, self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
                websocket.send_json({"target": "en", "sourceLang": "zh"})
                websocket.receive_json()
                websocket.send_bytes(b"\x00" * 48000)
                websocket.send_bytes(b"\x00" * 2)
                self.assertEqual(self.closed_code(websocket), 4413)
        appended = [m for m in azure.sent if m["type"] == "session.input_audio_buffer.append"]
        self.assertEqual(len(appended), 1)

    # --- Sessions are saved for their owner

    def test_placing_translated_audio(self):
        second = lambda s: b"\x01\x00" * int(24000 * s)
        for arrivals, pieces in ((((2.0, 3), (4.0, 3)), ((2.0, 5.0), (5.0, 8.0))),
                                 (((1.0, 1), (5.0, 2)), ((1.0, 2.0), (5.0, 7.0))),
                                 (((0.5, 2),), ((0.5, 2.5),))):
            folder = self.output / "interpret" / "placing"
            rec = interpret.Recording(folder, {"target": "en"})
            for at, length in arrivals:
                rec.add_piece(at, second(length))
            with wave.open(str(folder / rec.save(0.0) / "output.wav")) as audio:
                track = audio.readframes(audio.getnframes())
            shutil.rmtree(folder)
            samples = struct.unpack(f"<{len(track) // 2}h", track)
            spans, start = [], None
            for i, value in enumerate(samples + (0,)):
                if value and start is None:
                    start = i
                elif not value and start is not None:
                    spans.append((start / 24000, i / 24000))
                    start = None
            # Two pieces back to back read as one span of sound; compare where sound is with the expected union.
            expected, merged = [], []
            for a, b in pieces:
                if merged and merged[-1][1] == a:
                    merged[-1] = (merged[-1][0], b)
                else:
                    merged.append((a, b))
            self.assertEqual(spans, merged, arrivals)
            self.assertEqual(len(track) / 48000, pieces[-1][1], arrivals)

    def test_a_saved_session_and_its_cost(self):
        pcm = b"\x05\x00" * int(24000 * 15.4)
        events = [{"type": "session.output_audio.delta", "delta": base64.b64encode(pcm).decode()},
                  {"type": "session.output_transcript.delta", "delta": "Hello."}]
        messages, _, _ = self.run_session(events, audio=b"\x01\x00" * 24000 * 10, source_text="你好。")
        closed = messages[-1]
        self.assertEqual((closed["state"], closed["usd"], closed["outputSeconds"], closed["inputSeconds"]), ("closed", 0.0087, 15.4, 10.0))
        folder = self.output / "interpret" / "admin" / closed["saved"]
        self.assertTrue(re.fullmatch(r"\d{8}-\d{6}", closed["saved"]))
        data = json.loads((folder / "session.json").read_text(encoding="utf-8"))
        self.assertEqual(closed["saved"], re.sub(r"\D", "", data["startedAt"])[:8] + "-" + re.sub(r"\D", "", data["startedAt"])[8:])   # the id is the start time
        self.assertEqual((data["sourceText"], data["translation"], data["target"], data["engine"], data["usd"]), ("你好。", "Hello.", "en", "local", 0.0087))
        with wave.open(str(folder / "input.wav")) as audio:
            self.assertEqual((audio.getframerate(), audio.getnframes()), (24000, 240000))
        self.assertIn("你好。", (folder / "transcript.txt").read_text(encoding="utf-8"))
        self.assertEqual(self.query("SELECT purpose, username, seconds FROM interpret_usage"), [("live", "admin", 15.4)])
        self.assertNotIn(self.KEY, "".join(p.read_text(encoding="utf-8") for p in folder.glob("*.json")))

    def test_a_session_is_saved_when_the_usage_cannot_be_written(self):
        events = [{"type": "session.output_audio.delta", "delta": base64.b64encode(b"\x01\x00" * 2400).decode()}]
        with patch("interpret_usage.record", side_effect=OSError("database down")), self.assertLogs("uvicorn.error", level="WARNING") as logs:
            messages, _, _ = self.run_session(events)
        self.assertTrue(messages[-1]["saved"])
        self.assertIn("interpret usage not recorded (0.1 s, live): OSError", "\n".join(logs.output))

    def test_two_pieces_of_translated_speech_make_six_seconds(self):
        three = base64.b64encode(b"\x02\x00" * 24000 * 3).decode()
        events = [{"type": "session.output_audio.delta", "delta": three}] * 2
        closed = self.run_session(events, audio=b"\x01\x00" * 24000 * 10)[0][-1]
        self.assertEqual((closed["inputSeconds"], closed["outputSeconds"], closed["usd"]), (10.0, 6.0, 0.0034))
        data = json.loads((self.output / "interpret" / "admin" / closed["saved"] / "session.json").read_text(encoding="utf-8"))
        self.assertEqual(data["outputSeconds"], 6.0)

    def test_the_translation_service_unreachable_says_so_and_saves_nothing(self):
        async def refuse(url, **kwargs):
            raise OSError("connection refused")
        with patch("interpret.websockets.connect", side_effect=refuse), self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            self.assertEqual(websocket.receive_json()["type"], "error")
            self.assertEqual(self.closed_code(websocket), 1011)
        self.assertFalse((self.output / "interpret").exists())

    def test_a_failed_save_is_reported(self):
        events = [{"type": "session.output_transcript.delta", "delta": "Hi"}]
        with patch("interpret.Recording.save", side_effect=OSError("disk full")), self.assertLogs("uvicorn.error", level="ERROR"):
            messages = self.run_session(events)[0]
        self.assertIn({"type": "error", "message": "存檔失敗"}, messages)
        self.assertIsNone(messages[-1]["saved"])

    def test_too_many_streams_close_4429_before_azure(self):
        connect, calls = self.connect_with(FakeAzureTranslate([]))
        with connect, patch("stream_limits.MAX_STREAMS_PER_USER", 0), self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            self.assertEqual(self.closed_code(websocket), 4429)
        self.assertEqual(calls, [])

    def test_the_service_ending_the_session_is_reported_and_what_there_is_saved(self):
        events = [{"type": "session.output_transcript.delta", "delta": "Hi"}, None]   # None: the service closes
        connect, _ = self.connect_with(FakeAzureTranslate(events))
        messages = []
        with connect, self.assertLogs("uvicorn.error", level="WARNING"), self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            websocket.receive_json()
            websocket.send_bytes(b"\x01\x00" * 2400)
            with self.assertRaises(WebSocketDisconnect) as ended:
                while True:
                    messages.append(websocket.receive_json())
        self.assertEqual(ended.exception.code, 1011)
        self.assertIn("翻譯服務中斷了連線", next(m["message"] for m in messages if m["type"] == "error"))
        self.assertTrue(messages[-1]["saved"])

    def test_a_session_that_ends_stops_the_interpreting(self):
        real, signed_out = auth.session_user, []

        async def session_user(token):   # signed in when the page opens, signed out once interpreting has started
            return None if signed_out else await real(token)
        connect, _ = self.connect_with(FakeAzureTranslate([]))
        with connect, patch("stream_limits.STREAM_RECHECK_MINUTES", 0), patch("auth.session_user", side_effect=session_user), \
                self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            websocket.receive_json()
            signed_out.append(True)
            websocket.send_bytes(b"\x01\x00" * 2400)
            self.assertEqual(self.closed_code(websocket), 4401)

    def test_a_session_without_audio_is_not_saved(self):
        azure = FakeAzureTranslate([])
        connect, _ = self.connect_with(azure)
        with connect, self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            websocket.receive_json()
            websocket.send_json({"type": "stop"})
            closed = websocket.receive_json()
        self.assertEqual((closed["state"], closed["saved"]), ("closed", None))
        self.assertFalse((self.output / "interpret").exists())

    def test_another_administrators_session_is_not_found(self):
        events = [{"type": "session.output_transcript.delta", "delta": "Hi"}]
        with patch("auth.ADMIN_USERS", frozenset({"admin", "bob"})):
            sid = self.run_session(events)[0][-1]["saved"]
            owner, other = self.signed_in("admin"), self.signed_in("bob")
            self.assertEqual([s["id"] for s in owner.get("/api/interpret/sessions").json()], [sid])
            self.assertEqual(other.get("/api/interpret/sessions").json(), [])
            for path in (f"/api/interpret/sessions/{sid}", f"/api/interpret/sessions/{sid}/input.wav"):
                self.assertEqual(other.get(path).status_code, 404, path)
                self.assertEqual(owner.get(path).status_code, 200, path)
            self.assertEqual(other.delete(f"/api/interpret/sessions/{sid}").status_code, 404)
            for bad in (f"/api/interpret/sessions/{sid}/session.json", "/api/interpret/sessions/..%2F..%2Fteams",
                        "/api/interpret/sessions/20261117-1746/input.wav", f"/api/interpret/sessions/{sid}/..%2Fsession.json"):
                self.assertEqual(owner.get(bad).status_code, 404, bad)
            self.assertEqual(owner.delete(f"/api/interpret/sessions/{sid}").status_code, 200)
            self.assertEqual(owner.get("/api/interpret/sessions").json(), [])
            self.assertEqual(owner.get(f"/api/interpret/sessions/{sid}").status_code, 404)

    def test_audio_is_on_disk_during_the_session(self):
        azure = FakeAzureTranslate([])
        connect, _ = self.connect_with(azure)
        client = self.signed_in("admin")
        with connect, client.websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            websocket.receive_json()
            for _ in range(3):
                websocket.send_bytes(b"\x01\x00" * 2400)
            for _ in range(50):   # the server writes as it receives; wait until the third chunk is in
                working = list((self.output / "interpret" / "admin").glob(".recording-*"))
                if working and (working[0] / "input.wav").stat().st_size == 44 + 14400:
                    break
                time.sleep(0.02)
            self.assertEqual(len(working), 1)
            self.assertEqual((working[0] / "input.wav").stat().st_size, 44 + 14400)
            self.assertEqual(client.get("/api/interpret/sessions").json(), [])
            self.assertEqual(client.get(f"/api/interpret/sessions/{working[0].name}").status_code, 404)
            websocket.send_json({"type": "stop"})
            closed = websocket.receive_json()
        self.assertEqual([p.name for p in (self.output / "interpret" / "admin").iterdir()], [closed["saved"]])

    def test_the_waveform_of_a_session(self):
        full = b"\xff\x7f"
        events = [{"type": "session.output_audio.delta", "delta": base64.b64encode(full * 4800 + b"\x00\x00" * 2400).decode()}]
        with patch("interpret.Recording.clock", return_value=1.0):
            sid = self.run_session(events, audio=full * 7200)[0][-1]["saved"]
        owner = self.signed_in("admin")
        expected = {"step": 0.1, "input": [1.0, 1.0, 1.0], "output": [[1.0, 1.0], [1.1, 1.0]]}
        self.assertEqual(owner.get(f"/api/interpret/sessions/{sid}/bars").json(), expected)
        (self.output / "interpret" / "admin" / sid / "bars.json").unlink()   # a session saved before bars.json
        self.assertEqual(owner.get(f"/api/interpret/sessions/{sid}/bars").json(), expected)
        with patch("auth.ADMIN_USERS", frozenset({"admin", "bob"})):
            self.assertEqual(self.signed_in("bob").get(f"/api/interpret/sessions/{sid}/bars").status_code, 404)
        self.assertEqual(owner.get("/api/interpret/sessions/2026-11-17/bars").status_code, 404)
        self.assertEqual(self.signed_in("alice").get(f"/api/interpret/sessions/{sid}/bars").status_code, 404)   # not hers
        part = owner.get(f"/api/interpret/sessions/{sid}/input.wav", headers={"Range": "bytes=44-4843"})   # replay seeks
        self.assertEqual((part.status_code, len(part.content)), (206, 4800))

    def test_applying_source_messages(self):
        for held, message, after in (("大家好", {"keep": 3, "text": "，今天"}, "大家好，今天"),
                                     ("大家好，今天", {"keep": 4, "text": "明天"}, "大家好，明天"),
                                     ("大家好", {"text": "你好"}, "你好"),
                                     ("大家好", {"keep": 9, "text": "。"}, "大家好"),
                                     ("大家好", {"keep": -1, "text": "。"}, "大家好"),
                                     ("大家好", {"keep": True, "text": "。"}, "大家好"),
                                     ("大家好", {"keep": "3", "text": "。"}, "大家好")):
            azure = FakeAzureTranslate([])
            connect, _ = self.connect_with(azure)
            with connect, self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
                websocket.send_json({"target": "en", "sourceLang": "zh"})
                websocket.receive_json()
                websocket.send_bytes(b"\x01\x00" * 2400)
                websocket.send_json({"type": "source", "text": held})
                websocket.send_json({"type": "source"} | message)
                websocket.send_json({"type": "stop"})
                sid = websocket.receive_json()["saved"]
            saved = self.signed_in("admin").get(f"/api/interpret/sessions/{sid}").json()["sourceText"]
            self.assertEqual(saved, after, message)
            shutil.rmtree(self.output / "interpret" / "admin" / sid)

    def test_the_source_text_grows_by_its_changes(self):
        azure = FakeAzureTranslate([])
        connect, _ = self.connect_with(azure)
        with connect, self.signed_in("admin").websocket_connect("/ws/interpret") as websocket:
            websocket.send_json({"target": "en", "sourceLang": "zh"})
            websocket.receive_json()
            websocket.send_bytes(b"\x01\x00" * 2400)
            for keep, text in ((0, "大家好"), (3, "，今天"), (6, "開會")):
                websocket.send_json({"type": "source", "keep": keep, "text": text})
            websocket.send_json({"type": "stop"})
            sid = websocket.receive_json()["saved"]
        self.assertEqual(self.signed_in("admin").get(f"/api/interpret/sessions/{sid}").json()["sourceText"], "大家好，今天開會")

    def test_a_name_unfit_for_a_path_gets_its_own_folder(self):
        self.assertEqual(interpret.user_dir("t05313").name, "t05313")
        for name in ("..", "a/b", "A", "domain\\user"):
            folder = interpret.user_dir(name)
            self.assertTrue(folder.name.startswith("u-"), name)
            self.assertEqual(folder.parent, self.output / "interpret")

    # --- Translation cost is recorded for administrators

    def test_usage_figures_follow_the_example_table(self):
        for seconds, price, usd in ((0, 2.04, 0), (1800, 2.04, 1.02), (129, 2.04, 0.07), (3600, 3, 3)):
            self.query("DELETE FROM interpret_usage RETURNING 1")
            with patch("interpret_usage.USD_PER_HOUR", price):
                if seconds:
                    asyncio.run(interpret_usage.record("lab", seconds))
                total = asyncio.run(interpret_usage.summary())
            self.assertEqual((total["usd"], total["usdPerHour"]), (usd, price), seconds)

    def test_usage_by_hand_and_for_administrators(self):
        self.assertEqual(interpret_usage.main(["add", "129", "lab"]), 0)
        for argv in (["add", "-5", "lab"], ["add", "inf", "lab"], ["add", "nan", "lab"], ["add", "60", "Lab Run"]):
            self.assertEqual(interpret_usage.main(argv), 2, argv)
        asyncio.run(interpret_usage.record("live", 1800, "alice"))
        self.assertEqual(self.signed_in("alice").get("/api/admin/interpret-usage").status_code, 403)
        usage = self.signed_in("admin").get("/api/admin/interpret-usage").json()
        self.assertEqual((usage["seconds"], usage["usd"], usage["usdPerHour"], usage["byPurpose"]), (1929, 1.09, 2.04, {"lab": 129, "live": 1800}))
        self.assertEqual(usage["byUser"], {"": 129, "alice": 1800})   # usage per user; '' = entered by hand
        self.assertEqual(asyncio.run(mai_usage.summary())["seconds"], 0)   # not part of the MAI budget


class PlainWordingTests(unittest.TestCase):
    """Visible text names no supplier, model or technology (plain-wording spec)."""

    STATIC = Path(__file__).resolve().parent / "static"
    FORBIDDEN = re.compile(r"Azure|(?<![A-Za-z])MAI(?![A-Za-z])|Confucius|Qwen|DeepSeek|Gemma|GPT|OpenAI|LDAP|Docker"
                           r"|WebSocket|vLLM|MINUTES_|TRANSLATE_|AZURE_|\.env|模型")
    CHINESE = re.compile(r"[㐀-鿿]")

    @staticmethod
    def visible_strings(source: str) -> list[str]:
        """Text between tags, title/placeholder/aria-label/alt values and string literals, comments removed."""
        source = re.sub(r"<!--.*?-->|/\*.*?\*/", "", source, flags=re.S)
        source = re.sub(r"(?m)(^|[\s;{}(),])//[^\n]*", r"\1", source)
        found = re.findall(r">([^<>]+)<", source)
        found += re.findall(r"""\b(?:title|placeholder|aria-label|alt)=(?:"([^"]*)"|'([^']*)')""", source)
        found += re.findall(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`]*)`""", source)
        return [s for item in found for s in (item if isinstance(item, tuple) else (item,)) if s]

    @classmethod
    def offending_pieces(cls, text: str) -> list[tuple[str, list[str]]]:
        """Pieces that hold Chinese and a forbidden word; code around a template's ${…} is not text."""
        pieces = re.split(r"\$\{|[\n;`'\"{}]", text)
        return [(p.strip(), words) for p in pieces if cls.CHINESE.search(p) and (words := cls.FORBIDDEN.findall(p))]

    @classmethod
    def offending(cls, text: str) -> list[str]:
        return [w for _, words in cls.offending_pieces(text) for w in words]

    def test_the_example_strings(self):
        self.assertEqual(self.offending("雲端 MAI（音訊會傳送到 Azure）"), ["MAI", "Azure"])
        self.assertEqual(self.offending("紀要模型未設定，無法產生（請在 .env 設定 MINUTES_*）"), ["模型", ".env", "MINUTES_"])
        self.assertEqual(self.offending("雲端辨識（音訊會傳送到外部服務）"), [])
        self.assertEqual(self.offending("engine === 'mai'"), [])

    def test_pages_and_server_messages_name_no_technology(self):
        problems = []
        for path in sorted([*self.STATIC.glob("*.html"), *self.STATIC.glob("*.js")]):
            for text in self.visible_strings(path.read_text(encoding="utf-8")):
                problems += [f"{path.name}: {'、'.join(dict.fromkeys(words))} in {piece[:60]!r}"
                             for piece, words in self.offending_pieces(text)]
        problems = list(dict.fromkeys(problems))
        messages = {"minutes.NOT_CONFIGURED": minutes.NOT_CONFIGURED, "qa.NOT_CONFIGURED": qa.NOT_CONFIGURED,
                    "qa.ANSWER_FAILED": qa.ANSWER_FAILED, "interpret.NOT_CONFIGURED": interpret.NOT_CONFIGURED,
                    "interpret.UNREACHABLE": interpret.UNREACHABLE, "auth.LDAP_UNREACHABLE": auth.LDAP_UNREACHABLE}
        problems += [f"{name}: {'、'.join(words)}" for name, text in messages.items() if (words := self.offending(text))]
        self.assertEqual(problems, [], "\n" + "\n".join(problems))


class FakeQualityPass:
    """精準模式 for record-to-meeting tests: answers when finished with the events given, and remembers how it was made."""
    made: list = []
    events: list = []

    def __init__(self, send, language, target, glossary, convert=lambda text: text, engine_language="zhen", engine=None):
        from collections import deque
        self.send, self.fed, self.waiting, self.finished = send, 0, deque(), False
        FakeQualityPass.made.append({"language": language, "target": target, "engine": engine})

    def feed(self, pcm):
        self.fed += len(pcm)

    async def finish(self):
        for event in FakeQualityPass.events:
            await self.send(event)
        self.finished = True

    def cancel(self):
        pass


class RecordToMeetingTests(AccountTestCase):
    """record-to-meeting: a record of 我的紀錄 becomes a team meeting."""

    SENTENCES = [{"startMs": 0, "endMs": 1200, "source": "大家好", "target": "Hello everyone", "detected": "zh"},
                 {"startMs": 1200, "endMs": 2000, "source": "開始吧", "target": "Let us begin", "detected": "zh"}]

    def setUp(self):
        super().setUp()
        FakeQualityPass.made, FakeQualityPass.events = [], []
        self.addCleanup(self.stop_jobs)

    def stop_jobs(self):
        for job in record_meeting.JOBS.values():
            if job.get("task"):
                job["task"].cancel()
        record_meeting.JOBS.clear()

    def record(self, user="alice", sid="20261118-140300", kind="translate", rate=16000, seconds=2, segments=None,
               source="zh", target="en"):
        """A record written straight to its folder, as a session saves it."""
        folder = self.output / "interpret" / user / sid
        folder.mkdir(parents=True)
        with wave.open(str(folder / "input.wav"), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(rate)
            audio.writeframes(b"\x01\x00" * rate * seconds)
        data = {"startedAt": "2026-11-18 14:03:00", "kind": kind, "target": target, "sourceLang": source, "engine": "local", "id": sid,
                "inputSeconds": seconds, "sourceText": "大家好開始吧", "translation": "Hello everyone. Let us begin."}
        if segments is not None:
            data["segments"] = segments
        (folder / "session.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return folder

    def quality_on(self):
        for fake in (patch.multiple("quality_pass", URL="http://quality.test", MODEL="text-model", ASR_MODEL="Qwen3-ASR"),
                     patch("quality_pass.QualityPass", FakeQualityPass)):
            fake.start()
            self.addCleanup(fake.stop)

    # --- 即時翻譯 records keep their sentences

    def test_a_translate_session_keeps_its_sentences(self):
        upstream = AudioUntilEos(32000)
        with patch("server.websockets.connect", return_value=upstream):
            with self.signed_in("alice").websocket_connect("/ws/transcribe") as websocket:
                websocket.send_json({"mode": "translate", "language": "zh", "target": "en"})
                websocket.send_bytes(b"\x00\x01" * 16000)
                events = [websocket.receive_json(), websocket.receive_json()]
                token = next(e["record"] for e in events if "record" in e)
                live = f"/api/interpret/live/{token}/translation"
                alice = self.signed_in("alice")
                for bad in ([{**self.SENTENCES[0], "startMs": 1200, "endMs": 800}], [self.SENTENCES[0]] * 5001,
                            [{**self.SENTENCES[0], "source": "x" * 2001}], [{**self.SENTENCES[0], "startMs": -1}]):
                    self.assertEqual(alice.put(live, json={"text": "x", "segments": bad}).status_code, 422)
                self.assertEqual(alice.put(live, json={"text": "Hello everyone", "segments": self.SENTENCES[:1]}).status_code, 200)
                websocket.send_text("YOUDAO_ONETIME_ASR_STREAM_EOS")
                saved = websocket.receive_json()["saved"]
        folder = self.output / "interpret" / "alice" / saved
        self.assertEqual(json.loads((folder / "session.json").read_text(encoding="utf-8"))["segments"], self.SENTENCES[:1])
        alice = self.signed_in("alice")
        # Once more after saving, all of them; a request without sentences keeps the text only, and the sentences stay.
        self.assertEqual(alice.put(f"/api/interpret/sessions/{saved}/translation", json={"text": "both", "segments": self.SENTENCES}).status_code, 200)
        self.assertEqual(alice.put(f"/api/interpret/sessions/{saved}/translation", json={"text": "text only"}).status_code, 200)
        data = json.loads((folder / "session.json").read_text(encoding="utf-8"))
        self.assertEqual((data["translation"], data["segments"]), ("text only", self.SENTENCES))
        listed = alice.get("/api/interpret/sessions").json()[0]
        self.assertEqual((listed["segments"], listed["meetingId"], listed["cannotConvert"]), (True, None, ""))

    # --- Turning a record into a meeting

    def test_a_record_with_sentences_becomes_a_meeting_at_once(self):
        team = self.team("產品部", "alice")
        folder = self.record(segments=self.SENTENCES)
        alice = self.signed_in("alice")
        answer = alice.post("/api/interpret/sessions/20261118-140300/meeting", json={"team_id": team, "title": "週會"})
        self.assertEqual(answer.status_code, 200, answer.text)
        meeting_id = answer.json()["meetingId"]
        row = self.query("SELECT team_id, created_by, title, language, source_language, target_language, audio_bytes, "
                         "to_char(started_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI'), ended_at - started_at FROM meetings")
        self.assertEqual(row, [(team, "alice", "週會", "zh", "zh", "en", 64000, "2026-11-18 14:03", timedelta(seconds=2))])
        self.assertEqual(self.query("SELECT seq, start_ms, end_ms, asr_text, source, live_target, target, detected FROM segments ORDER BY seq"),
                         [(1, 0, 1200, "大家好", "大家好", "Hello everyone", "Hello everyone", "zh"),
                          (2, 1200, 2000, "開始吧", "開始吧", "Let us begin", "Let us begin", "zh")])
        with wave.open(str(self.output / "teams" / str(team) / meeting_id / "audio.wav")) as audio:
            self.assertEqual((audio.getframerate(), audio.getnframes()), (16000, 32000))
        self.assertEqual(alice.get(f"/api/meetings/{meeting_id}").status_code, 200)
        # The record stays, marked, and is not converted twice.
        self.assertEqual(alice.get("/api/interpret/sessions").json()[0]["meetingId"], meeting_id)
        self.assertEqual(alice.get("/api/interpret/sessions/20261118-140300/meeting").json(), {"state": "done", "meetingId": meeting_id})
        again = alice.post("/api/interpret/sessions/20261118-140300/meeting", json={"team_id": team})
        self.assertEqual((again.status_code, again.json()["detail"]["meetingId"]), (409, meeting_id))
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(1,)])
        self.assertTrue((folder / "input.wav").is_file())

    def test_the_default_title_and_who_may_convert(self):
        mine, theirs = self.team("產品部", "alice"), self.team("業務", "bob")
        self.record(segments=self.SENTENCES)
        alice, bob = self.signed_in("alice"), self.signed_in("bob")
        self.assertEqual(alice.post("/api/interpret/sessions/20261118-140300/meeting", json={"team_id": theirs}).status_code, 404)
        self.assertEqual(bob.post("/api/interpret/sessions/20261118-140300/meeting", json={"team_id": theirs}).status_code, 404)
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])
        self.assertEqual(alice.post("/api/interpret/sessions/20261118-140300/meeting", json={"team_id": mine, "title": "  "}).status_code, 200)
        self.assertEqual(self.query("SELECT title FROM meetings"), [("即時翻譯 2026-11-18 14:03",)])

    # --- Records without sentences go through 精準模式

    def test_24_khz_keeps_two_samples_of_three(self):
        pcm = array.array("h", [0, 1, 2, 3, 4, 5, 6]).tobytes()
        self.assertEqual(array.array("h", record_meeting.to_16k(pcm, 24000)).tolist(), [0, 1, 3, 4])
        self.assertEqual(record_meeting.to_16k(pcm, 16000), pcm)

    def test_an_interpreted_session_through_quality(self):
        self.quality_on()
        team = self.team("產品部", "alice")
        folder = self.record(kind="interpret", rate=24000, seconds=2, source="en", target="zh")
        FakeQualityPass.events = [
            {"quality": {"seq": 1, "throughMs": 1500, "final": False, "sentences": [
                {"id": 1, "source": "Hello all", "target": "大家好", "lang": "en", "startMs": 0, "endMs": 900},
                {"id": 2, "source": "today", "target": "今天", "lang": "en", "startMs": 900, "endMs": 1500}]}},
            {"revision": {"seq": 1, "sentences": [{"id": 1, "source": "Hello all, today", "target": "大家好，今天", "merged": [2], "endMs": 1500}]}},
            {"quality": {"seq": 2, "throughMs": 2000, "final": True, "sentences": [
                {"id": 3, "source": "we start.", "target": "我們開始。", "lang": "en", "startMs": 1500, "endMs": 2000}]}}]
        job = {}
        meeting_id = asyncio.run(record_meeting.convert("alice", folder, team, "口譯", job))
        self.assertEqual(FakeQualityPass.made, [{"language": "en", "target": "zh", "engine": "api"}])   # never MAI
        self.assertEqual((job["totalMs"], job["doneMs"]), (2000, 2000))
        self.assertEqual(self.query("SELECT seq, start_ms, end_ms, source, target, detected FROM segments ORDER BY seq"),
                         [(1, 0, 1500, "Hello all, today", "大家好，今天", "en"), (2, 1500, 2000, "we start.", "我們開始。", "en")])
        self.assertEqual(self.query("SELECT audio_bytes FROM meetings"), [(64000,)])   # 2 s at 16 kHz
        with wave.open(str(self.output / "teams" / str(team) / meeting_id / "audio.wav")) as audio:
            self.assertEqual((audio.getframerate(), audio.getnframes()), (16000, 32000))
        self.assertFalse((folder / record_meeting.STAGED).exists())
        self.assertEqual(json.loads((folder / "session.json").read_text(encoding="utf-8"))["meetingId"], meeting_id)

    def test_a_failed_part_creates_no_meeting(self):
        self.quality_on()
        team = self.team("產品部", "alice")
        folder = self.record(kind="interpret", rate=24000)
        FakeQualityPass.events = [
            {"quality": {"seq": 1, "throughMs": 1000, "final": False, "sentences": [
                {"id": 1, "source": "a", "target": "b", "lang": "zh", "startMs": 0, "endMs": 1000}]}},
            {"quality": {"seq": 2, "failed": True, "throughMs": 2000, "final": True}}]
        with self.assertRaises(record_meeting.Failed) as failed:
            asyncio.run(record_meeting.convert("alice", folder, team, "口譯", {}))
        self.assertEqual(str(failed.exception), "部分內容處理失敗，請再試一次")
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])
        self.assertEqual(list(self.output.glob("teams/**/audio.wav")), [])
        self.assertFalse((folder / record_meeting.STAGED).exists())   # the recording being made is not left behind
        self.assertNotIn("meetingId", json.loads((folder / "session.json").read_text(encoding="utf-8")))

    def test_the_end_of_a_record_without_sentences_is_told(self):
        # The last save of a 即時翻譯 session did not arrive: more than 35 s at the end have no sentences.
        record = {"kind": "translate", "inputSeconds": 100, "segments": [{"startMs": 0, "endMs": 60000}]}
        self.assertEqual(record_meeting.missing_tail_ms(record), 40000)
        self.assertEqual(record_meeting.missing_tail_ms(record | {"inputSeconds": 90}), 0)
        self.assertEqual(record_meeting.missing_tail_ms({"kind": "interpret", "inputSeconds": 100}), 0)

    def test_what_the_page_is_told_about_quality_conversions(self):
        team = self.team("產品部", "alice")
        self.record(kind="interpret", rate=24000)
        self.record(sid="20261118-150000", kind="translate")                 # saved before sentences were kept
        self.record(sid="20261118-160000", kind="interpret", target="ko")    # 精準模式 does not translate into Korean
        alice = self.signed_in("alice")
        url = "/api/interpret/sessions/20261118-140300/meeting"
        with patch.multiple("quality_pass", URL="", MODEL="", ASR_MODEL=""):
            not_set = alice.post(url, json={"team_id": team})
        self.assertEqual((not_set.status_code, not_set.json()["detail"]), (503, "精準模式尚未設定，這筆紀錄目前不能轉成會議紀錄"))
        self.quality_on()
        listed = {s["id"]: s["cannotConvert"] for s in alice.get("/api/interpret/sessions").json()}
        self.assertEqual(listed, {"20261118-160000": "精準模式只支援中文、英文、日文，這筆紀錄的語言不能轉成會議紀錄",
                                  "20261118-150000": "", "20261118-140300": ""})
        self.assertEqual(alice.post("/api/interpret/sessions/20261118-160000/meeting", json={"team_id": team}).status_code, 422)

        async def forever(*_args, **_kwargs):
            await asyncio.sleep(3600)
        # One event loop for the whole block (as the server has), so the background conversion keeps running.
        with alice, patch("record_meeting.convert", forever):
            started = alice.post(url, json={"team_id": team})
            self.assertEqual((started.status_code, started.json()["state"]), (202, "running"))
            self.assertEqual(alice.get(url).json()["state"], "running")
            self.assertEqual(alice.post(url, json={"team_id": team}).status_code, 409)              # already running
            self.assertEqual(alice.post("/api/interpret/sessions/20261118-150000/meeting", json={"team_id": team}).status_code, 429)
            task = record_meeting.JOBS[("alice", "20261118-140300")]["task"]
            self.assertEqual(alice.delete("/api/interpret/sessions/20261118-140300").status_code, 200)   # stops the conversion
            self.assertNotIn(("alice", "20261118-140300"), record_meeting.JOBS)
            self.assertTrue(task.cancelling() or task.cancelled())

    def test_two_requests_at_once_and_the_server_wide_limit(self):
        self.quality_on()
        team = self.team("產品部", "alice")
        self.record(segments=self.SENTENCES)
        self.record(sid="20261118-150000", kind="interpret", rate=24000)
        self.record(sid="20261118-160000", kind="translate", segments=[])   # sentences kept but none: 精準模式
        alice = self.signed_in("alice")
        # A request for the same record already being handled (a double click) is refused, never a second meeting.
        record_meeting.CLAIMED.add(("alice", "20261118-140300"))
        try:
            self.assertEqual(alice.post("/api/interpret/sessions/20261118-140300/meeting", json={"team_id": team}).status_code, 409)
        finally:
            record_meeting.CLAIMED.clear()
        self.assertEqual(self.query("SELECT count(*) FROM meetings"), [(0,)])
        # Two conversions of other users are running: a third waits.
        for user in ("bob", "carol"):
            record_meeting.JOBS[(user, "20261118-090000")] = {"state": "running", "doneMs": 0, "totalMs": 0, "error": ""}
        busy = alice.post("/api/interpret/sessions/20261118-150000/meeting", json={"team_id": team})
        self.assertEqual((busy.status_code, busy.json()["detail"]), (429, "目前有其他紀錄正在轉換，請稍後再試"))
        listed = {s["id"]: s["segments"] for s in alice.get("/api/interpret/sessions").json()}
        self.assertEqual(listed["20261118-160000"], False)


if __name__ == "__main__":
    unittest.main()
