// page-switching in a real browser (Playwright, gstack's install), with a 100 ms network delay. Read-only: sign-out
// and the expired session are answered by the test, so the session passed in stays valid.
//   - the header is drawn without waiting for the server (first rendering has the links, current one marked)
//   - a page's data does not wait for the account (/api/metrics before /api/me answers; /api/config once on the live page)
//   - the next page is prepared while the pointer rests on its link (Edge requests it with Sec-Purpose prerender)
//   - prints the time from a click to the header links and to the last request, for each page
// Usage: YUQIAO_SESSION=<administrator's session> node bench/page_switching_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const LATENCY = +(process.env.LATENCY || 100);
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};

async function tab() {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
  // Whether the header links exist when the document is parsed, i.e. in the first rendering.
  await context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    window.__headerAtParse = document.querySelector('#account > a.current')?.dataset.nav || null;
  }));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: LATENCY, downloadThroughput: 2.5e6, uploadThroughput: 1e6});
  return {page, context};
}
const settle = page => page.waitForLoadState('networkidle');
const ORDER = ['/meetings', '/interpret', '/actions', '/metrics', '/search', '/admin', '/'];
const KEY = {'/meetings': 'meetings', '/interpret': 'interpret', '/actions': 'actions', '/metrics': 'metrics', '/search': 'search', '/admin': 'admin', '/': 'live'};

// --- The header is drawn without waiting for the server; timings
{
  const {page, context} = await tab();
  for (const p of ORDER) { await page.goto(app + p); await settle(page); }   // every page seen once: files cached
  const rows = [], atParse = {};
  for (const p of ORDER) {
    await page.mouse.move(5, 890);   // away from the links: a plain click, nothing prepared
    const t0 = Date.now();
    await page.click(`#account > a[href="${p}"]`, {noWaitAfter: true});
    await page.waitForURL(app + p);
    await page.waitForSelector('#account > a.current');
    const header = Date.now() - t0;
    await settle(page);
    const last = await page.evaluate(() => Math.round(Math.max(...performance.getEntriesByType('resource').map(e => e.responseEnd))));
    atParse[p] = await page.evaluate(() => window.__headerAtParse);
    rows.push(`     ${p.padEnd(11)} header links ${String(header).padStart(4)} ms   last request done ${String(last).padStart(4)} ms`);
  }
  t('the first rendering of every page has the header links, its own marked', Object.entries(atParse).filter(([p, v]) => v !== KEY[p]).map(([k, v]) => `${k}:${v}`), []);
  // The spec's scenario: from 會議紀錄 to 待辦看板.
  await page.click('#account > a[href="/meetings"]'); await settle(page);
  await page.click('#account > a[href="/actions"]'); await page.waitForURL(app + '/actions'); await settle(page);
  t('會議紀錄 → 待辦看板: the first rendering marks 待辦看板', await page.evaluate(() => window.__headerAtParse), 'actions');
  console.log(`     click → (${LATENCY} ms network delay; "done" is when the page's last request was answered)\n` + rows.join('\n'));
  await context.close();
}

// --- A page's data does not wait for the account
{
  const {page, context} = await tab();
  await page.goto(app + '/meetings'); await settle(page);
  const log = [];
  page.on('request', r => log.push(['start', new URL(r.url()).pathname, Date.now()]));
  page.on('response', r => log.push(['answer', new URL(r.url()).pathname, Date.now()]));
  await page.goto(app + '/metrics'); await settle(page);
  const metricsStart = log.find(l => l[0] === 'start' && l[1] === '/api/metrics')?.[2];
  const meAnswer = log.find(l => l[0] === 'answer' && l[1] === '/api/me')?.[2];
  t('成效指標: /api/metrics is requested before /api/me answers', !!metricsStart && !!meAnswer && metricsStart < meAnswer, true);
  for (const [path, data] of [['/actions', '/api/actions'], ['/search', '/api/teams/'], ['/ask', '/api/teams/']]) {
    log.length = 0;
    await page.goto(app + path); await settle(page);
    const start = log.find(l => l[0] === 'start' && l[1].startsWith(data))?.[2];
    const me = log.find(l => l[0] === 'answer' && l[1] === '/api/me')?.[2];
    t(`${path}: ${data}… is requested before /api/me answers`, !!start && !!me && start < me, true);
  }
  log.length = 0;
  await page.goto(app + '/'); await settle(page);
  t('the live page: /api/config and /api/me once each', ['/api/config', '/api/me'].map(u => log.filter(l => l[0] === 'start' && l[1] === u).length), [1, 1]);
  await context.close();
}

