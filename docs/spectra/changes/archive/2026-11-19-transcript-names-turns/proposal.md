## Why

擴大評測（8 段錄音）中，transcript-completeness 版本平均約 81 分，離使用者要的 90 分還差約 9 分。漏句已大幅減少，現在兩版共同的主要扣分是：
- 人名與專有名詞寫錯或前後不一致：同一人被寫成蘇小姐、徐小姐、孫小姐；宋夢雪／宋夢璇；KBox；Threads 寫成 Stress。
- 不同講者的話被併在同一項：主持人的追問和來賓的回答放在一句。
- 聽不清楚的片段被改寫成講者沒說的話：「無法持續照顧」變成「無法治癒」。
- 確定性的轉換錯誤：OpenCC 把「不是只有」轉成「不是隻有」。

## What Changes

- 繁體轉換修正（所有串流）：OpenCC 轉出的「隻」後面接副詞用法（有、是、要、能、會、好、在、不、得）時改回「只」，例如「不是只有」。
- （評測後移除）名稱前後一致：同一個人名、公司名、產品名在整場要寫成同一個樣子，依 TERMS、NOTES、CONTEXT／BEFORE 已用過的寫法；辨識結果給出另一種寫法時沿用先前的，除非明顯是另一個人。回顧修訂的 NOTES 要記下每個名稱的固定寫法。
- 講者輪替（不翻譯的兩份指示）：換人說話時（主持人追問、回答、附和）另起一項，兩個人的話不放在同一項，附加問句（對不對？）留在說它的人那一項。
- （評測後移除）聽不清楚時不改寫：一段話辨識得太亂而無法確定意思時，保留辨識到的字，不改寫成另一個說法，也不加入沒有說的事實（例如病情、原因）。

## Non-Goals

- 有翻譯的會議指示不變（繁體轉換修正除外，那是所有串流共用的確定性修正）。
- 不做講者辨識（diarization）與回顧修訂拆句：工程大，等這輪結果再決定。
- 不降低 transcript-completeness 的花費：另案處理。
- 台語辨識錯誤（時機歹歹 → 稀稀掰掰）屬於辨識模型範圍，不在本次處理。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `transcript-only`: 不翻譯時的指示加入講者輪替（第一次整理：換人另起一項；回顧修訂：不合併不同講者）。名稱一致與聽不清楚不改寫兩條在 8 段盲評中造成退步（職場節目 −15、即興劇 −10），已移除，見 evidence.md。
- `quality-pass`: 中文繁體轉換不把副詞「只」轉成「隻」。

## Impact

- Affected specs: transcript-only, quality-pass
- Affected code:
  - Modified: webapp/server.py, webapp/quality_pass.py, webapp/revise_pass.py, webapp/test_server.py
