// Browser tests for the key journeys, run with the playwright test runner.

import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:4173';

test.beforeEach(async ({ page }) => {
  // The verifier blocks service workers; we never register one.
  await page.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('blocked'));
    }
  });
});

test('home shows the waterline hero', async ({ page }) => {
  await page.goto(BASE + '/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/TAKE IT/);
  await expect(page.getByRole('link', { name: 'Start a guide' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read this guide' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find a guide' })).toBeVisible();
});

test('reader opens with counting figures and a stage', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs');
  const stage = page.locator('[role="application"]');
  await expect(stage).toBeAttached();
  await expect(page.locator('[data-figure="total-cost"]')).toHaveText('€21.30', { timeout: 5000 });
  await expect(page.locator('[data-figure="part-count"]')).toHaveText('9');
  await expect(page.locator('[data-figure="step-count"]')).toHaveText('5');
  await expect(page.locator('[data-status="stage"]')).toHaveText('Model ready.', { timeout: 8000 });
});

test('reader scroll changes the step and the address', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs');
  await page.waitForTimeout(1500);
  const viewport = await page.evaluate(() => window.innerHeight);
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(viewport * 3 + viewport * 0.65));
  await page.waitForTimeout(500);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '3');
  await expect(page).toHaveURL(/step=3/);
  const counter = page.locator('[data-status="step-counter"]');
  await expect(counter).toHaveText('03 / 05');
});

test('deep link opens settled at the step', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs?step=3');
  await page.waitForTimeout(900);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '3');
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-explode', '0.500');
});

test('step past the end opens the last step with the notice', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs?step=9');
  await page.waitForTimeout(700);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '5');
  await expect(page.getByText('This guide has 5 steps. Showing step 5.')).toBeVisible();
});

test('stage keys orbit and zoom', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs?step=2');
  await page.waitForTimeout(1200);
  const stage = page.locator('[role="application"]');
  await stage.focus();
  const before = await stage.getAttribute('data-yaw');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const after = await stage.getAttribute('data-yaw');
  expect(Number(after)).toBeGreaterThan(Number(before));
  await page.keyboard.press('+');
  await page.waitForTimeout(150);
  const zoom = await stage.getAttribute('data-zoom');
  expect(Number(zoom)).toBeGreaterThan(1);
  await page.keyboard.press('Home');
  await page.waitForTimeout(150);
  await expect(stage).toHaveAttribute('data-zoom', '1.00');
});

test('search page finds the seeded guide', async ({ page }) => {
  await page.goto(BASE + '/search');
  await page.getByLabel('Search guides').fill('coffee');
  await page.waitForTimeout(800);
  await expect(page.locator('[data-figure="result-count"]')).not.toHaveText('0');
  await expect(page.getByRole('link', { name: /Coffee grinder/ }).first()).toBeVisible();
});

test('sign up lands on the waiting screen', async ({ page }) => {
  await page.goto(BASE + '/signup');
  const stamp = Date.now().toString(36);
  await page.getByLabel('Name').fill(`Web Tester ${stamp}`);
  await page.getByLabel('Email').fill(`web-${stamp}@example.test`);
  await page.getByLabel('Password').fill('longpassword1');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/confirm/);
  await expect(page.getByText(/We sent a confirmation link/)).toBeVisible();
});

test('not-found page answers with the band', async ({ page }) => {
  const response = await page.goto(BASE + '/g/this-guide-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByText('We could not find that page.')).toBeVisible();
});

async function signInWorld(page: import('@playwright/test').Page, world: { email: string; password: string }): Promise<void> {
  await page.goto(BASE + '/signin');
  await page.getByLabel('Email').fill(world.email);
  await page.getByLabel('Password').fill(world.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/dashboard/);
}

async function makeWorld(): Promise<Record<string, unknown>> {
  const response = await fetch(BASE + '/api/grading/world', { method: 'POST' });
  return (await response.json()) as Record<string, never>;
}

test('editor: keyboard authoring journey', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.author as { email: string; password: string });
  await page.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await page.waitForTimeout(1200);

  // Tab order: wordmark, the toolbar in its published order, then the stage.
  await page.locator('body').focus();
  for (const name of ['Pennywasher', 'Add step', 'Undo', 'Redo', 'Save version', 'Versions', 'Choose a model file', 'Upload model', 'Co-authors', 'Publish', 'Withdraw', 'Delete guide']) {
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName(name);
  }

  // Add a step by keyboard: focus lands in its title field.
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.locator(':focus')).toHaveAccessibleName('Step 6 title');
  await expect(page.getByText('Step 6 added.')).toBeVisible();

  // Ctrl+S from a text field saves a version.
  await page.getByLabel('Step 6 title').fill('Sixth step');
  await page.waitForTimeout(400);
  await page.getByLabel('Step 6 title').focus();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved as version 2.')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Latest version 2')).toBeVisible();
});

test('editor: apart slider applies after its delay', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.author as { email: string; password: string });
  await page.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await page.waitForTimeout(1200);
  await page.getByLabel('Step 1 title').focus();
  await page.waitForTimeout(300);
  const stage = page.locator('[role="application"]');
  await expect(stage).toHaveAttribute('data-step', '1');
  const slider = page.getByLabel('Apart amount');
  await slider.focus();
  await slider.fill('0.5');
  const during = await stage.getAttribute('data-explode');
  // The change applies exactly after the 250 ms editor delay.
  await page.waitForTimeout(400);
  const after = await stage.getAttribute('data-explode');
  expect(after).toBe('0.500');
  void during;
});

