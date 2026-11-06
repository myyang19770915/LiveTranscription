// Play / pause / resume on the review page and in the minutes evidence panel (Playwright, gstack's install).
// The minutes check borrows a recorded meeting's audio when the minutes meeting has none: only the browser's
// view of the responses is changed, nothing is written.
// Usage: YUQIAO_SESSION=<token> node bench/playback_e2e.mjs <recorded meeting id> <meeting id with minutes>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [recorded, withMinutes] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !recorded || !withMinutes) { console.error('Usage: YUQIAO_SESSION=<token> node bench/playback_e2e.mjs <recorded meeting> <minutes meeting>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch({args: ['--autoplay-policy=no-user-gesture-required']});
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const state = page => page.evaluate(() => { const p = document.querySelector('#player'); return {paused: p.paused, t: p.currentTime}; });
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));

  // Review page.
  await page.goto(`${app}/meetings/${recorded}`); await page.waitForSelector('.seg');
  await page.locator('.seg-source').first().click();
  await page.waitForFunction(() => document.querySelector('.play-button')?.textContent.includes('暫停'), null, {timeout: 10000});
  check('opening a segment plays it; the button offers 暫停', true);
  await page.waitForTimeout(800);
  await page.click('.play-button');
  const paused = await state(page);
  check('暫停 pauses', paused.paused && await page.textContent('.play-button') === '▶ 繼續', await page.textContent('.play-button'));
  check('position is shown', /\d\d:\d\d \/ \d\d:\d\d/.test(await page.textContent('.play-time')), await page.textContent('.play-time'));
  await page.waitForTimeout(500);
  check('paused position holds', (await state(page)).t === paused.t);
  await page.click('.play-button'); await page.waitForTimeout(400);
  const resumed = await state(page);
  check('繼續 resumes from the same place', !resumed.paused && resumed.t > paused.t && resumed.t < paused.t + 1.5, [paused.t, resumed.t]);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space'); await page.waitForTimeout(200);
  check('space bar pauses', (await state(page)).paused);

  // Minutes evidence panel.
  const meetingJson = await (await page.request.get(`${app}/api/meetings/${recorded}`)).json();
  await page.route(`**/api/meetings/${withMinutes}`, async route => {
    const body = await (await route.fetch()).json();
    route.fulfill({json: {...body, hasRecording: true, durationMs: meetingJson.durationMs}});
  });
  await page.route(`**/api/meetings/${withMinutes}/audio?**`, async route =>
    route.fulfill({response: await page.request.get(`${app}/api/meetings/${recorded}/audio?start=0&end=${Math.min(meetingJson.durationMs, 8000)}`)}));
  await page.goto(`${app}/meetings/${withMinutes}/minutes`); await page.waitForSelector('.item .evidence .chip');
  await page.locator('.item .evidence .chip').first().click(); await page.waitForSelector('#peek .peek-seg.cited .peek-play');
  const button = page.locator('#peek .peek-seg.cited .peek-play').first();
  await button.click();
  await page.waitForFunction(() => document.querySelector('#peek .peek-play.playing')?.textContent.startsWith('❚❚'), null, {timeout: 10000});
  check('panel ▶ plays and turns into ❚❚', true);
  await page.waitForTimeout(600);
  await button.click();
  const panelPaused = await state(page);
  check('panel ❚❚ pauses', panelPaused.paused && (await button.textContent()).startsWith('▶ 繼續'), await button.textContent());
  await button.click(); await page.waitForTimeout(300);
  const panelResumed = await state(page);
  check('panel resumes from the same place', !panelResumed.paused && panelResumed.t >= panelPaused.t && panelResumed.t < panelPaused.t + 1.5, [panelPaused.t, panelResumed.t]);
} catch (error) {
  check('run', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
