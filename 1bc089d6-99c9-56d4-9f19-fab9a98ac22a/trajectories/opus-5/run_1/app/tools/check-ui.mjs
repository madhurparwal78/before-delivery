// Walks the Stillhour story in a real browser and checks the published roles and copy.
import { chromium } from 'playwright';

const BASE = process.env.CHECK_BASE ?? 'http://127.0.0.1:4173';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) passed += 1;
  else {
    failures.push(name);
    console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400));
  }
}
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

const mail = {
  async clear() {
    await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
  },
  async to(address) {
    const response = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    const body = await response.json();
    return (body.messages ?? []).filter((message) => message.To.some((it) => it.Address === address));
  },
  async tokenFor(address) {
    const [message] = await this.to(address);
    if (!message) return null;
    const detail = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    return /token=([A-Za-z0-9_-]+)/.exec(detail.Text ?? '')?.[1] ?? null;
  },
};

const unique = () => Math.random().toString(36).slice(2, 9);

const toggleRitual = async (page, name) => {
  const button = page.getByRole('button', { name });
  await button.focus();
  await page.waitForTimeout(200);
  await button.click();
  await page.waitForTimeout(80);
};

async function openStory(context, path = '/') {
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  page.problems = problems;
  return page;
}

async function passGate(page, silent = false) {
  const gate = page.getByRole('dialog', { name: 'Stillhour' });
  await gate.waitFor({ state: 'visible' });
  const bar = page.getByRole('progressbar', { name: 'Gathering the evening' });
  await bar.waitFor();
  const button = page.getByRole('button', { name: silent ? 'Begin in silence' : 'Begin the hour' });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  eq('gate reaches one hundred per cent', await bar.getAttribute('aria-valuenow'), '100');
  await button.click();
  await page.waitForTimeout(700);
}

async function gateAndTitle(context) {
  const page = await openStory(context);
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(150);
  eq('nothing scrolls behind the gate', await page.evaluate(() => window.scrollY), beforeScroll);
  await passGate(page);

  const title = page.getByRole('heading', { level: 1, name: 'Give your last hour a shape.' });
  check('the hero title keeps its full accessible name', await title.count() === 1);
  eq('focus moves to the hero title', await page.evaluate(() => document.activeElement?.id), 'hero-title');
  eq('the sound switch is on', await page.getByRole('switch', { name: 'Sound' }).getAttribute('aria-checked'), 'true');
  eq('the story clock starts at 21:00', await page.getByRole('timer', { name: 'Story clock' }).textContent(), '21:00');

  for (const heading of [
    'The hour nobody plans.',
    'Put the screen to bed.',
    'Breathe in for four, hold for seven, out for eight.',
    'Build your hour.',
    'One still hour.',
    'Plan your Stillhour.',
  ]) {
    check(`chapter present: ${heading}`, (await page.getByRole('region', { name: heading }).count()) === 1);
  }
  check('the numbers band is a named region', (await page.getByRole('region', { name: 'Tonight in numbers' }).count()) === 1);
  check('the band shows sixty minutes', (await page.getByText('60 minutes', { exact: true }).count()) >= 1);
  check('the band shows six rituals', (await page.getByText('06 rituals', { exact: true }).count()) >= 1);
  check('the band shows one bedtime', (await page.getByText('01 bedtime', { exact: true }).count()) >= 1);
  const live = await page.locator('#live-count').textContent();
  check('the live count line reads from the server', /keeping a Stillhour/.test(live), live);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  eq('the story clock ends at 22:00', await page.getByRole('timer', { name: 'Story clock' }).textContent(), '22:00');
  const footer = page.getByRole('contentinfo');
  check('the footer says goodnight', (await footer.getByText('Goodnight.').count()) === 1);
  check('the footer links to Manage my hour', (await footer.getByRole('link', { name: 'Manage my hour' }).count()) === 1);
  check('the footer links to Privacy', (await footer.getByRole('link', { name: 'Privacy' }).count()) === 1);

  await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) / 2)));
  await page.waitForTimeout(300);
  eq('the story clock reads 21:30 halfway', await page.getByRole('timer', { name: 'Story clock' }).textContent(), '21:30');

  eq('no console errors on the story', page.problems, []);
  await page.close();
}

