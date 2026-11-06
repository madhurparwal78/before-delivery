import { formatCount, formatPercent, formatTime } from '../src/format';
import { ApiFailure, api, buildQuery, queryOf } from './api';
import { button, el, field, openDialog, replace, setStatus, statusRegion, textbox } from './dom';
import {
  auditStatus,
  billingSync,
  encryptionStatus,
  inviteStatus,
  keyStatus,
  shareStatus,
  storageOutage,
  teamStatus,
  webhookStatus,
} from './copy';
import { withStepUp } from './stepup';
import type { ConsoleContext } from './types';

export const pagePaths = {
  shareLinks: '_share-links',
  team: '_team',
  keys: '_keys',
  usage: '_usage',
  webhooks: '_webhooks',
  deliveries: '_deliveries',
  security: '_security',
};

interface Rendered {
  centre: HTMLElement;
  stop: () => void;
}

function tableOf(name: string, columns: string[], body: HTMLElement): HTMLElement {
  return el('table', { class: 'data', 'aria-label': name }, [
    el('thead', {}, [el('tr', {}, columns.map((column) => el('th', { scope: 'col', text: column })))]),
    body,
  ]);
}

function dialogOpen(): boolean {
  return document.querySelector('.overlay') !== null;
}

function schedule(interval: number, run: () => Promise<void>): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (!dialogOpen()) {
      try {
        await run();
      } catch {
        /* a re-read failure leaves the rows as they are */
      }
    }
    if (!stopped) window.setTimeout(() => void tick(), interval);
  };
  window.setTimeout(() => void tick(), interval);
  return () => {
    stopped = true;
  };
}

export async function renderShareLinks(context: ConsoleContext): Promise<Rendered> {
  const body = el('tbody');
  const status = statusRegion('Share status');
  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Share links' }),
    tableOf('Share links', ['Object key', 'Version', 'Creator', 'Expiry (UTC)', 'State'], body),
    status,
  ]);
  async function load(): Promise<void> {
    const links = await api.get<{
      links: { id: string; bucket: string; key: string; version_id: string; created_by: string; expires_at: string; state: string }[];
    }>(`/api/w/${context.slug}/links`);
    replace(
      body,
      links.body.links.map((link) => {
        const row = el('tr', {}, [
          el('td', { text: `${link.bucket}/${link.key}` }),
          el('td', { class: 'mono', text: link.version_id }),
          el('td', { text: link.created_by }),
          el('td', { class: 'mono', text: formatTime(link.expires_at) }),
          el('td', { text: link.state }),
        ]);
        if (link.state === 'active') {
          const revoke = button('Revoke link', { focusKey: `revoke:${link.id}` });
          revoke.addEventListener('click', async () => {
            try {
              await api.post(`/api/w/${context.slug}/links/${link.id}/revoke`);
              setStatus(status, shareStatus.revoked);
              await load();
            } catch (error) {
              if (error instanceof ApiFailure) setStatus(status, error.message);
            }
          });
          row.append(el('td', {}, [revoke]));
        } else row.append(el('td'));
        return row;
      }),
    );
  }
  await load();
  return { centre, stop: () => undefined };
}

