// End-to-end check of the sign-in page (sign-in-page) in a real browser: both themes at 1440, 900 and 390 px wide
// (screenshots), the description, the preview of the meeting screen (two panes, three lines each, hidden on a phone),
// the heading order, the submit button, revealing the password, the empty-field and wrong-password messages, the theme
// being remembered, no horizontal scrolling, and nothing moving once the page has entered.
// The wrong-password attempt uses a username nobody has; its failure counter is removed afterwards.
// Usage: node bench/login_e2e.mjs <screenshot dir> [app url]
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [out, app = 'http://localhost:18082'] = process.argv.slice(2);
if (!out) { console.error('Usage: node bench/login_e2e.mjs <dir> [app url]'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const PROBE_USER = 'e2e-login-probe';
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };

const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 900, 390]) {
      const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 900}});
      await context.addInitScript(t => { if (!sessionStorage.getItem('set')) { localStorage.setItem('interpreter-theme', t); sessionStorage.setItem('set', '1'); } }, theme);
      const page = await context.newPage();
      page.on('pageerror', e => check('no page errors', false, e.message));
      await page.goto(`${app}/login`);
      await page.waitForLoadState('networkidle');
      const layout = await page.evaluate(() => {
        const size = e => parseFloat(getComputedStyle(e).fontSize), preview = document.querySelector('.auth-preview'), button = document.getElementById('loginButton');
        const inside = (e, box) => { const r = e.getBoundingClientRect(), b = box.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; };
        return {
          theme: document.documentElement.dataset.theme,
          h1: [...document.querySelectorAll('h1')].map(h => h.textContent),
          lead: document.querySelector('.auth-lead').textContent,
          formHeading: [document.querySelector('.auth-form > :first-child').tagName, document.querySelector('.auth-form h2').textContent],
          smaller: size(document.querySelector('.auth-form h2')) < size(document.querySelector('h1')),
          shown: preview.checkVisibility(),
          role: [preview.getAttribute('role'), preview.getAttribute('aria-label')],
          panes: [...preview.querySelectorAll('.preview-pane')].map(p => [p.querySelector('.preview-head b').textContent, p.querySelectorAll('.preview-lines li').length]),
          draft: preview.querySelector('.preview-pane:last-child li:last-child em')?.textContent,
          linesInside: [...preview.querySelectorAll('.preview-lines span')].every(s => inside(s, s.closest('.preview-pane'))),
          text: document.body.innerText,
          old: document.querySelectorAll('.feat, .auth-orbit, .auth-hub, .auth-node, .auth-glow').length,
          button: [button.textContent.trim(), getComputedStyle(button).letterSpacing],
          scroll: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const tag = `${theme} ${width}px`;
      check(`${tag}: theme applied`, layout.theme === theme, layout.theme);
      check(`${tag}: one h1 that says what the product does`, layout.h1.join('|') === '會議中即時顯示逐字稿和翻譯', layout.h1);
      check(`${tag}: the sentence names the three languages`, ['中文', '日文', '英文'].every(w => layout.lead.includes(w)), layout.lead);
      check(`${tag}: the form is headed by a smaller h2 登入`, layout.formHeading.join() === 'H2,登入' && layout.smaller, layout.formHeading);
      check(`${tag}: the button reads 登入 with normal letter spacing`, layout.button[0] === '登入' && ['normal', '0px'].includes(layout.button[1]), layout.button);
      check(`${tag}: no diagram, Cloud or Local`, layout.old === 0 && !/Cloud|Local/.test(layout.text), layout.old);
      check(`${tag}: no horizontal scrolling`, layout.scroll <= 0, layout.scroll);
      if (width === 390) check(`${tag}: a phone has no preview`, !layout.shown);
      else {
        check(`${tag}: the preview shows 原文 and 翻譯 with three lines each`, layout.shown && JSON.stringify(layout.panes) === '[["原文",3],["翻譯",3]]' && layout.draft === '暫譯', layout.panes);
        check(`${tag}: the preview is one named image`, layout.role.join() === 'img,開會畫面示意：左邊是原文，右邊是翻譯', layout.role);
        check(`${tag}: the lines stay inside their panes`, layout.linesInside);
      }
      await page.screenshot({path: join(out, `login-${theme}-${width}.png`), fullPage: width === 390});

      if (theme === 'light' && width === 1440) {
        await page.click('#loginButton');
        check('empty username is reported', await page.textContent('#loginError') === '請輸入帳號' && await page.getAttribute('#username', 'aria-invalid') === 'true');
        await page.fill('#password', 'not-the-password');
        await page.click('#reveal');
        check('the eye button reveals the password', await page.getAttribute('#password', 'type') === 'text' && await page.getAttribute('#reveal', 'aria-label') === '隱藏密碼'
          && await page.$eval('#reveal .eye-on', e => getComputedStyle(e).display !== 'none'));
        await page.click('#reveal');
        check('and hides it again', await page.getAttribute('#password', 'type') === 'password');
        await page.fill('#username', PROBE_USER);
        await page.route('**/api/login', async route => { await new Promise(r => setTimeout(r, 600)); await route.continue(); });
        await page.click('#loginButton');
        check('the button reads 登入中… while the request runs', (await page.textContent('#loginButton')).trim() === '登入中…');
        await page.waitForFunction(() => !document.getElementById('loginError').hidden, null, {timeout: 15000});
        const message = await page.textContent('#loginError');
        check('a wrong password shows the server message', message.length > 0 && message !== '請輸入帳號', message);
        await page.screenshot({path: join(out, 'login-error.png')});
        await page.click('#themeToggle');
        await page.reload(); await page.waitForLoadState('networkidle');
        check('the theme toggle is remembered', await page.evaluate(() => document.documentElement.dataset.theme) === 'dark' && await page.textContent('.auth-theme-label') === '明亮');
      }
      await context.close();
    }
  }
  // Calm: the description and the preview rise once; two seconds after load nothing runs. Reduced motion: nothing ever runs.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion});
    const page = await context.newPage();
    await page.goto(`${app}/login`);
    const running = () => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
    const atLoad = await running();
    await page.waitForTimeout(2000);
    const later = await running();
    const visible = await page.evaluate(() => ['.auth-title', '.auth-lead', '.auth-preview'].every(s => { const e = document.querySelector(s); return e.checkVisibility() && +getComputedStyle(e).opacity === 1; }));
    if (reducedMotion === 'reduce') check('reduced motion: nothing moves and everything is visible', atLoad === 0 && later === 0 && visible, {atLoad, later, visible});
    else check('nothing is still moving two seconds after load', later === 0 && visible, {atLoad, later, visible});
    await context.close();
  }
} finally {
  await browser.close();
  try {
    execFileSync('docker', ['exec', 'asr_confucius4-r2t2-db-1', 'psql', '-U', 'yuqiao', '-d', 'yuqiao', '-c', `DELETE FROM login_failures WHERE username = '${PROBE_USER}'`], {stdio: 'ignore', env: {...process.env, MSYS_NO_PATHCONV: '1'}});
  } catch { console.log(`note: remove the failure counter of ${PROBE_USER} by hand`); }
}
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
