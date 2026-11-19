import { ApiCallError, getJson, sendFile, sendJson } from '../api.js';
import { el, openDialog } from '../dom.js';
import { onLive } from '../live.js';
import { emptyGlyph } from '../marks.js';
import { notFoundPage, registerCleanup, type PageContext } from '../main.js';
import { currentSession, displayDateTime, setPageStatus } from '../shell.js';
import { AUDIT_ACTIONS } from '../../shared/labels.js';
import type { AdminAsset, AuditRecord, GrantView } from '../../shared/types.js';

interface Organisation {
  id: string;
  name: string;
  kind: string;
  engagement: { startsOn: string | null; endsOn: string | null; territories: string[] };
}

export async function renderAdmin(context: PageContext): Promise<void> {
  const area = context.params['area'] ?? '';
  const role = currentSession().principal?.role;
  const ownerOnly = area === 'assets' || area === 'people';
  const allowed = role === 'owner' || (!ownerOnly && role === 'legal_reviewer');
  if (!allowed || !['assets', 'grants', 'audit', 'people'].includes(area)) {
    notFoundPage(context.main);
    return;
  }

  if (area === 'assets') return renderAssets(context);
  if (area === 'grants') return renderGrants(context);
  if (area === 'audit') return renderAudit(context);
  return renderPeople(context);
}

function errorText(error: unknown): string {
  return error instanceof ApiCallError ? error.message : 'Something went wrong.';
}

function actionButton(label: string, run: () => Promise<void>, alert: HTMLElement, waiting = 'Saving'): HTMLButtonElement {
  const button = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        alert.textContent = '';
        button.disabled = true;
        button.textContent = waiting;
        void run()
          .catch((error: unknown) => {
            alert.textContent = errorText(error);
          })
          .finally(() => {
            button.disabled = false;
            button.textContent = label;
          });
      },
    },
    label,
  ) as HTMLButtonElement;
  return button;
}

async function renderAssets(context: PageContext): Promise<void> {
  const { main } = context;
  const holder = el('div', { class: 'cell' });
  main.appendChild(holder);

  const load = async (): Promise<void> => {
    const { assets } = await getJson<{ assets: AdminAsset[] }>('/api/admin/assets');
    const alert = el('p', { class: 'alert', role: 'alert' });
    holder.replaceChildren(
      el('h1', {}, 'Assets'),
      alert,
      el(
        'table',
        { class: 'data-table' },
        el('caption', {}, 'Assets'),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, 'Asset'),
            el('th', { scope: 'col' }, 'Class'),
            el('th', { scope: 'col' }, 'State'),
            el('th', { scope: 'col' }, 'Derivatives'),
            el('th', { scope: 'col' }, 'Actions'),
          ),
        ),
        el(
          'tbody',
          {},
          ...assets.map((asset) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, asset.name),
              el('td', {}, asset.class),
              el('td', {}, asset.state),
              el(
                'td',
                {},
                ...asset.derivatives.flatMap((derivative) => [
                  el('span', { class: 'derivative-row' }, `${derivative.fileName} (${derivative.width} x ${derivative.height})`),
                  actionButton(
                    `Remove ${derivative.fileName}`,
                    async () => {
                      await sendJson('DELETE', `/api/derivatives/${derivative.id}`);
                      setPageStatus(`${derivative.fileName} removed.`);
                      await load();
                    },
                    alert,
                  ),
                ]),
                uploadField(asset, alert, load),
              ),
              el(
                'td',
                {},
                actionButton(
                  `Release ${asset.name}`,
                  async () => {
                    await sendJson('POST', `/api/assets/${asset.id}/release`);
                    setPageStatus(`${asset.name} released.`);
                    await load();
                  },
                  alert,
                ),
                actionButton(
                  `Restrict ${asset.name}`,
                  async () => {
                    await sendJson('POST', `/api/assets/${asset.id}/restrict`);
                    setPageStatus(`${asset.name} restricted.`);
                    await load();
                  },
                  alert,
                ),
                retireButton(asset, assets, load),
              ),
            ),
          ),
        ),
      ),
    );
  };

  await load();
  registerCleanup(
    onLive((event) => {
      if (event.type === 'library.updated') void load();
    }),
  );
}

function uploadField(asset: AdminAsset, alert: HTMLElement, reload: () => Promise<void>): HTMLElement {
  const id = `derivative-${asset.id}`;
  const input = el('input', { type: 'file', id, 'aria-label': `Add derivative to ${asset.name}` }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    alert.textContent = '';
    void sendFile(`/api/assets/${asset.id}/derivatives`, file)
      .then(async () => {
        setPageStatus(`${file.name} added.`);
        await reload();
      })
      .catch((error: unknown) => {
        alert.textContent = errorText(error);
      });
  });
  return el('span', { class: 'upload-field' }, el('label', { for: id }, `Add derivative to ${asset.name}`), input);
}

