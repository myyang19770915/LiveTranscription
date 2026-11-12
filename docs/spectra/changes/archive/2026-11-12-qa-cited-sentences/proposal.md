## Problem

`meeting-qa` 規格要求問答的回答「每一句都附出處 `[n]`」，但伺服器只檢查整段回答裡至少有一個有效出處。模型若寫出「報價維持八五折 [2]。公司下週裁員。」，第二句沒有任何依據，仍會原樣顯示給使用者，看起來像有出處背書。

## Root Cause

`webapp/qa.py` 的 `check_answer()` 只移除不存在的編號，並在「整段沒有任何有效出處」時回「找不到」；沒有逐句檢查。

## Proposed Solution

`check_answer()` 移除無效編號後，把回答依句尾標點（。！？!?）與換行切成句子；緊接在句尾標點後的 `[n]` 屬於前一句。沒有任何有效出處的句子直接刪除，保留有出處的句子與原本的換行；刪完沒有剩下任何句子時回「找不到」。不需要多呼叫一次模型（使用者選擇）。

## Non-Goals

- 不檢查出處的語意是否真的支持該句（仍靠提示詞與評測）。
- 不改檢索、提示詞與回應格式。

## Success Criteria

- 規格「Citations checked」範例的每一列（含新增的三列）由 `test_server` 逐列斷言。
- 既有問答測試全部通過；`bench/qa_eval.py` 不需修改。

## Impact

- Affected specs: `meeting-qa`（修改「Asking a question」：沒有出處的句子會被刪除）
- Affected code:
  - Modified: webapp/qa.py, webapp/test_server.py
  - New: 無
  - Removed: 無
