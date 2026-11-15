## Why

`ui-review-fixes`（2026-11-15）改了四個前端行為：校對頁改字時譯文保留在原欄、團隊管理「移出團隊」與「移除照片」的文字與樣式、窄螢幕頭像選單補上被藏起的頁面連結、404 頁只在從本站進來時顯示「返回上一頁」。`/spectra-verify` 指出這些依頁面、寬度、身分、來源而變的分支只有手動瀏覽器檢查（`docs/spectra/changes/ui-review-fixes/evidence/browser-checks.md`），沒有可重跑的自動測試；`account.js` 被 8 個頁面共用，改壞時問題會出現在沒在看的頁面。

## What Changes

- 新增 `bench/ui_review_e2e.mjs`，沿用 `bench/*_e2e.mjs` 的寫法（gstack 的 Playwright、`YUQIAO_SESSION` 登入、每項印 `ok`／`FAIL`、任何失敗以 exit code 1 結束、截圖存到指定目錄），逐項斷言：
  1. 校對頁 1280px：按「修改原文」後 `.seg-target` 寬度與編輯前相同、文字不變；500px 時編輯框與譯文都佔整列。
  2. `/admin`：每列有「移出團隊」（`danger`，顏色與「移除照片」不同）；有照片的成員另有「移除照片」（非 `danger`）；按一次「移出團隊」文字變為「確定把〈名稱〉移出〈團隊〉？」，約 4 秒後恢復；不按第二次，不改任何資料。
  3. 頭像選單：依 site-navigation spec 範例表的 7 列（寬度、頁面、身分）打開選單，可見的頁面連結與表格完全相同；一般成員一列以 `YUQIAO_MEMBER_SESSION` 登入，未提供時該列標示略過。
  4. 404：從 `/meetings` 點進不存在的會議時顯示「返回上一頁」與團隊管理員提示，按下回到 `/meetings`；新分頁直接開時不顯示「返回上一頁」。
- `bench/README.md` 加上這支檢查的用途與執行方式。

## Non-Goals

- 不改任何應用程式行為與 spec。
- 不引入新的前端測試框架或 npm 依賴；沿用 gstack 已安裝的 Playwright，與既有 `bench/*_e2e.mjs` 相同。
- 不把這支檢查接進 `test_server` 單元測試或 CI；與其他 e2e 一樣手動執行。

## Impact

- Affected specs: none
- Affected code:
  - New: bench/ui_review_e2e.mjs
  - Modified: bench/README.md
  - Removed: (none)
- Compatibility: no capability-level observable behavior changes
