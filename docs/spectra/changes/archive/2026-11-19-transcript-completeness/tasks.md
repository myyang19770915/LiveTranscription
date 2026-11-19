## 1. 漏句檢查

- [x] 1.1 `quality_pass.missing(given, back, convert)`：去贅詞、轉繁體後逐字對齊，回傳最長漏掉的連續片段（中文 ≥8 字、拉丁文字 ≥6 詞），否則空字串（需求「Nothing said is silently left out without translation」）。驗證：`TranscriptCompletenessTest` 以規格範例表四列檢查。
- [x] 1.2 第一次整理在不翻譯時用 `missing` 檢查回答（去重前的句子加 carry）；有漏就帶著漏掉的片段重問一次，採用漏得較少的回答，第二次失敗保留第一次；日誌只記字數。有翻譯時不檢查。驗證：`TranscriptCompletenessTest` 用假服務：第一次回答漏句、第二次完整時採用第二次且第二個請求含漏掉的片段；翻譯串流同樣漏句時只送一次請求。 [after: 1.1]
- [x] 1.3 回顧修訂在不翻譯時逐項檢查，漏了算不可用（重問一次，仍漏則視窗不變）。驗證：`TranscriptCompletenessTest`：兩次回答都漏 → 沒有 revision 事件；第二次完整 → 送出修訂。 [after: 1.1]

## 2. 證據優先與名詞補足

- [x] 2.1 兩份不翻譯指示加入證據優先、短答獨立、引號範圍、帶意義的「然後／就是／的話」保留等規則；第一次整理的請求在有 NOTES 時附上（標明只用於寫對名字與名詞），翻譯串流不附（需求「Without translation the wording follows the evidence and names learned so far」）。驗證：`TranscriptCompletenessTest` 檢查指示字句、NOTES 只出現在不翻譯的請求；全部 test_server 通過。 [after: 1.2]

## 3. 實際效果確認

- [x] 3.1 zh_chen 與會議錄音（20261117-192253）用新版各跑 3 次（先跑 1 次回報花費），與現行版（已有的 C、C2 與會議 C）由同一評審並排盲評；記錄每次分數、漏句重問次數與花費到 evidence.md（另加 6 段公開影片擴大評測）。驗證：evidence.md 有分數表與花費。 [after: 2.1]
