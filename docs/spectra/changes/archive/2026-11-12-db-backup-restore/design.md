## Context

- 資料庫：Compose 服務 `db`（`pgvector/pgvector:0.8.7-pg17-trixie`，使用者與資料庫都是 `yuqiao`，`POSTGRES_USER` 為超級使用者），資料在 named volume `meeting-db`，只在 Compose 內網，不對外開 port。目前約 11 MB，擴充套件 `plpgsql`、`pg_trgm`、`vector`。成員照片存在資料表 `user_avatars`，會跟著資料庫備份。
- 檔案：`./output` 以 bind mount 掛進 app（`/output`），存錄音（.webm／.wav）、純文字逐字稿、團隊檔案；目前約 20 MB。`output/backups/` 有一份既有的手動 dump。bind mount 不受 `down -v` 影響，但仍需要和資料庫一起備份，才能還原到一致的狀態。
- 使用環境：Windows＋Docker Desktop，專案慣例以 PowerShell 操作（README 的指令都是 PowerShell）。
- README 有兩處說 `docker compose down -v` 只清模型快取：「模型快取位置」一段（提到 `model-cache` 等 named volumes），以及「常用容器操作」一段。

本變更只新增維運腳本與修正文件，系統對使用者的行為不變。

## Goals / Non-Goals

**Goals:**

- 文件不再引導使用者誤刪會議資料庫。
- 一個指令就能做出可還原的完整備份（資料庫＋`output/`）。
- 能在不碰正式資料的情況下，證明某份備份確實能還原（演練）。
- 正式還原有防呆：一定要明確同意，還原前自動先備份目前狀態。

**Non-Goals:**

- 排程、異地、加密、保留期限。
- 模型快取備份。
- 處理既有的 `output/backups/` 檔案。

## Decisions

### 備份在容器內產生 dump 再以 docker cp 取出

`docker exec <db> pg_dump -U yuqiao -d yuqiao -Fc -f /tmp/<name>.dump`，接著 `docker cp` 到備份資料夾，再刪掉容器內的暫存檔。Windows PowerShell 5.1 的管線與 `>` 會把二進位輸出當文字重新編碼，直接 `docker exec ... pg_dump > file` 產生的 dump 會損壞，所以不用管線。

替代方案：用 `-Fp` 純文字 SQL 經管線輸出 → 仍有編碼風險，還原也比較慢，不採用。

### 備份資料夾結構與清單