async function cityCounter(context) {
  const page = await openStory(context);
  await passGate(page, true);
  const city = page.getByRole('region', { name: 'The city at night' });
  const count = page.locator('#city-count');
  const caption = page.locator('#city-caption');

  const scrollCity = async (share) => {
    await page.evaluate((at) => {
      const scene = document.getElementById('scene-city');
      const rect = scene.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      window.scrollTo(0, Math.round(top + at * (scene.offsetHeight - window.innerHeight)));
    }, share);
    await page.waitForTimeout(300);
  };

  await scrollCity(0);
  eq('the counter starts at 4,096', await count.textContent(), '4,096 windows lit');
  eq('the first caption', await caption.textContent(), 'The offices close.');
  await scrollCity(0.1);
  eq('the counter holds until 0.18', await count.textContent(), '4,096 windows lit');
  await scrollCity(0.5);
  const middle = await count.textContent();
  check('the counter at the middle', /^2,04[89] windows lit$/.test(middle), middle);
  eq('the second caption', await caption.textContent(), 'The kitchens go quiet.');
  await scrollCity(0.9);
  eq('the counter ends at one', await count.textContent(), '1 window lit');
  eq('the third caption', await caption.textContent(), 'One window left.');
  await scrollCity(0.5);
  eq('the counter reverts on the way up', await count.textContent(), middle);
  eq('the caption reverts too', await caption.textContent(), 'The kitchens go quiet.');
  check('the counter is one plain string', (await count.evaluate((node) => node.childElementCount)) === 0);
  check('the city readout is a region', (await city.count()) === 1);
  await page.close();
}

async function dialAndBreathing(context) {
  const page = await openStory(context);
  await passGate(page, true);
  const dial = page.getByRole('meter', { name: 'Screen brightness' });
  await page.evaluate(() => {
    const node = document.getElementById('brightness-dial');
    window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - window.innerHeight);
  });
  await page.waitForTimeout(150);
  eq('the dial starts at 100%', await dial.getAttribute('aria-valuenow'), '100');
  await page.evaluate(() => {
    const node = document.getElementById('brightness-dial');
    window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY + node.offsetHeight);
  });
  await page.waitForTimeout(150);
  eq('the dial falls to 5%', await dial.getAttribute('aria-valuenow'), '5');
  eq('the dial shows its value', await page.locator('#dial-value').textContent(), '5%');

  const button = page.getByRole('button', { name: 'Breathe with me' });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const status = page.getByRole('status', { name: 'Breathing guide' });
  eq('the first phase is announced', await status.textContent(), 'Breathe in');
  eq('the round is visible', await page.locator('#breath-round').textContent(), 'Round 1 of 3');
  eq('the button becomes Stop', await page.getByRole('button', { name: 'Stop' }).count(), 1);
  await page.waitForTimeout(4300);
  eq('the second phase is announced', await status.textContent(), 'Hold');
  await page.getByRole('button', { name: 'Stop' }).click();
  eq('stopping is announced', await status.textContent(), 'Breathing stopped.');
  eq('the button returns', await page.getByRole('button', { name: 'Breathe with me' }).count(), 1);
  await page.close();
}

