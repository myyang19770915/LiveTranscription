## Context

- `app.js` 目前的記憶（都在 `localStorage`）：`liveMode`、`team`、`meetingLanguage` 與 `meetingTarget`（只在開會模式寫入、只在記住的模式是開會時還原）、`quality`、`cloudRefine`；`series.js` 記每個團隊的系列；`interpret-mode.js` 記 `yq-interpret-target`、`yq-interpret-play`。
- `#audioSource` 的 change 只呼叫 `updateSourceUI()`；`#microphone` 的 change 只更新狀態文字與句子。兩者都沒有寫入。
- `refreshMicrophones(preferredId)` 重畫麥克風清單：以 `preferredId` 或目前選的值為準，清單裡有就選回去。頁面載入、取得麥克風權限後、裝置插拔（`devicechange`）時都會呼叫。沒有權限時，瀏覽器給的裝置代碼和名稱是空的。
- 句子裡的詞打開選單選擇後，`sentence-menu.js` 會設定原本的控制項並發出 `change` 事件，所以在控制項的 change 記住就涵蓋句子選單和設定區兩種操作。
- 頁尾「清除」是 `location.reload()`。
- 設計準則（ui-ux-pro-max）：不要讓使用者重填已經輸入過的內容（Preserve Input）。

## Goals / Non-Goals

**Goals:**

- 句子裡每個選擇，重新載入後都是最後一次選的項目。
- 記住的麥克風暫時不在時，不丟掉記憶。

**Non-Goals:**

- 跨裝置同步、會議情境與主題（見 proposal）。

## Decisions

### 音訊來源記在 audioSource

`#audioSource` 的 change 寫入 `localStorage.audioSource`。載入時，值存在且對應的選項存在就還原，然後呼叫 `updateSourceUI()`。不支援分享音訊的瀏覽器，由頁面後段既有的程式停用另外兩項並改回麥克風。

### 麥克風記裝置代碼與名稱，只有使用者自己選才寫入

- `#microphone` 的 change（使用者在設定區或句子選單選）寫入 `microphoneId` 與 `microphoneLabel`（選項顯示的名稱）。程式自己把選單設成預設值時不會發出 change，所以不會覆蓋記憶。
- `refreshMicrophones(preferredId)` 選擇的順序：
  1. `preferredId`（呼叫端指定：正在使用的那支）。
  2. 記住的代碼在清單裡（使用者最後選的，不論是這次還是之前選的；這次選的那支暫時斷線再回來也會選回去）。
  3. 使用者這次開頁面後還沒選過，且記住的名稱在清單裡（代碼會在清除網站資料後改變）。
  4. 目前顯示的那支。
  5. 都沒有：清單第一項，不寫入。
- 沒有權限時清單沒有代碼與名稱，第 2、3 步都對不到。這時 `audioConstraints()` 以 `deviceId: {ideal: 記住的代碼}` 要求麥克風（review 提出，2026-11-24 加入）：否則第一次測試或開會會開到預設麥克風，而且之後以「正在使用的那支」為準，記住的那支不會被選回來。`ideal` 在那支不存在時會退回預設麥克風。
- **捨棄的做法**：每次清單更新都把目前選的寫入。記住的麥克風沒插上時，預設值會蓋掉記憶。

### 語音語言共用一個，翻譯目標依模式分開

- `updateTranslationDirection()` 目前只在開會模式寫入。改成：語音語言在三種模式都寫入 `meetingLanguage`（沿用舊的名稱，既有使用者的記憶不會消失）；翻譯目標在開會模式寫 `meetingTarget`（現狀），在即時翻譯模式寫 `translateTarget`；即時口譯的輸出語言維持 `yq-interpret-target`。中日雙向時不寫翻譯目標（現狀）。
- 載入時不論記住的模式是哪個都還原語音語言。即時口譯不提供中日雙向，進入該模式時既有的處理會改成中文，這時不寫入記憶（只在使用者自己選時才算）。為了分辨，寫入只發生在使用者操作 `#language`、`#targetLanguage` 或交換鈕時，不在模式切換的自動調整。
- 切到即時翻譯模式時，若有 `translateTarget` 且選項存在，就選它；切回開會時既有的 `rememberedTarget` 還原不變。

## Implementation Contract

**Behavior（使用者看到的結果）：**

- 在 `/` 把音訊來源改成「分頁或系統聲音」，重新載入：句子仍寫從分頁或系統聲音收音。
- 選第二支麥克風，重新載入（有麥克風權限）：句子仍是第二支。
- 在即時翻譯模式把語音語言改成英文、翻譯目標改成日文，重新載入：仍是即時翻譯、英文、日文。
- 按頁尾「清除」的結果和重新載入一樣。
- 記住的麥克風不在清單裡：選預設的那支；`localStorage.microphoneId` 不變。

**Interface（介面）：**

- `localStorage` 新增 `audioSource`、`microphoneId`、`microphoneLabel`、`translateTarget`；`meetingLanguage` 改為三種模式共用。
- 沒有新的伺服器介面。

**Failure modes（出錯時）：**

- `localStorage` 不能用（無痕或被封鎖）：讀寫都包在 try/catch，頁面照預設值運作。
- 記住的值已不是有效選項：忽略，用預設值，不清除也不覆蓋。

**Acceptance（驗收）：**

- 新增 `bench/remember_setup_e2e.mjs`（Playwright，假的麥克風裝置有三支；攔截 `POST /api/meetings`，不建立會議）：
  - 音訊來源選 `system` → 重新載入 → `#audioSource` 是 `system`。
  - 麥克風選第二支 → 重新載入 → `#microphone` 選的是同一個代碼，句子顯示它的名稱。
  - 只留名稱、把記住的代碼改成不存在的值 → 重新載入 → 依名稱選回第二支。
  - 記住的代碼與名稱都不存在 → 重新載入 → 選第一支，`localStorage.microphoneId` 沒被改掉。
  - 即時翻譯模式選語音語言 `en`、翻譯目標 `ja` → 重新載入 → 模式、語言、目標都保留；切到開會再切回即時翻譯，目標仍是 `ja`。
  - 開會模式選不翻譯 → 切到即時翻譯選 `ja` → 重新載入後切回開會：仍是不翻譯。
  - 按「清除」後各值與按之前相同。
  - 改程式前先跑，確認音訊來源、麥克風、即時翻譯的語言與目標這幾項失敗。
- 既有 bench 照常通過：`ui_sentence_menus_e2e`、`ui_setup_collapse_e2e`、`ui_night_celadon_e2e`、`audio_test_e2e`、`web_platform_polish_e2e`；`node bench/checks.js`（既有的 closecheck、privacycheck 兩項失敗除外）。會議數不變。

**Scope（範圍）：**

- 範圍內：`app.js`（記住與還原）、`index.html` 的 `app.js?v=`、新的 bench。
- 範圍外：伺服器、`interpret-mode.js`、`series.js`、選單與句子的寫法。

## Risks / Trade-offs

- [代碼對不到、名稱相同的兩支麥克風] → 依名稱會選到清單中第一支同名的；使用者再選一次就會記住新的代碼。
- [語音語言改成三種模式共用，從即時翻譯切回開會時語言跟著是最後選的] → 這正是「停留在最後選的」；語言選單本來就是三種模式共用同一個控制項。

## Migration Plan

純前端，更新 `index.html` 的 `app.js?v=`。既有的 `meetingLanguage`、`meetingTarget` 照常讀取。

## Open Questions

無。