預設 `backups\<yyyyMMdd-HHmmss>\`（專案根目錄，加入 `.gitignore`），可用 `-Destination` 改。內容：
- `yuqiao.dump`
- `output\`：`robocopy` 複製 `output/`，排除 `backups` 子資料夾
- `manifest.json`：
  - 備份時間、`git rev-parse HEAD`、db 映像名稱；
  - 每個 `public` 資料表的筆數（dump 完成後立即以單一查詢計算）；
  - `output` 的檔案數與總位元組數。

dump 完成後在 db 容器內執行 `pg_restore --list` 確認 dump 可讀，失敗就以非 0 結束。

### 演練還原進暫時容器並比對筆數

`restore.ps1 -Backup <資料夾> -Drill`：
1. 以 `docker inspect` 取得正式 db 容器的映像。
2. 啟動暫時容器 `yuqiao-restore-drill-<時間>`（`--rm`、不開 port、隨機密碼）。
3. 等 `pg_isready`，把 dump 複製進去並 `pg_restore -U yuqiao -d yuqiao --exit-on-error`。
4. 用與備份相同的查詢計算各表筆數，逐表與 `manifest.json` 比對；檢查備份裡 `output\` 的檔案數與清單一致。
5. 不論成功與否，都在 `finally` 移除暫時容器。

全部一致時印出「演練成功」並以 0 結束，否則列出差異並以 1 結束。

備份時若同時有人寫入，筆數可能和 dump 差幾筆。README 註明備份應在沒有進行中會議時執行；演練若出現差異，就以該報告判斷。

### 正式還原必須 -Force，並先自動備份

`restore.ps1 -Backup <資料夾> -Force`：
1. 沒有 `-Force` 時只印出會發生什麼，以 1 結束。
2. 先執行 `backup.ps1`，把目前狀態備份到 `backups\pre-restore-<時間>\`，失敗就停止。
3. `docker compose stop app`。
4. 在 db 容器內 `DROP DATABASE yuqiao WITH (FORCE)`、`CREATE DATABASE yuqiao OWNER yuqiao`，再 `pg_restore --exit-on-error`。
5. 以 `robocopy /E` 把備份的 `output\` 複製回 `output/`。只覆蓋與新增，不刪除還原點之後新增的檔案。
6. 用與演練相同的方式比對筆數（在啟動 app 之前，避免 app 寫入 session 或套用 migration 造成差異）。
7. `docker compose start app`。

步驟 4 之後若失敗，印出 pre-restore 備份的位置與回復指令；資料庫已開始重建時 app 保持停止（避免在只還原一半的資料庫上服務），資料庫還沒動時才重新啟動 app。

替代方案：`pg_restore --clean` 直接覆蓋 → 舊版本才有、新版本沒有的物件會殘留，不採用。

## Implementation Contract

**行為**

- `scripts\backup.ps1 [-Destination <路徑>] [-Label <前綴>]`（`-Label` 讓資料夾名稱成為 `<前綴>-<時間>`，正式還原以 `pre-restore` 呼叫）：
  - 成功時印出備份資料夾路徑、dump 大小、資料表數、`output` 檔案數，以 0 結束；
  - 任何步驟失敗（db 容器沒在跑、dump 無法讀取、複製失敗）都印出原因，並以非 0 結束。
- `scripts\restore.ps1 -Backup <資料夾> -Drill`：不改動正式資料庫、`output/` 與 app，結果如上一節所述。
- `scripts\restore.ps1 -Backup <資料夾> -Force`：依上一節的步驟還原；沒有 `-Force` 也沒有 `-Drill` 時不做任何改動。
- 兩個腳本都以專案根目錄為基準（`$PSScriptRoot\..`），可以從任何目錄執行；以 `docker compose ps -q db` 找 db 容器，不寫死容器名稱。

**文件**

- README 兩處 `down -v` 說明改為：會刪除所有 named volumes，**包括會議資料庫 `meeting-db`**；只想清模型快取時用 `docker volume rm` 指定 volume，並且先跑 `scripts\backup.ps1`。
- 新增「備份與還原」一節，內容包括：
  - 備份指令與內容；
  - 備份要在沒有進行中會議時做；
  - 演練與正式還原的指令；
  - Windows 工作排程器的範例指令（不由腳本建立）。

**驗收**

- 在目前環境執行 `backup.ps1`：產生資料夾，`manifest.json` 有各表筆數。
- 對剛產生的備份執行 `restore.ps1 -Drill`：印出演練成功；事後 `docker ps -a` 沒有殘留的 drill 容器；正式資料庫筆數不變。
- 竄改測試：把一份備份的 `manifest.json` 某表筆數改掉再演練，應以 1 結束並列出差異；損壞的 dump 應在還原步驟失敗並以 1 結束。這些都在 scratchpad 的副本上做，不動原備份。
- `restore.ps1` 不帶 `-Force`／`-Drill`：不做任何改動並以 1 結束。
- 正式還原的流程不在正式環境實際執行，因為它會重建正式資料庫。它的資料庫還原步驟與演練共用同一個函式，由演練驗證；停止與啟動 app、事前備份的步驟，以 `-WhatIf` 式的說明輸出人工審閱。
- 對使用者的行為不變：`test_server` 全部通過。

**範圍**

- 範圍內：兩個腳本與共用函式檔 `scripts/backup-common.ps1`、README、`.gitignore`。
- 範圍外：app、ASR 程式碼，compose 設定，既有備份檔。

## Risks / Trade-offs

- [正式還原從未在正式環境實跑] → 資料庫還原與演練共用程式碼，演練每次都驗證；事前自動備份提供回復點。
- [備份時有寫入，導致筆數與 dump 不一致] → README 要求在沒有進行中會議時備份，演練會明確列出差異。
- [`output/` 成長後備份變大、變慢] → 目前約 20 MB；之後若太大，再另開變更改為增量備份。這是依目前大小所做的推估。
