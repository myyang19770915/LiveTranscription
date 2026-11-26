// Text sizes and keyboard focus on every page, in a real browser (visual-tokens: "Text is never smaller than 12px",
// "Keyboard focus is always visible"). Each of the 14 pages is opened at 1440 and 390 px wide in the state it opens in:
// every visible piece of text must be at least 12 px, and at least 13 px when its own element is a p, small, label, li,
// button or a; the document must not be wider than the window. At 1440 px the Tab key is then pressed until focus comes
// back to where it started, and at every stop the focused element, its parent or its grandparent must carry an outline
// at least 2 px wide. Nothing is written: every request that is not a GET is refused here.
// Usage: YUQIAO_SESSION=<an administrator's session> node bench/legibility_focus_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
if (!process.env.YUQIAO_SESSION) { console.error('Usage: YUQIAO_SESSION=… node bench/legibility_focus_e2e.mjs [app url]'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const cookie = {name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'};
let failed = 0;
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) failed++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(got)); };

const meetings = await (await fetch(app + '/api/meetings', {headers: {Cookie: `yq_session=${process.env.YUQIAO_SESSION}`}})).json();
const meeting = meetings.slice().sort((a, b) => b.segments - a.segments)[0]?.id;
if (!meeting) { console.error('No meeting to open: the review and minutes pages need one.'); process.exit(2); }
const pages = [['/', '/'], ['/meetings', '/meetings'], ['review', `/meetings/${meeting}`], ['minutes', `/meetings/${meeting}/minutes`], ['/actions', '/actions'],
  ['/search', '/search?q=' + encodeURIComponent('會議')], ['/ask', '/ask'], ['/metrics', '/metrics'], ['/interpret', '/interpret'], ['/admin', '/admin'],
  ['/admin/usage', '/admin/usage'], ['/admin/settings', '/admin/settings'], ['not found', '/no-such-page'], ['/login', '/login']];

// Runs in the page: the visible texts under the floor of their element, as "size selector text".
function small() {
  const sentence = new Set(['P', 'SMALL', 'LABEL', 'LI', 'BUTTON', 'A']), out = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.trim(), e = node.parentElement;
    if (!text || ['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName) || !e.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    const box = e.getBoundingClientRect(), size = parseFloat(getComputedStyle(e).fontSize);
    if (!box.width || !box.height || size >= (sentence.has(e.tagName) ? 13 : 12)) continue;
    out.add(`${size} ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''} "${text.slice(0, 12)}"`);
  }
  return [...out].sort();
}
// Runs in the page: null when the focused element (or the box around it) shows an outline, else a description of it.
function unmarked() {
  const e = document.activeElement;
  if (!e || e === document.body || !e.matches(':focus')) return null;   // not :focus: focus is on a part the browser draws itself (the calendar button of a date field)
  for (let box = e, depth = 0; box && depth < 3; box = box.parentElement, depth++) {
    const style = getComputedStyle(box);
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2) return null;
  }
  return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : e.getAttribute('class') ? '.' + e.getAttribute('class') : ''}`;
}

const browser = await chromium.launch();
for (const width of [1440, 390]) {
  const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 900}});
  for (const [name, path] of pages) {
    if (path === '/login') await context.clearCookies(); else await context.addCookies([cookie]);
    const page = await context.newPage();
    await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto(app + path); await page.waitForTimeout(1300);
    t(`${name} at ${width}: no text under its floor`, await page.evaluate(small), []);
    t(`${name} at ${width}: not wider than the window`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (width === 1440) {
      const missing = new Set(); let stops = 0, first = null;
      for (let i = 0; i < 150; i++) {
        await page.keyboard.press('Tab');
        let [key, miss] = await page.evaluate(check => { const e = document.activeElement; if (e && e !== document.body && !e.dataset.tabStop) e.dataset.tabStop = String(Math.random());
          return [e === document.body ? 'body' : e.dataset.tabStop, new Function('return (' + check + ')()')()]; }, unmarked.toString());
        if (miss) { await page.waitForTimeout(350); miss = await page.evaluate(unmarked); }   // a control with a transition draws its outline a moment later
        if (key === first) break;
        if (key === 'body') { if (first) break; continue; }
        first ??= key; stops++;
        if (miss) missing.add(miss);
      }
      t(`${name}: every Tab stop shows an outline (${stops} stops)`, [...missing].sort(), []);
      t(`${name}: Tab reaches controls`, stops > 0, true);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
