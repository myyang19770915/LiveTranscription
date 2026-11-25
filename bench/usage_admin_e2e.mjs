// usage-admin in a real browser (Playwright, gstack's install): the usage management page with the API answered by
// the test (figures, budget states, the daily chart and its table, saving a budget, a failed read, a phone), the
// section tabs shared with the team administration page, the header link 管理, and the team administration page
// without its two usage cards. Nothing is written: every request that is not a GET is answered or refused here.
// With a folder as the third argument the real page is also photographed (1440 and 390 wide, both themes).
// Usage: YUQIAO_SESSION=<administrator's session> node bench/usage_admin_e2e.mjs [app url] [screenshot folder]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const shots = process.argv[3];
if (!process.env.YUQIAO_SESSION) { console.error('Usage: YUQIAO_SESSION=… node bench/usage_admin_e2e.mjs [app url] [screenshot folder]'); process.exit(2); }
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};

// The spec's figures: 0.27 + 2.04 USD this month, 1.08 + 2.11 USD accumulated; two days of the 30 have usage.
function figures(change = {}) {
  const days = Array.from({length: 30}, (_, i) => { const d = new Date(Date.UTC(2026, 9, 27 + i)); return {day: d.toISOString().slice(0, 10), mai: 0, interpret: 0}; });
  days[29].mai = 1800; days[28].interpret = 3600;
  const base = {today: '2026-11-25', month: '2026-11', daily: days,
    months: [['2026-06', 0, 129], ['2026-07', 0, 0], ['2026-08', 0, 0], ['2026-09', 0, 0], ['2026-10', 5400, 0], ['2026-11', 1800, 3600]].map(([month, mai, interpret]) => ({month, mai, interpret})),
    services: [
      {key: 'mai', usdPerHour: 0.54, budgetUsd: 50, state: 'ok', total: {seconds: 7200, usd: 1.08}, month: {seconds: 1800, usd: 0.27}, previousMonth: {seconds: 5400, usd: 0.81},
        byPurpose: [{purpose: 'bench', seconds: 5400, monthSeconds: 0}, {purpose: 'live', seconds: 1800, monthSeconds: 1800}], byUser: []},
      {key: 'interpret', usdPerHour: 2.04, budgetUsd: null, state: 'ok', total: {seconds: 3729, usd: 2.11}, month: {seconds: 3600, usd: 2.04}, previousMonth: {seconds: 0, usd: 0},
        byPurpose: [{purpose: 'live', seconds: 3600, monthSeconds: 3600}, {purpose: 'lab', seconds: 129, monthSeconds: 0}],
        byUser: [{username: 'alice', seconds: 3600, monthSeconds: 3600}, {username: '', seconds: 129, monthSeconds: 0}]}]};
  Object.assign(base.services[0], change.mai); Object.assign(base.services[1], change.interpret);
  if (change.noDays) base.daily.forEach(d => { d.mai = d.interpret = 0; });
  return base;
}

// A page whose usage API is answered here. `answer` gives the figures (or a status code); `save` answers the PUT.
async function open(path, {width = 1440, answer = () => figures(), save} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  const page = await context.newPage(), errors = [], asked = [], sent = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (r.url().includes('/api/')) asked.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await context.route('**/api/**', route => route.request().method() === 'GET' ? route.fallback() : route.abort());   // nothing is written
  await context.route('**/api/admin/usage', route => { const a = answer();
    return typeof a === 'number' ? route.fulfill({status: a, contentType: 'application/json', body: '{"detail":"no"}'}) : route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(a)}); });
  await context.route('**/api/admin/usage/budgets', route => { sent.push(route.request().postDataJSON()); const [status, body] = save(sent.at(-1));
    return route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)}); });
  await page.goto(app + path); await page.waitForTimeout(900);
  return {page, context, errors, asked, sent};
}
const texts = (page, selector) => page.$$eval(selector, nodes => nodes.map(n => n.textContent.trim()));
const tabs = page => page.$$eval('.section-tabs a', nodes => nodes.map(a => { const r = a.getBoundingClientRect();
  return {text: a.textContent, href: a.getAttribute('href'), current: a.getAttribute('aria-current'), x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), h: Math.round(r.height)}; }));
