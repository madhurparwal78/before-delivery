// /releases/<id>: the release in the inspector beside its compartment's docket.

import {
  api, claimFile, clearFieldError, CONNECTION_LOST, ConnectionLost, field, figure, h, icon, refusalCopy, saveBlob, session, setFieldError,
  setFigure, skeletonRows, syncRows,
} from '../core.js';
import { stepUp } from '../dialogs.js';
import { actionStatus, docketPanes, navigate, watchCompartment } from '../shell.js';
import { renderDocket } from './docket.js';

const REFRESH_MS = 3000;
const DERIVATIVES_MS = 5000;
const STATE_WORDS = {
  assembling: 'Assembling',
  submitted: 'Submitted',
  'signed off': 'Signed off',
  rejected: 'Rejected',
  shared: 'Shared',
  withdrawn: 'Withdrawn',
};
const DECISION = { separation: 'release', race: true };
const DOWNLOAD_OUTAGE = 'Download unavailable. Exhibit storage is unreachable. Your grant is still unused.';
const SHARE_OUTAGE = 'Not shared. Exhibit storage is unreachable, so the derivatives could not be confirmed.';

function ignoreLostAnswer(error) {
  if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
}

function rightsOn(release, compartment) {
  const { id: me, role } = session.me;
  const lead = role === 'case_lead';
  const worked = release.assembler_id === me || release.contributor_ids.includes(me);
  const member = compartment !== null && (lead || role === 'investigator');
  // A break-glass grant is refused every decision and link action, so only a normal grant shows them.
  const normalLead = lead && compartment?.caller_scope === 'full'
    && Boolean(compartment.access?.some((grant) => grant.user_id === me && grant.kind === 'grant' && grant.state === 'active'));
  const { state } = release;
  return {
    edit: member && state === 'assembling',
    submit: member && state === 'assembling' && worked && release.items.length > 0,
    decide: normalLead && state === 'submitted' && !worked,
    open: normalLead && state === 'submitted',
    reopen: member && state === 'rejected' && release.assembler_id === me,
    share: normalLead && state === 'signed off',
    onShared: normalLead && state === 'shared',
  };
}

export function mount(screen) {
  const panes = docketPanes(screen, 'inspector');
  panes.inspector.replaceChildren(skeletonRows());
  const stopLoading = screen.every(REFRESH_MS, async () => {
    const answer = await api('GET', `/api/releases/${screen.params[0]}`, { background: true, signal: screen.signal });
    if (answer.status === 404) {
      screen.notFound();
      return;
    }
    if (!answer.ok) return;
    stopLoading();
    showRelease(screen, panes, answer.data);
    await renderDocket(screen, panes, answer.data.compartment_id);
  });
}

