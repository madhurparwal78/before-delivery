import { chromium } from 'playwright';
import {
  BASE,
  VIEWPORTS,
  check,
  figure,
  makeWorld,
  noSidewaysOverflow,
  report,
  signIn,
  stageHooks,
  statusText,
  tabOrder,
  waitForStageReady,
} from './browser-lib.mjs';

const browser = await chromium.launch();
const world = await makeWorld();
const publicGuide = world.guides.public;

async function contextFor(person) {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  if (person !== null) await signIn(context, person.email, person.password);
  return context;
}

/* ---------- DP-62..DP-67: forking ---------- */
{
  const readerCtx = await contextFor(world.reader);
  const authorCtx = await contextFor(world.author);
  const readerPage = await readerCtx.newPage();
  const authorPage = await authorCtx.newPage();

  await authorPage.goto(`${BASE}/g/${publicGuide.slug}`);
  await waitForStageReady(authorPage);
  await readerPage.goto(`${BASE}/g/${publicGuide.slug}`);
  await waitForStageReady(readerPage);

  /* DP-63: the fork dialog by keyboard. */
  const forkButton = readerPage.locator('.reader-bar [aria-label="Fork guide"]');
  await forkButton.focus();
  await readerPage.keyboard.press('Enter');
  await readerPage.waitForTimeout(250);
  const dialogOpen = await readerPage.evaluate(
    () => document.querySelector('[role="dialog"][aria-label="Fork guide"]')?.hidden === false,
  );
  check('fork dialog opens by keyboard', dialogOpen);
  const names = await tabOrder(readerPage, 3);
  check(
    'Tab wraps inside the fork dialog',
    names.every((name) => name === null || /Fork version|Cancel/.test(name)),
    names,
  );
  await readerPage.keyboard.press('Escape');
  await readerPage.waitForTimeout(200);
  const returned = await readerPage.evaluate(() => document.activeElement.getAttribute('aria-label'));
  check('Escape returns focus to Fork guide', returned === 'Fork guide', returned);

  await forkButton.focus();
  await readerPage.keyboard.press('Enter');
  await readerPage.waitForTimeout(250);
  await readerPage.getByRole('button', { name: `Fork version 3` }).click();
  await readerPage.waitForURL(/\/edit\//, { timeout: 15000 });
  check('confirm opens the fork editor', readerPage.url().includes('/edit/'), readerPage.url());

  /* DP-64: the fork credit on the fork. */
  const credit = await readerPage.evaluate(
    () => document.querySelector('.fork-credit')?.textContent ?? null,
  );
  check(
    'fork credit copy',
    credit === `Forked from ${publicGuide.title} by ${world.author.name}, version 3.`,
    credit,
  );

  /* DP-65: the source's open reader page shows the fork count live. */
  await authorPage.waitForFunction(
    () => document.querySelector('[aria-label="Fork count"]').textContent === '1 fork',
    undefined,
    { timeout: 4000 },
  );
  check('fork count updates live', (await statusText(authorPage, 'Fork count')) === '1 fork');

  /* DP-67: the fork sits under Forks on the dashboard after reload. */
  await readerPage.goto(`${BASE}/dashboard`);
  const forkRows = await readerPage.evaluate(() =>
    [...document.querySelectorAll('.shelf[data-shelf="forks"] .type-row')].map((row) => row.textContent.trim()),
  );
  check('fork on the Forks shelf', forkRows.some((row) => row.includes('(fork)')), forkRows);

  /* DP-67: empty shelves carry their exact sentence. */
  const newcomerCtx = await contextFor(world.newcomer);
  const newcomerPage = await newcomerCtx.newPage();
  await newcomerPage.goto(`${BASE}/dashboard`);
  const empties = await newcomerPage.evaluate(() =>
    [...document.querySelectorAll('.shelf')].map((shelf) => ({
      shelf: shelf.getAttribute('data-shelf'),
      text: shelf.querySelector('.empty-shelf')?.textContent ?? null,
    })),
  );
  const expected = {
    questions: 'No questions waiting.',
    drafts: 'Nothing on the bench yet.',
    published: 'Nothing out in the world yet.',
    forks: 'No forks yet. Find a guide worth adapting.',
    collections: 'No collections yet.',
  };
  check(
    'empty shelf sentences',
    empties.every((entry) => entry.text === expected[entry.shelf]),
    empties,
  );
  await newcomerCtx.close();
  await readerCtx.close();
  await authorCtx.close();
}

/* ---------- DP-76..DP-82: questions ---------- */
{
  const newcomerCtx = await contextFor(world.newcomer);
  const readerCtx = await contextFor(world.reader);
  const authorCtx = await contextFor(world.author);
  const newcomerPage = await newcomerCtx.newPage();
  const readerPage = await readerCtx.newPage();
  const dashboard = await authorCtx.newPage();

  /* DP-77: an unconfirmed account is refused. */
  await newcomerPage.goto(`${BASE}/g/${publicGuide.slug}?step=4`);
  await waitForStageReady(newcomerPage);
  await newcomerPage.getByRole('button', { name: 'Ask the author' }).click();
  await newcomerPage.waitForTimeout(300);
  check(
    'unconfirmed refusal copy',
    (await statusText(newcomerPage, 'Guide status')) ===
      'Confirm your email before you can do that. Check your inbox or send the message again.',
    await statusText(newcomerPage, 'Guide status'),
  );
  check(
    'Resend confirmation appears',
    (await newcomerPage.getByRole('button', { name: 'Resend confirmation' }).count()) === 1,
  );

  /* DP-78: confirm through the delivered message. */
  await newcomerPage.getByRole('button', { name: 'Resend confirmation' }).click();
  await newcomerPage.waitForTimeout(800);
  check(
    'resend copy names the mailbox',
    (await statusText(newcomerPage, 'Guide status')) ===
      `We sent a new confirmation message to ${world.newcomer.email}`.replace(
        world.newcomer.email,
        `${world.newcomer.email}.`,
      ),
    await statusText(newcomerPage, 'Guide status'),
  );

  const search = await (
    await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(world.newcomer.email)}`)
  ).json();
  const message = search.messages?.[0];
  check('message delivered to the newcomer', message !== undefined, search.total);
  let token = null;
  if (message !== undefined) {
    const body = await (await fetch(`http://mailpit:8025/api/v1/message/${message.ID}`)).json();
    token = /\/confirm\?token=([A-Za-z0-9_-]+)/.exec(body.Text)?.[1] ?? null;
    check('message carries the confirm link', token !== null, body.Text?.slice(0, 120));
  }

  if (token !== null) {
    await newcomerPage.goto(`${BASE}/confirm?token=${token}`);
    await newcomerPage.waitForTimeout(700);
    check(
      'confirmed copy',
      (await statusText(newcomerPage, 'Account status')) === 'Your email is confirmed.',
      await statusText(newcomerPage, 'Account status'),
    );
    const pageCarriesToken = await newcomerPage.evaluate(
      (value) => document.documentElement.innerHTML.includes(value),
      token,
    );
    check('no page carries the token beyond the address', pageCarriesToken === false);
  }

  /* DP-79: the ask dialog by keyboard. */
  await dashboard.goto(`${BASE}/dashboard`);
  await readerPage.goto(`${BASE}/g/${publicGuide.slug}?step=4`);
  await waitForStageReady(readerPage);
  const askButton = readerPage.locator('.reader-bar [aria-label="Ask the author"]');
  await askButton.focus();
  await readerPage.keyboard.press('Enter');
  await readerPage.waitForTimeout(250);
  const asking = await readerPage.evaluate(
    () => document.querySelector('.asking-about')?.textContent ?? null,
  );
  check('ask dialog opens at the current step', asking === 'Asking about step 4', asking);
  await readerPage.keyboard.press('Escape');
  await readerPage.waitForTimeout(200);
  check(
    'Escape returns focus to Ask the author',
    (await readerPage.evaluate(() => document.activeElement.getAttribute('aria-label'))) ===
      'Ask the author',
  );

  await askButton.focus();
  await readerPage.keyboard.press('Enter');
  await readerPage.waitForTimeout(250);
  await readerPage.getByLabel('Your question').fill('<b>Which</b> way? **bold**');
  await readerPage.getByRole('button', { name: 'Send question' }).click();
  await readerPage.waitForTimeout(900);
  check(
    'question sent copy',
    (await statusText(readerPage, 'Guide status')) === 'Question sent.',
    await statusText(readerPage, 'Guide status'),
  );

  /* DP-81: literal text with no interpreted element. */
  const rendered = await readerPage.evaluate(() => {
    const item = [...document.querySelectorAll('.step-panel:not([hidden]) .questions li')].at(-1);
    return item === undefined ? null : { text: item.textContent, bold: item.querySelectorAll('b').length };
  });
  check(
    'question text shows exactly as typed',
    rendered !== null && rendered.text.includes('<b>Which</b> way? **bold**') && rendered.bold === 0,
    rendered,
  );

  /* DP-80: the question reaches the open dashboard live. */
  await dashboard.waitForFunction(
    () => /^New question on .+, step 4\.$/.test(document.querySelector('[aria-label="Question alerts"]').textContent),
    undefined,
    { timeout: 4000 },
  );
  const alert = await statusText(dashboard, 'Question alerts');
  check(
    'question alert copy',
    alert === `New question on ${publicGuide.title}, step 4.`,
    alert,
  );

  /* DP-81: the answer reaches the reader's open page live. */
  const answerButton = dashboard.locator('[data-answer]').first();
  await answerButton.click();
  await dashboard.waitForTimeout(250);
  await dashboard.getByLabel('Your answer').fill('Clockwise, a quarter turn.');
  await dashboard.getByRole('button', { name: 'Send answer' }).click();
  await readerPage.waitForFunction(
    () => /answered your question on step/.test(
      document.querySelector('[aria-label="Question alerts"]').textContent,
    ),
    undefined,
    { timeout: 5000 },
  );
  const answerAlert = await statusText(readerPage, 'Question alerts');
  check(
    'answer alert copy',
    /^.+ answered your question on step \d+\.$/.test(answerAlert),
    answerAlert,
  );

  await newcomerCtx.close();
  await readerCtx.close();
  await authorCtx.close();
}

