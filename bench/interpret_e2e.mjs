// realtime-interpret and interpret-mode-on-home in a real browser, with the WebSockets and APIs answered by the test, so
// no audio reaches an outside service: 我的紀錄 (both kinds, replay modes, dragging, ?id=), the team administration
// page (即時口譯權限, usage per user, 紀錄保存期限), and the live page's 即時口譯 mode.
// Usage: YUQIAO_SESSION=<administrator's session> node bench/interpret_e2e.mjs [app url]
//   (a session: docker exec -w /app asr_confucius4-r2t2-app-1 python -m auth issue-session <admin> --hours 1)
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.argv[2] || 'http://localhost:18082/';
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const near = (name, got, want, within) => {const ok = Math.abs(got - want) <= within; console.log(ok ? 'ok  ' : 'FAIL', name, got.toFixed(2)); if (!ok) process.exitCode = 1};
const json = body => ({status: 200, contentType: 'application/json', body: JSON.stringify(body)});

function wav(seconds, fill) {   // 24 kHz mono PCM16; fill(t) gives the sample at t seconds
  const n = Math.round(24000 * seconds), buf = Buffer.alloc(44 + 2 * n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + 2 * n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(24000, 24); buf.writeUInt32LE(48000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(fill(i / 24000), 44 + 2 * i);
  return buf;
}
const SESSION = {id: '20261117-120000', startedAt: '2026-11-17 12:00:00', target: 'en', sourceLang: 'zh', engine: 'local',
  inputSeconds: 10, outputSeconds: 6, usd: 0.0034, sourceText: '你好，今天開會。', translation: 'Hello, today we meet.'};
const tenths = (from, to) => Array.from({length: Math.round((to - from) * 10)}, (_, i) => [Math.round(from * 10 + i) / 10, 0.0916]);
const INPUT = wav(10, () => 3000), OUTPUT = wav(9, s => (s >= 2 && s < 5) || s >= 6 ? 3000 : 0);   // translated speech 2–5 s and 6–9 s
// As the server's FileResponse: Range requests get 206, so the page can play the saved files from any point.
function ranged(route, body) {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
  if (!range) return route.fulfill({status: 200, contentType: 'audio/wav', headers: {'Accept-Ranges': 'bytes'}, body});
  const start = +range[1], end = range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1;
  return route.fulfill({status: 206, contentType: 'audio/wav', body: body.subarray(start, end + 1),
    headers: {'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}`}});
}
const BARS = {step: 0.1, input: Array(100).fill(0.0916), output: [...tenths(2, 5), ...tenths(6, 9)]};

const TRANSLATED = {id: '20261116-090000', kind: 'translate', startedAt: '2026-11-16 09:00:00', target: 'en', sourceLang: 'zh', engine: 'local',
  inputSeconds: 4, outputSeconds: 0, usd: 0, sourceText: '大家早安。', translation: 'Good morning, everyone.'};

// 我的紀錄 with the session API answered by the test: one 即時口譯 and one 即時翻譯 record.
async function records({path = 'interpret', retentionDays = 90} = {}) {
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  await page.route('**/api/interpret/config', route => route.fulfill(json({configured: true, allowed: false, usdPerHour: 2.04, targets: ['en', 'zh'], retentionDays})));
  await page.route('**/api/interpret/sessions', route => route.fulfill(json([SESSION, TRANSLATED].map(({sourceText, translation, ...s}) => ({kind: 'interpret', ...s, preview: translation})))));
  for (const s of [SESSION, TRANSLATED]) await page.route(`**/api/interpret/sessions/${s.id}`, route => route.fulfill(json({kind: 'interpret', ...s})));
  await page.route(`**/api/interpret/sessions/${SESSION.id}/bars`, route => route.fulfill(json(BARS)));
  await page.route(`**/api/interpret/sessions/${TRANSLATED.id}/bars`, route => route.fulfill(json({step: 0.1, input: Array(40).fill(0.05), output: []})));
  await page.route(`**/api/interpret/sessions/${SESSION.id}/input.wav`, route => ranged(route, INPUT));
  await page.route(`**/api/interpret/sessions/${SESSION.id}/output.wav`, route => ranged(route, OUTPUT));
  await page.route(`**/api/interpret/sessions/${TRANSLATED.id}/input.wav`, route => ranged(route, wav(4, () => 2000)));
  await page.goto(new URL(path, app).href);
  await page.waitForTimeout(900);
  return {page, context};
}

// --- My records page; Saved sessions can be replayed from any point
{
  const {page, context} = await records();
  t('the page is 我的紀錄, with no way to start a session', [await page.title(), await page.locator('#connect').count()], ['我的紀錄 — 語橋 Live', 0]);
  t('how long records are kept', await page.textContent('#retention'), '紀錄保存 90 天，到期自動刪除。');
  t('both kinds are listed', await page.$$eval('#historyRows tr', rows => rows.map(r => [r.cells[1].textContent, r.cells[2].textContent])),
    [['即時口譯', '中文・本機 → 英文'], ['即時翻譯', '中文・本機 → 英文']]);
  t('a 即時翻譯 record has no 譯音 download', await page.$$eval('#historyRows tr', rows => rows.map(r => [...r.querySelectorAll('a')].map(a => a.textContent).join(','))),
    ['原音,譯音,文字', '原音,文字']);
  await page.click(`#historyRows tr[data-id="${TRANSLATED.id}"] button:has-text("載入")`);
  await page.waitForTimeout(600);
  t('a 即時翻譯 record: only 只聽原音', await page.evaluate(() => ['replayBoth', 'replayOut', 'replayIn'].map(id => document.getElementById(id).disabled)),
    [true, true, false]);
  t('its texts', await page.evaluate(() => [document.getElementById('srcText').textContent, document.getElementById('outText').textContent]),
    ['大家早安。', 'Good morning, everyone.']);
  await page.click(`#historyRows tr[data-id="${SESSION.id}"] button:has-text("載入")`);
  await page.waitForTimeout(800);
  t('loading restores the texts', await page.evaluate(() => [document.getElementById('srcText').textContent, document.getElementById('outText').textContent]),
    ['你好，今天開會。', 'Hello, today we meet.']);
  t('整段 is the mode before any button is used', await page.$$eval('.mode-button.mode', b => b.map(x => x.id)), ['replayBoth']);
  await page.click('#replayOut'); await page.waitForTimeout(300); await page.click('#replayOut');
  await page.locator('#wave').scrollIntoViewIfNeeded();
  const box = await page.locator('#wave').boundingBox();
  const xAt = s => box.x + 24 + s / 30 * (box.width - 48);
  await page.mouse.move(xAt(3), box.y + 100); await page.mouse.down();
  await page.mouse.move(xAt(5.5), box.y + 100, {steps: 4});
  const dragging = await page.evaluate(() => Interpret.state().scrub.at);
  await page.mouse.move(xAt(7.6), box.y + 100, {steps: 4}); await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => Interpret.state().replaying);
  near('the line follows the pointer while dragging', dragging, 5.5, 0.15);
  t('released: plays the translation only', after.kind, 'out');
  near('from where it was released', after.at, 7.6 + 0.3, 0.35);
  await page.waitForTimeout(700);
  const later = await page.evaluate(() => Interpret.state().replaying);
  near('the saved translation really plays on from there', later ? later.at : 0, 7.6 + 0.3 + 0.7, 0.6);
  await page.click('#replayIn'); await page.waitForTimeout(300);
  await page.mouse.click(xAt(2), box.y + 100); await page.waitForTimeout(300);
  const during = await page.evaluate(() => Interpret.state().replaying);
  t('a click during 只聽原音 keeps that mode', during.kind, 'in');
  near('and moves to the click', during.at, 2 + 0.3, 0.35);
  await context.close();
}
{
  const {page, context} = await records({path: `interpret?id=${SESSION.id}`});
  await page.waitForTimeout(400);
  t('?id= opens that record', await page.evaluate(() => [Interpret.state().current, document.getElementById('outText').textContent]),
    [SESSION.id, 'Hello, today we meet.']);
  await page.click('#replayBoth'); await page.waitForTimeout(700);
  const both = await page.evaluate(() => Interpret.state().replaying);
  t('播放整段 plays it', [both && both.kind, both && both.at > 0.2], ['both', true]);
  await context.close();
}

// --- The live page's 即時口譯 mode (interpret-mode-on-home). Nothing leaves for an outside service: both WebSockets,
// the interpret settings and the text translations are answered here.
async function home({allowed = true, configured = true, saveMs = 0, setup} = {}) {
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  if (saveMs) await context.addInitScript(ms => { window.YQ_LIVE_SAVE_MS = ms; }, saveMs);
  const page = await context.newPage();
  const seen = {translateRequests: 0};
  await page.route('**/api/interpret/config', route => route.fulfill(json({configured, allowed, usdPerHour: 2.04, retentionDays: 90,
    targets: ['af', 'ar', 'en', 'ja', 'zh', 'ko', 'de', 'fr', 'es', 'th', 'vi', 'id', 'it', 'pt', 'ru', 'hi']})));
  await page.route('**/api/translate/stream', route => { seen.translateRequests++;
    route.fulfill({status: 200, contentType: 'text/event-stream', body: 'data: {"text": "Good morning, everyone."}\n\n'}); });
  await page.route('**/api/terms', route => route.fulfill(json({found: []})));
  if (setup) await setup(page, seen);
  await page.goto(app);
  await page.waitForTimeout(1200);
  return {page, context, seen};
}
const state = page => page.evaluate(() => ({
  pressed: [...document.querySelectorAll('.mode-btn')].map(b => [b.textContent, b.disabled, b.getAttribute('aria-pressed')]),
  locked: document.getElementById('interpretLocked').hidden ? '' : document.getElementById('interpretLocked').textContent,
  privacy: document.getElementById('privacyNote').innerText.replace(/\s+/g, ' '),
  start: document.getElementById('start').innerText.split('\n')[0],
  targets: document.getElementById('targetLanguage').options.length, pairOffered: !document.querySelector('#language option[value="zh_ja"]').disabled,
  swap: document.getElementById('swap').disabled, play: getComputedStyle(document.getElementById('interpretPlayRow')).display !== 'none',
  refine: getComputedStyle(document.getElementById('refineGroup')).display !== 'none'}));
{
  const {page, context} = await home({allowed: false});
  const s = await state(page);
  t('a member without access: 即時口譯 is shown disabled, with the reason', [s.pressed, s.locked],
    [[['開會', false, 'true'], ['即時翻譯', false, 'false'], ['即時口譯', true, 'false']], '需要申請權限，請聯絡系統管理員']);
  await context.close();
}
{
  const {page, context} = await home({configured: false});
  t('not set up: disabled, and says so', (await state(page)).locked, '即時口譯尚未設定，請聯絡系統管理員');
  await context.close();
}
{
  const {page, context} = await home();
  await page.click('#modeTranslate'); await page.waitForTimeout(200);
  const before = await state(page);
  await page.click('#modeInterpret'); await page.waitForTimeout(300);
  const s = await state(page);
  t('即時口譯 mode: its own options', [s.start, s.privacy, s.targets, s.pairOffered, s.swap, s.play, s.refine],
    ['開始口譯', '雲端口譯 音訊會傳送到外部服務', 16, false, true, true, false]);
  await page.click('#modeTranslate'); await page.waitForTimeout(300);
  const back = await state(page);
  t('back to 即時翻譯: everything as it was', [back.start, back.privacy, back.targets, back.pairOffered, back.play],
    [before.start, before.privacy, before.targets, true, false]);
  await page.click('#modeInterpret'); await page.reload(); await page.waitForTimeout(1200);
  t('the mode is remembered', (await state(page)).pressed[2][2], 'true');
  await context.close();
}
{
  const sid = '20261118-100000', seen = {interpretStart: null, transcribeStart: null, sources: [], stop: false, chunks: 0};
  const pcm = Buffer.alloc(9600); for (let i = 0; i < 4800; i++) pcm.writeInt16LE(i % 40 < 20 ? 3000 : -3000, 2 * i);
  const {page, context, seen: counts} = await home({setup: async page => {
    await page.routeWebSocket('**/ws/interpret', ws => ws.onMessage(message => {
      if (typeof message !== 'string') {
        if (++seen.chunks === 3) {
          ws.send(JSON.stringify({type: 'out', delta: 'Hello everyone. Today'}));
          ws.send(JSON.stringify({type: 'audio', audio: pcm.toString('base64')}));
        }
        return;
      }
      const data = JSON.parse(message);
      if (!seen.interpretStart) { seen.interpretStart = data; ws.send(JSON.stringify({type: 'status', state: 'connected'})); }
      else if (data.type === 'source') seen.sources.push([data.keep, data.text]);
      else if (data.type === 'stop') { seen.stop = true; ws.send(JSON.stringify({type: 'out', delta: ' we meet.'}));
        ws.send(JSON.stringify({type: 'status', state: 'closed', saved: sid, usd: 0.001})); ws.close(); }
    }));
    await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => {
      if (typeof message !== 'string') return;
      if (message === 'YOUDAO_ONETIME_ASR_STREAM_EOS') { ws.send(JSON.stringify({msg: {text: '開會'}, displayText: '大家好，今天開會'})); ws.close(); return; }
      seen.transcribeStart = JSON.parse(message);
      ws.send(JSON.stringify({msg: {text: '大家好'}, displayText: '大家好'}));
      setTimeout(() => ws.send(JSON.stringify({msg: {text: '，今天'}, displayText: '大家好，今天'})), 300);
    }));
  }});
  await page.fill('#context', 'LINE=耐');   // typed in another mode: 即時口譯 does not send it
  await page.click('#modeInterpret'); await page.selectOption('#language', 'en'); await page.selectOption('#targetLanguage', 'ja');
  await page.uncheck('#interpretPlay');
  await page.click('#start');
  await page.waitForTimeout(2500);
  const during = await page.evaluate(() => ({source: document.getElementById('transcript').textContent, out: document.getElementById('translation').innerText,
    subtitles: subtitleParts(), status: document.getElementById('status').innerText, volume: InterpretMode.volume()}));
  t('the start messages: English speech goes to cloud recognition, no 會議情境', [seen.interpretStart, seen.transcribeStart.mode, seen.transcribeStart.language, seen.transcribeStart.engine, seen.transcribeStart.system_prompt],
    [{target: 'ja', sourceLang: 'en'}, 'interpret', 'en', 'mai', '']);
  t('同步播放譯音 off: silent, the text still shown', [during.volume, during.out.length > 0], [0, true]);
  await page.check('#interpretPlay'); await page.waitForTimeout(100);
  t('on again: heard', await page.evaluate(() => InterpretMode.volume()), 1);
  t('原始逐字稿 has the recognized speech; the translation pane the interpreted text', [during.source, during.out.replace(/\s+/g, ' ')],
    ['大家好，今天', 'Hello everyone. Today']);
  t('the subtitles show the interpreted text', [during.subtitles.translation, during.subtitles.draft], ['Hello everyone.', 'Today']);
  const cjk = await page.evaluate(() => { const keep = [translated, draftText]; interpretText('大家好。今天開會。我們先'); const got = [translated, draftText];
    [translated, draftText] = keep; return got; });
  t('Chinese or Japanese sentences end without a space', cjk, ['大家好。今天開會。', '我們先']);
  t('no text translation is asked for', counts.translateRequests, 0);
  await page.click('#start');
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({link: document.getElementById('savedLink').hidden ? '' : document.getElementById('savedLink').getAttribute('href'),
    status: document.getElementById('status').innerText, out: document.getElementById('translation').innerText.replace(/\s+/g, ' ')}));
  t('the source went as its changes, the last one after EOS', [seen.sources, seen.stop],
    [[[0, '大家好'], [3, '，今天'], [6, '開會']], true]);
  t('saved: 在我的紀錄開啟', [after.link, after.status], [`/interpret?id=${sid}`, '口譯已結束，已存到我的紀錄']);
  t('the rest of the interpreting arrived', after.out, 'Hello everyone. Today we meet.');
  await context.close();
}

// --- The source text stops, the interpreting goes on
{
  let chunks = 0;
  const {page, context} = await home({setup: async page => {
    await page.routeWebSocket('**/ws/interpret', ws => ws.onMessage(message => {
      if (typeof message !== 'string') { if (++chunks === 30) ws.send(JSON.stringify({type: 'out', delta: 'Still here.'})); return; }
      const data = JSON.parse(message);
      if (data.target) ws.send(JSON.stringify({type: 'status', state: 'connected'}));
      else if (data.type === 'stop') { ws.send(JSON.stringify({type: 'status', state: 'closed', saved: null})); ws.close(); }
    }));
    await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => {
      if (typeof message === 'string' && message.startsWith('{')) setTimeout(() => ws.close({code: 1011, reason: 'gone'}), 300);
    }));
  }});
  await page.click('#modeInterpret'); await page.click('#start');
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => ({status: document.getElementById('status').innerText, toast: document.getElementById('toast').textContent,
    out: document.getElementById('translation').innerText.trim(), live: document.getElementById('start').classList.contains('stop')}));
  t('recognition dropped: told, and the interpreting goes on', [s.live, s.status, s.toast.startsWith('原文辨識已停止'), s.out], [true, '即時口譯中', true, 'Still here.']);
  await page.click('#start'); await page.waitForTimeout(800);
  await context.close();
}

