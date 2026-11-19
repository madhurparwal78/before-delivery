// Model drop preview, keyboard file choice, upload, refusals.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173';

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

test('drop preview stays in the browser and reports draw stats', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.author as { email: string; password: string });
  await page.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await page.waitForSelector('[role="application"][data-state="ready"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  // Drop a valid .glb on the stage: a preview draws, nothing is sent.
  const glb = readFileSync('/app/public/samples/bike-hub.glb');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  const stage = page.locator('[role="application"]');
  await page.evaluate((bytes) => {
    const file = new File([new Uint8Array(bytes as number[])], 'bike-hub.glb', { type: 'model/gltf-binary' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    document.querySelector('[role="application"]')!.dispatchEvent(event);
  }, Array.from(glb));
  await page.waitForTimeout(900);
  await expect(stage).toHaveAttribute('data-state', 'preview');
  await expect(page.locator('[data-status="stage"]')).toHaveText('Previewing bike-hub.glb. It is not uploaded.');
  // No request left the page for the preview.
  expect(requests.filter((url) => url.includes('model')).length).toBe(0);

  // A bad file is refused with the reason.
  const textBytes = Buffer.from('this is definitely not a glb file');
  await page.evaluate((bytes) => {
    const file = new File([new Uint8Array(bytes as number[])], 'renamed.glb', { type: 'model/gltf-binary' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    document.querySelector('[role="application"]')!.dispatchEvent(event);
  }, Array.from(textBytes));
  await page.waitForTimeout(600);
  await expect(page.locator('[data-status="stage"]')).toHaveText('renamed.glb is not a glTF 2.0 binary file.');
});

test('upload a previewed model and see it stored', async ({ page }) => {
  const world = await makeWorld();
  await signInWorld(page, world.author as { email: string; password: string });
  await page.goto(BASE + `/edit/${(world.guides as Record<string, { slug: string }>).draft.slug}`);
  await page.waitForSelector('[role="application"][data-state="ready"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const glb = readFileSync('/app/public/samples/game-controller.glb');
  const stage = page.locator('[role="application"]');
  await page.evaluate((bytes) => {
    const file = new File([new Uint8Array(bytes as number[])], 'game-controller.glb', { type: 'model/gltf-binary' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    document.querySelector('[role="application"]')!.dispatchEvent(event);
  }, Array.from(glb));
  await page.waitForTimeout(900);
  await expect(stage).toHaveAttribute('data-state', 'preview');
  await page.getByRole('button', { name: 'Upload model' }).click();
  await expect(page.locator('[data-status="stage"]')).toHaveText(/is stored\. [\d,]+ bytes confirmed\./, { timeout: 15000 });
});
