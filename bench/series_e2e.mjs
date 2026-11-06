// End-to-end acceptance for meeting-series in the real pages (Playwright, gstack's install).
// Needs a meeting with confirmed, unfinished action items (e.g. 產品週會（測試資料）). The script creates a series
// 驗收系列 <stamp> in that meeting's team, moves the meeting into it, starts and stops a short meeting with Chrome's
// fake microphone, and drives the progress suggestions with intercepted answers (the server side of detection is
// covered by test_server SeriesTests; no external model is called here). At the end the meeting's series is cleared.
// Usage: YUQIAO_SESSION=<token> node bench/series_e2e.mjs <meeting id with actions> <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [source, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !source || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/series_e2e.mjs <meeting id> <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const stamp = Date.now() % 100000, seriesName = `驗收系列 ${stamp}`;
let api;
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, permissions: ['microphone']});
  await context.addInitScript(() => { localStorage.setItem('interpreter-theme', 'dark'); });
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  api = context.request;
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  const meeting = await (await api.get(`${app}/api/meetings/${source}`)).json();

  // Series menu: create a series in place.
  await page.goto(`${app}/`); await page.evaluate(() => localStorage.removeItem('progressDetect'));
  await page.reload(); await page.waitForSelector('#seriesRow:not([hidden])');
  await page.waitForFunction(() => [...document.querySelectorAll('#series option')].some(o => o.value === '__new'));
  if (await page.inputValue('#team') !== String(meeting.teamId))
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/series')), page.selectOption('#team', String(meeting.teamId))]);
  await page.selectOption('#series', '__new');
  await page.fill('#seriesName', seriesName); await page.click('#seriesCreate');
  await page.waitForFunction(name => document.querySelector('#series').selectedOptions[0]?.textContent === name, seriesName);
  const seriesId = Number(await page.inputValue('#series'));
  check('series created in place and selected', seriesId > 0, seriesId);
  check('new series has no unfinished items', (await page.textContent('#seriesItems')).includes('這個系列沒有未完成的待辦'));

  // Move the meeting with actions into the series: its unfinished items appear before the next meeting.
  const moved = await api.patch(`${app}/api/meetings/${source}`, {data: {series_id: seriesId}});
  check('meeting moved into the series', moved.ok(), moved.status());
  const expected = await (await api.get(`${app}/api/series/${seriesId}/actions`)).json();
  await page.reload(); await page.waitForSelector('#seriesPanel:not([hidden])');
  await page.waitForFunction(n => document.querySelectorAll('#seriesItems .series-item').length === n, expected.length);
  check('panel lists the unfinished items', expected.length > 0 && await page.textContent('#seriesCount') === String(expected.length), expected.length);
  check('series choice is remembered', await page.inputValue('#series') === String(seriesId));
  check('detection is offered, off by default, with the notice', await page.isVisible('#detectRow') && !(await page.isChecked('#detect'))
    && (await page.textContent('#detectRow')).includes('外部模型服務'));
  await page.check('#detect'); await page.reload(); await page.waitForSelector('#seriesPanel:not([hidden])');
  check('detection choice survives a reload', await page.isChecked('#detect'));
  await page.screenshot({path: join(out, 'series-panel.png')});

  // A meeting started on this page belongs to the series (fake microphone).
  await page.click('#start');
  await page.waitForFunction(() => document.querySelector('#start').classList.contains('stop'), null, {timeout: 30000});
  check('series menu locked during the meeting', await page.isDisabled('#series'));
  await page.waitForTimeout(1500);
  await page.click('#start');
  await page.waitForFunction(() => !document.querySelector('#start').classList.contains('stop'), null, {timeout: 40000});
  const latest = (await (await api.get(`${app}/api/meetings`)).json())[0];
  check('the new meeting belongs to the series', latest.seriesId === seriesId && latest.series === seriesName, [latest.series, latest.id]);

  // Suggestions during a meeting (answers intercepted): shown under the item, applied or dismissed.
  const [first, second] = expected;
  const suggestion = (id, item, toStatus, note) => ({id, itemId: item.id, itemMeetingId: source, content: item.content, fromStatus: item.status,
    toStatus, note, state: 'pending', evidence: [{seq: 3, startMs: 12000, source: '合約昨天已經寄給客戶了。'}]});
  const fake = [suggestion(900001, first, 'done', '提到合約已寄出'), ...(second ? [suggestion(900002, second, 'doing', '說已開始處理')] : [])];
  await page.route('**/progress/check', route => route.fulfill({json: {suggestions: fake, checkedThrough: 5, busy: false}}));
  await page.route('**/progress/*/accept', route => route.fulfill({json: {suggestion: {...fake[0], state: 'accepted'}, item: {...first, status: 'done', overdueDays: 0}}}));
  await page.route('**/progress/*/dismiss', route => route.fulfill({json: {suggestion: {...fake[1], state: 'dismissed'}, item: null}}));
  await page.evaluate(id => { window.MeetingSeries.started(id); window.MeetingSeries.saved(id, 5); }, latest.id);
  await page.waitForSelector(`#series-item-${first.id} .series-suggestion`);
  check('suggestion shown under its item with the evidence', (await page.textContent(`#series-item-${first.id} .series-suggestion`)).includes('合約昨天已經寄給客戶了'));
  await page.screenshot({path: join(out, 'series-suggestion.png')});
  await page.locator(`#series-item-${first.id} .series-apply`).click();
  await page.waitForFunction(id => document.querySelector(`#series-item-${id} .series-status`)?.textContent === '已完成', first.id);
  check('applying updates the item and removes the suggestion', await page.locator(`#series-item-${first.id} .series-suggestion`).count() === 0);
  if (second) {
    await page.locator(`#series-item-${second.id} .series-dismiss`).click();
    await page.waitForFunction(id => !document.querySelector(`#series-item-${id} .series-suggestion`), second.id);
    check('dismissing removes the suggestion', true);
  }
  await page.unrouteAll({behavior: 'ignoreErrors'});

  // Minutes page lists suggestions left from the meeting (intercepted list).
  await page.route(`**/api/meetings/${latest.id}/progress`, route => route.fulfill({json: fake}));
  await page.route('**/progress/*/accept', route => route.fulfill({json: {suggestion: {...fake[0], state: 'accepted'}, item: null}}));
  await page.goto(`${app}/meetings/${latest.id}/minutes`); await page.waitForSelector('#progress:not([hidden])');
  check('minutes page lists the pending suggestions', await page.locator('.progress-item').count() === fake.length);
  check('suggestion shows the current and the suggested status', (await page.locator('.progress-item').first().textContent()).includes('→ 已完成'));
  await page.locator('.progress-item .evidence .chip').first().click(); await page.waitForSelector('#peek:not([hidden])');
  check('suggestion evidence opens the side panel', (await page.textContent('#peekKind')).startsWith('進度提示'));
  await page.keyboard.press('Escape');
  await page.locator('.progress-item').first().getByText('套用', {exact: true}).click();
  await page.waitForFunction(n => document.querySelectorAll('.progress-item').length === n - 1, fake.length);
  check('applying on the minutes page removes it', true);
  await page.unrouteAll({behavior: 'ignoreErrors'});

  // Header, list and review page show and change the series.
  await page.goto(`${app}/meetings/${source}`); await page.waitForSelector('.seg');
  await page.waitForFunction(name => document.querySelector('#meta .count')?.textContent.endsWith(name), seriesName);
  check('header shows team · series', (await page.textContent('#meta .count')) === `${meeting.team} · ${seriesName}`);
  // The series list failing to load must not clear the series when only the topic is saved.
  await page.route('**/api/teams/*/series', route => route.abort());
  await page.click('#renameButton');
  await page.fill('#titleInput', meeting.title || ''); await page.click('#renameForm button[type=submit]');
  await page.waitForSelector('#renameForm', {state: 'hidden'});
  check('saving the topic while the series list fails keeps the series', (await (await api.get(`${app}/api/meetings/${source}`)).json()).seriesId === seriesId);
  await page.unrouteAll({behavior: 'ignoreErrors'});
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/series')), page.click('#renameButton')]);
  await page.waitForFunction(() => document.querySelectorAll('#seriesInput option').length > 1);
  check('review page offers the series', await page.inputValue('#seriesInput') === String(seriesId));
  await page.selectOption('#seriesInput', ''); await page.click('#renameForm button[type=submit]');
  await page.waitForFunction(team => document.querySelector('#meta .count')?.textContent === team, meeting.team);
  check('clearing the series on the review page', (await (await api.get(`${app}/api/meetings/${source}`)).json()).seriesId === null);
  await page.goto(`${app}/meetings`); await page.waitForSelector('.meeting');
  check('meeting list shows the series', (await page.locator('.meeting .count').allTextContents()).includes(`${meeting.team} · ${seriesName}`));

  // 400 px.
  await page.setViewportSize({width: 400, height: 860});
  await page.goto(`${app}/`); await page.waitForTimeout(800);
  check('no horizontal scroll on the meeting page at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/series_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await api?.patch(`${app}/api/meetings/${source}`, {data: {series_id: null}}).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
