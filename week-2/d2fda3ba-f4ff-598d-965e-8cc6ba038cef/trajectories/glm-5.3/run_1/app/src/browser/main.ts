import { save, get } from './store';
import { queueRevision } from './apiHelpers';
import {
  me, signIn, signUp, signOut, listDevices, billing, addSubscription, cancelSubscription,
  listVaults, createVault, vaultInfo, invite, acceptInvite, approveDevice,
  listDossiers, createDossier, publishDossier, unpublishDossier, reopenDossier,
  createPreviewLink, revokePreviewLink, opsAccounts, opsSweep, HttpError, newNoteObject,
  candidatesFor, noteToCandidate, pullRevisions, blob, decryptBlob,
} from './api';
import { createVaultKey, unwrapVaultKey, rawKeyToString } from './crypto';
import { sampleCase } from './sample';
import { countsAt } from './ui/ring';
import icons from './icons.json';
import {
  $, el, fmt, session, nb, state, ctx, ring, wb, notesOf, setNotes,
  setBadge, flushQueue, pullOnce, render, renderTopbar, renderRail, renderNote, renderContext,
  renderPublish, setRingRadius, openDialog, closeDialog,
} from './app';

// ---------- session loading ----------

const loadSession = async (): Promise<void> => {
  try {
    const res = await me();
    session.account = res.account;
    session.device = res.device;
    const v = await listVaults();
    session.vaults = v.vaults;
    try {
      const b = await billing();
      session.sync = b.sync;
      session.publish = b.publish;
    } catch {
      // billing unavailable: keep the last known plan
    }
    try {
      const d = await listDossiers();
      session.dossiers = d.dossiers;
    } catch {
      session.dossiers = [];
    }
    for (const vault of session.vaults) {
      if (get().vaultKeyRaw[vault.id]) session.unlockedVaults.add(vault.id);
    }
    if (!res.device.approved) startApprovalPolling();
    if (nb.current.kind === 'local' && get().localNotes.length === 0) {
      const locked = session.vaults.find((vv) => !session.unlockedVaults.has(vv.id));
      const unlocked = session.vaults.find((vv) => session.unlockedVaults.has(vv.id));
      if (locked) openUnlockDialog();
      else if (unlocked) nb.current = { kind: 'vault', vaultId: unlocked.id };
    }
  } catch {
    session.account = null;
    session.device = null;
  }
};

let approvalPoll: ReturnType<typeof setInterval> | undefined;
const startApprovalPolling = (): void => {
  if (approvalPoll) return;
  approvalPoll = setInterval(async () => {
    try {
      const res = await me();
      session.device = res.device;
      if (res.device.approved) {
        if (approvalPoll) clearInterval(approvalPoll);
        approvalPoll = undefined;
        renderTopbar();
        const locked = session.vaults.find((v) => !session.unlockedVaults.has(v.id));
        if (locked) openUnlockDialog();
        else void pullOnce();
      }
    } catch {
      // keep polling
    }
  }, 5000);
};

const openUnlockDialog = (): void => {
  const vault = session.vaults.find((v) => !session.unlockedVaults.has(v.id));
  if (!vault) return;
  $('#unlock-vault-name').textContent = vault.name;
  ($('#unlock-passphrase') as HTMLInputElement).value = '';
  openDialog('unlock-dialog', $('#account-btn'));
};

const doUnlock = async (): Promise<void> => {
  const status = $('#vault-status');
  const vault = session.vaults.find((v) => !session.unlockedVaults.has(v.id));
  if (!vault) return;
  const pass = ($('#unlock-passphrase') as HTMLInputElement).value;
  try {
    const info = await vaultInfo(vault.id);
    const key = await unwrapVaultKey(pass, info.key_envelope);
    if (!key) {
      status.textContent = "That passphrase doesn't unlock this vault.";
      return;
    }
    const raw = await rawKeyToString(key);
    save({ vaultKeyRaw: { ...get().vaultKeyRaw, [vault.id]: raw }, vaultPassOk: { ...get().vaultPassOk, [vault.id]: true } });
    session.unlockedVaults.add(vault.id);
    status.textContent = '';
    closeDialog('unlock-dialog');
    nb.current = { kind: 'vault', vaultId: vault.id };
    await pullFull(vault.id);
    render();
    void flushQueue();
  } catch (e) {
    status.textContent = e instanceof HttpError && e.code === 'device_not_approved'
      ? 'Waiting for device approval — check your email'
      : "That passphrase doesn't unlock this vault.";
  }
};

