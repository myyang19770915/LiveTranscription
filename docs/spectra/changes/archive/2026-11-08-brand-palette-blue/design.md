## Context

其他頁面已經用 `tokens.css` 的變數，開會頁則由 `styles.css`（基礎、深色）、`refine.css`（深色再修飾）、`themes.css`（明亮主題覆寫，104 個寫死顏色）、`mobile.css` 疊成，兩邊變數名也不同（`--bg`、`--surface`、`--line`、`--mint`…）。使用者從三個預覽方案中選了「湖水藍＋暖橘」，並要求圖示構圖不變、只換色。

## Goals / Non-Goals

- 目標：全站一套變數、一次換色；開會頁明暗主題只靠 tokens 切換；圖表與圖示跟著主色。
- 不做：版面調整、圖示重繪、第三主題。

## Decisions

### 色彩表（tokens.css）

| 變數 | 明亮 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--page` | `#f3f6fa` | `#0d141c` | 頁面底 |
| `--glow` | `#dfeafa` | `#163152` | 登入頁與開會頁頂部光暈 |
| `--panel` | `#ffffff` | `#151f2b` | 卡片、頁首 |
| `--border` | `#dbe3ec` | `#263445` | 邊線 |
| `--text` / `--muted` / `--faint` | `#16202b` / `#5d6b7a` / `#7d8a98` | `#ecf2f8` / `#9bacbe` / `#7a8b9c` | 文字三階 |
| `--field` / `--field-border` / `--field-hover` | `#ffffff` / `#8591a0` / `#65717f` | `#0b1118` / `#566a80` / `#74889e` | 輸入框（邊線對底 ≥ 3:1） |
| `--accent` / `--accent-ink` / `--accent-soft` | `#1479c7` / `#ffffff` / `#1479c71f` | `#4cb8ff` / `#06192a` / `#4cb8ff26` | 主色：按鈕、連結、焦點、進度、live |
| `--accent-2` / `--accent-2-ink` / `--accent-2-soft` | `#e8781f` / `#221400` / `#e8781f1f` | `#ff9a4d` / `#2a1400` / `#ff9a4d26` | 對比色：新增、提示、圖表第二序列 |
| `--danger` / `--danger-soft` | `#c23a24` / `#c23a2416` | `#ff8d72` / `#ff795d1f` | 逾期、錯誤、停止 |
| `--warn` | `#8a5a00` | `#f2c66d` | 到期提醒 |

明亮主色 `#1479c7` 對白字 4.6:1，比預覽的 `#1d8fe0`（3.5:1）略深，讓按鈕文字達到 AA；對比色的按鈕用深字而非白字（白字只有 2.9:1）。

### 圖表序列色（metrics.css）

明亮 `#1479c7`、`#e07018`、`#189c6c`，其餘 `#b8c1cc`，格線 `#e6ebf1`；暗色 `#2f98e8`、`#e06d22`、`#1fa873`，其餘 `#3a4654`，格線 `#22303f`。兩組都以 dataviz `validate_palette.js` 對各自的 panel 色檢查通過（亮度帶、彩度、色盲分離、對比）。第三色維持綠，因為「駁回」和「採用」要分得開。

### 開會頁改用 tokens

index.html 在最前面載入 tokens.css。styles.css 的 `:root` 不再定義顏色，改成別名：`--bg: var(--page)`、`--surface: var(--panel)`、`--line: var(--border)`、`--soft: color-mix(in srgb, var(--border) 60%, var(--panel))`、`--dim: var(--faint)`、`--mint: var(--accent)`、`--coral: var(--danger)`；`--text`、`--muted` 同名直接沿用。refine.css 刪除自己的 `:root` 顏色。所有寫死的深色背景改為 `var(--field)`、`var(--panel)`、`color-mix(...)`；themes.css 只留結構規則（隱藏 `.ambient`、日／月圖示、明亮主題的 main 尺寸與圓角）。這樣 series.css 不用改變數名。

**替代方案**：把開會頁全部改寫成 tokens 的變數名。捨棄原因：series.css、mobile.css、app.js 都引用舊名，別名改動最小且兩套名稱在同一處定義。

### 品牌圖示

以 HSV 色相 +52° 把兩個綠轉成藍（深綠 → 深藍、薄荷綠 → 淺藍），飽和度 ×1.08，奶白線條（飽和度 < 0.12）不動；由新 PNG 重新產生 favicon 系列。

### `theme-color` meta

app.js 不再寫死兩個顏色，改讀 `getComputedStyle(document.documentElement).getPropertyValue('--page')`。

## Implementation Contract

- 功能行為不變：主題切換、記住主題、所有頁面操作與 e2e 檢查結果一致。
- 完成後 `grep -c "#[0-9a-fA-F]\{3,8\}" webapp/static/themes.css` 為 0；styles.css 與 refine.css 只剩陰影／透明度用的色碼（合計 ≤ 6）。review 指出明亮主題的紅色 `#d8432b` 對白字只有 4.4:1，改為 `#c23a24`（4.9:1）。
- 每個頁面明暗兩主題、桌機與 400px 的截圖經目視確認；開會頁另確認手機設定視窗、live 狀態列、暫譯區塊、系列提示。
- 圖表三色通過 validate_palette；表格與直接標籤維持。

## Risks / Trade-offs

- [開會頁覆寫層次多，改錯一處某個狀態（live、error、testing）在某主題看不到] -> 逐狀態截圖，加上 series_e2e 以假麥克風跑一場會議。
- [主色由綠變藍，使用者對「已確認」「live」的顏色直覺改變] -> 狀態語意維持：主色＝進行中／焦點，紅＝逾期／錯誤，橘只做提示與對比。
- [圖示色相平移後深藍偏暗] -> 產生時檢查深色氣泡亮度，必要時把明度提高 10%。

## Migration Plan

純前端靜態檔，更新版本參數即生效；回退只要還原這批檔案。

## Open Questions

無。
