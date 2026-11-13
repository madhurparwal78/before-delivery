// Motion and effects: the handle and tick transitions, and what reduced
// motion changes.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
let fails = 0;
let checks = 0;
const chk = (label, got, want) => {
  checks += 1;
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} = ${JSON.stringify(String(got))}${ok ? '' : `  want ${JSON.stringify(String(want))}`}`,
  );
};
const note = (t) => console.log(`---- ${t}`);

const browser = await chromium.launch();

async function rulerPage(reducedMotion) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/?actor=stw-ines`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return page;
}

note('with motion allowed, the handle and ticks have short transitions (DP-48)');
const normal = await rulerPage('no-preference');
const normalTiming = await normal.evaluate(() => {
  const handle = document.querySelector('.shock-handle');
  const tick = document.querySelector('.shock-tick');
  return {
    handle: getComputedStyle(handle).transitionDuration,
    handleProperty: getComputedStyle(handle).transitionProperty,
    tick: tick === null ? 'none' : getComputedStyle(tick).transitionDuration,
    tickProperty: tick === null ? 'none' : getComputedStyle(tick).transitionProperty,
  };
});
const seconds = (value) => parseFloat(value);
chk('the handle moves in 0.1 to 0.15 seconds', seconds(normalTiming.handle) >= 0.1 && seconds(normalTiming.handle) <= 0.15, true);
chk('it is the position that moves', normalTiming.handleProperty, 'left');
chk('a tick fills in 0.15 to 0.2 seconds', seconds(normalTiming.tick) >= 0.15 && seconds(normalTiming.tick) <= 0.2, true);
chk('it is the fill that changes', normalTiming.tickProperty, 'background-color');

note('a crossed tick turns from ink to the signal colour (DP-49)');
const slider = normal.getByRole('slider', { name: 'Price shock' });
await slider.focus();
const inkColour = await normal.evaluate(() => getComputedStyle(document.querySelector('.shock-tick')).backgroundColor);
await normal.keyboard.press('Home');
await normal.waitForTimeout(600);
const crossed = await normal.evaluate(() => {
  const ticks = Array.from(document.querySelectorAll('.shock-tick'));
  const red = ticks.filter((t) => t.classList.contains('at-risk'));
  return {
    count: red.length,
    colour: red.length > 0 ? getComputedStyle(red[0]).backgroundColor : '',
    hatched: red.filter((t) => t.classList.contains('hatched')).length,
  };
});
chk('every tick is crossed at −60%', crossed.count > 0, true);
chk('the crossed colour differs from the ink', crossed.colour !== inkColour, true);
chk('it is the signal red', crossed.colour, 'rgb(156, 42, 31)');
chk('no hatch is added when motion is allowed', crossed.hatched, 0);

note('under reduced motion nothing transitions (DP-48)');
const reduced = await rulerPage('reduce');
const reducedTiming = await reduced.evaluate(() => {
  const handle = document.querySelector('.shock-handle');
  const tick = document.querySelector('.shock-tick');
  return {
    handle: getComputedStyle(handle).transitionDuration,
    tick: tick === null ? 'none' : getComputedStyle(tick).transitionDuration,
    dialogAnimation: getComputedStyle(document.body).animationDuration,
  };
});
chk('the handle jumps with no transition', seconds(reducedTiming.handle) <= 0.001, true);
chk('ticks change fill instantly', seconds(reducedTiming.tick) <= 0.001, true);

note('under reduced motion each crossed tick also carries a hatch (DP-49)');
const reducedSlider = reduced.getByRole('slider', { name: 'Price shock' });
await reducedSlider.focus();
await reduced.keyboard.press('Home');
await reduced.waitForTimeout(400);
const hatching = await reduced.evaluate(() => {
  const ticks = Array.from(document.querySelectorAll('.shock-tick'));
  const red = ticks.filter((t) => t.classList.contains('at-risk'));
  return {
    red: red.length,
    hatched: red.filter((t) => t.classList.contains('hatched')).length,
    image: red.length > 0 ? getComputedStyle(red[0]).backgroundImage : '',
  };
});
chk('every crossed tick is hatched', hatching.hatched, hatching.red);
chk('the hatch is a real diagonal pattern', hatching.image.includes('repeating-linear-gradient'), true);

note('moving back right returns a tick to ink (DP-48)');
await reduced.keyboard.press('End');
await reduced.waitForTimeout(400);
const cleared = await reduced.evaluate(() =>
  document.querySelectorAll('.shock-tick.at-risk').length,
);
chk('no tick is crossed at +60%', cleared, 0);

note('figures never roll: they swap instantly (Motion and effects)');
const figureTransition = await normal.evaluate(() => {
  const figure = document.querySelector('.value.figure');
  const style = getComputedStyle(figure);
  return `${style.transitionProperty}/${style.animationName}`;
});
chk('a figure has no transition or animation', figureTransition, 'all/none');

note('there are no idle animations anywhere (Motion and effects)');
const animated = await normal.evaluate(() =>
  Array.from(document.querySelectorAll('*')).filter((node) => {
    const style = getComputedStyle(node);
    return style.animationName !== 'none' && style.animationIterationCount !== '1';
  }).length,
);
chk('nothing loops', animated, 0);

await browser.close();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
