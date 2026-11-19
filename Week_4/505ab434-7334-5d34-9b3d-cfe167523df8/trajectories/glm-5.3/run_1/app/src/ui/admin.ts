import {
  api,
  el,
  loadMe,
  setAlert,
  setStatus,
  busyButton,
  type Me,
  type AssetAdmin,
  type GrantDetail,
  type AuditRecord,
} from './types';
import { openDialog } from './dialog';

export async function initAdminAssets(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('admin-root');
  if (!root) return;
  void me;

  const load = async (): Promise<void> => {
    const data = await api<{ assets: AssetAdmin[] }>('/api/admin/assets');
    const table = el('table', { class: 'data', 'aria-label': 'Assets' });
    const head = el('thead');
    head.append(
      el('tr', {},
        el('th', { scope: 'col' }, 'Asset'),
        el('th', { scope: 'col' }, 'State'),
        el('th', { scope: 'col' }, 'Successor'),
        el('th', { scope: 'col' }, 'Derivatives'),
        el('th', { scope: 'col' }, 'Actions'),
      ),
    );
    const body = el('tbody');
    for (const asset of data.assets) {
      const cell = el('td');
      const slot = el('div', { class: 'alert-slot' });
      const release = el('button', { type: 'button' }, `Release ${asset.name}`);
      release.addEventListener('click', async () => {
        const restore = busyButton(release, 'Saving');
        try {
          await api(`/api/assets/${asset.id}/release`, { method: 'POST', body: '{}' });
          setStatus(`${asset.name} released.`);
          await load();
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
        } finally {
          restore();
        }
      });
      const restrict = el('button', { type: 'button' }, `Restrict ${asset.name}`);
      restrict.addEventListener('click', async () => {
        const restore = busyButton(restrict, 'Saving');
        try {
          await api(`/api/assets/${asset.id}/restrict`, { method: 'POST', body: '{}' });
          setStatus(`${asset.name} restricted.`);
          await load();
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
        } finally {
          restore();
        }
      });
      const retire = el('button', { type: 'button' }, `Retire ${asset.name}`);
      retire.addEventListener('click', () => {
        const opener = document.activeElement as HTMLElement;
        const handle = openDialog({
          label: `Retire ${asset.name}`,
          build: (container) => {
            const successor = el('select', { 'aria-label': 'Successor' });
            for (const candidate of data.assets) {
              if (candidate.id !== asset.id && candidate.state === 'released') {
                successor.append(el('option', { value: candidate.id }, candidate.name));
              }
            }
            const confirm = el('button', { type: 'button', class: 'primary' }, 'Retire asset');
            confirm.addEventListener('click', async () => {
              const restore = busyButton(confirm, 'Saving');
              try {
                await api(`/api/assets/${asset.id}/retire`, {
                  method: 'POST',
                  body: JSON.stringify({ successorAssetId: successor.value }),
                });
                setStatus(`${asset.name} retired.`);
                handle.close();
                await load();
              } catch (err) {
                setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
              } finally {
                restore();
              }
            });
            container.append(el('label', { class: 'field' }, el('span', {}, 'Successor'), successor), confirm);
          },
          opener,
        });
      });
      const remove = (derivative: AssetAdmin['derivatives'][number]): HTMLElement => {
        const button = el('button', { type: 'button' }, `Remove ${derivative.fileName}`);
        button.addEventListener('click', async () => {
          const restore = busyButton(button, 'Saving');
          try {
            await api(`/api/derivatives/${derivative.id}`, { method: 'DELETE' });
            setStatus(`${derivative.fileName} removed.`);
            await load();
          } catch (err) {
            setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
          } finally {
            restore();
          }
        });
        return button;
      };
      const derivativeList = el('ul');
      for (const derivative of asset.derivatives) {
        derivativeList.append(
          el('li', {}, `${derivative.fileName} (${derivative.width} x ${derivative.height})`, remove(derivative)),
        );
      }
      const uploadLabel = el('input', { type: 'file', id: `upload-${asset.id}` });
      uploadLabel.setAttribute('aria-label', `Add derivative to ${asset.name}`);
      const upload = el('button', { type: 'button' }, 'Add derivative');
      upload.addEventListener('click', async () => {
        const input = document.getElementById(`upload-${asset.id}`) as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (!file) return;
        const restore = busyButton(upload, 'Uploading');
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch(`/api/assets/${asset.id}/derivatives`, { method: 'POST', body: form });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data?.message ?? 'Something went wrong.');
          }
          setStatus(`${file.name} added.`);
          await load();
        } catch (err) {
          setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
        } finally {
          restore();
        }
      });
      cell.append(release, restrict, retire, uploadLabel, upload, slot);
      body.append(
        el('tr', {},
          el('td', {}, asset.name),
          el('td', {}, asset.state),
          el('td', {}, asset.successorId ?? ''),
          el('td', {}, derivativeList),
          cell,
        ),
      );
    }
    table.append(head, body);
    root.replaceChildren(table);
  };

  await load();
  window.addEventListener('rulehouse:library-updated', () => void load());
}

