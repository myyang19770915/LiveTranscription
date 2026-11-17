// realtime-interpret in a real browser: the 即時口譯 page with both WebSockets and the session API answered by the test,
// so no audio reaches Azure or MAI. Checks the source-text engine and hand-over (only the changes are sent), that no
// audio is kept on the page, 同步播放譯音, replay of the saved files right after a session and from 我的紀錄 (modes and
// dragging on the waveform), and the entry and usage card on the team administration page.
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

async function open({sessions = [SESSION], live, configured = true} = {}) {   // live(page): routes for the two WebSockets
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  await page.route('**/api/interpret/config', route => route.fulfill(json({configured, usdPerHour: 2.04, targets: ['en', 'zh']})));
  await page.route('**/api/interpret/sessions', route => route.fulfill(json(sessions.map(({sourceText, translation, ...s}) => ({...s, preview: translation})))));
  await page.route(`**/api/interpret/sessions/${SESSION.id}`, route => route.fulfill(json(SESSION)));
  await page.route(`**/api/interpret/sessions/${SESSION.id}/bars`, route => route.fulfill(json(BARS)));
  await page.route(`**/api/interpret/sessions/${SESSION.id}/input.wav`, route => ranged(route, INPUT));
  await page.route(`**/api/interpret/sessions/${SESSION.id}/output.wav`, route => ranged(route, OUTPUT));
  if (live) await live(page);
  await page.goto(new URL('interpret', app).href);
  await page.waitForTimeout(800);
  return {page, context};
}

// --- The source text comes from 語橋's recognition; 同步播放譯音 only sets the volume
{
  const seen = {interpretStart: null, transcribeStart: null, sourceMessages: [], stop: false, eos: false, audioChunks: 0};
  const pcm = Buffer.alloc(48000, 0); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(i % 50 < 25 ? 4000 : -4000, 2 * i);
  const {page, context} = await open({live: async page => {
    await page.routeWebSocket('**/ws/interpret', ws => {
      ws.onMessage(message => {
        if (typeof message !== 'string') {
          if (++seen.audioChunks === 3) {
            ws.send(JSON.stringify({type: 'out', delta: 'Hello there.'}));
            ws.send(JSON.stringify({type: 'audio', audio: pcm.toString('base64')}));
          }
          return;
        }
        const data = JSON.parse(message);
        if (!seen.interpretStart) { seen.interpretStart = data; ws.send(JSON.stringify({type: 'status', state: 'connected'})); }
        else if (data.type === 'source') seen.sourceMessages.push(data);
        else if (data.type === 'stop') { seen.stop = true; ws.send(JSON.stringify({type: 'status', state: 'closed', saved: SESSION.id, usd: 0.0006})); ws.close(); }
      });
    });
    await page.routeWebSocket('**/ws/transcribe', ws => {
      ws.onMessage(message => {
        if (typeof message !== 'string') return;
        if (message === 'YOUDAO_ONETIME_ASR_STREAM_EOS') { seen.eos = true; ws.send(JSON.stringify({displayText: '大家好，今天開會'})); ws.close(); return; }
        seen.transcribeStart = JSON.parse(message);
        ws.send(JSON.stringify({displayText: '大家好', tentative: '，今'}));
        setTimeout(() => ws.send(JSON.stringify({displayText: '大家好，今天', tentative: '開'})), 300);
      });
    });
  }});
  await page.selectOption('#sourceLang', 'en');
  await page.uncheck('#playOut');
  await page.click('#connect');
  await page.waitForTimeout(2500);
  const during = await page.evaluate(() => ({gain: Interpret.state().gain, engine: document.getElementById('srcEngine').textContent,
    source: document.getElementById('srcText').textContent, out: document.getElementById('outText').textContent, state: Interpret.state()}));
  t('the start message names the speaking and output languages', seen.interpretStart, {target: 'en', sourceLang: 'en'});
  t('English speech goes to MAI for the source text', seen.transcribeStart, {mode: 'translate', language: 'en', engine: 'mai'});
  t('同步播放譯音 off: silent, still drawn', [during.gain, during.state.outBars > 0, during.out], [0, true, 'Hello there.']);
  t('no audio is kept while live: only the waveform', [during.state.inBars > 0, 'inChunks' in during.state, 'outChunks' in during.state, during.state.players],
    [true, false, false, false]);
  t('the source column names the engine and shows the draft', [during.engine, during.source], ['（雲端辨識）', '大家好，今天開']);
  await page.check('#playOut');
  await page.waitForTimeout(200);   // the new volume applies from the next audio block
  t('checking it again makes the speech heard', await page.evaluate(() => Interpret.state().gain), 1);
  await page.click('#connect');
  await page.waitForTimeout(1500);
  t('stop: EOS first, then the last source text, then stop', [seen.eos, seen.stop], [true, true]);
  t('the source goes as its changes', seen.sourceMessages,
    [{type: 'source', keep: 0, text: '大家好'}, {type: 'source', keep: 3, text: '，今天'}, {type: 'source', keep: 6, text: '開會'}]);
  const saved = await page.evaluate(() => ({loaded: document.getElementById('loaded').textContent, state: Interpret.state(),
    buttons: ['replayBoth', 'replayOut', 'replayIn'].map(id => document.getElementById(id).disabled), out: document.getElementById('outText').textContent}));
  t('right after the session: the saved one is shown, with its waveform, ready to replay',
    [saved.loaded, saved.state.inBars, saved.state.outBars, saved.state.players, saved.buttons, saved.out],
    ['已存檔：20261117-120000', 100, 60, true, [false, false, false], 'Hello there.']);
  await page.click('#replayBoth'); await page.waitForTimeout(700);
  const both = await page.evaluate(() => Interpret.state().replaying);
  t('播放整段 plays the saved files', [both && both.kind, both && both.at > 0.2], ['both', true]);
  await page.uncheck('#playOut');
  await page.reload(); await page.waitForTimeout(600);
  t('the choice is remembered', await page.isChecked('#playOut'), false);
  await context.close();
}

