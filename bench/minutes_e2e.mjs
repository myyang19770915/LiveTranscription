// End-to-end acceptance for meeting-minutes in the real pages (Playwright, gstack's install), against a
// meeting that has segments and a configured minutes model. Exits 1 on the first failed check.
// Usage: YUQIAO_SESSION=<token> node bench/minutes_e2e.mjs <meeting id> <screenshot dir>
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [meeting, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !meeting || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/minutes_e2e.mjs <meeting id> <dir>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  const stamp = Date.now() % 100000;

  // Entry from the meeting list.
  await page.goto(`${app}/meetings`); await page.waitForSelector('.meeting');
  check('list offers 紀要', await page.locator(`a[href="/meetings/${meeting}/minutes"]`).count() === 1);
  await page.click(`a[href="/meetings/${meeting}/minutes"]`);
  await page.waitForFunction(() => document.querySelector('#status').textContent.length > 0);

  // Generate (or regenerate) and wait for done.
  // The previous run's 產生完成 is still on screen: wait for this run to start, then to finish.
  await page.click('#generate');
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('running'), null, {timeout: 10000});
  // Typing while it generates: neither the polls nor the final redraw may wipe the open form.
  await page.locator('.kind-section:nth-of-type(4)').getByText('＋ 新增').click();
  await page.fill('.add-form textarea', '產生中輸入的草稿');
  await page.waitForFunction(() => /產生完成|失敗/.test(document.querySelector('#status').textContent), null, {timeout: 300000});
  check('draft survives generation', (await page.inputValue('.add-form textarea')) === '產生中輸入的草稿');
  await page.locator('.add-form').getByText('取消').click();
  const status = await page.textContent('#status');
  check('generation done', status.includes('產生完成'), status);
  const proposed = await page.locator('.item.proposed').count();
  check('items proposed with evidence', proposed > 0 && await page.locator('.item.proposed .evidence .chip').count() >= proposed, proposed);
  await page.screenshot({path: join(out, 'minutes-generated.png'), fullPage: true});

  // Set an owner on an action and confirm it.
  const action = page.locator('.kind-section:nth-of-type(2) .item.proposed').first();
  await action.locator('select[aria-label="負責人"]').selectOption({index: 1});
  await page.waitForTimeout(400);
  await page.locator('.kind-section:nth-of-type(2) .item.proposed').first().getByText('確認', {exact: true}).click();
  await page.waitForSelector('.kind-section:nth-of-type(2) .item.confirmed');
  const owner = await page.locator('.kind-section:nth-of-type(2) .item.confirmed select[aria-label="負責人"]').first().inputValue();
  check('action confirmed with an owner', owner !== '', owner);

  // Reject a risk, add a question by hand.
  const risks = page.locator('.kind-section:nth-of-type(4) .item.proposed');
  if (await risks.count()) { await risks.first().getByText('駁回', {exact: true}).click(); await page.waitForSelector('.kind-section:nth-of-type(4) .item.rejected'); }
  check('risk rejected', await page.locator('.kind-section:nth-of-type(4) .item.rejected').count() >= 1);
  await page.locator('.kind-section:nth-of-type(3)').getByText('＋ 新增').click();
  await page.fill('.add-form textarea', `驗收手動新增的問題 ${stamp}`);
  await page.click('.add-form button[type=submit]');
  await page.waitForSelector(`text=驗收手動新增的問題 ${stamp}`);
  check('hand-added question confirmed', await page.locator('.item.confirmed', {hasText: `驗收手動新增的問題 ${stamp}`}).count() === 1);

  // Markdown has confirmed items only.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const markdown = readFileSync(await download.path(), 'utf8');
  const rejected = await page.locator('.item.rejected .item-content').first().textContent();
  check('markdown has the confirmed items', markdown.includes(`驗收手動新增的問題 ${stamp}`) && markdown.includes('## 待辦'));
  check('markdown leaves out rejected and proposed items', !markdown.includes(rejected), rejected);
  console.log('---- markdown ----\n' + markdown + '------------------');

  // Evidence opens a side panel on the minutes page: cited segments with context, playable in place.
  const chip = page.locator('.item .evidence .chip').first();
  const seq = (await chip.getAttribute('href')).split('#seg-')[1];
  await chip.click(); await page.waitForSelector('#peek:not([hidden]) .peek-seg.cited');
  check('evidence opens the side panel, not another page', page.url().endsWith(`/meetings/${meeting}/minutes`) && await page.locator(`#peek-${seq}.cited.focus`).count() === 1, `#peek-${seq}`);
  check('panel shows context around the cited segment', await page.locator('#peek .peek-seg').count() > await page.locator('#peek .peek-seg.cited').count());
  const playable = await page.locator('#peek .peek-play').count();
  const {hasRecording} = await (await page.request.get(`${app}/api/meetings/${meeting}`)).json();
  if (!hasRecording) check('without a recording the panel shows times and no play control', playable === 0 && await page.locator('#peek .peek-time').count() > 0);
  if (playable) {
    const [audio] = await Promise.all([page.waitForResponse(r => r.url().includes('/audio?')), page.locator(`#peek-${seq} .peek-play`).click()]);
    check('panel plays the segment audio', audio.status() === 200, audio.status());
  }
  await page.screenshot({path: join(out, 'minutes-evidence.png')});
  await page.keyboard.press('Escape');
  check('Esc closes the panel', await page.locator('#peek').isHidden());

  // Tabs switch views in place of the current history entry; 返回會議紀錄 leads to the list as it was filtered.
  const {teamId} = await (await page.request.get(`${app}/api/meetings/${meeting}`)).json();
  const filtered = `/meetings?team=${teamId}`;
  await page.goto(app + filtered); await page.waitForSelector('.meeting');
  const [minutesButton, reviewButton] = [page.locator(`a[href="/meetings/${meeting}/minutes"]`), page.locator(`a[href="/meetings/${meeting}"]`)];
  check('list buttons are named like the tabs', await minutesButton.textContent() === '會議紀要' && await reviewButton.textContent() === '逐字稿校對');
  check('list buttons have the same height', (await minutesButton.boundingBox()).height === (await reviewButton.boundingBox()).height,
    [(await minutesButton.boundingBox()).height, (await reviewButton.boundingBox()).height]);
  await minutesButton.click(); await page.waitForSelector('.item');
  const header = () => page.evaluate(() => [document.querySelector('#title').textContent, ...[...document.querySelectorAll('#meta span')].map(s => s.textContent)]);
  await page.waitForFunction(() => document.querySelectorAll('#meta span').length === 5);
  const minutesHeader = await header();
  const depth = await page.evaluate(() => history.length);
  const [opened] = await Promise.all([context.waitForEvent('page'), page.click('#tabReview', {modifiers: ['Control']})]);
  await opened.waitForLoadState();
  await opened.waitForURL(url => new URL(url).pathname === `/meetings/${meeting}`).catch(() => {});
  check('Ctrl-click on a tab opens a new browser tab and leaves this one', new URL(opened.url()).pathname === `/meetings/${meeting}` && page.url().endsWith(`/meetings/${meeting}/minutes`), [opened.url(), page.url()]);
  await opened.close();
  await page.click('#tabReview'); await page.waitForSelector('.seg');
  check('tab opens the transcript', page.url().endsWith(`/meetings/${meeting}`) && await page.getAttribute('#tabReview', 'aria-current') === 'page');
  await page.waitForFunction(() => document.querySelectorAll('#meta span').length === 5);
  const reviewHeader = await header(), {team} = await (await page.request.get(`${app}/api/meetings/${meeting}`)).json();
  check('header is the same on both tabs', JSON.stringify(reviewHeader) === JSON.stringify(minutesHeader) && reviewHeader.length === 6 && reviewHeader[1] === team, reviewHeader);
  await page.click('#tabMinutes'); await page.waitForSelector('.item');
  check('tab switch adds no history entries', await page.evaluate(() => history.length) === depth);
  await page.click('#tabReview'); await page.waitForSelector('.seg');
  await page.click('#back'); await page.waitForURL(url => new URL(url).pathname === '/meetings');
  check('after switching tabs, back returns to the filtered list', page.url().endsWith(filtered), page.url());

  // Opened from a pasted address: back opens the plain list.
  const direct = await context.newPage();
  await direct.goto(`${app}/meetings/${meeting}/minutes`); await direct.waitForSelector('.item');
  await direct.click('#back'); await direct.waitForURL(url => new URL(url).pathname === '/meetings');
  check('opened directly, back opens the meeting list', new URL(direct.url()).search === '', direct.url());
  await direct.close();

  // 到校對頁修正 opens that segment on the review page.
  await page.goto(`${app}/meetings/${meeting}/minutes`); await page.waitForSelector('.item .evidence .chip');
  await page.locator('.item .evidence .chip').first().click();
  await page.locator('#peek .peek-seg.cited a').first().click(); await page.waitForSelector(`.seg.open`);
  check('panel link opens the segment on the review page', /#seg-\d+$/.test(page.url()));

  // Without the Navigation API and sessionStorage, back still opens the meeting list.
  const bare = await context.newPage();
  await bare.addInitScript(() => {
    try { delete window.navigation; Object.defineProperty(window, 'navigation', {value: undefined}); } catch {}
    Object.defineProperty(window, 'sessionStorage', {get() { throw new Error('blocked'); }});
  });
  await bare.goto(`${app}/meetings/${meeting}/minutes`); await bare.waitForSelector('.item');
  check('fallback back link is /meetings', await bare.getAttribute('#back', 'href') === '/meetings');
  await bare.click('#back'); await bare.waitForURL(url => new URL(url).pathname === '/meetings');
  check('fallback back link opens the list', true);
  await bare.close();

  // A regeneration that replaces the item shown in the panel closes the panel.
  await page.goto(`${app}/meetings/${meeting}/minutes`); await page.waitForSelector('.item.proposed .evidence .chip');
  await page.locator('.item.proposed .evidence .chip').first().click(); await page.waitForSelector('#peek:not([hidden])');
  await page.click('#generate');
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('running'), null, {timeout: 10000});
  await page.waitForFunction(() => /產生完成|失敗/.test(document.querySelector('#status').textContent), null, {timeout: 300000});
  const regenerated = await page.textContent('#status');
  check('regeneration done', regenerated.includes('產生完成'), regenerated);
  check('panel closes when its item is regenerated', await page.locator('#peek').isHidden());

  // 400 px.
  await page.setViewportSize({width: 400, height: 860});
  await page.goto(`${app}/meetings/${meeting}/minutes`); await page.waitForSelector('.item');
  check('no horizontal scroll at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'minutes-400.png')});
} catch (error) {
  check('run', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