export async function initAdminGrants(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('admin-root');
  if (!root) return;
  void me;

  const load = async (): Promise<void> => {
    const data = await api<{ grants: GrantDetail[] }>('/api/grants');
    const table = el('table', { class: 'data', 'aria-label': 'Grants' });
    const head = el('thead');
    head.append(
      el('tr', {},
        el('th', { scope: 'col' }, 'Grant'),
        el('th', { scope: 'col' }, 'Holder'),
        el('th', { scope: 'col' }, 'Asset'),
        el('th', { scope: 'col' }, 'Status'),
        el('th', { scope: 'col' }, 'Ends'),
        el('th', { scope: 'col' }, 'Actions'),
      ),
    );
    const body = el('tbody');
    for (const grant of data.grants) {
      const slot = el('div', { class: 'alert-slot' });
      const cell = el('td');
      const revoke = el('button', { type: 'button' }, `Revoke ${grant.id}`);
      revoke.addEventListener('click', () => {
        const opener = document.activeElement as HTMLElement;
        const handle = openDialog({
          label: `Revoke ${grant.id}`,
          build: (container) => {
            const reason = el('input', { type: 'text', 'aria-label': 'Reason' });
            const confirm = el('button', { type: 'button', class: 'primary' }, 'Revoke grant');
            confirm.addEventListener('click', async () => {
              const restore = busyButton(confirm, 'Saving');
              try {
                await api(`/api/grants/${grant.id}/revoke`, {
                  method: 'POST',
                  body: JSON.stringify({ reason: reason.value }),
                });
                setStatus(`${grant.id} revoked.`);
                handle.close();
                await load();
              } catch (err) {
                setAlert(err instanceof Error ? err.message : 'Something went wrong.', container);
              } finally {
                restore();
              }
            });
            container.append(el('label', { class: 'field' }, el('span', {}, 'Reason'), reason), confirm);
          },
          opener,
        });
      });
      cell.append(revoke, slot);
      body.append(
        el('tr', {},
          el('td', {}, grant.id),
          el('td', {}, grant.holder.displayName),
          el('td', {}, grant.cardName),
          el('td', {}, grant.statusLabel),
          el('td', {}, grant.notAfter),
          cell,
        ),
      );
    }
    table.append(head, body);
    root.replaceChildren(table);
  };

  await load();
  window.addEventListener('rulehouse:library-updated', () => void load());
  window.addEventListener('rulehouse:grant-updated', () => void load());
}

