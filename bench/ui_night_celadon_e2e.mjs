// ui-night-celadon: the night (dark) and celadon (light) palettes, no decorative chrome, plain header links, the live
// page's setup sentence and the floating recorder bar (visual-tokens, meeting-setup-layout).
// Two parts: SetupSentence.compose checked in node against the spec's example table, then the pages in Chromium.
// A session is only simulated with setControls(true): no meeting is started, and POST /api/meetings is blocked so the
// database cannot gain a meeting. Team names and microphone labels of the examples are put into the page's own menus.
// Usage: YUQIAO_SESSION=… node bench/ui_night_celadon_e2e.mjs [app url]   (UI_NC_SHOTS=<folder> also saves screenshots)
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const shots = process.env.UI_NC_SHOTS || '';
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const root = join(fileURLToPath(import.meta.url), '../..');

// ---------- Part 1: the sentence, as a pure function ----------
const EXAMPLES = [   // meeting-setup-layout "Settings read as one sentence before a session"
  [{mode: 'meeting', source: 'zh_ja', sourceLabel: '中日雙向自動', target: 'zh_ja', targetLabel: '中文 ⇄ 日文', audio: 'microphone', micLabel: '麥克風 1', team: '7', teamLabel: '智慧應用部'},
    '中文和日文互相翻譯，從麥克風 1 收音，記進智慧應用部的會議紀錄'],
  [{mode: 'meeting', source: 'zh', sourceLabel: '中文', target: 'en', targetLabel: 'English', audio: 'microphone', micLabel: '系統預設麥克風', team: '7', teamLabel: '智慧應用部'},
    '說中文，翻成 English，從系統預設麥克風收音，記進智慧應用部的會議紀錄'],
  [{mode: 'meeting', source: 'zh', sourceLabel: '中文', target: 'none', targetLabel: '不翻譯（只整理原文）', audio: 'microphone', micLabel: '麥克風 1', team: '7', teamLabel: '智慧應用部'},
    '說中文，只記錄原文，從麥克風 1 收音，記進智慧應用部的會議紀錄'],
  [{mode: 'meeting', source: 'zh', sourceLabel: '中文', target: 'en', targetLabel: 'English', audio: 'microphone', micLabel: '麥克風 1', team: '', teamLabel: ''},
    '說中文，翻成 English，從麥克風 1 收音，記進會議紀錄'],
  [{mode: 'translate', source: 'ja', sourceLabel: '日本語', target: 'zh', targetLabel: '繁體中文', audio: 'system', micLabel: '麥克風 1'},
    '說日本語，翻成繁體中文，從分頁／系統聲音收音，存成你的紀錄'],
  [{mode: 'translate', source: 'auto', sourceLabel: '中英自動偵測', target: 'ja', targetLabel: '日本語', audio: 'mixed', micLabel: '麥克風 1'},
    '說中文或英文，翻成日本語，從麥克風 1 和分頁聲音收音，存成你的紀錄'],
  [{mode: 'interpret', source: 'zh', sourceLabel: '中文', target: 'en', targetLabel: 'English', audio: 'microphone', micLabel: '麥克風 1', play: true},
    '說中文，口譯成 English，從麥克風 1 收音，同步播放譯音，存成你的紀錄'],
  [{mode: 'interpret', source: 'zh', sourceLabel: '中文', target: 'en', targetLabel: 'English', audio: 'microphone', micLabel: '麥克風 1', play: false},
    '說中文，口譯成 English，從麥克風 1 收音，不播放譯音，存成你的紀錄'],
];
{
  let SetupSentence = null;
  try { SetupSentence = createRequire(import.meta.url)(join(root, 'webapp/static/setup-sentence.js')); } catch (e) { console.log('FAIL setup-sentence.js loads', e.code || e.message); process.exitCode = 1; }
  if (SetupSentence) {
    EXAMPLES.forEach(([state, want], i) => t(`sentence example ${i + 1}`, SetupSentence.compose(state).map(p => p.text).join(''), want));
    const parts = SetupSentence.compose(EXAMPLES[0][0]);
    t('sentence: 中文和日文 opens 語音語言, the team opens 團隊', [parts.find(p => p.text === '中文和日文')?.field, parts.find(p => p.text === '智慧應用部')?.field], ['language', 'team']);
    t('sentence: no team, no empty button', SetupSentence.compose(EXAMPLES[3][0]).some(p => p.field === 'team'), false);
    const mixed = SetupSentence.compose(EXAMPLES[5][0]);
    t('sentence: mixed audio names the microphone and the source', [mixed.find(p => p.text === '麥克風 1')?.field, mixed.find(p => p.text === '分頁聲音')?.field], ['microphone', 'audioSource']);
    t('sentence: 同步播放譯音 opens its switch', SetupSentence.compose(EXAMPLES[6][0]).find(p => p.text === '同步播放譯音')?.field, 'interpretPlay');
  }
}

