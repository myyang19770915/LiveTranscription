// Browser checks for the ui-review-fixes behaviour (Playwright, gstack's install). Read-only: nothing is saved,
// nobody is taken out of a team.
//   - review page: while 修改原文 is open the translation keeps its column (1280px) and both stack on a phone (500px)
//   - /admin: 移出團隊 is a danger button coloured unlike 移除照片, asks 確定把〈name〉移出〈team〉？ once and resets
//   - avatar menu: the page links it offers match the site-navigation spec's example table (width, page, user)
//   - 404 page: 返回上一頁 only when arriving from a page of this site other than sign-in, and it goes back
// Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<admin token> [YUQIAO_MEMBER_SESSION=<non-admin token>] node bench/ui_review_e2e.mjs <meeting id> <screenshot dir>
//   <meeting id>: a meeting whose first segment has a translation; at least one team member needs a photo; tokens from `python -m auth issue-session <username>`
//   in the app container. Without YUQIAO_MEMBER_SESSION the member row of the menu table is skipped.
import {mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [meetingId, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !meetingId || !out) {
  console.error('Usage: YUQIAO_SESSION=<admin token> [YUQIAO_MEMBER_SESSION=<token>] node bench/ui_review_e2e.mjs <meeting id> <dir>'); process.exit(2);
}
mkdirSync(out, {recursive: true});
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
// The review page redraws its rows on every click (render()), so measure only once the element is on screen again.
const width = async locator => { await locator.waitFor({state: 'visible'}); return (await locator.boundingBox()).width; };
const signedIn = async (token, width = 1280) => {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'yq_session', value: token, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  return {context, page};
};

try {
  const {context, page} = await signedIn(process.env.YUQIAO_SESSION);

  // --- Review page: the translation stays in its column while editing (transcript-review). ---
  await page.goto(`${app}/meetings/${meetingId}`);
  await page.waitForSelector('.seg .seg-target');
  const target = page.locator('.seg').first().locator('.seg-target');
  const before = {width: await width(target), text: await target.textContent()};
  check('meeting has a translated first segment', before.text.trim() !== '', before.text.slice(0, 30));
  await page.locator('.seg').first().locator('.seg-source').click();
  await page.locator('.seg').first().getByRole('button', {name: '修改原文'}).click();
  await page.waitForSelector('.edit-form');
  const editing = {width: await width(target), text: await target.textContent(), form: await width(page.locator('.edit-form'))};
  check('1280px: translation width unchanged while editing', Math.abs(editing.width - before.width) < 1, [before.width, editing.width]);
  check('1280px: translation text unchanged while editing', editing.text === before.text);
  check('1280px: editor sits beside the translation, not over it', editing.form < before.width * 1.5, editing.form);
  await page.screenshot({path: join(out, 'review-edit-1280.png')});
  await page.setViewportSize({width: 500, height: 900});
  const phone = {target: await width(target), form: await width(page.locator('.edit-form'))};
  check('500px: editor and translation each take the full row', phone.target > 400 && Math.abs(phone.target - phone.form) < 1, phone);
  await page.locator('.edit-form').getByRole('button', {name: '取消'}).click();   // nothing saved
  await page.setViewportSize({width: 1280, height: 900});

  // --- /admin: 移出團隊 versus 移除照片 (team-access). ---
  const membersBefore = await page.evaluate(() => fetch('/api/admin/teams').then(r => r.text()));
  await page.goto(`${app}/admin`);
  await page.waitForSelector('.member');
  const buttons = await page.locator('.member-actions button').evaluateAll(list => list.map(b => ({text: b.textContent, danger: b.classList.contains('danger'), color: getComputedStyle(b).color})));
  const removes = buttons.filter(b => b.text === '移出團隊'), photos = buttons.filter(b => b.text === '移除照片');
  check('every member row has 移出團隊 and no bare 移除', removes.length === await page.locator('.member').count() && !buttons.some(b => b.text === '移除'), buttons.map(b => b.text));
  check('移出團隊 is a danger button', removes.every(b => b.danger));
  if (photos.length) {
    check('移除照片 is not a danger button', photos.every(b => !b.danger));
    check('移出團隊 and 移除照片 are coloured differently', removes[0].color !== photos[0].color, [removes[0].color, photos[0].color]);
  } else check('a member has a photo, so 移除照片 can be checked (give one a photo on /admin)', false);
  const row = page.locator('.member').first();
  const name = (await row.locator('.member-text b').textContent()).trim();
  const team = (await page.locator('.team', {has: row}).first().locator('h2').first().textContent()).trim();
  const remove = row.getByRole('button', {name: '移出團隊'});
  await remove.click();   // first press only asks
  const asked = await row.locator('.member-actions button.danger').last().textContent();
  check('移出團隊 asks with member and team names', asked === `確定把${name}移出${team}？`, asked);
  await page.screenshot({path: join(out, 'admin-confirm.png')});
  await page.waitForTimeout(4500);
  check('the question resets to 移出團隊 after 4 s', (await row.locator('.member-actions button.danger').last().textContent()) === '移出團隊');
  const membersAfter = await page.evaluate(() => fetch('/api/admin/teams').then(r => r.text()));
  check('no membership changed', membersAfter === membersBefore);

  // --- 404 page (not-found-page). ---
  await page.goto(`${app}/meetings`);
  await page.evaluate(() => {
    const link = Object.assign(document.createElement('a'), {id: 'ui-review-gone', href: '/meetings/00000000-0000-0000-0000-000000000000', textContent: 'gone'});
    document.body.prepend(link);
  });
  await page.click('#ui-review-gone');
  await page.waitForSelector('.lost');
  const shown = () => page.locator('.lost-links a:visible').allTextContents();
  check('404 from a page of this site: 返回上一頁 and both links', JSON.stringify(await shown()) === JSON.stringify(['返回上一頁', '回開會頁', '會議紀錄']), await shown());
  check('404 shows the team administrator hint', (await page.locator('.lost-hint').textContent()).includes('請團隊管理員確認你在該團隊中'));
  await page.screenshot({path: join(out, '404-from-list.png')});
  await page.click('#back');
  await page.waitForURL(`${app}/meetings`);
  check('返回上一頁 goes back to the list', new URL(page.url()).pathname === '/meetings', page.url());
  const fresh = await context.newPage();
  await fresh.goto(`${app}/no-such-page`);
  await fresh.waitForSelector('.lost');
  check('404 opened directly: no 返回上一頁', JSON.stringify(await fresh.locator('.lost-links a:visible').allTextContents()) === JSON.stringify(['回開會頁', '會議紀錄']));
  // The same page reached with a referrer: a page of this site shows 返回上一頁 (control), the sign-in page does not.
  const missing = `${app}/meetings/00000000-0000-0000-0000-000000000000`;
  await fresh.goto(missing, {referer: `${app}/meetings`});
  await fresh.waitForSelector('.lost');
  check('404 with a /meetings referrer: 返回上一頁 (control)', (await fresh.evaluate(() => document.referrer)) === `${app}/meetings`
    && (await fresh.locator('.lost-links a:visible').allTextContents()).includes('返回上一頁'));
  await fresh.goto(missing, {referer: `${app}/login?next=%2Fmeetings`});
  await fresh.waitForSelector('.lost');
  check('404 right after signing in: referrer is the sign-in page', (await fresh.evaluate(() => document.referrer)).startsWith(`${app}/login`));
  check('404 right after signing in: no 返回上一頁', JSON.stringify(await fresh.locator('.lost-links a:visible').allTextContents()) === JSON.stringify(['回開會頁', '會議紀錄']));
  await fresh.close();
  await context.close();

  // --- Avatar menu page links (site-navigation example table). ---
  const NAV = ['會議紀錄', '待辦看板', '成效指標', '團隊管理'];
  const menuLinks = async (token, width, path) => {
    const {context: c, page: p} = await signedIn(token, width);
    await p.goto(`${app}${path}`);
    await p.locator('.account-avatar').click();
    await p.waitForSelector('.account-menu:not([hidden])');
    const links = await p.locator('.account-menu button:visible').allTextContents();
    await c.close();
    return links.filter(text => NAV.includes(text));
  };
  const rows = [
    [500, `/meetings/${meetingId}`, 'admin', ['會議紀錄', '成效指標', '團隊管理']],
    [500, '/actions', 'member', ['會議紀錄', '成效指標']],
    [500, '/metrics', 'admin', ['會議紀錄', '團隊管理']],
    [500, '/', 'admin', ['待辦看板', '成效指標', '團隊管理']],
    [850, '/', 'admin', ['成效指標']],
    [700, '/actions', 'admin', []],
    [1280, '/actions', 'admin', []],
  ];
  for (const [width, path, user, want] of rows) {
    const token = user === 'admin' ? process.env.YUQIAO_SESSION : process.env.YUQIAO_MEMBER_SESSION;
    const label = `menu ${width}px ${path.startsWith('/meetings/') ? '/meetings/<id>' : path} ${user}`;
    if (!token) { console.log(`skip ${label}: no YUQIAO_MEMBER_SESSION`); continue; }
    const got = await menuLinks(token, width, path);
    // The table lists links as a set; compare regardless of menu order.
    check(label, JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()), got);
  }
} catch (error) {
  check('run finished', false, error.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
