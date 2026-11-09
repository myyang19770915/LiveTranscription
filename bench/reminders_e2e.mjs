// End-to-end check of due-date reminders (action-reminders) against the dev-mail mailbox (Mailpit): bob owns items
// that are overdue, due today, due in 2 days and due in 5 days; `python -m reminders run` sends him one digest with the
// first three, a second run the same day sends nothing, the board's Email 提醒 field lets bob (the owner) switch an
// item off and only shows the state to alice, and a muted item is left out of the next digest. Screenshots in both themes.
// Needs: dev-mail running and the app with SMTP_HOST=dev-mail (README「待辦追蹤」).
// Everything it creates (a team and its items, bob's address, the mails, its sessions) is removed afterwards.
// Usage: node bench/reminders_e2e.mjs <screenshot dir> [app url] [mailbox url]
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [out, app = 'http://localhost:18082', mailbox = 'http://localhost:18025'] = process.argv.slice(2);
if (!out) { console.error('Usage: node bench/reminders_e2e.mjs <dir> [app url] [mailbox url]'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
const env = {...process.env, MSYS_NO_PATHCONV: '1'};
const docker = args => execFileSync('docker', args, {env, encoding: 'utf8'}).trim();
const sql = statement => docker(['exec', 'asr_confucius4-r2t2-db-1', 'psql', '-U', 'yuqiao', '-d', 'yuqiao', '-tAc', statement]);
const inApp = (...args) => docker(['exec', '-w', '/app', 'asr_confucius4-r2t2-app-1', 'python', '-m', ...args]);
const issue = user => inApp('auth', 'issue-session', user, '--hours', '1');
function client(token) {
  return async (method, path, body) => {
    const response = await fetch(app + path, {method, headers: {cookie: `yq_session=${token}`, ...(body ? {'content-type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined});
    return {status: response.status, body: await response.json().catch(() => ({}))};
  };
}
const mails = async () => (await (await fetch(`${mailbox}/api/v1/messages?limit=100`)).json()).messages;
const seen = new Set((await mails()).map(m => m.ID));
const ours = async () => (await mails()).filter(m => !seen.has(m.ID));
const toBob = async () => (await ours()).filter(m => m.To.some(t => t.Address === 'bob@yuqiao.test'));
const text = async id => (await (await fetch(`${mailbox}/api/v1/message/${id}`)).json()).Text;
const runReminders = () => JSON.parse(inApp('reminders', 'run').split('\n').pop().replace(/'/g, '"'));

const tokens = {myyang: issue('myyang'), bob: issue('bob'), alice: issue('alice')};
const admin = client(tokens.myyang), bob = client(tokens.bob);
let teamId = null, bobHadEmail = null;
const browser = await chromium.launch();
try {
  bobHadEmail = (await bob('GET', '/api/me')).body.email;
  if (!bobHadEmail) await bob('PUT', '/api/me/email', {email: 'bob@yuqiao.test'});
  const bobEmail = (await bob('GET', '/api/me')).body.email;
  teamId = (await admin('POST', '/api/admin/teams', {name: `e2e 提醒 ${Date.now()}`})).body.id;
  for (const username of ['alice', 'bob']) await admin('POST', `/api/admin/teams/${teamId}/members`, {username});
  const today = (await bob('GET', '/api/actions')).body.today;
  const shift = days => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const create = async (content, days) => (await bob('POST', '/api/actions', {teamId, content, owner: 'bob', dueDate: shift(days)})).body.id;
  const overdue = await create('e2e 逾期的報價單', -2);
  await create('e2e 今天要交的簡報', 0);
  await create('e2e 兩天後的合約', 2);
  await create('e2e 五天後的訓練', 5);

  const first = runReminders();
  let list = await toBob();
  check('the reminders run reaches bob', bobEmail === 'bob@yuqiao.test' && first.failed === 0 && list.length === 1, {first, mails: list.length});
  const body = list.length ? await text(list[0].ID) : '';
  check('one digest: overdue, due today, due soon', list[0]?.Subject === '[語橋 Live] 待辦提醒：逾期 1 件、今天到期 1 件、3 天內到期 1 件', list[0]?.Subject);
  check('the digest lists the three items with links and leaves out the far one',
    ['e2e 逾期的報價單', '逾期 2 天', 'e2e 今天要交的簡報', 'e2e 兩天後的合約', '還有 2 天', `/actions?item=${overdue}`].every(t => body.includes(t)) && !body.includes('e2e 五天後的訓練'));
  runReminders();
  check('a second run the same day sends nothing', (await toBob()).length === 1);

  // The board: bob (owner) switches the overdue item off; alice only sees the state.
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({viewport: {width: 1280, height: 860}});
    await context.addCookies([{name: 'yq_session', value: tokens.bob, url: app}]);
    await context.addInitScript(t => localStorage.setItem('interpreter-theme', t), theme);
    const page = await context.newPage();
    page.on('pageerror', e => check('no page errors', false, e.message));
    await page.goto(`${app}/actions?item=${overdue}`);
    await page.waitForSelector('.remind-state');
    if (theme === 'light') {
      check('the owner sees reminders on with a switch', await page.textContent('.remind-state') === '開啟' && await page.getAttribute('.remind-switch', 'aria-checked') === 'true');
      await page.click('.remind-switch');
      await page.waitForFunction(() => document.querySelector('.remind-state')?.textContent === '已關閉');
      check('switched off: the card shows the muted mark', await page.isVisible(`#action-${overdue} .issue-muted`) && await page.getAttribute('.remind-switch', 'aria-checked') === 'false');
      check('the keyboard focus stays on the switch', await page.evaluate(() => document.activeElement?.classList.contains('remind-switch')));
      // Offline: the switch comes back usable with 切換失敗, and nothing changes.
      await page.route('**/remind', route => route.abort());
      await page.click('.remind-switch');
      await page.waitForFunction(() => document.getElementById('detailError')?.textContent === '切換失敗');
      check('offline: the switch is usable again and says 切換失敗', !(await page.isDisabled('.remind-switch')) && await page.getAttribute('.remind-switch', 'aria-checked') === 'false');
      await page.unroute('**/remind');
    }
    await page.screenshot({path: join(out, `reminders-${theme}.png`)});
    await context.close();
  }
  {
    const context = await browser.newContext({viewport: {width: 1280, height: 860}});
    await context.addCookies([{name: 'yq_session', value: tokens.alice, url: app}]);
    const page = await context.newPage();
    await page.goto(`${app}/actions?item=${overdue}`);
    await page.waitForSelector('.remind-state');
    check('another member sees the state without a switch', await page.textContent('.remind-state') === '已關閉' && !(await page.isVisible('.remind-switch'))
      && /只有負責人或系統管理員可切換/.test(await page.textContent('.remind-row + .field-hint')));
    await context.close();
  }

  // The muted item is left out once the day's reminders are sent again.
  sql(`DELETE FROM reminder_log WHERE item_id IN (SELECT id FROM minute_items WHERE team_id = ${Number(teamId)})`);
  runReminders();
  list = await toBob();
  const latest = (await toBob()).map(m => m.Subject);
  check('a muted item is not reminded', list.length === 2 && latest.includes('[語橋 Live] 待辦提醒：今天到期 1 件、3 天內到期 1 件'), latest);
} finally {
  await browser.close();
  const ids = (await ours().catch(() => [])).filter(m => m.To.some(t => t.Address === 'bob@yuqiao.test')).map(m => m.ID);
  if (ids.length) await fetch(`${mailbox}/api/v1/messages`, {method: 'DELETE', headers: {'content-type': 'application/json'}, body: JSON.stringify({IDs: ids})});
  try {
    if (teamId) sql(`DELETE FROM teams WHERE id = ${Number(teamId)}`);
    if (!bobHadEmail) sql(`UPDATE users SET email = NULL, email_source = NULL WHERE username = 'bob' AND email_source = 'self'`);
    for (const token of Object.values(tokens)) await fetch(`${app}/api/logout`, {method: 'POST', headers: {cookie: `yq_session=${token}`}});
  } catch (error) { console.log(`note: clean up by hand (${error.message})`); }
}
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
