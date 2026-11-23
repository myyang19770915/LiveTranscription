// ui-consistency-pass in a real browser (Playwright, gstack's install). Read-only: nothing is started or submitted.
//   - site-navigation: the same header links in the same order on every page, the current one marked, the brand and the
//     theme button in the same place on every page (1440 and 390 wide, both themes); hidden links in the avatar menu
//   - visual-tokens: content lines up with the brand (80 px at 1440); switching the theme moves nothing; no page scrolls
//     sideways at 390 wide; 紀錄保存期限 stays inside its card on a phone
//   - page fixes: 待辦看板's primary button is the shared blue, native selects are styled, 問答's button matches its box,
//     我的紀錄 rows stay one line high
//   - realtime-interpret: 即時口譯 hides 會議情境, puts 同步播放譯音 next to 開始口譯, names the right button when empty
// Usage: YUQIAO_SESSION=<administrator's session> node bench/ui_consistency_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const PAGES = ['/', '/meetings', '/interpret', '/actions', '/metrics', '/search', '/ask', '/admin'];
const LINKS = ['即時會議', '會議紀錄', '我的紀錄', '待辦看板', '成效指標', '團隊管理', '搜尋'];
const MARKED = {'/': '即時會議', '/meetings': '會議紀錄', '/interpret': '我的紀錄', '/actions': '待辦看板', '/metrics': '成效指標', '/search': '搜尋', '/ask': '搜尋', '/admin': '團隊管理'};

async function open(path, {width = 1440, theme = 'dark', signedIn = true} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  if (signedIn) await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  await context.addInitScript(t => { try { localStorage.setItem('interpreter-theme', t); } catch {} }, theme);
  const page = await context.newPage();
  await page.goto(app + path); await page.waitForTimeout(1000);
  return {page, context};
}
const header = page => page.evaluate(() => {
  const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const main = document.querySelector('main'), cs = getComputedStyle(main);
  return {links: [...document.querySelectorAll('#account > a')].map(a => a.textContent), visible: [...document.querySelectorAll('#account > a')].filter(a => a.offsetParent).map(a => a.textContent),
    marked: [...document.querySelectorAll('#account > a[aria-current="page"]')].map(a => a.textContent),
    brand: box('.topbar .brand'), theme: box('#themeToggle'), topbar: box('.topbar'), main: box('main'),
    content: Math.round(main.getBoundingClientRect().left + parseFloat(cs.paddingLeft)), scroll: document.documentElement.scrollWidth - innerWidth,
    themeInView: document.querySelector('#themeToggle').getBoundingClientRect().right <= innerWidth};
});

// --- Every page shows the same header in the same place; One page width; Switching the theme changes only colours
for (const width of [1440, 390]) {
  const seen = {};
  for (const path of PAGES) for (const theme of ['dark', 'light']) {
    const {page, context} = await open(path, {width, theme});
    seen[`${path} ${theme}`] = await header(page);
    await context.close();
  }
  const first = seen['/ dark'];
  t(`${width}: the links and their order on every page`, PAGES.every(p => JSON.stringify(seen[`${p} dark`].links) === JSON.stringify(LINKS)), true);
  t(`${width}: the marked link`, PAGES.map(p => seen[`${p} dark`].marked[0]), PAGES.map(p => MARKED[p]));
  t(`${width}: brand and theme button in the same place on every page and theme`,
    Object.entries(seen).filter(([, h]) => JSON.stringify([h.brand[0], h.brand[1], h.theme]) !== JSON.stringify([first.brand[0], first.brand[1], first.theme])).map(([k]) => k), []);
  t(`${width}: switching the theme moves nothing`, PAGES.filter(p => JSON.stringify([seen[`${p} dark`].main, seen[`${p} dark`].topbar, seen[`${p} dark`].theme])
    !== JSON.stringify([seen[`${p} light`].main, seen[`${p} light`].topbar, seen[`${p} light`].theme])), []);
  t(`${width}: no page scrolls sideways`, Object.entries(seen).filter(([, h]) => h.scroll > 0).map(([k, h]) => `${k} +${h.scroll}`), []);
  t(`${width}: the theme button is inside the window`, Object.entries(seen).filter(([, h]) => !h.themeInView).map(([k]) => k), []);
  if (width === 1440) {
    t('1440: the content lines up with the brand at 80 px', PAGES.map(p => [seen[`${p} dark`].brand[0], seen[`${p} dark`].content]), PAGES.map(() => [80, 80]));
    t('1440: all links shown', seen['/meetings dark'].visible, LINKS);
  } else t('390: only 搜尋 stays in the header', seen['/meetings dark'].visible, ['搜尋']);
}
// /review and /minutes (a meeting's pages; without a meeting id the page still has its header) count as 會議紀錄.
// A meeting's pages (/meetings/<id>, /meetings/<id>/minutes): their HTML answered by the test, as no meeting is needed
// to read the header.
async function meetingPage(path, file, width = 1440) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  const page = await context.newPage();
  const html = await (await context.request.get(`${app}/assets/${file}`)).text();
  await page.route(app + path, route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
  await page.goto(app + path); await page.waitForTimeout(1000);
  return {page, context};
}
for (const [path, file] of [['/meetings/m-test', 'review.html'], ['/meetings/m-test/minutes', 'minutes.html']]) {
  const {page, context} = await meetingPage(path, file);
  t(`${path}: the marked link is 會議紀錄`, await page.$$eval('#account > a[aria-current="page"]', a => a.map(x => x.textContent)), ['會議紀錄']);
  await context.close();
}
{
  const {page, context} = await meetingPage('/meetings/m-test', 'review.html', 500);
  await page.click('.account-avatar'); await page.waitForTimeout(200);
  t('500 /meetings/<id>: the avatar menu offers what the header hides',
    await page.$$eval('.account-menu .menu-nav', items => items.filter(i => getComputedStyle(i).display !== 'none').map(i => i.textContent)),
    ['即時會議', '我的紀錄', '待辦看板', '成效指標', '團隊管理']);
  await context.close();
}
// The links the header hides are in the avatar menu (site-navigation), never the current page.
for (const [width, path, want] of [[850, '/', ['會議紀錄', '待辦看板', '我的紀錄', '成效指標', '團隊管理'].filter(x => ['我的紀錄', '成效指標', '團隊管理'].includes(x))],
                                   [500, '/actions', ['即時會議', '會議紀錄', '我的紀錄', '成效指標', '團隊管理']],
                                   [1280, '/actions', []]]) {
  const {page, context} = await open(path, {width});
  await page.click('.account-avatar'); await page.waitForTimeout(200);
  t(`${width} ${path}: the avatar menu offers what the header hides`,
    await page.$$eval('.account-menu .menu-nav', items => items.filter(i => getComputedStyle(i).display !== 'none').map(i => i.textContent)), want);
  await context.close();
}
{
  const {page, context} = await open('/login', {width: 390, signedIn: false});
  const login = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth - innerWidth, theme: getComputedStyle(document.getElementById('themeToggle')).borderRadius,
    width: Math.round(document.getElementById('themeToggle').getBoundingClientRect().width)}));
  t('sign-in page: no sideways scroll, the same round theme button', [login.scroll, login.theme, login.width], [0, '50%', 36]);
  await context.close();
}