// --- Translate-only sessions are saved: the translation goes to the record every interval while it runs, then in full.
{
  const puts = [], sid = '20261118-110000';
  const {page, context} = await home({saveMs: 600, setup: async page => {
    await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => {
      if (typeof message !== 'string') return;
      if (message === 'YOUDAO_ONETIME_ASR_STREAM_EOS') { ws.send(JSON.stringify({saved: sid})); ws.close(); return; }
      ws.send(JSON.stringify({record: 'tok123'}));
      ws.send(JSON.stringify({msg: {text: '大家早安。', speech_end: true}, displayText: '大家早安。'}));
    }));
    await page.route('**/api/interpret/**/translation', route => { puts.push([route.request().url().split('/api/interpret/')[1], route.request().postDataJSON().text]);
      route.fulfill(json({})); });
  }});
  await page.click('#modeTranslate'); await page.selectOption('#language', 'zh'); await page.selectOption('#targetLanguage', 'en');
  t('即時翻譯 says it is saved', await page.textContent('#storeNote'), '存成你的紀錄，只有你看得到');
  await page.click('#start');
  await page.waitForTimeout(2500);
  const live = puts.filter(([url]) => url.startsWith('live/'));
  t('while it runs: sent when it changed, not again when it did not', [live.length, live[0]], [1, ['live/tok123/translation', 'Good morning, everyone.']]);
  await page.click('#start');
  await page.waitForTimeout(2500);
  t('after it is saved: the full translation once more', puts.at(-1), [`sessions/${sid}/translation`, 'Good morning, everyone.']);
  t('and 在我的紀錄開啟', await page.getAttribute('#savedLink', 'href'), `/interpret?id=${sid}`);
  await context.close();
}

