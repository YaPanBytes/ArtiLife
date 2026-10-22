// End-to-end checks of the real page in a real browser, with the simulation in a
// worker and again on the page. Needs a Chromium: set CHROMIUM_PATH, or have one
// under PLAYWRIGHT_BROWSERS_PATH (or /opt/pw-browsers).
// Usage: npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4173;
const URL_BASE = `http://localhost:${PORT}/`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
    if (dir) return `${root}/${dir}/chrome-linux/chrome`;
  }
  throw new Error('no Chromium found: set CHROMIUM_PATH');
}

async function startServer() {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL_BASE)).ok) return server;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  server.kill();
  throw new Error('preview server did not start (did you run npm run build?)');
}

const results = [];
const check = (mode, name, ok, detail = '') => results.push({ mode, name, ok, detail });

async function runMode(browser, mode) {
  const worker = mode === 'worker';
  const context = await browser.newContext({
    viewport: { width: 1300, height: 900 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const ok = (name, cond, detail) => check(mode, name, !!cond, detail);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const tick = () => ev(() => window.artilife.backend.scene.tick);
  const until = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout });
  const open = async (query = '') => {
    await page.goto(`${URL_BASE}?seed=1${worker ? '' : '&worker=0'}${query}`);
    await until(() => window.artilife);
    await until(() => window.artilife.backend.scene.count > 0);
  };

  await open();
  ok(
    'uses the expected backend',
    (await ev(() => 'terminate' in window.artilife.backend)) === worker,
  );

  // Running, pausing, stepping, speed.
  const t0 = await tick();
  await page.waitForTimeout(1000);
  const t1 = await tick();
  ok('the simulation advances while running', t1 - t0 > 100, `${t0} -> ${t1} in 1 s`);
  await page.keyboard.press(' ');
  await page.waitForTimeout(400);
  const pausedAt = await tick();
  await page.waitForTimeout(400);
  ok('space pauses', (await ev(() => window.artilife.view.paused)) && (await tick()) === pausedAt);
  ok(
    'the button says PLAY',
    (await page.locator('#panel .row button').first().textContent()) === 'PLAY',
  );
  await page.keyboard.press('.');
  await until((t) => window.artilife.backend.scene.tick === t + 1, pausedAt);
  ok('. steps exactly one tick', true);
  await page.keyboard.press(']');
  ok('] raises the speed', (await page.locator('.speed').textContent()).startsWith('X8'));
  for (let i = 0; i < 5; i++) await page.keyboard.press('[');
  ok(
    '[ lowers the speed, stopping at x1',
    (await page.locator('.speed').textContent()).startsWith('X1'),
  );
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await page.keyboard.press(' ');

  // Camera and selection.
  const cam0 = await ev(() => window.artilife.view.camera.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  ok('arrow keys scroll', Math.abs((await ev(() => window.artilife.view.camera.x)) - cam0) > 10);

  const canvas = page.locator('canvas#screen');
  const box = await canvas.boundingBox();
  const scale = (await canvas.evaluate((c) => c.clientWidth)) / 256;
  const toPage = (sx, sy) => [box.x + 4 + sx * scale, box.y + 4 + sy * scale];
  await page.keyboard.press(' '); // pause so positions hold still
  await page.waitForTimeout(300);
  const target = await ev(() => {
    const a = window.artilife;
    const s = a.backend.scene;
    for (let i = 0; i < s.count; i++) {
      const [sx, sy] = a.view.camera.toScreen(s.x[i] * 8, s.y[i] * 8);
      if (sx > 20 && sx < 236 && sy > 20 && sy < 148) return { id: s.id[i], sx, sy };
    }
    return null;
  });
  ok('there is a creature on screen to click', target !== null);
  if (target) {
    await page.mouse.click(...toPage(target.sx, 56 + target.sy));
    ok(
      'clicking a creature selects it',
      (await ev(() => window.artilife.view.selectedId)) === target.id,
    );
    await until(() => window.artilife.backend.detail !== null);
    ok(
      'the inspector gets its details',
      (await ev(() => window.artilife.backend.detail.id)) === target.id,
    );
    await page.waitForTimeout(600);
    const centred = await ev(() => {
      const a = window.artilife;
      const s = a.backend.scene;
      const i = s.indexOfId(a.view.selectedId);
      return i < 0 ? null : a.view.camera.toScreen(s.x[i] * 8, s.y[i] * 8);
    });
    ok(
      'the camera follows it',
      centred && Math.abs(centred[0] - 128) < 12 && Math.abs(centred[1] - 84) < 12,
    );
    await page.keyboard.press('Escape');
    ok('escape lets go', (await ev(() => window.artilife.view.selectedId)) === null);
  }
  const dragStart = await ev(() => window.artilife.view.camera.x);
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 300, { steps: 6 });
  await page.mouse.up();
  ok('dragging scrolls', (await ev(() => window.artilife.view.camera.x)) !== dragStart);
  await page.mouse.click(...toPage(8 + 40, 4 + 40));
  const world = await ev(() => window.artilife.backend.world);
  const centre = await ev(() => [
    window.artilife.view.camera.centerX,
    window.artilife.view.camera.centerY,
  ]);
  ok(
    'clicking the minimap moves the camera',
    Math.abs(centre[0] - (40 / 48) * world.width * 8) < 2 &&
      Math.abs(centre[1] - (40 / 48) * world.height * 8) < 2,
  );
  await page.keyboard.press(' ');

  // Rules take effect live.
  const slider = (label) =>
    page.locator('label.control', { hasText: label }).first().locator('input');
  await slider('MAX POP').evaluate((el) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const births = await ev(() => window.artilife.backend.scene.stats.births);
  await page.waitForTimeout(1200);
  ok(
    'a rule changed in the panel takes effect in the running world',
    (await ev(() => window.artilife.backend.scene.stats.births)) === births,
    `births stayed at ${births}`,
  );
  ok(
    'the slider shows its value',
    (await page
      .locator('label.control', { hasText: 'MAX POP' })
      .locator('.value')
      .textContent()) === '0',
  );
  await slider('MAX POP').evaluate((el) => {
    el.value = '800';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#panel button', { hasText: 'DROUGHT' }).click();
  await until(() => window.artilife.backend.scene.hazards.includes('DROUGHT'));
  ok('a disaster button works', true);
  await page.locator('#panel button', { hasText: 'BLOOM' }).click();

  // Views and tabs.
  await page.keyboard.press('g');
  ok('G switches to glyphs', (await ev(() => window.artilife.view.mode)) === 'glyph');
  const glyphShot = await canvas.screenshot();
  await page.keyboard.press('g');
  ok('the glyph view looks different', !glyphShot.equals(await canvas.screenshot()));
  await page.keyboard.press('o');
  ok('O cycles the colouring', (await ev(() => window.artilife.view.overlay)) === 'energy');
  for (let i = 0; i < 5; i++) await page.keyboard.press('o');
  ok('the colourings wrap around', (await ev(() => window.artilife.view.overlay)) === 'none');

  const ink = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
        return n;
      });
  await page.locator('.tabs button', { hasText: 'STATS' }).click();
  await page.waitForTimeout(900);
  ok('the STATS tab draws charts', (await ink('#panel canvas.chart')) > 200);
  await page.locator('.tabs button', { hasText: 'LOG' }).click();
  await page.waitForTimeout(700);
  ok('the LOG tab lists events', (await page.locator('ol.log li').count()) >= 1);
  await page.locator('.tabs button', { hasText: 'INSPECT' }).click();
  await ev(() => {
    const a = window.artilife;
    a.select(a.backend.scene.id[0]);
  });
  await page.waitForTimeout(700);
  ok(
    'the INSPECT tab shows a creature and its brain',
    (await page.locator('dl.info dd').count()) > 5 &&
      (await ink('#panel .tab:not([hidden]) canvas.chart')) > 300,
  );
  await page.locator('.tabs button', { hasText: 'RULES' }).click();

  // Presets, new worlds, sharing, saving, screenshots, sound.
  await page.locator('#panel select.inline').selectOption('ISLAND CHAIN');
  await page.locator('#panel button', { hasText: 'START' }).click();
  await until(() => window.artilife.settings.terrain.barrier === 'river');
  await until(() => window.artilife.backend.scene.tick < 100);
  ok('a preset starts a new world with its rules', true);
  ok(
    'the sliders follow the preset',
    (await page
      .locator('label.control', { hasText: 'BARRIERS' })
      .locator('.value')
      .textContent()) === '4',
  );

  await page.locator('#panel input[type=number]').fill('7');
  await page.locator('#panel button', { hasText: 'GO' }).click();
  await until(() => window.artilife.settings.seed === 7);
  await until(() => window.artilife.backend.scene.tick < 100);
  ok('GO starts a new world with the seed', true);

  await page.locator('#panel button', { hasText: 'SHARE' }).click();
  await page.waitForTimeout(300);
  const link = await ev(() => navigator.clipboard.readText());
  ok('SHARE copies a link', link.includes('?s='), link);
  const shared = await context.newPage();
  await shared.goto(link + (worker ? '' : '&worker=0'));
  await shared.waitForFunction(() => window.artilife, null, { timeout: 15000 });
  const sharedSettings = await shared.evaluate(() => window.artilife.settings);
  const mine = await ev(() => window.artilife.settings);
  ok('the link starts the same world', JSON.stringify(sharedSettings) === JSON.stringify(mine));
  await shared.close();

  await page.waitForTimeout(500);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const [saveDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#panel button', { hasText: 'SAVE' }).click(),
  ]);
  const savePath = await saveDownload.path();
  const saved = JSON.parse(readFileSync(savePath, 'utf8'));
  ok(
    'SAVE downloads the run',
    saved.format === 'artilife' &&
      /^artilife-seed7-tick\d+\.json$/.test(saveDownload.suggestedFilename()),
    saveDownload.suggestedFilename(),
  );
  const savedTick = saved.tick;

  await page.locator('#panel input[type=number]').fill('99');
  await page.locator('#panel button', { hasText: 'GO' }).click();
  await until(() => window.artilife.settings.seed === 99);
  await page.locator('#panel input[type=file]').setInputFiles(savePath);
  await until(() => window.artilife.settings.seed === 7);
  await until((t) => window.artilife.backend.scene.tick === t, savedTick);
  ok('LOAD restores the saved run', true);
  ok('and leaves it paused', await ev(() => window.artilife.view.paused));

  await page
    .locator('#panel input[type=file]')
    .setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"nope":1}'),
    });
  await until(() =>
    document.querySelector('#panel .status')?.textContent?.includes('NOT AN ARTILIFE SAVE'),
  );
  ok('a bad save file gives a clear message', true);
  ok('and the run is untouched', (await tick()) === savedTick);

  const [shot] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#panel button', { hasText: 'PHOTO' }).click(),
  ]);
  const png = readFileSync(await shot.path());
  ok(
    'PHOTO downloads a PNG at 4x',
    png.readUInt32BE(16) === 1024 &&
      png.readUInt32BE(20) === 896 &&
      /^artilife-seed7-tick\d+\.png$/.test(shot.suggestedFilename()),
    `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,
  );

  await page.locator('label.control', { hasText: 'SOUND' }).locator('input').check();
  ok('sound can be switched on', await ev(() => window.artilife.sound.enabled));
  await page.keyboard.press(' ');
  await page.waitForTimeout(800);
  await page.locator('label.control', { hasText: 'SOUND' }).locator('input').uncheck();

  const dims = await canvas.evaluate((c) => [c.clientWidth, c.clientHeight]);
  ok(
    'the screen is scaled by a whole number',
    dims[0] % 256 === 0 && dims[1] % 224 === 0 && dims[0] / 256 === dims[1] / 224,
    dims.join('x'),
  );
  const a = await canvas.screenshot();
  await page.waitForTimeout(500);
  ok('the screen keeps redrawing', !a.equals(await canvas.screenshot()));

  ok('no errors in the console', errors.length === 0, errors.join(' | '));
  await context.close();
}

const server = await startServer();
let failed = 0;
try {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  for (const mode of ['worker', 'page']) await runMode(browser, mode);
  await browser.close();
} finally {
  server.kill();
}
for (const r of results) {
  if (!r.ok) failed++;
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'}  [${r.mode}] ${r.name}${r.detail && !r.ok ? `  (${r.detail})` : ''}`,
  );
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
