// ui-setup-collapse: the live page's setup folds behind 更多設定 before a session, the sentence breaks only between its
// clauses, 雲端精修 and 精準模式 are compact switches on one row, setup details read in full, and the list pages carry
// no lead paragraph (meeting-setup-layout, visual-tokens). Nothing is started: POST /api/meetings is blocked.
// Usage: YUQIAO_SESSION=… node bench/ui_setup_collapse_e2e.mjs [app url]   (UI_SC_SHOTS=<folder> also saves screenshots)
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const shots = process.env.UI_SC_SHOTS || '';
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});

async function open(path, {width = 1440, height = 900, storage = {}} = {}) {
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width, height}});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.addInitScript(storage => { try { for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); } catch {} }, storage);
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(app + path);
  await page.waitForTimeout(1500);
  return {context, page, errors};
}
const shown = (page, sel) => page.evaluate(sel => { const el = document.querySelector(sel); return !!el && el.checkVisibility(); }, sel);

// The setup folds behind 更多設定 before a session.
{
  const {context, page, errors} = await open('/');
  const first = await page.evaluate(() => ({
    expanded: document.getElementById('setupMore')?.getAttribute('aria-expanded') ?? null,
    folded: document.querySelector('section.controls').classList.contains('setup-folded'),
    visible: ['#modeMeeting', '#setupMore', '#start', '#team', '#language', '#testMic'].map(s => { const el = document.querySelector(s); return !!el && el.checkVisibility(); }),
    heads: [...document.querySelectorAll('.transcript-card .card-head')].map(h => h.getBoundingClientRect().bottom <= innerHeight),
  }));
  t('1440 first visit: folded, only modes, 更多設定 and start', first, {expanded: 'false', folded: true, visible: [true, true, true, false, false, false], heads: [true, true]});
  if (shots) await page.screenshot({path: join(shots, 'folded-1440.png')});
  await page.click('#setupMore').catch(() => {});
  await page.reload(); await page.waitForTimeout(1500);
  t('1440: unfolded and remembered after a reload', await page.evaluate(() => [document.getElementById('setupMore')?.getAttribute('aria-expanded'), ...['#team', '#language', '#testMic'].map(s => document.querySelector(s).checkVisibility())]), ['true', true, true, true]);
  await page.click('#setupMore').catch(() => {});
  t('1440: pressing again folds', await page.evaluate(() => [document.getElementById('setupMore')?.getAttribute('aria-expanded'), document.getElementById('team').checkVisibility()]), ['false', false]);
  // A sentence word while folded unfolds, then focuses its control.
  // ui-sentence-menus: a sentence word opens its own menu and leaves the setup folded.
  await page.locator('#setupSentence button.sentence-pick[data-field="team"]').click().catch(() => {}); await page.waitForTimeout(150);
  t('1440 folded: pressing the team word opens its menu, the setup stays folded', await page.evaluate(() => [document.getElementById('setupMore')?.getAttribute('aria-expanded'), document.getElementById('sentenceMenu')?.dataset.field ?? null]), ['false', 'team']);
  await page.keyboard.press('Escape');
  await page.click('#setupMore');
  await page.click('#testMic'); await page.waitForTimeout(800);
  await page.click('#setupMore');
  t('1440: folding stops a running audio test', await page.evaluate(() => document.getElementById('testMic').classList.contains('testing')), false);
  t('1440: no page error', errors, []);
  await context.close();
}
{
  const {context, page} = await open('/', {storage: {setupMoreOpen: 'x'}});
  t('1440: an unknown stored value starts folded', await page.evaluate(() => document.getElementById('setupMore')?.getAttribute('aria-expanded')), 'false');
  await context.close();
}

