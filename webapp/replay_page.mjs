// Drive one replay in headless Chromium: open the app, inject replay_inject.js, press start,
// wait until the translation pane settles, then dump the timeline as JSON.
// Usage: node replay_page.mjs CONFIG.json OUT.json   (called by replay_browser.py)
// Uses gstack's Playwright install by default so no second browser is downloaded.
import {readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const [configPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const inject = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'replay_inject.js'), 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('pageerror:', error.message));
  page.on('crash', () => console.error('page crashed'));
  await page.goto(cfg.app);
  await page.evaluate(config => { window.__replayConfig = config; }, cfg.replay);
  await page.evaluate(inject);
  await page.click('#start');
  await page.waitForFunction(() => window.__replay.done, null, {timeout: (cfg.replay.duration + 180) * 1000, polling: 1000})
    .catch(() => console.error('WARNING: replay did not settle before the deadline; report is partial'));
  const data = await page.evaluate(() => ({log: __replay.log, requests: __replay.requests, audioEnded: __replay.audioEnded,
    transcript, learned: learnedTerms, segments: [...segmentRecords.values()]}));
  writeFileSync(outPath, JSON.stringify(data, null, 1));
} finally {
  await browser.close();
}