export async function initAdminAudit(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('admin-root');
  if (!root) return;
  void me;

  const requestIdInput = el('input', { type: 'text', 'aria-label': 'Request id' });
  const actionSelect = el('select', { 'aria-label': 'Action' });
  actionSelect.append(el('option', { value: '' }, 'All actions'));
  const from = el('input', { type: 'date', 'aria-label': 'From' });
  const to = el('input', { type: 'date', 'aria-label': 'To' });
  const apply = el('button', { type: 'button' }, 'Apply filters');
  const verify = el('button', { type: 'button' }, 'Verify chain');
  const chainStatus = el('p', { id: 'chain-status', role: 'status', 'aria-live': 'polite' });
  const recordsSlot = el('div');

  const cellLine = (value: Record<string, unknown> | null): string => {
    if (!value) return 'none';
    return Object.keys(value)
      .sort()
      .map((key) => `${key}: ${value[key]}`)
      .join('\n');
  };

  const load = async (): Promise<void> => {
    const params = new URLSearchParams();
    if (requestIdInput.value) params.set('requestId', requestIdInput.value);
    if (actionSelect.value) params.set('action', actionSelect.value);
    if (from.value) params.set('from', from.value);
    if (to.value) params.set('to', to.value);
    const data = await api<{ records: AuditRecord[]; actions: string[] }>(`/api/audit?${params.toString()}`);
    if (actionSelect.options.length <= 1) {
      for (const action of data.actions) {
        actionSelect.append(el('option', { value: action }, action));
      }
    }
    if (data.records.length === 0) {
      recordsSlot.replaceChildren(el('div', { class: 'empty-cell field-stone' }, el('p', {}, 'No audit records match.')));
      return;
    }
    const table = el('table', { class: 'data', 'aria-label': 'Audit log' });
    const head = el('thead');
    head.append(
      el('tr', {},
        el('th', { scope: 'col' }, 'Sequence'),
        el('th', { scope: 'col' }, 'Time'),
        el('th', { scope: 'col' }, 'Actor'),
        el('th', { scope: 'col' }, 'Action'),
        el('th', { scope: 'col' }, 'Resource'),
        el('th', { scope: 'col' }, 'Before'),
        el('th', { scope: 'col' }, 'After'),
        el('th', { scope: 'col' }, 'Outcome'),
      ),
    );
    const body = el('tbody');
    for (const record of data.records) {
      body.append(
        el('tr', {},
          el('td', {}, String(record.sequence)),
          el('td', {}, record.time),
          el('td', {}, record.actor),
          el('td', {}, record.action),
          el('td', {}, `${record.resourceType} ${record.resourceId}`),
          el('td', {}, cellLine(record.before)),
          el('td', {}, cellLine(record.after)),
          el('td', {}, record.outcome),
        ),
      );
    }
    table.append(head, body);
    recordsSlot.replaceChildren(table);
  };

  apply.addEventListener('click', () => void load());
  verify.addEventListener('click', async () => {
    const restore = busyButton(verify, 'Checking chain');
    try {
      const result = await api<{ ok: boolean; records: number; brokenAt: number | null }>('/api/audit/verify');
      chainStatus.textContent = result.ok
        ? `Chain verified: ${result.records} records.`
        : `Chain broken at record ${result.brokenAt}.`;
    } finally {
      restore();
    }
  });

  root.replaceChildren(
    el('div', { class: 'cell' },
      requestIdInput,
      actionSelect,
      from,
      to,
      apply,
      verify,
      chainStatus,
    ),
    recordsSlot,
  );
  await load();
}

export async function initAdminPeople(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('admin-root');
  if (!root) return;
  void me;

  const email = el('input', { type: 'email', 'aria-label': 'Email' });
  const displayName = el('input', { type: 'text', 'aria-label': 'Display name' });
  const role = el('select', { 'aria-label': 'Role' });
  role.append(el('option', { value: 'agency' }, 'Agency partner'), el('option', { value: 'press' }, 'Press contact'));
  const organisation = el('select', { 'aria-label': 'Organisation' });
  const slot = el('div', { class: 'alert-slot' });
  const invite = el('button', { type: 'button', class: 'primary' }, 'Invite person');

  const orgs = await api<{ organisations: { id: string; name: string }[] }>('/api/organisations').catch(() => null);
  for (const org of orgs?.organisations ?? []) {
    organisation.append(el('option', { value: org.id }, org.name));
  }

  invite.addEventListener('click', async () => {
    const restore = busyButton(invite, 'Saving');
    try {
      await api('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({
          email: email.value,
          displayName: displayName.value,
          role: role.value,
          organisationId: organisation.value,
        }),
      });
      setStatus(`Invitation queued for ${email.value}.`);
      email.value = '';
      displayName.value = '';
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });

  const orgsSlot = el('div');
  for (const org of orgs?.organisations ?? []) {
    if (org.name === 'Quenby & Co.') continue;
    const input = el('input', { type: 'date', 'aria-label': `Engagement end for ${org.name}` });
    const save = el('button', { type: 'button' }, `Save engagement end for ${org.name}`);
    const orgSlot = el('div', { class: 'alert-slot' });
    save.addEventListener('click', async () => {
      const restore = busyButton(save, 'Saving');
      try {
        await api(`/api/organisations/${org.id}/engagement`, {
          method: 'PUT',
          body: JSON.stringify({ endsOn: input.value }),
        });
        setStatus('Engagement end saved.');
      } catch (err) {
        setAlert(err instanceof Error ? err.message : 'Something went wrong.', orgSlot);
      } finally {
        restore();
      }
    });
    orgsSlot.append(el('div', {}, el('p', {}, org.name), input, save, orgSlot));
  }

  root.replaceChildren(el('div', { class: 'cell' }, email, displayName, role, organisation, invite, slot), orgsSlot);
}