// The sentence breaks only between its clauses.
{
  const {context, page} = await open('/');
  await page.evaluate(() => { const el = document.getElementById('team'); const o = el.options[0]; if (o) { o.textContent = '智慧應用部跨國客戶服務暨品質管理推動小組'; el.value = o.value; el.dispatchEvent(new Event('change')); } });
  const r = await page.evaluate(() => {
    const clauses = [...document.querySelectorAll('#setupSentence .sentence-clause')];
    const lh = parseFloat(getComputedStyle(document.getElementById('setupSentence')).lineHeight);
    return {count: clauses.length, oneLine: clauses.every(c => c.getBoundingClientRect().height < lh * 1.5), commas: clauses.slice(0, -1).every(c => c.textContent.endsWith('，')), scroll: document.documentElement.scrollWidth > innerWidth};
  });
  t('long team name: clauses each on one line, ending with 「，」, no horizontal scroll', [r.count >= 3, r.oneLine, r.commas, r.scroll], [true, true, true, false]);
  // 說[中文]，[只記錄原文]: a 「，」 between two setting words still closes its clause.
  await page.evaluate(() => { for (const [id, v] of [['language', 'zh'], ['targetLanguage', 'none']]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); } });
  t('只記錄原文 is a clause of its own', await page.evaluate(() => [...document.querySelectorAll('#setupSentence .sentence-clause')].map(c => c.textContent).slice(0, 2)), ['說中文，', '只記錄原文，']);
  if (shots) await page.screenshot({path: join(shots, 'long-team-1440.png'), clip: {x: 0, y: 0, width: 1440, height: 320}});
  await context.close();
}

// Advanced options are compact switches; setup details read in full.
{
  const {context, page} = await open('/', {storage: {setupMoreOpen: '1', setupAdvancedOpen: '1'}});
  await page.evaluate(() => { const l = document.getElementById('language'); l.value = 'zh_ja'; l.dispatchEvent(new Event('change')); setMicStatus('請先按「測試音源」並允許麥克風'); });
  const sw = await page.evaluate(() => ['cloudRefineRow', 'qualityRow'].map(id => { const el = document.getElementById(id); if (el.hidden) return null; const r = el.getBoundingClientRect(); return {top: Math.round(r.top), h: Math.round(r.height)}; }));
  const both = sw.filter(Boolean);
  t('advanced: both switches share a row and are 36px high', both.length === 2 && both.every(s => s.h === 36 && s.top === both[0].top), true);
  const d = await page.evaluate(() => {
    const tags = [...document.querySelectorAll('#swap .lang-tag')].map(x => Math.round(x.getBoundingClientRect().top));
    const st = document.getElementById('micStatus');
    const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map(q => Math.round(q.top))).size; };
    const dots = [...document.querySelectorAll('.language-dot')].filter(x => x.checkVisibility()).map(x => lines(x) === 1);
    return {privacy: [getComputedStyle(document.querySelector('.privacy')).fontSize, getComputedStyle(document.getElementById('privacyNote')).fontSize].join(), tagsRow: tags.length === 2 && tags[0] === tags[1], status: st.scrollWidth <= st.clientWidth + 1, dots};
  });
  t('1440 details: 13px data destination, swap on one line, full status, one-line language marks', d, {privacy: '13px,13px', tagsRow: true, status: true, dots: [true, true]});
  if (shots) await page.screenshot({path: join(shots, 'unfolded-1440.png'), fullPage: true});
  await context.close();
}
{
  const {context, page} = await open('/', {width: 390, height: 844});
  await page.evaluate(() => { const l = document.getElementById('language'); l.value = 'zh_ja'; l.dispatchEvent(new Event('change')); });
  const m = await page.evaluate(() => { const dot = document.querySelector('.translation-card .language-dot'); const r = document.createRange(); r.selectNodeContents(dot); return {more: document.getElementById('setupMore')?.checkVisibility() ?? false, text: dot.textContent, lines: new Set([...r.getClientRects()].map(q => Math.round(q.top))).size}; });
  t('390: no 更多設定, 中⇄日 on one line', [m.more, m.text, m.lines], [false, '中⇄日', 1]);
  t('390: start button in the bottom slot', await page.evaluate(() => !!document.getElementById('start').closest('#mobileActionSlot')), true);
  t('390: the language row stays, team and audio source in the settings dialog', await page.evaluate(() => [document.getElementById('language').checkVisibility(), document.getElementById('targetLanguage').checkVisibility(), !!document.getElementById('team').closest('#mobileSettingsFields'), !!document.getElementById('audioSource').closest('#mobileSettingsFields')]), [true, true, true, true]);
  await context.close();
}

// List pages carry no lead paragraph.
for (const [path, want] of [['/meetings', false], ['/interpret', false], ['/admin', true]]) {
  const {context, page} = await open(path);
  t(`${path}: lead paragraph ${want ? 'kept' : 'gone'}`, await shown(page, 'p.lead'), want);
  await context.close();
}
await browser.close();