/** Pull every revision of a vault and decrypt the notes into the notebook. */
const pullFull = async (vaultId: string): Promise<void> => {
  const raw = get().vaultKeyRaw[vaultId];
  if (!raw) return;
  const res = await pullRevisions(vaultId, 0, 500).catch(() => null);
  if (!res) return;
  const notes = [...(get().notebooks[vaultId] ?? [])];
  for (const rev of res.revisions) {
    try {
      const bytes = await blob(vaultId, rev.rev);
      const plain = await decryptBlob(raw, bytes);
      if (!plain) continue;
      const idx = notes.findIndex((n) => n.id === rev.note_id);
      const queued = get().queue.find((q) => q.noteId === rev.note_id);
      if (idx >= 0) {
        if (!queued) notes[idx] = { ...plain, id: rev.note_id, createdAt: notes[idx].createdAt };
      } else {
        notes.push({ ...plain, id: rev.note_id, createdAt: Date.now() });
      }
      setBadge(rev.note_id, 'synced');
    } catch {
      // the next pull retries
    }
  }
  save({ notebooks: { ...get().notebooks, [vaultId]: notes } });
};

// ---------- account dialog ----------

const showAccountError = (fields: Record<string, string> | undefined, message: string | null): void => {
  const alert = $('#account-alert');
  alert.textContent = message ?? '';
  alert.hidden = !message;
  document.querySelectorAll('#account-dialog [data-field]').forEach((n) => n.remove());
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      const input = document.querySelector(`#account-dialog [name="${k}"]`);
      if (input) input.insertAdjacentElement('afterend', el('div', { class: 'field-error', 'data-field': k }, v));
    }
  }
};

const refreshAccountDialog = async (): Promise<void> => {
  const status = $('#account-status');
  const signedOut = $('#signed-out');
  const signedIn = $('#signed-in');
  if (!session.account) {
    signedOut.hidden = false;
    signedIn.hidden = true;
    status.textContent = '';
    return;
  }
  signedOut.hidden = true;
  signedIn.hidden = false;
  status.textContent = `Signed in as ${session.account.email}`;
  const plans = $('#plan-status');
  try {
    const b = await billing();
    session.sync = b.sync;
    session.publish = b.publish;
    const syncLine = b.sync.state === 'active' ? 'Sync active' : b.sync.period_end ? `Sync ends ${fmt(b.sync.period_end)}` : `Sync ${b.sync.state}`;
    const pubLine = b.publish.state === 'active' ? 'Publish active' : b.publish.period_end ? `Publish ends ${fmt(b.publish.period_end)}` : `Publish ${b.publish.state}`;
    plans.textContent = `${syncLine} · ${pubLine}`;
  } catch {
    plans.textContent = "Billing is unavailable. Your plan hasn't changed — try again shortly.";
  }
  const devicesList = $('#devices-list');
  devicesList.textContent = '';
  try {
    const d = await listDevices();
    for (const dev of d.devices) {
      devicesList.appendChild(el('li', {}, `${dev.name} — ${dev.approved ? 'approved' : 'waiting for approval'}`));
    }
  } catch {
    // keep the list as it is
  }
};

const doSignIn = async (): Promise<void> => {
  const status = $('#account-status');
  status.textContent = 'Signing in…';
  const email = ($('#signin-email') as HTMLInputElement).value;
  const password = ($('#signin-password') as HTMLInputElement).value;
  const deviceName = ($('#signin-device-name') as HTMLInputElement).value || guessDeviceName();
  try {
    const res = await signIn(email, password, deviceName, get().deviceId);
    save({ deviceId: res.device.id, deviceName });
    session.account = res.account;
    session.device = res.device;
    status.textContent = `Signed in as ${res.account.email}`;
    showAccountError(undefined, null);
    await loadSession();
    render();
    if (!res.device.approved) startApprovalPolling();
  } catch (e) {
    status.textContent = '';
    const code = e instanceof HttpError ? e.code : undefined;
    showAccountError(e instanceof HttpError ? e.fields : undefined,
      code === 'invalid_credentials' ? 'Wrong email or password.' : (e as Error).message ?? 'Sign in failed.');
  }
};

