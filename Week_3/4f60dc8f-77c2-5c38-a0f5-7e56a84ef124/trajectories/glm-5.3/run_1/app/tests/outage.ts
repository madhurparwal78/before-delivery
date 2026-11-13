/** Outage and boot-recovery checks: run a second app instance on a spare port with a dead service. */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:4280';
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }
  const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    sessionCookie = setCookie.split(';')[0];
  }
  let json: unknown = null;
  try { json = await response.json(); } catch { /* no body */ }
  return { status: response.status, json: json as Record<string, never> | null };
}

let sessionCookie = '';

type Child = ReturnType<typeof spawn>;

function startApp(envOverrides: Record<string, string>): Child {
  return spawn('node', ['dist/serve.js'], {
    env: { ...process.env, APP_PUBLIC_PORT: '4280', APP_PUBLIC_URL: 'http://127.0.0.1:4280', ...envOverrides },
    stdio: 'ignore',
    detached: false,
  });
}

async function waitHealthy(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('app did not become healthy');
}

async function stop(child: Child | null): Promise<void> {
  if (child) {
    child.kill('SIGKILL');
  }
  sessionCookie = '';
  // Kill any stale app instance left on the spare port.
  const { execSync } = await import('node:child_process');
  try {
    execSync(
      `for p in $(ls /proc | grep -E '^[0-9]+$'); do env=$(tr '\\0' '\\n' < /proc/$p/environ 2>/dev/null | grep APP_PUBLIC_PORT=4280); cmd=$(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null); if [ -n "$env" ] && [[ "$cmd" == *serve.js* ]]; then kill -9 $p 2>/dev/null; fi; done`,
      { shell: '/bin/bash' },
    );
  } catch {
    // best effort
  }
  for (let i = 0; i < 10; i++) {
    try {
      const probe = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(700) });
      if (!probe.ok) {
        return;
      }
    } catch {
      return;
    }
    await new Promise(r => setTimeout(r, 400));
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const glb = readFileSync('/tmp/product.glb');

  // Clear any stale app instance from earlier runs.
  await stop(null);

  // ---- billing outage ----
  console.log('--- billing outage (app with dead Kill Bill)');
  let child = startApp({ KILLBILL_URL: 'http://127.0.0.1:9' });
  await waitHealthy();
  check('boots and answers health with billing down', true);
  const statusBilling = await call('GET', '/api/status');
  const billingStatus = (statusBilling.json as unknown as Record<string, string>);
  check('status reports billing down', billingStatus?.billing === 'down', JSON.stringify(billingStatus));
  check('other services still up during billing outage', billingStatus?.storage === 'up' && billingStatus?.email === 'up' && billingStatus?.measuring === 'up' && billingStatus?.documents === 'up');
  const start1 = await call('POST', '/api/projects/start', {
    brand_name: 'Outage Billing', contact_name: 'O B', email: `ob${stamp}@o.test`, title: 'Outage billing', currency: 'GBP',
  });
  const engagement = (start1.json as unknown as { engagement: { id: string } }).engagement;
  await call('PUT', `/api/engagements/${engagement.id}/quote/lines/hero_front`, { quantity: 1 });
  // Upload and measure a model first, so the deposit reaches the billing step.
  const outageForm = new FormData();
  outageForm.append('file', new Blob([glb]), 'model.glb');
  await fetch(`${BASE}/api/engagements/${engagement.id}/files`, { method: 'POST', headers: { Cookie: sessionCookie }, body: outageForm });
  let ready = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const fresh = await call('GET', `/api/engagements/${engagement.id}`);
    const files = (fresh.json as unknown as { files: { kind: string; measurement: string | null }[] }).files;
    if (files.some(file => file.kind === 'model' && file.measurement === 'measured')) {
      ready = true;
      break;
    }
  }
  check('model measured during billing outage setup', ready);
  const deposit = await call('POST', `/api/engagements/${engagement.id}/deposit`, {
    card: { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'O B' },
  }, { 'Idempotency-Key': `outage-billing-${stamp}` });
  check('deposit during billing outage answers 503', deposit.status === 503, String(deposit.status));
  check('deposit refusal code', (deposit.json as unknown as { error: string })?.error === 'billing_unavailable', String((deposit.json as unknown as { error: string })?.error));
  const afterDeposit = await call('GET', `/api/engagements/${engagement.id}`);
  check('engagement stays quoted', (afterDeposit.json as unknown as { state: string }).state === 'quoted', (afterDeposit.json as unknown as { state: string }).state);
  check('no ledger entry written', ((afterDeposit.json as unknown as { ledger: unknown[] }).ledger ?? []).length === 0);
  check('no invoice written', ((afterDeposit.json as unknown as { invoices: unknown[] }).invoices ?? []).length === 0);
  await stop(child);

  // ---- storage outage ----
  console.log('--- storage outage (app with dead MinIO)');
  child = startApp({ S3_ENDPOINT: 'http://127.0.0.1:9' });
  await waitHealthy();
  const statusStorage = await call('GET', '/api/status');
  check('status reports storage down', (statusStorage.json as unknown as Record<string, string>)?.storage === 'down', JSON.stringify(statusStorage.json));
  const start2 = await call('POST', '/api/projects/start', {
    brand_name: 'Outage Storage', contact_name: 'O S', email: `os${stamp}@o.test`, title: 'Outage storage', currency: 'GBP',
  });
  const engagement2 = (start2.json as unknown as { engagement: { id: string } }).engagement;
  const form = new FormData();
  form.append('file', new Blob([glb]), 'model.glb');
  const upload = await fetch(`${BASE}/api/engagements/${engagement2.id}/files`, { method: 'POST', headers: { Cookie: sessionCookie }, body: form });
  check('upload during storage outage answers 503', upload.status === 503, String(upload.status));
  const uploadBody = await upload.json() as { error: string };
  check('upload refusal copy', uploadBody.error === 'storage_unavailable', uploadBody.error);
  const afterUpload = await call('GET', `/api/engagements/${engagement2.id}`);
  check('no intake record after storage outage', ((afterUpload.json as unknown as { files: unknown[] }).files ?? []).length === 0);
  await stop(child);

  // ---- recovery on the next request ----
  console.log('--- recovery on the next request');
  child = startApp({});
  await waitHealthy();
  const statusUp = await call('GET', '/api/status');
  check('status all up after restore', Object.values(statusUp.json as unknown as Record<string, string>).every(v => v === 'up'), JSON.stringify(statusUp.json));
  const start3 = await call('POST', '/api/projects/start', {
    brand_name: 'Recovery Brand', contact_name: 'R Y', email: `ry${stamp}@o.test`, title: 'Recovery', currency: 'GBP',
  });
  const engagement3 = (start3.json as unknown as { engagement: { id: string } }).engagement;
  await call('PUT', `/api/engagements/${engagement3.id}/quote/lines/hero_front`, { quantity: 1 });
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([glb]), 'model.glb');
  const upload3 = await fetch(`${BASE}/api/engagements/${engagement3.id}/files`, { method: 'POST', headers: { Cookie: sessionCookie }, body: uploadForm });
  check('upload works after recovery', upload3.status === 201, String(upload3.status));
  let measured = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const fresh = await call('GET', `/api/engagements/${engagement3.id}`);
    const files = (fresh.json as unknown as { files: { kind: string; measurement: string | null }[] }).files;
    const model = files.find(file => file.kind === 'model');
    if (model?.measurement === 'measured') {
      measured = true;
      break;
    }
  }
  check('measured after recovery', measured);
  const deposit3 = await call('POST', `/api/engagements/${engagement3.id}/deposit`, {
    card: { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123', name: 'R Y' },
  }, { 'Idempotency-Key': `recovery-${stamp}` });
  check('deposit works after recovery', deposit3.status === 201, String(deposit3.status));
  await stop(child);

  console.log(failures === 0 ? 'ALL OUTAGE CHECKS PASSED' : `${failures} OUTAGE CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch(error => {
  console.error(error);
  process.exit(1);
});
