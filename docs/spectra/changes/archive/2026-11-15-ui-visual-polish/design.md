## Context

- Codex 第二輪巡覽提出 10 項視覺建議（docs/ui-design-suggestions-codex.md），Claude 對照程式碼與截圖後，使用者同意先做第 1、10 項與第 2 項的「進階收合」。
- `webapp/static/tokens.css` 已被每個頁面載入（2026-11-15 檢查各 HTML 的 `<link>`），目前只定義顏色與字型；圓角在各頁 CSS 中以 6/7/8/9/10/11/12/14/18px 等數值直接寫死。
- 開會頁設定區用 `refine.css` 的 `grid-template-areas` 排版，進階相關的 grid area 為 `h-adv`、`engine`、`refine`；`app.js` 依伺服器設定決定 `#setupAdvanced`、`#asrEngineRow`、`#cloudRefineRow`、`#qualityRow` 是否 `hidden`，並把三個進階設定的值存在 localStorage（`asrEngine`、`cloudRefine`、`quality`）。760px 以下這些節點會被搬進設定對話框（`mobileSettingsNodes`）。
- 搜尋與問答的載入狀態沿用 search-feedback-term-limit 的決定「載入狀態：立即標記、延遲宣告」：送出時立即設 `aria-busy` 與 `is-loading`，200ms 後才由 `#summary`（`aria-live="polite"`）宣告。兩頁都載入 `search.css`，結果區都是 `.results`（`#results`、`#answer`）。
- 登入按鈕的 spinner 是 `login.css` 的 `.auth-spinner`。

## Goals / Non-Goals

**Goals:**

- 圓角、陰影、間距、字級有一份共用 token，頁面 CSS 的圓角全部改用 token，畫面除 ≤2px 圓角差與亮色卡片陰影外不變。
- 開會頁桌面版的進階設定預設收合，收合時看得出哪些進階選項已開啟。
- 搜尋、問答在慢請求時顯示一致的載入列（spinner＋動詞），首次查詢有佔位行；快請求不閃。

**Non-Goals:**

- 不把間距與字級 token 全面套用到各頁（本次只定義並在新寫的樣式中使用；逐頁套用留待之後的美化 change，避免一次改動過大）。
- 不改色彩、品牌色、英文小標、會議列表／看板／指標／紀要版型。
- 不改窄螢幕設定對話框的內容與順序。
- 不改登入流程與按鈕文字，只換 spinner 樣式來源。

## Decisions

### 圓角 token 取五級，對應現有數值

`--radius-small` 6、`--radius-control` 10、`--radius-card` 14、`--radius-feature` 18、`--radius-pill` 999px，另加頁框／對話框用的 `--radius-frame` 24px（實作時發現亮色主題頁框 26px、手機設定對話框 22px 不在前五級 ±2px 內）。登入頁插圖的 `26%` 隨框縮放，保留百分比。現有數值落在這五級 ±2px 內，所以替換後外觀幾乎不變；4px 以下的細條與 50% 圓形不改。替代方案是 Codex 建議的 10/16/20 三級，但會讓現有 8px、12px、18px 元件變動 2–4px，超出「外觀不走樣」的要求。

### 陰影只在亮色主題出現

`--shadow-card` 暗色為 `none`，亮色為 `0 8px 24px rgb(20 40 70 / .06)`。暗色面板已靠 `--border` 區隔，加陰影在深底上幾乎看不見且會讓邊緣發糊。本次只把現有面板（`.panel`、`admin.css` 的卡片）接上 `--shadow-card`，不新增其他陰影。

### 進階收合用按鈕切換 class，不用 `<details>`

把 `#setupAdvanced` 的 `<p>` 換成 `<button type="button" id="setupAdvanced" class="setup-heading setup-toggle" aria-expanded aria-controls="asrEngineRow refineGroup">`，收合時在 `.controls` 加 `advanced-folded` class，CSS 隱藏 `engine` 與 `refine` 兩個 grid area（`display:none`）並改用不含這兩列的 `grid-template-areas`。不用 `<details>`：設定區是一個 grid，`<details>` 會把三個欄位包成一個 grid 子元素，打亂 `grid-template-areas` 與窄螢幕搬移節點的邏輯。收合只在 `min-width: 761px` 生效，窄螢幕對話框不受影響。

### 收合摘要由現有的值計算

