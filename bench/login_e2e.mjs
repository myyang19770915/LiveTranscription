// End-to-end check of the sign-in page (login-redesign) in a real browser: both themes at 1440, 1024 and 400 px wide
// (screenshots), the six feature cards, the orbit only on wide screens, revealing the password, the empty-field and
// wrong-password messages, the theme being remembered, and no horizontal scrolling on a phone.
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
    for (const width of [1440, 1024, 400]) {
      const context = await browser.newContext({viewport: {width, height: width === 400 ? 860 : 900}});
      await context.addInitScript(t => { if (!sessionStorage.getItem('set')) { localStorage.setItem('interpreter-theme', t); sessionStorage.setItem('set', '1'); } }, theme);
      const page = await context.newPage();
      page.on('pageerror', e => check('no page errors', false, e.message));
      await page.goto(`${app}/login`);
      await page.waitForLoadState('networkidle');
      const layout = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        cards: [...document.querySelectorAll('.feat b')].map(b => b.textContent),
        cardsShown: [...document.querySelectorAll('.feat')].filter(f => f.offsetParent).length,
        orbit: !!document.querySelector('.auth-orbit')?.getBoundingClientRect().width,
        hub: !!document.querySelector('.auth-hub')?.offsetParent,
        title: document.querySelector('.auth-form h1').textContent,
        scroll: document.documentElement.scrollWidth - window.innerWidth,
        overlap: (() => {   // cards must not cover each other or the hub
          const boxes = [...document.querySelectorAll('.feat, .auth-hub')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect());
          return boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
        })(),
      }));
      const tag = `${theme} ${width}px`;
      check(`${tag}: theme applied`, layout.theme === theme, layout.theme);
      check(`${tag}: the welcome title`, layout.title === '歡迎回到 語橋 Live', layout.title);
      check(`${tag}: no horizontal scrolling`, layout.scroll <= 0, layout.scroll);
      if (width === 1440) {
        check(`${tag}: six feature cards around the hub`, layout.cards.join() === '即時轉錄,即時翻譯,會議紀要,待辦追蹤,搜尋問答,成效指標' && layout.cardsShown === 6 && layout.orbit && layout.hub, layout);
        check(`${tag}: cards do not overlap`, !layout.overlap);
      } else if (width === 1024) {
        check(`${tag}: the cards as a grid without the orbit`, layout.cardsShown === 6 && !layout.orbit && !layout.hub && !layout.overlap, layout);
      } else {
        check(`${tag}: phone shows the form without the cards`, layout.cardsShown === 0, layout);
      }
      await page.screenshot({path: join(out, `login-${theme}-${width}.png`), fullPage: width === 400});

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
        await page.click('#loginButton');
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
} finally {
  await browser.close();
  try {
    execFileSync('docker', ['exec', 'asr_confucius4-r2t2-db-1', 'psql', '-U', 'yuqiao', '-d', 'yuqiao', '-c', `DELETE FROM login_failures WHERE username = '${PROBE_USER}'`], {stdio: 'ignore', env: {...process.env, MSYS_NO_PATHCONV: '1'}});
  } catch { console.log(`note: remove the failure counter of ${PROBE_USER} by hand`); }
}
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
