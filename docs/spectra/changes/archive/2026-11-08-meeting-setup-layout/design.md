## Context

`.controls` 是一個用 `grid-template-areas` 排的格子（refine.css），五個設定列放在 `.hint-stack` 的 `hint` 區域裡，用 `.source-hint` 的 10px 灰字樣式。app.js 的 `mobileSettingsNodes` 在手機寬度把指定節點搬進設定視窗，桌機再搬回原位（以註解節點當錨點），所以節點的 id 與順序是手機版版面的依據。series.js 控制 `#seriesRow` 顯示與 `#newSeries` 就地新增表單。

## Goals / Non-Goals

- 目標：設定一眼看得出是要填的欄位；控制項 id、事件與 e2e 選擇器不變。
- 不做：改變任何設定的行為。

## Decisions

### 欄位卡與分組

每個設定列改成 `.field` 卡（與語音語言同樣的 `label` 小標＋控制項）：`#teamRow`（團隊，`select#team`，`#teamHint` 放在卡內小字）、`#topicRow`（主題，`input#topic`，標籤附「選填」）、`#seriesRow`（系列，`select#series` 與 `#newSeries` 就地新增表單）、`#asrEngineRow`（辨識引擎，`select#asrEngine`，卡內小字「雲端時音訊會傳送到 Azure」）、`#cloudRefineRow`（`label.field.toggle-field`，核取方塊＋「雲端精修」＋小字）。分組標題 `p.setup-heading`（`#setupMeeting` 這場會議、`#setupAudio` 語音與翻譯、`#setupAdvanced` 進階）是格子裡的項目，也列入 `mobileSettingsNodes`，手機設定視窗因此有同樣的分組。

桌機（≥ 1180px）的 `grid-template-areas`：

```
"h-meeting h-meeting h-meeting h-meeting h-meeting h-meeting"
"team      team      topic     topic     series    series"
"h-audio   h-audio   h-audio   h-audio   h-audio   h-audio"
"source    swap      target    audio     mic       test"
"hint      hint      hint      hint      hint      hint"
"h-adv     h-adv     h-adv     h-adv     h-adv     h-adv"
"engine    engine    engine    refine    refine    refine"
"context   context   context   context   context   start"
```

辨識引擎與雲端精修都隱藏時，`h-adv` 也隱藏（app.js 在切換這兩列時同步 `#setupAdvanced.hidden`）。1180px 以下與 760px 以下各有對應的 areas（設計見 refine.css）。手機版 `.controls` 只顯示語音語言、方向、翻譯成（不變；mobile.css 的 areas 加 `!important`，優先於桌機的 `:has()` 規則），其餘搬進設定視窗，順序：這場會議標題、團隊、主題、系列、語音與翻譯標題、音訊來源、麥克風、測試音源、耳機提示、會議情境、進階標題、辨識引擎、雲端精修。

**替代方案**：一排欄位卡加摺疊進階區；或開會前跳設定視窗。捨棄原因：使用者選了兩排欄位卡。

### 標題區

`header` 改為一行：`h1` 24px、`header p` 隱藏、`.privacy` 縮成單行小標；上下留白 12px／10px（量得 header 約 72px）。文案不變。

### 主題切換

`.theme-label` 隱藏、按鈕 38px 圓形，與其他頁 `.icon-button` 一致；app.js 仍更新 `aria-label` 與 `title`。

### 手機版頁首（開會頁）

手機版頁首保留「會議紀錄」連結（這頁的主要去處）；accounts.css 在 ≤ 760px 隱藏 `.account > a[href="/actions"]` 與 `.account > .account-logout`；account.js 的頭像選單多兩個 `menu-phone` 項目「待辦看板」「登出」，預設 `display:none`，只有 accounts.css 在 ≤ 760px 顯示（其他頁的頁首放得下，維持按鈕）。登出按鈕加上 `account-logout` class 以便選取。 430px 以下再收兩處：系統狀態只留圓點（live 狀態列本身會寫「正在聆聽」）、品牌只留圖示不顯示名稱；量測 360px 時所有頁首按鈕右緣都在視窗內。

## Implementation Contract

- 功能行為不變：所有 e2e（catalog、series、search、minutes、actions、metrics、qa）通過。
- 桌機 1440px：設定區三排欄位卡；1000px：兩排換行版；400px：頁首不橫向捲動，設定視窗含分組標題與全部欄位。
- `#asrEngineRow`、`#cloudRefineRow` 都隱藏時沒有空白列。

## Risks / Trade-offs

- [欄位卡比提示列高，設定區變高] -> 標題區縮小約 130px，整體高度大致持平。
- [手機版把登出收進選單，使用者找不到] -> 選單第一項就是「登出」之外的常用項，登出在最後；頭像本身就是帳號的入口。

## Migration Plan

靜態檔，更新版本參數即生效。

## Open Questions

無。
