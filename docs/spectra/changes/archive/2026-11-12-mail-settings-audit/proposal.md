## Why

團隊的紀要寄送設定（寄給成員或團隊信箱、信箱地址、定稿自動寄送）依規格可以由任何團隊成員或系統管理員修改。系統管理員即使不是該團隊成員，也能把自動寄送地址改成任意信箱，讓這個團隊之後定稿的紀要自動寄到團隊以外，而團隊成員無從得知。使用者決定保留管理員修改的能力，但每次修改都要留下紀錄並讓團隊看得到。

## What Changes

- 新增資料表 `team_mail_changes`：每次實際有變動的修改記錄時間、修改者、修改者當時是否為該團隊成員，以及修改前後的寄送對象、地址、自動寄送。
- 紀要頁的寄送區塊顯示最近一次修改：「寄送設定由 王愛麗 於 11/12 14:03 修改」。修改者不是團隊成員（系統管理員）時以警示樣式顯示，並寫出修改內容，例如「寄送設定由 管理員（系統管理員，非團隊成員）於 11/12 14:03 修改：改寄團隊信箱 x@corp.example」。
- `GET` 紀要時回傳的寄送資訊新增 `lastChange`。

## Non-Goals

- 不限制管理員修改（使用者選擇保留）。
- 不寄通知信給團隊。
- 不做完整的修改歷程頁，只顯示最近一次。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `minutes-mail`: 新增「寄送設定的修改留下紀錄」需求。

## Impact

- Affected specs: minutes-mail
- Affected code:
  - Modified: webapp/mailer.py, webapp/static/minutes.js, webapp/static/minutes.html, webapp/test_server.py
  - New: webapp/migrations/017_mail_setting_changes.sql
  - Removed: 無
