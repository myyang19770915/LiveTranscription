## 1. 逐句檢查出處

- [x] 1.1 修改 `webapp/qa.py` 的 `check_answer()`，實現 Asking a question 規格的逐句規則：依句尾標點與換行切句（句尾標點後緊接的 `[n]` 屬於前一句），刪除沒有有效出處的句子並保留換行，全部刪除時回「找不到」。驗證：`webapp/test_server.py` 的 `test_citations_are_checked` 逐列斷言規格「Citations checked」範例（含新增三列）；以 `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過。
