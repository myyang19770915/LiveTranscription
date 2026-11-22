// 精準模式 (quality-pass) in a real browser, with a fake microphone and a fake recognition socket: the switch is shown
// only when configured, the stream header carries quality:true and refine:false, three failed chunks change the status,
// a revision event replaces a kept sentence in both panes and merges two, and stopping waits 70 s for the connection to close. Nothing is stored (即時翻譯 mode, no server stream).
// Usage: YUQIAO_SESSION=… node bench/quality_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.argv[2] || 'http://localhost:18082/';
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};

async function open(config) {
  const context = await browser.newContext({permissions: ['microphone']});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  const page = await context.newPage();
  await page.route('**/api/config', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(config)}));
  // The recognition socket never reaches the server: it opens, records what the page sends, and stays open.
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    window.__sockets = [];
    window.WebSocket = class extends EventTarget {
      static OPEN = 1; static CLOSED = 3;
      constructor(url) {
        super();
        if (!String(url).includes('/ws/transcribe')) return new Real(url);
        this.readyState = 1; this.sent = []; window.__sockets.push(this);
        setTimeout(() => this.onopen?.(), 0);
      }
      send(data) { if (typeof data === 'string') this.sent.push(data); }
      close() { this.readyState = 3; this.dispatchEvent(new Event('close')); this.onclose?.({code: 1000, reason: ''}); }
    };
  });
  await page.goto(app);
  await page.waitForTimeout(1200);
  return {context, page};
}

