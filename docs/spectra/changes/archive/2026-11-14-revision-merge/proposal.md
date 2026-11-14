## Why

回顧修訂（quality-revision）不能改句數，所以第一輪把一句話切在子句中間、分成兩段顯示的情況，修訂只能讓兩段各自通順，讀起來仍是兩句殘句。盲評裡這是修訂後剩下最常被扣分的一類；離線原型允許合併時，同一份內容 10 段全部進步（平均 +3.4，`bench/README.md`「2026-11-14 修正後的完整 10 段與回顧修訂」，量測值）。另外，會議結束時剩下的句子一組一組依序修訂，10 段實測有 3 段最後 5–7 句來不及在 30 秒內完成（量測值）。

## What Changes

- 回顧修訂的回答可以把一句被切開的話所在的連續句子（最多 2 句、同一語言）合併成一句；`revision` 事件帶出被併入的句子編號與新的結束時間。
- 頁面收到合併時移除被併入的段落，原文與譯文兩欄、浮動字幕與匯出都只剩合併後的一句。
- 保留的段落在加入時取得固定的順序編號，之後不因合併而改變；儲存時把合併（併入哪一段、被併的是哪一段）一起送出。
- `PUT /api/meetings/{id}/segments` 接受合併清單：兩段都未校對且沒有修改歷程時，把被併段落的原始辨識文字、即時譯文接到前一段、結束時間延長，並刪除被併的段落；任一段已被校對時兩段都維持原樣。
- 會議結束時還沒修訂的各組同時送出，而不是依序。
- 修訂的日誌多一個 `merged=` 數字。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `quality-pass`: 回顧修訂可以合併句子；段落的順序編號固定、儲存時帶合併清單；結束時各組同時修訂。

## Impact

- 程式：webapp/revise_pass.py、webapp/quality_pass.py、webapp/review.py、webapp/static/quality-view.js、webapp/static/app.js、webapp/static/index.html
- 測試：webapp/test_server.py、bench/qualitycheck.js、bench/quality_e2e.mjs
- 文件：README.md、bench/README.md
- API：`PUT /api/meetings/{id}/segments` 的內容多一個選填欄位 `merged`；段落的順序編號可能不連續（被併的編號不再使用）。
- 資料：不改資料表結構；被併段落的列會被刪除（問答索引的向量列隨外鍵一併刪除）。
- 資料去向與模型不變；結束時同時送出的請求數最多 5 個。
