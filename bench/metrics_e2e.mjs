// End-to-end acceptance for the outcome metrics page (outcome-metrics) in the real pages (Playwright, gstack's install).
// Reads only: it checks the four tiles, the AI split, the weekly chart (hover tooltip, table view), the transcript
// table, the period filter in the address, the header link, light and dark, and 400 px. Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<token> node bench/metrics_e2e.mjs <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/metrics_e2e.mjs <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));

  // Header link from another page.
  await page.goto(`${app}/actions`); await page.waitForSelector('#account a');
  check('header links to the metrics page', await page.locator('#account a[href="/metrics"]').isVisible());
  await page.click('#account a[href="/metrics"]'); await page.waitForSelector('.tile');
  check('no link to the page it is on', await page.locator('#account a[href="/metrics"]').count() === 0);

  // Tiles: label, value (a percentage, a duration or —), and what it was computed from.
  const tiles = await page.locator('.tile').evaluateAll(t => t.map(n => [n.querySelector('.tile-label').textContent, n.querySelector('.tile-value').textContent, n.querySelector('.tile-note').textContent]));
  check('four tiles with label, value and basis', tiles.length === 4 && tiles.every(([l, v, n]) => l && /^(—|[\d.]+%|[\d.]+(小時|天))$/.test(v) && n.length > 4), tiles);
  // AI split or its empty note, with a table and legend when there is data.
  const split = await page.locator('#ai .split').count();
  check('AI split shows parts with a legend and a table, or says there is no data',
    split ? await page.locator('#ai .split-part').count() >= 1 && await page.locator('#ai .legend li').count() === 4 && await page.locator('#ai table tbody tr').count() === 4
      : await page.locator('#ai .viz-empty').count() === 1);
  // Weekly chart: 12 weeks, a tooltip on hover, a table view.
  check('weekly chart has 12 weeks', await page.locator('#weekly .hit').count() === 12);
  await page.locator('#weekly .hit').last().hover();
  const tip = await page.locator('#weekly .viz-tip').textContent();
  check('pointing at a week shows its start date and counts', !await page.locator('#weekly .viz-tip').isHidden()
    && /^\d{4}\/\d{2}\/\d{2} 那週/.test(tip) && /新增 \d+ 件/.test(tip) && /完成 \d+ 件/.test(tip), tip);
  await page.screenshot({path: join(out, 'metrics-light.png'), fullPage: true});
  await page.click('#weeklyTable');
  check('table view lists the 12 weeks', await page.locator('#weekly table tbody tr').count() === 12 && await page.locator('#weekly svg').count() === 0);
  await page.click('#weeklyTable');
  check('chart view comes back', await page.locator('#weekly svg').count() === 1);
  check('transcript table or its empty note', await page.locator('#transcript table').count() + await page.locator('#transcript .viz-empty').count() === 1);

  // Period in the address.
  const before = await page.textContent('#range');
  await Promise.all([page.waitForResponse(r => r.url().includes('/api/metrics?') && r.url().includes('days=90')), page.selectOption('#days', '90')]);
  await page.waitForFunction(b => document.querySelector('#range').textContent !== b, before);
  check('choosing 近 90 天 updates the range and the address', page.url().includes('days=90'));
  await page.reload(); await page.waitForSelector('.tile');
  check('the period survives a reload', await page.inputValue('#days') === '90');

  // Team filter in the address; an unknown team falls back to all teams with a notice.
  const teamId = await page.locator('#team option').nth(1).getAttribute('value');
  await Promise.all([page.waitForResponse(r => r.url().includes(`team=${teamId}`)), page.selectOption('#team', teamId)]);
  check('choosing a team puts it in the address', page.url().includes(`team=${teamId}`));
  await page.goto(`${app}/metrics?team=999999`); await page.waitForSelector('.tile');
  await page.waitForSelector('#notice:not([hidden])');
  check('an unknown team falls back to all teams', !page.url().includes('team=') && (await page.textContent('#notice')).includes('全部團隊'));

  // Dark theme.
  await page.click('#themeToggle'); await page.waitForTimeout(200);
  await page.screenshot({path: join(out, 'metrics-dark.png'), fullPage: true});
  const bar = await page.locator('#weekly .bar-1').first().evaluate(n => getComputedStyle(n).fill).catch(() => '');
  check('dark theme uses the dark series colour', !bar || bar === 'rgb(57, 135, 229)', bar);
  await page.click('#themeToggle');

  // 400 px.
  await page.setViewportSize({width: 400, height: 900});
  await page.goto(`${app}/actions`); await page.waitForSelector('#account a', {state: 'attached'});
  check('header link hidden on a phone', await page.locator('#account a[href="/metrics"]').count() === 1 && !(await page.locator('#account a[href="/metrics"]').isVisible()));
  await page.goto(`${app}/metrics`); await page.waitForSelector('.tile');
  check('no horizontal scroll at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'metrics-400.png'), fullPage: true});
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/metrics_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