{
  const {context, page} = await open({cloudRefine: true, mai: false, quality: false, cloudTranslate: false});
  t('not configured: the switch is hidden', await page.evaluate(() => document.getElementById('qualityRow').hidden), true);
  await context.close();
}
{
  const {context, page} = await open({cloudRefine: true, mai: false, quality: true, cloudTranslate: false});
  t('configured: the switch is shown, unchecked', await page.evaluate(() => [document.getElementById('qualityRow').hidden, document.getElementById('quality').checked]), [false, false]);
  await page.evaluate(() => { setLiveMode('translate', false); document.getElementById('cloudRefine').click(); document.getElementById('quality').click(); });
  t('checked: 雲端精修 is disabled and the notice names 精準模式',
    await page.evaluate(() => [document.getElementById('cloudRefine').disabled, document.getElementById('privacyNote').textContent]), [true, '精準模式音訊與文字會傳送到外部服務']);
  await page.evaluate(() => startMeeting());
  await page.waitForFunction(() => window.__sockets[0]?.sent.length > 0, null, {timeout: 15000});
  const header = JSON.parse(await page.evaluate(() => window.__sockets[0].sent[0]));
  t('the stream header asks for the quality pass and not for refinement', [header.mode, header.quality, header.refine], ['translate', true, false]);
  await page.waitForFunction(() => document.getElementById('start').classList.contains('stop'), null, {timeout: 15000});
  const status = () => page.evaluate(() => document.getElementById('status').textContent.trim());
  // quality-revision: a kept sentence gets its revised text in both panes; the other one stays.
  const say = message => page.evaluate(message => window.__sockets[0].onmessage({data: JSON.stringify(message)}), message);
  await say({quality: {seq: 1, throughMs: 6000, final: false, sentences: [{id: 1, source: '跟先生的感情變得穩定。', target: 'became stable.', lang: 'zh', startMs: 0, endMs: 3000},
    {id: 2, source: '第二句。', target: 'Second.', lang: 'zh', startMs: 3000, endMs: 6000}]}, audioMs: 6000});
  const panes = () => page.evaluate(() => [document.getElementById('transcript').textContent, document.getElementById('translation').textContent]);
  t('two sentences are shown (one paragraph in the transcript: no pause between them)', await panes(), ['跟先生的感情變得穩定。第二句。', 'became stable.\n\nSecond.']);
  await say({revision: {seq: 1, sentences: [{id: 1, source: '跟先生的感情變得不穩定。', target: 'became unstable.'}]}, audioMs: 9000});
  t('the revised sentence replaces the first in both panes', await panes(), ['跟先生的感情變得不穩定。第二句。', 'became unstable.\n\nSecond.']);
  // revision-merge: a sentence cut in two becomes one segment in both panes.
  await say({revision: {seq: 2, sentences: [{id: 1, source: '跟先生的感情變得不穩定，第二句。', target: 'became unstable, second.', merged: [2], endMs: 6000}]}, audioMs: 12000});
  t('the merged sentence is one segment in both panes', await panes(), ['跟先生的感情變得不穩定，第二句。', 'became unstable, second.']);
  // smooth-subtitles "The panes follow the newest text smoothly": following at the end, not while reading earlier text.
  const more = (seq, from) => say({quality: {seq, throughMs: 6000 + seq * 6000, final: false, sentences: Array.from({length: 30}, (_, i) => ({id: from + i, source: `第 ${from + i} 句，用來把原文欄填滿。`, target: `Sentence ${from + i} fills the pane.`, lang: 'zh', startMs: 6000 + seq * 6000, endMs: 12000 + seq * 6000}))}, audioMs: 12000 + seq * 6000});
  const pane = () => page.evaluate(() => { const el = document.getElementById('transcript'); return {top: Math.round(el.scrollTop), end: el.scrollHeight - el.clientHeight}; });
  await more(5, 3); await page.waitForTimeout(1200);
  let at = await pane();
  t('following: the pane scrolled to its new end', at.end > 300 && at.end - at.top < 3, true);
  await page.evaluate(() => { const el = document.getElementById('transcript'); el.dispatchEvent(new WheelEvent('wheel', {bubbles: true, deltaY: -120})); el.scrollTo({top: el.scrollHeight - el.clientHeight - 300, behavior: 'instant'}); });
  const reading = (await pane()).top;
  await more(6, 33); await page.waitForTimeout(1200);
  t('reading earlier text: the scroll position stays', (await pane()).top, reading);
  await page.evaluate(() => { const el = document.getElementById('transcript'); el.scrollTo({top: el.scrollHeight, behavior: 'instant'}); });
  await more(7, 63); await page.waitForTimeout(1200);
  at = await pane();
  t('back at the end: the pane follows again', at.end - at.top < 3, true);
  const fail = seq => page.evaluate(seq => window.__sockets[0].onmessage({data: JSON.stringify({quality: {seq, failed: true, throughMs: seq * 6000, final: false}, audioMs: seq * 6000})}), seq);
  await fail(2); await fail(3);
  t('two failed chunks: the status is unchanged', (await status()).includes('精準模式暫時無法使用'), false);
  await fail(4);
  t('three failed chunks in a row', (await status()).includes('精準模式暫時無法使用，已改用即時結果'), true);
  // Stop: the server never closes, so the page gives up after its 70 s wait for the connection to close.
  const began = Date.now();
  await page.evaluate(() => { stopMeeting(); });
  await page.waitForFunction(() => window.__sockets[0].readyState === 3, null, {timeout: 80000});
  const waited = (Date.now() - began) / 1000;
  t('stopping waited about 70 s for the connection to close', waited > 69 && waited < 73, true);
  await context.close();
}
{
  // quality-transcript-flow: 開會、不翻譯、精準模式 as in the 2026-11-22 recording. Sentences close together share a
  // paragraph, a pause starts the next one, and the live text follows on the same line without repeating kept words.
  const {context, page} = await open({cloudRefine: true, mai: false, quality: true, cloudTranslate: false});
  // 開會 mode creates and saves a meeting: answered here, so nothing reaches the meeting database.
  const stored = [];
  await page.route('**/api/meetings**', route => { stored.push(route.request().method() + ' ' + new URL(route.request().url()).pathname); route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({id: '00000000-0000-0000-0000-00000000e2e0'})}); });
  await page.evaluate(() => { setLiveMode('meeting', false); const language = document.getElementById('language'); language.value = 'zh'; language.dispatchEvent(new Event('change')); const target = document.getElementById('targetLanguage'); target.value = 'none'; target.dispatchEvent(new Event('change')); const q = document.getElementById('quality'); if (!q.checked) q.click(); });
  await page.evaluate(() => startMeeting());
  await page.waitForFunction(() => window.__sockets[0]?.sent.length > 0, null, {timeout: 15000});
  await page.waitForFunction(() => document.getElementById('start').classList.contains('stop'), null, {timeout: 15000});
  const say = message => page.evaluate(message => window.__sockets[0].onmessage({data: JSON.stringify(message)}), message);
  const header = JSON.parse(await page.evaluate(() => window.__sockets[0].sent[0]));
  t('flow: a meeting without translation, with the quality pass', [header.mode, header.target, header.quality], ['meeting', 'none', true]);
  await say({msg: {text: '這裡我們回到第二層目錄好我們回到上一層這地方來去新增目錄好我們點'}, audioMs: 8000});
  await say({msg: {text: '進來，好接著在教材的地方'}, audioMs: 11000});
  await say({quality: {seq: 1, throughMs: 10000, final: false, sentences: [
    {id: 1, source: '這裡我們回到第二層目錄。', target: '', lang: 'zh', startMs: 0, endMs: 3000},
    {id: 2, source: '我們回到上一層這地方來去新增目錄。', target: '', lang: 'zh', startMs: 3200, endMs: 7000},
    {id: 3, source: '好，我們點進來。', target: '', lang: 'zh', startMs: 7500, endMs: 10000}]}, audioMs: 11500});
  const shown = () => page.evaluate(() => { const el = document.getElementById('transcript'); return [el.querySelector('.quality-kept')?.textContent || '', el.querySelector('.quality-live')?.textContent || '']; });
  t('flow: three close sentences in one paragraph, live text without the repeated 點進來',
    await shown(), ['這裡我們回到第二層目錄。我們回到上一層這地方來去新增目錄。好，我們點進來。', '好接著在教材的地方']);
  await say({quality: {seq: 2, throughMs: 20000, final: false, sentences: [{id: 4, source: '接著在教材的地方點進來。', target: '', lang: 'zh', startMs: 14000, endMs: 20000}]}, audioMs: 21000});
  t('flow: after a 4 s pause the next sentence starts a paragraph',
    (await shown())[0], '這裡我們回到第二層目錄。我們回到上一層這地方來去新增目錄。好，我們點進來。\n\n接著在教材的地方點進來。');
  t('flow: the meeting was created through the stub, not the database', stored[0], 'POST /api/meetings');
  if (process.env.FLOW_SHOT) await page.locator('#transcript').screenshot({path: process.env.FLOW_SHOT});
  await context.close();
}
await browser.close();