export async function renderTeam(context: ConsoleContext): Promise<Rendered> {
  const memberBody = el('tbody');
  const inviteBody = el('tbody');
  const teamStatusRegion = statusRegion('Team status');
  const inviteStatusRegion = statusRegion('Invite status');
  const inviteButton = button('Invite teammate', { focusKey: 'invite-teammate', className: 'primary' });
  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Team' }),
    tableOf('Members', ['Name', 'Email', 'Role', ''], memberBody),
    teamStatusRegion,
    inviteButton,
    tableOf('Invites', ['Email', 'Role', 'Expiry (UTC)', 'State'], inviteBody),
    inviteStatusRegion,
  ]);

  async function load(): Promise<void> {
    const members = await api.get<{ members: { user_id: string; name: string; email: string; role: string }[] }>(
      `/api/w/${context.slug}/members`,
    );
    replace(
      memberBody,
      members.body.members.map((member) => {
        const row = el('tr', {}, [
          el('td', { text: member.name }),
          el('td', { text: member.email }),
          el('td', { text: member.role }),
        ]);
        if (member.user_id === context.identity.user.id) {
          row.append(el('td'));
          return row;
        }
        const roleSelect = el('select', { 'aria-label': `Role for ${member.name}`, 'data-focus-key': `role:${member.user_id}` }, [
          el('option', { value: 'owner', text: 'Owner' }),
          el('option', { value: 'developer', text: 'Developer' }),
          el('option', { value: 'viewer', text: 'Viewer' }),
        ]) as HTMLSelectElement;
        roleSelect.value = member.role;
        roleSelect.addEventListener('change', async () => {
          setStatus(teamStatusRegion, teamStatus.pending(member.name));
          try {
            await api.patch(`/api/w/${context.slug}/members/${member.user_id}`, { role: roleSelect.value });
            setStatus(teamStatusRegion, teamStatus.roleChanged(member.name, roleSelect.value));
            await load();
          } catch (error) {
            roleSelect.value = member.role;
            if (error instanceof ApiFailure) {
              setStatus(teamStatusRegion, error.code === 'last_owner' ? teamStatus.lastOwner : error.message);
            }
          }
        });
        const remove = button(`Remove ${member.name}`, { focusKey: `remove:${member.user_id}` });
        remove.addEventListener('click', async () => {
          setStatus(teamStatusRegion, teamStatus.pending(member.name));
          try {
            await api.delete(`/api/w/${context.slug}/members/${member.user_id}`);
            setStatus(teamStatusRegion, teamStatus.removed(member.name));
            await load();
          } catch (error) {
            if (error instanceof ApiFailure) {
              setStatus(teamStatusRegion, error.code === 'last_owner' ? teamStatus.lastOwner : error.message);
            }
          }
        });
        row.append(el('td', {}, [roleSelect, remove]));
        return row;
      }),
    );
    const invites = await api.get<{ invites: { email: string; role: string; expires_at: string; state: string }[] }>(
      `/api/w/${context.slug}/invites`,
    );
    replace(
      inviteBody,
      invites.body.invites.map((invite) =>
        el('tr', {}, [
          el('td', { text: invite.email }),
          el('td', { text: invite.role }),
          el('td', { class: 'mono', text: formatTime(invite.expires_at) }),
          el('td', { text: invite.state }),
        ]),
      ),
    );
  }

  inviteButton.addEventListener('click', () => {
    openDialog({
      name: 'Invite teammate',
      opener: inviteButton,
      build: (dialog) => {
        const email = textbox('Email', { type: 'email' });
        const role = el('select', { 'aria-label': 'Role' }, [
          el('option', { value: 'developer', text: 'Developer' }),
          el('option', { value: 'viewer', text: 'Viewer' }),
        ]) as HTMLSelectElement;
        const send = button('Send invite', { className: 'primary' });
        send.addEventListener('click', async () => {
          setStatus(inviteStatusRegion, inviteStatus.pending);
          try {
            const created = await api.post<{ email: string; expires_at: string }>(`/api/w/${context.slug}/invites`, {
              email: email.value.trim(),
              role: role.value,
            });
            setStatus(inviteStatusRegion, inviteStatus.success(created.body.email, created.body.expires_at));
            dialog.close();
            await load();
          } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            const message =
              error.code === 'already_member'
                ? inviteStatus.alreadyMember(email.value.trim())
                : error.code === 'rate_limited'
                  ? inviteStatus.rateLimited(error.retryAfterSeconds)
                  : error.errors.email
                    ? inviteStatus.emailError
                    : error.message;
            setStatus(inviteStatusRegion, message);
            dialog.setStatus(message);
          }
        });
        dialog.body.append(
          el('h2', { text: 'Invite teammate' }),
          field('Email', email),
          field('Role', role),
          el('div', { class: 'dialog-actions' }, [send, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  });

  await load();
  return { centre, stop: () => undefined };
}

interface KeyRow {
  key_id: string;
  description: string;
  permission: string;
  buckets: string[] | null;
  prefix: string | null;
  expires_at: string | null;
  expired: boolean;
  state: string;
  created_at: string;
  last_used_at: string | null;
  previous_secret_expires_at: string | null;
}

export async function renderKeys(context: ConsoleContext): Promise<Rendered> {
  const body = el('tbody');
  const status = statusRegion('Key status');
  const createButton = button('Create access key', { className: 'primary', focusKey: 'create-access-key' });
  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Access keys' }),
    createButton,
    tableOf(
      'Access keys',
      [
        'Key ID',
        'Description',
        'Permission',
        'Bucket scope',
        'Prefix',
        'Expires (UTC)',
        'State',
        'Last used (UTC)',
        'Previous secret',
        'Created (UTC)',
        '',
      ],
      body,
    ),
    status,
  ]);

  async function load(): Promise<void> {
    const keys = await api.get<{ keys: KeyRow[] }>(`/api/w/${context.slug}/keys`);
    replace(
      body,
      keys.body.keys.map((key) => {
        const row = el('tr', {}, [
          el('td', { class: 'mono', text: key.key_id }),
          el('td', { text: key.description }),
          el('td', { text: key.permission }),
          el('td', { text: key.buckets === null ? 'All buckets' : key.buckets.join(', ') }),
          el('td', { text: key.prefix === null ? '\u2014' : key.prefix }),
          el('td', { class: 'mono', text: key.expires_at === null ? 'never' : formatTime(key.expires_at) }),
          el('td', { text: key.expired ? 'expired' : key.state }),
          el('td', { class: 'mono', text: key.last_used_at === null ? 'never' : formatTime(key.last_used_at) }),
          el('td', {
            text:
              key.previous_secret_expires_at === null
                ? '\u2014'
                : `Previous secret works until ${formatTime(key.previous_secret_expires_at)}`,
          }),
          el('td', { class: 'mono', text: formatTime(key.created_at) }),
        ]);
        const actions = el('td');
        if (key.state === 'active' && !key.expired) {
          const rotate = button('Rotate key', { focusKey: `rotate:${key.key_id}` });
          rotate.addEventListener('click', () => rotateDialog(key, rotate));
          actions.append(rotate);
        }
        if (key.state === 'active') {
          const disable = button('Disable key', { focusKey: `disable:${key.key_id}` });
          disable.addEventListener('click', async () => {
            try {
              await api.post(`/api/w/${context.slug}/keys/${key.key_id}/disable`);
              setStatus(status, keyStatus.disabled(key.key_id));
              await load();
            } catch (error) {
              if (error instanceof ApiFailure) setStatus(status, keyStatus.illegalTransition);
            }
          });
          actions.append(disable);
        }
        if (key.state === 'disabled') {
          const remove = button('Delete key', { focusKey: `delete:${key.key_id}` });
          remove.addEventListener('click', async () => {
            try {
              await api.delete(`/api/w/${context.slug}/keys/${key.key_id}`);
              setStatus(status, keyStatus.deleted(key.key_id));
              await load();
            } catch (error) {
              if (error instanceof ApiFailure) {
                setStatus(status, error.code === 'invalid_transition' ? keyStatus.illegalDelete : error.message);
              }
            }
          });
          actions.append(remove);
        }
        row.append(actions);
        return row;
      }),
    );
  }

  function rotateDialog(key: KeyRow, opener: HTMLElement): void {
    openDialog({
      name: 'Rotate access key',
      opener,
      build: (dialog) => {
        const secret = textbox('New secret access key', { readOnly: true });
        const secretField = field('New secret access key', secret);
        secretField.hidden = true;
        const copy = button('Copy secret', {
          onClick: () => {
            secret.select();
            void navigator.clipboard?.writeText(secret.value);
          },
        });
        copy.hidden = true;
        const rotate = button('Rotate', { className: 'primary' });
        rotate.addEventListener('click', async () => {
          setStatus(status, keyStatus.rotating);
          const outcome = await withStepUp(
            () => api.post<KeyRow & { secret: string }>(`/api/w/${context.slug}/keys/${key.key_id}/rotate`),
            { opener: rotate, status },
          ).catch((error: unknown) => {
            if (!(error instanceof ApiFailure)) throw error;
            setStatus(
              status,
              error.code === 'rotation_in_progress' ? keyStatus.rotationDuringOverlap : keyStatus.illegalTransition,
            );
            return undefined;
          });
          if (outcome === null || outcome === undefined) return;
          secret.value = outcome.body.secret;
          secretField.hidden = false;
          copy.hidden = false;
          rotate.disabled = true;
          setStatus(status, keyStatus.rotated(key.key_id, String(outcome.body.previous_secret_expires_at)));
          await load();
        });
        dialog.body.append(
          el('h2', { text: 'Rotate access key' }),
          el('p', { text: `Rotate ${key.key_id}? The previous secret keeps working until the overlap ends.` }),
          secretField,
          el('div', { class: 'dialog-actions' }, [rotate, copy, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  }

  createButton.addEventListener('click', () => {
    openDialog({
      name: 'Create access key',
      opener: createButton,
      build: (dialog) => {
        const description = textbox('Description');
        const readOnly = el('input', { type: 'radio', name: 'permission', 'aria-label': 'Read only', value: 'read' }) as HTMLInputElement;
        const readWrite = el('input', {
          type: 'radio',
          name: 'permission',
          'aria-label': 'Read and write',
          value: 'read-write',
        }) as HTMLInputElement;
        readOnly.checked = true;
        const allBuckets = el('input', { type: 'checkbox', 'aria-label': 'All buckets' }) as HTMLInputElement;
        allBuckets.checked = true;
        const bucketBoxes = context.buckets.map((bucket) => {
          const box = el('input', { type: 'checkbox', 'aria-label': bucket.name, value: bucket.name }) as HTMLInputElement;
          return { bucket, box };
        });
        const prefix = textbox('Object prefix');
        const expiresAt = textbox('Expires at (UTC)');
        const create = button('Create key', { className: 'primary' });
        const secret = textbox('Secret access key', { readOnly: true });
        const secretField = field('Secret access key', secret);
        secretField.hidden = true;
        const copy = button('Copy secret', {
          onClick: () => {
            secret.select();
            void navigator.clipboard?.writeText(secret.value);
          },
        });
        copy.hidden = true;
        const descriptionField = field('Description', description);
        const prefixField = field('Object prefix', prefix);
        const expiresField = field('Expires at (UTC)', expiresAt, 'YYYY-MM-DD HH:MM:SS, empty means never');

        create.addEventListener('click', async () => {
          setStatus(status, keyStatus.creating);
          const buckets = allBuckets.checked
            ? null
            : bucketBoxes.filter((entry) => entry.box.checked).map((entry) => entry.bucket.name);
          const payload = {
            description: description.value,
            permission: readWrite.checked ? 'read-write' : 'read',
            buckets,
            prefix: prefix.value.trim() === '' ? null : prefix.value.trim(),
            expires_at: expiresAt.value.trim() === '' ? null : `${expiresAt.value.trim().replace(' ', 'T')}Z`,
          };
          const outcome = await withStepUp(() => api.post<KeyRow & { secret: string }>(`/api/w/${context.slug}/keys`, payload), {
            opener: create,
            status,
          }).catch((error: unknown) => {
            if (!(error instanceof ApiFailure)) throw error;
            setStatus(status, keyStatus.fieldError);
            for (const [name, node] of [
              ['description', descriptionField],
              ['prefix', prefixField],
              ['expires_at', expiresField],
            ] as const) {
              const target = node.querySelector('.field-error');
              if (target) target.textContent = error.errors[name] ?? '';
            }
            return undefined;
          });
          if (outcome === null || outcome === undefined) return;
          secret.value = outcome.body.secret;
          secretField.hidden = false;
          copy.hidden = false;
          create.disabled = true;
          setStatus(status, keyStatus.created(outcome.body.key_id));
          await load();
        });

        dialog.body.append(
          el('h2', { text: 'Create access key' }),
          descriptionField,
          el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Permission' }, [
            el('label', {}, [readOnly, document.createTextNode(' Read only')]),
            el('label', {}, [readWrite, document.createTextNode(' Read and write')]),
          ]),
          el('div', { class: 'field', role: 'group', 'aria-label': 'Buckets' }, [
            el('label', {}, [allBuckets, document.createTextNode(' All buckets')]),
            ...bucketBoxes.map((entry) => el('label', {}, [entry.box, document.createTextNode(` ${entry.bucket.name}`)])),
          ]),
          prefixField,
          expiresField,
          secretField,
          el('div', { class: 'dialog-actions' }, [create, copy, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  });

  await load();
  return { centre, stop: schedule(15000, load) };
}

export async function renderUsage(context: ConsoleContext): Promise<Rendered> {
  const storedMeter = el('div', {
    role: 'meter',
    'aria-label': 'Stored',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    class: 'meter',
  });
  const storedText = el('p', { class: 'mono meter-text' });
  const egressMeter = el('div', {
    role: 'meter',
    'aria-label': 'Egress this month',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    class: 'meter',
  });
  const egressText = el('p', { class: 'mono meter-text' });
  const reservedText = el('p', { class: 'mono' });
  const requestsText = el('p', { class: 'mono' });
  const billingStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Billing sync' });
  const rowBody = el('tbody');
  const download = button('Download CSV', {
    focusKey: 'download-csv',
    onClick: () => {
      download.textContent = 'Preparing CSV\u2026';
      window.location.assign(`/api/w/${context.slug}/usage/export.csv`);
      window.setTimeout(() => {
        download.textContent = 'Download CSV';
      }, 1500);
    },
  });
  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Usage' }),
    el('div', { class: 'meter-row' }, [storedMeter, storedText]),
    el('div', { class: 'meter-row' }, [egressMeter, egressText]),
    reservedText,
    requestsText,
    billingStatus,
    tableOf('Usage rows', ['Window start (UTC)', 'Window end (UTC)', 'Bucket', 'Unit', 'Amount', 'Tracking ID', 'Billing state'], rowBody),
    download,
  ]);

  async function load(): Promise<void> {
    const usage = await api.get<{
      plan: { included_storage_bytes: number; included_egress_bytes: number };
      stored_bytes: number;
      reserved_bytes: number;
      egress_bytes: number;
      request_units: number;
      percent: { storage: number; egress: number };
      billing: { state: string; confirmed_through: string | null };
    }>(`/api/w/${context.slug}/usage`);
    const body = usage.body;
    storedMeter.setAttribute('aria-valuenow', String(Math.min(100, body.percent.storage)));
    storedMeter.style.setProperty('--fill', `${Math.min(100, body.percent.storage)}%`);
    storedText.textContent = `${formatCount(body.stored_bytes)} of ${formatCount(
      body.plan.included_storage_bytes,
    )} bytes (${formatPercent(body.percent.storage)}%)`;
    egressMeter.setAttribute('aria-valuenow', String(Math.min(100, body.percent.egress)));
    egressMeter.style.setProperty('--fill', `${Math.min(100, body.percent.egress)}%`);
    egressText.textContent = `${formatCount(body.egress_bytes)} of ${formatCount(
      body.plan.included_egress_bytes,
    )} bytes (${formatPercent(body.percent.egress)}%)`;
    reservedText.textContent = `Reserved for open uploads ${formatCount(body.reserved_bytes)} bytes`;
    requestsText.textContent = `Request units ${formatCount(body.request_units)}`;
    billingStatus.textContent =
      body.billing.state === 'in_sync'
        ? billingSync.inSync(body.billing.confirmed_through)
        : body.billing.state === 'pending'
          ? billingSync.pending
          : billingSync.delayed(body.billing.confirmed_through);
    const rows = await api.get<{
      rows: { window_start: string; window_end: string; bucket: string; unit: string; amount: string; tracking_id: string; billing_state: string }[];
    }>(`/api/w/${context.slug}/usage/rows`);
    replace(
      rowBody,
      rows.body.rows.map((usageRow) =>
        el('tr', {}, [
          el('td', { class: 'mono', text: formatTime(usageRow.window_start) }),
          el('td', { class: 'mono', text: formatTime(usageRow.window_end) }),
          el('td', { text: usageRow.bucket }),
          el('td', { text: usageRow.unit }),
          el('td', { class: 'mono num', text: usageRow.amount }),
          el('td', { class: 'mono', text: usageRow.tracking_id }),
          el('td', { text: usageRow.billing_state }),
        ]),
      ),
    );
  }

  await load();
  return { centre, stop: schedule(15000, load) };
}

interface EndpointRow {
  id: string;
  url: string;
  events: string[];
  buckets: string[] | null;
  description: string;
  state: string;
  created_at: string;
}

export async function renderWebhooks(context: ConsoleContext): Promise<Rendered> {
  const body = el('tbody');
  const status = statusRegion('Webhook status');
  const addButton = button('Add endpoint', { className: 'primary', focusKey: 'add-endpoint' });
  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Webhooks' }),
    addButton,
    tableOf('Webhook endpoints', ['URL', 'Events', 'Bucket scope', 'Description', 'State', 'Created (UTC)', ''], body),
    status,
  ]);

  async function load(): Promise<void> {
    const endpoints = await api.get<{ endpoints: EndpointRow[] }>(`/api/w/${context.slug}/webhooks`);
    replace(
      body,
      endpoints.body.endpoints.map((endpoint) => {
        const actions = el('td');
        if (endpoint.state === 'active') {
          const disable = button('Disable endpoint', { focusKey: `disable-endpoint:${endpoint.id}` });
          disable.addEventListener('click', async () => {
            try {
              await api.post(`/api/w/${context.slug}/webhooks/${endpoint.id}/disable`);
              setStatus(status, webhookStatus.disabled);
              await load();
            } catch {
              setStatus(status, webhookStatus.illegalTransition);
            }
          });
          actions.append(disable);
        } else {
          const enable = button('Enable endpoint', { focusKey: `enable-endpoint:${endpoint.id}` });
          enable.addEventListener('click', async () => {
            try {
              await api.post(`/api/w/${context.slug}/webhooks/${endpoint.id}/enable`);
              setStatus(status, webhookStatus.enabled);
              await load();
            } catch {
              setStatus(status, webhookStatus.illegalTransition);
            }
          });
          const remove = button('Delete endpoint', { focusKey: `delete-endpoint:${endpoint.id}` });
          remove.addEventListener('click', async () => {
            try {
              await api.delete(`/api/w/${context.slug}/webhooks/${endpoint.id}`);
              setStatus(status, webhookStatus.deleted);
              await load();
            } catch {
              setStatus(status, webhookStatus.illegalTransition);
            }
          });
          actions.append(enable, remove);
        }
        const deliveries = el('a', {
          href: `/console/${context.slug}/${pagePaths.deliveries}/${endpoint.id}`,
          'aria-label': `Deliveries for ${endpoint.url}`,
          text: 'Deliveries',
        });
        actions.append(deliveries);
        return el('tr', {}, [
          el('td', { text: endpoint.url }),
          el('td', { text: endpoint.events.join(', ') }),
          el('td', { text: endpoint.buckets === null ? 'All buckets' : endpoint.buckets.join(', ') }),
          el('td', { text: endpoint.description }),
          el('td', { text: endpoint.state }),
          el('td', { class: 'mono', text: formatTime(endpoint.created_at) }),
          actions,
        ]);
      }),
    );
  }

  addButton.addEventListener('click', () => {
    openDialog({
      name: 'Add webhook endpoint',
      opener: addButton,
      build: (dialog) => {
        const url = textbox('Endpoint URL');
        const urlField = field('Endpoint URL', url);
        const eventBoxes = ['object.created', 'object.deleted', 'object.restored', 'version.removed'].map((event) => {
          const box = el('input', { type: 'checkbox', 'aria-label': event, value: event }) as HTMLInputElement;
          return { event, box };
        });
        const allBuckets = el('input', { type: 'checkbox', 'aria-label': 'All buckets' }) as HTMLInputElement;
        allBuckets.checked = true;
        const bucketBoxes = context.buckets.map((bucket) => {
          const box = el('input', { type: 'checkbox', 'aria-label': bucket.name, value: bucket.name }) as HTMLInputElement;
          return { bucket, box };
        });
        const description = textbox('Description');
        const create = button('Create endpoint', { className: 'primary' });
        const secret = textbox('Signing secret', { readOnly: true });
        const secretField = field('Signing secret', secret);
        secretField.hidden = true;
        const copy = button('Copy secret', {
          onClick: () => {
            secret.select();
            void navigator.clipboard?.writeText(secret.value);
          },
        });
        copy.hidden = true;
        create.addEventListener('click', async () => {
          setStatus(status, webhookStatus.pending);
          try {
            const created = await api.post<EndpointRow & { secret: string }>(`/api/w/${context.slug}/webhooks`, {
              url: url.value.trim(),
              events: eventBoxes.filter((entry) => entry.box.checked).map((entry) => entry.event),
              buckets: allBuckets.checked ? null : bucketBoxes.filter((entry) => entry.box.checked).map((entry) => entry.bucket.name),
              description: description.value,
            });
            secret.value = created.body.secret;
            secretField.hidden = false;
            copy.hidden = false;
            create.disabled = true;
            setStatus(status, webhookStatus.created);
            await load();
          } catch (error) {
            if (!(error instanceof ApiFailure)) throw error;
            if (error.code === 'endpoint_limit') {
              setStatus(status, webhookStatus.limit);
              dialog.setStatus(webhookStatus.limit);
              return;
            }
            setStatus(status, webhookStatus.fieldError);
            const target = urlField.querySelector('.field-error');
            if (target) target.textContent = error.errors.url ?? error.errors.events ?? error.errors.buckets ?? '';
          }
        });
        dialog.body.append(
          el('h2', { text: 'Add webhook endpoint' }),
          urlField,
          el('div', { class: 'field', role: 'group', 'aria-label': 'Events' }, [
            ...eventBoxes.map((entry) => el('label', {}, [entry.box, document.createTextNode(` ${entry.event}`)])),
          ]),
          el('div', { class: 'field', role: 'group', 'aria-label': 'Buckets' }, [
            el('label', {}, [allBuckets, document.createTextNode(' All buckets')]),
            ...bucketBoxes.map((entry) => el('label', {}, [entry.box, document.createTextNode(` ${entry.bucket.name}`)])),
          ]),
          field('Description', description),
          secretField,
          el('div', { class: 'dialog-actions' }, [create, copy, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  });

  await load();
  return { centre, stop: () => undefined };
}

export async function renderDeliveries(context: ConsoleContext, endpointId: string): Promise<Rendered> {
  const body = el('tbody');
  const status = statusRegion('Webhook status');
  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Deliveries' }),
    tableOf(
      'Deliveries',
      ['Sequence', 'Event type', 'State', 'Attempts', 'Last status', 'Last error', 'Next attempt (UTC)', 'Delivered (UTC)', ''],
      body,
    ),
    status,
  ]);

  async function load(): Promise<void> {
    const deliveries = await api.get<{
      deliveries: {
        id: string;
        event_type: string;
        sequence: number;
        state: string;
        attempts: number;
        last_status: number | null;
        last_error: string | null;
        next_attempt_at: string | null;
        delivered_at: string | null;
      }[];
    }>(`/api/w/${context.slug}/webhooks/${endpointId}/deliveries`);
    replace(
      body,
      deliveries.body.deliveries.map((delivery) => {
        const actions = el('td');
        if (delivery.state === 'dead') {
          const redeliver = button(`Redeliver ${formatCount(delivery.sequence)}`, {
            focusKey: `redeliver:${delivery.id}`,
          });
          redeliver.addEventListener('click', async () => {
            try {
              await api.post(`/api/w/${context.slug}/webhooks/${endpointId}/deliveries/${delivery.id}/redeliver`);
              setStatus(status, webhookStatus.redelivered(delivery.sequence));
              await load();
            } catch {
              setStatus(status, webhookStatus.illegalTransition);
            }
          });
          actions.append(redeliver);
        }
        return el('tr', {}, [
          el('td', { class: 'mono num', text: formatCount(delivery.sequence) }),
          el('td', { text: delivery.event_type }),
          el('td', { text: delivery.state }),
          el('td', { class: 'mono num', text: formatCount(delivery.attempts) }),
          el('td', { class: 'mono num', text: delivery.last_status === null ? '\u2014' : formatCount(delivery.last_status) }),
          el('td', { text: delivery.last_error ?? '\u2014' }),
          el('td', { class: 'mono', text: delivery.next_attempt_at === null ? '\u2014' : formatTime(delivery.next_attempt_at) }),
          el('td', { class: 'mono', text: delivery.delivered_at === null ? '\u2014' : formatTime(delivery.delivered_at) }),
          actions,
        ]);
      }),
    );
  }

  await load();
  return { centre, stop: schedule(2000, load) };
}

export async function renderSecurity(
  context: ConsoleContext,
  filters: { action: string; actor: string; cursor: string | null; prev: string[] },
): Promise<Rendered> {
  const encryptionLine = el('p', { class: 'mono' });
  const encryptionStatusRegion = statusRegion('Encryption status');
  const rotateButton = button('Rotate workspace key', { focusKey: 'rotate-workspace-key', className: 'primary' });
  const encryptionRegion = el('section', { role: 'region', 'aria-label': 'Encryption' }, [
    el('h3', { text: 'Encryption' }),
    encryptionLine,
    rotateButton,
    encryptionStatusRegion,
  ]);

  const actionSelect = el('select', { 'aria-label': 'Action' }) as HTMLSelectElement;
  const actions = [
    'session.signed_in',
    'session.sign_in_failed',
    'password.changed',
    'two_step.enabled',
    'two_step.disabled',
    'member.role_changed',
    'member.removed',
    'invite.created',
    'invite.accepted',
    'access_key.created',
    'access_key.rotated',
    'access_key.disabled',
    'access_key.deleted',
    'legal_hold.changed',
    'encryption.rotated',
    'workspace.suspended',
    'workspace.reinstated',
    'permission.denied',
  ];
  actionSelect.append(el('option', { value: '', text: 'All actions' }));
  for (const action of actions) actionSelect.append(el('option', { value: action, text: action }));
  actionSelect.value = filters.action;
  const actorInput = textbox('Actor', { value: filters.actor });
  const applyButton = button('Apply audit filters', { focusKey: 'apply-audit-filters' });
  const auditBody = el('tbody');
  const newerButton = button('Newer entries', { focusKey: 'newer-entries' });
  const olderButton = button('Older entries', { focusKey: 'older-entries' });
  const verifyButton = button('Verify chain', { focusKey: 'verify-chain' });
  const exportButton = button('Download audit CSV', { focusKey: 'download-audit-csv' });
  const auditStatusRegion = statusRegion('Audit status');
  const auditRegion = el('section', { role: 'region', 'aria-label': 'Audit trail' }, [
    el('h3', { text: 'Audit trail' }),
    field('Action', actionSelect),
    field('Actor', actorInput),
    applyButton,
    tableOf('Audit trail', ['Seq', 'Time (UTC)', 'Actor', 'Action', 'Target', 'Detail'], auditBody),
    el('div', { class: 'paging' }, [newerButton, olderButton]),
    verifyButton,
    exportButton,
    auditStatusRegion,
  ]);

  const centre = el('main', { class: 'centre' }, [
    el('h2', { class: 'centre-heading', tabindex: '-1', text: 'Security' }),
    encryptionRegion,
    auditRegion,
  ]);

  function auditQuery(next: { action: string; actor: string; cursor: string | null; prev: string[] }): string {
    return buildQuery([
      queryOf('action', next.action),
      queryOf('actor', next.actor),
      next.cursor === null ? null : queryOf('cursor', next.cursor),
      ...next.prev.map((entry) => `prev=${encodeURIComponent(entry)}`),
    ]);
  }

  applyButton.addEventListener('click', () => {
    context.navigate(
      `/console/${context.slug}/${pagePaths.security}${auditQuery({
        action: actionSelect.value,
        actor: actorInput.value,
        cursor: null,
        prev: [],
      })}`,
    );
  });

  rotateButton.addEventListener('click', () => {
    openDialog({
      name: 'Rotate workspace key',
      opener: rotateButton,
      build: (dialog) => {
        const rotate = button('Rotate', { className: 'primary' });
        rotate.addEventListener('click', async () => {
          setStatus(encryptionStatusRegion, encryptionStatus.pending);
          const outcome = await withStepUp(
            () => api.post<{ generation: number; rewrapped: number }>(`/api/w/${context.slug}/encryption/rotate`),
            { opener: rotate, status: encryptionStatusRegion },
          ).catch((error: unknown) => {
            if (!(error instanceof ApiFailure)) throw error;
            setStatus(
              encryptionStatusRegion,
              error.code === 'rotation_in_progress' ? encryptionStatus.running : error.message,
            );
            return undefined;
          });
          dialog.close();
          if (outcome === null || outcome === undefined) return;
          setStatus(encryptionStatusRegion, encryptionStatus.success(outcome.body.generation, outcome.body.rewrapped));
          await loadEncryption();
        });
        dialog.body.append(
          el('h2', { text: 'Rotate workspace key' }),
          el('p', { text: 'Rotate the workspace key? Object bytes stay where they are; only their data keys are re-wrapped.' }),
          el('div', { class: 'dialog-actions' }, [rotate, button('Cancel', { onClick: () => dialog.close() })]),
        );
      },
    });
  });

  verifyButton.addEventListener('click', async () => {
    setStatus(auditStatusRegion, auditStatus.pending);
    const verified = await api.get<{ ok: boolean; entries: number; first_broken_seq: number | null }>(
      `/api/w/${context.slug}/audit/verify`,
    );
    setStatus(
      auditStatusRegion,
      verified.body.ok ? auditStatus.verified(verified.body.entries) : auditStatus.broken(verified.body.first_broken_seq ?? 0),
    );
  });

  exportButton.addEventListener('click', () => {
    window.location.assign(
      `/api/w/${context.slug}/audit/export.csv${buildQuery([queryOf('action', filters.action), queryOf('actor', filters.actor)])}`,
    );
  });

  async function loadEncryption(): Promise<void> {
    const encryption = await api.get<{ generation: number; rotated_at: string | null }>(`/api/w/${context.slug}/encryption`);
    encryptionLine.textContent =
      encryption.body.rotated_at === null
        ? 'Workspace key generation 1, never rotated.'
        : `Workspace key generation ${formatCount(encryption.body.generation)}, rotated ${formatTime(encryption.body.rotated_at)}.`;
  }

  async function loadAudit(): Promise<void> {
    try {
      const page = await api.get<{
        entries: { seq: number; at: string; actor: string; action: string; target: string; detail: string }[];
        next_cursor: string | null;
      }>(`/api/w/${context.slug}/audit${auditQuery(filters)}`);
      replace(
        auditBody,
        page.body.entries.map((entry) =>
          el('tr', {}, [
            el('td', { class: 'mono num', text: formatCount(entry.seq) }),
            el('td', { class: 'mono', text: formatTime(entry.at) }),
            el('td', { text: entry.actor }),
            el('td', { text: entry.action }),
            el('td', { text: entry.target }),
            el('td', { text: entry.detail }),
          ]),
        ),
      );
      if (page.body.entries.length === 0) setStatus(auditStatusRegion, auditStatus.empty);
      olderButton.disabled = page.body.next_cursor === null;
      newerButton.disabled = filters.prev.length === 0;
      olderButton.onclick = () => {
        if (page.body.next_cursor === null) return;
        context.navigate(
          `/console/${context.slug}/${pagePaths.security}${auditQuery({
            ...filters,
            cursor: page.body.next_cursor,
            prev: [...filters.prev, filters.cursor ?? ''],
          })}`,
        );
      };
      newerButton.onclick = () => {
        const prev = [...filters.prev];
        const back = prev.pop() ?? '';
        context.navigate(
          `/console/${context.slug}/${pagePaths.security}${auditQuery({
            ...filters,
            cursor: back === '' ? null : back,
            prev,
          })}`,
        );
      };
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      const firstField = Object.keys(error.errors)[0];
      setStatus(auditStatusRegion, firstField ? auditStatus.filterError(error.errors[firstField]) : storageOutage);
    }
  }

  await loadEncryption();
  await loadAudit();
  return { centre, stop: () => undefined };
}
