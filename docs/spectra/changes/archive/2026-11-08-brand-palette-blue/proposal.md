## Why

目前的配色是沙棕底加深松綠，沉穩但偏灰，使用者希望改成比較活潑、有朝氣但不誇張的色調。另外開會頁（`/`）和其他頁面是兩套樣式系統：其他頁面用 `tokens.css` 的變數，開會頁的 `styles.css`、`refine.css`、`themes.css`、`mobile.css` 寫死了約 150 個顏色，任何配色調整都要改兩次、也容易兩邊不一致。

## What Changes

- 配色改為「湖水藍＋暖橘」：主色湖水藍（按鈕、連結、焦點、進度、live 狀態），暖橘做對比色（新增、提示、圖表第二序列），逾期與錯誤維持紅色系；明亮主題底色改為帶藍的淺灰白，暗色主題底色改為深藍黑。兩個主題都在 webapp/static/tokens.css 一處定義，新增 `--accent-2`、`--accent-2-ink`、`--accent-2-soft` 三個對比色變數。
- 開會頁改用同一套變數：index.html 載入 tokens.css；styles.css、refine.css 的基礎樣式改用 `var(--…)`，原本的 `--bg`、`--surface`、`--line`、`--soft`、`--mint`、`--coral`、`--dim` 改為 tokens 的別名；themes.css 只保留結構性的明亮主題差異（隱藏背景光暈、日月圖示切換、版面尺寸），不再寫顏色；mobile.css 的明亮顏色覆寫移除；app.js 的 `theme-color` meta 改讀目前主題的 `--page`。
- 成效指標的圖表序列色改為新主色（藍）、對比色（橘）、綠，並以 dataviz 的 validate_palette 檢查兩個主題。
- 品牌圖示保留圖案，兩個綠色改為對應的藍色（深藍、淺藍），奶白線條不變；重新產生 favicon 與 apple-touch-icon。
- 登入頁、系列提示、頭像裁切視窗等零星寫死的綠色改為變數。待辦看板的頭像底色是每個人固定的六色識別色，不是品牌色，維持不變。

## Non-Goals

- 不改版面、字級與間距（開會頁設定區的排法是另一個變更 meeting-setup-layout）。
- 不改圖示的形狀與構圖。
- 不加第三個主題。

## Impact

- Affected specs: none（顏色與樣式結構，不改任何功能行為）
- Affected code:
  - New: (none)
  - Modified: webapp/static/tokens.css, webapp/static/styles.css, webapp/static/refine.css, webapp/static/themes.css, webapp/static/mobile.css, webapp/static/series.css, webapp/static/metrics.css, webapp/static/actions.css, webapp/static/login.css, webapp/static/account.js, webapp/static/app.js, webapp/static/index.html 與其他頁面的版本參數, webapp/static/brand-icon.png, webapp/static/favicon.ico, webapp/static/favicon-32.png, webapp/static/favicon-192.png, webapp/static/apple-touch-icon.png, README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
