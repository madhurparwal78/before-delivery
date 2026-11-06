import { formatCount, formatTime } from '../src/format';
import { ApiFailure, api } from './api';
import { button, el, field, openDialog, replace, setStatus, statusRegion, textbox } from './dom';
import { operatorStatus } from './copy';

interface RegionRow {
  id: string;
  name: string;
  state: string;
  pending: number;
  failed: number;
  oldest_pending_ms: number | null;
}

interface WorkspaceRow {
  slug: string;
  name: string;
  plan: string;
  members: number;
  buckets: number;
  status: string;
  suspended_reason: string | null;
}

function dialogOpen(): boolean {
  return document.querySelector('.overlay') !== null;
}

export async function mountOperator(root: HTMLElement): Promise<void> {
  const status = statusRegion('Operator status');
  const regionBody = el('tbody');
  const workspaceBody = el('tbody');
  const billingBody = el('dl', { class: 'billing' });

  const page = (): string => {
    const parts = window.location.pathname.split('/').filter((part) => part !== '');
    return parts[1] ?? 'regions';
  };

  const runLifecycle = button('Run lifecycle now', {
    className: 'primary',
    focusKey: 'run-lifecycle',
    onClick: async () => {
      const result = await api.post<{ expired_versions: number; aborted_uploads: number; skipped_locked: number }>(
        '/api/ops/lifecycle/run',
      );
      setStatus(
        status,
        operatorStatus.lifecycle(result.body.expired_versions, result.body.aborted_uploads, result.body.skipped_locked),
      );
      await loadRegions();
    },
  });

  const syncBilling = button('Sync billing now', {
    className: 'primary',
    focusKey: 'sync-billing',
    onClick: async () => {
      const result = await api.post<{ posted: number; queued: number }>('/api/ops/billing/sync');
      setStatus(status, operatorStatus.sync(result.body.posted, result.body.queued));
      await loadBilling();
    },
  });

  const regionsSection = el('section', {}, [
    el('h2', { text: 'Regions' }),
    runLifecycle,
    el('table', { class: 'data', 'aria-label': 'Region backlog' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Region' }),
          el('th', { scope: 'col', text: 'State' }),
          el('th', { scope: 'col', text: 'Pending' }),
          el('th', { scope: 'col', text: 'Failed' }),
          el('th', { scope: 'col', text: 'Oldest pending' }),
          el('th', { scope: 'col', text: '' }),
        ]),
      ]),
      regionBody,
    ]),
  ]);

  const workspacesSection = el('section', {}, [
    el('h2', { text: 'Workspaces' }),
    el('table', { class: 'data', 'aria-label': 'Workspaces' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Slug' }),
          el('th', { scope: 'col', text: 'Plan' }),
          el('th', { scope: 'col', text: 'Members' }),
          el('th', { scope: 'col', text: 'Buckets' }),
          el('th', { scope: 'col', text: 'Status' }),
          el('th', { scope: 'col', text: '' }),
        ]),
      ]),
      workspaceBody,
    ]),
  ]);

  const billingSection = el('section', {}, [el('h2', { text: 'Billing' }), billingBody, syncBilling]);

  function rail(): HTMLElement {
    const links = [
      { label: 'Regions', href: '/ops' },
      { label: 'Workspaces', href: '/ops/workspaces' },
      { label: 'Billing', href: '/ops/billing' },
    ].map((entry) => {
      const link = el('a', { href: entry.href, text: entry.label, 'data-focus-key': `ops:${entry.label}` });
      if ((page() === 'regions' && entry.href === '/ops') || window.location.pathname === entry.href) {
        link.setAttribute('aria-current', 'page');
      }
      link.addEventListener('click', (event) => {
        event.preventDefault();
        window.history.pushState({}, '', entry.href);
        void render();
      });
      return link;
    });
    return el('div', { class: 'rail' }, [
      el('p', { class: 'workspace-name', text: 'Farshore operations' }),
      el('nav', { 'aria-label': 'Operator' }, links),
      el('a', { href: '/account', text: 'Account', 'data-focus-key': 'account' }),
      button('Sign out', {
        focusKey: 'sign-out',
        onClick: async () => {
          await api.delete('/api/session');
          window.location.assign('/signin');
        },
      }),
    ]);
  }

  async function loadRegions(): Promise<void> {
    const regions = (await api.get<{ regions: RegionRow[] }>('/api/ops/regions')).body.regions;
    replace(
      regionBody,
      regions.map((region) => {
        const action = button(region.state === 'online' ? `Take ${region.name} offline` : `Bring ${region.name} online`, {
          focusKey: `region:${region.id}`,
        });
        action.addEventListener('click', async () => {
          const next = region.state === 'online' ? 'offline' : 'online';
          try {
            await api.post(`/api/ops/regions/${region.id}/state`, { state: next });
            setStatus(status, operatorStatus.region(region.name, next));
          } catch (error) {
            if (error instanceof ApiFailure) setStatus(status, operatorStatus.illegalTransition);
          }
          await loadRegions();
        });
        return el('tr', {}, [
          el('td', { text: region.name }),
          el('td', { text: region.state }),
          el('td', { class: 'num mono', text: formatCount(region.pending) }),
          el('td', { class: 'num mono', text: formatCount(region.failed) }),
          el('td', {
            class: 'num mono',
            text: region.oldest_pending_ms === null ? '\u2014' : `${formatCount(region.oldest_pending_ms)} ms`,
          }),
          el('td', {}, [action]),
        ]);
      }),
    );
  }

  async function loadWorkspaces(): Promise<void> {
    const workspaces = (await api.get<{ workspaces: WorkspaceRow[] }>('/api/ops/workspaces')).body.workspaces;
    replace(
      workspaceBody,
      workspaces.map((workspace) => {
        const action = button(
          workspace.status === 'active' ? `Suspend ${workspace.name}` : `Reinstate ${workspace.name}`,
          { focusKey: `workspace:${workspace.slug}` },
        );
        action.addEventListener('click', () => {
          if (workspace.status !== 'active') {
            void (async () => {
              try {
                await api.post(`/api/ops/workspaces/${workspace.slug}/reinstate`);
                setStatus(status, operatorStatus.workspace(workspace.name, 'reinstated'));
              } catch {
                setStatus(status, operatorStatus.illegalTransition);
              }
              await loadWorkspaces();
            })();
            return;
          }
          openDialog({
            name: 'Suspend workspace',
            opener: action,
            build: (dialog) => {
              const reason = textbox('Reason');
              const suspend = button('Suspend', { className: 'primary' });
              suspend.addEventListener('click', async () => {
                try {
                  await api.post(`/api/ops/workspaces/${workspace.slug}/suspend`, { reason: reason.value });
                  setStatus(status, operatorStatus.workspace(workspace.name, 'suspended'));
                  dialog.close();
                  await loadWorkspaces();
                } catch (error) {
                  if (error instanceof ApiFailure) dialog.setStatus(error.errors.reason ?? operatorStatus.illegalTransition);
                }
              });
              dialog.body.append(
                el('h2', { text: 'Suspend workspace' }),
                field('Reason', reason),
                el('div', { class: 'dialog-actions' }, [suspend, button('Cancel', { onClick: () => dialog.close() })]),
              );
            },
          });
        });
        return el('tr', {}, [
          el('td', { text: workspace.name }),
          el('td', { text: workspace.slug }),
          el('td', { text: workspace.plan }),
          el('td', { class: 'num mono', text: formatCount(workspace.members) }),
          el('td', { class: 'num mono', text: formatCount(workspace.buckets) }),
          el('td', { text: workspace.status }),
          el('td', {}, [action]),
        ]);
      }),
    );
  }

  async function loadBilling(): Promise<void> {
    const billing = (
      await api.get<{
        state: string;
        queued_rows: number;
        posted_rows: number;
        last_attempt_at: string | null;
        last_error: string | null;
      }>('/api/ops/billing')
    ).body;
    replace(billingBody, [
      el('div', {}, [el('dt', { text: 'Queued rows' }), el('dd', { class: 'mono num', text: formatCount(billing.queued_rows) })]),
      el('div', {}, [el('dt', { text: 'Posted rows' }), el('dd', { class: 'mono num', text: formatCount(billing.posted_rows) })]),
      el('div', {}, [
        el('dt', { text: 'Last attempt' }),
        el('dd', { class: 'mono', text: billing.last_attempt_at === null ? '\u2014' : formatTime(billing.last_attempt_at) }),
      ]),
      el('div', {}, [el('dt', { text: 'Last error' }), el('dd', { text: billing.last_error ?? '\u2014' })]),
      el('div', {}, [el('dt', { text: 'State' }), el('dd', { text: billing.state })]),
    ]);
  }

  async function render(): Promise<void> {
    const current = page();
    const section = current === 'workspaces' ? workspacesSection : current === 'billing' ? billingSection : regionsSection;
    replace(root, [el('div', { class: 'shell ops' }, [rail(), el('main', { class: 'centre' }, [section, status])])]);
    if (current === 'workspaces') await loadWorkspaces();
    else if (current === 'billing') await loadBilling();
    else await loadRegions();
  }

  window.addEventListener('popstate', () => void render());
  await render();

  const tick = async (): Promise<void> => {
    if (!dialogOpen()) {
      const current = page();
      try {
        if (current === 'billing') await loadBilling();
        else if (current !== 'workspaces') await loadRegions();
      } catch {
        /* a re-read failure leaves the figures as they are */
      }
    }
    window.setTimeout(() => void tick(), 2000);
  };
  window.setTimeout(() => void tick(), 2000);
}
