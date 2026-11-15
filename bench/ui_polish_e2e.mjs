// Browser checks for ui-visual-polish (Playwright, gstack's install). Read-only: no meeting is created (pressing 開始會議
// meets a stand-in /api/meetings answer and a stand-in WebSocket that only records the start message, with a fake
// microphone), no question reaches the language model (the /api/ask and /api/login requests are held and then aborted),
// settings are only changed in throw-away browser contexts.
//   - visual-tokens: the shape/shadow/spacing/type tokens resolve in both themes; no stray border-radius value in webapp/static
//   - meeting-setup-layout: 進階 folds by default on wide windows, remembers being unfolded, sums up the options in use,
//     keeps every setting while folded, and the phone settings dialog is unchanged
//   - phone-mic-and-layout: on phones the setup area is the language row alone (精準模式 moves into the dialog), and an
//     insecure page (http on a hostname, asr.example.test mapped to the app) explains why the microphone is unavailable
//   - loading-feedback: search and Q&A show the loading row only after 200 ms, with placeholder lines only when there
//     were no results; earlier results dim; one spinner style, still under reduced motion
// Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<token> node bench/ui_polish_e2e.mjs <screenshot dir>
//   token from `python -m auth issue-session <username>` in the app container; the server has to offer 辨識引擎 (MAI),
//   雲端精修 and 精準模式. Search results are a stand-in answer, so the checks do not depend on the meetings stored.
//   YUQIAO_APP overrides http://localhost:18082.
import {mkdirSync, readdirSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const [out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
const token = process.env.YUQIAO_SESSION;
if (!token || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/ui_polish_e2e.mjs <dir>'); process.exit(2); }
mkdirSync(out, {recursive: true});
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const appUrl = new URL(app);
const insecure = `http://asr.example.test:${appUrl.port || 80}`;   // not localhost, so the browser treats it as insecure
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--host-resolver-rules=MAP asr.example.test ${appUrl.hostname}`]});
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
// A fresh signed-in context; `storage` is written to localStorage before any page script runs.
const open = async ({width = 1280, storage = {}, reducedMotion = 'no-preference', signedIn = true, init} = {}) => {
  const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion, permissions: signedIn ? ['microphone'] : []});
  if (signedIn) await context.addCookies([{name: 'yq_session', value: token, url: `${app}/`}]);
  await context.addInitScript(entries => { try { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); } catch {} }, storage);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  return {context, page};
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  // --- visual-tokens ---
  const TOKENS = ['--radius-small', '--radius-control', '--radius-card', '--radius-feature', '--radius-frame', '--radius-pill', '--shadow-card',
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--text-page-title', '--text-section', '--text-body', '--text-note'];
  for (const theme of ['dark', 'light']) {
    const {context, page} = await open({storage: {'interpreter-theme': theme}});
    await page.goto(`${app}/meetings`);
    const values = await page.evaluate(names => Object.fromEntries(names.map(n => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])), TOKENS);
    check(`${theme}: every token has a value`, TOKENS.every(n => values[n] !== ''), Object.entries(values).filter(([, v]) => !v).map(([n]) => n));
    check(`${theme}: --shadow-card is none only in the dark theme`, (values['--shadow-card'] === 'none') === (theme === 'dark'), values['--shadow-card']);
    await context.close();
  }
  const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'webapp', 'static');
  const stray = [];
  for (const file of readdirSync(staticDir).filter(f => f.endsWith('.css') && f !== 'tokens.css')) {
    for (const m of readFileSync(join(staticDir, file), 'utf8').matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
      for (const part of m[1].trim().split(/\s+/)) {
        const px = /^(\d+)px(!important)?$/.exec(part);
        if (part.startsWith('var(--radius-') || part.endsWith('%') || ['inherit', '0', '!important'].includes(part) || (px && Number(px[1]) <= 4)) continue;
        stray.push(`${file}: ${part}`);
      }
    }
  }
  check('no border-radius outside the tokens (other than %, inherit, 0, <= 4px)', stray.length === 0, stray);

  // --- meeting-setup-layout ---
  const ADVANCED = ['#asrEngineRow', '#cloudRefineRow', '#qualityRow'];
  const visible = (page, selector) => page.locator(selector).isVisible();
  const loadMeeting = async page => { await page.goto(`${app}/`); await page.waitForFunction(() => !document.getElementById('setupAdvanced').hidden, null, {timeout: 10000}); };
  for (const width of [1280, 850]) {
    const {context, page} = await open({width});
    await loadMeeting(page);
    check(`${width}px first visit: 進階 is folded`, await page.getAttribute('#setupAdvanced', 'aria-expanded') === 'false');
    const shown = await Promise.all(ADVANCED.map(s => visible(page, s)));
    check(`${width}px first visit: 辨識引擎, 雲端精修, 精準模式 hidden`, shown.every(v => !v), shown);
    check(`${width}px first visit: 會議情境 visible`, await visible(page, '#context'));
    if (width === 1280) await page.screenshot({path: join(out, 'meeting-folded-1280.png')});
    await page.click('#setupAdvanced');
    check(`${width}px pressing 進階 unfolds`, await visible(page, '#asrEngineRow') && await page.getAttribute('#setupAdvanced', 'aria-expanded') === 'true');
    await page.reload(); await loadMeeting(page);
    check(`${width}px unfolded is remembered after a reload`, await page.getAttribute('#setupAdvanced', 'aria-expanded') === 'true'
      && (await Promise.all(ADVANCED.map(s => visible(page, s)))).every(Boolean));
    await context.close();
  }
  {
    // localStorage unavailable: folded, no error.
    const {context, page} = await open({init: () => Object.defineProperty(window, 'localStorage', {get() { throw new Error('blocked'); }})});
    await loadMeeting(page);
    check('no storage: 進階 starts folded', await page.getAttribute('#setupAdvanced', 'aria-expanded') === 'false' && !await visible(page, '#asrEngineRow'));
    await context.close();
  }
  const SUMMARY = [['local', '0', '0', '預設'], ['local', '0', '1', '精準模式'], ['mai', '1', '0', '雲端 MAI、雲端精修'], ['hybrid', '0', '1', '混合辨識、精準模式']];
  for (const [asrEngine, cloudRefine, quality, want] of SUMMARY) {
    const {context, page} = await open({storage: {asrEngine, cloudRefine, quality}});
    await loadMeeting(page);
    const folded = await page.evaluate(() => ({summary: document.getElementById('advancedSummary').textContent, visible: getComputedStyle(document.getElementById('advancedSummary')).display !== 'none',
      engine: asrEngine(), refine: cloudRefineOn(), quality: qualityChosen()}));
    check(`summary ${asrEngine}/${cloudRefine}/${quality} reads ${want}`, folded.summary === want && folded.visible, folded.summary);
    await page.click('#setupAdvanced');
    const open_ = await page.evaluate(() => ({engine: asrEngine(), refine: cloudRefineOn(), quality: qualityChosen(), summaryShown: getComputedStyle(document.getElementById('advancedSummary')).display !== 'none'}));
    check(`${asrEngine}/${cloudRefine}/${quality}: folding keeps every setting`, folded.engine === open_.engine && folded.refine === open_.refine && folded.quality === open_.quality
      && folded.engine === asrEngine && folded.quality === (quality === '1'), [folded, open_]);
    check(`${asrEngine}/${cloudRefine}/${quality}: summary hidden while unfolded`, !open_.summaryShown);
    await context.close();
  }
  {
    const {context, page} = await open();
    await loadMeeting(page);
    await page.click('#setupAdvanced');   // unfold, change a setting, fold: the summary follows
    await page.check('#quality');
    await page.click('#setupAdvanced');
    check('summary updates when a setting changes', await page.textContent('#advancedSummary') === '精準模式');
    await context.close();
  }
  {
    // Folding keeps the settings: start a meeting folded with 精準模式 and 雲端 MAI on, and read what it sends.
    const {context, page} = await open({storage: {asrEngine: 'mai', quality: '1', cloudRefine: '0'}});
    await page.route('**/api/meetings', route => route.request().method() === 'POST'
      ? route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({id: '00000000-0000-0000-0000-0000000000e2'})}) : route.continue());
    let started = null;
    await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => { if (started === null && typeof message === 'string') { started = JSON.parse(message); ws.close(); } }));
    await loadMeeting(page);
    check('start check: 進階 folded before starting', await page.getAttribute('#setupAdvanced', 'aria-expanded') === 'false');
    await page.click('#start');
    for (let i = 0; i < 50 && started === null; i++) await sleep(100);
    check('folded: the meeting starts with 精準模式 on and the chosen engine', started?.quality === true && started?.engine === 'mai' && started?.refine === false, started && {quality: started.quality, engine: started.engine, refine: started.refine});
    await context.close();
  }
  {
    const {context, page} = await open({width: 500});
    await page.goto(`${app}/`); await sleep(1500);
    await page.click('#mobileSettingsOpen');
    check('500px: 辨識引擎 and 雲端精修 in the settings dialog without pressing 進階', await visible(page, '#mobileSettings #asrEngineRow') && await visible(page, '#mobileSettings #cloudRefineRow'));
    check('500px: 進階 is not a fold button there', await page.getAttribute('#setupAdvanced', 'aria-expanded') === null && await page.isDisabled('#setupAdvanced'));
    const look = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('setupAdvanced'), '::after'); return {opacity: getComputedStyle(document.getElementById('setupAdvanced')).opacity, chevron: s.content}; });
    check('500px: 進階 looks like a heading (full strength, no chevron)', look.opacity === '1' && (look.chevron === 'none' || look.chevron === 'normal'), look);
    await page.screenshot({path: join(out, 'meeting-dialog-500.png')});
    await context.close();
  }

  // --- phone-mic-and-layout ---
  {
    const {context, page} = await open({width: 390});
    await page.goto(`${app}/`); await sleep(1500);
    await page.click('#mobileSettingsOpen'); await page.click('#modeTranslate'); await page.keyboard.press('Escape');   // on phones the mode buttons are in the dialog
    await sleep(300);
    const grid = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.controls'));
      const w = id => Math.round(document.getElementById(id).closest('.field').getBoundingClientRect().width);
      const top = id => Math.round(document.getElementById(id).closest('.field').getBoundingClientRect().top);
      return {translate: document.querySelector('.controls').classList.contains('translate'), cols: c.gridTemplateColumns.split(' ').length, rows: c.gridTemplateRows.split(' ').length,
        source: w('language'), target: w('targetLanguage'), sameRow: top('language') === top('targetLanguage'), qualityInSetup: !!document.querySelector('.controls #qualityRow')}; });
    check('390px 即時翻譯: setup area is one row of 3 columns (語音語言 ⇄ 翻譯成)', grid.translate && grid.cols === 3 && grid.rows === 1 && grid.sameRow, grid);
    check('390px: 語音語言 and 翻譯成 each at least 120px wide', grid.source >= 120 && grid.target >= 120, [grid.source, grid.target]);
    check('390px: 精準模式 is not in the setup area', !grid.qualityInSetup);
    await page.screenshot({path: join(out, 'meeting-390.png')});
    await page.click('#mobileSettingsOpen');
    const order = await page.evaluate(() => [...document.querySelectorAll('#mobileSettingsFields > :not([hidden])')].map(e => e.id).filter(id => ['asrEngineRow', 'cloudRefineRow', 'qualityRow'].includes(id)));
    check('390px: the dialog shows 辨識引擎, 雲端精修, 精準模式 in that order', JSON.stringify(order) === JSON.stringify(['asrEngineRow', 'cloudRefineRow', 'qualityRow']), order);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width: 1280, height: 900}); await sleep(400);
    check('back at 1280px: 精準模式 returns to the 進階 group', await page.evaluate(() => document.getElementById('qualityRow').parentElement.id) === 'refineGroup');
    await context.close();
  }
  // Starting from the phone dialog sends the same settings as on a wide window.
  {
    const {context, page} = await open({width: 390, storage: {asrEngine: 'mai', quality: '1', cloudRefine: '0'}});
    await page.route('**/api/meetings', route => route.request().method() === 'POST'
      ? route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({id: '00000000-0000-0000-0000-0000000000e3'})}) : route.continue());
    let started = null;
    await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => { if (started === null && typeof message === 'string') { started = JSON.parse(message); ws.close(); } }));
    await page.goto(`${app}/`); await sleep(1500);
    await page.click('#mobileActionSlot #start');
    for (let i = 0; i < 50 && started === null; i++) await sleep(100);
    check('390px: the meeting starts with 精準模式 on and the chosen engine', started?.quality === true && started?.engine === 'mai' && started?.refine === false, started && {quality: started.quality, engine: started.engine, refine: started.refine});
    await context.close();
  }
  const NEED = '需要 https 連線才能使用麥克風';
  // An insecure page: http on a hostname that is not localhost. `base` is where the browser thinks it is; with `proxy`
  // every request is answered from the app, so a hostname on port 80 needs no server of its own.
  const openInsecure = async (base, proxy = false) => {
    const context = await browser.newContext({viewport: {width: 390, height: 844}});
    await context.addCookies([{name: 'yq_session', value: token, url: `${base}/`}]);
    const page = await context.newPage();
    if (proxy) await page.route(`${base}/**`, async route => { const u = new URL(route.request().url()); await route.fulfill({response: await route.fetch({url: `${app}${u.pathname}${u.search}`})}); });
    page.on('pageerror', e => check('no page errors (insecure page)', false, e.message));
    return {context, page};
  };
  const pressTest = async page => { await page.click('#mobileSettingsOpen'); await page.click('#testMic'); await sleep(300);
    const r = {status: await page.textContent('#micStatus'), toast: await page.textContent('#toast')}; await page.keyboard.press('Escape'); return r; };
  {
    // An explicit port (like the LAN's http://IP:18082): that address has no https, so no address is named.
    const {context, page} = await openInsecure(insecure);
    await page.goto(`${insecure}/`); await sleep(1500);
    check('insecure page: the browser treats it as insecure', await page.evaluate(() => !window.isSecureContext));
    check('insecure page: status explains it on load', await page.textContent('#micStatus') === NEED, await page.textContent('#micStatus'));
    const afterTest = await pressTest(page);
    check('insecure page with a port: 測試音源 advises https or localhost without naming an address',
      afterTest.status === NEED && afterTest.toast === `${NEED}，請改用 https 網址，或在這台電腦上以 localhost 開啟`, afterTest);
    await page.click('#start'); await sleep(500);
    const afterStart = {status: await page.textContent('#micStatus'), toast: await page.textContent('#toast'), raw: (await page.content()).includes('undefined is not')};
    check('insecure page: starting gives the same explanation, no raw script error', afterStart.status === NEED && afterStart.toast.startsWith(NEED) && !afterStart.raw, afterStart);
    await page.screenshot({path: join(out, 'insecure-390.png')});
    const source = await page.evaluate(() => ({value: document.getElementById('audioSource').value, sharing: [...document.getElementById('audioSource').options].filter(o => o.value !== 'microphone').map(o => o.disabled)}));
    check('insecure page: sharing a tab or the system is disabled, 音訊來源 stays 麥克風', source.value === 'microphone' && source.sharing.length > 0 && source.sharing.every(Boolean), source);
    await context.close();
  }
  {
    // A plain hostname on port 80, as the public address: the message names this page's https address.
    const base = 'http://asr.example.test';
    const {context, page} = await openInsecure(base, true);
    await page.goto(`${base}/?team=3`); await sleep(1500);
    const r = await pressTest(page);
    check('insecure page on port 80: 測試音源 gives https://asr.example.test/?team=3', r.status === NEED && r.toast === `${NEED}，請改用 https://asr.example.test/?team=3 開啟`, r);
    await context.close();
  }
  {
    // A secure page in a browser without media capture.
    const {context, page} = await open({width: 390, init: () => { delete MediaDevices.prototype.getUserMedia; }});
    await page.goto(`${app}/`); await sleep(1500);
    check('no media capture: status says 此瀏覽器不支援麥克風 on load', await page.textContent('#micStatus') === '此瀏覽器不支援麥克風', await page.textContent('#micStatus'));
    const r = await pressTest(page);
    check('no media capture: 測試音源 explains it', r.status === '此瀏覽器不支援麥克風' && r.toast.startsWith('此瀏覽器不支援麥克風，請改用新版'), r);
    await context.close();
  }
  {
    // A secure page still asks for the microphone (fake device).
    const {context, page} = await open({width: 390});
    await page.goto(`${app}/`); await sleep(1500);
    const r = await pressTest(page);
    check('secure page: 測試音源 connects the microphone as before', /^(已連接：|訊號正常：)/.test(r.status), r);
    await context.close();
  }

  // --- loading-feedback ---
  // fallback(): a delayed request still reaches a stand-in registered earlier (or the network when there is none).
  const delayed = (page, pattern, ms, abort = false) => page.route(pattern, async route => { await sleep(ms); abort ? route.abort() : route.fallback(); });
  // A stand-in /api/search answer with one result for whatever was asked, so no stored meeting is needed.
  const fakeSearch = page => page.route('**/api/search?*', route => { const q = new URL(route.request().url()).searchParams.get('q') || '';
    route.fulfill({json: {query: q, terms: [q], total: 1, truncated: false, groups: [{meetingId: null, title: '', team: '測試', series: '', startedAt: null,
      hits: [{type: 'item', id: 1, kind: 'action', content: `${q} 的待辦`, state: 'confirmed', status: 'open'}]}]}}); });
  // Watches the region for the loading row from now on; resolves to what was seen.
  const watch = (page, region) => page.evaluate(id => new Promise(resolve => {
    const seen = {row: false, lines: 0, verb: '', hidden: null, dimmed: null};
    const look = () => {
      const state = document.querySelector(`#${id} > .loading-state`);
      if (state) Object.assign(seen, {row: true, lines: state.querySelectorAll('.loading-lines i').length, verb: state.textContent, hidden: state.getAttribute('aria-hidden'),
        dimmed: [...document.getElementById(id).children].filter(c => !c.classList.contains('loading-state') && !c.classList.contains('search-empty')).map(c => getComputedStyle(c).opacity)});
    };
    const observer = new MutationObserver(look); observer.observe(document.getElementById(id), {childList: true, subtree: true});
    setTimeout(() => { observer.disconnect(); resolve(seen); }, 1500);
  }), region);
  {
    const {context, page} = await open();
    await fakeSearch(page);
    await page.goto(`${app}/search?q=${encodeURIComponent('合約')}`);
    await page.waitForSelector('#results .card:not(.search-empty)');
    const heightBefore = await page.evaluate(() => document.getElementById('results').offsetHeight);
    await delayed(page, '**/api/search?*', 900);
    const seen = watch(page, 'results');
    await page.fill('#q', '部署'); await page.press('#q', 'Enter');
    await sleep(500);
    const during = await page.evaluate(() => ({height: document.getElementById('results').offsetHeight, clickable: getComputedStyle(document.getElementById('results')).pointerEvents}));
    await page.screenshot({path: join(out, 'search-loading.png')});
    const s = await seen;
    check('slow search with results: loading row with 搜尋中…, hidden from assistive technology', s.row && s.verb.includes('搜尋中…') && s.hidden === 'true', s);
    check('slow search with results: no placeholder lines', s.lines === 0, s.lines);
    check('slow search with results: earlier results dimmed and not clickable', s.dimmed?.length > 0 && s.dimmed.every(o => Number(o) < 1) && during.clickable === 'none', [s.dimmed, during.clickable]);
    check('slow search: region keeps its height (the row floats over the results)', Math.abs(during.height - heightBefore) <= 1, [heightBefore, during.height]);
    await page.waitForFunction(() => !document.querySelector('#results > .loading-state') && document.getElementById('results').getAttribute('aria-busy') === 'false');
    check('loading row gone once the results arrive', true);
    await page.unrouteAll({behavior: 'wait'});
    await fakeSearch(page);
    await delayed(page, '**/api/search?*', 50);
    const fast = watch(page, 'results');
    await page.fill('#q', '合約'); await page.press('#q', 'Enter');
    check('fast search (50 ms): loading row never appears', !(await fast).row);
    await context.close();
  }
  {
    const {context, page} = await open();
    await page.goto(`${app}/ask`);
    await page.waitForSelector('#answer .search-empty');
    await delayed(page, '**/api/ask', 1200, true);   // held, then aborted: nothing reaches the language model
    const seen = watch(page, 'answer');
    await page.fill('#q', '上次的合約結論是什麼？'); await page.press('#q', 'Enter');
    await sleep(500);
    await page.screenshot({path: join(out, 'ask-loading.png')});
    const s = await seen;
    check('first question: loading row with 整理答案中… and three placeholder lines', s.row && s.verb.includes('整理答案中…') && s.lines === 3, s);
    await page.waitForFunction(() => document.getElementById('answer').getAttribute('aria-busy') === 'false', null, {timeout: 5000});
    check('failed question: loading row removed', await page.locator('#answer > .loading-state').count() === 0);
    await context.close();
  }
  {
    const {context, page} = await open({reducedMotion: 'reduce'});
    await fakeSearch(page);
    await page.goto(`${app}/search?q=${encodeURIComponent('合約')}`);
    await page.waitForSelector('#results .card:not(.search-empty)');
    await delayed(page, '**/api/search?*', 900);
    await page.fill('#q', '部署'); await page.press('#q', 'Enter');
    await page.waitForSelector('#results > .loading-state .spinner');
    const r = await page.evaluate(() => ({animations: document.querySelector('#results .spinner').getAnimations().length, text: document.querySelector('#results > .loading-state').textContent}));
    check('reduced motion: spinner does not turn, 搜尋中… still shown', r.animations === 0 && r.text.includes('搜尋中…'), r);
    // The placeholder lines appear on a first question; they must not pulse either.
    await page.goto(`${app}/ask`);
    await page.waitForSelector('#answer .search-empty');
    await delayed(page, '**/api/ask', 1200, true);
    await page.fill('#q', '上次的合約結論是什麼？'); await page.press('#q', 'Enter');
    await page.waitForSelector('#answer > .loading-state .loading-lines i');
    const lines = await page.evaluate(() => [...document.querySelectorAll('#answer .loading-lines i')].map(i => i.getAnimations().length));
    check('reduced motion: placeholder lines do not pulse', lines.length === 3 && lines.every(n => n === 0), lines);
    await context.close();
  }
  {
    const {context, page} = await open({signedIn: false});
    await page.goto(`${app}/login`);
    await delayed(page, '**/api/login', 1500, true);   // held, then aborted: no sign-in is attempted
    await page.fill('#username', 'nobody'); await page.fill('#password', 'x');
    await page.click('#loginButton');
    await sleep(300);
    // offsetWidth: the laid-out size (the bounding box of a turning square is larger).
    const r = await page.evaluate(() => { const s = document.querySelector('#loginButton .spinner');
      return {shared: !!s, visible: !!s?.offsetWidth, size: s ? [s.offsetWidth, s.offsetHeight] : null, label: document.querySelector('.auth-submit-label').textContent}; });
    check('sign-in: shared spinner shown at 16px with 登入中…', r.shared && r.visible && r.size?.[0] === 16 && r.size?.[1] === 16 && r.label === '登入中…', r);
    await context.close();
  }
} catch (error) {
  check('run finished', false, error.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
