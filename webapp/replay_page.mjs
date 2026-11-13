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
  // Signed in with YUQIAO_SESSION (python -m auth issue-session); YUQIAO_TEAM picks the meeting's team.
  if (!process.env.YUQIAO_SESSION) throw new Error('Set YUQIAO_SESSION (python -m auth issue-session <username> in the app container)');
  const context = await browser.newContext();
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: cfg.app}]);
  const page = await context.newPage();
  page.on('pageerror', error => console.error('pageerror:', error.message));
  page.on('crash', () => console.error('page crashed'));
  await page.goto(cfg.app);
  const team = await page.evaluate(async name => {
    const {teams} = await window.accountReady, chosen = name ? teams.find(t => t.name === name) : teams.length === 1 ? teams[0] : null;
    if (chosen) $('team').value = String(chosen.id);
    return chosen?.name || null;
  }, process.env.YUQIAO_TEAM || '');
  if (!team) throw new Error("Set YUQIAO_TEAM to one of this user's teams");
  await page.evaluate(config => { window.__replayConfig = config; }, cfg.replay);
  await page.evaluate(inject);
  await page.click('#start');
  await page.waitForFunction(() => window.__replay.done, null, {timeout: (cfg.replay.duration + 180) * 1000, polling: 1000})
    .catch(() => console.error('WARNING: replay did not settle before the deadline; report is partial'));
  const data = await page.evaluate(() => ({log: __replay.log, requests: __replay.requests, audioEnded: __replay.audioEnded,
    transcript, learned: learnedTerms,
    // 精準模式: what the meeting keeps is the quality pass's sentences, one per segment, in order.
    quality: qualityOn ? {failures: quality.failures, done: quality.done, throughMs: quality.throughMs, promoted: quality.records.filter(s => s.live).length} : null,
    segments: qualityOn ? outputRecords().map((s, i) => ({...s, id: `quality:${i}`, state: 'finalized', start: i, end: i + 1, version: 1})) : [...segmentRecords.values()]}));
  writeFileSync(outPath, JSON.stringify(data, null, 1));
} finally {
  await browser.close();
}