async function ritualsAndAddress(context) {
  const page = await openStory(context);
  await passGate(page, true);
  const status = page.getByRole('status', { name: 'Ritual updates' });

  for (const title of ['Dim the lamps', 'Warm shower', 'Paper, not pixels', 'Tomorrow list', 'Slow stretch', 'Breathe']) {
    check(`card present: ${title}`, (await page.getByRole('group', { name: title }).count()) === 1);
  }
  await toggleRitual(page, 'Add Dim the lamps to my hour');
  eq('adding is announced', await status.textContent(), 'Dim the lamps added. 10 of 60 minutes planned.');
  eq(
    'the toggle changes name',
    await page.getByRole('button', { name: 'Remove Dim the lamps from my hour' }).getAttribute('aria-pressed'),
    'true',
  );
  eq('the address carries the ritual', new URL(page.url()).searchParams.get('rituals'), 'dim-lamps:10');

  await toggleRitual(page, 'Add Breathe to my hour');
  eq('the address keeps the order', new URL(page.url()).searchParams.get('rituals'), 'dim-lamps:10,breathe:5');
  eq('the running total is announced', await status.textContent(), 'Breathe added. 15 of 60 minutes planned.');

  const checkbox = page.getByRole('checkbox', { name: 'Dim the lamps' });
  eq('the planner checkbox follows', await checkbox.isChecked(), true);
  const spin = page.getByRole('spinbutton', { name: 'Dim the lamps minutes' });
  eq('the planner spinbutton follows', await spin.inputValue(), '10');

  await toggleRitual(page, 'Add Warm shower to my hour');
  await toggleRitual(page, 'Add Paper, not pixels to my hour');
  await toggleRitual(page, 'Add Slow stretch to my hour');
  await toggleRitual(page, 'Add Tomorrow list to my hour');
  eq('a full hour is reached', await page.locator('#plan-summary-total').textContent(), '60 of 60 minutes planned.');

  await spin.fill('30');
  await spin.dispatchEvent('change');
  eq('a minutes change past sixty is refused', await spin.inputValue(), '10');

  await toggleRitual(page, 'Remove Breathe from my hour');
  await spin.fill('15');
  await spin.dispatchEvent('change');
  eq('a minutes change that fits is kept', await spin.inputValue(), '15');
  eq('the total follows the minutes', await page.locator('#plan-summary-total').textContent(), '60 of 60 minutes planned.');

  await toggleRitual(page, 'Add Breathe to my hour');
  eq(
    'a refusal is announced',
    await status.textContent(),
    'There is no room for Breathe. Your hour already has 60 of 60 minutes.',
  );
  eq(
    'a refused ritual changes nothing',
    await page.getByRole('button', { name: 'Add Breathe to my hour' }).getAttribute('aria-pressed'),
    'false',
  );

  const reload = await openStory(context, '/?rituals=dim-lamps:10,breathe:5');
  await passGate(reload, true);
  eq(
    'the address restores the choices',
    await reload.locator('#plan-summary-total').textContent(),
    '15 of 60 minutes planned.',
  );
  eq('a shared address keeps its order', new URL(reload.url()).searchParams.get('rituals'), 'dim-lamps:10,breathe:5');
  await reload.close();

  const messy = await openStory(context, '/?rituals=tea:10,dim-lamps:7,breathe:5,breathe:5,warm-shower:15');
  await passGate(messy, true);
  eq('a messy address is cleaned', new URL(messy.url()).searchParams.get('rituals'), 'breathe:5,warm-shower:15');
  await messy.close();
  await page.close();
}