// ---------- Part 2: the pages ----------
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
const PALETTE = {   // visual-tokens "Night and celadon palettes"
  '--page': ['#111214', '#f2f5f3'], '--panel': ['#17181b', '#ffffff'], '--field': ['#1f2024', '#ffffff'],
  '--border': ['#2a2b30', '#dce4df'], '--text': ['#ecedef', '#14201b'], '--muted': ['#a3a5ac', '#4b5a53'],
  '--faint': ['#80838c', '#66736d'], '--accent': ['#ecedef', '#2e7a68'], '--accent-ink': ['#111214', '#ffffff'],
  '--live': ['#f2a93b', '#d98a0b'], '--live-text': ['#f2a93b', '#8a5300'], '--danger': ['#f2726b', '#b3261e'],
};
const PAGES = ['/', '/meetings', '/interpret', '/actions', '/metrics', '/search', '/ask', '/admin', '/login'];

async function open(path, {width = 1440, height = 900, signedIn = true, touch = false} = {}) {
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width, height}, hasTouch: touch, isMobile: touch});
  if (signedIn) await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push(r.url()));
  await page.goto(app + path);
  await page.waitForTimeout(1500);
  return {context, page, errors, requests};
}
const theme = (page, name) => page.evaluate(name => { document.documentElement.dataset.theme = name; }, name);
// A colour token as the browser resolves it, to compare with computed colours.
const resolved = (page, token) => page.evaluate(token => { const d = document.createElement('div'); d.style.color = `var(${token})`; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, token);

// Palettes, fonts and chrome on every page, in both themes.
for (const path of PAGES) {
  const {context, page} = await open(path, {signedIn: path !== '/login'});
  for (const [i, name] of ['dark', 'light'].entries()) {
    await theme(page, name);
    const got = await page.evaluate(names => { const s = getComputedStyle(document.documentElement); return Object.fromEntries(names.map(n => [n, s.getPropertyValue(n).trim().toLowerCase()])); }, Object.keys(PALETTE));
    const bad = Object.entries(PALETTE).filter(([n, v]) => got[n] !== v[i]).map(([n]) => `${n}=${got[n]}`);
    t(`${path} ${name}: palette values`, bad, []);
    const chrome = await page.evaluate(() => {
      const shown = el => el.checkVisibility ? el.checkVisibility() : el.offsetWidth > 0;
      const out = [];
      if (document.querySelector('.ambient, .eyebrow')) out.push('ambient/eyebrow element');
      for (const el of document.querySelectorAll('body *')) if (shown(el) && getComputedStyle(el).textTransform === 'uppercase' && el.textContent.trim()) out.push(`uppercase: ${el.tagName}.${el.className}`);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) { const s = n.textContent.trim(); if (/^[A-Z ]+$/.test(s) && s.replace(/ /g, '').length >= 3 && n.parentElement && shown(n.parentElement)) out.push(`caps text: ${s}`); }
      for (const el of document.querySelectorAll('h1, h2, h3, .brand b')) if (shown(el) && Number(getComputedStyle(el).fontWeight) > 600) out.push(`weight ${getComputedStyle(el).fontWeight}: ${el.tagName} ${el.textContent.trim().slice(0, 20)}`);
      return [...new Set(out)];
    });
    t(`${path} ${name}: no decorative chrome`, chrome, []);
  }
  const fonts = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return {ui: s.getPropertyValue('--font-ui').trim(), body: getComputedStyle(document.body).fontFamily}; });
  await theme(page, 'dark');
  const darkUi = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim());
  t(`${path}: --font-ui set, the same in both themes, used by body`, [!!fonts.ui, fonts.ui === darkUi, fonts.body.replace(/\s/g, '') === fonts.ui.replace(/\s/g, '')], [true, true, true]);
  await context.close();
}