const marked = page => page.$$eval('#account a.nav-link[aria-current="page"]', nodes => nodes.map(a => a.textContent));

// --- The page with the spec's figures ---
{
  const {page, context, errors} = await open('/admin/usage');
  t('figures of the month and accumulated', await texts(page, '.tile-value'), ['2.31美元', '0.27美元', '2.04美元', '3.19美元']);
  t('each figure comes with its hours', await texts(page, '.tile-note'), ['共 1.50 小時；上月 0.81 美元', '0.50 小時，每小時 0.54 美元', '1.00 小時，每小時 2.04 美元', '共 3.04 小時；雲端辨識 1.08 美元，即時口譯 2.11 美元']);
  t('figure labels', await texts(page, '.tile-label'), ['本月合計', '雲端辨識 本月', '即時口譯 本月', '累計合計']);
  t('the page says the amounts are estimates', (await page.textContent('.lead')).includes('不是帳單'), true);
  t('no warning when both are within budget', await page.$$eval('#warnings > *', n => n.length), 0);
  t('budget cards: name and state', await page.$$eval('.budget', cards => cards.map(c => [c.querySelector('h2').textContent, c.querySelector('.state').textContent, !!c.querySelector('.state svg')])),
    [['雲端辨識', '正常', true], ['即時口譯', '正常', true]]);
  t('budget figures', await texts(page, '.budget-figure'), ['1.08 / 50.00 美元（2%）', '2.11 美元 · 未設上限']);
  t('a meter only where there is a budget', await page.$$eval('.budget', cards => cards.map(c => c.querySelector('[role=meter]')?.getAttribute('aria-valuetext') ?? null)),
    ['1.08 / 50.00 美元（2%）', null]);
  t('budget fields', await page.$$eval('.budget input', inputs => inputs.map(i => i.value)), ['50', '']);
  t('months, newest first', await page.$$eval('#monthly tbody tr', rows => rows.map(r => [...r.cells].map(c => c.textContent))),
    [['2026/11', '0.50', '0.27', '1.00', '2.04', '2.31'], ['2026/10', '1.50', '0.81', '0.00', '0.00', '0.81'], ['2026/09', '0.00', '0.00', '0.00', '0.00', '0.00'],
      ['2026/08', '0.00', '0.00', '0.00', '0.00', '0.00'], ['2026/07', '0.00', '0.00', '0.00', '0.00', '0.00'], ['2026/06', '0.00', '0.00', '0.04', '0.07', '0.07']]);
  t('purposes in plain words', await page.$$eval('#purposes tbody tr', rows => rows.map(r => [...r.cells].map(c => c.textContent))),
    [['雲端辨識', '評測', '0.00', '1.50', '0.81'], ['雲端辨識', '即時辨識', '0.50', '0.50', '0.27'], ['即時口譯', '即時口譯', '1.00', '1.00', '2.04'], ['即時口譯', '測試', '0.00', '0.04', '0.07']]);
  t('users, the empty name as （未記名）', await page.$$eval('#users tbody tr', rows => rows.map(r => [...r.cells].map(c => c.textContent))),
    [['alice', '1.00', '1.00', '2.04'], ['（未記名）', '0.00', '0.04', '0.07']]);
  t('wide tables scroll in their own region, reachable from the keyboard', await page.$$eval('.table-wrap', w => w.every(x => x.tabIndex === 0 && x.getAttribute('role') === 'region' && !!x.getAttribute('aria-labelledby'))), true);
  t('no supplier or technology is named', /Azure|MAI|GPT|OpenAI|模型/.test(await page.evaluate(() => document.body.innerText)), false);

  // The daily chart: one stacked bar per day with usage, a legend, a day by pointer and by keyboard, and the table.
  t('daily chart: a bar for each service on its day', [await page.$$eval('#daily .bar-1', n => n.length), await page.$$eval('#daily .bar-2', n => n.length)], [1, 1]);
  t('legend names both services', await texts(page, '#daily .legend li'), ['雲端辨識', '即時口譯']);
  t('one tab stop in the chart', await page.$$eval('#daily .hit[tabindex="0"]', n => n.length), 1);
  await page.focus('#daily .hit[tabindex="0"]');
  t('focus on the last day with usage shows its figures', await texts(page, '#daily .viz-tip:not([hidden]) > *'), ['2026/11/25', '雲端辨識 0.27 美元（0.50 小時）', '即時口譯 0.00 美元（0.00 小時）']);
  await page.keyboard.press('ArrowLeft');
  t('the left arrow moves to the day before', await texts(page, '#daily .viz-tip:not([hidden]) > *'), ['2026/11/24', '雲端辨識 0.00 美元（0.00 小時）', '即時口譯 2.04 美元（1.00 小時）']);
  t('the focused day is named for screen readers', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '11/24：雲端辨識 0.00 美元、即時口譯 2.04 美元');
  await page.keyboard.press('Home');
  t('Home goes to the first day', await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '10/27：雲端辨識 0.00 美元、即時口譯 0.00 美元');
  await page.hover('#daily .hit:last-of-type');
  t('hovering a day shows its figures', (await texts(page, '#daily .viz-tip:not([hidden]) > *'))[0], '2026/11/25');
  await page.click('#dailyTable');
  t('表格: the days with usage, newest first', await page.$$eval('#daily tbody tr', rows => rows.map(r => [...r.cells].map(c => c.textContent))),
    [['2026/11/25', '0.50', '0.00', '0.27'], ['2026/11/24', '0.00', '1.00', '2.04']]);
  t('表格: the chart is gone and the button offers it back', [await page.$$eval('#daily svg', n => n.length), await page.textContent('#dailyTable'), await page.getAttribute('#dailyTable', 'aria-pressed')], [0, '圖表', 'true']);
  await page.click('#dailyTable');
  t('pressing again shows the chart', [await page.$$eval('#daily svg', n => n.length), await page.textContent('#dailyTable')], [1, '表格']);

  // Section tabs and the header link.
  const here = await tabs(page);
  t('tabs on 用量管理', here.map(a => [a.text, a.href, a.current]), [['團隊管理', '/admin', null], ['用量管理', '/admin/usage', 'page']]);
  t('tabs are at least 44 px high', here.every(a => a.h >= 44), true);
  t('the current tab is marked by more than colour', await page.$$eval('.section-tabs a', a => a.map(x => [getComputedStyle(x).fontWeight, getComputedStyle(x).borderBottomColor !== 'rgba(0, 0, 0, 0)'])), [['600', false], ['700', true]]);
  t('header marks 管理 on /admin/usage', await marked(page), ['管理']);
  t('header links', (await texts(page, '#account a.nav-link')).join(' '), '即時會議 會議紀錄 我的紀錄 待辦看板 成效指標 管理 搜尋');
  await page.focus('#themeToggle');
  const focused = [];
  for (let i = 0; i < 6 && focused.length < 2; i++) { await page.keyboard.press('Tab');
    const got = await page.evaluate(() => { const a = document.activeElement; return a.closest('.section-tabs') ? [a.textContent, a.matches(':focus-visible') && getComputedStyle(a).outlineStyle !== 'none'] : null; });
    if (got) focused.push(got); }
  t('Tab reaches both tabs and each shows its focus', focused, [['團隊管理', true], ['用量管理', true]]);
  await page.focus('.section-tabs a');
  await page.keyboard.press('Enter'); await page.waitForURL(app + '/admin'); await page.waitForTimeout(700);
  const there = await tabs(page);
  t('Enter on 團隊管理 opens /admin with that tab marked', there.map(a => [a.text, a.current]), [['團隊管理', 'page'], ['用量管理', null]]);
  t('the tabs do not move between the two pages', there.map((a, i) => [Math.abs(a.x - here[i].x) <= 1, Math.abs(a.y - here[i].y) <= 1]), [[true, true], [true, true]]);
  t('header marks 管理 on /admin', await marked(page), ['管理']);
  await page.click('.section-tabs a[href="/admin/usage"]'); await page.waitForURL(app + '/admin/usage');
  t('用量管理 opens /admin/usage', new URL(page.url()).pathname, '/admin/usage');
  t('no page errors', errors, []);
  await context.close();
}