摘要文字由 `asrEngine()`、`cloudRefineOn()` 判斷前的原始勾選狀態與 `qualityChosen()` 組成：引擎 `mai`→「雲端 MAI」、`hybrid`→「混合辨識」、`local` 不列；雲端精修勾選且可見→「雲端精修」；精準模式勾選且可見→「精準模式」；以「、」連接，都沒有時為「預設」。在三個設定的 `change` 事件與伺服器設定載入後更新。

### 共用載入列由 JS 插入、CSS 延遲顯示

`tokens.css` 新增 `.spinner`（取代 `.auth-spinner` 的樣式，登入按鈕改用它）、`.loading-state`、`.loading-lines`。`search.js` 與 `ask.js` 的 `busy()` 呼叫共用的 `webapp/static/loading-state.js`（`LoadingState.show/hide`），在 200ms 計時器觸發時於結果區最前面插入 `<div class="loading-state" aria-hidden="true"><span class="spinner"></span>搜尋中…</div>`；區域原本沒有結果時再加三行 `.loading-lines`。`busy(false)` 或結果重繪時移除。顯示時機直接掛在兩頁既有的 200ms 計時器上（與摘要文字同時），沿用既有「立即標記、延遲宣告」的 200ms（search-feedback-term-limit / 載入狀態：立即標記、延遲宣告），快請求不閃。載入列 `aria-hidden`，避免與 `#summary` 重複播報。替代方案是純 CSS `::before` 顯示文字，但偽元素文字仍可能被讀出，且無法依「原本有無結果」決定佔位行。

## Implementation Contract

- **行為**：
  - 所有頁面可用 `--radius-*`、`--shadow-card`、`--space-1..6`、`--text-*`；頁面 CSS 不再出現 token 以外、大於 4px 的圓角數值。
  - 開會頁 761px 以上：進階預設收合；按「進階」展開／收合，狀態存 localStorage `setupAdvancedOpen`（`'1'`／`'0'`），讀寫失敗時視為收合；收合時按鈕顯示摘要。760px 以下維持原對話框行為。
  - 搜尋、問答：慢於 200ms 的請求顯示載入列；首次查詢加三行佔位；舊結果變淡且不可點；`aria-busy`／`is-loading` 時機不變。
  - 登入按鈕 spinner 外觀不變，改用共用 `.spinner`。
- **介面**：localStorage key `setupAdvancedOpen`；CSS class `.advanced-folded`、`.setup-toggle`、`.spinner`、`.loading-state`、`.loading-lines`；元素 id `refineGroup`（給 `.refine-group` 加上，供 `aria-controls`）。
- **失敗模式**：localStorage 不可用 → 收合、不報錯；伺服器沒有提供任何進階設定 → 進階按鈕維持 `hidden`；請求失敗 → 移除載入列，沿用既有錯誤訊息。
- **驗收**：
  - `bench/ui_polish_e2e.mjs`（新增，比照 `bench/ui_review_e2e.mjs` 的用法與 exit code）檢查：token 在兩種主題都有值；開會頁首次收合、展開後重整仍展開、摘要文字符合 meeting-setup-layout 的範例表、500px 對話框直接看到進階設定；搜尋以攔截 API 延遲 600ms 檢查載入列與舊結果變淡、延遲 50ms 檢查不出現載入列；問答首次查詢有三行佔位；reduced motion 時 spinner 沒有動畫。
  - 圓角檢查：腳本（或 e2e 內）掃 `webapp/static/*.css`，除 tokens.css 外沒有 >4px 的非 token 圓角值。
  - 截圖比對：改動前後以 Playwright 截 9 頁（1280px 明亮／深色、500px 深色），存 evidence，人工比對並記錄差異。
  - `webapp/test_server.py` 全部通過（含更新後的資產版本號）。
- **範圍**：只動 `webapp/static/` 的 CSS、`index.html`、`login.html`、`app.js`、`search.js`、`ask.js`、各 HTML 的資產版本號，以及 `bench/` 新腳本與 `test_server.py` 中受版本號影響的斷言。

## Risks / Trade-offs

- [圓角替換涉及約 20 個 CSS 檔，可能誤改] → 每批改完即截圖比對；以掃描腳本確認無遺漏。
- [收合後使用者忘記開了精準模式（會傳外部服務）] → 摘要直接寫出「精準模式」「雲端精修」，且頁首的資料去向提示（privacy note）不受收合影響，仍顯示外送狀態。
- [`grid-template-areas` 有多個斷點版本] → 每個含 `h-adv` 的版本都要有對應的收合版本；e2e 在 1280px 與 850px 兩種寬度檢查。