// No web font on the live page.
{
  const {context, page, requests} = await open('/');
  const faces = await page.evaluate(() => [...document.styleSheets].reduce((n, sheet) => { try { return n + [...sheet.cssRules].filter(r => r instanceof CSSFontFaceRule).length; } catch { return n; } }, 0));
  t('/: no web font request, no @font-face', [requests.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u)).length, faces], [0, 0]);
  await context.close();
}

// Header links are plain text.
{
  const {context, page} = await open('/meetings');
  const field = await page.evaluate(() => { const d = document.createElement('div'); d.style.background = 'var(--field)'; document.body.append(d); const v = getComputedStyle(d).backgroundColor; d.remove(); return v; });
  const links = await page.evaluate(() => [...document.querySelectorAll('#account > a')].map(a => ({text: a.textContent.trim(), current: a.getAttribute('aria-current'), border: getComputedStyle(a).borderTopWidth, bg: getComputedStyle(a).backgroundColor})));
  t('header: no link has a border', links.filter(l => l.border !== '0px').map(l => l.text), []);
  t('header: links other than the current one are transparent', links.filter(l => !l.current && l.bg !== 'rgba(0, 0, 0, 0)').map(l => l.text), []);
  const here = links.find(l => l.current === 'page');
  t('header: 會議紀錄 is current with the --field background', [here?.text, here?.bg], ['會議紀錄', field]);
  await context.close();
}

