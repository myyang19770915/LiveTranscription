## 1. 改動前基準

- [x] 1.1 以 Playwright 截下改動前 9 頁（開會、會議列表、校對、待辦看板、搜尋、問答、成效指標、團隊管理、登入）在 1280px 明亮／深色與 500px 深色的畫面，並記錄各頁主要元素的位置與尺寸，存到 change 的 `evidence/before/`。驗證：27 張截圖與一份 JSON 尺寸紀錄存在，且頁面皆正常載入沒有 page error。

## 2. 共用視覺 token

- [x] 2.1 [after: 1.1] 依「圓角 token 取五級，對應現有數值」與「陰影只在亮色主題出現」，在 `webapp/static/tokens.css` 定義 Shared shape, shadow, spacing and type tokens（`--radius-*`、`--shadow-card`、`--space-1..6`、`--text-*`），兩種主題都有值。驗證：在任一頁以 `getComputedStyle(document.documentElement)` 讀出每個 token 皆非空，`--shadow-card` 只在暗色為 `none`。
- [x] 2.2 [after: 2.1] 開會頁相關 CSS（`styles.css`、`refine.css`、`themes.css`、`mobile.css`、`accounts.css`、`series.css`、`overlay.css`、`subtitles.css`）的圓角改用 token，符合 Page styles use the radius tokens 的對照表，`.panel` 接上 `--shadow-card`。驗證：圓角掃描對這些檔案無 >4px 的非 token 值；開會頁截圖與 1.1 基準比對，元素位移 ≤2px。
- [x] 2.3 [after: 2.2] 其他頁面 CSS（`admin.css`、`review.css`、`actions.css`、`search.css`、`ask.css`、`metrics.css`、`minutes.css`、`evidence-panel.css`、`speakers.css`、`login.css`）的圓角改用 token，管理類頁面的卡片接上 `--shadow-card`。驗證：圓角掃描對全部 `webapp/static/*.css`（tokens.css 除外）無 >4px 的非 token 值；依 Pages keep their appearance after the token change，與 1.1 基準截圖比對，元素位移 ≤2px，差異記錄在 `evidence/compare.md`。

## 3. 開會頁進階設定收合

- [x] 3.1 [after: 2.2] 依「進階收合用按鈕切換 class，不用 `<details>`」，把 `#setupAdvanced` 改為按鈕、`.refine-group` 加 `id="refineGroup"`，在 761px 以上實作 Advanced settings fold away by default：首次收合、`setupAdvancedOpen` 記住狀態、localStorage 不可用時收合、會議情境保持顯示、沒有進階設定時按鈕維持隱藏；每個含 `h-adv` 的 `grid-template-areas` 都有收合版本。驗證：1280px 與 850px 首次開頁 `aria-expanded="false"` 且三個進階欄位不可見、會議情境可見；按下後重整仍展開。
- [x] 3.2 [after: 3.1] 依「收合摘要由現有的值計算」實作 Folded heading names the advanced options in use，摘要在設定變更與伺服器設定載入後更新；收合不改變任何設定值與開會時送出的參數。驗證：e2e 依 meeting-setup-layout 範例表四種組合檢查摘要文字；勾選精準模式後收合，`qualityChosen()` 仍為 true。
- [x] 3.3 [after: 3.1] 確認 Narrow screens keep the settings dialog unchanged：760px 以下設定對話框直接列出所有提供的進階設定，不需按「進階」。驗證：500px 開啟設定對話框，辨識引擎與雲端精修可見。

## 4. 共用載入狀態

- [x] 4.1 [after: 2.1] 依「共用載入列由 JS 插入、CSS 延遲顯示」在 `tokens.css` 定義 One spinner style（`.spinner`，reduced motion 時不轉）、`.loading-state`、`.loading-lines`；登入按鈕改用 `.spinner`，外觀與「登入中…」文字不變。驗證：登入頁送出時 spinner 可見且尺寸與改動前相同（16px）；reduced motion 時 `getAnimations()` 為空。
- [x] 4.2 [after: 4.1] 在 `search.js` 與 `ask.js` 的 `busy()` 實作 Shared loading state on search and Q&A：插入 `aria-hidden` 載入列（搜尋中…／整理答案中…），區域原本沒有結果時加三行佔位；`aria-busy`、`is-loading` 與 200ms 宣告時機不變；結果重繪或失敗時移除。驗證：e2e 以攔截 API 延遲 600ms 檢查載入列出現、舊結果變淡且不可點、首次問答有三行佔位；延遲 50ms 時載入列從未可見。

## 5. 自動檢查與收尾

- [x] 5.1 [after: 2.3, 3.2, 3.3, 4.2] 新增 `bench/ui_polish_e2e.mjs`（用法比照 `bench/ui_review_e2e.mjs`，失敗 exit 1），涵蓋 visual-tokens、meeting-setup-layout、loading-feedback 三份 spec 的每個 scenario 與圓角掃描，並在 `bench/README.md` 加說明。驗證：腳本全部通過；故意改壞一項（例如把預設改成展開）時該項 FAIL 且 exit 1。
- [x] 5.2 [after: 5.1] 更新各 HTML 的資產版本號與 `webapp/test_server.py` 中受影響的斷言，跑完整單元測試。驗證：`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過；截下改動後 27 張截圖存到 `evidence/after/`，與基準的比較結果寫入 `evidence/compare.md`。
