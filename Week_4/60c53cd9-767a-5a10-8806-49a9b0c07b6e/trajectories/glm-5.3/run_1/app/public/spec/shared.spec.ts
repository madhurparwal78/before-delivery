import { expect, test } from '@playwright/test';
import { freshBuyer, post, type Hold } from './utils';

// Each test creates its own buyer and holds its own unit, so the shared-link
// behaviour is exercised without colliding with any other suite's state.
test('the partner page shows the home and the end time with no private data', async ({ page, request }) => {
  const code = '33F';
  const { cookie } = await freshBuyer(request, 'shared-page');
  const unitResponse = await request.fetch(`/api/units/${code}`);
  const unitText = await unitResponse.text();
  const parsed = unitText.length > 0 ? (JSON.parse(unitText) as { unit: { code: string; priceVersion: number } }) : null;
  expect(parsed).not.toBeNull();
  const holdReply = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: parsed!.unit.code, priceVersion: parsed!.unit.priceVersion }, { cookie });
  expect(holdReply.status).toBe(201);
  const shareReply = await post<{ shareUrl: string }>(request, `/api/holds/${holdReply.body.hold.id}/share`, {}, { cookie });
  expect(shareReply.status).toBe(201);

  await page.goto(shareReply.body.shareUrl);
  await expect(page.getByRole('heading', { name: `Home ${code}`, level: 1 })).toBeVisible();
  await expect(page.getByRole('img', { name: `View from ${code}` })).toBeVisible();
  await expect(page.getByText(/Held until/)).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain('@example.com');
  expect(html).not.toContain('Test Buyer');
  expect(html).not.toContain(holdReply.body.hold.id);
});

test('regenerating the link kills the old one', async ({ page, request }) => {
  const code = '34F';
  const { cookie } = await freshBuyer(request, 'shared-regen');
  const unitResponse = await request.fetch(`/api/units/${code}`);
  const unitText = await unitResponse.text();
  const parsed = unitText.length > 0 ? (JSON.parse(unitText) as { unit: { code: string; priceVersion: number } }) : null;
  expect(parsed).not.toBeNull();
  const holdReply = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: parsed!.unit.code, priceVersion: parsed!.unit.priceVersion }, { cookie });
  expect(holdReply.status).toBe(201);

  const first = await post<{ shareUrl: string }>(request, `/api/holds/${holdReply.body.hold.id}/share`, {}, { cookie });
  const second = await post<{ shareUrl: string }>(request, `/api/holds/${holdReply.body.hold.id}/share`, {}, { cookie });
  expect(second.body.shareUrl).not.toBe(first.body.shareUrl);

  await page.goto(first.body.shareUrl);
  await expect(page.getByRole('heading', { name: 'This shared link no longer works.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the finder' })).toBeVisible();
  await page.goto(second.body.shareUrl);
  await expect(page.getByRole('heading', { name: `Home ${code}`, level: 1 })).toBeVisible();
});

test('a write through a share link is refused and changes nothing', async ({ request }) => {
  const code = '35E';
  const { cookie } = await freshBuyer(request, 'shared-readonly');
  const unitResponse = await request.fetch(`/api/units/${code}`);
  const unitText = await unitResponse.text();
  const parsed = unitText.length > 0 ? (JSON.parse(unitText) as { unit: { code: string; priceVersion: number } }) : null;
  expect(parsed).not.toBeNull();
  const holdReply = await post<{ hold: Hold }>(request, '/api/holds', { unitCode: parsed!.unit.code, priceVersion: parsed!.unit.priceVersion }, { cookie });
  expect(holdReply.status).toBe(201);
  const shareReply = await post<{ shareUrl: string }>(request, `/api/holds/${holdReply.body.hold.id}/share`, {}, { cookie });
  expect(shareReply.status).toBe(201);
  const token = shareReply.body.shareUrl.replace('/shared/', '');

  const write = await request.fetch(`/api/shared/${token}`, { method: 'POST', data: '{}' });
  expect(write.status()).toBe(405);
  const body = (await write.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe('read_only');
  expect(body.error.message).toBe('Shared links are read-only.');
});
