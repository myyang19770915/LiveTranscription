// End-to-end acceptance for speaker-diarization and speaker-timeline in the real pages (Playwright, gstack's install): record a meeting
// with a multi-speaker WAV as the microphone, let the closed recording queue its diarization, wait for it, then on the
// review page check the timeline (lanes, bars, playback from a turn with the text following it), name a speaker as a
// team member with a role, move a segment to another speaker, add a speaker, reload, and check the page at 400 px. The test meeting (database rows and output folder) is deleted at the end.
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

  // 3. The review page: cards, the timeline lanes (speaker-timeline) and a speaker menu on every row.
  await page.goto(`${app}/meetings/${meetingId}`); await page.waitForSelector('.seg');
  await page.waitForSelector('#speakers:not([hidden]) .spk-card');
  const panelText = await page.textContent('.speakers-status');
  check('panel reports the diarization', simulate ? panelText.startsWith('說話者辨識未設定（以下是先前的結果）') : panelText.startsWith('點卡片可以指定為團隊成員'), panelText);
  check('a speaker menu on every row', (await page.$$('.seg .spk-select')).length === (await page.$$('.seg')).length);
  if (!simulate) {
    check('one card and one lane per speaker', (await page.$$('.spk-card')).length === state.speakers.length && (await page.$$('.spk-lane')).length === state.speakers.length);
    check('header shows the recording length and speaker count', (await page.textContent('.speakers-meta')).endsWith(`${state.speakers.length} 位說話者`), await page.textContent('.speakers-meta'));
    const [t0] = state.turns;
    const bar = await page.$eval('.spk-turn[data-turn="0"]', b => ({left: parseFloat(b.style.left), width: parseFloat(b.style.width), title: b.title}));
    check('turn bars are placed in proportion to the recording', Math.abs(bar.left - t0[0] / state.durationMs * 100) < 0.01 && Math.abs(bar.width - (t0[1] - t0[0]) / state.durationMs * 100) < 0.01 && bar.title.includes(t0[3]), bar);
  }
  check('no stray text in the panel', !(await page.textContent('#speakers')).includes('null'));
  await page.screenshot({path: join(out, 'speakers-review.png'), fullPage: false});

  // 4. Name speaker 1 as a team member with a role: its card and every row of speaker 1 show it.
  await page.click('.spk-card >> nth=0');
  check('selecting a card emphasises its lane', simulate || await page.$eval('.spk-lanes', l => l.classList.contains('has-selected') && l.querySelector('.spk-lane.selected .spk-lane-label').textContent === 'S1'));
  const member = await page.$eval('.spk-edit select option:nth-child(2)', o => ({value: o.value, name: o.textContent}));
  await page.selectOption('.spk-edit select', member.value);
  await page.fill('.spk-edit input[aria-label="角色"]', '主持人');
  await page.click('.spk-edit button[type=submit]');
  await page.waitForFunction(name => document.querySelector('.spk-card b').textContent === name, member.name);
  check('the card shows the role', await page.textContent('.spk-card small') === '主持人');
  const rowsOf1 = await page.$$eval('.seg .spk-select', (menus, name) => menus.filter(m => m.value === '1').map(m => m.selectedOptions[0].textContent === name), member.name);
  check('naming speaker 1 renames all of its rows', rowsOf1.length > 0 && rowsOf1.every(Boolean), {rows: rowsOf1.length, name: member.name});

  // 5. Timeline playback: from a turn of at least 3 s, the play line moves, the text follows, the segment is marked.
  if (!simulate) {
    const index = state.turns.findIndex(t => t[1] - t[0] >= 3000);
    const turn = state.turns[index];
    await page.click(`.spk-turn[data-turn="${index}"]`);
    await page.waitForTimeout(1500);
    const a = await page.evaluate(() => ({head: parseFloat(document.querySelector('.spk-playhead').style.left), hidden: document.querySelector('.spk-playhead').hidden,
      who: document.querySelector('.spk-now-who b').textContent, said: document.querySelector('.spk-now .said').textContent,
      rest: document.querySelector('.spk-now .rest').textContent, playing: document.querySelector('.spk-turn.playing')?.dataset.turn,
      toggle: document.querySelector('.spk-toggle').textContent, speaking: document.querySelector('.seg.speaking')?.id}));
    await page.waitForTimeout(1500);
    const b = await page.evaluate(() => ({head: parseFloat(document.querySelector('.spk-playhead').style.left), said: document.querySelector('.spk-now .said').textContent}));
    const shown = state.speakers.find(s => s.label === turn[2]);
    const expectedWho = turn[2] === 1 ? member.name : shown.shown;
    check('clicking a turn plays from it: the play line moves', !a.hidden && b.head > a.head && a.toggle === '❚❚ 暫停', {a: a.head, b: b.head, toggle: a.toggle});
    check('the now-playing area shows the turn and highlights the spoken part', a.who === expectedWho && a.said + a.rest === turn[3] && a.said.length > 0 && b.said.length >= a.said.length,
      {who: a.who, expectedWho, said: a.said, text: turn[3]});
    await page.screenshot({path: join(out, 'speakers-timeline-playing.png'), fullPage: false});
    check('the turn being played is emphasised and a segment is marked', a.playing === String(index) && !!a.speaking, {playing: a.playing, speaking: a.speaking});
    await page.click('.spk-toggle');
    const paused = await page.evaluate(() => parseFloat(document.querySelector('.spk-playhead').style.left));
    await page.waitForTimeout(1000);
    check('pause stops the play line', await page.evaluate(() => parseFloat(document.querySelector('.spk-playhead').style.left)) === paused && await page.textContent('.spk-toggle') === '▶ 繼續');
    // The next turn by another speaker, close after a short one: the area follows without another click.
    const next = state.turns.findIndex((t, i) => i > 0 && t[2] !== state.turns[i - 1][2] && t[0] - state.turns[i - 1][1] < 1500 && t[1] - t[0] > 1500
      && state.turns[i - 1][1] - state.turns[i - 1][0] < 5000 && !state.turns.some((o, j) => j !== i && j !== i - 1 && o[0] < t[0] + 1000 && o[1] > state.turns[i - 1][0]));
    if (next > 0) {
      const prev = state.turns[next - 1], nextTurn = state.turns[next];
      await page.click(`.spk-turn[data-turn="${next - 1}"]`);
      await page.waitForFunction(i => document.querySelector('.spk-turn.playing')?.dataset.turn === String(i), next, {timeout: (prev[1] - prev[0]) + 8000});
      const moved = await page.evaluate(() => ({who: document.querySelector('.spk-now-who b').textContent, text: document.querySelector('.spk-now .said').textContent + document.querySelector('.spk-now .rest').textContent}));
      check('playback continues into the next turn and the area follows', moved.text === nextTurn[3], {moved, expected: nextTurn[3]});
    } else console.log('note: no adjacent short turn pair in this clip; continuing-into-next-turn not checked');
    await page.click('.seg .seg-time >> nth=0'); await page.waitForTimeout(1500);
    check('segment playback stops timeline playback', await page.evaluate(() => !document.querySelector('.spk-now').classList.contains('active') && document.querySelector('.spk-playhead').hidden));
    await page.click('.spk-turn[data-turn="0"]'); await page.waitForTimeout(1500);
    check('timeline playback stops segment playback', await page.evaluate(() => document.getElementById('player').paused && document.querySelector('.spk-now').classList.contains('active')));
    await page.click('.spk-toggle');
    check('after pausing, the area still shows the turn; play resumes from there', (await page.textContent('.spk-toggle')) === '▶ 繼續');
  }

  // 6. Move segment 1 to speaker 2, and segment 2 to a new speaker (no turns: an empty lane).
  const first = await page.$eval('.seg .spk-select', m => m.closest('.seg').id);
  await page.selectOption(`#${first} .spk-select`, '2');
  await page.waitForFunction(id => document.querySelector(`#${id} .spk-select`).value === '2', first);
  const second = await page.$eval('.seg:nth-child(2)', e => e.id);
  const before = (await page.$$('.spk-card')).length;
  await page.selectOption(`#${second} .spk-select`, 'new');
  await page.waitForFunction(n => document.querySelectorAll('.spk-card').length === n + 1, before);
  check('a new speaker can be added from a row', simulate || await page.$$eval('.spk-lane', lanes => lanes.at(-1).querySelectorAll('.spk-turn').length === 0), {speakers: before + 1});

  // 7. Reload: names, roles and choices are kept; clicking a menu does not open the row.
  await page.reload(); await page.waitForSelector('#speakers:not([hidden]) .spk-card');
  const kept = await page.evaluate(([a, b]) => ({a: document.querySelector(`#${a} .spk-select`).value, b: document.querySelector(`#${b} .spk-select`).selectedOptions[0].textContent,
    name: document.querySelector('.spk-card b').textContent, role: document.querySelector('.spk-card small').textContent}), [first, second]);
  check('choices, names and roles survive a reload', kept.a === '2' && kept.b === `說話者 ${before + 1}` && kept.name === member.name && kept.role === '主持人', kept);
  await page.click(`#${first} .spk-select`); await page.keyboard.press('Escape');
  check('the speaker menu does not open the row', !(await page.$eval(`#${first}`, e => e.classList.contains('open'))));

  // 8. Phone width: no horizontal scrolling; light theme.
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