const doSignUp = async (): Promise<void> => {
  const status = $('#account-status');
  status.textContent = 'Creating account…';
  const email = ($('#signup-email') as HTMLInputElement).value;
  const password = ($('#signup-password') as HTMLInputElement).value;
  const displayName = ($('#signup-display-name') as HTMLInputElement).value;
  const deviceName = ($('#signup-device-name') as HTMLInputElement).value || guessDeviceName();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    const res = await signUp(email, password, displayName, timeZone, deviceName);
    save({ deviceId: res.device.id, deviceName });
    session.account = res.account;
    session.device = res.device;
    status.textContent = 'Account created — this browser is your first device.';
    showAccountError(undefined, null);
    await loadSession();
    render();
  } catch (e) {
    status.textContent = '';
    const err = e as HttpError;
    showAccountError(err.fields, err.message ?? 'Sign up failed.');
  }
};

const doSignOut = async (): Promise<void> => {
  try { await signOut(); } catch { /* sign out locally regardless */ }
  session.account = null;
  session.device = null;
  session.vaults = [];
  session.sync = null;
  session.publish = null;
  session.dossiers = [];
  session.unlockedVaults.clear();
  nb.current = { kind: 'local' };
  $('#account-status').textContent = '';
  closeDialog('account-dialog');
  render();
};

const doPlan = async (addon: 'sync' | 'publish', subscribe: boolean): Promise<void> => {
  const plans = $('#plan-status');
  plans.textContent = 'Updating plan…';
  try {
    const b = subscribe ? await addSubscription(addon) : await cancelSubscription(addon);
    session.sync = b.sync;
    session.publish = b.publish;
    const a = addon === 'sync' ? b.sync : b.publish;
    const label = addon === 'sync' ? 'Sync' : 'Publish';
    plans.textContent = a.state === 'active' ? `${label} active`
      : a.state === 'ending' && a.period_end ? `${label} ends ${fmt(a.period_end)}`
      : `${label} ${a.state}`;
  } catch (e) {
    const code = e instanceof HttpError ? e.code : '';
    plans.textContent = code === 'billing_unavailable'
      ? "Billing is unavailable. Your plan hasn't changed — try again shortly."
      : (e as Error).message ?? 'Updating plan failed.';
  }
};

const doCreateVault = async (): Promise<void> => {
  const status = $('#vault-status');
  const pass = ($('#vault-pass') as HTMLInputElement).value;
  const confirm = ($('#vault-pass-confirm') as HTMLInputElement).value;
  const name = ($('#vault-name') as HTMLInputElement).value || 'Case vault';
  if (pass.length < 12 || pass !== confirm) {
    status.textContent = "That passphrase doesn't unlock this vault.";
    return;
  }
  status.textContent = 'Creating vault…';
  try {
    const { envelope, rawKey } = await createVaultKey(pass);
    const res = await createVault(name, envelope);
    save({
      vaultKeyRaw: { ...get().vaultKeyRaw, [res.vault.id]: rawKey },
      vaultPassOk: { ...get().vaultPassOk, [res.vault.id]: true },
    });
    session.unlockedVaults.add(res.vault.id);
    const current = get().localNotes;
    nb.current = { kind: 'vault', vaultId: res.vault.id };
    save({ notebooks: { ...get().notebooks, [res.vault.id]: current }, localNotes: [] });
    for (const note of current) {
      setBadge(note.id, 'pending');
      queueRevision(note.id, null, JSON.stringify(note));
    }
    status.textContent = 'Vault created — this notebook now syncs';
    closeDialog('vault-dialog');
    render();
    void flushQueue();
  } catch (e) {
    const err = e as HttpError;
    status.textContent = err.message ?? 'Creating vault failed.';
  }
};

const doSendInvite = async (): Promise<void> => {
  const status = $('#vault-status');
  if (nb.current.kind !== 'vault') return;
  const vaultId = (nb.current as { vaultId: string }).vaultId;
  const email = ($('#partner-email') as HTMLInputElement).value;
  status.textContent = 'Creating vault…';
  try {
    await invite(vaultId, email);
    status.textContent = `Invite created — an email is on its way to ${email}`;
    closeDialog('invite-dialog');
  } catch (e) {
    status.textContent = (e as Error).message ?? 'Invite failed.';
  }
};

