// transcript-only in a real browser (Playwright, gstack's install). The live page's recognition and meeting are answered
// by the test, so nothing is recognized or translated; the review page uses one real meeting it creates, titled
// 驗收 不翻譯 <time>, in the signed-in user's first team.
//   - 開會 offers 不翻譯（只整理原文）; 即時翻譯 does not; the choice is remembered
//   - no translation, term or refinement request; no translation pane; subtitles show the spoken text
//   - the stream asks 精準模式 for target "none"; saved segments have no translation, the meeting's target is none
//   - the review page of such a meeting has no 譯文 column and an edit is not retranslated
// Usage: YUQIAO_SESSION=<session of a user in a team> node bench/transcript_only_e2e.mjs [app url]
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const json = body => ({status: 200, contentType: 'application/json', body: JSON.stringify(body)});

const context = await browser.newContext({viewport: {width: 1440, height: 900}});
await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app + '/'}]);
const page = await context.newPage();
const seen = {translations: 0, header: null, segments: null};
page.on('request', r => { if (/\/api\/(translate|terms|refine)/.test(new URL(r.url()).pathname)) seen.translations++; });
await page.route(`${app}/api/meetings`, route => route.request().method() === 'POST' ? route.fulfill(json({id: 'm-transcript-only'})) : route.continue());
await page.route(`${app}/api/meetings/m-transcript-only/**`, route => {
  if (route.request().url().endsWith('/segments')) seen.segments = route.request().postDataJSON();
  route.fulfill(json({saved: 1}));
});
await page.routeWebSocket('**/ws/transcribe', ws => ws.onMessage(message => {
  if (typeof message !== 'string') return;
  if (message === 'YOUDAO_ONETIME_ASR_STREAM_EOS') { ws.close(); return; }
  seen.header = JSON.parse(message);
  ws.send(JSON.stringify({msg: {text: '大家好，今天開會。', speech_end: true}, displayText: '大家好，今天開會。', audioMs: 2000}));
  setTimeout(() => ws.send(JSON.stringify({msg: {text: '先看上週的進度。', speech_end: true}, displayText: '大家好，今天開會。先看上週的進度。', audioMs: 4000})), 400);
}));
await page.goto(app + '/');
await page.evaluate(() => { localStorage.setItem('liveMode', 'meeting'); localStorage.removeItem('meetingTarget'); localStorage.removeItem('meetingLanguage'); });
await page.reload(); await page.waitForLoadState('networkidle');

// --- The choice
const option = () => page.evaluate(() => { const o = document.querySelector('#targetLanguage option[value="none"]'); return o ? [o.textContent, o.hidden] : null; });
t('開會 offers 不翻譯 first', [await option(), await page.evaluate(() => document.querySelector('#targetLanguage option:not([hidden])').value)], [['不翻譯（只整理原文）', false], 'none']);
await page.selectOption('#language', 'zh');
await page.selectOption('#targetLanguage', 'none');
const layout = () => page.evaluate(() => ({noTranslation: document.body.classList.contains('no-translation'),
  pane: getComputedStyle(document.querySelector('.translation-card')).display, transcript: Math.round(document.querySelector('.transcript-card').getBoundingClientRect().width),
  all: Math.round(document.querySelector('.transcripts').getBoundingClientRect().width), swap: document.getElementById('swap').disabled,
  refine: getComputedStyle(document.getElementById('cloudRefineRow')).display}));
const chosen = await layout();
t('no translation pane, the transcript takes the width, nothing to swap or refine',
  [chosen.noTranslation, chosen.pane, chosen.transcript === chosen.all, chosen.swap, chosen.refine], [true, 'none', true, true, 'none']);
await page.click('#modeTranslate');
t('即時翻譯 does not offer it and translates', [(await option())[1], await page.inputValue('#targetLanguage'), (await layout()).noTranslation], [true, 'en', false]);
await page.click('#modeMeeting');
t('back in 開會 the choice is back', [await page.inputValue('#targetLanguage'), (await layout()).noTranslation], ['none', true]);
await page.selectOption('#language', 'zh_ja'); await page.click('#modeTranslate'); await page.selectOption('#language', 'zh');
t('不翻譯 via 中日雙向 never reaches 即時翻譯', [await page.inputValue('#targetLanguage'), (await layout()).noTranslation], ['en', false]);
await page.click('#modeMeeting');
if (await page.locator('#modeInterpret').isEnabled()) {
  await page.click('#modeInterpret'); await page.click('#modeMeeting');
  t('back from 即時口譯, 不翻譯 is offered and chosen again', [(await option())[1], await page.inputValue('#targetLanguage')], [false, 'none']);
}
await page.reload(); await page.waitForLoadState('networkidle');
t('the spoken language and 不翻譯 are remembered after a reload', [await page.inputValue('#language'), await page.inputValue('#targetLanguage')], ['zh', 'none']);

// --- A meeting without translation
await page.click('#start');
await page.waitForTimeout(2500);
const live = await page.evaluate(() => ({transcript: document.getElementById('transcript').innerText, subtitles: subtitleParts()}));
t('the stream asks for no translation', [seen.header?.target, seen.header?.mode], ['none', 'meeting']);
t('the transcript shows the speech', live.transcript.includes('先看上週的進度。'), true);
t('subtitles show the spoken text (finished, then the rest as the draft)', (live.subtitles.translation + live.subtitles.draft).includes('大家好，今天開會。'), true);
await page.click('#start');
await page.waitForTimeout(2500);
t('no translation, term or refinement request', seen.translations, 0);
const saved = seen.segments?.segments || [];
t('saved segments: all the spoken text, no translation, target none',
  [seen.segments?.targetLanguage, saved.map(s => s.source).join(''), saved.every(s => s.target === '')],
  ['none', '大家好，今天開會。先看上週的進度。', true]);
await page.unrouteAll({behavior: 'ignoreErrors'});

// --- The review page of a meeting without translation (a real meeting)
const me = await (await context.request.get(`${app}/api/me`)).json();
const created = await (await context.request.post(`${app}/api/meetings`, {data: {team_id: me.teams[0].id, language: 'zh', title: `驗收 不翻譯 ${new Date().toISOString().slice(11, 19)}`}})).json();
await context.request.put(`${app}/api/meetings/${created.id}/segments`, {data: {glossary: '', learned: '', sourceLanguage: 'zh', targetLanguage: 'none',
  segments: [{seq: 1, startMs: 0, endMs: 2000, source: '大家好，今天開會。', target: '', detected: ''}], merged: []}});
const review = await context.newPage();
let retranslations = 0;
review.on('request', r => { if (/\/api\/translate/.test(new URL(r.url()).pathname)) retranslations++; });
await review.goto(`${app}/meetings/${created.id}`); await review.waitForLoadState('networkidle');
t('the review page has no 譯文 column', await review.evaluate(() => document.querySelector('main').classList.contains('no-target')), true);
await review.locator('.seg-source').first().click(); await review.getByRole('button', {name: '修改原文'}).click(); await review.waitForTimeout(300);
const editButtons = await review.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent));
t('no 重譯 action on the page', [editButtons.some(text => text.includes('重譯')), editButtons.includes('儲存')], [false, true]);
await review.evaluate(() => saveEdit(1, '大家好，今天開週會。', document.createElement('button')));
await review.waitForTimeout(800);
t('an edit is saved, not retranslated', [retranslations, await review.evaluate(() => document.body.innerText.includes('已儲存'))], [0, true]);
await browser.close();
