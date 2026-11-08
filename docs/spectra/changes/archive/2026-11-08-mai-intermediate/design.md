## Context

`MaiBridge.process()` 只處理 `*transcription.delta`（追加文字，`emit(delta)`）、`*transcription.completed`（`close_item` 補標點、`speech_end`）與 `reconnected`。瀏覽器的 `onMessage` 以 `displayText` 取代整份逐字稿或追加 `msg.text`，逐字稿是純追加的確認文字；翻譯的定稿與暫譯都從 `transcript` 切。實測 intermediate 事件的 `intermediate` 欄位就是尚未被 delta 確認的尾巴（delta 到達時開頭同字消失），用字偶爾會改（robots → robotaxis → robotaxi）。

## Goals / Non-Goals

**Goals:** MAI 的暫定文字在 delta 前約 2 秒就出現在逐字稿、暫譯與字幕；定稿翻譯與存檔只用確認文字；本機引擎不變。

**Non-Goals:** 不改提交、分段；暫定文字不存檔。

## Decisions

### 伺服器把 intermediate 當獨立的 tentative 欄位送，不混進 displayText

`MaiBridge` 新增 `self.tentative=""`。收到 intermediate：`text=self.display.tentative(event["intermediate"])`；與現值不同才 `emit("", tentative=text)`（`msg.text` 空字串，瀏覽器不追加）。收到 delta：先把 delta 轉成與暫定文字相同的字體（`display.tentative(delta)`），若暫定文字以它開頭就剝掉，但只在字的邊界剝（剩餘以空白或非 ASCII 開頭）；delta 蓋過整段暫定文字、或切進英文字中間（「robotaxis」被「robotaxi」確認）時直接清空，下一則 intermediate（約 250 ms）會重建；再 `emit(delta)`（emit 一律帶目前的 `tentative`）。`completed`：`self.tentative=""`，`close_item` 的 emit 帶空的 tentative。重連：清空後另送一則空文字事件，瀏覽器才會清掉暫定文字。`TranscriptDisplay.tentative(text)`：`self.chinese` 或（雙向且 `detected=="zh"`）時 `TO_TRADITIONAL.convert`，其餘原樣。

**替代方案**：把暫定文字併進 `displayText`。捨棄：瀏覽器無法分辨哪段可定稿翻譯、存檔會混入暫定字。

### 瀏覽器的 tentative 只影響顯示與暫譯

`app.js` 新增 `let tentative=''`。`onMessage` 在處理 `msg.text` 之前：`typeof data.tentative==='string'` 且不同 → 更新、`sourceRevision++`、`render('transcript',transcript)`、`scheduleTranslation(false)`。`render('transcript')` 在確認文字後 append `<span class="tentative">`（`refine.css`：`color: var(--sub-now)`）。新增 `pendingSource()=transcript.slice(translationOffset)+tentative`：`scheduleTranslation`／`runTranslation` 的「還有東西可翻」判斷、暫譯的 650 ms 重翻比較、cadence 的 ≥6 字門檻都改用它；暫譯請求的 segment 在 `plan.end===transcript.length`（尾巴）時接上 `tentative`；定稿（`final`）永遠不接。`subtitleParts().pending` 用 `pendingSource()`。`resetMeetingState` 與 `stopMeeting` 清空 `tentative`。`updateCounts`、匯出、`storeTranscript`、段落存檔只看 `transcript`。

## Implementation Contract

- 行為：用 MAI（含混合模式的英日文）時，逐字稿面板在確認文字後顯示淡色暫定文字，字幕「正在講的原文」與暫譯含暫定文字；delta 到達後暫定文字相應縮短；completed 後清空。定稿翻譯、匯出、段落存檔只含確認文字。本機 Confucius 的事件沒有 `tentative`，一切如舊。
- 介面：閘道器事件可含 `tentative: string`；`TranscriptDisplay.tentative(text) -> str`；`app.js` 的 `pendingSource()`。
- 失敗模式：MAI 不送 intermediate（舊模型）→ 行為與現在相同；暫定文字用字改變 → 下一個事件整段覆蓋，不會殘留。
- 驗收：`test_server.py`：事件序列 intermediate「这个会议」→ delta「这个会议」→ intermediate「支持实时」→ delta「支持实时翻译」→ completed，瀏覽器收到的 payload 依序為 `tentative:"這個會議"`（`msg.text` 空）、delta 帶 `tentative:""`（剝掉）、`tentative:"支持實時"`、最後 completed 的 payload `tentative:""`。`bench/translate_e2e.mjs`：注入 `{tentative:'正在講的暫定字'}` 事件後 `#transcript .tentative` 文字正確、`subtitleParts().pending` 以它結尾、匯出內容不含它；注入 `tentative:''` 後 span 消失。既有 196 項單元測試與 e2e 通過。
- 範圍：MAI 路徑與前端顯示／暫譯；不含本機引擎、不含存檔。

## Risks / Trade-offs

- 暫定字偶爾改字，畫面上會看到字被改掉；這正是「暫定」的意思，顏色已區分。
- intermediate 每 250 ms 一則，瀏覽器重繪與暫譯排程略增；暫譯仍受既有節奏限制（250 ms／650 ms／每多 12 字）。
