// ui-review-round-two in a real browser: the line under the current page of the header, 44px touch targets on a phone
// (header, the search switches, the turns of the speaker timeline), the actions of a row of 我的紀錄 with its download
// menu and the replay area that appears with a loaded record, the meetings list whose rows open the meeting, and two
// details of wording layout. The records of 我的紀錄 and the meetings list are answered here, so nothing depends on the
// data at hand; the review page uses a real meeting that has speakers. Nothing is written: every request that is not a
// GET is refused.
// Usage: YUQIAO_SESSION=<an administrator's session> node bench/ui_round_two_e2e.mjs [app url] [screenshot folder]
import {mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, ''), shots = process.argv[3];
if (!process.env.YUQIAO_SESSION) { console.error('Usage: YUQIAO_SESSION=… node bench/ui_round_two_e2e.mjs [app url] [screenshot folder]'); process.exit(2); }
if (shots) mkdirSync(shots, {recursive: true});
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); };
const json = body => ({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
async function open(path, width, routes = {}) {
  const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => route.request().method() === 'GET' ? route.fallback() : route.abort());
  for (const [pattern, handler] of Object.entries(routes)) await page.route(pattern, handler);
  await page.goto(app + path); await page.waitForTimeout(1300);
  return {page, context, errors};
}
const photo = (page, name) => shots ? page.screenshot({path: join(shots, name + '.png'), fullPage: true}) : null;
const narrow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// The meetings list, answered here: two meetings with segments and one without.
const MEETINGS = [
  {id: 'aaaaaaaa-0000-4000-8000-000000000001', teamId: 1, team: '研發部', startedAt: '2026-11-24T02:00:00+00:00', title: '出貨週會', seriesId: null, series: null, createdBy: 'alice', language: 'zh', engine: 'local', durationMs: 600000, segments: 10, reviewed: 4},
  {id: 'aaaaaaaa-0000-4000-8000-000000000002', teamId: 1, team: '研發部', startedAt: '2026-11-23T02:00:00+00:00', title: '規格討論', seriesId: null, series: null, createdBy: 'alice', language: 'zh', engine: 'local', durationMs: 300000, segments: 5, reviewed: 5},
  {id: 'aaaaaaaa-0000-4000-8000-000000000003', teamId: 1, team: '研發部', startedAt: '2026-11-22T02:00:00+00:00', title: '空的會議', seriesId: null, series: null, createdBy: 'alice', language: 'zh', engine: 'local', durationMs: 0, segments: 0, reviewed: 0}];
const listRoutes = {'**/api/meetings?*': route => route.fulfill(json(MEETINGS)), '**/api/meetings': route => route.fulfill(json(MEETINGS))};

// --- 1. The header: a line under the current page ---
{
  const {page, context, errors} = await open('/meetings', 1440, listRoutes);
  const links = await page.$$eval('#account > a', as => as.map(a => { const c = getComputedStyle(a); return [a.textContent.trim(), a.getAttribute('aria-current'), c.backgroundImage !== 'none', c.borderTopWidth, c.backgroundColor === 'rgba(0, 0, 0, 0)']; }));
  t('only the current page carries a line', links.filter(l => l[2]).map(l => [l[0], l[1]]), [['會議紀錄', 'page']]);
  t('the line is 2px high along the bottom edge', await page.$eval('#account > a[aria-current="page"]', a => { const c = getComputedStyle(a); return [c.backgroundSize.endsWith(' 2px'), c.backgroundPosition.endsWith('100%'), c.backgroundRepeat]; }), [true, true, 'no-repeat']);
  t('header links have no border; only the current one has a background', [links.every(l => l[3] === '0px'), links.filter(l => !l[4]).map(l => l[0])], [true, ['會議紀錄']]);

  // --- 3. The meetings list ---
  const rows = await page.$$eval('.meeting', rows => rows.map(r => { const links = [...r.querySelectorAll('a')];
    return [r.querySelector('.meeting-title').textContent, links.map(a => [a.textContent, a.getAttribute('href')]), links.map(a => { const c = getComputedStyle(a); return [c.backgroundColor === 'rgba(0, 0, 0, 0)', c.borderTopWidth, Math.round(a.getBoundingClientRect().height)]; })]; }));
  t('a row with segments holds exactly 會議紀要 and 逐字稿校對', rows[0][1], [['會議紀要', `/meetings/${MEETINGS[0].id}/minutes`], ['逐字稿校對', `/meetings/${MEETINGS[0].id}`]]);
  t('both are text links of the same height', rows[0][2], [[true, '0px', 40], [true, '0px', 40]]);
  t('a meeting without segments has no link and says so', [rows[2][1], await page.$eval('.meeting:nth-of-type(3)', r => r.textContent.includes('沒有校對資料'))], [[], true]);
  await photo(page, 'meetings-1440');
  // A real pointer click at the middle of the element: the area of 逐字稿校對 lies over the row, which is the point.
  const leaves = async selector => { const box = await page.locator(selector).boundingBox();
    const [request] = await Promise.all([page.waitForRequest(r => r.isNavigationRequest(), {timeout: 4000}).catch(() => null), page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)]);
    const path = request ? new URL(request.url()).pathname : null; if (request) { await page.goto(app + '/meetings'); await page.waitForTimeout(900); } return path; };
  t('clicking the topic opens the review page', await leaves('.meeting >> nth=0 >> .meeting-title'), `/meetings/${MEETINGS[0].id}`);
  t('clicking the progress part of the row opens the review page', await leaves('.meeting >> nth=1 >> .meeting-progress'), `/meetings/${MEETINGS[1].id}`);
  t('clicking 會議紀要 opens the minutes page', await leaves('.meeting >> nth=0 >> a.meeting-link:not(.opens)'), `/meetings/${MEETINGS[0].id}/minutes`);
  t('clicking a meeting without segments stays on the list', await leaves('.meeting >> nth=2 >> .meeting-title'), null);
  t('/meetings: no page errors', errors, []);
  await context.close();
}

