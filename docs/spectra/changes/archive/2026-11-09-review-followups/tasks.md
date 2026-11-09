## 1. 寄信

- [x] 1.1 Requirement「Member e-mail address」：`auth.valid_email` 改為 ASCII 一般地址規則（設計：Email 規則採 ASCII 一般地址），`mailer.recipients` 略過不合格的已存地址；驗證：MemberEmailTests 的地址範例表八列與「不合格已存地址列為未寄到」測試通過
- [x] 1.2 Requirement「Mail server configuration」與「Send record」：`send_message` 回傳被拒收件人、部分被拒記為失敗（設計：部分被拒記為失敗）、`SMTP_TLS` 未知值改用 starttls（設計：SMTP_TLS 未知值改用 starttls）、`deliver` 攔所有例外（設計：deliver 攔所有例外）；驗證：MinutesMailTests 新增的部分被拒、未知 SMTP_TLS、未預期例外測試通過

## 2. 提醒

- [x] 2.1 Requirement「Reminder timing」：`run()` 以 finally 撤銷未寄出的佔位（設計：提醒佔位以 try/finally 撤銷）、`due_now` 與每 5 分鐘輪詢的 `worker`、失敗 30 分鐘後同日重試（設計：排程改為輪詢）；驗證：ActionReminderTests 的中斷撤銷與 due_now 範例表測試通過

## 3. 介面與文件

- [x] 3.1 Requirement「Screen view with subtitles」：字級上限 5.5vh、字幕框 overflow hidden（設計：字級上限 5.5vh）；驗證：`bench/translate_e2e.mjs` 新增 1366×600 最大字級檢查通過
- [x] 3.2 看板詳細面板：切換後焦點留在開關、網路錯誤恢復並顯示「切換失敗」、新增表單系列說明改為下方小字、控制項寬度 min(220px, 100%)；驗證：`bench/reminders_e2e.mjs` 通過並檢查切換後焦點
- [x] 3.3 浮動字幕：會議模式切句一次、原文按鈕提示「顯示原文」；e2e 改用 260px 高視窗並檢查最新一段在可見範圍內；README「畫面＋字幕」段落與 overlay.js 註解更新；驗證：`bench/translate_e2e.mjs` 全部通過、README 內容檢視
- [x] 3.4 [after: 1.1, 1.2, 2.1, 3.1, 3.2, 3.3] 全部單元測試、`bench/mail_e2e.mjs`、`bench/reminders_e2e.mjs`、`bench/translate_e2e.mjs` 通過；驗證：各指令輸出