// The live page at 1440: the setup sentence.
const pick = (page, id, value, label) => page.evaluate(([id, value, label]) => {
  const el = document.getElementById(id);
  if (label !== undefined && ![...el.options].some(o => o.value === value)) el.append(Object.assign(document.createElement('option'), {value, textContent: label}));
  if (label !== undefined) [...el.options].find(o => o.value === value).textContent = label;
  el.value = value; el.dispatchEvent(new Event('change'));
}, [id, value, label]);
// The examples' team: the account's own team, named 智慧應用部 in the menu (a made-up id would make series.js ask for a team that does not exist).
const pickTeam = page => page.evaluate(() => { const el = document.getElementById('team'); const o = el.options[0]; if (!o) return false; o.textContent = '智慧應用部'; el.value = o.value; el.dispatchEvent(new Event('change')); return true; });
const sentence = page => page.evaluate(() => document.getElementById('setupSentence')?.textContent.trim() ?? null);
const mode = (page, m) => page.evaluate(m => setLiveMode(m), m);
{
  const {context, page, errors} = await open('/');
  const interpretUsable = await page.evaluate(() => !!window.InterpretMode?.usable());
  await pickTeam(page);
  await pick(page, 'microphone', 'mic-1', '麥克風 1');
  const rows = [
    [async () => { await mode(page, 'meeting'); await pick(page, 'language', 'zh_ja'); await pick(page, 'audioSource', 'microphone'); }, 0],
    [async () => { await pick(page, 'language', 'zh'); await pick(page, 'targetLanguage', 'en'); await pick(page, 'microphone', 'default', '系統預設麥克風'); }, 1],
    [async () => { await pick(page, 'microphone', 'mic-1'); await pick(page, 'targetLanguage', 'none'); }, 2],
    [async () => { await pick(page, 'targetLanguage', 'en'); await page.evaluate(() => { const el = document.getElementById('team'); el.hidden = true; el.dispatchEvent(new Event("change")); }); }, 3],
    [async () => { await mode(page, 'translate'); await pick(page, 'language', 'ja'); await pick(page, 'targetLanguage', 'zh'); await pick(page, 'audioSource', 'system'); }, 4],
    [async () => { await pick(page, 'language', 'auto'); await pick(page, 'targetLanguage', 'ja'); await pick(page, 'audioSource', 'mixed'); }, 5],
  ];
  for (const [set, i] of rows) { await set(); t(`/ 1440: sentence of example ${i + 1}`, await sentence(page), EXAMPLES[i][1]); }
  if (interpretUsable) {
    await mode(page, 'interpret'); await pick(page, 'audioSource', 'microphone'); await pick(page, 'language', 'zh'); await pick(page, 'targetLanguage', 'en');
    await page.evaluate(() => { const el = document.getElementById('interpretPlay'); el.checked = true; el.dispatchEvent(new Event('change')); });
    t('/ 1440: sentence of example 7', await sentence(page), EXAMPLES[6][1]);
    await page.evaluate(() => { const el = document.getElementById('interpretPlay'); el.checked = false; el.dispatchEvent(new Event('change')); });
    t('/ 1440: sentence of example 8', await sentence(page), EXAMPLES[7][1]);
  } else console.log('skip /: examples 7–8 on the page (即時口譯 is not available to this account; covered by part 1)');
  t('/ 1440: the data destination stays visible', await page.evaluate(() => document.getElementById('privacyNote')?.checkVisibility() ?? false), true);

  // Sentence words open their setting.
  await mode(page, 'meeting'); await page.evaluate(() => { document.getElementById('team').hidden = false; }); await pickTeam(page); await pick(page, 'audioSource', 'microphone'); await pick(page, 'language', 'zh_ja');
  const teamWord = page.locator('#setupSentence button.sentence-pick', {hasText: '智慧應用部'});
  t('/ 1440: the team word is a button named for its setting', await teamWord.getAttribute('aria-label').catch(() => null), '更改團隊');
  await teamWord.click().catch(() => {}); await page.keyboard.press('Escape');
  t('/ 1440: pressing the team focuses #team', await page.evaluate(() => document.activeElement?.id), 'team');
  await page.locator('#setupSentence button.sentence-pick', {hasText: '中文和日文'}).click().catch(() => {}); await page.keyboard.press('Escape');
  t('/ 1440: pressing 中文和日文 focuses #language', await page.evaluate(() => document.activeElement?.id), 'language');
  t('/ 1440: no console error', errors, []);
  if (shots) await page.screenshot({path: join(shots, 'live-idle-1440.png'), fullPage: true});

  // A simulated session folds the settings into the floating recorder bar; the end button reads as in a real session and
  // keeps the keyboard focus it had as the start button.
  await page.focus('#start');
  await page.evaluate(() => { const b = document.getElementById('start'); b.classList.add('stop'); b.querySelector('b').textContent = '結束會議'; setControls(true); }); await page.waitForTimeout(400);
  t('/ 1440 live: the moved end button keeps the focus and reads 結束會議', await page.evaluate(() => [document.activeElement?.id, document.querySelector('#liveBar #start b')?.textContent]), ['start', '結束會議']);
  const live = await page.evaluate(() => ({
    controls: document.querySelector('section.controls').checkVisibility(),
    inBar: !!document.getElementById('start').closest('#liveBar'),
    position: getComputedStyle(document.getElementById('liveBar')).position,
    cls: document.body.classList.contains('live-session'),
    buttons: document.querySelectorAll('#setupSentence button').length,
  }));
  t('/ 1440 live: controls hidden, #start in the fixed bar, body.live-session, sentence without buttons', live, {controls: false, inBar: true, position: 'fixed', cls: true, buttons: 0});
  t('/ 1440 live: #level uses --live', await page.evaluate(() => getComputedStyle(document.getElementById('level')).backgroundColor), await resolved(page, '--live'));
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(200);
  const covered = await page.evaluate(() => {
    const top = document.getElementById('liveBar').getBoundingClientRect().top;
    const items = [...document.querySelectorAll('.transcript-card'), ...document.querySelectorAll('footer .footer-actions button')].filter(el => el.checkVisibility());
    return items.filter(el => el.getBoundingClientRect().bottom > top).map(el => el.id || el.className);
  });
  t('/ 1440 live: cards and footer buttons end above the bar', covered, []);
  const gap = await page.evaluate(() => { const s = document.getElementById('start').getBoundingClientRect(), timer = document.getElementById('timer').getBoundingClientRect(); return s.left - timer.right; });
  t('/ 1440 live: 16px or more between the timer and the end button', gap >= 16, true);
  if (shots) await page.screenshot({path: join(shots, 'live-session-1440.png')});
  await page.evaluate(() => { const b = document.getElementById('start'); b.querySelector('b').textContent = '結束中…'; b.disabled = true; });
  t('/ 1440 live: the bar stays while 結束中…', await page.evaluate(() => document.getElementById('liveBar').checkVisibility() && !!document.getElementById('start').closest('#liveBar')), true);
  await page.evaluate(() => { document.getElementById('start').disabled = false; setControls(false); }); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({cls: document.body.classList.contains('live-session'), controls: document.querySelector('section.controls').checkVisibility(), back: !!document.getElementById('start').closest('section.controls')}));
  t('/ 1440: the session ends, everything returns', after, {cls: false, controls: true, back: true});

  // Card titles: Chinese only; the translation is in --text.
  t('/ 1440: no English card labels', await page.evaluate(() => [...document.querySelectorAll('.transcript-card .label')].filter(el => el.checkVisibility()).map(el => el.textContent)), []);
  await theme(page, 'dark');
  t('/ dark: the translation is in --text', await page.evaluate(() => getComputedStyle(document.getElementById('translation')).color), await resolved(page, '--text'));
  await context.close();
}

