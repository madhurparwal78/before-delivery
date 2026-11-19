import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { check, done } from './apicheck.mjs';

const PORT = 4273;
const MAIL_PORT = 11026;
const STORAGE_PORT = 19199;
const base = `http://127.0.0.1:${PORT}`;

function proxy(listenPort, host, port) {
  const server = createServer((incoming) => {
    const outgoing = createConnection({ host, port });
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
    outgoing.on('error', () => incoming.destroy());
    incoming.on('error', () => outgoing.destroy());
  });
  return new Promise((resolve) => server.listen(listenPort, '127.0.0.1', () => resolve(server)));
}

const child = spawn('node', ['dist/server/index.js'], {
  cwd: '/app',
  env: {
    ...process.env,
    APP_PUBLIC_PORT: String(PORT),
    APP_PUBLIC_URL: base,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(MAIL_PORT),
    S3_ENDPOINT: `http://127.0.0.1:${STORAGE_PORT}`,
  },
  stdio: 'ignore',
});

const jar = new Map();
async function call(who, method, path, body, extra = {}) {
  const token = jar.get(who);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: base,
      ...(token === undefined ? {} : { cookie: `tf_session=${token}` }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) {
    const match = /tf_session=([^;]*)/.exec(cookie);
    if (match) jar.set(who, match[1]);
  }
  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keeps the raw text
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.status === 200) return true;
    } catch {
      // keeps waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

try {
  // DP-34: the app starts and serves while mail and storage are unreachable.
  check('health while services are down', await waitForHealth(), true);

  await call('mara', 'POST', '/api/auth/sign-in', {
    email: 'mara@harbourlane.test',
    password: 'ledger-demo-2026',
  });
  const docs = await call('mara', 'GET', '/api/documents');
  const docId = docs.body.documents.find((d) => d.name === 'Harbour Lane Ops').id;
  const read = await call('mara', 'GET', `/api/documents/${docId}`);
  const ids = Object.fromEntries(read.body.tables.map((t) => [t.name, t.id]));

  // DP-27: a share made during a mail outage is saved as Not sent.
  const share = await call('mara', 'POST', `/api/documents/${docId}/shares`, {
    email: `outage-${Date.now()}@harbourlane.test`,
    role: 'viewer',
    row_scope: 'all',
  });
  check('share saved', [share.status, share.body.share.invite_status], [201, 'not_sent']);
  const failedResend = await call(
    'mara',
    'POST',
    `/api/documents/${docId}/shares/${share.body.share.id}/resend`,
  );
  check('resend while mail is down', [failedResend.status, failedResend.body.error.code], [
    503,
    'mail_unavailable',
  ]);

  // DP-31: an export ends failed with no download, and editing keeps working.
  const failedExport = await call(
    'mara',
    'POST',
    `/api/documents/${docId}/tables/${ids['Customers']}/exports`,
  );
  check('export failed', [failedExport.status, failedExport.body.export.status], [201, 'failed']);
  check('no download link', failedExport.body.export.download_url, null);
  check('no size or hash', [failedExport.body.export.byte_size, failedExport.body.export.sha256], [
    null,
    null,
  ]);
  const notReady = await call('mara', 'GET', `/api/exports/${failedExport.body.export.id}/download`);
  check('download of a failed export', [notReady.status, notReady.body.error.code], [
    409,
    'export_not_ready',
  ]);

  const orders = await call('mara', 'GET', `/api/documents/${docId}/tables/${ids['Orders']}`);
  const qty = orders.body.table.columns.find((c) => c.name === 'Qty').id;
  const row = orders.body.table.rows[0];
  const edit = await call(
    'mara',
    'PUT',
    `/api/documents/${docId}/tables/${ids['Orders']}/rows/${row.id}/cells/${qty}`,
    { value: 4, revision: row.cells[qty].revision },
  );
  check('editing works while storage is down', edit.status, 200);

  // DP-72: a ready export whose store is unreachable answers 503.
  const readyElsewhere = (
    await call('mara', 'GET', `/api/documents/${docId}/exports`)
  ).body.exports.find((entry) => entry.status === 'ready');
  if (readyElsewhere !== undefined) {
    const unreachable = await call('mara', 'GET', `/api/exports/${readyElsewhere.id}/download`);
    check('download while the store is unreachable', [
      unreachable.status,
      unreachable.body.error.code,
    ], [503, 'storage_unavailable']);
  }

  // DP-34: both providers recover without a restart.
  const mailProxy = await proxy(MAIL_PORT, process.env.SMTP_HOST ?? 'mailpit', 1025);
  const storageProxy = await proxy(
    STORAGE_PORT,
    new URL(process.env.S3_ENDPOINT ?? 'http://minio:9000').hostname,
    9000,
  );
  try {
    const resent = await call(
      'mara',
      'POST',
      `/api/documents/${docId}/shares/${share.body.share.id}/resend`,
    );
    check('resend after mail returns', [resent.status, resent.body.share.invite_status], [
      200,
      'sent',
    ]);
    const readyExport = await call(
      'mara',
      'POST',
      `/api/documents/${docId}/tables/${ids['Customers']}/exports`,
    );
    check('export after storage returns', readyExport.body.export.status, 'ready');
    const downloaded = await call(
      'mara',
      'GET',
      `/api/exports/${readyExport.body.export.id}/download`,
    );
    check('download after storage returns', downloaded.status, 200);
    check('record is unchanged after a download', [
      (await call('mara', 'GET', `/api/exports/${failedExport.body.export.id}`)).body.export.status,
    ], ['failed']);
  } finally {
    mailProxy.close();
    storageProxy.close();
  }

} finally {
  child.kill();
}

done();
