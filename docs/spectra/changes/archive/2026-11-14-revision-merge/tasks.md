## 1. 閘道器：修訂可以合併

- [x] 1.1 spec「Shown sentences are revised with more context」「A revision accounts for every sentence」「Revision logs contain no meeting text」；設計決策「回答以缺少的編號表示合併」「revision 事件帶出被併入的編號」「日誌多一個 merged 數字」：`Reviser` 接受回答項目的 `ids`（最多 2 句、同語言、依序涵蓋視窗每一句一次），合併後的句子沿用第一句的 `id`、結束時間取最後一句，`revision` 事件帶 `merged` 與 `endMs`，被併的句子不再出現在之後視窗的前文，日誌行含 `merged=`；提示詞加入合併規則。驗證：`ReviserTest` 新測試（合併的事件內容與規格範例一致、可用與否的表格新增四列、跨語言合併被拒、下一個視窗的前文只有 5 句）與既有測試通過。
- [x] 1.2 [after: 1.1] spec「Revision ends with the stream」；設計決策「結束時各組同時修訂」：串流結束時尚未修訂的各組同時送出請求，總時限 30 秒。驗證：`ReviserTest` 新測試（結束時剩 15 句、每個回答延遲，兩個請求在第一個回答前都已送出，兩個 `revision` 事件都送出）與既有結束測試通過。

## 2. 儲存

- [x] 2.1 spec「Merged segments are stored as one」；設計決策「伺服器合併已儲存的段落」：`PUT /api/meetings/{id}/segments` 接受 `merged`，依規則把被併段落的 `asr_text`、`live_target` 接到前一段、延長結束時間並刪除被併段落；無法合併時兩段都不動且不更新 `into` 的文字；`from` 不大於 `into` 回 422。驗證：`SegmentStorageTests` 新測試（合併、重送、已校對、被併段落未儲存、中日英的相接方式、422）。

## 3. 頁面

- [x] 3.1 spec「The page replaces revised sentences」「Kept segments are stored as the meeting segments」；設計決策「段落的順序編號在保留時固定」：`QualityView` 的段落在保留時取得固定的 `seq`，`revise` 處理 `merged`（移除被併段落、更新結束時間、記錄 `{into, from}`），`app.js` 儲存時送每段的 `seq` 與 `merged` 清單；資源版本參數更新。驗證：`node bench/qualitycheck.js` 新案例（合併後剩三段、編號 1、2、4、5 與合併清單、未知編號忽略）；`node bench/quality_e2e.mjs` 新增合併後兩欄各少一段的檢查。

## 4. 文件與實測

- [x] 4.1 [after: 1.2, 2.1, 3.1] `README.md` 的回顧修訂說明改為可以合併被切開的句子、段落編號可能不連續、結束時各組同時修訂。驗證：README 相關段落與規格一致（內容檢視）；`python -m unittest -q test_server` 全數通過。
- [x] 4.2 [after: 4.1] 重啟正式站 app 後，以正式站設定重錄 10 段、與 `quality_k` 及基準同輪盲評，結果與合併比例寫入 `bench/README.md`。驗證：`bench/results/` 有該輪評審檔與分數；日誌中 `failed` 的修訂視窗不超過總數的 10%；錄製前回報 MAI 累計金額。