// --- Near and over a budget ---
{
  const {page, context} = await open('/admin/usage', {answer: () => figures({mai: {state: 'near', total: {seconds: 266667, usd: 40}, byPurpose: [{purpose: 'quality', seconds: 200000, monthSeconds: 0}, {purpose: 'constructor', seconds: 66667, monthSeconds: 0}]}})});
  t('near: one warning, naming the service', await texts(page, '#warnings > *'), ['雲端辨識接近上限：累計約 40.00 美元，已達上限 50.00 美元的八成。']);
  t('精準模式 for quality, and an unknown purpose as recorded', (await page.$$eval('#purposes tbody tr', rows => rows.map(r => r.cells[1].textContent))).slice(0, 2), ['精準模式', 'constructor']);
  t('near: states of the cards', await texts(page, '.budget .state'), ['接近上限', '正常']);
  t('near: the meter is at 80%', await page.$eval('.budget [role=meter]', m => [m.getAttribute('aria-valuenow'), m.getAttribute('aria-valuemax'), m.querySelector('.meter-fill').style.width, m.classList.contains('near')]), ['40', '50', '80%', true]);
  await context.close();
}
{
  const {page, context} = await open('/admin/usage', {answer: () => figures({interpret: {state: 'over', budgetUsd: 2, total: {seconds: 3729, usd: 2.11}}})});
  const warning = (await texts(page, '#warnings > *'))[0];
  t('over: the warning names the service and says it keeps working', [warning.startsWith('即時口譯已達到上限'), warning.includes('服務仍可使用')], [true, true]);
  t('over: states of the cards', await texts(page, '.budget .state'), ['正常', '已達上限']);
  t('over: the meter does not pass its end', await page.$eval('.budget:nth-child(2) [role=meter]', m => [m.getAttribute('aria-valuenow'), m.querySelector('.meter-fill').style.width]), ['2', '100%']);
  await context.close();
}