// --- Interpreting is open to granted users; usage per user; how long records are kept: the team administration page
{
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  const sent = [];
  let granted = [{username: 'alice', grantedBy: 't05313', grantedAt: '2026-11-17T12:00:00+08:00'}];
  await page.route('**/api/admin/interpret-usage', route => route.fulfill(json({seconds: 1929, usd: 1.09, usdPerHour: 2.04,
    byPurpose: {lab: 129, live: 1800}, byUser: {'': 129, alice: 1800}})));
  await page.route('**/api/admin/interpret-access**', async route => {
    const request = route.request(), method = request.method();
    if (method !== 'GET') sent.push([method, request.url().split('/api/admin/')[1], request.postDataJSON?.() ?? null]);
    if (method === 'POST') granted = [...granted, {username: request.postDataJSON().username.toLowerCase(), grantedBy: 't05313', grantedAt: ''}];
    if (method === 'DELETE') granted = granted.filter(g => !request.url().endsWith('/' + g.username));
    route.fulfill(json(method === 'GET' ? granted : {}));
  });
  await page.route('**/api/admin/records-retention', route => {
    const request = route.request();
    if (request.method() === 'PUT') sent.push(['PUT', 'records-retention', request.postDataJSON()]);
    route.fulfill(json(request.method() === 'PUT' ? request.postDataJSON() : {days: 90}));
  });
  await page.goto(new URL('admin', app).href);
  await page.waitForTimeout(1000);
  t('the usage card', await page.textContent('#interpretUsageText'),
    '累計收到 0.54 小時的譯音，約 1.09 美元（每小時 2.04 美元，不算進雲端辨識的上限）。金額依譯音長度估算，不是帳單。');
  t('usage per user', await page.$$eval('#interpretByUser li', rows => rows.map(r => r.textContent)),
    ['alice0.50 小時，約 1.02 美元', '（未記名）0.04 小時，約 0.07 美元']);
  t('no link to a separate interpret page', await page.locator('#interpretCard a').count(), 0);
  t('the granted accounts', await page.$$eval('#accessList b', b => b.map(x => x.textContent)), ['alice']);
  await page.fill('#accessName', 'Bob'); await page.click('#accessForm button'); await page.waitForTimeout(500);
  t('granting bob', await page.$$eval('#accessList b', b => b.map(x => x.textContent)), ['alice', 'bob']);
  await page.click('#accessList li:has-text("alice") button'); await page.click('#accessList li:has-text("alice") button'); await page.waitForTimeout(500);
  t('withdrawing alice (asks once more)', await page.$$eval('#accessList b', b => b.map(x => x.textContent)), ['bob']);
  t('the retention shown', await page.inputValue('#retentionDays'), '90');
  await page.fill('#retentionDays', '30'); await page.click('#retentionForm button'); await page.waitForTimeout(500);
  t('what was sent', sent, [['POST', 'interpret-access', {username: 'Bob'}], ['DELETE', 'interpret-access/alice', null],
    ['PUT', 'records-retention', {days: 30}]]);
  t('the retention saved', await page.textContent('#retentionNote'), '已儲存：保存 30 天，較舊的紀錄已刪除。');
  await context.close();
}
await browser.close();
