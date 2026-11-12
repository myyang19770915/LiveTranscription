## Problem

校對頁修改一段原文後會自動重譯。重譯要等雲端或本機模型串流完成（數秒）。在這段時間內如果同一段又被修改（自己再改一次，或另一位校對者改了），舊的重譯結果回來時會帶著**新的**版本號存檔：舊原文的譯文被寫到新原文上，而且繞過了後端的版本衝突保護（409）。

## Root Cause

`webapp/static/review.js` 的 `retranslate()` 在翻譯完成**之後**才以 `bySeq(seq)` 取得當下的段落與 `version` 送出儲存；期間的任何修改都會讓它拿到新版本號，後端因此認為這次儲存是基於最新版本。

## Proposed Solution

- 重譯開始時記下該段的 `version` 與原文；完成後以**開始時的版本**送出儲存，期間若有人改過，後端照規則回 409 並重新載入該段。
- 完成時若該段原文已和開始時不同，直接捨棄這次結果並提示「原文已再次修改，略過這次重譯」（新的修改本身會觸發自己的重譯）。
- 新增 `bench/reviewcheck.js`：取出 `review.js` 實際的 `retranslate` 函式，以可控制完成時機的假翻譯與假 API 重現競態，失敗時以非 0 結束。

## Non-Goals

- 不改後端 API 與版本規則。
- 不做取消進行中翻譯請求的功能（結果回來時捨棄即可）。

## Success Criteria

- `node bench/reviewcheck.js`：重譯進行中原文被改 → 不送出儲存、顯示略過提示；版本被別人更新但原文相同 → 以開始時的版本送出（後端會回 409）；沒有變動 → 以原版本正常儲存。修正前此檢查會失敗。
- 既有 `bench/*check.js` 與 `test_server` 通過。

## Impact

- Affected specs: `transcript-review`（修改「Concurrent edits are detected」：重譯以開始時的版本儲存，原文已變更時捨棄）
- Affected code:
  - Modified: webapp/static/review.js
  - New: bench/reviewcheck.js
  - Removed: 無
