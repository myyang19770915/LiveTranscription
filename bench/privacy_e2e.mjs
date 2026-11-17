// privacy-notice in a real browser: the notice follows /api/config, shows 資料去向 until it is read, counts unreadable
// settings as external translation, and says 雲端口譯 in 即時口譯 mode. Usage: YUQIAO_SESSION=… node bench/privacy_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.argv[2] || 'http://localhost:18082/';
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};

async function notice(config, interpret = false) {   // config: object to answer with, 'fail' for HTTP 500, 'hold' to never answer; interpret: switch to 即時口譯
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  await page.route('**/api/config', route => config === 'hold' ? undefined : config === 'fail' ? route.fulfill({status: 500, body: 'no'})
    : route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(config)}));
  await page.route('**/api/interpret/config', route => route.fulfill({status: 200, contentType: 'application/json',
    body: JSON.stringify({configured: true, allowed: true, usdPerHour: 2.04, targets: ['en', 'zh'], retentionDays: 90})}));
  await page.goto(app);
  await page.waitForTimeout(1200);
  if (interpret) { await page.click('#modeInterpret'); await page.waitForTimeout(200); }
  const shown = await page.evaluate(() => [document.getElementById('privacyNote').textContent, document.getElementById('secureLabel').textContent]);
  await context.close();
  return shown;
}

t('local translation', await notice({cloudRefine: false, mai: false, quality: false, cloudTranslate: false}), ['自架主機音訊與文字只在語橋主機處理', '自架主機']);
t('external translation', await notice({cloudRefine: true, mai: true, quality: true, cloudTranslate: true}), ['雲端翻譯文字會傳送到外部服務', '雲端翻譯']);
t('settings could not be read', await notice('fail'), ['雲端翻譯文字會傳送到外部服務', '雲端翻譯']);
t('settings not read yet', await notice('hold'), ['資料去向確認中…', '資料去向']);
t('即時口譯 (interpret-mode-on-home)', await notice({cloudRefine: false, mai: false, quality: false, cloudTranslate: false}, true), ['雲端口譯音訊會傳送到外部服務', '雲端口譯']);
await browser.close();
