// End-to-end acceptance for member profile photos (member-avatars) in the real pages (Playwright, gstack's install).
// Signed in as a system administrator, it gives <member> of <team> a photo on the team administration page (a
// generated 400x240 image, which the browser crops to 160x160), checks the photo on the action board (avatar filter
// and cards), that a photo failing to load falls back to the initial, then removes it again. Exits 1 on any failed check.
// Usage: YUQIAO_SESSION=<admin token> node bench/avatar_e2e.mjs <team name> <member username> <screenshot dir>
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [teamName, member, out] = process.argv.slice(2);
const app = process.env.YUQIAO_APP || 'http://localhost:18082';
if (!process.env.YUQIAO_SESSION || !teamName || !member || !out) {
  console.error('Usage: YUQIAO_SESSION=<admin token> node bench/avatar_e2e.mjs <team name> <member username> <dir>'); process.exit(2);
}
const {chromium} = (await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || join(homedir(), '.claude/skills/gstack/node_modules/playwright/index.js')).href)).default;
const browser = await chromium.launch();
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` ${JSON.stringify(detail)}` : ''}`); failed ||= !ok; };
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => localStorage.setItem('interpreter-theme', 'light'));
  await context.addCookies([{name: 'yq_session', value: process.env.YUQIAO_SESSION, url: `${app}/`}]);
  const page = await context.newPage();
  page.on('pageerror', e => check('no page errors', false, e.message));
  const row = () => page.locator('.team').filter({has: page.locator('h2', {hasText: teamName})}).locator('.member').filter({hasText: member}).first();
  const openAdmin = async () => { await page.goto(`${app}/admin`); await page.waitForSelector('.member'); };
  const removePhoto = async () => {
    const clear = row().getByRole('button', {name: '移除照片'});
    await clear.click(); await clear.click();
    await row().locator('span.avatar').waitFor();
  };

  // A wide image, so the crop to the centre square shows.
  await openAdmin();
  if (await row().locator('img.avatar').count()) await removePhoto();
  check('member without a photo shows the initial', await row().locator('span.avatar').count() === 1 && await row().getByRole('button', {name: '設定照片'}).count() === 1);
  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), {width: 400, height: 240});
    const g = canvas.getContext('2d');
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, 400, 240); g.fillStyle = '#2e86de'; g.fillRect(80, 0, 240, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  // Set the photo.
  const upload = page.waitForResponse(r => r.url().includes('/avatar') && r.request().method() === 'PUT');
  await row().locator('input[type=file]').setInputFiles({name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
  const response = await upload;
  check('upload accepted as a small square image', response.status() === 200 && ['image/webp', 'image/jpeg'].includes(response.request().headers()['content-type']),
    [response.status(), response.request().headers()['content-type']]);
  await row().locator('img.avatar').waitFor();
  const size = await row().locator('img.avatar').evaluate(img => img.complete ? [img.naturalWidth, img.naturalHeight] : img.decode().then(() => [img.naturalWidth, img.naturalHeight]));
  check('row shows the photo, cropped to 160x160', size[0] === 160 && size[1] === 160, size);
  // The centre square of the image is blue: the red sides were cropped away.
  const centre = await row().locator('img.avatar').evaluate(img => {
    const c = Object.assign(document.createElement('canvas'), {width: 160, height: 160}); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return [...g.getImageData(4, 80, 1, 1).data.slice(0, 3)];
  });
  check('the centre square is kept', centre[2] > 150 && centre[0] < 120, centre);
  check('buttons offer 更換照片 and 移除照片', await row().getByRole('button', {name: '更換照片'}).count() === 1 && await row().getByRole('button', {name: '移除照片'}).count() === 1);
  await page.screenshot({path: join(out, 'admin-photo.png')});

  // Board.
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  const filter = page.locator(`.avatar-button img.avatar-mini.photo[src*="/api/users/${member}/avatar"]`);
  check('avatar filter shows the photo', await filter.count() === 1);
  const cards = page.locator(`.issue img.avatar-mini[src*="/api/users/${member}/avatar"]`);
  const cardCount = await cards.count();
  check('cards show the photo', cardCount > 0, cardCount);
  if (cardCount) {
    check('card photo loads', await cards.first().evaluate(img => img.complete && img.naturalWidth > 0 || img.decode().then(() => img.naturalWidth > 0)));
    await page.locator('.issue', {has: page.locator(`img.avatar-mini[src*="/api/users/${member}/avatar"]`)}).first().click(); await page.waitForSelector('#detail:not([hidden])');
    check('detail panel shows the owner photo', await page.locator(`#detail img.avatar-mini.photo[src*="/api/users/${member}/avatar"]`).count() === 1);
    await page.keyboard.press('Escape');
  }
  await page.selectOption('#group', 'owner'); await page.waitForSelector('.lane');
  check('owner swimlane shows the photo', await page.locator(`.lane-toggle img.avatar-mini.photo[src*="/api/users/${member}/avatar"]`).count() === 1);
  await page.selectOption('#group', '');
  await page.screenshot({path: join(out, 'board-photo.png')});
  // A photo that fails to load falls back to the initial.
  await page.route('**/api/users/*/avatar*', route => route.abort());
  await page.reload(); await page.waitForSelector('.board-column');
  await page.waitForFunction(() => !document.querySelector('img.avatar-mini.photo'));
  check('a photo that fails to load shows the initial', await page.locator('.avatar-button .avatar-mini:not(.photo)').count() >= 1);
  await page.unroute('**/api/users/*/avatar*');

  // 400 px: the member row's buttons wrap instead of scrolling the page.
  await page.setViewportSize({width: 400, height: 860});
  await openAdmin();
  check('no horizontal scroll on team administration at 400 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await page.screenshot({path: join(out, 'admin-400.png'), fullPage: true});
  await page.setViewportSize({width: 1280, height: 900});

  // Remove.
  await removePhoto();
  check('removing the photo brings the initial back', await row().locator('img.avatar').count() === 0 && await row().getByRole('button', {name: '設定照片'}).count() === 1);
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  check('board no longer shows the photo', await page.locator(`img[src*="/api/users/${member}/avatar"]`).count() === 0);
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/avatar_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  // Never leave the test image on a colleague's account, even after a failed check (404 when already removed).
  await fetch(`${app}/api/admin/users/${encodeURIComponent(member)}/avatar`, {method: 'DELETE', headers: {cookie: `yq_session=${process.env.YUQIAO_SESSION}`}}).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
