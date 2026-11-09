// End-to-end check of sending the minutes by e-mail (minutes-mail) against the dev-mail mailbox (Mailpit), in a real
// browser: alice's address comes from the dev LDAP (read-only in 我的 Email), bob enters his own, the team turns on
// auto send, finalizing sends once, 再寄一次 sends again, the team address target, only confirmed items in the mail and
// meeting text escaped in its HTML part. Screenshots of the sending block in both themes and on a phone.
// Needs: dev-ldap and dev-mail running and the app with SMTP_HOST=dev-mail (README「定稿與寄送紀要」).
// Everything it creates (a team, a meeting, bob's address, the mails, its sessions) is removed afterwards.
// Usage: node bench/mail_e2e.mjs <screenshot dir> [app url] [mailbox url]
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [out, app = 'http://localhost:18082', mailbox = 'http://localhost:18025'] = process.argv.slice(2);
if (!out) { console.error('Usage: node bench/mail_e2e.mjs <dir> [app url] [mailbox url]'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
const env = {...process.env, MSYS_NO_PATHCONV: '1'};
const docker = args => execFileSync('docker', args, {env, encoding: 'utf8'}).trim();
const sql = statement => docker(['exec', 'asr_confucius4-r2t2-db-1', 'psql', '-U', 'yuqiao', '-d', 'yuqiao', '-tAc', statement]);
// The dev directory's test password, read from its LDIF rather than repeated here.
const devPassword = user => new RegExp(`^dn: uid=${user},[^]*?^userPassword: (.+)$`, 'm').exec(readFileSync(new URL('../docker/dev-ldap/users.ldif', import.meta.url), 'utf8'))?.[1].trim();
const issue = user => docker(['exec', '-w', '/app', 'asr_confucius4-r2t2-app-1', 'python', '-m', 'auth', 'issue-session', user, '--hours', '1']);

// An API client holding one session cookie.
function client(token) {
  return async (method, path, body) => {
    const response = await fetch(app + path, {method, headers: {cookie: `yq_session=${token}`, ...(body ? {'content-type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined});
    const result = await response.json().catch(() => ({}));
    return {status: response.status, body: result};
  };
}
const mails = async () => (await (await fetch(`${mailbox}/api/v1/messages?limit=50`)).json()).messages;
const mailBody = async id => (await fetch(`${mailbox}/api/v1/message/${id}`)).json();
const waitMails = async count => { for (let i = 0; i < 40; i++) { const list = await mails(); if (list.length >= count) return list; await new Promise(r => setTimeout(r, 250)); } return mails(); };

const stamp = Date.now();
const admin = client(issue('myyang'));
const bobToken = issue('bob');
const bob = client(bobToken);
let teamId = null, meetingId = null, aliceToken = null;
const seen = new Set((await mails()).map(m => m.ID));   // mails already in the box stay untouched
const ours = async () => (await mails()).filter(m => !seen.has(m.ID));
const browser = await chromium.launch();
try {
  // alice signs in through the dev LDAP, which carries her address.
  const login = await fetch(`${app}/api/login`, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({username: 'alice', password: devPassword('alice')})});
  aliceToken = /yq_session=([^;]+)/.exec(login.headers.get('set-cookie') || '')?.[1];
  check('alice signs in through the dev LDAP', login.status === 200 && !!aliceToken, login.status);
  const alice = client(aliceToken);
  const me = (await alice('GET', '/api/me')).body;
  check('alice\'s address comes from LDAP', me.email === 'alice@yuqiao.test' && me.emailSource === 'ldap', me);

  teamId = (await admin('POST', '/api/admin/teams', {name: `e2e 寄送 ${stamp}`})).body.id;
  for (const username of ['alice', 'bob']) await admin('POST', `/api/admin/teams/${teamId}/members`, {username});
  meetingId = (await alice('POST', '/api/meetings', {team_id: teamId, language: 'zh', title: `寄送測試 ${stamp}`})).body.id;
  const add = (kind, content, extra = {}) => alice('POST', `/api/meetings/${meetingId}/minutes/items`, {kind, content, ...extra});
  await add('decision', '採用新報價');
  await add('action', '整理交期', {owner: 'bob', dueDate: '2026-11-20'});
  await add('risk', '<b>報價</b> & 交期');
  sql(`INSERT INTO minute_items (meeting_id, kind, content, origin, state) VALUES ('${meetingId}', 'action', '還沒確認的待辦', 'ai', 'proposed')`);

  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 400]) {
      const context = await browser.newContext({viewport: {width, height: 900}});
      await context.addCookies([{name: 'yq_session', value: aliceToken, url: app}]);
      await context.addInitScript(t => localStorage.setItem('interpreter-theme', t), theme);
      const page = await context.newPage();
      page.on('pageerror', e => check('no page errors', false, e.message));
      await page.goto(`${app}/meetings/${meetingId}/minutes`);
      await page.waitForSelector('#mailInfo .mail-line');
      const tag = `${theme} ${width}px`;
      if (theme === 'light' && width === 1280) {
        const state = await page.evaluate(() => ({final: document.getElementById('finalState').textContent, info: document.getElementById('mailInfo').textContent,
          send: document.getElementById('sendMail').textContent, sendEnabled: !document.getElementById('sendMail').disabled}));
        check('not finalized yet; one member reachable, bob has no address', state.final === '尚未定稿' && /寄給 1 位成員/.test(state.info) && /沒有 Email：(陳柏|bob)/.test(state.info) && state.sendEnabled, state);

        // 我的 Email: alice's is read-only.
        await page.click('.account-avatar'); await page.click('text=我的 Email');
        const dialog = await page.evaluate(() => ({value: document.querySelector('.email-dialog .email-value')?.textContent, input: !!document.querySelector('.email-dialog input')}));
        check('我的 Email shows the directory address read-only', dialog.value === 'alice@yuqiao.test' && !dialog.input, dialog);
        await page.screenshot({path: join(out, 'mail-email-ldap.png')});
        await page.keyboard.press('Escape');

        // Team settings: auto send on.
        await page.click('#mailSettingsToggle');
        await page.check('#mailAuto');
        await page.click('#mailSettings button[type=submit]');
        await page.waitForFunction(() => /寄送設定已儲存/.test(document.getElementById('mailInfo').textContent));
        check('auto send saved', /定稿後自動寄送/.test(await page.textContent('#mailInfo')));
      }
      await page.screenshot({path: join(out, `mail-${theme}-${width}.png`), fullPage: width === 400});
      check(`${tag}: no horizontal scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await context.close();
    }
  }

  // bob enters his own address in 我的 Email.
  {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    await context.addCookies([{name: 'yq_session', value: bobToken, url: app}]);
    const page = await context.newPage();
    await page.goto(`${app}/actions`);
    await page.click('.account-avatar'); await page.click('text=我的 Email');
    await page.fill('.email-dialog input', 'bob@corp');
    await page.click('.email-dialog .email-save');
    await page.waitForSelector('.email-dialog .email-error:not([hidden])');
    check('a malformed address is refused in the dialog', await page.textContent('.email-dialog .email-error') === 'Email 格式不正確');
    await page.fill('.email-dialog input', 'bob@yuqiao.test');
    await page.screenshot({path: join(out, 'mail-email-self.png')});
    await page.click('.email-dialog .email-save');
    await page.waitForSelector('.email-dialog', {state: 'detached'});
    const me = (await bob('GET', '/api/me')).body;
    check('bob\'s own address is stored', me.email === 'bob@yuqiao.test' && me.emailSource === 'self', me);
    await context.close();
  }

  // Finalize (auto send), then 再寄一次.
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addCookies([{name: 'yq_session', value: aliceToken, url: app}]);
  const page = await context.newPage();
  await page.goto(`${app}/meetings/${meetingId}/minutes`);
  await page.waitForSelector('#mailInfo .mail-line');
  await page.click('#finalize');
  await page.waitForFunction(() => /^已定稿/.test(document.getElementById('finalState').textContent));
  let list = await (async () => { for (let i = 0; i < 40; i++) { const l = await ours(); if (l.length) return l; await new Promise(r => setTimeout(r, 250)); } return ours(); })();
  const info = await page.textContent('#mailInfo');
  check('finalize sends automatically to alice and bob', list.length === 1 && list[0].To.map(t => t.Address).sort().join() === 'alice@yuqiao.test,bob@yuqiao.test'
    && list[0].Subject === `[語橋 Live] 會議紀要：寄送測試 ${stamp}`, list.map(m => ({to: m.To, subject: m.Subject})));
  check('the page shows the finalize and the automatic send', /已定稿並寄出紀要/.test(info) && /定稿自動寄送/.test(info) && /寄給 2 人/.test(info) && await page.isHidden('#finalize'), info);
  await page.screenshot({path: join(out, 'mail-finalized.png')});
  const body = await mailBody(list[0].ID);
  check('only confirmed items are in the mail', body.Text.includes('採用新報價') && /負責人：(陳柏|bob)/.test(body.Text) && !body.Text.includes('還沒確認的待辦') && !body.HTML.includes('還沒確認的待辦'));
  check('meeting text is escaped in the HTML part', body.HTML.includes('&lt;b&gt;報價&lt;/b&gt; &amp; 交期') && !body.HTML.includes('<b>報價</b>') && body.Text.includes('<b>報價</b> & 交期'));
  check('the mail links to the minutes page', body.Text.includes(`/meetings/${meetingId}/minutes`));

  await page.click('#sendMail');
  await page.waitForFunction(() => /紀要已寄出/.test(document.getElementById('mailInfo').textContent));
  list = await ours();
  check('再寄一次 sends a second mail', list.length === 2 && await page.textContent('#sendMail') === '再寄一次');

  // The team address target.
  await page.click('#mailSettingsToggle');
  await page.check('#mailSettings input[value=team]');
  await page.fill('#mailAddress', 'rd@yuqiao.test');
  await page.click('#mailSettings button[type=submit]');
  await page.waitForFunction(() => /寄到團隊信箱 rd@yuqiao.test/.test(document.getElementById('mailInfo').textContent));
  await page.click('#sendMail');
  await page.waitForFunction(() => /紀要已寄出/.test(document.getElementById('mailInfo').textContent));
  list = await ours();
  const latest = list.find(m => m.To.some(t => t.Address === 'rd@yuqiao.test'));
  check('the team address target sends only to the team address', list.length === 3 && latest && latest.To.length === 1, list.map(m => m.To));
  await context.close();
} finally {
  await browser.close();
  const ids = (await ours().catch(() => [])).map(m => m.ID);
  if (ids.length) await fetch(`${mailbox}/api/v1/messages`, {method: 'DELETE', headers: {'content-type': 'application/json'}, body: JSON.stringify({IDs: ids})});
  try {
    if (meetingId) sql(`DELETE FROM meetings WHERE id = '${meetingId}'`);
    if (teamId) sql(`DELETE FROM teams WHERE id = ${Number(teamId)}`);
    sql(`UPDATE users SET email = NULL, email_source = NULL WHERE username = 'bob' AND email = 'bob@yuqiao.test'`);
    for (const token of [aliceToken, bobToken]) if (token) await fetch(`${app}/api/logout`, {method: 'POST', headers: {cookie: `yq_session=${token}`}});
    await admin('POST', '/api/logout');
  } catch (error) { console.log(`note: clean up by hand (${error.message})`); }
}
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
