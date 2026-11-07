// End-to-end acceptance for full-text search (meeting-search) in the real pages (Playwright, gstack's install), against
// a meeting whose transcript contains <word> (default 合約). Reads only: the header icon and / open the page, results are
// grouped and marked, a segment hit opens that segment on the review page, the kind filter and the address round-trip,
// an unmatched word shows the empty state, and 400 px does not scroll sideways. Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<token> node bench/search_e2e.mjs <meeting id> <screenshot dir> [word]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [meeting, out, word = '合約'] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !meeting || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/search_e2e.mjs <meeting id> <dir> [word]'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  const searched = () => page.waitForResponse(r => r.url().includes('/api/search?'));

  // Ways in: the header icon, and / from another page.
  await page.goto(`${app}/actions`); await page.waitForSelector('#account .account-search');
  await page.click('#account .account-search'); await page.waitForURL(/\/search/);
  await page.waitForFunction(() => document.activeElement?.id === 'q');
  check('the header search icon opens the search page with the box focused', true);
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  await page.locator('body').press('/'); await page.waitForURL(/\/search/);
  check('/ opens the search page', true);

  // A search typed at once (before the page has loaded the account): grouped by meeting, terms marked, in the address.
  await page.fill('#q', word);
  await Promise.all([searched(), page.press('#q', 'Enter')]);
  await page.waitForSelector('.result-group');
  const group = page.locator('.result-group', {has: page.locator(`a[href="/meetings/${meeting}"]`)}).first();
  check('results are grouped by meeting and include the sample meeting', await group.count() === 1);
  const marks = await page.locator('.hit mark').allTextContents();
  check('every mark is the word', marks.length > 0 && marks.every(m => m.toLowerCase() === word.toLowerCase()), marks.slice(0, 3));
  check('the address carries the query', new URL(page.url()).searchParams.get('q') === word);
  check('summary counts the hits', /找到 \d+ 筆/.test(await page.textContent('#summary')));
  await page.screenshot({path: join(out, 'search.png'), fullPage: true});

  // A segment hit opens that segment on the review page, where it can be played.
  const segment = group.locator('a[href*="#seg-"]').first();
  const href = await segment.getAttribute('href');
  const seq = href.split('#seg-')[1];
  check('a segment hit shows its time', /▸ \d\d:\d\d/.test(await segment.locator('.hit-tag').textContent()));
  await segment.click(); await page.waitForURL(u => u.pathname === `/meetings/${meeting}` && u.hash === `#seg-${seq}`);
  await page.waitForSelector(`#seg-${seq}`);
  // Played from there (a meeting without a recording says so instead).
  await page.waitForFunction(n => document.querySelector(`[data-play="${n}"]`) || document.body.textContent.includes('這場會議沒有錄音'), seq);
  check('the segment is open on the review page, ready to play', await page.locator(`#seg-${seq}`).count() === 1);
  await page.goBack(); await page.waitForSelector('.result-group');
  check('back returns to the same search', await page.inputValue('#q') === word);

  // Kind filter: only minutes items; kept in the address and restored on reload.
  await Promise.all([searched(), page.click('.kind[data-kind="items"]')]);
  await page.waitForFunction(() => location.search.includes('kind=items'));
  const types = await page.locator('.hit-tag').allTextContents();
  check('the 紀要 filter lists only minutes items', types.length > 0 && types.every(t => ['決議', '待辦', '問題', '風險'].includes(t)), types.slice(0, 4));
  await page.reload(); await page.waitForSelector('.result-group');
  check('query and kind survive a reload', await page.inputValue('#q') === word
    && await page.getAttribute('.kind[data-kind="items"]', 'aria-pressed') === 'true');
  await Promise.all([searched(), page.click('#clear')]);
  check('清除篩選 goes back to all kinds', await page.getAttribute('.kind[data-kind="all"]', 'aria-pressed') === 'true' && !page.url().includes('kind='));

  // Filters from a shared address are restored; an unknown series is dropped with a notice that stays.
  const teamId = await page.locator('#team option').nth(1).getAttribute('value');
  await page.goto(`${app}/search?q=${encodeURIComponent(word)}&team=${teamId}&from=2026-01-01&to=2026-12-31`); await page.waitForSelector('.result-group');
  check('team and dates are restored from the address', await page.inputValue('#team') === teamId
    && await page.inputValue('#from') === '2026-01-01' && await page.inputValue('#to') === '2026-12-31');
  await page.goto(`${app}/search?q=${encodeURIComponent(word)}&series=999999`); await page.waitForSelector('.result-group');
  check('an unknown series is dropped and says so', !page.url().includes('series=') && (await page.textContent('#notice')).includes('已改為搜尋全部'));
  // Too many hits: the summary asks to narrow the search.
  await page.route('**/api/search?*', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({response, json: {...body, truncated: true}});
  });
  await page.reload(); await page.waitForSelector('.result-group');
  check('a truncated result says only the first 300 are listed', (await page.textContent('#summary')).includes('前 300 筆'));
  await page.unroute('**/api/search?*');

  // Nothing found.
  await page.fill('#q', '不可能出現的字串xyzzy');
  await Promise.all([searched(), page.press('#q', 'Enter')]);
  await page.waitForSelector('.search-empty');
  check('an unmatched word shows the empty state', (await page.textContent('.search-empty')).includes('沒有找到'));

  // 400 px.
  await page.setViewportSize({width: 400, height: 860});
  await page.goto(`${app}/search?q=${encodeURIComponent(word)}`); await page.waitForSelector('.result-group');
  check('no horizontal scroll at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.goto(`${app}/actions`); await page.waitForSelector('#account .account-search', {state: 'attached'});
  check('the search icon stays on a phone', await page.locator('#account .account-search').isVisible());
  await page.goto(`${app}/search?q=${encodeURIComponent(word)}`); await page.waitForSelector('.result-group');
  await page.screenshot({path: join(out, 'search-400.png'), fullPage: true});
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/search_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
