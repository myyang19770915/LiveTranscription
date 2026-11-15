// Capture 9 pages × (1280 dark, 1280 light, 500 dark): screenshot + boxes of visible elements keyed by DOM path.
// Usage: node capture.mjs <out dir> <admin token> <meeting id>
import {mkdirSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [out, token, meetingId] = process.argv.slice(2);
const app = 'http://localhost:18082';
mkdirSync(out, {recursive: true});
const {chromium} = (await import(pathToFileURL(join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
const pages = [['meeting', '/'], ['meetings', '/meetings'], ['review', `/meetings/${meetingId}`], ['actions', '/actions'],
  ['search', '/search?q=%E5%90%88%E7%B4%84'], ['ask', '/ask'], ['metrics', '/metrics'], ['admin', '/admin'], ['login', '/login']];
const variants = [['1280-dark', 1280, 'dark'], ['1280-light', 1280, 'light'], ['500-dark', 500, 'dark']];
const boxes = {}, errors = [];
for (const [name, path] of pages) for (const [variant, width, theme] of variants) {
  const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: 'reduce'});
  if (name !== 'login') await context.addCookies([{name: 'yq_session', value: token, url: `${app}/`}]);
  await context.addInitScript(t => { try { localStorage.setItem('interpreter-theme', t); } catch {} }, theme);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name} ${variant}: ${e.message}`));
  await page.goto(`${app}${path}`, {waitUntil: 'networkidle'});
  await page.waitForTimeout(800);
  await page.screenshot({path: join(out, `${name}-${variant}.png`), fullPage: true});
  boxes[`${name}-${variant}`] = await page.evaluate(() => {
    const path = el => { const parts = []; for (let e = el; e && e !== document.body; e = e.parentElement) parts.unshift(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}:${[...e.parentElement.children].indexOf(e)}`); return parts.join('>'); };
    const result = {};
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      result[path(el)] = [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)];
    }
    return result;
  });
  await context.close();
}
writeFileSync(join(out, 'boxes.json'), JSON.stringify(boxes));
console.log(`captured ${Object.keys(boxes).length} views; page errors: ${errors.length}`); errors.forEach(e => console.log('  ' + e));
await browser.close();