/* ---------- DP-83..DP-90: discovery ---------- */
{
  const context = await contextFor(null);
  const page = await context.newPage();
  await page.goto(`${BASE}/search`);

  /* DP-84: typing updates the results and count in place. */
  const before = await page.evaluate(() => history.length);
  await page.getByRole('searchbox', { name: 'Search guides' }).fill('burr');
  await page.waitForTimeout(600);
  check('search updates in place', page.url().includes('q=burr'), page.url());
  check('search adds no history entry', (await page.evaluate(() => history.length)) === before);
  const status = await statusText(page, 'Search status');
  check('search count copy', /^\d+ guides found\.$|^1 guide found\.$/.test(status), status);
  const huge = await page.evaluate(() => {
    const element = document.querySelector('[data-figure="result-count"]');
    return { text: element.textContent, size: parseFloat(getComputedStyle(element).fontSize) };
  });
  check('count set huge', huge.size >= 48, huge);
  const resultsOnBone = await page.evaluate(
    () => getComputedStyle(document.querySelector('.search')).backgroundColor,
  );
  check('search results on bone', resultsOnBone === 'rgb(244, 237, 226)', resultsOnBone);

  /* DP-85: tags by keyboard. */
  const tagBox = page.getByRole('combobox', { name: 'Filter by tag' });
  await tagBox.fill('coffee');
  await page.waitForTimeout(400);
  await tagBox.press('ArrowDown');
  await tagBox.press('Enter');
  await page.waitForTimeout(600);
  const chip = await page.evaluate(() => document.querySelector('.tag-chip')?.textContent ?? null);
  check('tag added by keyboard', chip !== null && chip.includes('coffee'), chip);
  check(
    'each tag has a named remove button',
    (await page.getByRole('button', { name: 'Remove tag coffee' }).count()) === 1,
  );
  check('tags live in the address', page.url().includes('tag=coffee'), page.url());
  await tagBox.press('Backspace');
  await page.waitForTimeout(600);
  check(
    'Backspace on the empty field removes the last tag',
    (await page.evaluate(() => document.querySelectorAll('.tag-chip').length)) === 0,
  );

  /* DP-86: the search lives in the address and survives a reload. */
  await tagBox.fill('coffee');
  await page.waitForTimeout(300);
  await tagBox.press('Enter');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() => ({
    q: document.querySelector('[aria-label="Search guides"]').value,
    tags: [...document.querySelectorAll('.tag-chip')].map((chip) => chip.getAttribute('data-tag')),
  }));
  check('search survives a reload', afterReload.q === 'burr' && afterReload.tags.includes('coffee'), afterReload);

  /* DP-87: over-long queries answer with their copy. */
  await page.goto(`${BASE}/search`);
  await page.getByRole('searchbox', { name: 'Search guides' }).fill('a'.repeat(201));
  await page.waitForTimeout(700);
  check(
    'over-long query copy',
    (await statusText(page, 'Search status')) === 'Search terms can be at most 200 characters.',
    await statusText(page, 'Search status'),
  );
  await context.close();
}