async function film(context) {
  const page = await openStory(context);
  await passGate(page, true);
  const opener = page.getByRole('button', { name: 'Play the film' });
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'One still hour' });
  await dialog.waitFor();
  const status = page.getByRole('status', { name: 'Film status' });
  eq('focus moves to Play', await page.evaluate(() => document.activeElement?.id), 'film-play');
  await page.waitForTimeout(600);
  eq('playing is announced', await status.textContent(), 'Playing');
  eq('the play button becomes Pause', await page.getByRole('button', { name: 'Pause' }).count(), 1);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  eq('space pauses', await status.textContent(), 'Paused');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const seek = page.getByRole('slider', { name: 'Seek' });
  check('the seek slider reports its value', (await seek.getAttribute('aria-valuetext'))?.includes('of 0:40'), await seek.getAttribute('aria-valuetext'));
  await page.keyboard.press('c');
  eq('captions are announced', await status.textContent(), 'Captions on');
  await page.keyboard.press('m');
  eq('muting is announced', await status.textContent(), 'Muted');
  check('the mute button shows its state', (await page.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  eq('the dialog closes', await dialog.count(), 0);
  eq('focus returns to the opener', await page.evaluate(() => document.activeElement?.id), 'play-film');
  await page.close();
}

async function plannerJourney(context) {
  const email = `mira-${unique()}@example.com`;
  await mail.clear();
  const page = await openStory(context, '/?rituals=dim-lamps:10,breathe:5');
  await passGate(page, true);

  const save = page.getByRole('button', { name: 'Save my hour' });
  await save.scrollIntoViewIfNeeded();
  await save.click();
  const alert = page.getByRole('alert');
  await alert.waitFor();
  check('the error summary appears', (await alert.getByRole('heading', { name: 'Check your hour' }).count()) === 1);
  const link = alert.getByRole('link', { name: 'Email' });
  eq('the summary links to the field', await link.count(), 1);
  await link.click();
  eq('the link moves focus to the field', await page.evaluate(() => document.activeElement?.id), 'plan-email');
  eq('the planner status names the problem', await page.getByRole('status', { name: 'Planner status' }).textContent(), 'Some details need another look.');
  eq('nothing was sent', (await mail.to(email)).length, 0);

  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('combobox', { name: 'Bedtime' }).selectOption('23:00');
  await page.getByRole('combobox', { name: 'Time zone' }).selectOption('Asia/Tokyo');
  await page.getByRole('textbox', { name: 'A note for tonight' }).fill('Lights down early.');
  eq('the counter counts as a reader sees it', await page.locator('#plan-note-counter').textContent(), '18 of 280 characters');
  eq(
    'the summary shows the hour',
    await page.locator('#plan-summary-hour').textContent(),
    'Your hour starts at 22:00 and ends at 23:00, Asia/Tokyo time.',
  );

  await save.click();
  await save.click();
  await page.getByRole('status', { name: 'Planner status' }).filter({ hasText: 'Check your inbox' }).waitFor({ timeout: 8000 });
  eq(
    'the saved message appears',
    await page.getByRole('status', { name: 'Planner status' }).textContent(),
    'Check your inbox. We sent a link to confirm your hour.',
  );
  await page.waitForTimeout(500);
  eq('exactly one confirmation email', (await mail.to(email)).length, 1);
  eq('the address still shows the rituals', new URL(page.url()).searchParams.get('rituals'), 'dim-lamps:10,breathe:5');

  const token = await mail.tokenFor(email);
  const signin = await openStory(context, `/signin?token=${token}`);
  await page.waitForTimeout(100);
  eq('the sign-in page announces the confirmation', await signin.getByRole('status', { name: 'Link status' }).textContent(), 'Your Stillhour is confirmed. Reminders are on.');
  check('the sign-in page offers one way on', (await signin.getByRole('link', { name: 'Manage my hour' }).count()) === 1);
  check('the sign-in page has no site footer', (await signin.getByRole('contentinfo').count()) === 0);
  await signin.close();
  await page.close();
  return email;
}

async function manageJourney(context, email) {
  const page = await openStory(context, '/manage');
  eq('the manage heading', await page.getByRole('heading', { level: 1, name: 'Manage my hour' }).count(), 1);
  await page.getByText(`Signed in as ${email}`).waitFor({ timeout: 5000 });
  const next = await page.locator('#next-reminder').textContent();
  check('the next reminder is shown in the hour zone', /^Next reminder: \w+ \d+ \w+ at \d\d:\d\d \(Asia\/Tokyo\)$/.test(next), next);

  await page.getByRole('combobox', { name: 'Bedtime' }).selectOption('22:30');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Your hour is saved.' }).waitFor({ timeout: 5000 });
  eq('the editor saves', await page.getByRole('status', { name: 'Manage status' }).textContent(), 'Your hour is saved.');

  const reminders = page.getByRole('switch', { name: 'Reminders' });
  await reminders.click();
  await page.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Reminders are paused.' }).waitFor({ timeout: 5000 });
  eq('pausing is announced', await reminders.getAttribute('aria-checked'), 'false');
  eq('the paused line shows', await page.locator('#next-reminder').textContent(), 'Reminders are paused.');
  await reminders.click();
  await page.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Reminders are on.' }).waitFor({ timeout: 5000 });

  const share = page.getByRole('button', { name: 'Create a share link' });
  await share.click();
  await page.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Your share link is ready.' }).waitFor({ timeout: 5000 });
  const url = await page.getByRole('textbox', { name: 'Share link' }).inputValue();
  check('the share box holds the full address', /^https?:\/\/.+\/p\/[A-Za-z0-9_-]{22,}$/.test(url), url);
  eq('the button offers a new link', await page.getByRole('button', { name: 'Make a new share link' }).count(), 1);

  const partner = await openStory(context, new URL(url).pathname);
  await partner.getByRole('heading', { level: 1, name: 'A shared Stillhour' }).waitFor();
  await partner.getByText('minutes in all').waitFor({ timeout: 5000 });
  const when = await partner.locator('#shared-when').textContent();
  check('the partner sees the hour', /Winding down from \d\d:\d\d for bed at \d\d:\d\d, Asia\/Tokyo time\./.test(when), when);
  check('the partner never sees the address', !(await partner.content()).includes(email));
  check('the partner never sees the note', !(await partner.content()).includes('Lights down early.'));
  eq('the rituals are a named list', await partner.getByRole('list', { name: 'Rituals' }).count(), 1);

  await page.getByRole('button', { name: 'Turn off sharing' }).click();
  await page.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Sharing is off.' }).waitFor({ timeout: 5000 });
  await partner.reload();
  await partner.getByRole('heading', { level: 1, name: 'This shared hour is no longer available.' }).waitFor({ timeout: 5000 });
  check('the partner sees the hour is gone', true);
  await partner.close();

  await page.getByRole('button', { name: 'Delete everything' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete everything' });
  await dialog.waitFor();
  eq('focus starts in the confirmation box', await page.evaluate(() => document.activeElement?.id), 'delete-confirm');
  const go = page.getByRole('button', { name: 'Delete my hour for good' });
  eq('the button waits for DELETE', await go.isDisabled(), true);
  await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  eq('the button wakes up', await go.isDisabled(), false);
  await go.click();
  await page.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Everything is deleted.' }).waitFor({ timeout: 5000 });
  eq('the deleted message appears', await page.getByRole('status', { name: 'Manage status' }).textContent(), 'Everything is deleted. You will not get another reminder.');
  eq('the sign-in form returns', await page.getByRole('button', { name: 'Send me a sign-in link' }).count(), 1);
  eq('no console errors on manage', page.problems, []);
  await page.close();
}

async function signInForm(context) {
  const page = await openStory(context, '/manage');
  await page.getByRole('button', { name: 'Send me a sign-in link' }).waitFor();
  const status = page.getByRole('status', { name: 'Sign-in status' });
  await page.getByRole('textbox', { name: 'Email' }).fill('not-an-address');
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
  eq('a bad address is refused in the browser', await status.textContent(), 'Enter an email address, like name@example.com.');
  await page.getByRole('textbox', { name: 'Email' }).fill(`nobody-${unique()}@example.com`);
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
  await status.filter({ hasText: 'If that address has a Stillhour' }).waitFor({ timeout: 5000 });
  eq(
    'the neutral sent message',
    await status.textContent(),
    'If that address has a Stillhour, a sign-in link is on its way. It works once, for 15 minutes.',
  );
  await page.close();
}

async function viewports(browser) {
  for (const size of [
    { width: 375, height: 812, isMobile: true, hasTouch: true },
    { width: 768, height: 1024, isMobile: true, hasTouch: true },
    { width: 1280, height: 800 },
  ]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: !!size.hasTouch });
    const page = await openStory(context);
    await passGate(page, true);
    const label = `${size.width}x${size.height}`;
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`no sideways scrolling at ${label}`, !sideways, await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    for (const heading of ['The hour nobody plans.', 'Build your hour.', 'Plan your Stillhour.']) {
      check(`chapter reachable at ${label}: ${heading}`, (await page.getByRole('region', { name: heading }).count()) === 1);
    }
    check(`the planner is present at ${label}`, (await page.getByRole('button', { name: 'Save my hour' }).count()) === 1);
    const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.track')).gridTemplateColumns);
    check(`the ritual track is laid out at ${label}`, typeof columns === 'string');
    eq(`no console errors at ${label}`, page.problems, []);
    await page.close();
    await context.close();
  }
}

async function reducedMotion(browser) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await openStory(context);
  await passGate(page, true);
  const pinned = await page.evaluate(() => getComputedStyle(document.getElementById('ritual-pin')).position);
  eq('chapter four never pins with reduced motion', pinned, 'static');
  const smooth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  eq('scrolling is never smoothed', smooth, 'auto');
  await page.evaluate(() => {
    const scene = document.getElementById('scene-city');
    window.scrollTo(0, scene.getBoundingClientRect().top + window.scrollY + (scene.offsetHeight - window.innerHeight) * 0.5);
  });
  await page.waitForTimeout(250);
  const reducedCount = await page.locator('#city-count').textContent();
  check('the counter still follows scroll', /^2,04[89] windows lit$/.test(reducedCount), reducedCount);
  const clips = await page.evaluate(() => [...document.querySelectorAll('.card__clip')].every((clip) => clip.paused));
  check('ritual clips do not autoplay', clips);
  eq('the numerals show their final values', await page.locator('[data-roll="60"]').textContent(), '60');
  eq('no console errors with reduced motion', page.problems, []);
  await page.close();
  await context.close();
}

