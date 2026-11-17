// End-to-end acceptance for the 問答 page (meeting-qa) in the real pages (Playwright, gstack's install). /api/ask is
// intercepted with fixed answers, so no model is called, except with "live", which also asks the real model once.
// Checks: the 全文搜尋｜問答 switch carries the text and filters both ways, an address is never sent by itself, Enter asks
// and Shift+Enter starts a new line, the busy state and its announcement, [n] and the sources open in the side panel
// without leaving the page (segment in context, item with its evidence, Esc closes and gives focus back), a recorded
// segment plays, pauses and resumes there (button and Space), a newer question wins, not found offers full-text search,
// degraded and errors are stated, an empty question is not sent, index progress and service state are stated, and 400 px
// does not scroll sideways. Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<token> node bench/qa_e2e.mjs <meeting id> <screenshot dir> [recorded meeting id] [live]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [meeting, out, ...rest] = process.argv.slice(2);
const live = rest.includes('live'), recorded = rest.find(a => a !== 'live');
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !meeting || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/qa_e2e.mjs <meeting id> <dir> [recorded meeting id] [live]'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
const pause = ms => new Promise(r => setTimeout(r, ms));

const QUESTION = '合約要在什麼時候之前寄給客戶？';
const answer = (question, extra = {}) => ({
  question, notFound: false, degraded: false, answer: '合約要在下週五前寄給客戶 [1]，由王愛麗負責 [2]。',
  sources: [
    {n: 1, type: 'segment', meetingId: meeting, title: '產品週會', startedAt: '2026-11-04T02:00:00+00:00', seq: 2, startMs: 18000,
     text: '合約要在下週五之前寄給客戶。', target: 'The contract must be sent by next Friday.', prev: '接下來是合約。', next: '這件事請王愛麗負責。',
     href: `/meetings/${meeting}#seg-2`},
    {n: 2, type: 'item', itemId: 1, kind: 'action', meetingId: meeting, title: '產品週會', startedAt: '2026-11-04T02:00:00+00:00',
     text: '在下週五前把合約寄給客戶。', owner: '王愛麗', due: '2026-11-13', state: 'confirmed', status: 'todo', evidence: [3],
     href: `/meetings/${meeting}/minutes#item-1`},
  ], ...extra});