const guessDeviceName = (): string => {
  const ua = navigator.userAgent;
  if (/iphone|android.*mobile/i.test(ua)) return 'Phone';
  if (/ipad|tablet/i.test(ua)) return 'Tablet';
  return 'Laptop';
};

// ---------- publishing actions ----------

const slugify = (title: string): string => {
  const s = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'dossier').slice(0, 48);
};

const publishBody = (): { radius: number; notes: unknown[] } | null => {
  const d = wb.dossier;
  if (!d) return null;
  const cands = candidatesFor(notesOf(), d.root_note_id);
  return { radius: ring.radius, notes: cands.map(noteToCandidate) };
};

const doCreateDossier = async (forOpenNote: boolean): Promise<void> => {
  const status = $('#publish-status');
  const addr = $('#dossier-address') as HTMLInputElement;
  const slug = forOpenNote
    ? (addr.value || slugify(notesOf().find((n) => n.id === get().openNoteId)?.title ?? 'dossier'))
    : addr.value;
  const rootNoteId = forOpenNote ? get().openNoteId : wb.dossier?.root_note_id ?? get().openNoteId;
  if (!rootNoteId) return;
  status.textContent = 'Publishing…';
  try {
    const res = await createDossier(slug, rootNoteId);
    session.dossiers.push(res.dossier);
    wb.dossier = res.dossier;
    status.textContent = '';
    renderContext();
    void renderPublish();
  } catch (e) {
    const err = e as HttpError;
    status.textContent = err.code === 'publish_not_entitled'
      ? 'Publishing needs the Publish add-on.'
      : err.code === 'billing_unavailable'
        ? "Billing is unavailable. Your plan hasn't changed — try again shortly."
        : err.message ?? 'Creating the dossier failed.';
  }
};

const doPublish = async (): Promise<void> => {
  const status = $('#publish-status');
  const d = wb.dossier;
  const body = publishBody();
  if (!d || !body) return;
  status.textContent = 'Publishing…';
  try {
    const res = await publishDossier(d.id, body.radius, body.notes);
    session.dossiers = session.dossiers.map((x) => (x.id === res.dossier.id ? res.dossier : x));
    wb.dossier = res.dossier;
    const counts = countsAt(candidatesFor(notesOf(), d.root_note_id), ring.radius);
    status.textContent = `Published ${counts.public_count} notes · ${counts.severed_count} links severed`;
    renderContext();
    void renderPublish();
  } catch (e) {
    const err = e as HttpError;
    if (err.code === 'storage_unavailable') status.textContent = "Publish paused: storage unavailable. The live dossier hasn't changed.";
    else if (err.code === 'publish_not_entitled') status.textContent = 'Publishing needs the Publish add-on.';
    else if (err.code === 'publish_in_progress') status.textContent = 'Another publish of this dossier is still running.';
    else if (err.code === 'billing_unavailable') status.textContent = "Billing is unavailable. Your plan hasn't changed — try again shortly.";
    else status.textContent = err.message ?? 'Publishing failed.';
  }
};

const doTakedown = async (): Promise<void> => {
  const status = $('#publish-status');
  const d = wb.dossier;
  if (!d) return;
  status.textContent = 'Taking down…';
  try {
    const res = await unpublishDossier(d.id);
    session.dossiers = session.dossiers.map((x) => (x.id === res.dossier.id ? res.dossier : x));
    wb.dossier = res.dossier;
    status.textContent = 'Dossier taken down';
    renderContext();
    void renderPublish();
  } catch (e) {
    const err = e as HttpError;
    status.textContent = err.code === 'storage_unavailable'
      ? 'Takedown paused: storage unavailable. Try again shortly.'
      : err.message ?? 'Takedown failed.';
  }
};

const doReopen = async (): Promise<void> => {
  const status = $('#publish-status');
  const d = wb.dossier;
  if (!d) return;
  try {
    const res = await reopenDossier(d.id);
    session.dossiers = session.dossiers.map((x) => (x.id === res.dossier.id ? res.dossier : x));
    wb.dossier = res.dossier;
    status.textContent = 'Reopened as draft';
    renderContext();
    void renderPublish();
  } catch (e) {
    status.textContent = (e as Error).message ?? 'Reopen failed.';
  }
};