// --- Saving a budget ---
{
  let saved = {mai: 50, interpret: null};
  const {page, context, sent} = await open('/admin/usage', {answer: () => figures({mai: {budgetUsd: saved.mai}, interpret: {budgetUsd: saved.interpret}}), save: body => { saved = body; return [200, body]; }});
  await page.fill('.budget:nth-child(1) input', '80');
  await page.click('.budget:nth-child(1) button[type=submit]'); await page.waitForTimeout(600);
  t('saving sends both budgets', sent, [{mai: 80, interpret: null}]);
  t('the figures are shown again with the new budget', [(await texts(page, '.budget-figure'))[0], (await texts(page, '.budget-note'))[0]], ['1.08 / 80.00 美元（1%）', '已儲存：上限 80.00 美元。']);
  await page.fill('.budget:nth-child(2) input', '20');
  await page.click('.budget:nth-child(2) button[type=submit]'); await page.waitForTimeout(600);
  t('saving the other card keeps the first budget', sent[1], {mai: 80, interpret: 20});
  // What was typed in the other card and not saved is still there after this card is saved, and is not sent.
  await page.fill('.budget:nth-child(2) input', '33');
  await page.fill('.budget:nth-child(1) input', '90');
  await page.click('.budget:nth-child(1) button[type=submit]'); await page.waitForTimeout(600);
  t('an unsaved value in the other card is kept and not sent', [sent.at(-1), await page.inputValue('.budget:nth-child(2) input'), await page.evaluate(() => document.activeElement.textContent)],
    [{mai: 90, interpret: 20}, '33', '儲存']);
  // Text that is no amount is refused on the page: it is never taken for "no budget".
  for (const typed of ['0.001', '-5', '1000001', '12e']) {
    await page.locator('.budget:nth-child(1) input').fill('');
    await page.locator('.budget:nth-child(1) input').pressSequentially(typed);
    const before = sent.length;
    await page.click('.budget:nth-child(1) button[type=submit]'); await page.waitForTimeout(250);
    t(`「${typed}」 is refused and nothing is sent`, [sent.length - before, (await texts(page, '.budget-note'))[0]], [0, '上限要是 0.01 到 1000000 之間的金額，留空表示不設上限']);
  }
  t('half-typed 「12e」 was text the field could not read', await page.$eval('.budget:nth-child(1) input', i => i.validity.badInput), true);
  await page.locator('.budget:nth-child(1) input').fill('');
  await page.click('.budget:nth-child(1) button[type=submit]'); await page.waitForTimeout(600);
  t('an empty field means no budget', [sent.at(-1).mai, (await texts(page, '.budget-note'))[0]], [null, '已儲存：不設上限。']);
  await context.close();
}
{
  const {page, context, sent} = await open('/admin/usage', {save: () => [422, {detail: '上限要是大於 0 的金額，留空表示不設上限'}]});
  await page.fill('.budget:nth-child(1) input', '5');
  await page.click('.budget:nth-child(1) button[type=submit]'); await page.waitForTimeout(500);
  t('refused: the reason is under the card and the field keeps what was typed',
    [sent.length, (await texts(page, '.budget-note'))[0], await page.inputValue('.budget:nth-child(1) input'), await page.isEnabled('.budget:nth-child(1) button[type=submit]')],
    [1, '上限要是大於 0 的金額，留空表示不設上限', '5', true]);
  await context.close();
}