function retireButton(asset: AdminAsset, assets: AdminAsset[], reload: () => Promise<void>): HTMLButtonElement {
  const open = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        const select = el(
          'select',
          { id: 'successor', 'aria-label': 'Successor' },
          ...assets
            .filter((candidate) => candidate.id !== asset.id)
            .map((candidate) => el('option', { value: candidate.id }, candidate.name)),
        ) as HTMLSelectElement;
        const dialogAlert = el('p', { class: 'alert', role: 'alert' });
        const dialog = el('dialog', { class: 'sheet', 'aria-label': `Retire ${asset.name}` }) as HTMLDialogElement;
        dialog.append(
          el('h2', {}, `Retire ${asset.name}`),
          el('label', { for: 'successor' }, 'Successor'),
          select,
          dialogAlert,
          actionButton(
            'Retire asset',
            async () => {
              await sendJson('POST', `/api/assets/${asset.id}/retire`, { successorAssetId: select.value });
              setPageStatus(`${asset.name} retired.`);
              dialog.close();
              await reload();
            },
            dialogAlert,
          ),
          el('button', { type: 'button', class: 'pill ghost', onclick: () => dialog.close() }, 'Cancel'),
        );
        openDialog(dialog, open);
      },
    },
    `Retire ${asset.name}`,
  ) as HTMLButtonElement;
  return open;
}

async function renderGrants(context: PageContext): Promise<void> {
  const { main } = context;
  const holder = el('div', { class: 'cell' });
  main.appendChild(holder);

  const load = async (): Promise<void> => {
    const { grants } = await getJson<{ grants: GrantView[] }>('/api/grants');
    const alert = el('p', { class: 'alert', role: 'alert' });
    holder.replaceChildren(
      el('h1', {}, 'Grants'),
      alert,
      el(
        'table',
        { class: 'data-table' },
        el('caption', {}, 'Grants'),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, 'Grant'),
            el('th', { scope: 'col' }, 'Holder'),
            el('th', { scope: 'col' }, 'Asset'),
            el('th', { scope: 'col' }, 'Status'),
            el('th', { scope: 'col' }, 'Ends'),
            el('th', { scope: 'col' }, 'Actions'),
          ),
        ),
        el(
          'tbody',
          {},
          ...grants.map((grant) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, grant.id),
              el('td', {}, grant.holder.displayName),
              el('td', {}, grant.cardName),
              el('td', {}, grant.statusLabel),
              el('td', {}, grant.notAfter),
              el('td', {}, revokeButton(grant, load)),
            ),
          ),
        ),
      ),
    );
  };

  await load();
  registerCleanup(
    onLive((event) => {
      if (event.type === 'grant.updated' || event.type === 'library.updated') void load();
    }),
  );
}

function revokeButton(grant: GrantView, reload: () => Promise<void>): HTMLButtonElement {
  const open = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        const reason = el('input', { type: 'text', id: 'revoke-reason', 'aria-label': 'Reason' }) as HTMLInputElement;
        const dialogAlert = el('p', { class: 'alert', role: 'alert' });
        const dialog = el('dialog', { class: 'sheet', 'aria-label': `Revoke ${grant.id}` }) as HTMLDialogElement;
        dialog.append(
          el('h2', {}, `Revoke ${grant.id}`),
          el('label', { for: 'revoke-reason' }, 'Reason'),
          reason,
          dialogAlert,
          actionButton(
            'Revoke grant',
            async () => {
              await sendJson('POST', `/api/grants/${grant.id}/revoke`, { reason: reason.value });
              setPageStatus(`${grant.id} revoked.`);
              dialog.close();
              await reload();
            },
            dialogAlert,
          ),
          el('button', { type: 'button', class: 'pill ghost', onclick: () => dialog.close() }, 'Cancel'),
        );
        openDialog(dialog, open);
      },
    },
    `Revoke ${grant.id}`,
  ) as HTMLButtonElement;
  return open;
}

function printPayload(payload: Record<string, unknown> | null): HTMLElement {
  if (payload === null) return el('span', {}, 'none');
  const lines = Object.keys(payload)
    .sort()
    .map((key) => `${key}: ${String(payload[key])}`);
  return el('span', { class: 'payload' }, ...lines.map((line) => el('span', { class: 'payload-line' }, line)));
}

