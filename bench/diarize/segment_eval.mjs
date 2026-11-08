// Record a real meeting from a WAV played as the microphone (the local engine, meeting mode) for segment-level speaker
// evaluation; prints the meeting id. The meeting is kept: score it with segment_eval.py once its diarization is done,
// then remove it with --delete.
// Usage: YUQIAO_SESSION=<token> node bench/diarize/segment_eval.mjs <16k wav> <seconds>
//        node bench/diarize/segment_eval.mjs --delete <meeting id>
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = process.env.YUQIAO_APP || 'http://localhost:18082';
const DB = process.env.YUQIAO_DB_CONTAINER || 'asr_confucius4-r2t2-db-1', APP = process.env.YUQIAO_APP_CONTAINER || 'asr_confucius4-r2t2-app-1';
const sql = query => execFileSync('docker', ['exec', DB, 'psql', '-U', 'yuqiao', '-d', 'yuqiao', '-v', 'ON_ERROR_STOP=1', '-qtAc', query], {encoding: 'utf8'}).trim();
if (process.argv[2] === '--delete') {
  const id = process.argv[3];
  if (!/^[0-9a-f-]{36}$/.test(id || '')) { console.error('meeting id expected'); process.exit(2); }
  const team = sql(`SELECT team_id FROM meetings WHERE id = '${id}'`);
  sql(`DELETE FROM meetings WHERE id = '${id}'`);
  if (team) execFileSync('docker', ['exec', APP, 'rm', '-rf', `/output/teams/${team}/${id}`]);
  console.log(`removed ${id}`);
  process.exit(0);
}
const [wav, seconds] = process.argv.slice(2);
if (!process.env.YUQIAO_SESSION || !wav || !seconds) { console.error('Usage: YUQIAO_SESSION=<token> node bench/diarize/segment_eval.mjs <wav> <seconds>'); process.exit(2); }
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch({args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`]});
try {
  const context = await browser.newContext({permissions: ['microphone']});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  await page.goto(`${app}/`); await page.evaluate(() => window.accountReady);
  await page.selectOption('#language', 'zh'); await page.selectOption('#audioSource', 'microphone');
  await page.fill('#topic', `說話者段落評估 ${Date.now() % 100000}`);
  await page.click('#start'); await page.waitForTimeout(Number(seconds) * 1000);
  await page.evaluate(() => document.getElementById('start').click());
  await page.waitForFunction(() => !stream && !activeTranslation && !translationTimer && !segmentSaveTimer, null, {timeout: 180000, polling: 500});
  console.log(await page.evaluate(() => meetingId));
} finally {
  await browser.close();
}
