# 瀏覽器檢查紀錄（2026-11-15，gstack /browse 無頭 Chromium，重建後的 app 容器 http://localhost:18082）

| 任務 | 檢查 | 結果 |
|---|---|---|
| 1.1 | 校對頁 1280px，按「修改原文」前後量 `.seg-target` 寬度 | 465px → 465px，譯文完整（`review-edit-1280.png`）；500px 時編輯框與譯文各 434px 整列 |
| 2.1 | `/admin` 成員列按鈕 | 「移出團隊」`text-button danger` 顏色 rgb(255,141,114)；「移除照片」`text-button` rgb(155,172,190)（`admin-buttons.png`）；按一次顯示「確定把bob移出業務部？」，4.3 秒後恢復為「移出團隊」，未再按、未移出任何人 |
| 3.1 | 依 spec 範例表打開頭像選單，列出可見的頁面連結（myyang 為管理員） | 500 review：會議紀錄,成效指標,團隊管理；500 /actions：會議紀錄,成效指標,團隊管理（管理員）；alice 500 /actions：會議紀錄,成效指標（`menu-500.png`）；500 /metrics：會議紀錄,團隊管理；500 /：待辦看板,成效指標,團隊管理；850 /：成效指標；700 /actions：無；1280 /actions：無 |
| 4.1 | 從 `/meetings` 點連結進不存在的會議 | referrer 為 /meetings，顯示 返回上一頁、回開會頁、會議紀錄 與團隊管理員提示（`404.png`）；按返回上一頁回到 /meetings |
| 4.1 | 新分頁直接開 `/no-such-page` | referrer 空，只顯示 回開會頁、會議紀錄 |
| — | 原第 5 項（紀要說明）撤回依據 | 紀要頁上方已有說明段落（`minutes-existing-intro.png`，截圖時含已撤回的狀態文字） |
| 5.1 | `docker exec -w /app asr_confucius4-r2t2-app-1 python -m unittest -q test_server` | Ran 397 tests, OK |

## spectra-review 修正後（2026-11-15）

- review 指出：用分享連結登入後落到 404 時，referrer 是 `/login`（登入頁以 `location.replace` 離開），「返回上一頁」不應出現。`not-found.html` 已排除 `/login`，spec「Opened directly」情境補上這種情況。
- 自動檢查改由 `bench/ui_review_e2e.mjs`（change `ui-review-e2e`）負責：24 項全部 ok，含「404 right after signing in: no 返回上一頁」；連跑 5 次皆通過。