/* ---------- DP-88, DP-89: collections and likes ---------- */
{
  const authorCtx = await contextFor(world.author);
  const readerCtx = await contextFor(world.reader);
  const owner = await authorCtx.newPage();
  const authorReader = await authorCtx.newPage();
  const reader = await readerCtx.newPage();

  /* Add a second guide so the collection can be reordered. */
  await owner.goto(`${BASE}/c/${world.collection.slug}`);
  await owner.evaluate(
    async (args) => {
      await fetch(`/api/collections/${args.collection}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guide_id: args.guide }),
      });
    },
    { collection: world.collection.id, guide: world.guides.draft.id },
  );
  await owner.reload();
  const rowsBefore = await owner.evaluate(() =>
    [...document.querySelectorAll('.collection-rows [data-guide]')].map((row) => row.textContent.trim()),
  );
  check('collection has two rows', rowsBefore.length === 2, rowsBefore);

  const lastRow = owner.locator('.collection-rows [data-guide]').nth(1);
  await lastRow.focus();
  await owner.keyboard.press('Alt+ArrowUp');
  await owner.waitForTimeout(800);
  const moveNotice = await statusText(owner, 'Collection status');
  check('collection move copy', /moved to position 1\.$/.test(moveNotice), moveNotice);
  await owner.reload();
  const rowsAfter = await owner.evaluate(() =>
    [...document.querySelectorAll('.collection-rows [data-guide]')].map((row) => row.textContent.trim()),
  );
  check('order survives a reload', rowsAfter[0] === rowsBefore[1], { rowsBefore, rowsAfter });

  await owner.locator('.collection-rows [data-guide]').first().focus();
  await owner.keyboard.press('Alt+ArrowUp');
  await owner.waitForTimeout(300);
  check(
    'already first copy',
    /is already first\.$/.test(await statusText(owner, 'Collection status')),
    await statusText(owner, 'Collection status'),
  );

  /* DP-89: likes count once and reach the author's open page live. */
  await authorReader.goto(`${BASE}/g/${publicGuide.slug}`);
  await waitForStageReady(authorReader);
  await reader.goto(`${BASE}/g/${publicGuide.slug}`);
  await waitForStageReady(reader);
  const likeButton = reader.locator('.reader-bar [aria-label="Like"]');
  await likeButton.click();
  await reader.waitForTimeout(600);
  check('Like toggles aria-pressed', (await likeButton.getAttribute('aria-pressed')) === 'true');
  check(
    'liked copy',
    (await statusText(reader, 'Guide status')) === 'Liked.',
    await statusText(reader, 'Guide status'),
  );
  await authorReader.waitForFunction(
    () => document.querySelector('[aria-label="Like count"]').textContent === '1 like',
    undefined,
    { timeout: 4000 },
  );
  check('like count live', (await statusText(authorReader, 'Like count')) === '1 like');
  await likeButton.click();
  await reader.waitForTimeout(600);
  check('Like removed copy', (await statusText(reader, 'Guide status')) === 'Like removed.');

  /* DP-90: the dashboard look. */
  await owner.goto(`${BASE}/dashboard`);
  const shelves = await owner.evaluate(() =>
    [...document.querySelectorAll('.shelf')].map((shelf) => {
      const box = shelf.getBoundingClientRect();
      const heading = shelf.querySelector('h2');
      return {
        shelf: shelf.getAttribute('data-shelf'),
        background: getComputedStyle(shelf).backgroundColor,
        fullBleed: box.width >= window.innerWidth - 1,
        headingLeft: heading.getBoundingClientRect().left,
        headingSize: parseFloat(getComputedStyle(heading).fontSize),
        cards: shelf.querySelectorAll('.card').length,
      };
    }),
  );
  const wanted = {
    questions: 'rgb(179, 43, 26)',
    drafts: 'rgb(244, 237, 226)',
    published: 'rgb(232, 174, 38)',
    forks: 'rgb(57, 85, 111)',
    collections: 'rgb(107, 26, 24)',
  };
  check(
    'shelf colours',
    shelves.every((shelf) => shelf.background === wanted[shelf.shelf]),
    shelves.map((shelf) => [shelf.shelf, shelf.background]),
  );
  check('shelves are full-bleed', shelves.every((shelf) => shelf.fullBleed), shelves);
  check(
    'headings share one left edge',
    new Set(shelves.map((shelf) => Math.round(shelf.headingLeft))).size === 1,
    shelves.map((shelf) => shelf.headingLeft),
  );
  check('large display headings', shelves.every((shelf) => shelf.headingSize >= 30), shelves);
  check('no cards', shelves.every((shelf) => shelf.cards === 0));

  await authorCtx.close();
  await readerCtx.close();
}

/* ---------- DP-91..DP-97: embed and sound ---------- */
{
  const signedIn = await contextFor(world.reader);
  const signedOut = await contextFor(null);
  const inPage = await signedIn.newPage();
  const outPage = await signedOut.newPage();

  await inPage.goto(`${BASE}/embed/${publicGuide.slug}?step=3`);
  await waitForStageReady(inPage);
  await outPage.goto(`${BASE}/embed/${publicGuide.slug}?step=3`);
  await waitForStageReady(outPage);

  const shape = async (page) =>
    await page.evaluate(() => ({
      labels: [...document.querySelectorAll('[aria-label]')].map((element) => element.getAttribute('aria-label')).sort(),
      account: document.querySelector('.account-name') === null,
      wordmark: document.querySelector('.wordmark') === null,
    }));
  const inShape = await shape(inPage);
  const outShape = await shape(outPage);
  check('embed looks identical signed in and out', JSON.stringify(inShape) === JSON.stringify(outShape), {
    inShape,
    outShape,
  });
  check('embed shows no account name', inShape.account);

  /* DP-92: settled and read-only. */
  const hooks = await stageHooks(inPage);
  check('embed settled on step 3', hooks.step === '3' && hooks.explode === '0.500', hooks);
  check('embed parts cost final', (await figure(inPage, 'parts-cost')) === '€0.00');
  check(
    'embed has the published controls only',
    inShape.labels.includes('Previous step') &&
      inShape.labels.includes('Next step') &&
      inShape.labels.includes('Step counter') &&
      inShape.labels.includes('Workshop sound') &&
      !inShape.labels.includes('Like') &&
      !inShape.labels.includes('Fork guide') &&
      !inShape.labels.includes('Add to collection') &&
      !inShape.labels.includes('Ask the author'),
    inShape.labels,
  );

  /* DP-92: moving between steps. */
  await outPage.getByRole('button', { name: 'Next step' }).click();
  await outPage.waitForTimeout(200);
  check('embed moves between steps', (await stageHooks(outPage)).step === '4', await stageHooks(outPage));

  /* DP-94, DP-95: sound. */
  await outPage.goto(`${BASE}/embed/${publicGuide.slug}?step=2`);
  await waitForStageReady(outPage);
  await outPage.evaluate(() => {
    window.__audio = { contexts: 0, sources: [], gains: [] };
    const RealContext = window.AudioContext;
    window.AudioContext = class extends RealContext {
      constructor(...args) {
        super(...args);
        window.__audio.contexts += 1;
      }
      createGain() {
        const gain = super.createGain();
        window.__audio.gains.push(gain);
        return gain;
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...rest) => {
          window.__audio.sources.push({ loop: source.loop, buffer: source.buffer !== null });
          return start(...rest);
        };
        return source;
      }
    };
  });
  const beforePress = await outPage.evaluate(() => window.__audio);
  check(
    'no audio context, source or gain before the press',
    beforePress.contexts === 0 && beforePress.sources.length === 0 && beforePress.gains.length === 0,
    beforePress,
  );

  const soundButton = outPage.getByRole('button', { name: 'Workshop sound' });
  await soundButton.click();
  await outPage.waitForTimeout(250);
  const firstPress = await outPage.evaluate(() => ({
    audio: window.__audio,
    gains: window.__audio.gains.map((gain) => gain.gain.value),
  }));
  check(
    'one looping generated source through one master gain',
    firstPress.audio.contexts === 1 &&
      firstPress.audio.sources.length === 1 &&
      firstPress.audio.sources[0].loop === true &&
      firstPress.audio.gains.length === 1,
    firstPress,
  );
  check('master gain at the published level', firstPress.gains[0] === 0.25, firstPress.gains);
  check('sound pressed on', (await soundButton.getAttribute('aria-pressed')) === 'true');

  await soundButton.click();
  await outPage.waitForTimeout(200);
  const secondPress = await outPage.evaluate(() => window.__audio.gains.map((gain) => gain.gain.value));
  check('next press sets the gain to 0', secondPress[0] === 0, secondPress);
  check('sound pressed off', (await soundButton.getAttribute('aria-pressed')) === 'false');

  await soundButton.click();
  await outPage.waitForTimeout(200);
  const thirdPress = await outPage.evaluate(() => window.__audio.gains.map((gain) => gain.gain.value));
  check('a further press sets it back', thirdPress[0] === 0.25, thirdPress);

  /* DP-94: every new load starts off, and sound=off hides the button. */
  await outPage.reload();
  await waitForStageReady(outPage);
  check(
    'every new load starts off',
    (await outPage.getByRole('button', { name: 'Workshop sound' }).getAttribute('aria-pressed')) === 'false',
  );
  await outPage.goto(`${BASE}/embed/${publicGuide.slug}?step=2&sound=off`);
  await waitForStageReady(outPage);
  check(
    'sound=off hides the button',
    (await outPage.getByRole('button', { name: 'Workshop sound' }).count()) === 0,
  );

  /* DP-97: the embed fits a phone. */
  const phoneCtx = await browser.newContext({ viewport: VIEWPORTS.phone, hasTouch: true, isMobile: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(`${BASE}/embed/${publicGuide.slug}?step=3`);
  await waitForStageReady(phone);
  check('embed has no sideways overflow on a phone', await noSidewaysOverflow(phone));
  const phoneShape = await phone.evaluate(() => ({
    partsVisible: getComputedStyle(document.querySelector('[aria-label="Parts"]')).display !== 'none',
    callouts: document.querySelectorAll('.callout').length,
    taps: [...document.querySelectorAll('.reader-bar button, .free-look')].map((button) => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute('aria-label'), width: box.width, height: box.height };
    }),
  }));
  check('numbered parts list replaces callouts in the embed', phoneShape.partsVisible, phoneShape);
  check(
    'every embed control is at least 44x44',
    phoneShape.taps.every((tap) => tap.width >= 44 && tap.height >= 44),
    phoneShape.taps.filter((tap) => tap.width < 44 || tap.height < 44),
  );
  await phoneCtx.close();

  /* DP-96: publish states reach the embed. */
  const authorCtx = await contextFor(world.author);
  const editor = await authorCtx.newPage();
  await editor.goto(`${BASE}/edit/${publicGuide.slug}`);
  await waitForStageReady(editor);
  await editor.getByRole('button', { name: 'Withdraw' }).click();
  await editor.waitForTimeout(800);
  check(
    'withdrawn copy in the editor',
    (await statusText(editor, 'Editor status')) === 'Withdrawn.',
    await statusText(editor, 'Editor status'),
  );
  const withdrawnReader = await outPage.goto(`${BASE}/g/${publicGuide.slug}`);
  check('withdrawn reader status', withdrawnReader.status() === 410, withdrawnReader.status());
  check(
    'withdrawn reader copy',
    (await outPage.textContent('h1')) === 'This guide was withdrawn.',
    await outPage.textContent('h1'),
  );
  const withdrawnEmbed = await outPage.goto(`${BASE}/embed/${publicGuide.slug}`);
  check('withdrawn embed status', withdrawnEmbed.status() === 410, withdrawnEmbed.status());

  await editor.getByRole('button', { name: 'Publish' }).click();
  await editor.waitForTimeout(1200);
  const publishedNotice = await statusText(editor, 'Editor status');
  check('published copy', /^Published version \d+\.$/.test(publishedNotice), publishedNotice);
  const backOnline = await outPage.goto(`${BASE}/embed/${publicGuide.slug}`);
  check('embed returns once published again', backOnline.status() === 200, backOnline.status());

  /* DP-96: private, draft and unknown guides show the not-found page. */
  for (const [name, slug] of [
    ['private', world.guides.private.slug],
    ['draft', world.guides.draft.slug],
    ['unknown', 'no-such-guide-here'],
  ]) {
    const response = await outPage.goto(`${BASE}/embed/${slug}`);
    check(`embed not-found for a ${name} guide`, response.status() === 404, response.status());
    check(
      `embed not-found copy for a ${name} guide`,
      (await outPage.textContent('h1')) === 'We could not find that page.',
    );
  }
  /* The embed view answers its not-found page to the owner of a private guide. */
  const ownerEmbed = await editor.goto(`${BASE}/embed/${world.guides.private.slug}`);
  check('embed not-found for the owner of a private guide', ownerEmbed.status() === 404, ownerEmbed.status());

  await authorCtx.close();
  await signedIn.close();
  await signedOut.close();
}

await browser.close();
process.exit(report());
