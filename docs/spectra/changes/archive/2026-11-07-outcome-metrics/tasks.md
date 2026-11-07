## 1. 資料與 API

- [x] 1.1 新增 webapp/migrations/009_item_edited.sql（`minute_items.edited`）；webapp/minutes.py `change_item` 與 webapp/actions.py `change_action` 在類型、內容、負責人、到期日、到期原話實際改變時設 `edited = true`。驗證：`MetricsTests` 修改負責人後為 true、只改狀態仍為 false。（Outcome metrics page；設計：「人工修改過」標記）
- [x] 1.2 新增 webapp/metrics.py：`GET /metrics` 頁、`GET /api/metrics?team=&days=` 依設計的定義計算所有指標（含 Python 編輯距離），webapp/server.py 註冊 [after: 1.1]。驗證：webapp/test_server.py `MetricsTests` 驗證 spec 兩個範例表的數值、分母 0 為 null、週別分組、非成員 404、days 非法 422。（設計：即時計算，不存快照；指標定義（期間 = 最近 N 天，以 MEETING_TIMEZONE 的日期計））

## 2. 頁面

- [x] 2.1 新增 webapp/static/metrics.html、metrics.js、metrics.css：篩選列（團隊、期間，寫入網址）、四張指標卡、AI 分段長條＋表格、每週分組長條圖（SVG、滑過提示、表格切換）、轉錄表格、空資料說明；webapp/static/account.js 頁首「成效指標」連結、webapp/static/admin.css 640px 以下隱藏、各 html 版本號 [after: 1.2]。驗證：bench/metrics_e2e.mjs 全部檢查通過，並截圖檢視淺色與深色。（設計：圖表不用外部套件）

## 3. 文件

- [x] 3.1 README 新增「成效指標」段落與 API 表，bench/README 補 metrics_e2e，docs/roadmap.md 效益指標註明已有頁面 [after: 2.1]。驗證：內容檢查。
