// End-to-end acceptance for speaker-diarization in the real pages (Playwright, gstack's install): record a meeting
// with a multi-speaker WAV as the microphone, let the closed recording queue its diarization, wait for it, then on the
// review page name a speaker as a team member, move a segment to another speaker, add a speaker, reload, and check the
// page at 400 px. The test meeting (database rows and output folder) is deleted at the end.
// Without a running diarize service (DIARIZE_URL unset in the app) the diarization result is written straight into the
// database (--simulate is then implied) so the page can still be checked; the output says which mode ran.
// Usage: YUQIAO_SESSION=<token> node bench/speakers_e2e.mjs <16k multi-speaker wav> <screenshot dir> [--simulate] [--keep]
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const args = process.argv.slice(2);
const [wav, out] = args.filter(a => !a.startsWith('--'));
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
const DB = process.env.YUQIAO_DB_CONTAINER || 'asr_confucius4-r2t2-db-1', APP = process.env.YUQIAO_APP_CONTAINER || 'asr_confucius4-r2t2-app-1';
if (!process.env.YUQIAO_SESSION || !wav || !out) { console.error('Usage: YUQIAO_SESSION=<token> node bench/speakers_e2e.mjs <wav> <dir> [--simulate] [--keep]'); process.exit(2); }
const sql = query => execFileSync('docker', ['exec', DB, 'psql', '-U', 'yuqiao', '-d', 'yuqiao', '-v', 'ON_ERROR_STOP=1', '-qtAc', query], {encoding: 'utf8'}).trim();
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]});
let failed = false, meetingId = null, teamId = null;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, permissions: ['microphone']});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'dark'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  page.on('dialog', dialog => dialog.accept());
  const api = async path => (await page.request.get(`${app}${path}`)).json();

  // 1. A real meeting: the WAV plays as the microphone for 70 s (the local engine), then stop.
  await page.goto(`${app}/`); await page.evaluate(() => window.accountReady);
  await page.selectOption('#language', 'zh'); await page.selectOption('#audioSource', 'microphone');
  await page.fill('#topic', `說話者辨識驗收 ${Date.now() % 100000}`);
  await page.click('#start'); await page.waitForTimeout(70000);
  await page.evaluate(() => document.getElementById('start').click());
  await page.waitForFunction(() => !stream && !activeTranslation && !translationTimer && !segmentSaveTimer, null, {timeout: 120000, polling: 500});
  meetingId = await page.evaluate(() => meetingId);
  const meeting = await api(`/api/meetings/${meetingId}`);
  teamId = meeting.teamId;
  check('meeting stored segments and a recording', meeting.segments.length >= 3 && meeting.hasRecording, {segments: meeting.segments.length});

  // 2. Diarization: queued by the closed recording and run by the service, or simulated.
  let state = await api(`/api/meetings/${meetingId}/speakers`);
  const simulate = args.includes('--simulate') || !state.configured;
  console.log(simulate ? 'mode: SIMULATED diarization (no diarize service configured in the app)' : 'mode: real diarize service');
  if (!simulate) {
    check('closing the recording queued the diarization', ['queued', 'running', 'done'].includes(state.status), state.status);
    const started = Date.now();
    while (['queued', 'running'].includes(state.status) && Date.now() - started < 15 * 60000) {
      await page.waitForTimeout(5000); state = await api(`/api/meetings/${meetingId}/speakers`);
    }
    check('diarization finished', state.status === 'done', {status: state.status, message: state.message, seconds: (Date.now() - started) / 1000});
    check('more than one speaker found in a 4-speaker recording', state.speakers.length >= 2, state.speakers.map(s => s.shown));
  } else {
    sql(`INSERT INTO diarizations (meeting_id, status, turns, finished_at, seconds) VALUES ('${meetingId}', 'done', '[]', now(), 1);
         INSERT INTO meeting_speakers (meeting_id, label) VALUES ('${meetingId}', 1), ('${meetingId}', 2), ('${meetingId}', 3);
         UPDATE segments SET speaker = 1 + (seq % 3) WHERE meeting_id = '${meetingId}';`);
    state = await api(`/api/meetings/${meetingId}/speakers`);
  }
  const labelled = (await api(`/api/meetings/${meetingId}`)).segments.filter(s => s.speaker != null).length;
  check('most segments have a speaker', labelled >= meeting.segments.length * 0.6, {labelled, of: meeting.segments.length});

  // 3. The review page: panel, list and a speaker menu on every row.
  await page.goto(`${app}/meetings/${meetingId}`); await page.waitForSelector('.seg');
  await page.waitForSelector('#speakers:not([hidden]) .spk-name');
  const panelText = await page.textContent('.speakers-status');
  check('panel reports the diarization', simulate ? panelText.startsWith('說話者辨識未設定（以下是先前的結果）') : panelText.startsWith(`已辨識出 ${state.speakers.length} 位說話者`), panelText);
  check('a speaker menu on every row', (await page.$$('.seg .spk-select')).length === (await page.$$('.seg')).length);
  await page.screenshot({path: join(out, 'speakers-review.png'), fullPage: false});

  // 4. Name speaker 1 as a team member: every row of speaker 1 shows that name.
  await page.click('.spk-name >> nth=0');
  const member = await page.$eval('.spk-edit select option:nth-child(2)', o => ({value: o.value, name: o.textContent}));
  await page.selectOption('.spk-edit select', member.value);
  await page.click('.spk-edit button[type=submit]');
  await page.waitForFunction(name => document.querySelector('.spk-name span').textContent === name, member.name);
  const rowsOf1 = await page.$$eval('.seg .spk-select', (menus, name) => menus.filter(m => m.value === '1').map(m => m.selectedOptions[0].textContent === name), member.name);
  check('naming speaker 1 renames all of its rows', rowsOf1.length > 0 && rowsOf1.every(Boolean), {rows: rowsOf1.length, name: member.name});

  // 5. Move segment 1 to speaker 2, and segment 2 to a new speaker.
  const first = await page.$eval('.seg .spk-select', m => m.closest('.seg').id);
  await page.selectOption(`#${first} .spk-select`, '2');
  await page.waitForFunction(id => document.querySelector(`#${id} .spk-select`).value === '2', first);
  const second = await page.$eval('.seg:nth-child(2)', e => e.id);
  const before = (await page.$$('.spk-name')).length;
  await page.selectOption(`#${second} .spk-select`, 'new');
  await page.waitForFunction(n => document.querySelectorAll('.spk-name').length === n + 1, before);
  check('a new speaker can be added from a row', true, {speakers: before + 1});

  // 6. Reload: names and choices are kept; clicking a menu does not open the row.
  await page.reload(); await page.waitForSelector('#speakers:not([hidden]) .spk-name');
  const kept = await page.evaluate(([a, b]) => ({a: document.querySelector(`#${a} .spk-select`).value, b: document.querySelector(`#${b} .spk-select`).selectedOptions[0].textContent,
    name: document.querySelector('.spk-name span').textContent}), [first, second]);
  check('choices and names survive a reload', kept.a === '2' && kept.b === `說話者 ${before + 1}` && kept.name === member.name, kept);
  await page.click(`#${first} .spk-select`); await page.keyboard.press('Escape');
  check('the speaker menu does not open the row', !(await page.$eval(`#${first}`, e => e.classList.contains('open'))));

  // 7. Phone width: no horizontal scrolling; light theme.
  await page.setViewportSize({width: 400, height: 860});
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  check('no horizontal overflow at 400 px', await page.evaluate(() => document.documentElement.scrollWidth <= 400), await page.evaluate(() => document.documentElement.scrollWidth));
  await page.screenshot({path: join(out, 'speakers-review-400.png'), fullPage: false});
} catch (error) {
  check('run without exceptions', false, String(error?.stack || error).slice(0, 600));
} finally {
  await browser.close();
  if (meetingId && !args.includes('--keep')) {
    sql(`DELETE FROM meetings WHERE id = '${meetingId}'`);
    if (teamId) execFileSync('docker', ['exec', APP, 'rm', '-rf', `/output/teams/${teamId}/${meetingId}`]);
    console.log(`removed test meeting ${meetingId}`);
  }
}
process.exit(failed ? 1 : 0);
