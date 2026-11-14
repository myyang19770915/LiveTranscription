// mai-usage on the team administration page, in a real browser with the admin API answered by the test: the figures
// are shown, and a warning appears near and over the budget. The page file is the one in webapp/static. Usage: YUQIAO_SESSION=… node bench/mai_usage_e2e.mjs [app url]
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const app = process.argv[2] || 'http://localhost:18082/';
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const pageHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../webapp/static/admin.html'), 'utf8');
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};

async function shown(usage) {   // usage: the API answer, or a status code when the request is refused
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  // The page itself is only served to administrators; the test account is not one, so the file is handed over here.
  await page.route(new URL('admin', app).href, route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml}));
  await page.route('**/api/admin/teams', route => route.fulfill({status: 200, contentType: 'application/json', body: '[]'}));
  await page.route('**/api/admin/mai-usage', route => typeof usage === 'number' ? route.fulfill({status: usage, contentType: 'application/json', body: '{"detail":"no"}'})
    : route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(usage)}));
  await page.goto(new URL('admin', app).href);
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => [document.getElementById('maiUsage').hidden, document.getElementById('maiUsageText').textContent,
    document.getElementById('maiUsageWarn').hidden ? '' : document.getElementById('maiUsageWarn').textContent]);
  await context.close();
  return result;
}
const usage = (seconds, usd, state) => ({seconds, usd, budgetUsd: 50, usdPerHour: 0.54, state, byPurpose: {bench: seconds}});
const text = (hours, usd) => `累計送出 ${hours} 小時的音訊，約 ${usd} 美元（上限 50 美元，每小時 0.54 美元）。金額依送出的音訊長度估算，不是帳單。`;

t('within the budget', await shown(usage(4800, 0.72, 'ok')), [false, text('1.3', '0.72'), '']);
t('near the budget', await shown(usage(266667, 40, 'near')), [false, text('74.1', '40.00'), '已達上限的八成。']);
t('over the budget', await shown(usage(400000, 60, 'over')), [false, text('111.1', '60.00'), '已達到或超過上限。雲端辨識仍可使用，是否繼續由你決定。']);
t('not an administrator: nothing is shown', await shown(403), [true, '', '']);
await browser.close();
