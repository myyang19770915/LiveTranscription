// End-to-end acceptance for member profile photos (member-avatars, avatar-self-service) in the real pages (Playwright,
// gstack's install). Signed in as a system administrator, it clicks <member>'s avatar on the team administration page
// and gives them a photo (a generated 400x240 image, which the browser crops to 160x160), checks the photo on the
// action board (avatar filter, a pressed filter staying round, cards, detail panel, swimlane), that a photo failing to
// load falls back to the initial, then removes it. Then it changes the signed-in user's own photo from the header menu
// and removes it; the user's own photo from before the run is put back at the end. Exits 1 on any failed check.
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
let failed = false, ownPhoto = null;
const cookie = `yq_session=${process.env.YUQIAO_SESSION}`;
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
    await row().locator('span.avatar-face').waitFor();
  };
  // The signed-in user's own photo before the run, put back in finally.
  const me = await (await fetch(`${app}/api/me`, {headers: {cookie}})).json();
  if (me.avatarUrl) {
    const saved = await fetch(`${app}${me.avatarUrl}`, {headers: {cookie}});
    ownPhoto = {type: saved.headers.get('content-type'), body: Buffer.from(await saved.arrayBuffer())};
  }

  // A wide image, so the crop to the centre square shows.
  await openAdmin();
  if (await row().locator('img.avatar-face').count()) await removePhoto();
  check('member without a photo shows the initial on a button, no separate 設定照片 button',
    await row().locator('button.avatar-edit span.avatar-face').count() === 1 && await row().locator('.text-button', {hasText: '照片'}).count() === 0);
  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), {width: 400, height: 240});
    const g = canvas.getContext('2d');
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, 400, 240); g.fillStyle = '#2e86de'; g.fillRect(80, 0, 240, 240);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  // Set the photo.
  const image = {name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')};
  let puts = 0;
  page.on('request', r => { if (r.method() === 'PUT' && r.url().includes('/avatar')) puts++; });
  // Choosing a file opens the crop dialog (avatar-crop); choose() confirms the initial frame.
  const openCrop = async (click) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click()]);
    await chooser.setFiles(image); await page.waitForSelector('dialog.crop-dialog[open]');
  };
  const choose = async (click) => { await openCrop(click); await page.click('.crop-ok'); };
  const rectOf = sel => page.locator(sel).boundingBox();
  // The photo's pixel colour at (x, y) of its 160x160.
  const pixel = (img, x, y) => img.evaluate((node, [px, py]) => {
    const c = Object.assign(document.createElement('canvas'), {width: 160, height: 160}); const g = c.getContext('2d'); g.drawImage(node, 0, 0);
    return Array.from(g.getImageData(px, py, 1, 1).data.slice(0, 3));
  }, [x, y]);

  // Cancel and Esc upload nothing.
  await openCrop(() => row().locator('button.avatar-edit').click());
  const [stage, frame] = [await rectOf('.crop-stage'), await rectOf('.crop-frame')];
  check('crop dialog shows the image with the largest centred square frame',
    Math.abs(frame.height - stage.height) < 1 && Math.abs((frame.x + frame.width / 2) - (stage.x + stage.width / 2)) < 1, [stage.width, stage.height, frame.width]);
  await page.screenshot({path: join(out, 'crop-dialog.png')});
  await page.click('.crop-dialog >> text=取消');
  await openCrop(() => row().locator('button.avatar-edit').click());
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.crop-dialog', {state: 'detached'});
  await page.waitForTimeout(300);
  check('取消 and Esc close the dialog and upload nothing', puts === 0 && await row().locator('span.avatar-face').count() === 1, puts);

  // Confirm the initial frame.
  const upload = page.waitForResponse(r => r.url().includes('/avatar') && r.request().method() === 'PUT');
  await choose(() => row().locator('button.avatar-edit').click());
  const response = await upload;
  check('upload accepted as a small square image', response.status() === 200 && ['image/webp', 'image/jpeg'].includes(response.request().headers()['content-type']),
    [response.status(), response.request().headers()['content-type']]);
  await row().locator('img.avatar-face').waitFor();
  const size = await row().locator('img.avatar-face').evaluate(img => img.complete ? [img.naturalWidth, img.naturalHeight] : img.decode().then(() => [img.naturalWidth, img.naturalHeight]));
  check('row shows the photo, cropped to 160x160', size[0] === 160 && size[1] === 160, size);
  // The centre square of the image is blue: the red sides were cropped away.
  const centre = await row().locator('img.avatar-face').evaluate(img => {
    const c = Object.assign(document.createElement('canvas'), {width: 160, height: 160}); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return [...g.getImageData(4, 80, 1, 1).data.slice(0, 3)];
  });
  check('the centre square is kept', centre[2] > 150 && centre[0] < 120, centre);
  check('row offers 移除照片 and the avatar says 更換照片', await row().getByRole('button', {name: '移除照片'}).count() === 1
    && await row().locator('button.avatar-edit').getAttribute('title') === '更換照片');

  // Drag the frame far past the left edge: it stops at the edge, and the photo is the left part (red at its left).
  await openCrop(() => row().locator('button.avatar-edit').click());
  const startFrame = await rectOf('.crop-frame');
  await page.locator('.crop-frame').focus(); await page.keyboard.press('Shift+ArrowLeft');
  check('Shift+← moves the frame 20 px', Math.abs((await rectOf('.crop-frame')).x - (startFrame.x - 20)) < 1);
  const before = await rectOf('.crop-frame');
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x - 600, before.y + before.height / 2, {steps: 8}); await page.mouse.up();
  const [stage2, moved] = [await rectOf('.crop-stage'), await rectOf('.crop-frame')];
  check('dragging the frame stops at the image edge', Math.abs(moved.x - stage2.x) < 1, [moved.x, stage2.x]);
  const previewEdge = await page.locator('canvas.crop-preview').evaluate(c => Array.from(c.getContext('2d').getImageData(2, c.height / 2, 1, 1).data.slice(0, 3)));
  check('the preview shows the framed area (red at its left)', previewEdge[0] > 150 && previewEdge[2] < 120, previewEdge);
  // Shrink with the corner handle, then with the slider; the frame stays square and inside.
  const handle = await rectOf('.crop-handle');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y - 60, {steps: 6}); await page.mouse.up();
  const shrunk = await rectOf('.crop-frame');
  check('the corner handle resizes the frame, keeping it square', shrunk.width < moved.width - 30 && Math.abs(shrunk.width - shrunk.height) < 1, [moved.width, shrunk.width]);
  await page.locator('.crop-size').fill(String(Math.round(stage2.height)));
  const grown = await rectOf('.crop-frame');
  check('the slider resizes the frame within the image', Math.abs(grown.height - stage2.height) < 1 && grown.x >= stage2.x - 0.5, [grown.width, stage2.height]);
  await page.keyboard.press('Tab'); await page.locator('.crop-frame').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  const oldSrc = await row().locator('img.avatar-face').getAttribute('src');
  const left = page.waitForResponse(r => r.url().includes('/avatar') && r.request().method() === 'PUT');
  await page.click('.crop-ok'); await left;
  // Wait for the list to show the new photo (a new versioned address), fully loaded.
  await page.waitForFunction(([who, src]) => {
    const img = [...document.querySelectorAll('img.avatar-face')].find(i => i.src.includes(`/api/users/${who}/avatar`));
    return img && !img.src.endsWith(src) && img.complete && img.naturalWidth > 0;
  }, [member, oldSrc]);
  const edge = await pixel(row().locator('img.avatar-face'), 4, 80);
  check('the uploaded photo is the framed area (red at its left edge)', edge[0] > 150 && edge[2] < 120, edge);
  await page.screenshot({path: join(out, 'admin-photo.png')});

  // Board.
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  const filter = page.locator(`.avatar-button img.avatar-mini.photo[src*="/api/users/${member}/avatar"]`);
  check('avatar filter shows the photo', await filter.count() === 1);
  // Pressed: still a circle, the photo centred in it.
  const filterButton = page.locator('.avatar-button', {has: page.locator(`img.avatar-mini.photo[src*="/api/users/${member}/avatar"]`)});
  await filterButton.click(); await page.waitForSelector('.avatar-button[aria-pressed="true"]');
  const [box, photoBox] = [await filterButton.boundingBox(), await filter.boundingBox()];
  const centred = Math.abs((box.x + box.width / 2) - (photoBox.x + photoBox.width / 2)) < 1 && Math.abs((box.y + box.height / 2) - (photoBox.y + photoBox.height / 2)) < 1;
  check('pressed avatar filter stays round with the photo centred', Math.abs(box.width - box.height) < 1 && centred, [box.width, box.height]);
  await page.screenshot({path: join(out, 'board-pressed.png'), clip: {x: 0, y: Math.max(0, box.y - 60), width: 700, height: 160}});
  await filterButton.click(); await page.waitForFunction(() => !location.search.includes('owner='));
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
  const putsBefore = puts;
  await openCrop(() => row().locator('button.avatar-edit').click());
  const dialog400 = await rectOf('dialog.crop-dialog');
  check('crop dialog fits a 400 px screen', dialog400.x >= 0 && dialog400.x + dialog400.width <= 400, [dialog400.x, dialog400.width]);
  await page.screenshot({path: join(out, 'crop-400.png')});
  await page.click('.crop-dialog >> text=取消');
  check('cancelling at 400 px uploads nothing', puts === putsBefore);
  await page.setViewportSize({width: 1280, height: 900});

  // Remove.
  await removePhoto();
  check('removing the photo brings the initial back', await row().locator('img.avatar-face').count() === 0 && await row().locator('button.avatar-edit').getAttribute('title') === '設定照片');
  await page.goto(`${app}/actions`); await page.waitForSelector('.board-column');
  check('board no longer shows the photo', await page.locator(`img[src*="/api/users/${member}/avatar"]`).count() === 0);

  // Own photo from the header menu, on the board (no full reload).
  if (ownPhoto) {
    await fetch(`${app}/api/me/avatar`, {method: 'DELETE', headers: {cookie}});
    await page.reload(); await page.waitForSelector('.board-column');
  }
  await page.waitForSelector('.account-avatar .account-initial');
  // A refused upload: the message shows in the menu, which stays open and still closes with Esc.
  await page.route('**/api/me/avatar', route => route.fulfill({status: 413, contentType: 'application/json', body: JSON.stringify({detail: '照片太大，請選 256 KB 以內的圖片'})}));
  await page.click('.account-avatar');
  await choose(() => page.click('.account-menu >> text=更換照片'));
  await page.waitForSelector('.account-menu-error:not([hidden])');
  check('a refused upload shows its reason in the open menu', (await page.textContent('.account-menu-error')).includes('256 KB') && await page.isVisible('.account-menu'));
  await page.keyboard.press('Escape');
  check('Esc still closes the menu after an error', await page.isHidden('.account-menu'));
  await page.unroute('**/api/me/avatar');
  const putsHeader = puts;
  await page.click('.account-avatar');
  await openCrop(() => page.click('.account-menu >> text=更換照片'));
  await page.click('.crop-dialog >> text=取消');
  await page.waitForSelector('dialog.crop-dialog', {state: 'detached'});
  check('cancelling the crop from the header changes nothing', puts === putsHeader
    && await page.locator('.account-avatar .account-initial').count() === 1 && await page.isHidden('.account-menu-error'));
  await page.click('.account-avatar');
  check('header menu offers 更換照片 only without a photo', (await page.locator('.account-menu [role=menuitem]').allTextContents()).join() === '更換照片');
  const mine = page.waitForResponse(r => r.url().endsWith('/api/me/avatar') && r.request().method() === 'PUT');
  await choose(() => page.click('.account-menu >> text=更換照片'));
  check('own photo uploaded', (await mine).status() === 200);
  await page.waitForSelector('.account-avatar img');
  check('header shows the own photo and the menu closes', await page.isHidden('.account-menu'));
  await page.waitForSelector(`.avatar-button img.photo[src*="/api/users/${me.username}/avatar"]`);
  check('board shows the own photo without a reload', true);
  await page.screenshot({path: join(out, 'header-photo.png'), clip: {x: 0, y: 0, width: 1280, height: 260}});
  await page.click('.account-avatar');
  await page.click('.account-menu >> text=移除照片');
  await page.waitForSelector('.account-avatar .account-initial');
  await page.waitForFunction(who => !document.querySelector(`.avatar-button img[src*="/api/users/${who}/avatar"]`), me.username);
  check('removing the own photo brings the initial back', true);
  await page.click('.account-avatar'); await page.keyboard.press('Escape');
  check('Esc closes the header menu', await page.isHidden('.account-menu'));
  // An administrator's own row on the team page: the header follows.
  const ownRow = page.locator('.member').filter({hasText: me.username}).first();
  await openAdmin();
  if (await ownRow.count()) {
    await choose(() => ownRow.locator('button.avatar-edit').click());
    await page.waitForSelector('.account-avatar img');
    check('own row photo shows in the header', true);
    const clearOwn = ownRow.getByRole('button', {name: '移除照片'});
    await clearOwn.click(); await clearOwn.click();
    await page.waitForSelector('.account-avatar .account-initial');
    check('removing the own row photo updates the header', true);
  }
} catch (error) {
  check('run', false, `${error.message.split('\n')[0]} (line ${(error.stack.match(/avatar_e2e\.mjs:(\d+)/) || [])[1]})`);
} finally {
  // Never leave the test image on a colleague's account, even after a failed check (404 when already removed).
  await fetch(`${app}/api/admin/users/${encodeURIComponent(member)}/avatar`, {method: 'DELETE', headers: {cookie}}).catch(() => {});
  // The user's own photo as it was before the run.
  if (ownPhoto) await fetch(`${app}/api/me/avatar`, {method: 'PUT', headers: {cookie, 'content-type': ownPhoto.type}, body: ownPhoto.body}).catch(() => {});
  else await fetch(`${app}/api/me/avatar`, {method: 'DELETE', headers: {cookie}}).catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
