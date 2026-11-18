// record-to-meeting in a real browser (Playwright, gstack's install). Costs nothing: the record is a short 即時翻譯 session
// on the local recognizer (silence), sent its sentences as the live page does; 精準模式 conversions are answered by the
// test. It leaves one meeting, titled 驗收 轉成會議紀錄 <time>, in the signed-in user's first team, and deletes the record.
//   - a 即時翻譯 record keeps its sentences and becomes a meeting at once from 我的紀錄 (dialog, team, title)
//   - the record is marked 已轉成會議紀錄 and links to the meeting, whose review page shows the sentences
//   - a record without sentences: the dialog names 精準模式 and the external service; progress, then the failure message
// Usage: YUQIAO_SESSION=<session of a user in a team> node bench/record_meeting_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch();
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
const page = await context.newPage();
await page.goto(app + '/interpret'); await page.waitForLoadState('networkidle');

// --- A 即時翻譯 record with its sentences (the live page's requests, made from this page)
const SENTENCES = [{startMs: 0, endMs: 1200, source: '大家好', target: 'Hello everyone', detected: 'zh'},
                   {startMs: 1200, endMs: 2000, source: '今天開始', target: 'We begin today', detected: 'zh'}];
const saved = await page.evaluate(async sentences => {
  const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/transcribe`);
  const events = [];
  const next = test => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer')), 20000);
    const look = () => { const e = events.find(test); if (e) { clearTimeout(timer); resolve(e); } else setTimeout(look, 50); };
    look();
  });
  ws.onmessage = m => { try { events.push(JSON.parse(m.data)); } catch {} };
  await new Promise(r => { ws.onopen = r; });
  ws.send(JSON.stringify({requestId: crypto.randomUUID(), mode: 'translate', language: 'zh', engine: 'local', target: 'en', system_prompt: ''}));
  ws.send(new Int16Array(16000 * 2).buffer);   // two seconds of silence at 16 kHz
  const token = (await next(e => e.record)).record;
  const put = await fetch(`/api/interpret/live/${token}/translation`, {method: 'PUT', headers: {'content-type': 'application/json'},
    body: JSON.stringify({text: 'Hello everyone\nWe begin today', segments: sentences})});
  ws.send('YOUDAO_ONETIME_ASR_STREAM_EOS');
  const id = (await next(e => e.saved)).saved;
  ws.close();
  return {id, put: put.status};
}, SENTENCES);
t('the record was saved with its sentences', saved.put, 200);
const stamp = new Date().toISOString().slice(11, 19);
const title = `驗收 轉成會議紀錄 ${stamp}`;

await page.reload(); await page.waitForLoadState('networkidle');
const row = page.locator(`#historyRows tr[data-id="${saved.id}"]`);
await row.getByRole('button', {name: '轉成會議紀錄'}).click();
t('the dialog says the sentences go in at once', await page.textContent('#convertNote'), '逐句原文、譯文與錄音會直接帶入，立即完成。');
t('the title defaults to the kind and the time', (await page.getAttribute('#convertName', 'placeholder')).startsWith('即時翻譯 '), true);
await page.fill('#convertName', title);
await page.click('#convertGo');
await row.locator('a.converted').waitFor({timeout: 15000});
t('the record is marked and links to the meeting', await row.locator('a.converted').textContent(), '已轉成會議紀錄・開啟');
t('it cannot be converted twice from the page', await row.getByRole('button', {name: '轉成會議紀錄'}).count(), 0);
const meetingUrl = await row.locator('a.converted').getAttribute('href');
const meetingId = meetingUrl.split('/').pop();
const meeting = await (await context.request.get(`${app}/api/meetings/${meetingId}`)).json();
t('the meeting has the title and both sentences', [meeting.title, (meeting.segments || []).map(s => [s.source, s.target])],
  [title, SENTENCES.map(s => [s.source, s.target])]);
const audio = await context.request.get(`${app}/api/meetings/${meetingId}/audio?start=0&end=2000`);
t('the meeting has the recording', [audio.status(), (await audio.body()).length > 44], [200, true]);
await page.goto(app + meetingUrl); await page.waitForLoadState('networkidle');
t('the review page shows the sentences', await page.evaluate(() => ['大家好', 'We begin today'].every(x => document.body.innerText.includes(x))), true);

// --- A record without sentences: 精準模式 (answered by the test)
await page.goto(app + '/interpret'); await page.waitForLoadState('networkidle');
const fake = {id: '20000101-000000', startedAt: '2000-01-01 00:00:00', kind: 'interpret', target: 'en', sourceLang: 'zh', engine: 'local',
  inputSeconds: 600, outputSeconds: 590, usd: 0.3, preview: '測試', meetingId: null, segments: false, cannotConvert: '', conversion: null};
let polls = 0, posted = null;
await page.route(`${app}/api/interpret/sessions`, async route => {
  const real = await (await route.fetch()).json();
  route.fulfill({json: [fake, ...real.filter(s => s.id !== fake.id)]});
});
await page.route(`${app}/api/interpret/sessions/${fake.id}/meeting`, route => {
  if (route.request().method() === 'POST') {
    posted = route.request().postDataJSON();
    fake.conversion = {state: 'running', doneMs: 0, totalMs: 600000, error: ''};
    return route.fulfill({status: 202, json: fake.conversion});
  }
  polls++;
  if (polls < 2) return route.fulfill({json: {state: 'running', doneMs: 150000, totalMs: 600000, error: ''}});
  fake.conversion = {state: 'failed', doneMs: 300000, totalMs: 600000, error: '部分內容處理失敗，請再試一次'};
  return route.fulfill({json: fake.conversion});
});
await page.reload(); await page.waitForLoadState('networkidle');
const quality = page.locator(`#historyRows tr[data-id="${fake.id}"]`);
await quality.getByRole('button', {name: '轉成會議紀錄'}).click();
const note = await page.textContent('#convertNote');
t('精準模式 is named with the external service and the expected time', [note.includes('精準模式'), note.includes('外部服務'), note.includes('約需 5 分鐘')], [true, true, true]);
await page.click('#convertGo');
await quality.locator('.convert-state').waitFor();
t('the request names the team and the default title', [typeof posted.team_id, posted.title], ['number', '']);
await page.waitForFunction(id => /轉換中 2:30／10:00/.test(document.querySelector(`tr[data-id="${id}"] .convert-state`)?.textContent || ''), fake.id, {timeout: 8000})
  .then(() => t('progress is shown', true, true), () => t('progress is shown', false, true));
await quality.locator('.convert-state.failed').waitFor({timeout: 10000});
t('a failed conversion says so and offers to try again', [await quality.locator('.convert-state.failed').textContent(), await quality.getByRole('button', {name: '再試一次'}).count()],
  ['部分內容處理失敗，請再試一次', 1]);
fake.conversion = null; fake.cannotConvert = '精準模式只支援中文、英文、日文，這筆紀錄的語言不能轉成會議紀錄';
await page.reload(); await page.waitForLoadState('networkidle');
t('a record that cannot be converted offers no conversion', await quality.getByRole('button', {name: '轉成會議紀錄'}).count(), 0);
await quality.getByRole('button', {name: '為何不能轉換'}).click();
t('and says why on a click', await page.textContent('#error'), fake.cannotConvert);

// Phone width: the dialog stays inside the window.
fake.cannotConvert = '';
await page.setViewportSize({width: 390, height: 800});
await page.reload(); await page.waitForLoadState('networkidle');
await quality.getByRole('button', {name: '轉成會議紀錄'}).click();
const box = await page.locator('#convertDialog').boundingBox();
t('390: the dialog fits the window', box.x >= 0 && box.x + box.width <= 390, true);
if (process.env.SHOTS) await page.screenshot({path: `${process.env.SHOTS}/convert-390.png`});
await page.setViewportSize({width: 1440, height: 900});
if (process.env.SHOTS) await page.screenshot({path: `${process.env.SHOTS}/convert-1440.png`});
await page.unrouteAll({behavior: 'ignoreErrors'});
await context.request.delete(`${app}/api/interpret/sessions/${saved.id}`);
await browser.close();