async function soundMemory(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await openStory(context);
  await passGate(page);
  const sound = page.getByRole('switch', { name: 'Sound' });
  eq('sound starts on after Begin the hour', await sound.getAttribute('aria-checked'), 'true');
  await sound.click();
  eq('the switch turns sound off', await sound.getAttribute('aria-checked'), 'false');

  const again = await openStory(context);
  eq(
    'the choice is remembered in this browser',
    await again.getByRole('switch', { name: 'Sound' }).getAttribute('aria-checked'),
    'false',
  );
  await again.getByRole('button', { name: 'Begin in silence' }).waitFor({ state: 'visible', timeout: 10_000 });
  eq(
    'focus starts on the remembered choice',
    await again.evaluate(() => document.activeElement?.id),
    'begin-in-silence',
  );
  await again.close();
  await page.close();
  await context.close();
}

async function sidewaysChapter(browser) {
  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await openStory(wide);
  await passGate(page, true);
  eq(
    'chapter four pins on a wide screen',
    await page.evaluate(() => getComputedStyle(document.getElementById('ritual-pin')).position),
    'sticky',
  );
  await page.evaluate(() => {
    const chapter = document.getElementById('chapter-rituals');
    window.scrollTo(0, chapter.getBoundingClientRect().top + window.scrollY);
  });
  await page.waitForTimeout(200);
  const atStart = await page.evaluate(() => getComputedStyle(document.getElementById('ritual-track')).transform);
  await page.evaluate(() => {
    const chapter = document.getElementById('chapter-rituals');
    window.scrollTo(0, chapter.getBoundingClientRect().top + window.scrollY + (chapter.offsetHeight - window.innerHeight));
  });
  await page.waitForTimeout(200);
  const atEnd = await page.evaluate(() => getComputedStyle(document.getElementById('ritual-track')).transform);
  check('the cards travel sideways with scroll', atStart !== atEnd, { atStart, atEnd });
  check('the page still never scrolls sideways', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.close();
  await wide.close();

  const narrow = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  const small = await openStory(narrow);
  await passGate(small, true);
  eq(
    'chapter four never pins on a narrow screen',
    await small.evaluate(() => getComputedStyle(document.getElementById('ritual-pin')).position),
    'static',
  );
  const columns = await small.evaluate(() => getComputedStyle(document.getElementById('ritual-track')).gridTemplateColumns.split(' ').length);
  eq('the cards stack in two columns at 768', columns, 2);
  await small.close();
  await narrow.close();
}

async function flowersAndKeyboard(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await openStory(context);
  await passGate(page, true);
  await page.evaluate(() => {
    const scene = document.getElementById('scene-flowers');
    window.scrollTo(0, scene.getBoundingClientRect().top + window.scrollY);
  });
  await page.waitForTimeout(400);
  const spots = await page.locator('#flower-hits span').count();
  check('the moonflowers can be touched', spots > 0, spots);
  if (spots > 0) await page.locator('#flower-hits span').first().hover({ force: true });
  await page.waitForTimeout(1100);
  check('hovering a flower does not break the scene', page.problems.length === 0, page.problems);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.getByRole('link', { name: 'Stillhour' }).focus();
  const reached = [];
  for (let step = 0; step < 9; step += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(120);
    reached.push(
      await page.evaluate(() => {
        const node = document.activeElement;
        if (!node || node === document.body) return 'body';
        const ring = getComputedStyle(node).outlineColor;
        return { id: node.id, name: node.textContent?.trim().slice(0, 24), ring, width: node.getBoundingClientRect().width };
      }),
    );
  }
  check('tabbing never lands on the page body', !reached.includes('body'), reached);
  eq('the sound switch follows the wordmark', reached[0]?.id, 'sound-switch');
  eq('the breathing button comes next in reading order', reached[1]?.id, 'breathe-button');
  check(
    'the ritual toggles follow the breathing button',
    reached.slice(2, 8).every((node) => node.name?.startsWith('Add ')),
    reached.slice(2, 8),
  );
  check(
    'every focused control shows an ember ring',
    reached.every((node) => node.ring === 'rgb(255, 138, 61)'),
    reached,
  );
  check(
    'every focused control is a large target',
    reached.every((node) => node.width >= 44),
    reached,
  );
  await page.close();
  await context.close();
}

async function conflictingTabs(context) {
  const email = `tabs-${unique()}@example.com`;
  await mail.clear();
  const page = await openStory(context, '/?rituals=breathe:5');
  await passGate(page, true);
  await page.getByRole('textbox', { name: 'Email' }).scrollIntoViewIfNeeded();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('combobox', { name: 'Time zone' }).selectOption('Europe/London');
  await page.getByRole('button', { name: 'Save my hour' }).click();
  await page.getByRole('status', { name: 'Planner status' }).filter({ hasText: 'Check your inbox' }).waitFor({ timeout: 8000 });
  const token = await mail.tokenFor(email);
  const signin = await openStory(context, `/signin?token=${token}`);
  await signin.getByRole('status', { name: 'Link status' }).filter({ hasText: 'confirmed' }).waitFor({ timeout: 5000 });
  await signin.close();
  await page.close();

  const first = await openStory(context, '/manage');
  await first.getByText(`Signed in as ${email}`).waitFor({ timeout: 5000 });
  const second = await openStory(context, '/manage');
  await second.getByText(`Signed in as ${email}`).waitFor({ timeout: 5000 });

  await first.getByRole('combobox', { name: 'Bedtime' }).selectOption('22:00');
  await first.getByRole('button', { name: 'Save changes' }).click();
  await first.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'Your hour is saved.' }).waitFor({ timeout: 5000 });

  await second.getByRole('combobox', { name: 'Bedtime' }).selectOption('21:30');
  await second.getByRole('button', { name: 'Save changes' }).click();
  await second.getByRole('status', { name: 'Manage status' }).filter({ hasText: 'changed somewhere else' }).waitFor({ timeout: 5000 });
  eq(
    'the older tab sees the conflict',
    await second.getByRole('status', { name: 'Manage status' }).textContent(),
    'This plan changed somewhere else. Here is the latest version; your edits were not saved.',
  );
  eq('the older tab now holds the latest hour', await second.getByRole('combobox', { name: 'Bedtime' }).inputValue(), '22:00');
  await first.reload();
  await first.getByText(`Signed in as ${email}`).waitFor({ timeout: 5000 });
  eq('the first tab\u2019s save stands', await first.getByRole('combobox', { name: 'Bedtime' }).inputValue(), '22:00');
  await first.close();
  await second.close();
  return email;
}

