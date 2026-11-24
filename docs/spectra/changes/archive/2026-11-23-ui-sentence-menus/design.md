## Context

- **ui-setup-collapse（2026-11-23 封存）之後**：
  - `#setupSentence` 由 `showSentence()` 畫成 `span.sentence-clause`，設定詞是 `button.sentence-pick[data-field]`。
  - `#setupSentence` 的點擊處理：設定區收起時先 `setSetupMore(true)` 展開，再 `focus()` 原生欄位並 `showPicker()`。
  - 可對應的欄位：`#language`、`#targetLanguage`、`#audioSource`、`#microphone`、`#team`（都是 `select`）與 `#interpretPlay`（checkbox）。
- **麥克風清單**：`refreshMicrophones()` 用 `device.label` 當選項文字；Windows 上的 Chrome 會給「Default - 麥克風 (IPEVO V4K PRO) (1778:d002)」「Communications - …」這類名稱。
- **頂端列** `topbar.css`：`.topbar` 最小高 62px；`.brand-mark` 38px；`.brand b` 15px；`.brand small` 12px；`.account > a` 等高 36px、14px。即時會議頁另有 `refine.css` 的 `.brand-mark` 40px 與 `mobile.css` 的手機尺寸。
- **ui-ux-pro-max 的準則**（本專案的 UI 改動都要查）：
  - 彈出的選單打開時焦點移進去，Esc 關閉並把焦點還給開啟它的控制項。
  - 每個互動元件都要有清楚的焦點框。
  - 觸控目標至少 44×44px。
  - 字級用一致的級距，不要零散的大小。

## Goals / Non-Goals

**Goals:**

- 按句中設定詞就在原地選，不展開設定區。
- 句子和選單裡的麥克風名稱好讀。
- 寬版頂端列的字與標誌放大，品牌一眼可見。

**Non-Goals:**

- 手機的頂端列與即時會議頁。
- 設定區內的欄位外觀、開會中的畫面。
- 麥克風的選擇邏輯。

## Decisions

### 句中設定詞打開自己的選單

**Supersedes**: ui-night-celadon / 句子由純函式組成，原生選單照舊

新檔 `webapp/static/sentence-menu.js` 提供 `window.SentenceMenu.open(button, control, onDone)`：

- **選單元素**：頁面只有一個 `div#sentenceMenu.sentence-menu[role=listbox][hidden]`，`position: fixed`，放在按鈕下緣下方 8px、左緣對齊；超出視窗右邊時往左移，下方空間不夠時往上開。
- **內容**：
  - `select`：照順序列出 `optgroup` 標題（`div.sentence-menu-group`，`role=presentation`）與選項（`div[role=option]`，`aria-selected`）。`hidden` 的選項不列；`disabled` 的選項列出但 `aria-disabled="true"`、不能選。
  - `#interpretPlay`：兩個選項「同步播放譯音」（checked）與「不播放譯音」。
- **開啟**：按鈕 `aria-haspopup="listbox"`、`aria-controls="sentenceMenu"`，開啟時 `aria-expanded="true"`；焦點移到目前選中的選項，並捲到看得見。
- **鍵盤**：↑↓ 移動（跳過停用項）、Home／End、Enter 或空白鍵選取、Esc 關閉、Tab 關閉。
- **選取**：設定原生欄位的 `value`（checkbox 設 `checked`），派送冒泡的 `change` 事件，關閉選單，然後 `onDone`：句子重畫後把焦點放回同一個 `data-field` 的設定詞。
- **關閉的其他方式**：點選單外面、視窗捲動或改變大小。
- **原生欄位仍是唯一的狀態來源**：選單不存任何值，所以設定區展開或收起、手機對話框、記憶的選擇都照舊。
- **捨棄的做法**：繼續用原生 `showPicker()`。收起的欄位打不開，選單位置也不在句子旁。

### 句中設定詞不再展開設定區

**Supersedes**: ui-setup-collapse / 句中設定詞先展開再打開選單

按設定詞只開句中選單，`setupMoreOpen` 與 `setup-folded` 不變。欄位 `disabled` 時，`showSentence()` 把那個詞畫成一般文字，不做成按鈕。

### 麥克風名稱整理

`app.js` 新增 `micName(label)`：

- 去掉結尾的 USB 代碼 `\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$`。
- 開頭 `Default - ` 改成結尾「（系統預設）」，`Communications - ` 改成「（通訊）」。
- `refreshMicrophones()` 的選項文字用 `micName()`；句子用的 `micLabel` 再去掉「（系統預設）」「（通訊）」。