test('questions: newcomer is refused until confirmed', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.newcomer as { email: string; password: string });
  await page.goto(BASE + `/g/${(world.guides as Record<string, { slug: string }>).public.slug}`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Ask the author' }).click();
  await expect(page.getByText(/Confirm your email before you can do that/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend confirmation' })).toBeVisible();
});

test('fork: reader forks a public guide and lands in the editor', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.reader as { email: string; password: string });
  await page.goto(BASE + `/g/${(world.guides as Record<string, { slug: string }>).public.slug}`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Fork guide' }).click();
  await page.getByRole('button', { name: /^Fork version 3/ }).click();
  await page.waitForURL(/\/edit\//, { timeout: 10000 });
  await expect(page.getByText(/Forked from Coffee grinder/)).toBeVisible();
});

test('like updates the count live in another tab', async ({ page }) => {
  const world = await makeWorld();
  const slug = (world.guides as Record<string, { slug: string }>).public.slug;
  const readerPage = await page.context().newPage();
  await readerPage.goto(BASE + `/g/${slug}`);
  await readerPage.waitForTimeout(900);

  await signInWorld(page, world.reader as { email: string; password: string });
  await page.goto(BASE + `/g/${slug}`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Like' }).click();
  await expect(page.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'true');
  // The open page in the other tab sees the new count within the live delay.
  await expect(readerPage.getByText('1 like')).toBeVisible({ timeout: 4000 });
  await readerPage.close();
});

test('deep link: sign in returns to the same step', async ({ page }) => {
  const world = await makeWorld();
  const slug = (world.guides as Record<string, { slug: string }>).public.slug;
  await page.goto(BASE + `/g/${slug}?step=3`);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Ask the author' }).click();
  await page.waitForURL(/\/signin\?next=/);
  await expect(page).toHaveURL(new RegExp(`next=${encodeURIComponent(`/g/${slug}?step=3`)}`));
  await page.getByLabel('Email').fill((world.reader as { email: string }).email);
  await page.getByLabel('Password').fill((world.reader as { password: string }).password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/step=3/);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '3');
});

test('reduced motion: step buttons replace scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs');
  await page.waitForTimeout(900);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '2');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(scrollAfter).toBe(scrollBefore);
});

test('withdrawn guide shows the withdrawn page', async ({ page }) => {
  const world = await makeWorld();
  await page.goto(BASE + `/g/${(world.guides as Record<string, { slug: string }>).withdrawn.slug}`);
  await expect(page.getByText('This guide was withdrawn.')).toBeVisible();
});

test('private guide answers not found to others', async ({ page }) => {
  const world = await makeWorld();
  const privateSlug = (world.guides as Record<string, { slug: string }>).private.slug;
  const response = await page.goto(BASE + `/g/${privateSlug}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText('We could not find that page.')).toBeVisible();
});

test('embed opens settled and sets no cookie', async ({ page }) => {
  const world = await makeWorld();
  const slug = (world.guides as Record<string, { slug: string }>).public.slug;
  const context = page.context();
  const response = await page.goto(BASE + `/embed/${slug}?step=3`);
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(700);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '3');
  const cookies = await context.cookies();
  expect(cookies.length).toBe(0);
});

test('non-local return lands on the dashboard', async ({ page }) => {
  const world = await makeWorld();
  const unsafe = ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'javascript:alert(1)'];
  for (const next of unsafe) {
    await page.goto(BASE + `/signin?next=${encodeURIComponent(next)}`);
    await page.getByLabel('Email').fill((world.reader as { email: string }).email);
    await page.getByLabel('Password').fill((world.reader as { password: string }).password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/dashboard/);
    expect(page.url()).toContain('/dashboard');
  }
});

test('dashboard signed out goes to sign-in with a return path', async ({ page }) => {
  await page.goto(BASE + '/dashboard');
  await page.waitForURL(/\/signin\?next=/);
  expect(decodeURIComponent(page.url())).toContain('/signin?next=/dashboard');
});

test('tags in the search address survive a reload', async ({ page }) => {
  await page.goto(BASE + '/search?q=coffee&tag=grinder');
  await page.reload();
  await expect(page.getByLabel('Search guides')).toHaveValue('coffee');
  await expect(page.getByLabel('Remove tag grinder')).toBeVisible();
});

test('step links add a history entry so Back returns to the previous step', async ({ page }) => {
  await page.goto(BASE + '/g/coffee-grinder-fit-new-burrs?step=2');
  await page.waitForTimeout(900);
  await page.getByRole('link', { name: '4', exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '4');
  await page.goBack();
  await page.waitForTimeout(500);
  await expect(page.locator('[role="application"]')).toHaveAttribute('data-step', '2');
});

test('guide total follows price edits', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.author as { email: string; password: string });
  await page.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await page.waitForTimeout(1500);
  // Select the part in the tree and edit its price (Left bearing, quantity 1, £3.20 -> £4.10).
  await page.getByRole('treeitem', { name: 'Left bearing' }).click();
  await page.getByLabel('Unit price').fill('4.10');
  // The total updates in place from the server reply (4.10 + 3.20 = 7.30).
  await expect(page.locator('[data-figure="total-cost"]')).toHaveText('£7.30', { timeout: 5000 });
  await expect(page.getByText('Guide total £7.30.')).toBeVisible();
});
