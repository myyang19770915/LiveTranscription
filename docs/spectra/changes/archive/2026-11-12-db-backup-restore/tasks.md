## 1. 文件修正

- [x] 1.1 修正 README 兩處 `docker compose down -v` 的說明（「模型快取位置」與「常用容器操作」兩段），明確寫出會刪除會議資料庫 `meeting-db`，只清模型快取時改用 `docker volume rm` 指定 volume，並先備份。驗證：`grep -n "down -v" README.md` 的每一處都提到會議資料庫；人工審閱。

## 2. 備份

- [x] 2.1 依「備份在容器內產生 dump 再以 docker cp 取出」與「備份資料夾結構與清單」，新增 `scripts/backup.ps1`，並在 `.gitignore` 加入 `backups/`。成功時產生 `backups\<時間>\`，內含 `yuqiao.dump`（已用 `pg_restore --list` 確認可讀）、`output\`（不含 `backups`）、`manifest.json`（各表筆數、檔案數、commit）；db 容器沒在跑時印出原因並以非 0 結束。驗證：實際執行一次，檢查資料夾內容與 `manifest.json`；`git check-ignore backups/x` 有輸出。

## 3. 還原

- [x] 3.1 [after: 2.1] 依「演練還原進暫時容器並比對筆數」，新增 `scripts/restore.ps1` 的 `-Drill` 模式。驗證：對 2.1 的備份演練，印出演練成功並以 0 結束，`docker ps -a` 沒有殘留的 drill 容器，正式資料庫筆數不變；在 scratchpad 的副本上竄改 `manifest.json` 筆數，演練以 1 結束並列出差異；把副本的 dump 截斷，演練在還原步驟以 1 結束。
- [x] 3.2 [after: 3.1] 依「正式還原必須 -Force，並先自動備份」，完成 `restore.ps1` 的正式還原模式：沒有 `-Force`／`-Drill` 時只說明並以 1 結束；有 `-Force` 時先備份到 `backups\pre-restore-<時間>\`，再停 app、重建資料庫並還原、複製回 `output/`、啟動 app、比對筆數。資料庫還原與 3.1 共用同一個函式。驗證：不帶旗標執行，確認沒有任何改動並以 1 結束；人工審閱正式還原的步驟順序，不在正式環境實跑。

## 4. 說明與整體驗證

- [x] 4.1 [after: 1.1, 3.2] README 新增「備份與還原」一節：備份指令與內容、在沒有進行中會議時備份、演練與正式還原的指令、Windows 工作排程器的範例。驗證：照 README 的指令再跑一次 `backup.ps1` 與 `restore.ps1 -Drill`，都成功；`docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` 全部通過。
