## Why

會議、帳號、團隊、校對、紀要、待辦與成員照片都存在 Compose 的 named volume `meeting-db`（Postgres），錄音與逐字稿檔案存在 `output/`。但 README 有兩處（「模型快取位置」一段與「常用容器操作」一段）把 `docker compose down -v` 說成只會清除模型快取，照著做會連同會議資料庫一起刪掉，而且專案沒有任何備份或還原程序；`output/backups/` 裡只有一份 11/07 手動做的 dump，沒有說明怎麼還原，也沒有驗證過能還原。

## What Changes

- 修正 README 中 `docker compose down -v` 的說明：明確寫出會一併刪除 `meeting-db`（所有會議資料），只清模型快取時改用指定 volume 的 `docker volume rm`。
- 新增 `scripts/backup.ps1`：以 `pg_dump -Fc` 匯出資料庫（在 db 容器內產生，再 `docker cp` 出來，避免 PowerShell 管線破壞二進位資料），複製 `output/`（排除 `output/backups/`），並寫入一份清單（時間、git commit、各資料表筆數、檔案數）。資料庫不需停機。
- 新增 `scripts/restore.ps1`：
  - `-Drill`：啟動一個暫時的同版本 Postgres 容器，把備份還原進去，比對各資料表筆數與清單是否一致，最後移除暫時容器；完全不碰正式資料。
  - 正式還原：必須加 `-Force`；還原前自動先做一份備份，停止 app，重建資料庫並還原，複製回 `output/` 檔案，再啟動 app。
- README 新增「備份與還原」一節：何時備份、腳本用法、備份存放位置、還原與演練步驟。
- `.gitignore` 加入 `backups/`。

## Non-Goals

- 不做排程自動備份（Windows 工作排程器設定留給使用者，README 提供範例指令）。
- 不做異地或雲端備份、加密、備份保留期限。
- 不備份模型快取 volume（可重新下載）。
- 不搬動或刪除既有的 `output/backups/yuqiao-20261107.dump`。

## Impact

- Affected specs: none
- Affected code:
  - New: scripts/backup.ps1, scripts/restore.ps1, scripts/backup-common.ps1（兩個腳本共用的函式，包括演練與正式還原共用的 `Restore-Dump`）
  - Modified: README.md, .gitignore
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
