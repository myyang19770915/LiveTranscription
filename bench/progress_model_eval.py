"""Real-model check of in-meeting progress detection (meeting-series): five synthetic unfinished action items and ten
transcript scenarios go through the production code (series.build_messages, minutes.call_model, series.clean_updates)
to the configured minutes model; each answer is compared with the expected updates. Nothing is written to the
database. It calls the (possibly paid) model 10 x N times, so run it by hand when the model or the prompt changes.

Run inside the app container (bench/ is not mounted there):
  docker cp bench/progress_model_eval.py asr_confucius4-r2t2-app-1:/tmp/progress_model_eval.py
  docker exec -w /app -e PYTHONPATH=/app asr_confucius4-r2t2-app-1 python /tmp/progress_model_eval.py 3
N (default 1) is how many times each scenario runs. Output: one line per run (ok / BAD with what was missed or
wrongly suggested, or a failed call counted as missed), then {"correct", "missed", "wrong", "errors", "latency_s"}.
"""
import asyncio
import json
import sys
import time
from datetime import datetime, timezone

import minutes
import series

ITEMS = [
    {"id": 101, "content": "在下週五前把合約寄給客戶", "ownerName": "王愛麗", "dueDate": "2026-11-13", "status": "todo"},
    {"id": 102, "content": "月底前完成測試環境的自動部署腳本", "ownerName": "bob", "dueDate": "2026-11-30", "status": "doing"},
    {"id": 103, "content": "詢問客戶是否能接受分批交貨並回覆", "ownerName": "小王", "dueDate": "2026-11-08", "status": "todo"},
    {"id": 104, "content": "把報價單更新成新版格式", "ownerName": "Kevin", "dueDate": None, "status": "todo"},
    {"id": 105, "content": "整理明年行銷預算的簽核流程", "ownerName": "alice", "dueDate": "2026-11-20", "status": "todo"},
]

# (name, segments, expected {item: status}); "?" = either nothing or that status is acceptable.
SCENARIOS = [
    ("明確完成", [
        "好，我們先看上週的待辦。",
        "合約的部分，王愛麗昨天已經寄給客戶了，客戶也回信說收到。",
        "部署腳本呢？",
        "bob 說腳本已經寫完，測試環境現在每天晚上會自動部署。",
        "分批交貨的事小王還沒問，他這週在出差。"], {101: "done", 102: "done"}),
    ("開始進行", [
        "報價單的新版格式我今天早上開始改了，大概改了一半。",
        "預算簽核流程 alice 已經在跟財務部約時間討論。",
        "其他的下次再說。"], {104: "doing", 105: "doing"}),
    ("取消", [
        "分批交貨不用問了，客戶上週已經決定要一次交貨。",
        "行銷預算簽核流程這件事改由財務部統一處理，我們這邊不用整理了。"], {103: "cancelled", 105: "cancelled"}),
    ("只是討論或計畫", [
        "合約裡面付款條件那一段，我覺得還要再跟法務確認。",
        "報價單我等一下會更新，下週給大家看。",
        "部署腳本有遇到一些權限問題，bob 還在處理。",
        "預算的事情下次會議再討論。"], {104: "?doing"}),
    ("問句與否定", [
        "合約寄出去了嗎？",
        "還沒，明天才會寄，因為要等主管簽名。",
        "那分批交貨有問客戶嗎？",
        "還沒有。"], {}),
    ("日文", [
        "デプロイのスクリプトはもう完成しました。毎晩自動でデプロイされています。",
        "契約書はまだ送っていません。"], {102: "done"}),
    ("辨識錯字", [
        "和約已經記給客戶了，對方也簽回來了。",
        "報價單心版各式已經全部改好，上傳到共用資料夾。"], {101: "done", 104: "done"}),
    ("句子被切開", [
        "那個合約的部分，",
        "王愛麗昨天下午已經",
        "寄給客戶了。"], {101: "done"}),
    ("長段落中的一句", [
        *[f"第{n}個議題我們討論了一下時程和人力，大家各自回去再確認。" for n in range(1, 13)],
        "對了，bob 的部署腳本已經全部完成，昨天晚上第一次自動部署成功。",
        *[f"接下來第{n}個議題是客戶回饋，整體評價還不錯。" for n in range(13, 25)]], {102: "done"}),
    ("無關閒聊", [
        "今天午餐要訂什麼？",
        "上次那家便當還不錯。",
        "好，那就訂那家。"], {}),
]


def score(expected: dict, got: list[dict]) -> tuple[int, int, int, list[str]]:
    """(correct, missed, wrong, notes): a '?' expectation accepts either nothing or that status."""
    found = {u["item"]: u["status"] for u in got}
    correct = missed = wrong = 0
    notes = []
    for item, status in expected.items():
        optional = status.startswith("?")
        want = status.lstrip("?")
        if found.get(item) == want:
            correct += 1
        elif item not in found and optional:
            pass
        elif item not in found:
            missed += 1
            notes.append(f"漏了 #{item}→{want}")
        else:
            wrong += 1
            notes.append(f"#{item} 應為 {want}，得到 {found[item]}")
    for item, status in found.items():
        if item not in expected:
            wrong += 1
            notes.append(f"多報 #{item}→{status}")
    return correct, missed, wrong, notes


async def main(runs: int):
    meeting = {"title": "產品週會", "started_at": datetime(2026, 11, 13, 2, 0, tzinfo=timezone.utc)}
    if not minutes.configured():
        sys.exit(minutes.NOT_CONFIGURED)
    totals = [0, 0, 0]
    errors = 0
    latencies = []
    for name, lines, expected in SCENARIOS:
        segs = [{"seq": n, "source": text} for n, text in enumerate(lines, 31)]
        for run in range(runs):
            started = time.monotonic()
            failed_call = False
            try:
                answer = await minutes.call_model(series.build_messages(meeting, ITEMS, [], segs), timeout=series.CHECK_TIMEOUT)
                updates = series.clean_updates(minutes.parse_answer(answer), {i["id"]: i["status"] for i in ITEMS}, {s["seq"] for s in segs})
            except Exception as exc:  # in a meeting this check would simply find nothing: count it as missed
                errors += 1
                failed_call = True
                updates = []
                print(f"BAD {name} #{run + 1}: 呼叫失敗：{type(exc).__name__}: {exc}", flush=True)
            latencies.append(time.monotonic() - started)
            c, m, w, notes = score(expected, updates)
            totals = [totals[0] + c, totals[1] + m, totals[2] + w]
            if failed_call:
                continue
            mark = "ok " if not m and not w else "BAD"
            print(f"{mark} {name} #{run + 1}: " + "; ".join(f"#{u['item']}→{u['status']}（{u['note']}）{u['evidence']}" for u in updates)
                  + (f"  ⇒ {'、'.join(notes)}" if notes else ""), flush=True)
    print(json.dumps({"correct": totals[0], "missed": totals[1], "wrong": totals[2], "errors": errors,
                      "latency_s": {"median": round(sorted(latencies)[len(latencies) // 2], 1), "max": round(max(latencies), 1)}}, ensure_ascii=False))


asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 1))