| 原始名稱 | 選單 | 句子 |
| --- | --- | --- |
| `Default - 麥克風 (IPEVO V4K PRO) (1778:d002)` | `麥克風 (IPEVO V4K PRO)（系統預設）` | `麥克風 (IPEVO V4K PRO)` |
| `Communications - 麥克風 (IPEVO V4K PRO) (1778:d002)` | `麥克風 (IPEVO V4K PRO)（通訊）` | `麥克風 (IPEVO V4K PRO)` |
| `麥克風 (Realtek(R) Audio)` | 不變 | 不變 |

### 頂端列放大

寬度大於 700px（`topbar.css` 的手機斷點以上）：

| 項目 | 原本 | 改成 |
| --- | --- | --- |
| `.topbar` 最小高度 | 62px | 72px |
| `.brand-mark` | 38px（即時會議頁 40px） | 48px，圖 40px |
| `.brand b` | 15px | 20px，字重 600 |
| `.brand small` | 12px | 13px |
| 頁面連結、登出、帳號名稱 | 14px，高 36px | 16px，高 40px，左右 14px |
| 服務狀態、主題按鈕、頭像 | 36px | 40px |

手機（700px 以下）沿用原本的尺寸規則。701–1023px 七個連結都還顯示（site-navigation 的隱藏寬度不變），實測 16px 會超出 104px，所以這段改成 15px、連結左右 10px、間距 2px；1024px 以上才是 16px。

## Implementation Contract

**Behavior（使用者看到的結果）：**

- `/` 在 1440px、設定區收起：按句中的團隊名，`#sentenceMenu` 出現在該詞下方，列出所有團隊，目前的團隊 `aria-selected="true"` 並取得焦點；設定區仍收起（`#setupMore` `aria-expanded="false"`）。
- 在選單裡按 ↓ 再按 Enter（或點另一個選項）：`#team` 的值變成那個選項，句子立刻顯示新名稱，選單關閉，焦點在句中的團隊名。
- 按 Esc：選單關閉，值不變，焦點回到設定詞；點選單外也關閉。
- 語音語言的選單列出分組標題「語言與對話模式」「其他語言 · 效果可能因語言而異」。
- 即時口譯模式按「同步播放譯音」：選單只有兩項，選「不播放譯音」後 `#interpretPlay` 未勾選，句子寫「不播放譯音」。
- 欄位停用時，該設定詞不是按鈕。
- 麥克風名稱照「麥克風名稱整理」的表格顯示。
- 寬版各頁 `.topbar .brand-mark` 寬 48px、`.brand b` 20px、`#account > a` 16px 且高 40px；390px 時和變更前一樣。901px 到 1440px 之間頁面都沒有水平捲動。

**Interface（介面）：**

- `window.SentenceMenu = {open(button, control, onDone), close()}`。
- DOM：`div#sentenceMenu.sentence-menu[role=listbox]`；選項 `div.sentence-menu-option[role=option]`；分組 `div.sentence-menu-group`。
- `app.js`：`micName(label)`。

**Failure modes（出錯時）：**

- 欄位沒有任何選項（例如沒有團隊）：句子不畫按鈕（沿用「沒有團隊時不顯示空白按鈕」）。
- 選單打開時欄位被停用或句子重畫：選單關閉。

**Acceptance（驗收）：**

- 新增 `bench/ui_sentence_menus_e2e.mjs` 驗以上每一項；不按開始，攔截 `POST /api/meetings`。
- `bench/ui_night_celadon_e2e.mjs` 與 `bench/ui_setup_collapse_e2e.mjs` 裡「按設定詞會 focus 欄位／展開設定」的檢查，改成本變更的新行為，其他斷言不變。
- 其他既有前端 bench 照常通過。

**Scope（範圍）：**

- 範圍內：`index.html`、`app.js`、`refine.css`、`topbar.css`、新的 `sentence-menu.js`、各頁 html 的 `?v=`、上述 bench。
- 範圍外：伺服器、手機版面、`stopMeeting()`（faster-meeting-end 未提交的修改）。

## Risks / Trade-offs

- [自訂選單的鍵盤與讀屏行為要自己做] → 照 listbox 模式做 ↑↓、Home／End、Enter、Esc、焦點歸還，並在 bench 用鍵盤操作驗證。
- [語言選單有 30 多項] → 選單最高 `min(420px, 視窗剩餘空間)`，可捲動，打開時捲到目前選項。
- [頂端列變高 10px，各頁內容往下移] → 「One page width」「Switching the theme changes only colours」不受影響；ui_consistency bench 比的是主題之間與頁面之間的位置一致，照常通過。
- [頂端列在 901–1100px 變擠] → bench 在 960px 與 1101px 檢查沒有水平捲動。

## Migration Plan

純前端。更新各頁 `topbar.css` 與 `index.html` 的 `app.js`、`refine.css`、`sentence-menu.js` 版本參數。

## Open Questions

無。
