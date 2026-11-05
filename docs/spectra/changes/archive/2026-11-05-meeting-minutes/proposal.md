## Why

會議有逐字稿、錄音和校對，但決議與待辦還是要人自己整理，散落在文字裡，會後沒人追。roadmap P2 要讓每場會議產出可行動的紀錄：AI 抽出決議、待辦（負責人、到期日）、待確認問題與風險，每條附證據段落，由人確認後才成為正式紀錄。這是 P3「追蹤閉環」的前提。

## What Changes

- 新增「會議紀要」頁（`/meetings/{id}/minutes`），從會議紀錄列表與校對頁進入。
- 「產生紀要」在背景執行：整場會議的段落一次送給紀要模型（不分段；`MINUTES_*` 設定，未設定時沿用雲端精修的 `TRANSLATE_REFINE_*`），產出摘要與條目，頁面顯示狀態。
- 條目分四類：決議、待辦、待確認問題、風險。每條必須附至少一個證據段落；沒有有效證據的條目不採用。
- 待辦的負責人只能是會議所屬團隊的成員；模型提到但對不到成員的名字保留為提示、負責人為「未指派」。到期日以會議日期換算成實際日期，並保留原話（例如「下週五」）。
- AI 條目先是「待確認」；團隊成員可修改內容、類型、負責人、到期日，可確認或駁回，也可手動新增條目（手動新增視為已確認）。摘要可編輯。以版本號偵測同時修改。
- 重新產生只替換仍待確認的 AI 條目；已確認、已駁回、手動新增的條目保留，且不重複產生相同內容。
- 匯出 Markdown 會議紀錄：會議資訊、摘要、已確認的決議與待辦（負責人、到期日）、問題與風險，證據附錄音時間點。
- 條目保留「外部連結」欄位，供之後串接議題追蹤平台。

## Capabilities

### New Capabilities

- `meeting-minutes`: 會議紀要的產生（分段抽取、證據、負責人與到期日對應）、人工確認與編輯、Markdown 匯出

### Modified Capabilities

(none)

## Impact

- 新增：webapp/minutes.py（抽取與紀要 API）、webapp/migrations/004_minutes.sql、webapp/static/minutes.html、webapp/static/minutes.js、webapp/static/minutes.css
- 受影響程式：webapp/server.py（掛上 router）、webapp/static/meetings.html（「紀要」入口）、webapp/static/review.html 與 webapp/static/review.js（「紀要」入口、以網址 `#seg-N` 定位段落）
- 模型：先用雲端模型（`TRANSLATE_REFINE_*`）；之後改用大 context 模型時設定 `MINUTES_*` 即可；compose.yaml 傳入 `MINUTES_*`
- 測試：webapp/test_server.py（以假模型測試）
- 文件：README.md、docs/roadmap.md