async function reminderZone(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/Los_Angeles' });
  await mail.clear();
  const signedOut = await openStory(context, '/manage');
  await signedOut.getByRole('textbox', { name: 'Email' }).fill(email);
  await signedOut.getByRole('button', { name: 'Send me a sign-in link' }).click();
  await signedOut
    .getByRole('status', { name: 'Sign-in status' })
    .filter({ hasText: 'on its way' })
    .waitFor({ timeout: 5000 });
  const token = await mail.tokenFor(email);
  const signin = await openStory(context, `/signin?token=${token}`);
  await signin
    .getByRole('status', { name: 'Link status' })
    .filter({ hasText: 'Reminders are on.' })
    .waitFor({ timeout: 5000 });
  await signin.close();
  await signedOut.close();

  const page = await openStory(context, '/manage');
  await page.getByText(`Signed in as ${email}`).waitFor({ timeout: 5000 });
  const line = await page.locator('#next-reminder').textContent();
  check('the next reminder keeps the hour\u2019s own zone', /\(Europe\/London\)$/.test(line), line);
  check('the next reminder reads 21:00 London time', / at 21:00 /.test(line), line);
  await page.close();
  await context.close();
}

async function reducedFilm(browser) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await openStory(context);
  await passGate(page, true);
  const opener = page.getByRole('button', { name: 'Play the film' });
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  await page.getByRole('dialog', { name: 'One still hour' }).waitFor();
  await page.waitForTimeout(600);
  eq('the film waits for Play with reduced motion', await page.evaluate(() => document.getElementById('film-video').paused), true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(500);
  eq('pressing Play starts it', await page.getByRole('status', { name: 'Film status' }).textContent(), 'Playing');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(200);
  eq('closing pauses the film', await page.evaluate(() => document.getElementById('film-video').paused), true);
  await page.close();
  await context.close();
}

async function run() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await gateAndTitle(context);
  await cityCounter(context);
  await dialAndBreathing(context);
  await ritualsAndAddress(context);
  await film(context);
  const email = await plannerJourney(context);
  await manageJourney(context, email);
  await signInForm(context);
  const keeper = await conflictingTabs(context);
  await context.close();
  await reminderZone(browser, keeper);
  await soundMemory(browser);
  await sidewaysChapter(browser);
  await flowersAndKeyboard(browser);
  await viewports(browser);
  await reducedMotion(browser);
  await reducedFilm(browser);
  await browser.close();
  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

await run();
