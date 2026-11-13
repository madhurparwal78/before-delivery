import { chromium } from '/tmp/node_modules/playwright/index.mjs';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const log = (label, ok, extra) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
  }
};

const CONTRAST = `(() => {
  const toLinear = (value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (rgb) => 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
  const parse = (value) => (value.match(/\\d+(\\.\\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const backgroundOf = (element) => {
    let node = element;
    while (node) {
      const colour = getComputedStyle(node).backgroundColor;
      if (colour && !colour.startsWith('rgba(0, 0, 0, 0)') && colour !== 'transparent') return parse(colour);
      node = node.parentElement;
    }
    return [255, 255, 255];
  };
  const bad = [];
  for (const element of document.querySelectorAll('body *')) {
    const text = [...element.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (text === '') continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const front = luminance(parse(style.color));
    const back = luminance(backgroundOf(element));
    const ratio = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    if (ratio < (large ? 3 : 4.5)) bad.push(text.slice(0, 30) + ' @' + ratio.toFixed(2));
  }
  return bad;
})()`;

async function main() {
  const browser = await chromium.launch();

  console.log('contrast');
  const plain = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await plain.newPage();
  for (const path of ['/', '/gallery', '/signin', '/signup']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const bad = await page.evaluate(CONTRAST);
    log(`contrast on ${path}`, bad.length === 0, bad);
  }

  console.log('keyboard');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  log('skip link is first tab stop', first === 'Skip to content', first);
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { width: style.outlineWidth, shadow: style.boxShadow };
  });
  log('visible focus ring', ring.width !== '0px' && ring.shadow !== 'none', ring);
  const order = [];
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
  }
  log(
    'navigation follows reading order',
    order.slice(0, 6).join('|') === 'Leaderboard|Gallery|Studio|Jury|Director|Sign in',
    order,
  );

  console.log('reduced motion');
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const quiet = await reduced.newPage();
  await quiet.goto(BASE, { waitUntil: 'networkidle' });
  await quiet.waitForTimeout(1200);
  await quiet.getByRole('button', { name: 'Replay reveal for Portfolio' }).click();
  await quiet.waitForTimeout(500);
  const deltas = await quiet.locator('table[aria-label="Portfolio standings"] .delta').allTextContents();
  log('static delta labels', deltas.length >= 2 && /^(up|down) \d+$/.test(deltas[0].trim()), deltas);
  const announced = await quiet.getByRole('status', { name: 'Standings updates' }).first().textContent();
  log('reduced motion announcement', (announced ?? '').includes('moved from'), announced);
  const settled = await quiet.evaluate(() =>
    [...document.querySelectorAll('table[aria-label="Portfolio standings"] tbody tr')].map(
      (row) => getComputedStyle(row).transform,
    ),
  );
  log('rows not transformed', settled.every((value) => value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)'), settled);

  console.log('dialog focus trap');
  const studio = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const entrant = await studio.newPage();
  await entrant.goto(`${BASE}/signin`);
  await entrant.getByRole('textbox', { name: 'Email' }).fill('studio@halftone.example');
  await entrant.getByLabel('Password').fill('halftone-pass-26');
  await entrant.getByRole('button', { name: 'Sign in' }).click();
  await entrant.waitForTimeout(1000);
  const signedIn = entrant.url().includes('/studio');
  log('studio signed in', signedIn, entrant.url());

  await browser.close();
  console.log(failures === 0 ? '\nA11Y CHECKS PASSED' : `\n${failures} A11Y CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
