// web-platform-polish: input-method safe series naming, the sentence menu and the avatar menu as popovers (top layer,
// light dismiss, keyboard), their 150ms fade-in, and the settings dialog closing on a backdrop tap (meeting-series,
// meeting-setup-layout, site-navigation, visual-tokens). Nothing is saved: POST /api/meetings and POST /api/teams/*/series
// are aborted, and the series requests are only counted.
// Usage: YUQIAO_SESSION=… node bench/web_platform_polish_e2e.mjs [app url]   (WPP_SHOTS=<folder> also saves screenshots)
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const app = (process.argv[2] || 'http://localhost:18082/').replace(/\/$/, '');
const shots = process.env.WPP_SHOTS || '';
const t = (name, got, want) => {const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got)); if (!ok) process.exitCode = 1};
const modulePath = process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js');
const {chromium} = (await import(pathToFileURL(modulePath).href)).default;
const browser = await chromium.launch({args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']});

async function open(path, {width = 1440, height = 900, theme = 'dark', reducedMotion = 'no-preference', init = null} = {}) {
  const context = await browser.newContext({permissions: ['microphone'], viewport: {width, height}, reducedMotion});
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: app}]);
  await context.addInitScript(theme => { try { localStorage.setItem('interpreter-theme', theme); } catch {} }, theme);
  if (init) await context.addInitScript(init);
  const series = [];
  await context.route('**/api/meetings**', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await context.route('**/api/teams/*/series**', route => {
    if (route.request().method() !== 'POST') return route.continue();
    series.push(route.request().postData());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(app + path);
  await page.waitForTimeout(1500);
  return {context, page, errors, series};
}

// --- meeting-series "Naming a new series works with input methods" ---
{
  const {context, page, errors, series} = await open('/');
  const ready = await page.evaluate(() => {
    const row = document.getElementById('newSeries'), input = document.getElementById('seriesName');
    if (!row || !input) return false;
    document.getElementById('seriesRow').hidden = false;
    row.hidden = false; input.disabled = false; input.value = '研發週會';
    return true;
  });
  t('the new-series row can be shown', ready, true);
  const press = (key, isComposing, keyCode) => page.evaluate(([key, isComposing, keyCode]) => {
    const event = new KeyboardEvent('keydown', {key, isComposing, bubbles: true, cancelable: true});
    Object.defineProperty(event, 'keyCode', {value: keyCode});
    document.getElementById('seriesName').dispatchEvent(event);
  }, [key, isComposing, keyCode]);
  const state = async () => { await page.waitForTimeout(300); return {requests: series.length, closed: await page.evaluate(() => document.getElementById('newSeries').hidden), text: await page.inputValue('#seriesName')}; };
  await press('Enter', true, 13);   // isComposing alone, as the example table states
  t('Enter while composing: no request, row open, text kept', await state(), {requests: 0, closed: false, text: '研發週會'});
  await press('Enter', false, 229);
  t('Enter with keyCode 229 (Safari order): no request, row open', await state(), {requests: 0, closed: false, text: '研發週會'});
  await press('Escape', true, 27);
  t('Escape while composing: row stays open', await state(), {requests: 0, closed: false, text: '研發週會'});
  await press('Enter', false, 13);
  const sent = await state();
  t('Enter after the composition: one request with the name', [sent.requests, (series[0] || '').includes('研發週會')], [1, true]);
  await page.evaluate(() => { document.getElementById('newSeries').hidden = false; document.getElementById('seriesName').disabled = false; });
  await press('Escape', false, 27);
  const escaped = await state();
  t('Escape outside a composition closes the row and sends nothing', [escaped.closed, escaped.requests], [true, 1]);
  t('series: no page errors', errors, []);
  await context.close();
}

// --- meeting-setup-layout "The sentence menu is a popover", visual-tokens "Menus fade in when they open" ---
const sentenceMenu = page => page.evaluate(() => {
  const m = document.getElementById('sentenceMenu');
  return m ? {popover: m.getAttribute('popover'), open: m.matches(':popover-open'), visible: m.checkVisibility()} : null;
});
const fadeOf = (selector, click) => page => page.evaluate(([selector, click]) => new Promise(resolve => {
  document.querySelector(click).click();
  requestAnimationFrame(() => {
    const m = document.querySelector(selector);
    const anims = m.getAnimations().map(a => ({property: a.transitionProperty, duration: a.effect.getTiming().duration}));
    resolve({opacity: anims.some(a => a.property === 'opacity' && a.duration === 150), translate: getComputedStyle(m).translate});
  });
}), [selector, click]);
for (const theme of ['dark', 'light']) {
  const {context, page, errors} = await open('/', {theme});
  await page.evaluate(() => { const el = document.getElementById('team'); if (el.options.length < 2) el.append(new Option('測試團隊乙', 'zz-test')); el.hidden = false; el.dispatchEvent(new Event('change')); });
  const teamWord = page.locator('#setupSentence button.sentence-pick[data-field="team"]');
  const wordBottom = await teamWord.evaluate(b => Math.round(b.getBoundingClientRect().bottom));
  await teamWord.click(); await page.waitForTimeout(250);
  const m = await sentenceMenu(page);
  const top = await page.evaluate(() => Math.round(document.getElementById('sentenceMenu').getBoundingClientRect().top));
  t(`${theme}: the team menu is an open popover right below the word`, [m, top >= wordBottom && top <= wordBottom + 8], [{popover: 'auto', open: true, visible: true}, true]);
  if (shots) await page.screenshot({path: join(shots, `sentence-menu-1440-${theme}.png`)});
  if (theme === 'dark') {
    const before = await page.evaluate(() => document.getElementById('team').value);
    await teamWord.click(); await page.waitForTimeout(250);
    t('pressing the same word again closes it and it stays closed', [(await sentenceMenu(page)).open, await page.evaluate(before => document.getElementById('team').value === before ? 'same' : 'changed', before)], [false, 'same']);
    t('aria-expanded follows', await teamWord.getAttribute('aria-expanded'), 'false');
    await teamWord.click(); await page.waitForTimeout(200); await page.mouse.click(700, 700); await page.waitForTimeout(200);
    t('a click outside closes (light dismiss)', [(await sentenceMenu(page)).open, await teamWord.getAttribute('aria-expanded')], [false, 'false']);
    await page.waitForTimeout(200);
    t('the menu fades in over 150ms', (await fadeOf('#sentenceMenu', '#setupSentence button.sentence-pick[data-field="team"]')(page)).opacity, true);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    t('Escape closes, focus on the word', await page.evaluate(() => [document.getElementById('sentenceMenu').matches(':popover-open'), document.activeElement?.dataset?.field]), [false, 'team']);
  }
  t(`${theme}: sentence menu: no page errors`, errors, []);
  await context.close();
}
{
  const {context, page} = await open('/', {reducedMotion: 'reduce'});
  const fade = await fadeOf('#sentenceMenu', '#setupSentence button.sentence-pick[data-field="team"]')(page);
  t('reduced motion: the sentence menu does not move', fade.translate, 'none');
  await context.close();
}

// --- site-navigation "The avatar menu works from the keyboard" ---
const avatar = page => page.evaluate(() => {
  const m = document.querySelector('.account-menu'), b = document.querySelector('.account-avatar');
  const items = [...m.querySelectorAll('[role=menuitem]')].filter(i => i.checkVisibility());
  return {popover: m.getAttribute('popover'), open: m.matches(':popover-open'), expanded: b.getAttribute('aria-expanded'),
    focus: document.activeElement?.closest('.account-menu') ? document.activeElement.textContent.trim() : (document.activeElement === b ? 'avatar' : null),
    items: items.map(i => i.textContent.trim()), below: Math.round(m.getBoundingClientRect().top) > Math.round(b.getBoundingClientRect().bottom),
    right: Math.abs(m.getBoundingClientRect().right - b.getBoundingClientRect().right) <= 1};
});
for (const theme of ['dark', 'light']) {
  const {context, page, errors} = await open('/meetings', {theme});
  await page.click('.account-avatar'); await page.waitForTimeout(250);
  const a = await avatar(page);
  t(`${theme}: the avatar menu opens as a popover below the avatar, right edges aligned, focus on the first item`,
    [a.popover, a.open, a.expanded, a.below, a.right, a.focus === a.items[0]], ['auto', true, 'true', true, true, true]);
  if (shots) await page.screenshot({path: join(shots, `avatar-menu-1440-${theme}.png`)});
  if (theme === 'dark') {
    await page.keyboard.press('End');
    const last = (await avatar(page)).focus;
    await page.keyboard.press('ArrowDown');
    const wrapped = (await avatar(page)).focus;
    await page.keyboard.press('Home');
    const home = (await avatar(page)).focus;
    await page.keyboard.press('ArrowUp');
    const up = (await avatar(page)).focus;
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const esc = await avatar(page);
    t('End → last, ↓ wraps to first, Home → first, ↑ wraps to last, Escape closes with focus on the avatar',
      [last === a.items.at(-1), wrapped === a.items[0], home === a.items[0], up === a.items.at(-1), esc.open, esc.focus, esc.expanded], [true, true, true, true, false, 'avatar', 'false']);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
    const down = await avatar(page);
    t('↓ on the avatar opens with the first item focused', [down.open, down.focus === down.items[0]], [true, true]);
    await page.keyboard.press('Tab'); await page.waitForTimeout(200);
    t('Tab closes and returns the focus to the avatar', [(await avatar(page)).open, (await avatar(page)).focus], [false, 'avatar']);
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(200);
    const upOpen = await avatar(page);
    t('↑ on the avatar opens with the last item focused', [upOpen.open, upOpen.focus === upOpen.items.at(-1)], [true, true]);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.click('.account-avatar'); await page.waitForTimeout(200);
    await page.click('.account-avatar'); await page.waitForTimeout(300);
    t('pressing the avatar again closes it and it stays closed', [(await avatar(page)).open, (await avatar(page)).expanded], [false, 'false']);
    await page.click('.account-avatar'); await page.waitForTimeout(200);
    await page.mouse.click(700, 600); await page.waitForTimeout(250);
    t('a click outside closes (light dismiss)', [(await avatar(page)).open, (await avatar(page)).expanded], [false, 'false']);
    await page.waitForTimeout(200);
    t('the avatar menu fades in over 150ms', (await fadeOf('.account-menu', '.account-avatar')(page)).opacity, true);
  }
  t(`${theme}: avatar menu: no page errors`, errors, []);
  await context.close();
}
{
  const {context, page} = await open('/meetings', {reducedMotion: 'reduce'});
  t('reduced motion: the avatar menu does not move', (await fadeOf('.account-menu', '.account-avatar')(page)).translate, 'none');
  await context.close();
}
{
  const {context, page, errors} = await open('/meetings', {width: 900});
  await page.click('.account-avatar'); await page.waitForTimeout(250);
  const a = await avatar(page);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('.account-menu [role=menuitem]')].filter(i => !i.checkVisibility()).map(i => i.textContent.trim()));
  const visited = [a.focus];
  for (let i = 1; i < a.items.length + 1; i++) { await page.keyboard.press('ArrowDown'); visited.push((await avatar(page)).focus); }
  t('900px: ↓ visits every visible item in order, then wraps', visited, [...a.items, a.items[0]]);
  t('900px: the narrow page links are among them and hidden items are never visited',
    [a.items.some(text => ['我的紀錄', '成效指標', '團隊管理'].includes(text)), visited.some(text => hidden.includes(text))], [true, false]);
  if (shots) await page.screenshot({path: join(shots, 'avatar-menu-900-dark.png')});
  // The next page draws the header at once from the account this tab remembers, before /api/me answers.
  await page.goto(app + '/actions'); await page.waitForTimeout(1200);
  await page.click('.account-avatar'); await page.waitForTimeout(250);
  t('900px, next page (remembered account): the avatar menu opens', (await avatar(page)).open, true);
  t('900px: no page errors', errors, []);
  await context.close();
}
{
  const {context, page} = await open('/meetings', {width: 390, height: 844});
  await page.click('.account-avatar'); await page.waitForTimeout(250);
  const a = await avatar(page);
  const box = await page.evaluate(() => { const r = document.querySelector('.account-menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  t('390px: the avatar menu opens inside the window', [a.open, box], [true, true]);
  if (shots) await page.screenshot({path: join(shots, 'avatar-menu-390-dark.png')});
  await context.close();
}

// Browsers whose showPopover has no `source` option: the light dismiss closes the menu on the press, and the click that
// follows must not reopen it.
{
  const init = () => { const show = HTMLElement.prototype.showPopover; HTMLElement.prototype.showPopover = function () { return show.call(this); }; };
  const {context, page, errors} = await open('/', {init});
  const teamWord = page.locator('#setupSentence button.sentence-pick[data-field="team"]');
  await teamWord.click(); await page.waitForTimeout(200); await teamWord.click(); await page.waitForTimeout(300);
  t('without source: pressing the same word again closes it', (await sentenceMenu(page)).open, false);
  t('without source: no page errors on /', errors, []);
  await context.close();
}
{
  const init = () => { const show = HTMLElement.prototype.showPopover; HTMLElement.prototype.showPopover = function () { return show.call(this); }; };
  const {context, page, errors} = await open('/meetings', {init});
  await page.click('.account-avatar'); await page.waitForTimeout(200); await page.click('.account-avatar'); await page.waitForTimeout(300);
  t('without source: pressing the avatar again closes it', [(await avatar(page)).open, (await avatar(page)).expanded], [false, 'false']);
  await page.waitForTimeout(1100); await page.click('.account-avatar'); await page.waitForTimeout(200);
  t('without source: a later press opens it again', (await avatar(page)).open, true);
  t('without source: no page errors', errors, []);
  await context.close();
}

// Browsers without Popover and without checkVisibility (Safari 16): the hidden attribute and a hand-made outside click.
{
  const init = () => { delete Element.prototype.checkVisibility; delete HTMLElement.prototype.showPopover; };
  const {context, page, errors} = await open('/meetings', {width: 900, init});
  await page.click('.account-avatar'); await page.waitForTimeout(200);
  const opened = await page.evaluate(() => [!document.querySelector('.account-menu').hidden, document.activeElement.textContent]);
  await page.keyboard.press('ArrowDown');
  const down = await page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  const esc = await page.evaluate(() => [document.querySelector('.account-menu').hidden, document.activeElement.className]);
  await page.click('.account-avatar'); await page.mouse.click(600, 600); await page.waitForTimeout(150);
  t('no Popover: the avatar menu opens on the first item, ↓ moves, Escape closes to the avatar, a click outside closes',
    [opened, down, esc, await page.evaluate(() => document.querySelector('.account-menu').hidden)], [[true, '更換照片'], '移除照片', [true, 'account-avatar'], true]);
  await page.goto(app + '/'); await page.waitForTimeout(1200);
  const teamWord = page.locator('#setupSentence button.sentence-pick[data-field="team"]');
  await teamWord.click(); await page.waitForTimeout(200);
  const shown = await page.evaluate(() => !document.getElementById('sentenceMenu').hidden);
  await page.mouse.click(700, 700); await page.waitForTimeout(150);
  t('no Popover: the sentence menu opens and a click outside closes it', [shown, await page.evaluate(() => document.getElementById('sentenceMenu').hidden)], [true, true]);
  t('no Popover: no page errors', errors, []);
  await context.close();
}

// --- meeting-setup-layout "The settings dialog closes on a tap outside" ---
for (const fallback of [false, true]) {
  const init = fallback ? () => { delete HTMLDialogElement.prototype.closedBy; } : null;
  const {context, page, errors} = await open('/', {width: 390, height: 844, init});
  if (fallback) await page.evaluate(() => document.getElementById('mobileSettings').removeAttribute('closedby'));
  else t('the settings dialog carries closedby="any"', await page.getAttribute('#mobileSettings', 'closedby'), 'any');
  await page.click('#mobileSettingsOpen'); await page.waitForTimeout(300);
  const opened = await page.evaluate(() => document.getElementById('mobileSettings').open);
  await page.mouse.click(5, 5); await page.waitForTimeout(300);
  t(`390px${fallback ? ' (no closedby support)' : ''}: a tap at (5,5) closes the settings dialog`, [opened, await page.evaluate(() => document.getElementById('mobileSettings').open)], [true, false]);
  await page.click('#mobileSettingsOpen'); await page.waitForTimeout(300);
  await page.mouse.click(195, 300); await page.waitForTimeout(300);
  t(`390px${fallback ? ' (no closedby support)' : ''}: a tap inside keeps it open`, await page.evaluate(() => document.getElementById('mobileSettings').open), true);
  // Closing with a tap outside stops a running audio test, as closing with the buttons does.
  await page.click('#testMic'); await page.waitForTimeout(1500);
  const testing = await page.evaluate(() => document.getElementById('testMic').classList.contains('testing'));
  await page.mouse.click(5, 5); await page.waitForTimeout(400);
  t(`390px${fallback ? ' (no closedby support)' : ''}: a tap outside during the audio test closes and stops the test`,
    [testing, await page.evaluate(() => [document.getElementById('mobileSettings').open, document.getElementById('testMic').classList.contains('testing')])], [true, [false, false]]);
  t(`390px${fallback ? ' (no closedby support)' : ''}: no page errors`, errors, []);
  await context.close();
}

await browser.close();
