## Why

開會中螢幕會依系統設定變暗、鎖定。手機瀏覽器在螢幕鎖定後可能停止收音，筆電閒置變暗時也看不到即時字幕。2026-11-13 的站台稽核確認目前沒有任何保持螢幕喚醒的處理。

## What Changes

- 會議或即時翻譯進行中，開會頁向瀏覽器要求保持螢幕喚醒；結束後放開。
- 分頁切到背景時瀏覽器會自動收回這個要求；回到分頁且仍在進行中時重新要求。
- 瀏覽器不支援或拒絕時不顯示錯誤，其他功能不受影響。

## Non-Goals (optional)

- 不提供開關：會議進行中保持螢幕喚醒沒有不想要的情境，結束就放開。
- 不處理螢幕已鎖定後的收音中斷：那是瀏覽器與作業系統的行為，頁面無法控制。
- 不用播放無聲影片等替代手法支援沒有 Screen Wake Lock API 的舊瀏覽器。

## Capabilities

### New Capabilities

- `screen-awake`: 會議進行中保持螢幕喚醒

### Modified Capabilities

(none)

## Impact

- 新增 webapp/static/wake-lock.js
- 修改 webapp/static/app.js、webapp/static/index.html
- 新增 bench/wakelockcheck.js