// --- No sideways scrolling: 紀錄保存期限 on a phone
{
  const {page, context} = await open('/admin', {width: 390});
  const inside = await page.evaluate(() => { const card = document.getElementById('retention').getBoundingClientRect();
    return [...document.querySelectorAll('#retentionForm label, #retentionDays')].every(e => { const r = e.getBoundingClientRect(); return r.left >= card.left && r.right <= card.right; }); });
  t('團隊管理 on a phone: 保存期限 inside its card', inside, true);
  await context.close();
}

// --- Page fixes
{
  const {page: board, context: c1} = await open('/actions');
  const {page: admin, context: c2} = await open('/admin');
  const accent = await admin.evaluate(() => getComputedStyle(document.querySelector('.primary-button')).backgroundColor);
  t('待辦看板: the primary button is the shared blue', await board.evaluate(() => getComputedStyle(document.querySelector('.board-head .primary-button')).backgroundColor), accent);
  await c1.close(); await c2.close();
  for (const path of ['/meetings', '/search', '/actions']) {
    const {page, context} = await open(path);
    t(`${path}: selects are styled`, await page.$$eval('main select', s => s.filter(e => e.offsetParent).every(e => getComputedStyle(e).appearance === 'none' && getComputedStyle(e).backgroundImage !== 'none')), true);
    await context.close();
  }
  const {page: ask, context: c3} = await open('/ask');
  t('問答: the button matches the box', await ask.evaluate(() => { const b = document.getElementById('askButton').getBoundingClientRect(), q = document.querySelector('.ask-box').getBoundingClientRect();
    return [Math.round(b.height) === Math.round(q.height), Math.round(b.bottom) === Math.round(q.bottom), document.getElementById('askButton').textContent]; }), [true, true, '提問']);
  await c3.close();
  const {page: records, context: c4} = await open('/interpret');
  t('我的紀錄: rows stay one line high', await records.$$eval('#historyRows tr', rows => rows.every(r => r.getBoundingClientRect().height <= 56)), true);
  t('我的紀錄: the empty translation panel says what to do', await records.textContent('#outText'), '按「載入」顯示紀錄。');
  await c4.close();
}

// --- The settings of 即時口譯 (a granted user: the session is an administrator's)
{
  const {page, context} = await open('/');
  const empty = {};
  for (const mode of ['modeMeeting', 'modeTranslate', 'modeInterpret']) {
    await page.click('#' + mode); await page.waitForTimeout(250);
    empty[mode] = (await page.textContent('#transcript .empty-state small')).match(/「(.+?)」/)?.[1];
  }
  t('the empty transcript names the button of the mode', empty, {modeMeeting: '開始會議', modeTranslate: '開始翻譯', modeInterpret: '開始口譯'});
  const s = await page.evaluate(() => { const play = document.getElementById('interpretPlayRow').getBoundingClientRect(), start = document.getElementById('start').getBoundingClientRect();
    const note = document.querySelector('#start .button-copy small');
    return {context: getComputedStyle(document.querySelector('.context-field')).display, sameRow: Math.abs(play.top - start.top) <= 2 && play.right <= start.left,
      note: note.checkVisibility()}; });   // ui-night-celadon: the start button has no second line
  t('即時口譯: no 會議情境, 同步播放譯音 beside 開始口譯, no second line', [s.context, s.sameRow, s.note], ['none', true, false]);
  await context.close();
}
await browser.close();