async function renderAudit(context: PageContext): Promise<void> {
  const { main } = context;
  const requestId = el('input', { type: 'text', id: 'audit-request', 'aria-label': 'Request id' }) as HTMLInputElement;
  const action = el(
    'select',
    { id: 'audit-action', 'aria-label': 'Action' },
    el('option', { value: '' }, 'All actions'),
    ...AUDIT_ACTIONS.map((name) => el('option', { value: name }, name)),
  ) as HTMLSelectElement;
  const from = el('input', { type: 'date', id: 'audit-from', 'aria-label': 'From' }) as HTMLInputElement;
  const to = el('input', { type: 'date', id: 'audit-to', 'aria-label': 'To' }) as HTMLInputElement;
  const chainStatus = el('p', {
    class: 'results-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Chain status',
  });
  const alert = el('p', { class: 'alert', role: 'alert' });
  const tableHolder = el('div', { class: 'cell' });

  const load = async (): Promise<void> => {
    const params = new URLSearchParams();
    if (requestId.value.trim() !== '') params.set('requestId', requestId.value.trim());
    if (action.value !== '') params.set('action', action.value);
    if (from.value !== '') params.set('from', from.value);
    if (to.value !== '') params.set('to', to.value);
    const { records } = await getJson<{ records: AuditRecord[] }>(`/api/audit?${params.toString()}`);
    if (records.length === 0) {
      tableHolder.replaceChildren(
        el('div', { class: 'field field-ember empty-state' }, emptyGlyph(), el('p', {}, 'No audit records match.')),
      );
      return;
    }
    tableHolder.replaceChildren(
      el(
        'table',
        { class: 'data-table audit-table' },
        el('caption', {}, 'Audit log'),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            ...['Sequence', 'Time', 'Actor', 'Action', 'Resource', 'Before', 'After', 'Outcome'].map((column) =>
              el('th', { scope: 'col' }, column),
            ),
          ),
        ),
        el(
          'tbody',
          {},
          ...records.map((record) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, String(record.sequence)),
              el('td', {}, displayDateTime(record.occurredAt)),
              el('td', {}, record.actorName),
              el('td', {}, record.action),
              el('td', {}, `${record.resourceType} ${record.resourceId}`),
              el('td', {}, printPayload(record.before)),
              el('td', {}, printPayload(record.after)),
              el('td', {}, record.outcome),
            ),
          ),
        ),
      ),
    );
  };

  const apply = actionButton('Apply filters', load, alert);
  const verify = actionButton(
    'Verify chain',
    async () => {
      const result = await getJson<{ ok: boolean; records: number; brokenAt: number | null }>('/api/audit/verify');
      chainStatus.textContent = result.ok
        ? `Chain verified: ${result.records} records.`
        : `Chain broken at record ${result.brokenAt}.`;
    },
    alert,
    'Checking chain',
  );

  main.append(
    el(
      'div',
      { class: 'cell audit-filters' },
      el('h1', {}, 'Audit log'),
      el('label', { for: 'audit-request' }, 'Request id'),
      requestId,
      el('label', { for: 'audit-action' }, 'Action'),
      action,
      el('label', { for: 'audit-from' }, 'From'),
      from,
      el('label', { for: 'audit-to' }, 'To'),
      to,
      apply,
      verify,
      chainStatus,
      alert,
    ),
    tableHolder,
  );

  await load();
}

async function renderPeople(context: PageContext): Promise<void> {
  const { main } = context;
  const { organisations } = await getJson<{ organisations: Organisation[] }>('/api/organisations');
  const alert = el('p', { class: 'alert', role: 'alert' });

  const email = el('input', { type: 'email', id: 'invite-email', 'aria-label': 'Email' }) as HTMLInputElement;
  const displayName = el('input', { type: 'text', id: 'invite-name', 'aria-label': 'Display name' }) as HTMLInputElement;
  const role = el(
    'select',
    { id: 'invite-role', 'aria-label': 'Role' },
    el('option', { value: 'agency' }, 'Agency partner'),
    el('option', { value: 'press' }, 'Press contact'),
  ) as HTMLSelectElement;
  const organisation = el(
    'select',
    { id: 'invite-organisation', 'aria-label': 'Organisation' },
    ...organisations.map((candidate) => el('option', { value: candidate.id }, candidate.name)),
  ) as HTMLSelectElement;

  const invite = actionButton(
    'Invite person',
    async () => {
      await sendJson('POST', '/api/invitations', {
        email: email.value,
        displayName: displayName.value,
        role: role.value,
        organisationId: organisation.value,
      });
      setPageStatus(`Invitation queued for ${email.value}.`);
    },
    alert,
  );

  const engagements = organisations
    .filter((candidate) => candidate.kind === 'agency')
    .map((candidate) => {
      const field = el('input', {
        type: 'date',
        id: `engagement-${candidate.id}`,
        'aria-label': `Engagement end for ${candidate.name}`,
        value: candidate.engagement.endsOn ?? '',
      }) as HTMLInputElement;
      return el(
        'div',
        { class: 'engagement-row' },
        el('label', { for: field.id }, `Engagement end for ${candidate.name}`),
        field,
        actionButton(
          `Save engagement end for ${candidate.name}`,
          async () => {
            await sendJson('PUT', `/api/organisations/${candidate.id}/engagement`, { endsOn: field.value });
            setPageStatus('Engagement end saved.');
          },
          alert,
        ),
      );
    });

  main.appendChild(
    el(
      'div',
      { class: 'cell' },
      el('h1', {}, 'People'),
      el('label', { for: 'invite-email' }, 'Email'),
      email,
      el('label', { for: 'invite-name' }, 'Display name'),
      displayName,
      el('label', { for: 'invite-role' }, 'Role'),
      role,
      el('label', { for: 'invite-organisation' }, 'Organisation'),
      organisation,
      invite,
      alert,
      ...engagements,
    ),
  );
}
