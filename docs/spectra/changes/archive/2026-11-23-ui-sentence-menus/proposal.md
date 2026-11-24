## Summary

即時會議頁標題句子裡有底線的設定詞，按下後直接在詞的下方跳出選單讓使用者點選，不再展開「更多設定」。麥克風名稱去掉裝置代碼。各頁頂端列的字與「語橋 Live」標誌放大。

## Motivation

2026-11-23 使用者看過 ui-setup-collapse 後要求（截圖 `螢幕擷取畫面 2026-11-23 225421.png`）：

- **句子是設計的重點**：「我們設計用敘述的文字來表示並讓使用者可以快速選擇」。目前按設定詞會先展開整個設定區，再打開原生選單，等於又回到表單；應該按了就在原地選。
- **麥克風名稱太長**：Chrome 在 Windows 給的名稱像「Default - 麥克風 (IPEVO V4K PRO) (1778:d002)」，句子裡整段照搬，佔滿一行。
- **頂端列太小**：連結 14px、標誌 38px、品牌名 15px，在 1440px 寬的畫面上不夠醒目，看不出這是哪個系統。

## Proposed Solution

- **句中選單**（寬版、開會前）：
  - 按設定詞，在詞的正下方出現一個選單，列出該設定的所有選項（含分組標題），目前的選項打勾並取得焦點。
  - 點選或按 Enter 就套用，選單關閉，句子立刻更新，焦點回到同一個設定詞；按 Esc 或點選單外面只關閉。
  - 方向鍵上下移動、Home／End 跳到頭尾；選項多時選單可捲動。
  - 選單選的就是原本的設定欄位：設定區收起或展開都不變，送出的值、記憶的選擇都和直接用欄位一樣。
  - 同步播放譯音的選單只有「同步播放譯音」「不播放譯音」兩項。
  - 欄位停用時（例如測試音源進行中），那個詞顯示成一般文字。
- **麥克風名稱**：選單和句子都去掉結尾的裝置代碼，例如「(1778:d002)」；「Default - 」「Communications - 」在選單裡改成名稱後面的「（系統預設）」「（通訊）」，句子裡不顯示。
- **頂端列**（寬度大於 700px 的所有頁面）：
  - 標誌從 38px 放大到 48px，品牌名 15px 到 20px，副標 12px 到 13px。
  - 頁面連結、帳號、登出 14px 到 16px，高度 36px 到 40px；服務狀態、主題按鈕、頭像同高。
  - 連結順序、隱藏的寬度、目前頁的標示都照舊。
- **手機（700px 以下的頂端列、760px 以下的即時會議頁）**：不變。

## Non-Goals (optional)

- 不改設定區展開後的欄位、開會中的畫面。
- 不在句子裡加入主題、系列、會議情境（仍在「更多設定」）。
- 不改麥克風的實際選擇與記憶方式，只改顯示的名稱。

## Alternatives Considered (optional)

- **繼續用原生 `select` 的 `showPicker()`**：選單必須依附在原本的欄位上，設定收起時欄位看不到就打不開，所以才需要先展開；原生選單的位置也不在句子旁邊。
- **把設定詞改成直接嵌在句子裡的原生 `select`**：原生 `select` 的寬度、字型和箭頭無法融入 32px 的句子，每個瀏覽器又不一樣。

## Impact

- Affected specs: meeting-setup-layout（修改）、visual-tokens（修改）
- Affected code:
  - Modified:
    - webapp/static/index.html
    - webapp/static/app.js
    - webapp/static/refine.css
    - webapp/static/topbar.css
    - webapp/static/actions.html
    - webapp/static/admin.html
    - webapp/static/ask.html
    - webapp/static/interpret.html
    - webapp/static/login.html
    - webapp/static/meetings.html
    - webapp/static/metrics.html
    - webapp/static/minutes.html
    - webapp/static/review.html
    - webapp/static/search.html
    - bench/ui_night_celadon_e2e.mjs
    - bench/ui_setup_collapse_e2e.mjs
  - New:
    - webapp/static/sentence-menu.js
    - bench/ui_sentence_menus_e2e.mjs
  - Removed: 無