const doCreatePreview = async (): Promise<void> => {
  const status = $('#preview-link-status');
  const d = wb.dossier;
  const body = publishBody();
  if (!d || !body) return;
  status.textContent = 'Creating preview link…';
  try {
    const res = await createPreviewLink(d.id, body.radius, body.notes);
    ($('#preview-link') as HTMLInputElement).value = `${location.origin}${res.url}`;
    status.textContent = `Preview link ready — expires ${fmt(res.preview_link.expires_at)}`;
    renderContext();
  } catch (e) {
    const err = e as HttpError;
    status.textContent = err.code === 'storage_unavailable'
      ? 'Preview paused: storage unavailable.'
      : err.message ?? 'Creating the preview link failed.';
  }
};

const doRevokePreview = async (): Promise<void> => {
  const status = $('#preview-link-status');
  const d = wb.dossier;
  if (!d?.preview_link) return;
  try {
    await revokePreviewLink(d.id, d.preview_link.id);
    status.textContent = 'Preview link revoked';
    ($('#preview-link') as HTMLInputElement).value = '';
    renderContext();
  } catch (e) {
    const err = e as HttpError;
    status.textContent = err.code === 'storage_unavailable'
      ? 'Preview paused: storage unavailable.'
      : err.message ?? 'Revoking failed.';
  }
};

// ---------- ops console ----------

const renderOps = async (): Promise<void> => {
  const src = $('#billing-source');
  const table = $('#ops-table');
  const cards = $('#ops-cards');
  try {
    const res = await opsAccounts();
    src.textContent = res.source === 'killbill' ? 'Live from Kill Bill' : 'Billing unavailable — showing last known state';
    table.textContent = '';
    cards.textContent = '';
    const head = el('tr');
    for (const h of ['Account', 'Time zone', 'Sync', 'Writable until', 'Publish', 'Warning at', 'Takedown at', 'Vaults', 'Ciphertext blobs', 'Stored bytes', 'Live dossiers']) {
      head.appendChild(el('th', { scope: 'col' }, h));
    }
    table.appendChild(head);
    for (const a of res.accounts) {
      const tr = el('tr');
      const cells = [
        a.account.email,
        a.account.time_zone,
        a.sync.state,
        a.sync.writable_until ? fmt(a.sync.writable_until) : '—',
        a.publish.state,
        a.publish.warning_at ? fmt(a.publish.warning_at) : '—',
        a.publish.takedown_at ? fmt(a.publish.takedown_at) : '—',
        String(a.vault_count),
        String(a.blob_count),
        String(a.stored_bytes),
        a.live_dossiers.map((dd) => dd.slug).join(', ') || '—',
      ];
      for (const c of cells) tr.appendChild(el('td', { class: /^\d+$/.test(c) ? 'n' : '' }, c));
      table.appendChild(tr);
      const card = el('div', { class: 'ops-row-card' });
      for (const [k, v] of [['Account', a.account.email], ['Time zone', a.account.time_zone], ['Sync', a.sync.state],
        ['Writable until', a.sync.writable_until ? fmt(a.sync.writable_until) : '—'], ['Publish', a.publish.state],
        ['Warning at', a.publish.warning_at ? fmt(a.publish.warning_at) : '—'],
        ['Takedown at', a.publish.takedown_at ? fmt(a.publish.takedown_at) : '—'],
        ['Vaults', String(a.vault_count)], ['Ciphertext blobs', String(a.blob_count)],
        ['Stored bytes', String(a.stored_bytes)],
        ['Live dossiers', a.live_dossiers.map((dd) => dd.slug).join(', ') || '—']] as Array<[string, string]>) {
        card.appendChild(el('div', { class: 'k' }, `${k}: ${v}`));
      }
      cards.appendChild(card);
    }
  } catch {
    src.textContent = 'Billing unavailable — showing last known state';
  }
};

const doSweep = async (): Promise<void> => {
  const status = $('#lapse-check');
  status.textContent = 'Running lapse check…';
  try {
    const res = await opsSweep();
    status.textContent = `Lapse check done: ${res.warnings_sent} warnings sent, ${res.dossiers_taken_down} dossiers taken down`;
    await renderOps();
  } catch (e) {
    const err = e as HttpError;
    status.textContent = err.code === 'sweep_running' ? 'A lapse check is already running.' : 'Lapse check failed.';
  }
};