function showRelease(screen, panes, first) {
  const releaseId = first.id;
  const path = `/api/releases/${releaseId}`;
  const { inspector } = panes;
  let release = first;
  let compartment = null;
  let derivatives = null;
  let loadingDerivatives = false;
  let rights = rightsOn(release, compartment);
  let linkRevoked = false;
  // An answer to an automatic check that started before an action's answer is older than it, so it is dropped.
  let generation = 0;
  let opening = false;

  const button = (label, onclick, quiet = false) => h('button', { type: 'button', class: quiet ? 'btn' : 'btn', onclick, hidden: true }, label);
  const focusPane = () => inspector.focus();

  const figureBlock = figure('Items', release.items.length);
  const stateWord = h('div', { role: 'status', 'aria-label': 'Release state', class: 'release-state' });
  const digest = h('span', { class: 'digest' });
  const total = h('span', { class: 'mono' });
  const rejection = h('section', { class: 'release-rejection stack', hidden: true }, h('h3', {}, 'Rejection reason'), h('p', {}));
  const itemRows = h('ul', { class: 'item-rows', 'aria-label': 'Items' });

  const derivativeBox = h('select', { class: 'derivative-box', 'aria-label': 'Derivative' });
  const labelBox = h('input', { type: 'text', autocomplete: 'off' });
  const addButton = h('button', { type: 'submit', class: 'btn' }, 'Add item');
  const addForm = h('form', {
    class: 'stack release-section',
    novalidate: true,
    hidden: true,
    onsubmit: (event) => {
      event.preventDefault();
      addItem();
    },
  }, field('Derivative', derivativeBox), field('Item label', labelBox), h('div', { class: 'button-row' }, addButton));

  const submitButton = button('Submit release', (event) => submitRelease(event.currentTarget));
  const signOffButton = button('Sign off', (event) => signOff(event.currentTarget));
  const rejectButton = button('Reject', (event) => reject(event.currentTarget), true);
  const reopenButton = button('Reopen', () => reopen());

  const lapseBox = h('input', { type: 'text', autocomplete: 'off', class: 'mono-input' });
  const shareButton = button('Share', (event) => sendLink(event.currentTarget, 'share'));
  const regenerateButton = button('Regenerate link', (event) => sendLink(event.currentTarget, 'link/regenerate'));
  const shareForm = h('form', {
    class: 'stack release-section',
    novalidate: true,
    hidden: true,
    onsubmit: (event) => {
      event.preventDefault();
      (shareButton.hidden ? regenerateButton : shareButton).click();
    },
  }, field('Link lapses at', lapseBox), h('div', { class: 'button-row' }, shareButton, regenerateButton));

  const revokeButton = button('Revoke link', (event) => revokeLink(event.currentTarget), true);
  const withdrawButton = button('Withdraw', (event) => withdraw(event.currentTarget), true);
  const linkSlot = h('div', { class: 'share-link-slot' });
  const fieldControls = { derivative_id: derivativeBox, label: labelBox, expires_at: lapseBox };

  inspector.replaceChildren(
    h('button', { type: 'button', class: 'btn back-to-docket', onclick: () => navigate(`/compartments/${release.compartment_id}`) }, icon('back'), 'Back to docket'),
    figureBlock,
    h('div', { class: 'release-head' }, h('h2', { class: 'release-name' }, release.name), stateWord),
    h('dl', { class: 'release-facts' },
      h('dt', {}, 'Release'), h('dd', { class: 'mono' }, release.id),
      h('dt', {}, 'Matter'), h('dd', { class: 'mono' }, release.matter_ref),
      h('dt', {}, 'Recipient'), h('dd', {}, { counsel: 'Outside counsel', requester: 'Requester' }[release.recipient_kind]),
      h('dt', {}, 'Manifest digest'), h('dd', {}, digest),
      h('dt', {}, 'Total'), h('dd', {}, total)),
    rejection,
    itemRows,
    addForm,
    h('div', { class: 'button-row release-section release-actions' }, submitButton, signOffButton, rejectButton, reopenButton),
    shareForm,
    h('div', { class: 'button-row release-section release-actions' }, revokeButton, withdrawButton),
    linkSlot);

  function renderItem(item) {
    return h('li', { class: 'item-row' },
      h('div', { class: 'item-body' },
        h('span', { class: 'item-label' }, item.label),
        h('span', { class: 'mono item-meta' }, `${item.derivative_id}, ${item.size} bytes`),
        item.superseded ? h('span', { class: 'item-mark' }, icon('superseded'), 'Superseded') : null,
        item.opened_by_caller ? h('span', { class: 'item-mark item-opened' }, icon('check'), 'Opened') : null),
      rights.open || rights.edit
        ? h('div', { class: 'button-row item-actions' },
          rights.open ? h('button', { type: 'button', class: 'btn', onclick: () => openItem(item) }, `Open ${item.label}`) : null,
          rights.edit ? h('button', { type: 'button', class: 'btn', onclick: () => removeItem(item) }, `Remove ${item.label}`) : null)
        : null);
  }

  function paint() {
    const focused = document.activeElement;
    rights = rightsOn(release, compartment);
    setFigure(figureBlock, release.items.length);
    if (stateWord.textContent !== STATE_WORDS[release.state]) stateWord.textContent = STATE_WORDS[release.state];
    stateWord.dataset.manifestDigest = release.manifest_digest;
    if (digest.textContent !== release.manifest_digest) digest.textContent = release.manifest_digest;
    const bytes = `${release.total_bytes} bytes`;
    if (total.textContent !== bytes) total.textContent = bytes;
    rejection.hidden = release.state !== 'rejected' || !release.rejection_reason;
    if (!rejection.hidden) rejection.lastElementChild.textContent = release.rejection_reason;
    syncRows(itemRows, release.items, {
      key: (item) => item.id,
      signature: (item) => JSON.stringify([item.label, item.size, item.derivative_id, item.superseded, item.opened_by_caller, rights.open, rights.edit]),
      render: renderItem,
    });
    if (rights.edit && derivatives === null) loadDerivatives();
    addForm.hidden = !rights.edit || derivatives === null;
    submitButton.hidden = !rights.submit;
    signOffButton.hidden = !rights.decide;
    rejectButton.hidden = !rights.decide;
    reopenButton.hidden = !rights.reopen;
    shareButton.hidden = !rights.share;
    regenerateButton.hidden = !rights.onShared;
    shareForm.hidden = !rights.share && !rights.onShared;
    revokeButton.hidden = !rights.onShared || linkRevoked;
    withdrawButton.hidden = !rights.onShared;
    for (const row of inspector.querySelectorAll('.release-actions')) {
      row.hidden = ![...row.children].some((control) => !control.hidden);
    }
    const lostFocus = inspector.contains(focused) || !focused.isConnected;
    if (lostFocus && focused !== inspector && focused !== document.body
      && (!focused.isConnected || !focused.checkVisibility()) && document.activeElement === document.body) {
      focusPane();
    }
  }

  async function refresh() {
    const seen = generation;
    try {
      const answer = await api('GET', path, { background: true, signal: screen.signal });
      if (answer.ok && seen === generation && !screen.stopped) {
        release = answer.data;
        paint();
      }
    } catch (error) {
      ignoreLostAnswer(error);
    }
  }

  async function loadDerivatives() {
    if (loadingDerivatives) return;
    loadingDerivatives = true;
    const options = { background: true, signal: screen.signal };
    try {
      const exhibits = await api('GET', `/api/compartments/${release.compartment_id}/exhibits`, options);
      if (!exhibits.ok) return;
      const answers = await Promise.all(exhibits.data.exhibits.map((exhibit) => api('GET', `/api/exhibits/${exhibit.id}/derivatives`, options)));
      const ids = answers.filter((answer) => answer.ok).flatMap((answer) => answer.data.derivatives)
        .filter((derivative) => !derivative.disposed).map((derivative) => derivative.id);
      if (screen.stopped) return;
      if (ids.join() !== derivatives?.join()) {
        const chosen = derivativeBox.value;
        derivativeBox.replaceChildren(...ids.map((id) => h('option', { value: id }, id)));
        if (ids.includes(chosen)) derivativeBox.value = chosen;
      }
      derivatives = ids;
      paint();
    } catch (error) {
      ignoreLostAnswer(error);
    } finally {
      loadingDerivatives = false;
    }
  }

  function clearErrors() {
    for (const control of Object.values(fieldControls)) clearFieldError(control);
  }

  function showFieldErrors(errors) {
    const refused = Object.entries(errors);
    for (const [name, copy] of refused) if (fieldControls[name]) setFieldError(fieldControls[name], copy);
    actionStatus(refused.map(([, copy]) => copy).join(' '), 'refusal');
    const first = refused.find(([name]) => fieldControls[name]);
    if (first) fieldControls[first[0]].focus();
  }

  // Shows an action's answer. `context` picks the refusal copy; `outage` is the action's storage copy.
  function settle(answer, { success, context = {}, outage = null, onSuccess = null }) {
    generation += 1;
    if (answer.status === 401) {
      actionStatus('');
      return;
    }
    if (answer.ok) {
      actionStatus(success(answer.data), 'success');
      onSuccess?.(answer.data);
      if (answer.data.items) {
        release = answer.data;
        paint();
        return;
      }
    } else if (answer.status === 422 && answer.errors) {
      showFieldErrors(answer.errors);
    } else if (answer.status === 503 && outage) {
      actionStatus(outage, 'refusal');
    } else {
      actionStatus(refusalCopy(answer, context), 'refusal');
    }
    refresh();
  }

  function connectionLost(error) {
    ignoreLostAnswer(error);
    actionStatus(CONNECTION_LOST);
  }

  function privileged(opener, { pending, send, needsReason = false, ...outcome }) {
    clearErrors();
    stepUp({
      opener,
      fallback: focusPane,
      needsReason,
      run: async (proof, reason) => {
        actionStatus(pending);
        const answer = await send(proof, reason);
        if (answer.status === 401 || answer.errors?.reason) actionStatus('');
        return answer;
      },
      onAnswer: (answer) => settle(answer, outcome),
      onFailure: connectionLost,
    });
  }

  async function immediate({ pending, send, ...outcome }) {
    clearErrors();
    actionStatus(pending);
    try {
      settle(await send(), outcome);
    } catch (error) {
      connectionLost(error);
    }
  }

  function addItem() {
    immediate({
      pending: 'Saving item.',
      send: () => api('POST', `${path}/items`, { body: { derivative_id: derivativeBox.value, label: labelBox.value } }),
      success: () => 'Item added.',
      onSuccess: () => {
        labelBox.value = '';
      },
    });
  }

  function removeItem(item) {
    immediate({
      pending: 'Saving item.',
      send: () => api('DELETE', `${path}/items/${item.id}`),
      success: () => 'Item removed.',
    });
  }

  function submitRelease(opener) {
    privileged(opener, {
      pending: 'Submitting.',
      send: (proof) => api('POST', `${path}/submit`, { body: {}, proof }),
      success: () => `Submitted ${releaseId}.`,
    });
  }

  function decisionCopy(verb) {
    return (data) => `${verb} ${releaseId}. ${data.notice === 'held' ? 'Notice held. It will send when the mail relay returns.' : 'Assembler notice queued.'}`;
  }

  function signOff(opener) {
    const captured = stateWord.dataset.manifestDigest;
    privileged(opener, {
      pending: 'Signing off.',
      send: (proof) => api('POST', `${path}/sign-off`, { body: { manifest_digest: captured }, proof }),
      success: decisionCopy('Signed off'),
      context: DECISION,
    });
  }

  function reject(opener) {
    privileged(opener, {
      needsReason: true,
      pending: 'Rejecting.',
      send: (proof, reason) => api('POST', `${path}/reject`, { body: { reason }, proof }),
      success: decisionCopy('Rejected'),
      context: DECISION,
    });
  }

  function reopen() {
    immediate({
      pending: 'Reopening.',
      send: () => api('POST', `${path}/reopen`, { body: {} }),
      success: () => `Reopened ${releaseId}.`,
    });
  }

  function sendLink(opener, action) {
    const sharing = action === 'share';
    privileged(opener, {
      pending: sharing ? 'Confirming derivatives.' : 'Updating link.',
      send: (proof) => api('POST', `${path}/${action}`, { body: { expires_at: lapseBox.value }, proof }),
      success: () => (sharing ? `Shared ${releaseId}. Every derivative is confirmed present.` : 'New link ready. The old link no longer works.'),
      outage: SHARE_OUTAGE,
      onSuccess: (data) => {
        linkRevoked = false;
        lapseBox.value = '';
        const address = `${location.origin}${data.url}`;
        linkSlot.replaceChildren(h('a', {
          href: address, class: 'share-link', 'aria-label': 'Share link', 'data-plain': true, target: '_blank', rel: 'noreferrer noopener',
        }, icon('link'), address));
      },
    });
  }

  function revokeLink(opener) {
    privileged(opener, {
      pending: 'Updating link.',
      send: (proof) => api('POST', `${path}/link/revoke`, { body: {}, proof }),
      success: () => 'Link revoked.',
      onSuccess: () => {
        linkRevoked = true;
      },
    });
  }

  function withdraw(opener) {
    privileged(opener, {
      pending: 'Withdrawing.',
      send: (proof) => api('POST', `${path}/withdraw`, { body: {}, proof }),
      success: () => `Withdrawn ${releaseId}.`,
    });
  }

  async function openItem(item) {
    if (opening) return;
    opening = true;
    clearErrors();
    actionStatus('Preparing download.');
    try {
      const grant = await api('POST', `/api/derivatives/${item.derivative_id}/download-grants`, { body: {} });
      if (grant.status === 401) {
        actionStatus('');
        return;
      }
      if (!grant.ok) {
        actionStatus(grant.status === 503 ? DOWNLOAD_OUTAGE : refusalCopy(grant), 'refusal');
        return;
      }
      const file = await claimFile(grant.data.token);
      if (!file.ok) {
        actionStatus(file.status === 503 ? DOWNLOAD_OUTAGE : refusalCopy({}), 'refusal');
        return;
      }
      saveBlob(file.blob, file.filename);
      actionStatus('Download started.', 'success');
      refresh();
    } catch (error) {
      connectionLost(error);
    } finally {
      opening = false;
    }
  }

  paint();
  watchCompartment(screen, release.compartment_id, panes, {
    onData: (data) => {
      compartment = data;
      paint();
    },
  });
  screen.every(REFRESH_MS, refresh, { now: false });
  screen.every(DERIVATIVES_MS, async () => {
    if (rights.edit) await loadDerivatives();
  }, { now: false });
}