// --- Not configured: the page says so and 連線 cannot be pressed
{
  const {page, context} = await open({configured: false});
  t('not configured: an error and no 連線', await page.evaluate(() => [document.getElementById('error').hidden, document.getElementById('connect').disabled]), [false, true]);
  await context.close();
}

// --- Saved sessions can be replayed from any point
{
  const {page, context} = await open();
  t('my records list the session', await page.$$eval('#historyRows tr', rows => rows.map(r => r.cells[1].textContent)), ['中文・本機 → 英文']);
  await page.click('#historyRows button:has-text("載入")');
  await page.waitForTimeout(800);
  t('loading restores the texts', await page.evaluate(() => [document.getElementById('srcText').textContent, document.getElementById('outText').textContent]),
    ['你好，今天開會。', 'Hello, today we meet.']);
  t('整段 is the mode before any button is used', await page.$$eval('.mode-button.mode', b => b.map(x => x.id)), ['replayBoth']);
  await page.click('#replayOut'); await page.waitForTimeout(300); await page.click('#replayOut');
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
  const later = await page.evaluate(() => [Interpret.state().replaying, document.querySelectorAll('audio').length]);
  near('the saved translation really plays on from there', later[0] ? later[0].at : 0, 7.6 + 0.3 + 0.7, 0.6);
  await page.click('#replayIn'); await page.waitForTimeout(300);
  await page.mouse.click(xAt(2), box.y + 100); await page.waitForTimeout(300);
  const during = await page.evaluate(() => Interpret.state().replaying);
  t('a click during 只聽原音 keeps that mode', during.kind, 'in');
  near('and moves to the click', during.at, 2 + 0.3, 0.35);
  await context.close();
}

// --- The interpret page is for system administrators: the entry and the usage card on /admin
{
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  await page.route('**/api/admin/interpret-usage', route => route.fulfill(json({seconds: 129, usd: 0.07, usdPerHour: 2.04, byPurpose: {lab: 129}})));
  await page.goto(new URL('admin', app).href);
  await page.waitForTimeout(1000);
  t('the usage card', await page.textContent('#interpretUsageText'),
    '累計收到 0.04 小時的譯音，約 0.07 美元（每小時 2.04 美元，不算進雲端辨識的上限）。金額依譯音長度估算，不是帳單。');
  await page.click('#interpretCard a:has-text("即時口譯")');
  await page.waitForURL('**/interpret');
  t('the link opens the page', await page.title(), '即時口譯 — 語橋 Live');
  await context.close();
}
await browser.close();