// ---------- approve / invite pages ----------

const pageKind = (): 'notebook' | 'ops' | 'approve' | 'invite' => {
  const p = location.pathname;
  if (p === '/ops') return 'ops';
  if (p.startsWith('/devices/approve/')) return 'approve';
  if (p.startsWith('/invites/')) return 'invite';
  return 'notebook';
};

const tokenFromPath = (): string => location.pathname.split('/').filter(Boolean).pop() ?? '';

const wireApprovePage = (): void => {
  const btn = $('#approve-device-btn') as HTMLButtonElement;
  const status = $('#device-approval-status');
  btn.addEventListener('click', async () => {
    try {
      await approveDevice(tokenFromPath());
      status.textContent = 'Device approved. You can close this tab.';
    } catch (e) {
      const err = e as HttpError;
      status.textContent = err.code === 'link_used' ? 'This device is already approved.'
        : err.code === 'link_expired' ? 'This approval link has expired. Sign in again on the new device to get a fresh one.'
        : err.message;
    }
  });
};

const wireInvitePage = async (): Promise<void> => {
  const btn = $('#accept-invite-btn') as HTMLButtonElement;
  const status = $('#vault-status');
  btn.addEventListener('click', async () => {
    try {
      await acceptInvite(tokenFromPath());
      status.textContent = `You've joined the vault. Enter the vault passphrase from ${session.account?.display_name ?? 'the inviter'} to unlock it.`;
      await loadSession();
      openUnlockDialog();
    } catch (e) {
      const err = e as HttpError;
      status.textContent = err.code === 'invite_email_mismatch' ? 'This invite was sent to a different email address.'
        : err.code === 'link_expired' ? 'This invite has expired.'
        : err.code === 'link_used' ? 'This invite has already been used.'
        : err.message;
    }
  });
};

// ---------- boot ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

const scheduleNoteSave = (patch: Partial<{ title: string; body: string }>): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const noteId = get().openNoteId;
    if (!noteId) return;
    const notes = notesOf();
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx < 0) return;
    const next = [...notes];
    next[idx] = { ...next[idx], ...patch };
    setNotes(next);
    if (nb.current.kind === 'vault') {
      const head = JSON.parse(sessionStorage.getItem('cairn.heads') ?? '{}')[noteId] ?? null;
      queueRevision(noteId, head as number | null, JSON.stringify(next[idx]));
      setBadge(noteId, 'pending');
      void flushQueue();
    }
    renderRail();
    if (ctx.tab === 'Backlinks') renderContext();
  }, 1000);
};

