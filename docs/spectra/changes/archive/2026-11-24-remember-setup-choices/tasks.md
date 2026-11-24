## 1. 測試先行

- [x] 1.1 新增 `bench/remember_setup_e2e.mjs`（Playwright、假的三支麥克風、攔截 `POST /api/meetings` 不建立會議），寫入 meeting-setup-layout「The page remembers every sentence choice」的五個情境與「翻譯成 by mode」表格兩列的檢查，再加「只剩名稱相同時依名稱選回」與「記住的值不存在時不覆蓋記憶」。改程式前先跑一次並把輸出留在 evidence.md。驗證：音訊來源、麥克風、即時翻譯的語言與目標這幾項失敗（符合預期），模式與團隊等既有記憶的檢查通過。

## 2. 記住與還原

- [x] 2.1 設計「音訊來源記在 audioSource」：`app.js` 在 `#audioSource` 的 change 寫入，載入時還原（選項存在且未停用才還原），再呼叫 `updateSourceUI()`。驗證：bench「The audio source after a reload」與「清除」通過。 [after: 1.1]
- [x] 2.2 設計「麥克風記裝置代碼與名稱，只有使用者自己選才寫入」：`#microphone` 的 change 寫入 `microphoneId`、`microphoneLabel`；`refreshMicrophones()` 依 正在使用的 → 記住的代碼 → 記住的名稱（這次還沒選過時）→ 目前顯示的 → 第一支 的順序選擇，程式自行選擇時不寫入；還沒有麥克風權限時，`audioConstraints()` 以 `ideal` 要求記住的那支。驗證：bench 的麥克風四項（同代碼、只剩名稱、都不存在時選第一支且記憶不變、句子顯示名稱）通過；`audio_test_e2e` 照常通過。 [after: 1.1]
- [x] 2.3 設計「語音語言共用一個，翻譯目標依模式分開」：語音語言在三種模式都記在 `meetingLanguage` 並在載入時還原；即時翻譯的翻譯目標記在 `translateTarget`，切到即時翻譯與載入時還原；只在使用者操作 `#language`、`#targetLanguage` 或交換鈕時寫入，模式切換的自動調整不寫入。驗證：bench「Choices made in 即時翻譯」與「翻譯成 by mode」兩列通過；`ui_sentence_menus_e2e`、`ui_night_celadon_e2e` 照常通過。 [after: 1.1]

## 3. 收尾

- [x] 3.1 更新 `index.html` 的 `app.js?v=`，跑完整驗收：`remember_setup_e2e`、`ui_sentence_menus_e2e`、`ui_setup_collapse_e2e`、`ui_night_celadon_e2e`、`audio_test_e2e`、`web_platform_polish_e2e`、`node bench/checks.js`，並比對會議數前後相同；結果寫入 evidence.md。驗證：全部通過（`checks.js` 既有的 closecheck、privacycheck 兩項失敗除外），會議數不變。 [after: 2.1, 2.2, 2.3]