// --- 2. Touch targets on a phone ---
const size = (page, selector) => page.$$eval(selector, es => es.filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
{
  const {page, context} = await open('/meetings', 390, listRoutes);
  const header = {brand: await size(page, '.topbar .brand'), search: await size(page, '#account > a[data-nav="search"]'), avatar: await size(page, '#account .account-avatar'), theme: await size(page, '#themeToggle')};
  t('phone header: four controls at least 44px tall', Object.values(header).map(s => s.length === 1 && s[0][1] >= 44), [true, true, true, true]);
  t('phone header: avatar and theme button at least 44px wide', [header.avatar[0][0] >= 44, header.theme[0][0] >= 44], [true, true]);
  t('phone header: not wider than the window', await narrow(page), true);
  t('phone list: the two links are 44px tall', (await size(page, '.meeting-link')).every(s => s[1] >= 44), true);
  await photo(page, 'meetings-390');
  await context.close();
}
{
  const {page, context} = await open('/search?q=' + encodeURIComponent('會議'), 390);
  t('phone search: the mode switch and the kind tabs are at least 44px tall', [(await size(page, '.mode-switch a')).map(s => s[1] >= 44), (await size(page, '.kind')).every(s => s[1] >= 44)], [[true, true], true]);
  t('phone search: not wider than the window', await narrow(page), true);
  await photo(page, 'search-390');
  await context.close();
}
{
  const {page, context} = await open('/ask', 390);
  t('phone ask: the mode switch is at least 44px tall', (await size(page, '.mode-switch a')).map(s => s[1] >= 44), [true, true]);
  await context.close();
}
{
  // A real meeting with speakers: the tappable area of a turn is the turn with its ::before.
  const all = await (await fetch(app + '/api/meetings', {headers: {Cookie: `yq_session=${process.env.YUQIAO_SESSION}`}})).json();
  let found = null;
  for (const m of all.filter(m => m.segments > 3).sort((a, b) => b.segments - a.segments).slice(0, 8)) {
    const {page, context} = await open(`/meetings/${m.id}`, 390);
    if (await page.$('.spk-turn')) { found = {page, context}; break; }
    await context.close();
  }
  if (!found) { failed++; console.log('FAIL no meeting with a speaker timeline to measure'); }
  else {
    const {page, context} = found;
    const lanes = await page.$$eval('.spk-lane', lanes => lanes.map(lane => { const turn = lane.querySelector('.spk-turn'); if (!turn) return null;
      const r = turn.getBoundingClientRect(), b = getComputedStyle(turn, '::before'), top = r.top + parseFloat(b.top), bottom = r.bottom - parseFloat(b.bottom); return [top, bottom]; }).filter(Boolean));
    t('phone timeline: each turn takes taps over at least 44px of height', lanes.every(([top, bottom]) => bottom - top >= 44), true);
    t('phone timeline: the areas of neighbouring lanes do not overlap', lanes.every((lane, i) => i === 0 || lane[0] >= lanes[i - 1][1] - 0.5), true);
    t('phone review: not wider than the window', await narrow(page), true);
    await photo(page, 'review-390');
    await context.close();
  }
}

// --- 4. 我的紀錄: answered here ---
const SESSIONS = [
  {id: '20261123-213758', startedAt: '2026-11-23 21:37:58', kind: 'interpret', sourceLang: 'zh', target: 'en', engine: 'local', inputSeconds: 53.1, usd: 0.0329, preview: 'Okay, next, let us update the conditions.'},
  {id: '20261122-215958', startedAt: '2026-11-22 21:59:58', kind: 'translate', sourceLang: 'zh', target: 'en', engine: 'local', inputSeconds: 119.7, usd: 0, preview: 'Within a day, the saying spread.'}];
const META = {...SESSIONS[0], seconds: 2, turns: [{source: '好，接下來更新條件。', target: 'Okay, next, let us update the conditions.'}], sourceText: '好，接下來更新條件。', targetText: 'Okay, next, let us update the conditions.'};
const interpretRoutes = {
  '**/api/interpret/sessions': route => route.fulfill(json(SESSIONS)),
  [`**/api/interpret/sessions/${SESSIONS[0].id}`]: route => route.fulfill(json(META)),
  [`**/api/interpret/sessions/${SESSIONS[0].id}/bars`]: route => route.fulfill(json({in: [{t: 0, v: .2}, {t: .5, v: .3}], out: [{t: 1, v: .2}], seconds: 2})),
  '**/api/interpret/sessions/*/*.wav': route => route.fulfill({status: 200, contentType: 'audio/wav', body: Buffer.alloc(44)}),
};
for (const width of [1440, 390]) {
  const {page, context, errors} = await open('/interpret', width, interpretRoutes);
  const shown = () => page.evaluate(() => [document.getElementById('player').checkVisibility(), document.getElementById('wave').checkVisibility(), document.getElementById('srcText').checkVisibility(), document.getElementById('loadHint').checkVisibility(), document.getElementById('loadHint').textContent]);
  t(`${width}: before loading, no replay area and the line under the list`, await shown(), [false, false, false, true, '按「載入」重播一筆紀錄，並顯示它的原文和譯文。']);
  const acts = await page.$$eval('#historyRows tr', rows => rows.map(r => [...r.querySelector('.acts').children].filter(e => e.checkVisibility()).map(e => e.textContent)));
  t(`${width}: the actions of a row, in order`, acts, [['載入', '下載', '轉成會議紀錄', '刪除'], ['載入', '下載', '轉成會議紀錄', '刪除']]);
  const look = await page.evaluate(() => { const row = document.querySelector('#historyRows tr'), load = row.querySelector('.row-load'), del = row.querySelector('.danger'), probe = document.createElement('i');
    probe.style.color = 'var(--danger)'; document.body.append(probe); const danger = getComputedStyle(probe).color; probe.remove();
    return [parseFloat(getComputedStyle(load).borderTopWidth) >= 1, getComputedStyle(del).color === danger, row.querySelectorAll('.acts a[download]').length]; });
  t(`${width}: 載入 has a border, 刪除 is in the danger colour, no download link in the row`, look, [true, true, 0]);
  await page.click('#historyRows tr:nth-child(1) .downloads'); await page.waitForTimeout(300);
  const menu = () => page.evaluate(() => { const m = document.getElementById('downloadMenu'), r = m.getBoundingClientRect(); return [m.matches(':popover-open'), [...m.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href'), a.hasAttribute('download')]), r.left >= 0 && r.right <= innerWidth && r.height > 0]; });
  t(`${width}: 下載 opens the three files of an interpreting record, inside the window`, await menu(),
    [true, [['原音', `/api/interpret/sessions/${SESSIONS[0].id}/input.wav`, true], ['譯音', `/api/interpret/sessions/${SESSIONS[0].id}/output.wav`, true], ['文字', `/api/interpret/sessions/${SESSIONS[0].id}/transcript.txt`, true]], true]);
  if (width === 1440) await photo(page, 'interpret-menu-1440');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  t(`${width}: Escape closes the menu`, (await menu())[0], false);
  await page.click('#historyRows tr:nth-child(2) .downloads'); await page.waitForTimeout(300);
  t(`${width}: a translating record has no 譯音`, (await menu())[1].map(a => a[0]), ['原音', '文字']);
  await page.mouse.click(5, 5); await page.waitForTimeout(200);
  t(`${width}: a click outside closes the menu`, (await menu())[0], false);
  await photo(page, `interpret-${width}`);
  await page.click('#historyRows tr:nth-child(1) .row-load'); await page.waitForTimeout(900);
  const after = await shown();
  t(`${width}: after 載入 the replay area and the texts show, the line is gone`, after.slice(0, 4), [true, true, true, false]);
  t(`${width}: the row is marked and the canvas has a size`, await page.evaluate(() => [document.querySelector('#historyRows tr').classList.contains('current'), document.getElementById('wave').getBoundingClientRect().width > 100]), [true, true]);
  t(`${width}: not wider than the window`, await narrow(page), true);
  await photo(page, `interpret-loaded-${width}`);
  t(`${width}: /interpret: no page errors`, errors, []);
  await context.close();
}
{
  // Without the Popover API the three links stay in the row.
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  await context.addInitScript(() => { delete HTMLElement.prototype.popover; });
  const page = await context.newPage();
  await page.route('**/*', route => route.request().method() === 'GET' ? route.fallback() : route.abort());
  for (const [pattern, handler] of Object.entries(interpretRoutes)) await page.route(pattern, handler);
  await page.goto(app + '/interpret'); await page.waitForTimeout(1300);
  t('no Popover API: the download links are in the row', await page.$$eval('#historyRows tr:nth-child(1) .acts > *', es => es.map(e => e.textContent)), ['載入', '原音', '譯音', '文字', '轉成會議紀錄', '刪除']);
  await context.close();
}

// --- 5. Details ---
{
  const {page, context} = await open('/admin/usage', 1440);
  t('tile notes avoid a last line of one word', await page.$$eval('.tile-note', ps => ps.length > 0 && ps.every(p => getComputedStyle(p).textWrapStyle === 'pretty' || getComputedStyle(p).textWrap === 'pretty')), true);
  await context.close();
}
{
  const all = await (await fetch(app + '/api/meetings', {headers: {Cookie: `yq_session=${process.env.YUQIAO_SESSION}`}})).json();
  const {page, context} = await open(`/meetings/${all.find(m => m.segments > 0).id}/minutes`, 1440);
  const boxes = await page.evaluate(() => { const hint = document.querySelector('.toolbar .hint').getBoundingClientRect(), status = document.getElementById('status'), r = status.getBoundingClientRect();
    return status.textContent ? [r.top >= hint.bottom - 1, Math.abs(r.left - hint.left) <= 1] : [getComputedStyle(status).display === 'none', true]; });
  t('minutes: the status line is under the explanation (or absent when empty)', boxes, [true, true]);
  await photo(page, 'minutes-1440');
  await context.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
