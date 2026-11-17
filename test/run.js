// End-to-end check: loads the unpacked extension into Chromium and serves
// test/fixture.html as if it were www.espn.com.
//
//   node test/run.js
//
// Requires Playwright (`npm i -D playwright && npx playwright install chromium`).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const FIXTURES = {
  '/': ['text/html', 'fixture.html'],
  '/clip.webm': ['video/webm', 'clip.webm'],
};

async function open(withExtension) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'espn-ab-'));
  const args = ['--autoplay-policy=no-user-gesture-required'];
  if (withExtension) {
    args.push(`--disable-extensions-except=${root}`, `--load-extension=${root}`);
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args,
  });
  await context.route('https://www.espn.com/**', (route) => {
    const entry = FIXTURES[new URL(route.request().url()).pathname];
    if (!entry) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      contentType: entry[0],
      body: fs.readFileSync(path.join(__dirname, entry[1])),
    });
  });
  const page = await context.newPage();
  await page.goto('https://www.espn.com/');
  await page.waitForTimeout(1500);
  return { context, page };
}

const playing = (page, id) =>
  page.evaluate((i) => {
    const v = document.getElementById(i);
    return !v.paused && v.currentTime > 0;
  }, id);

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (got ${actual}, expected ${expected})`}`);
}

(async () => {
  // Control: without the extension the fixture really does autoplay.
  {
    const { context, page } = await open(false);
    check('control: autoplay attribute plays', await playing(page, 'attr'), true);
    check('control: scripted play() plays', await playing(page, 'scripted'), true);
    check('control: dynamic autoplay plays', await playing(page, 'dynamic'), true);
    await context.close();
  }

  const { context, page } = await open(true);

  check('autoplay attribute is blocked', await playing(page, 'attr'), false);
  check('scripted play() is blocked', await playing(page, 'scripted'), false);
  check(
    'scripted play() rejects with NotAllowedError',
    await page.evaluate(() => window.results.scripted),
    'NotAllowedError'
  );
  check('dynamically injected autoplay is blocked', await playing(page, 'dynamic'), false);

  await page.click('#elsewhere');
  await page.waitForTimeout(800);
  check('click elsewhere does not start a video', await playing(page, 'scripted'), false);

  await page.click('#playBtn');
  await page.waitForTimeout(1500);
  check('clicking the player starts its video', await playing(page, 'click'), true);
  check('...and only that video', await playing(page, 'attr'), false);

  check('player swapping its <video> keeps playing', await page.evaluate(() => window.swapVideo()), 'played');

  await page.evaluate(() => document.getElementById('swapped').pause());
  check(
    'in-page navigation re-locks playback',
    await page.evaluate(() => window.navigateAndPlay()),
    'NotAllowedError'
  );

  await page.click('#attr');
  await page.evaluate(() => document.getElementById('attr').play().catch(() => {}));
  await page.waitForTimeout(800);
  check('clicking directly on a video allows it', await playing(page, 'attr'), true);

  await context.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
