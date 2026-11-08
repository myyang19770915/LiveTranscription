// End-to-end acceptance for full-text search (meeting-search) in the real pages (Playwright, gstack's install), against
// a meeting whose transcript contains <word> (default 合約). Reads only: the header 搜尋 button and / open the page, results are
// grouped and marked, a segment hit opens that segment on the review page, the kind filter and the address round-trip,
// an unmatched word shows the empty state, and 400 px does not scroll sideways. Search feedback (search-feedback-term-limit):
// a slow search is marked busy and announced, a newer search wins over a slower older one, and more than 5 terms is not
// sent and says why. Exits 1 on any failed check.
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

  // Ways in: the header 搜尋 button (text, like the other header buttons), and / from another page.
  await page.goto(`${app}/actions`); await page.waitForSelector('#account .account-search');
  check('the header search button is text like the others', await page.textContent('#account .account-search') === '搜尋'
    && await page.locator('#account .account-search svg').count() === 0
    && await page.evaluate(() => { const [a, b] = ['.account-search', 'a[href="/metrics"]'].map(s => document.querySelector('#account ' + s).getBoundingClientRect());
      return a.height === b.height && a.width > 36; }));
  await page.screenshot({path: join(out, 'search-header.png'), clip: {x: 0, y: 0, width: 1280, height: 90}});
  await page.goto(`${app}/`); await page.waitForSelector('#account .account-search');   // the meeting page: its own accounts.css
  check('the search button is text like the others on the meeting page too', await page.textContent('#account .account-search') === '搜尋'
    && await page.evaluate(() => { const [a, b] = ['.account-search', 'a[href="/actions"]'].map(s => document.querySelector('#account ' + s));
      const [ra, rb] = [a, b].map(e => e.getBoundingClientRect()), [sa, sb] = [a, b].map(e => getComputedStyle(e));
      return ra.height === rb.height && sa.paddingLeft === sb.paddingLeft && sa.borderRadius === sb.borderRadius; }));
  await page.screenshot({path: join(out, 'search-header-meeting.png'), clip: {x: 0, y: 0, width: 1280, height: 90}});
  await page.click('#account .account-search'); await page.waitForURL(/\/search/);
  await page.waitForFunction(() => document.activeElement?.id === 'q');
  check('the header search button opens the search page with the box focused', true);
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

  // A slow search: busy at once, old results dimmed and not clickable, the summary says so; the answer ends it.
  const results = () => page.evaluate(() => {
    const r = document.getElementById('results');
    return {busy: r.getAttribute('aria-busy'), clickable: getComputedStyle(r).pointerEvents !== 'none', text: r.textContent,
            summary: document.getElementById('summary').textContent, children: r.children.length};
  });
  const waitFor = async get => { while (!get()) await new Promise(r => setTimeout(r, 20)); return get(); };
  let release = null;
  await page.route('**/api/search?*', async route => { await new Promise(r => { release = r; }); await route.continue(); });
  await page.fill('#q', word); await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.getElementById('summary').textContent.includes('正在搜尋'));
  let now = await results();
  await page.waitForTimeout(400);   // the fade starts after 150 ms and lasts 200 ms
  const faded = await page.evaluate(() => Number(getComputedStyle(document.getElementById('results')).opacity));
  check('a slow search marks the results busy, dims them and says so', now.busy === 'true' && !now.clickable && faded < 1
    && now.summary === `正在搜尋「${word}」…` && await page.locator('.result-group').count() > 0, now.summary);
  (await waitFor(() => release))();
  await page.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
  now = await results();
  check('the answer ends the busy state', now.clickable && /找到 \d+ 筆/.test(now.summary), now.summary);
  await page.unroute('**/api/search?*');

  // A newer search wins over a slower older one.
  const other = '不可能出現的字串xyzzy';
  release = null;
  await page.route('**/api/search?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === word) await new Promise(r => { release = r; });
    await route.continue();
  });
  await page.fill('#q', word); await page.press('#q', 'Enter');
  const slow = await waitFor(() => release);
  await page.fill('#q', other);
  await Promise.all([searched(), page.press('#q', 'Enter')]);
  await page.waitForSelector('.search-empty');
  const older = page.waitForResponse(r => r.url().includes(encodeURIComponent(word)));
  slow(); await older; await page.waitForTimeout(150);
  now = await results();
  check('a newer search wins over a slower older one', now.busy === 'false' && now.text.includes(other) && now.summary === ''
    && await page.locator('.result-group').count() === 0, now.summary);
  await page.unroute('**/api/search?*');

  // More than 5 terms: not sent, the old results go, the alert says why and the box is invalid; fixing it searches again.
  let sent = 0;
  const counter = r => { if (r.url().includes('/api/search?')) sent++; };
  page.on('request', counter);
  await page.fill('#q', '合約 客戶 報價 週五 寄出 確認'); await page.press('#q', 'Enter');
  await page.waitForFunction(() => !document.getElementById('notice').hidden);
  await page.waitForTimeout(150);
  now = await results();
  check('more than 5 terms is not sent and says why', sent === 0 && now.children === 0 && now.busy === 'false'
    && await page.textContent('#notice') === '搜尋詞最多 5 個（目前 6 個），請刪減後再搜尋'
    && await page.getAttribute('#notice', 'role') === 'alert' && await page.getAttribute('#q', 'aria-invalid') === 'true'
    && await page.getAttribute('#q', 'aria-describedby') === 'notice', {sent, notice: await page.textContent('#notice')});
  page.off('request', counter);
  await page.fill('#q', '合約 客戶 報價 週五 寄出');
  check('a valid query clears the invalid mark and its message while typing', await page.getAttribute('#q', 'aria-invalid') === null
    && await page.getAttribute('#q', 'aria-describedby') === null && await page.locator('#notice').isHidden());
  await page.fill('#q', word);
  await Promise.all([searched(), page.press('#q', 'Enter')]); await page.waitForSelector('.result-group');
  check('the fixed query searches again', await page.locator('#notice').isHidden() && new URL(page.url()).searchParams.get('q') === word);
  // Over 100 characters from a shared address (maxlength only limits typing): not sent either.
  sent = 0; page.on('request', counter);
  await page.goto(`${app}/search?q=${encodeURIComponent('字'.repeat(101))}`);
  await page.waitForFunction(() => !document.getElementById('notice').hidden); await page.waitForTimeout(150);
  check('over 100 characters is not sent and says why', sent === 0 && await page.textContent('#notice') === '搜尋字最多 100 個字'
    && await page.getAttribute('#q', 'aria-invalid') === 'true', {sent});
  page.off('request', counter);

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
  check('the search button stays on a phone, without sideways scroll', await page.locator('#account .account-search').isVisible()
    && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'search-header-400.png'), clip: {x: 0, y: 0, width: 400, height: 80}});
  await page.goto(`${app}/search?q=${encodeURIComponent(word)}`); await page.waitForSelector('.result-group');
  await page.screenshot({path: join(out, 'search-400.png'), fullPage: true});
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/search_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
