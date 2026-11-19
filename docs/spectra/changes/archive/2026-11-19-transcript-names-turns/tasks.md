## 1. 繁體轉換

- [x] 1.1 `server._Traditional.convert` 在轉出「隻」且後面接有／是／要／能／會／好／在／不／得時改回「只」，量詞「隻」不變（需求「Traditional conversion keeps the adverb 只」）。驗證：test_server 新測試依規格範例表四列檢查。

## 2. 不翻譯指示

- [x] 2.1 `quality_pass.POLISH_STEP` 與 `revise_pass.POLISH_STEP` 加入名稱整場一致、換人另起一項（附加問句留在說的人那項）、聽不清楚保留原字不改寫不加事實的規則；回顧修訂 NOTES 步驟（不翻譯版）要求記下每個名稱的固定寫法；有翻譯的指示不變（需求「Without translation names stay consistent, turns stay apart and unclear speech is not rewritten」）。驗證：test_server 新測試檢查兩份不翻譯指示含這些規則、翻譯指示不含；全部 test_server 通過。

## 3. 實際效果確認

- [x] 3.1 8 段錄音（zh_chen、會議 20261117-192253、bench/cases_transcript.json 的 6 段）用新版各跑 1 次（先跑 1 段回報花費），與 transcript-completeness 版本（已有的 D2／D1 與 *_new1）由同一評審並排盲評；記錄分數、名稱不一致與講者合併的次數、花費到 evidence.md。驗證：evidence.md 有分數表與花費。 [after: 2.1]

## 4. 依評測結果調整

- [x] 4.1 拿掉「名稱整場一致」「聽不清楚保留原字」與 NOTES 記固定寫法三條（8 段盲評：職場節目 −15、即興劇 −10，鎖住了聽錯的名字），保留換人另起一項與「只／隻」修正；規格改為需求「Without translation speaker turns stay apart」。驗證：`TranscriptNamesTurnsTest` 改為檢查換人規則存在、鎖名稱規則不存在；全部 test_server 通過。 [after: 3.1]