// --- The remembered account is forgotten on sign-out and on an expired session
{
  const {page, context} = await tab();
  await page.goto(app + '/meetings'); await settle(page);
  t('the tab remembers the account', await page.evaluate(() => !!JSON.parse(sessionStorage.getItem('yq-me') || 'null')?.username), true);
  await page.route(app + '/api/logout', route => route.fulfill({status: 200, contentType: 'application/json', body: '{}'}));
  await page.route(app + '/login*', route => route.fulfill({status: 200, contentType: 'text/html', body: '<p>login</p>'}));
  await page.click('.account-logout');
  await page.waitForURL(/\/login/);
  t('signing out forgets it', await page.evaluate(() => sessionStorage.getItem('yq-me')), null);
  await page.goBack(); await settle(page);   // remembered again by a valid /api/me
  await page.route(app + '/api/me', route => route.fulfill({status: 401, contentType: 'application/json', body: '{}'}));
  await page.goto(app + '/actions');
  await page.waitForURL(/\/login/);
  t('an expired session forgets it and goes to the sign-in page', await page.evaluate(() => sessionStorage.getItem('yq-me')), null);
  await context.close();
}
{
  const {page, context} = await tab();
  await page.goto(app + '/meetings'); await settle(page);
  await page.evaluate(() => sessionStorage.setItem('yq-me', '{broken'));
  await page.goto(app + '/actions'); await settle(page);
  t('an unreadable remembered account: the header is still drawn', await page.locator('#account > a.current').textContent(), '待辦看板');
  // The server's account differs from the remembered one: the header is redrawn with it.
  await page.route(app + '/api/me', async route => { const r = await route.fetch(); const me = await r.json(); route.fulfill({response: r, json: {...me, displayName: '改過的名字'}}); });
  await page.goto(app + '/metrics'); await settle(page);
  t('a different account from the server redraws the header', await page.textContent('#account .account-name b'), '改過的名字');
  await context.close();
}
{
  // Session storage unavailable: the header is drawn once /api/me answers.
  const {page, context} = await tab();
  await context.addInitScript(() => Object.defineProperty(window, 'sessionStorage', {get() { throw new Error('blocked'); }}));
  await page.goto(app + '/actions'); await settle(page);
  t('session storage unavailable: the header is drawn after /api/me', await page.locator('#account > a.current').textContent(), '待辦看板');
  await context.close();
}

// --- A prepared page fetches its data again when shown. A browser under DevTools never shows a prepared page, so the
// page is told it is being prepared (document.prerendering) and then that it is shown (prerenderingchange).
{
  const {page, context} = await tab();
  await context.addInitScript(() => Object.defineProperty(document, 'prerendering', {configurable: true, get: () => !window.__shown}));
  const wanted = {'/metrics': '/api/metrics', '/actions': '/api/actions', '/meetings': '/api/meetings', '/interpret': '/api/interpret/sessions', '/admin': '/api/admin/teams'};
  const again = {};
  for (const [path, data] of Object.entries(wanted)) {
    await page.goto(app + path); await settle(page);
    let n = 0; const count = r => { if (new URL(r.url()).pathname === data) n++; };
    page.on('request', count);
    await page.evaluate(() => { window.__shown = true; document.dispatchEvent(new Event('prerenderingchange')); });
    await settle(page); page.off('request', count);
    again[path] = n;
  }
  t('a prepared page fetches its data again when shown', again, Object.fromEntries(Object.keys(wanted).map(k => [k, 1])));
  await context.close();
}

// --- The next page is prepared while the pointer rests on its link. A browser driven through DevTools never shows a
// prepared page (PrerenderingDisabledByDevTools), so the test checks that resting on a link starts preparing it: the
// browser requests the page with Sec-Purpose: prefetch;prerender. Playwright's own Chromium does not prepare pages at
// all; Edge (PRERENDER_CHANNEL, default msedge) does.
{
  const channel = process.env.PRERENDER_CHANNEL || 'msedge';
  const edge = await chromium.launch({channel}).catch(() => null);
  if (!edge) console.log(`skip prerender checks: no ${channel}`);
  else {
    const context = await edge.newContext({viewport: {width: 1440, height: 900}});
    await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
    const page = await context.newPage();
    await page.goto(app + '/meetings'); await settle(page);
    t('the prerender rules are added once', await page.locator('script#yq-prerender[type="speculationrules"]').count(), 1);
    const purposes = [];
    context.on('request', r => { purposes.push([new URL(r.url()).pathname, r.headers()['sec-purpose'] || '']); });
    await page.hover('#account > a[href="/metrics"]'); await page.waitForTimeout(1500);
    t('resting on 成效指標 starts preparing it', purposes.some(([u, p]) => u === '/metrics' && p.includes('prerender')), true);
    await page.mouse.move(5, 890); await page.waitForTimeout(300);
    t('the current page is never prepared', purposes.filter(([u]) => u === '/meetings').length, 0);
    await page.click('#account > a[href="/"]'); await page.waitForURL(app + '/');
    await page.waitForFunction(() => /服務|無法連線/.test(document.getElementById('status')?.textContent || ''), null, {timeout: 5000}).catch(() => {});
    t('the live page shows the service status', /服務就緒|服務未啟動|無法連線/.test(await page.textContent('#status')), true);
    await edge.close();
  }
}
await browser.close();