try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  let sent = 0;
  page.on('request', r => { if (r.url().endsWith('/api/ask') && r.method() === 'POST') sent++; });
  // Answers by question: a held one waits for release(); the rest answer at once.
  let reply = q => answer(q), hold = null, release = null, status = 200;
  await page.route('**/api/ask', async route => {
    const q = route.request().postDataJSON().question;
    if (hold && q === hold) await new Promise(r => { release = r; });
    await route.fulfill(status === 200 ? {json: reply(q)} : {status, json: {detail: '問答功能尚未設定'}});
  });
  const ready = () => page.waitForFunction(() => document.querySelector('#team option:nth-child(2)'));

  // From the search page: the switch carries the text and filters; the address is not sent by itself.
  await page.goto(`${app}/search?q=${encodeURIComponent('合約')}&kind=items`); await page.waitForSelector('.result-group');
  const teamId = await page.locator('#team option').nth(1).getAttribute('value');
  await page.selectOption('#team', teamId); await page.waitForFunction(t => location.search.includes(`team=${t}`), teamId);
  await page.click('#toAsk'); await page.waitForURL(/\/ask\?/); await ready();
  const url = new URL(page.url());
  check('問答 opens with the text and team, not the kind', url.searchParams.get('q') === '合約' && url.searchParams.get('team') === teamId
    && !url.searchParams.has('kind') && await page.inputValue('#q') === '合約' && await page.inputValue('#team') === teamId);
  await pause(600);
  check('an address is not sent by itself', sent === 0 && (await page.textContent('#answer')).includes('用一句話問'));
  check('the question box is focused', await page.evaluate(() => document.activeElement.id === 'q'));

  // Shift+Enter starts a new line; Enter asks. Busy at once, announced after 200 ms, the answer ends it.
  await page.fill('#q', '合約');
  await page.press('#q', 'Shift+Enter');
  check('Shift+Enter starts a new line without asking', (await page.inputValue('#q')).includes('\n') && sent === 0);
  await page.fill('#q', QUESTION);
  hold = QUESTION; release = null;
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.getElementById('summary').textContent === '正在找資料並整理答案…');
  check('a question under way marks the answer busy and says so', await page.getAttribute('#answer', 'aria-busy') === 'true'
    && await page.getAttribute('#summary', 'aria-live') === 'polite');
  while (!release) await pause(20);
  release(); hold = null;
  await page.waitForSelector('.ask-answer');
  check('the answer arrives with its citations', await page.getAttribute('#answer', 'aria-busy') === 'false'
    && (await page.textContent('.ask-text')).startsWith('合約要在下週五前寄給客戶') && await page.locator('.ask-text .cite').count() === 2
    && await page.textContent('#summary') === '根據 2 筆資料回答');
  check('the address carries the question and team', new URL(page.url()).searchParams.get('q') === QUESTION && page.url().includes(`team=${teamId}`));
  await page.screenshot({path: join(out, 'ask.png'), fullPage: true});

  // Sources: the list keeps their links (Ctrl-click opens the page), a plain click opens the side panel instead.
  const first = page.locator('#src-1 .source-link');
  check('a segment source links to its place on the review page, with time and context', await first.getAttribute('href') === `/meetings/${meeting}#seg-2`
    && (await first.textContent()).includes('▸ 00:18') && (await first.textContent()).includes('接下來是合約。') && (await first.textContent()).includes('查看出處與錄音'));
  check('an item source links to the minutes and says who and when', await page.getAttribute('#src-2 .source-link', 'href') === `/meetings/${meeting}/minutes#item-1`
    && (await page.textContent('#src-2')).includes('負責人 王愛麗') && (await page.textContent('#src-2')).includes('到期 2026-11-13'));
  const askUrl = page.url();
  await first.click(); await page.waitForSelector('#peek:not([hidden]) #peek-2.cited');
  const segmentPanel = await page.evaluate(() => ({
    kind: document.getElementById('peekKind').textContent, title: document.getElementById('peekTitle').textContent,
    rows: [...document.querySelectorAll('#peekList .peek-seg')].map(r => r.id),
    fix: document.querySelector('#peek-2 a')?.getAttribute('href'), focused: document.activeElement.id}));
  check('a segment source opens in the side panel with one segment each side, on the same page', page.url() === askUrl
    && segmentPanel.kind === '出處 [1]・逐字稿 00:18' && segmentPanel.title.startsWith('產品週會')
    && segmentPanel.rows.join() === 'peek-1,peek-2,peek-3' && segmentPanel.fix === `/meetings/${meeting}#seg-2`
    && segmentPanel.focused === 'peek' && await page.locator('#src-1.is-target').count() === 1, segmentPanel);
  await page.keyboard.press('Escape');
  check('Esc closes the panel and gives focus back to the source', await page.locator('#peek').isHidden()
    && await page.evaluate(() => document.activeElement.closest('#src-1') !== null) && await page.locator('.source.is-target').count() === 0);
  await page.click('.ask-text .cite >> nth=1'); await page.waitForSelector('#peek:not([hidden]) .peek-item');
  check('[2] opens the item in the panel with its evidence segment', (await page.textContent('#peekKind')) === '出處 [2]・待辦'
    && (await page.textContent('.peek-item')).includes('在下週五前把合約寄給客戶。') && (await page.textContent('.peek-item')).includes('負責人 王愛麗')
    && await page.getAttribute('.peek-item a', 'href') === `/meetings/${meeting}/minutes#item-1`
    && await page.locator('#peek-3.cited').count() === 1 && await page.locator('#src-2.is-target').count() === 1);
  check('the answer stays readable beside the panel', await page.evaluate(() => {
    const answer = document.querySelector('.ask-answer').getBoundingClientRect(), panel = document.getElementById('peek').getBoundingClientRect();
    return answer.right <= panel.left && document.documentElement.scrollWidth <= innerWidth;
  }));
  await page.screenshot({path: join(out, 'ask-panel.png')});
  await page.click('#peekClose');
  check('the close button closes the panel', await page.locator('#peek').isHidden());

  // A recorded meeting: the cited segment plays, pauses and resumes in the panel, with the button and with Space.
  if (recorded) {
    const detail = await page.evaluate(async id => (await fetch(`/api/meetings/${id}`)).json(), recorded);
    const seg = detail.segments[0];
    const RECORDED = '錄音那場會議說了什麼？';
    reply = q => q === RECORDED ? {question: q, notFound: false, degraded: false, answer: '有一段錄音 [1]。', sources: [
      {n: 1, type: 'segment', meetingId: recorded, title: detail.title || '錄音會議', startedAt: detail.startedAt, seq: seg.seq, startMs: seg.startMs,
       text: seg.source, target: '', prev: null, next: null, href: `/meetings/${recorded}#seg-${seg.seq}`}]} : answer(q);
    await page.fill('#q', RECORDED); await page.press('#q', 'Enter'); await page.waitForSelector('.ask-answer');
    await page.click('#src-1 .source-link'); await page.waitForSelector(`#peek-${seg.seq} .peek-play`);
    const button = page.locator(`#peek-${seg.seq} .peek-play`);
    await button.click(); await page.waitForFunction(() => document.querySelector('.peek-play').textContent.startsWith('❚❚'), null, {timeout: 15000});
    check('the cited segment plays in the panel', true);
    await page.waitForFunction(() => document.getElementById('player').currentTime > 0.3);   // paused at 0 it reads ▶ again, not 繼續
    await button.click(); await page.waitForFunction(() => document.querySelector('.peek-play').textContent.startsWith('▶ 繼續'));
    check('the button pauses and offers to resume', true);
    await page.focus('#peek'); await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('.peek-play').textContent.startsWith('❚❚'));
    check('Space resumes it', true);
    await page.keyboard.press('Escape');
    check('closing the panel stops the recording', await page.evaluate(() => document.getElementById('player').paused));
    // Space with the focus outside the panel stays the page's own: nothing plays.
    await page.click('#src-1 .source-link'); await page.waitForSelector(`#peek-${seg.seq} .peek-play`);
    await page.click('h1'); await page.keyboard.press(' '); await pause(500);
    check('Space outside the panel does not play', await page.evaluate(() => document.getElementById('player').paused));
    // A recording still loading when the panel closes does not start afterwards (a fresh page: nothing loaded yet).
    await page.reload(); await ready(); await page.press('#q', 'Enter'); await page.waitForSelector('.ask-answer');
    await page.click('#src-1 .source-link'); await page.waitForSelector(`#peek-${seg.seq} .peek-play`);
    let releaseAudio = null;
    await page.route('**/audio?*', async route => { await new Promise(r => { releaseAudio = r; }); await route.continue(); });
    await page.click(`#peek-${seg.seq} .peek-play`);
    for (let waited = 0; !releaseAudio; waited += 20) { if (waited > 10000) throw new Error('the recording was never requested'); await pause(20); }
    await page.keyboard.press('Escape'); releaseAudio(); await pause(1000);
    check('a recording that arrives after closing does not play', await page.locator('#peek').isHidden()
      && await page.evaluate(() => document.getElementById('player').paused));
    await page.unroute('**/audio?*');
    reply = q => answer(q);
  }

  // A newer question wins over a slower older one; not found offers full-text search.
  const other = '火星基地的預算';
  reply = q => q === other ? {question: q, notFound: true, answer: null, sources: [], degraded: false} : answer(q);
  hold = QUESTION; release = null;
  await page.fill('#q', QUESTION); await page.press('#q', 'Enter');
  while (!release) await pause(20);
  await page.fill('#q', other); await page.press('#q', 'Enter');
  await page.waitForSelector('.search-empty a[href^="/search"]');
  release(); hold = null; await pause(300);
  check('a newer question wins over a slower older one', await page.locator('.ask-answer').count() === 0 && await page.getAttribute('#answer', 'aria-busy') === 'false');
  check('not found offers full-text search with the question', (await page.textContent('.search-empty')).includes('找不到相關內容')
    && await page.getAttribute('.search-empty a', 'href') === `/search?q=${encodeURIComponent(other)}`);

  // Degraded is stated; an error is shown in the alert and the old answer goes; an empty question is not sent.
  reply = q => answer(q, {degraded: true});
  await page.fill('#q', QUESTION); await page.press('#q', 'Enter'); await page.waitForSelector('.ask-answer .ask-note');
  check('a keyword-only answer says so', (await page.textContent('.ask-note')).includes('只用關鍵字'));
  status = 503;
  await page.fill('#q', QUESTION); await page.press('#q', 'Enter'); await page.waitForFunction(() => !document.getElementById('notice').hidden);
  check('an error is shown and the old answer goes', await page.textContent('#notice') === '問答功能尚未設定' && await page.locator('.ask-answer').count() === 0);
  status = 200;
  const before = sent;
  await page.fill('#q', '   '); await page.press('#q', 'Enter');
  check('an empty question is not sent and says why', sent === before && await page.textContent('#notice') === '請輸入問題' && await page.getAttribute('#q', 'aria-invalid') === 'true');
  await page.fill('#q', QUESTION);
  check('typing a question clears the mark', await page.getAttribute('#q', 'aria-invalid') === null && await page.locator('#notice').isHidden());
  // Emptying the box while a question is under way: nothing is said to be looked up any more.
  hold = QUESTION; release = null;
  await page.press('#q', 'Enter');
  await page.waitForFunction(() => document.getElementById('summary').textContent === '正在找資料並整理答案…');
  await page.fill('#q', ''); await page.press('#q', 'Enter');
  check('an empty question during a lookup clears the announcement', await page.textContent('#summary') === '' && await page.getAttribute('#answer', 'aria-busy') === 'false');
  while (!release) await pause(20);
  release(); hold = null; await pause(200);
  check('the replaced lookup does not come back', await page.textContent('#summary') === '');

  // Index progress and service state, from /api/ask/status.
  for (const [state, expected] of [[{indexed: 1, total: 3, embedReachable: true, configured: true}, '還在建立索引（已完成 1 / 3 筆）'],
                                   [{indexed: 3, total: 3, embedReachable: false, configured: true}, '問答只會用關鍵字找資料'],
                                   [{indexed: 3, total: 3, embedReachable: true, configured: false}, '問答功能尚未設定']]) {
    await page.route('**/api/ask/status*', route => route.fulfill({json: {model: 'bge-m3-q8_0.gguf', ...state}}));
    await page.reload(); await ready(); await page.waitForFunction(() => !document.getElementById('indexState').hidden);
    check(`the page says: ${expected}`, (await page.textContent('#indexState')).includes(expected));
    await page.unroute('**/api/ask/status*');
  }
  await page.reload(); await ready(); await page.waitForResponse(r => r.url().includes('/api/ask/status')).catch(() => null); await pause(300);
  check('a complete index says nothing', await page.locator('#indexState').isHidden());

  // Back to full-text search with the text and team.
  await page.fill('#q', QUESTION);   // what is in the box goes along, sent or not
  await page.click('#toSearch'); await page.waitForURL(/\/search\?/); await page.waitForSelector('.search-filters');
  check('全文搜尋 opens with the question and team', new URL(page.url()).searchParams.get('q') === QUESTION && page.url().includes(`team=${teamId}`));

  // 400 px.
  await page.setViewportSize({width: 400, height: 860});
  await page.goto(`${app}/ask?q=${encodeURIComponent(QUESTION)}`); await ready();
  await page.press('#q', 'Enter'); await page.waitForSelector('.ask-answer');
  check('no horizontal scroll at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'ask-400.png'), fullPage: true});

  if (live) {
    // The real model: an answer with links that exist, or not found.
    await page.unroute('**/api/ask');
    await page.setViewportSize({width: 1280, height: 900});
    await page.goto(`${app}/ask?q=${encodeURIComponent(QUESTION)}`); await ready();
    await page.press('#q', 'Enter');
    await page.waitForFunction(() => document.getElementById('answer').getAttribute('aria-busy') === 'false' && document.querySelector('.ask-answer, .search-empty, #notice:not([hidden])'), null, {timeout: 120000});
    const hrefs = await page.locator('.source-link').evaluateAll(links => links.map(a => a.getAttribute('href')));
    check('the real model answers with sources that link somewhere', (await page.locator('.ask-answer').count() === 1 && hrefs.length > 0 && hrefs.every(h => h.startsWith('/')))
      || await page.locator('.search-empty').count() === 1, hrefs.slice(0, 3));
    await page.screenshot({path: join(out, 'ask-live.png'), fullPage: true});
  }
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/qa_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
