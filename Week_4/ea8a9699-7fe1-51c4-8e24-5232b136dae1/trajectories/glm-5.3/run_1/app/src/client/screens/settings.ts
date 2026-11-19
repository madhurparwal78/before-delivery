// The cluster settings screen.

import type { Cluster, Comment, ReviewLinkRow, WorkspaceResponse } from '../../shared/types.js';
import { STATUS_LABELS } from '../../shared/constants.js';
import { api, announce, el, link, navigate, notFoundPage, session } from '../lib.js';
import { topBar } from '../app.js';
import { clearInvalid, errorSummary, formField, markInvalid } from './signin.js';

const REFRESH_MS = 25000;

interface StatusAction {
  label: string;
  to: string;
}

export async function renderSettings(slug: string, clusterId: string): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  if (!acc) {
    navigate(`/signin?next=${encodeURIComponent(`/w/${slug}/clusters/${clusterId}`)}`, true);
    return el('div');
  }
  const page = el('div');
  const wsRes = await api<WorkspaceResponse>('GET', `/api/workspaces/${slug}`);
  if (!wsRes.ok) return notFoundPage();
  const workspace = wsRes.data!;

  const load = async () => api<Cluster>('GET', `/api/clusters/${clusterId}`);
  const first = await load();
  if (!first.ok) return notFoundPage();
  const wasJustCreated = window.sessionStorage.getItem('rushes.createdCluster') === clusterId;
  if (wasJustCreated) {
    window.sessionStorage.removeItem('rushes.createdCluster');
  }

  page.append(topBar({ account: acc, currentSlug: slug }));

  const main = el('main', { class: 'two-col' });
  const left = el('section', { class: 'stack', 'aria-label': 'Cluster details' });
  const right = el('section', { class: 'stack', 'aria-label': 'Review and comments' });

  // --- Cluster shape ---------------------------------------------------
  let cluster = first.data!;
  const status = clusterStatusHeader();
  const detailsForm = el('form', { novalidate: true, class: 'panel' }) as HTMLFormElement;
  const titleInput = el('input', { type: 'text', id: 'set-title' }) as HTMLInputElement;
  titleInput.setAttribute('aria-label', 'Title');
  const publicDesc = el('textarea', { id: 'set-public' }) as HTMLTextAreaElement;
  publicDesc.setAttribute('aria-label', 'Public description');
  const internalNote = el('textarea', { id: 'set-note' }) as HTMLTextAreaElement;
  internalNote.setAttribute('aria-label', 'Internal note');
  const saveDetails = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save details') as HTMLButtonElement;
  saveDetails.setAttribute('aria-label', 'Save details');
  detailsForm.append(
    formField('Title', titleInput),
    formField('Public description', publicDesc),
    formField('Internal note', internalNote),
    el('div', {}, saveDetails),
  );

  // Typed text that a refresh must never discard.
  const typed = { title: '', publicDescription: '', internalNote: '', comment: '' };
  function syncFieldsFromCluster(): void {
    if (document.activeElement !== titleInput && !typed.title) titleInput.value = cluster.title;
    if (document.activeElement !== publicDesc && !typed.publicDescription) publicDesc.value = cluster.publicDescription;
    if (document.activeElement !== internalNote && !typed.internalNote) internalNote.value = cluster.internalNote;
  }
  titleInput.addEventListener('input', () => { typed.title = titleInput.value; });
  publicDesc.addEventListener('input', () => { typed.publicDescription = publicDesc.value; });
  internalNote.addEventListener('input', () => { typed.internalNote = internalNote.value; });

  detailsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(detailsForm);
    saveDetails.disabled = true;
    const patch: Record<string, string> = {};
    if (typed.title || titleInput.value !== cluster.title) patch.title = titleInput.value;
    if (typed.publicDescription || publicDesc.value !== cluster.publicDescription) patch.publicDescription = publicDesc.value;
    if (typed.internalNote || internalNote.value !== cluster.internalNote) patch.internalNote = internalNote.value;
    const r = await api<Cluster>('PATCH', `/api/clusters/${clusterId}`, patch);
    saveDetails.disabled = false;
    if (r.ok && r.data) {
      cluster = r.data;
      typed.title = ''; typed.publicDescription = ''; typed.internalNote = '';
      syncFieldsFromCluster();
      announce('cluster-status', 'Details saved.');
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      detailsForm.prepend(errorSummary(errors, { title: 'set-title', publicDescription: 'set-public', internalNote: 'set-note' }));
      document.getElementById('error-summary')?.focus();
      for (const [field, message] of Object.entries(errors)) {
        if (field === 'title') markInvalid(titleInput, message);
        if (field === 'publicDescription') markInvalid(publicDesc, message);
        if (field === 'internalNote') markInvalid(internalNote, message);
      }
    } else if (r.error?.error === 'cluster_locked') {
      announce('cluster-status', `This cluster is locked while ${STATUS_LABELS[cluster.status]}.`);
    }
  });

  const entriesList = el('ul', { class: 'stack' }) as HTMLUListElement;

  // Status actions + embargo form
  const statusPanel = el('section', { class: 'panel stack' });
  const actionsRow = el('div', { class: 'row', role: 'group', 'aria-label': 'Status actions' });
  const embargoForm = el('form', { class: 'stack', hidden: true, novalidate: true }) as HTMLFormElement;
  const liftDate = el('input', { type: 'date', id: 'lift-date' }) as HTMLInputElement;
  liftDate.setAttribute('aria-label', 'Lift date');
  const liftTime = el('input', { type: 'time', id: 'lift-time' }) as HTMLInputElement;
  liftTime.setAttribute('aria-label', 'Lift time');
  const setEmbargo = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Set embargo') as HTMLButtonElement;
  const embargoSummary = el('p', { class: 'muted small mono' });
  embargoForm.append(
    el('div', { class: 'row' }, formField('Lift date', liftDate), formField('Lift time', liftTime)),
    el('p', { class: 'muted small' }, `Times are in ${workspace.timeZone}`),
    el('div', {}, setEmbargo),
    embargoSummary,
  );
  statusPanel.append(status, actionsRow, embargoForm);

  // Withdraw dialog
  const withdrawDialog = el('dialog', { class: 'dialog', 'aria-label': 'Withdraw cluster' }) as HTMLDialogElement;
  withdrawDialog.append(
    el('h2', {}, 'Withdraw cluster'),
    el('p', {}, 'Withdrawing removes the public page and feed entry now.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-primary', id: 'withdraw-confirm' }, 'Withdraw'),
      el('button', { class: 'btn btn-ghost', id: 'withdraw-cancel' }, 'Cancel'),
    ),
  );
  const withdrawBtnHolder = { btn: null as HTMLButtonElement | null };
  document.body.append(withdrawDialog);

  // --- Review links -----------------------------------------------------
  const linksPanel = el('section', { class: 'panel stack', 'aria-label': 'Review links' });
  const linkForm = el('form', { class: 'stack', novalidate: true }) as HTMLFormElement;
  const freelancerEmail = el('input', { type: 'email', id: 'rl-email' }) as HTMLInputElement;
  freelancerEmail.setAttribute('aria-label', 'Freelancer email');
  const expires = el('input', { type: 'datetime-local', id: 'rl-expires', step: '60' }) as HTMLInputElement;
  expires.setAttribute('aria-label', 'Expires');
  const allowComments = el('input', { type: 'checkbox', id: 'rl-comments' }) as HTMLInputElement;
  const createLink = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Create review link') as HTMLButtonElement;
  createLink.setAttribute('aria-label', 'Create review link');
  linkForm.append(
    formField('Freelancer email', freelancerEmail),
    formField('Expires', expires),
    el('label', { for: 'rl-comments', class: 'row' }, allowComments, el('span', {}, 'Allow comments')),
    el('div', {}, createLink),
    el('p', { class: 'muted small' }, 'Expiry times are in UTC'),
  );
  const linksList = el('ul', { class: 'stack' }) as HTMLUListElement;
  linksPanel.append(el('h3', {}, 'Review links'), linkForm, linksList);

  // --- Comments -----------------------------------------------------------
  const commentsPanel = el('section', { class: 'panel stack', 'aria-label': 'Comments' });
  const commentList = el('ul', { class: 'stack' }) as HTMLUListElement;
  const commentForm = el('form', { class: 'stack', novalidate: true }) as HTMLFormElement;
  const commentBox = el('textarea', { id: 'cluster-comment' }) as HTMLTextAreaElement;
  commentBox.setAttribute('aria-label', 'Comment');
  const postComment = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Post comment') as HTMLButtonElement;
  postComment.setAttribute('aria-label', 'Post comment');
  commentForm.append(formField('Comment', commentBox), el('div', {}, postComment));
  commentsPanel.append(el('h3', {}, 'Comments'), commentList, commentForm);

  const downloadLink = el('a', { href: `/api/clusters/${clusterId}/export.csv`, class: 'btn btn-ghost', download: '' }, 'Download cluster sheet');
  downloadLink.setAttribute('aria-label', 'Download cluster sheet');

  left.append(detailsForm, statusPanel, el('section', { class: 'panel stack' }, el('h3', {}, 'Entries'), entriesList), downloadLink);
  right.append(linksPanel, commentsPanel);
  main.append(left, right);
  page.append(main);

  const statusLive = el('div', { id: 'cluster-status', role: 'status', class: 'visually-hidden' });
  statusLive.setAttribute('aria-live', 'polite');
  document.body.append(statusLive);

  // --- Render from the cluster ---------------------------------------
  function statusActionsFor(c: Cluster): StatusAction[] {
    const acts: StatusAction[] = [];
    if (c.status === 'draft') acts.push({ label: 'Send to review', to: 'in_review' });
    if (c.status === 'in_review') {
      acts.push({ label: 'Back to draft', to: 'draft' });
      acts.push({ label: 'Schedule embargo', to: 'embargoed' });
    }
    if (c.status === 'embargoed') acts.push({ label: 'Cancel embargo', to: 'in_review' });
    if (c.status === 'public') acts.push({ label: 'Withdraw cluster', to: 'withdrawn' });
    return acts;
  }

  function clusterStatusHeader(): HTMLElement {
    const wrap = el('div', { class: 'spread' });
    const label = el('span', { class: 'status-label', id: 'cluster-status-label', tabindex: '-1', role: 'status' });
    const icons: Record<string, string> = {
      draft: 'icon-pencil',
      in_review: 'icon-eye',
      embargoed: 'icon-clock',
      public: 'icon-globe',
      withdrawn: 'icon-archived',
    };
    label.setAttribute('aria-label', 'Status');
    wrap.append(label, el('span', { class: 'visually-hidden' }, 'Saving'));
    return wrap;
  }

  function renderStatus(showing: string, saving = false): void {
    const label = status.querySelector('#cluster-status-label') as HTMLElement;
    label.replaceChildren();
    const icons: Record<string, string> = {
      draft: 'icon-pencil',
      in_review: 'icon-eye',
      embargoed: 'icon-clock',
      public: 'icon-globe',
      withdrawn: 'icon-archived',
    };
    label.append(el('span', { class: `icon ${icons[showing] ?? ''}`, 'aria-hidden': 'true' }), STATUS_LABELS[showing] ?? showing);
    if (saving) label.append(el('span', { class: 'saving-tag' }, 'Saving'));
  }

  let lastRenderedStatus = '';
  function renderActions(c: Cluster): void {
    // A refresh only re-renders the buttons when the status changed, so a click
    // in flight is never lost to a re-render.
    if (c.status === lastRenderedStatus && actionsRow.childElementCount > 0) {
      return;
    }
    lastRenderedStatus = c.status;
    actionsRow.replaceChildren();
    const acts = statusActionsFor(c);
    for (const act of acts) {
      const btn = el('button', { class: 'btn', type: 'button' }, act.label);
      if (act.to === 'embargoed') {
        btn.addEventListener('click', () => {
          embargoForm.hidden = false;
          liftDate.focus();
        });
      } else if (act.to === 'withdrawn') {
        btn.addEventListener('click', () => {
          withdrawBtnHolder.btn = btn;
          withdrawDialog.showModal();
        });
        btn.setAttribute('aria-label', 'Withdraw cluster');
      } else {
        btn.addEventListener('click', () => void doStatusAction(act.to, act.label, btn, null));
      }
      actionsRow.append(btn);
    }
  }

  async function doStatusAction(to: string, label: string, btn: HTMLButtonElement | null, extra: Record<string, unknown> | null): Promise<void> {
    const before = cluster.status;
    renderStatus(to, true);
    if (btn) btn.disabled = true;
    const body = { status: to, ...(extra ?? {}) };
    const r = await api<Cluster>('POST', `/api/clusters/${clusterId}/status`, body);
    if (btn) btn.disabled = false;
    if (r.ok && r.data) {
      cluster = r.data;
      renderAll();
      if (to === 'in_review') {
        if (before === 'embargoed') announce('cluster-status', 'Embargo cancelled. Back in review.');
        else announce('cluster-status', 'Sent to review.');
      } else if (to === 'draft') {
        announce('cluster-status', 'Back to draft. Review links are no longer active.');
      } else if (to === 'embargoed') {
        announce('cluster-status', `Embargo set. Goes public at ${cluster.liftLocal!.replace('T', ' ')} ${workspace.timeZone}.`);
      } else if (to === 'withdrawn') {
        announce('cluster-status', 'Withdrawn. The public page is gone.');
      }
      focusStatus();
      return;
    }
    const err = r.error;
    if (err?.error === 'illegal_transition') {
      cluster = { ...cluster, status: err.from ?? before };
      renderAll();
      announce('cluster-status', `This cluster is now ${STATUS_LABELS[err.from ?? before]}. Refresh to see its current state.`);
      focusStatus();
      return;
    }
    if (err?.error === 'validation') {
      const errors = err.errors ?? {};
      const form = to === 'embargoed' ? embargoForm : detailsForm;
      form.prepend(errorSummary(errors, { liftLocal: 'lift-date', liftTime: 'lift-time' }));
      document.getElementById('error-summary')?.focus();
      if (errors.liftLocal) {
        markInvalid(liftDate, errors.liftLocal);
        markInvalid(liftTime, errors.liftLocal);
      }
      renderStatus(before);
      return;
    }
    renderStatus(before);
    renderAll();
    announce('cluster-status', 'The status change could not be saved. Try again.');
    focusStatus();
  }

  function focusStatus(): void {
    status.querySelector('#cluster-status-label')?.setAttribute('tabindex', '-1');
    (status.querySelector('#cluster-status-label') as HTMLElement).focus();
  }

  let lastEntriesKey = '';
  function renderEntries(c: Cluster): void {
    const key = c.entries.map((e) => `${e.id}:${e.isPrivate ? 1 : 0}`).join('|') + `#${c.version}`;
    if (key === lastEntriesKey) return;
    lastEntriesKey = key;
    entriesList.replaceChildren();
    c.entries.forEach((entry) => {
      const li = el('li', { class: 'tray-item' });
      const slot = el('span', { class: 'tray-slot mono' }, String(entry.position));
      const thumb = entry.reference.kind === 'clip'
        ? el('span', { class: 'tray-thumb' }, '▶')
        : el('img', { class: 'tray-thumb', src: entry.reference.mediaUrl, alt: '' });
      const title = el('div', { class: 'tray-item-title' }, entry.reference.title);
      if (entry.reference.kind === 'still' && entry.reference.sourceClipTitle) {
        title.append(el('div', { class: 'tray-item-sub' }, `${entry.reference.sourceClipTitle} · ${entry.reference.timecode}`));
      }
      const check = el('input', { type: 'checkbox', id: `private-${entry.id}` }) as HTMLInputElement;
      check.checked = entry.isPrivate;
      check.setAttribute('aria-label', `Keep ${entry.reference.title} private`);
      check.addEventListener('change', async () => {
        const rr = await api<{ entry: unknown; itemCount: number; version: number }>(
          'PATCH',
          `/api/clusters/${clusterId}/entries/${entry.id}`,
          { isPrivate: check.checked },
        );
        if (rr.ok) {
          announce('cluster-status', check.checked ? 'Entry is private.' : 'Entry is public.');
          void refresh();
        } else if (rr.error?.error === 'cluster_locked') {
          announce('cluster-status', `This cluster is locked while ${STATUS_LABELS[cluster.status]}.`);
          check.checked = !check.checked;
        } else {
          check.checked = !check.checked;
        }
      });
      li.append(slot, thumb, title, el('label', { class: 'row small', for: `private-${entry.id}` }, check, el('span', {}, 'Private')));
      entriesList.append(li);
    });
  }

  function renderLinks(c: Cluster): Promise<void> {
    return api<{ links: ReviewLinkRow[] }>('GET', `/api/clusters/${clusterId}/review-links`).then((r) => {
      if (!r.ok) return;
      linksList.replaceChildren();
      for (const l of r.data!.links) {
        const li = el('li', { class: 'tray-item' });
        li.append(
          el('div', { class: 'tray-item-title' }, l.email),
          el('span', { class: 'state-tag' }, el('span', { class: 'icon icon-clock', 'aria-hidden': 'true' }), l.state === 'live' ? 'Live' : l.state === 'expired' ? 'Expired' : l.state === 'revoked' ? 'Revoked' : 'Inactive'),
        );
        const revoke = el('button', { class: 'btn small' }, 'Revoke');
        revoke.setAttribute('aria-label', `Revoke link for ${l.email}`);
        revoke.addEventListener('click', async () => {
          const rr = await api('DELETE', `/api/review-links/${l.id}`);
          if (rr.ok) {
            announce('cluster-status', `Link for ${l.email} revoked.`);
            void refresh();
          }
        });
        li.append(revoke);
        if (l.state === 'live') {
          const regen = el('button', { class: 'btn small' }, 'Regenerate');
          regen.setAttribute('aria-label', `Regenerate link for ${l.email}`);
          regen.addEventListener('click', async () => {
            const rr = await api('POST', `/api/review-links/${l.id}/regenerate`);
            if (rr.ok) {
              announce('cluster-status', `New link sent to ${l.email}. The old link no longer works.`);
              void refresh();
            } else if (rr.error?.error === 'mail_unavailable') {
              announce('cluster-status', 'The new link could not be sent. The current link still works.');
            }
          });
          li.append(regen);
        }
        linksList.append(li);
      }
    });
  }

  async function renderComments(): Promise<void> {
    const r = await api<{ comments: Comment[] }>('GET', `/api/clusters/${clusterId}/comments`);
    if (!r.ok) return;
    commentList.replaceChildren();
    for (const c of r.data!.comments) {
      const li = el('li', { class: 'panel' });
      li.append(el('div', { class: 'spread' }, el('strong', {}, c.authorName), el('span', { class: 'muted small mono' }, c.createdAt.replace('T', ' ').slice(0, 16))));
      li.append(el('p', { class: 'mt' }, c.body));
      commentList.append(li);
    }
  }

  function renderEmbargoSummary(): void {
    if (cluster.status === 'embargoed' && cluster.liftLocal && cluster.liftsAt) {
      embargoSummary.textContent = `Goes public at ${cluster.liftLocal.replace('T', ' ')} ${workspace.timeZone} (${cluster.liftsAt.replace('T', ' ').slice(0, 16)} UTC)`;
      embargoForm.hidden = false;
    } else if (cluster.status === 'public' && cluster.liftLocal && cluster.liftsAt) {
      embargoSummary.textContent = `Goes public at ${cluster.liftLocal.replace('T', ' ')} ${workspace.timeZone} (${cluster.liftsAt.replace('T', ' ').slice(0, 16)} UTC)`;
    } else {
      embargoSummary.textContent = '';
    }
  }

  function renderAll(): void {
    renderStatus(cluster.status);
    renderActions(cluster);
    renderEntries(cluster);
    renderEmbargoSummary();
    syncFieldsFromCluster();
    void renderLinks(cluster);
  }

  embargoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(embargoForm);
    const liftLocal = `${liftDate.value}T${liftTime.value}`;
    await doStatusAction('embargoed', 'Schedule embargo', null, { liftLocal });
  });

  (withdrawDialog.querySelector('#withdraw-confirm') as HTMLButtonElement).addEventListener('click', async () => {
    withdrawDialog.close();
    await doStatusAction('withdrawn', 'Withdraw cluster', null, null);
  });
  (withdrawDialog.querySelector('#withdraw-cancel') as HTMLButtonElement).addEventListener('click', () => {
    withdrawDialog.close();
    withdrawBtnHolder.btn?.focus();
  });
  withdrawDialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    withdrawDialog.close();
    withdrawBtnHolder.btn?.focus();
  });

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(linkForm);
    createLink.disabled = true;
    // datetime-local gives local wall-clock; the brief reads it as UTC.
    const raw = expires.value; // "YYYY-MM-DDTHH:MM"
    const expiresAt = raw ? `${raw}:00.000Z` : '';
    const r = await api<{ id: string; email: string; url: string }>('POST', `/api/clusters/${clusterId}/review-links`, {
      email: freelancerEmail.value,
      expiresAt,
      canComment: allowComments.checked,
    });
    createLink.disabled = false;
    if (r.ok && r.data) {
      announce('cluster-status', `Review link sent to ${r.data.email}.`);
      freelancerEmail.value = '';
      void refresh();
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      linkForm.prepend(errorSummary(errors, { email: 'rl-email', expiresAt: 'rl-expires' }));
      document.getElementById('error-summary')?.focus();
      if (errors.email) markInvalid(freelancerEmail, errors.email);
      if (errors.expiresAt) markInvalid(expires, errors.expiresAt);
    } else if (r.error?.error === 'mail_unavailable') {
      announce('cluster-status', 'The review email could not be sent. No link was created.');
    } else if (r.error?.error === 'cluster_not_in_review') {
      announce('cluster-status', 'Review links need a cluster in review.');
    }
  });

  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearInvalid(commentForm);
    postComment.disabled = true;
    const r = await api<Comment>('POST', `/api/clusters/${clusterId}/comments`, { body: commentBox.value });
    postComment.disabled = false;
    if (r.ok && r.data) {
      typed.comment = '';
      commentBox.value = '';
      announce('cluster-status', 'Comment posted.');
      await renderComments();
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      commentForm.prepend(errorSummary(errors, { body: 'cluster-comment' }));
      document.getElementById('error-summary')?.focus();
      if (errors.body) markInvalid(commentBox, errors.body);
    }
  });

  // The refresh: only the listed things change; typed text and open dialogs stay.
  let refreshTimer: number | undefined;
  async function refresh(): Promise<void> {
    const r = await load();
    if (!r.ok) return;
    cluster = r.data!;
    renderStatus(cluster.status);
    renderActions(cluster);
    renderEntries(cluster);
    renderEmbargoSummary();
    syncFieldsFromCluster();
    await renderLinks(cluster);
  }
  function scheduleRefresh(): void {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
  }
  scheduleRefresh();
  renderAll();
  await renderComments();
  if (wasJustCreated) {
    announce('cluster-status', `Created ${cluster.title} as a draft.`);
  }

  return page;
}