const boot = async (): Promise<void> => {
  const kind = pageKind();
  if (kind === 'ops') {
    $('#ops-page').hidden = false;
    $('#run-sweep').addEventListener('click', () => void doSweep());
    await renderOps();
    return;
  }
  if (kind === 'approve') {
    $('#approve-page').hidden = false;
    wireApprovePage();
    return;
  }
  if (kind === 'invite') {
    $('#invite-page').hidden = false;
    wireInvitePage();
    return;
  }
  $('#notebook-page').hidden = false;

  $('#account-btn').addEventListener('click', () => {
    void refreshAccountDialog();
    openDialog('account-dialog', $('#account-btn'));
  });
  $('#sync-now').addEventListener('click', () => {
    void flushQueue();
    void pullOnce();
  });
  $('#new-note-btn').addEventListener('click', () => {
    const note = newNoteObject();
    setNotes([...notesOf(), note]);
    save({ openNoteId: note.id });
    state.mode = 'edit';
    render();
    ($('#note-title') as HTMLInputElement).focus();
  });
  $('#sample-btn').addEventListener('click', () => {
    const notes = sampleCase();
    setNotes(notes);
    save({ openNoteId: notes[0].id });
    render();
  });
  ($('#notebook-select') as HTMLSelectElement).addEventListener('change', async (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value === 'local') {
      nb.current = { kind: 'local' };
      render();
      return;
    }
    if (session.unlockedVaults.has(value)) {
      nb.current = { kind: 'vault', vaultId: value };
      render();
      void flushQueue();
      void pullOnce();
    } else {
      $('#unlock-vault-name').textContent = session.vaults.find((v) => v.id === value)?.name ?? 'Vault';
      ($('#unlock-passphrase') as HTMLInputElement).value = '';
      openDialog('unlock-dialog', e.target as HTMLElement);
    }
  });
  ($('#note-title') as HTMLInputElement).addEventListener('input', (e) => {
    scheduleNoteSave({ title: (e.target as HTMLInputElement).value });
  });
  ($('#note-body') as HTMLTextAreaElement).addEventListener('input', (e) => {
    scheduleNoteSave({ body: (e.target as HTMLTextAreaElement).value });
  });
  $('#read-btn').addEventListener('click', () => {
    state.mode = state.mode === 'edit' ? 'read' : 'edit';
    renderNote();
  });
  $('#pin-btn').addEventListener('click', () => {
    const note = notesOf().find((n) => n.id === get().openNoteId);
    if (!note) return;
    const patch = { private: !note.private };
    setNotes(notesOf().map((n) => (n.id === note.id ? { ...n, ...patch } : n)));
    if (nb.current.kind === 'vault') {
      const head = JSON.parse(sessionStorage.getItem('cairn.heads') ?? '{}')[note.id] ?? null;
      queueRevision(note.id, head as number | null, JSON.stringify({ ...note, ...patch }));
      setBadge(note.id, 'pending');
      void flushQueue();
    }
    render();
    if (ctx.tab === 'Publish') void renderPublish();
  });
  $('#open-conflict-copy').addEventListener('click', () => {
    const copyId = get().conflictCopies[get().openNoteId ?? ''];
    if (copyId) {
      save({ openNoteId: copyId });
      state.mode = 'edit';
      render();
    }
  });
  $('#dismiss-conflict').addEventListener('click', () => {
    const noteId = get().openNoteId;
    if (!noteId) return;
    save({ dismissedConflicts: [...get().dismissedConflicts, noteId] });
    setBadge(noteId, 'synced');
    render();
  });
  for (const [id, tab] of [['tab-backlinks', 'Backlinks'], ['tab-history', 'History'], ['tab-graph', 'Graph'], ['tab-publish', 'Publish']] as const) {
    $(`#${id}`).addEventListener('click', () => {
      ctx.tab = tab;
      renderContext();
    });
  }
  const slider = $('#ring-slider') as HTMLInputElement;
  slider.addEventListener('input', () => setRingRadius(Number(slider.value)));
  for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="hop"]'))) {
    r.addEventListener('change', () => setRingRadius(Number(r.value)));
  }
  slider.addEventListener('keydown', (e) => {
    const delta: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (e.key in delta) {
      e.preventDefault();
      setRingRadius(ring.radius + delta[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setRingRadius(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setRingRadius(4);
    }
  });
  $('#create-dossier-btn').addEventListener('click', () => void doCreateDossier(false));
  $('#start-dossier-btn').addEventListener('click', () => void doCreateDossier(true));
  $('#publish-btn').addEventListener('click', () => {
    const d = wb.dossier;
    if (!d) return;
    const counts = countsAt(candidatesFor(notesOf(), d.root_note_id), ring.radius);
    $('#publish-copy').textContent = `Publish ${counts.public_count} notes and cut ${counts.severed_count} links?`;
    openDialog('publish-dialog', $('#publish-btn'));
  });
  $('#publish-now-btn').addEventListener('click', () => {
    closeDialog('publish-dialog');
    void doPublish();
  });
  $('#publish-cancel-btn').addEventListener('click', () => closeDialog('publish-dialog'));
  $('#takedown-btn').addEventListener('click', () => openDialog('takedown-dialog', $('#takedown-btn')));
  $('#take-down-btn').addEventListener('click', () => {
    closeDialog('takedown-dialog');
    void doTakedown();
  });
  $('#takedown-cancel-btn').addEventListener('click', () => closeDialog('takedown-dialog'));
  $('#reopen-btn').addEventListener('click', () => void doReopen());
  $('#create-preview-btn').addEventListener('click', () => void doCreatePreview());
  $('#copy-link-btn').addEventListener('click', () => {
    void navigator.clipboard?.writeText(($('#preview-link') as HTMLInputElement).value).catch(() => undefined);
  });
  $('#revoke-preview-btn').addEventListener('click', () => openDialog('revoke-dialog', $('#revoke-preview-btn')));
  $('#revoke-btn').addEventListener('click', () => {
    closeDialog('revoke-dialog');
    void doRevokePreview();
  });
  $('#revoke-cancel-btn').addEventListener('click', () => closeDialog('revoke-dialog'));
  for (const id of ['account-dialog', 'vault-dialog', 'unlock-dialog', 'invite-dialog', 'restore-dialog', 'publish-dialog', 'takedown-dialog', 'revoke-dialog']) {
    $(`#${id}`).addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog(id);
      }
    });
  }
  $('#unlock-btn').addEventListener('click', () => void doUnlock());
  $('#signin-form').addEventListener('submit', (e) => { e.preventDefault(); void doSignIn(); });
  $('#signup-form').addEventListener('submit', (e) => { e.preventDefault(); void doSignUp(); });
  $('#signout-btn').addEventListener('click', () => void doSignOut());
  $('#add-sync').addEventListener('click', () => void doPlan('sync', true));
  $('#cancel-sync').addEventListener('click', () => void doPlan('sync', false));
  $('#add-publish').addEventListener('click', () => void doPlan('publish', true));
  $('#cancel-publish').addEventListener('click', () => void doPlan('publish', false));
  $('#create-vault-btn').addEventListener('click', () => void doCreateVault());
  $('#enable-sync-btn').addEventListener('click', () => {
    ($('#vault-name') as HTMLInputElement).value = notebookName();
    openDialog('vault-dialog', $('#enable-sync-btn'));
  });
  $('#invite-btn').addEventListener('click', () => {
    ($('#partner-email') as HTMLInputElement).value = '';
    openDialog('invite-dialog', $('#invite-btn'));
  });
  $('#send-invite-btn').addEventListener('click', () => void doSendInvite());
  const filesBtn = $('#files-btn');
  filesBtn.innerHTML = `${icons.menu} Files`;
  ($('#new-note-btn') as HTMLButtonElement).innerHTML = `${icons.plus} New note`;
  ($('#sample-btn') as HTMLButtonElement).innerHTML = `${icons.copy} Load sample case`;
  // the drawer re-parents the live rail so its controls and tree keep working
  const railEl = $('#rail');
  const railHome = { parent: railEl.parentElement as HTMLElement, next: railEl.nextElementSibling as HTMLElement | null };
  const closeDrawer = (): void => {
    $('#rail-drawer').hidden = true;
    railHome.parent.insertBefore(railEl, railHome.next);
    filesBtn.focus();
  };
  filesBtn.addEventListener('click', () => {
    ($('#drawer-body') as HTMLElement).appendChild(railEl);
    railEl.style.width = 'min(78vw, 300px)';
    $('#rail-drawer').hidden = false;
    ($('#drawer-close') as HTMLElement).focus();
  });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#rail-drawer').addEventListener('click', (e) => {
    if (e.target === $('#rail-drawer')) closeDrawer();
  });
  $('#rail-drawer').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDrawer();
    }
  });
  const contextBtn = $('#context-btn');
  const paneEl = $('#context-pane');
  const paneHome = { parent: paneEl.parentElement as HTMLElement, next: paneEl.nextElementSibling as HTMLElement | null };
  const closeSheet = (): void => {
    $('#bottom-sheet').hidden = true;
    paneHome.parent.insertBefore(paneEl, paneHome.next);
    paneEl.style.width = '';
    contextBtn.focus();
  };
  contextBtn.addEventListener('click', () => {
    paneEl.classList.remove('hidden-mobile');
    paneEl.style.width = '100%';
    ($('#sheet-body') as HTMLElement).appendChild(paneEl);
    $('#bottom-sheet').hidden = false;
    ($('#sheet-close') as HTMLElement).focus();
  });
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#bottom-sheet').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeSheet();
    }
  });

  await loadSession();
  render();
  setInterval(() => {
    if (document.visibilityState === 'visible') void pullOnce();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pullOnce();
  });
  setInterval(() => {
    if (get().queue.length) void flushQueue();
  }, 10000);
  void flushQueue();
};

const notebookName = (): string => {
  if (nb.current.kind === 'vault') {
    return session.vaults.find((v) => v.id === (nb.current as { vaultId: string }).vaultId)?.name ?? 'Case vault';
  }
  return 'Local notebook';
};

boot().catch(() => undefined);