// A quiet setup: no 辨識引擎 row and no explanatory small print, wide and in the phone's settings dialog.
const QUIET = ['#asrEngineRow', '#modeNote', '.field > label > span', '#start .button-copy small', '#testMic .mic-test-copy > small', '.toggle-desc', '.toggle-fit', '.card-foot > span:last-child:not(:first-child)', '#sourceHint'];
const shownOf = (page, sels) => page.evaluate(sels => sels.filter(sel => [...document.querySelectorAll(sel)].some(el => el.checkVisibility())), sels);
{
  const {context, page} = await open('/');
  await page.evaluate(() => { setLiveMode('meeting'); const a = document.getElementById('audioSource'); a.value = 'microphone'; a.dispatchEvent(new Event('change')); });
  if (await page.evaluate(() => document.getElementById('setupAdvanced').getAttribute('aria-expanded') === 'false')) await page.click('#setupAdvanced');
  t('/ 1440: no 辨識引擎 row and no small print (進階 open)', await shownOf(page, QUIET), []);
  const titles = await page.evaluate(() => ['cloudRefineRow', 'qualityRow'].map(id => { const el = document.getElementById(id); return el.hidden ? null : el.title; }));
  t('/ 1440: 雲端精修 keeps its explanation in the title', titles[0] === null || titles[0].includes('只改寫譯文') && titles[0].includes('傳送文字到外部服務'), true);
  t('/ 1440: 精準模式 keeps its explanation in the title', titles[1] === null || titles[1].includes('重新辨識再翻譯') && titles[1].includes('傳送音訊與文字到外部服務'), true);
  if (titles[1] !== null) {
    await page.check('#quality');
    t('/ 1440: checking 精準模式 updates the data destination', await page.textContent('#privacyNote'), '精準模式音訊與文字會傳送到外部服務');
    await page.uncheck('#quality');
  }
  t('/ 1440: the data destination stays visible', await page.evaluate(() => document.getElementById('privacyNote').checkVisibility()), true);
  await page.evaluate(() => { const a = document.getElementById('audioSource'); a.value = 'system'; a.dispatchEvent(new Event('change')); });
  t('/ 1440: sharing a tab still explains how', await page.evaluate(() => { const h = document.getElementById('sourceHint'); return h.checkVisibility() && h.textContent.includes('分享分頁音訊'); }), true);
  await context.close();
}
{
  const {context, page} = await open('/', {width: 390, height: 844});
  await page.click('#mobileSettingsOpen'); await page.waitForTimeout(300);
  t('/ 390 dialog: no 辨識引擎 row and no small print', await shownOf(page, QUIET), []);
  await context.close();
}

// The live page on a phone: unchanged layout.
{
  const {context, page} = await open('/', {width: 390, height: 844});
  t('/ 390: no sentence', await page.evaluate(() => document.getElementById('setupSentence')?.checkVisibility() ?? false), false);
  await page.evaluate(() => setControls(true)); await page.waitForTimeout(300);
  t('/ 390 live: #start in #mobileActionSlot, the bar not fixed', await page.evaluate(() => [!!document.getElementById('start').closest('#mobileActionSlot'), getComputedStyle(document.getElementById('liveBar')).position]), [true, 'static']);
  await context.close();
}
// A phone held sideways (mobileQuery matches at 844×390 with touch): the phone layout stays during a session.
{
  const {context, page} = await open('/', {width: 844, height: 390, touch: true});
  await page.evaluate(() => setControls(true)); await page.waitForTimeout(300);
  t('/ 844×390 touch live: the phone layout stays', await page.evaluate(() => [document.body.classList.contains('live-session'), !!document.getElementById('start').closest('#mobileActionSlot'), getComputedStyle(document.getElementById('liveBar')).position, document.querySelector('section.controls').checkVisibility()]), [false, true, 'static', true]);
  await context.close();
}
await browser.close();
