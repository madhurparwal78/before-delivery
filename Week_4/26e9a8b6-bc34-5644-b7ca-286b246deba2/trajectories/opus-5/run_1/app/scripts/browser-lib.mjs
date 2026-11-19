/** Shared harness for the development browser checks. */
export const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';

export const state = { passed: 0, failed: 0 };

export function check(name, condition, detail) {
  if (condition) {
    state.passed += 1;
  } else {
    state.failed += 1;
    const extra = detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`;
    process.stdout.write(`FAIL ${name}${extra}\n`);
  }
}

export function report() {
  process.stdout.write(`\npassed ${state.passed} failed ${state.failed}\n`);
  return state.failed === 0 ? 0 : 1;
}

export async function makeWorld() {
  const response = await fetch(`${BASE}/api/grading/world`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status !== 201) throw new Error(`world failed: ${response.status}`);
  return await response.json();
}

export async function signIn(context, email, password) {
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 10000 });
  await page.close();
}

export const VIEWPORTS = {
  phone: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

export async function stageHooks(page) {
  return await page.evaluate(() => {
    const stage = document.querySelector('[aria-label="Model stage"]');
    if (stage === null) return null;
    return {
      step: stage.getAttribute('data-step'),
      explode: stage.getAttribute('data-explode'),
      yaw: stage.getAttribute('data-yaw'),
      pitch: stage.getAttribute('data-pitch'),
      zoom: stage.getAttribute('data-zoom'),
      state: stage.getAttribute('data-state'),
    };
  });
}

export async function figure(page, name) {
  return await page.evaluate(
    (key) => document.querySelector(`[data-figure="${key}"]`)?.textContent ?? null,
    name,
  );
}

export async function statusText(page, label) {
  return await page.evaluate(
    (name) => document.querySelector(`[aria-label="${name}"]`)?.textContent ?? null,
    label,
  );
}

export async function noSidewaysOverflow(page) {
  return await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
}

export async function waitForStageReady(page, timeout = 15000) {
  await page.waitForFunction(
    () => {
      const stage = document.querySelector('[aria-label="Model stage"]');
      const value = stage?.getAttribute('data-state');
      return value === 'ready' || value === 'still' || value === 'error';
    },
    undefined,
    { timeout },
  );
}

export async function tabOrder(page, count) {
  const names = [];
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press('Tab');
    names.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        if (element === null) return null;
        return (
          element.getAttribute('aria-label') ??
          element.textContent?.trim().slice(0, 40) ??
          element.tagName
        );
      }),
    );
  }
  return names;
}
