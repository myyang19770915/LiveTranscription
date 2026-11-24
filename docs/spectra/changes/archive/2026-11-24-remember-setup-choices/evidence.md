# 驗收紀錄（2026-11-24）

## 改程式前（任務 1.1，預期失敗）

`YUQIAO_SESSION=… node bench/remember_setup_e2e.mjs`（第一版的檢查）：

```
ok   three microphones are listed 3
FAIL the audio source after a reload ["microphone",null]
ok   back to the microphone after a reload "microphone"
FAIL the microphone after a reload: same device, its name in the sentence ["default","Fake Default Audio Input"]
FAIL a changed device id: restored by the name "default"
ok   the stored microphone is unplugged: the first one, and the stored choice is kept ["default","gone","No such microphone"]
FAIL choosing again stores the new microphone ["default","gone"]
FAIL 即時翻譯: mode, spoken language and 翻譯成 after a reload ["translate","zh_ja","zh_ja"]
FAIL 即時翻譯: 翻譯成 after leaving the mode and coming back "zh_ja"
FAIL 翻譯成 by mode: 不翻譯 in 開會, 日文 in 即時翻譯 ["zh_ja","zh_ja"]
FAIL 清除 keeps every choice ["meeting","zh_ja","zh_ja","microphone","default","1"]
ok   no page errors []
ok   翻譯成 by mode: 英文 in 開會, nothing chosen in 即時翻譯 [["meeting","en"],"en"]
ok   中日雙向 chosen in 開會 is still there after visiting another mode "zh_ja"
ok   no page errors (second visit) []
ok   without storage the page still works ["system",true]
```

音訊來源、麥克風、即時翻譯的語言與翻譯目標、清除後的值都沒有保留；模式與開會模式的記憶本來就有。

## 改程式後

測試瀏覽器每次重新載入都會換一組裝置代碼（一般的 Chrome 設定檔不會），所以麥克風的檢查分成幾組：真的假裝置驗證依名稱還原；固定代碼的裝置清單驗證依代碼還原、同名兩支的分辨、拔掉再插回；另一組模擬還沒有麥克風權限（清單沒有代碼與名稱），驗證第一次測試音源時要求的是記住的那支（review 提出後加入）。

```
ok   three microphones are listed 3
ok   the audio source after a reload, named in the sentence ["system",true,false]
ok   back to the microphone after a reload "microphone"
ok   the microphone after a reload: the same one, its name in the sentence ["Fake Audio Input 1","Fake Audio Input 1"]
ok   the stored microphone is unplugged: the first one, and the stored choice is kept ["Fake Default Audio Input","gone","No such microphone"]
ok   choosing again stores the new microphone ["Fake Audio Input 2","Fake Audio Input 2"]
ok   即時翻譯: mode, spoken language and 翻譯成 after a reload ["translate","en","ja"]
ok   即時翻譯: 翻譯成 after leaving the mode and coming back "ja"
ok   翻譯成 by mode: 不翻譯 in 開會, 日文 in 即時翻譯 ["none","ja"]
ok   清除 keeps every choice ["meeting","zh","none","mixed","Fake Audio Input 2","1"]
ok   no page errors []
ok   翻譯成 by mode: 英文 in 開會, nothing chosen in 即時翻譯 [["meeting","en"],"en"]
ok   中日雙向 chosen in 開會 is still there after visiting another mode "zh_ja"
ok   no page errors (second visit) []
ok   fixed ids: the stored id is selected, not the first of the same name "id-b"
ok   fixed ids: unplugged at load, the first one is shown and the stored one is kept ["id-a","id-c"]
ok   fixed ids: plugged in again, it is selected "id-c"
ok   fixed ids: a choice on this visit stays when the device list changes "id-a"
ok   no page errors (fixed ids) []
ok   no access yet: the test asks for the remembered microphone, which is then selected ["",{"ideal":"id-b"},"id-b","id-b"]
ok   no page errors (no access yet) []
ok   without storage the page still works ["system",true]
```

## 其他 bench（同一次執行）

| bench | 結果 |
| --- | --- |
| ui_sentence_menus_e2e | 24 ok, 0 FAIL |
| ui_setup_collapse_e2e | 17 ok, 0 FAIL |
| ui_night_celadon_e2e | 93 ok, 0 FAIL |
| audio_test_e2e | 17 ok, 0 FAIL |
| web_platform_polish_e2e | 51 ok, 0 FAIL |
| node bench/checks.js | 15 項中 2 項失敗（closecheck、privacycheck），與修改前的 HEAD 相同 |

會議數執行前後都是 37。