// --- No usage in the last 30 days; the figures cannot be read ---
{
  const {page, context} = await open('/admin/usage', {answer: () => figures({noDays: true})});
  t('no usage in 30 days: said in words, nothing drawn', [await page.textContent('#daily'), await page.$$eval('#daily svg', n => n.length)], ['近 30 天沒有用量', 0]);
  await context.close();
}
{
  const {page, context, errors} = await open('/admin/usage', {answer: () => 500});
  t('a failed read: the message, and no figures', [await page.textContent('#loadError'), await page.isVisible('#loadError'), await page.isVisible('#content'), await page.$$eval('.tile', n => n.length)],
    ['用量暫時讀不到，請稍後再試。', true, false, 0]);
  t('a failed read: no page errors', errors, []);
  await context.close();
}

// --- A phone ---
for (const [path, width] of [['/admin/usage', 390], ['/admin', 390], ['/admin/usage', 500]]) {
  const {page, context} = await open(path, {width});
  t(`${path} at ${width} px does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (path === '/admin/usage' && width === 390) t('at 390 px the months table scrolls inside its card', await page.$eval('#monthly .table-wrap', w => w.scrollWidth > w.clientWidth && w.getBoundingClientRect().right <= innerWidth), true);
  if (path === '/admin/usage' && width === 500) {
    t('at 500 px the avatar menu does not offer 管理 on its own page', await page.evaluate(async () => { document.querySelector('.account-avatar, #account button')?.click(); await new Promise(r => setTimeout(r, 300));
      return [...document.querySelectorAll('.account-menu .menu-nav')].filter(i => getComputedStyle(i).display !== 'none').map(i => i.textContent); }), ['即時會議', '會議紀錄', '我的紀錄', '待辦看板', '成效指標']);
  }
  await context.close();
}

// --- The team administration page without its usage cards ---
{
  const {page, context, errors, asked} = await open('/admin');
  t('/admin has no usage cards', await page.evaluate(() => [...document.querySelectorAll('h2, .label')].map(n => n.textContent).filter(x => x.includes('用量'))), []);
  t('/admin does not ask for the usage', asked.filter(a => a.includes('usage')), []);
  t('/admin keeps its other cards', await page.evaluate(() => ['interpretAccess', 'retention', 'createTeam', 'teams'].map(id => !!document.getElementById(id))), [true, true, true, true]);
  t('/admin: no page errors', errors, []);
  await context.close();
}

// --- Photographs of the real page ---
if (shots) {
  for (const [width, theme] of [[1440, 'dark'], [1440, 'light'], [390, 'dark'], [390, 'light']]) {
    const context = await browser.newContext({viewport: {width, height: 900}});
    await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
    await context.addInitScript(t => { try { localStorage.setItem('interpreter-theme', t); } catch {} }, theme);
    const page = await context.newPage();
    await page.goto(app + '/admin/usage'); await page.waitForTimeout(1200);
    await page.screenshot({path: join(shots, `usage-${width}-${theme}.png`), fullPage: true});
    if (width === 1440 && theme === 'dark') { await page.goto(app + '/admin'); await page.waitForTimeout(1200); await page.screenshot({path: join(shots, 'admin-1440-dark.png'), fullPage: true}); }
    await context.close();
  }
}
await browser.close();
