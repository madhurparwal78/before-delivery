/** The release sheet and the review queue. */

import { claim, get, post, remove, saveBlob } from './api.js';
import { announce, clear, el, icon, takeFocus } from './dom.js';
import { closeAllDialogs } from './dialog.js';
import {
  COPY,
  decisionCopy,
  errorCode,
  privileged,
  setStatus,
  syncRows,
  table,
} from './ui.js';
import { mountDocket } from './screen_compartments.js';
import { go, notFoundPage, state } from './app.js';

const STATE_WORDS = {
  assembling: 'Assembling',
  submitted: 'Submitted',
  'signed off': 'Signed off',
  rejected: 'Rejected',
  shared: 'Shared',
  withdrawn: 'Withdrawn',
};

export default {
  async mount(context) {
    const releaseId = context.params[0];
    const { inspector, docket, status } = context;
    const first = await get(`/api/releases/${encodeURIComponent(releaseId)}`);
    if (first.status === 404) {
      notFoundPage(inspector);
      docket.append(el('p', { text: COPY.noRecord }));
      return {};
    }
    if (first.status !== 200) return {};
    let release = first.body;
    const docketHandle = mountDocket(docket, release.compartment_id, context, {
      figure: false,
      endedAlert: false,
      onAccessEnded: () => endAccess(),
    });
    await docketHandle.refresh(false);

    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const heading = el('h1', { text: release.name });
    const stateLine = el('p', {
      role: 'status',
      'aria-label': 'Release state',
      'aria-live': 'polite',
      dataset: { manifestDigest: release.manifest_digest },
      text: STATE_WORDS[release.state],
    });
    const meta = el('p', { class: 'mono' });
    const items = table('Release items', ['Item', 'Label', 'Bytes', 'State', 'Actions']);
    const assembly = el('div');
    const decisions = el('div');
    const linkBox = el('div');
    const breakGlassTime = el('p', {
      role: 'status',
      'aria-label': 'Break-glass time',
      class: 'mono',
      hidden: true,
    });
    const accessEnded = el('div', {
      role: 'alert',
      'aria-label': 'Access ended',
      hidden: true,
      text: COPY.accessEnded,
    });
    const body = el('div', {}, [
      el('button', {
        type: 'button',
        class: 'back-to-docket',
        text: 'Back to docket',
        on: { click: () => go(`/compartments/${release.compartment_id}`) },
      }),
      figure,
      el('span', { dataset: { figureLabel: 'true' }, text: 'Items' }),
      heading,
      stateLine,
      meta,
      breakGlassTime,
      items.node,
      assembly,
      decisions,
      linkBox,
    ]);
    inspector.append(body, accessEnded);

    let dead = false;
    let derivativeOptions = [];

    function endAccess() {
      if (dead) return;
      dead = true;
      clear(body);
      body.hidden = true;
      accessEnded.hidden = false;
      closeAllDialogs();
      takeFocus(accessEnded);
    }

    function isLead() {
      const compartment = docketHandle.compartment();
      return (
        state.user.role === 'case_lead' &&
        compartment &&
        compartment.caller_scope === 'full'
      );
    }

    function breakGlassHere() {
      return state.breakGlass.some(
        (item) => item.compartment_id === release.compartment_id
      );
    }

    async function loadDerivatives() {
      const exhibits = await get(
        `/api/compartments/${encodeURIComponent(release.compartment_id)}/exhibits`,
        { background: true }
      );
      if (exhibits.status !== 200) return;
      const found = [];
      for (const exhibit of exhibits.body.exhibits) {
        const reply = await get(`/api/exhibits/${exhibit.id}/derivatives`, {
          background: true,
        });
        if (reply.status !== 200) continue;
        for (const derivative of reply.body.derivatives) {
          if (!derivative.disposed) found.push(derivative);
        }
      }
      derivativeOptions = found;
    }

    function renderAssembly() {
      clear(assembly);
      if (release.state !== 'assembling') return;
      if (!['case_lead', 'investigator'].includes(state.user.role)) return;
      const chooser = el('select', { 'aria-label': 'Derivative' });
      for (const derivative of derivativeOptions) {
        chooser.append(el('option', { value: derivative.id, text: derivative.id }));
      }
      const label = el('input', { type: 'text', 'aria-label': 'Item label' });
      const labelError = el('p', { class: 'field-error', hidden: true });
      const add = el('button', {
        type: 'button',
        text: 'Add item',
        on: {
          click: async () => {
            labelError.hidden = true;
            setStatus(status, 'Saving item.');
            const reply = await post(`/api/releases/${release.id}/items`, {
              derivative_id: chooser.value,
              label: label.value,
            });
            if (reply.status === 201) {
              setStatus(status, 'Item added.');
              label.value = '';
              await reload(false);
              return;
            }
            const code = errorCode(reply);
            if (code === 'derivative_superseded') {
              setStatus(
                status,
                `A newer set of marks exists for ${reply.body.derivative_id}. Render again and replace it.`,
                true
              );
              return;
            }
            if (code === 'exhibit_not_cleared') {
              setStatus(status, COPY.notCleared, true);
              return;
            }
            if (reply.status === 422 && reply.body.errors) {
              const copy = reply.body.errors.label || Object.values(reply.body.errors)[0];
              labelError.textContent = copy;
              labelError.hidden = false;
              setStatus(status, copy, true);
              label.focus();
              return;
            }
            setStatus(status, COPY.noLonger, true);
          },
        },
      });
      const submit = el('button', {
        type: 'button',
        text: 'Submit release',
        on: { click: () => decide(submit, 'submit', 'Submitting.', false) },
      });
      assembly.append(
        el('h2', { text: 'Assemble' }),
        el('label', { text: 'Derivative' }),
        chooser,
        el('label', { text: 'Item label' }),
        label,
        labelError,
        add,
        submit
      );
    }

    function renderDecisions() {
      clear(decisions);
      clear(linkBox);
      const lead = isLead();
      const emergency = breakGlassHere();
      if (release.state === 'submitted' && lead && !emergency) {
        const signOff = el('button', {
          type: 'button',
          text: 'Sign off',
          on: { click: () => signOffAction(signOff) },
        });
        const reject = el('button', {
          type: 'button',
          text: 'Reject',
          on: { click: () => decide(reject, 'reject', 'Rejecting.', true) },
        });
        decisions.append(signOff, reject);
      }
      if (release.state === 'rejected' && release.assembler_id === state.user.id) {
        const reopen = el('button', {
          type: 'button',
          text: 'Reopen',
          on: {
            click: async () => {
              setStatus(status, 'Reopening.');
              const reply = await post(`/api/releases/${release.id}/reopen`, {});
              if (reply.status === 200) {
                setStatus(status, `Reopened ${release.id}.`);
                await reload(false);
                return;
              }
              setStatus(status, COPY.noLonger, true);
            },
          },
        });
        decisions.append(reopen);
      }
      if (lead && !emergency && ['signed off', 'shared'].includes(release.state)) {
        const lapses = el('input', {
          type: 'text',
          'aria-label': 'Link lapses at',
          value: defaultLapse(),
        });
        const share = el('button', {
          type: 'button',
          text: release.state === 'signed off' ? 'Share' : 'Regenerate link',
          on: { click: () => shareAction(share, lapses) },
        });
        decisions.append(el('label', { text: 'Link lapses at' }), lapses, share);
        if (release.state === 'shared') {
          const revoke = el('button', {
            type: 'button',
            text: 'Revoke link',
            on: { click: () => linkAction(revoke, 'revoke') },
          });
          const withdraw = el('button', {
            type: 'button',
            text: 'Withdraw',
            on: { click: () => decide(withdraw, 'withdraw', 'Withdrawing.', false) },
          });
          decisions.append(revoke, withdraw);
        }
      }
    }

    function defaultLapse() {
      const when = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      return when.toISOString().slice(0, 19) + 'Z';
    }

    async function decide(opener, action, pending, needsReason) {
      setStatus(status, pending);
      const reply = await privileged({
        opener,
        needsReason,
        run: (proof, reason) =>
          post(
            `/api/releases/${release.id}/${action}`,
            needsReason ? { reason } : {},
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        if (action === 'submit') setStatus(status, `Submitted ${release.id}.`);
        else if (action === 'reject') {
          setStatus(
            status,
            decisionCopy(`Rejected ${release.id}.`, 'Assembler notice queued.', reply)
          );
        } else if (action === 'withdraw') setStatus(status, `Withdrawn ${release.id}.`);
        await reload(false);
        return;
      }
      reportFailure(reply);
    }

    function reportFailure(reply) {
      const code = errorCode(reply);
      if (code === 'separation_of_duties') {
        setStatus(status, COPY.sodRelease, true);
        return;
      }
      if (code === 'release_changed') {
        setStatus(status, COPY.releaseChanged, true);
        return;
      }
      if (code === 'items_unopened') {
        setStatus(
          status,
          `Open every item before signing off. Not opened yet: ${reply.body.item_ids.length}.`,
          true
        );
        return;
      }
      if (code === 'derivative_superseded') {
        setStatus(
          status,
          `A newer set of marks exists for ${reply.body.derivative_id}. Render again and replace it.`,
          true
        );
        return;
      }
      if (code === 'illegal_transition') {
        setStatus(status, COPY.alreadyDecided, true);
        return;
      }
      if (code === 'derivative_missing') {
        setStatus(status, COPY.noLonger, true);
        return;
      }
      if (code === 'storage_unavailable') {
        setStatus(
          status,
          'Not shared. Exhibit storage is unreachable, so the derivatives could not be confirmed.',
          true
        );
        return;
      }
      if (reply.status === 422 && reply.body.errors) {
        setStatus(status, Object.values(reply.body.errors)[0], true);
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }

    async function signOffAction(opener) {
      const captured = stateLine.dataset.manifestDigest;
      setStatus(status, 'Signing off.');
      const reply = await privileged({
        opener,
        needsReason: false,
        run: (proof) =>
          post(
            `/api/releases/${release.id}/sign-off`,
            { manifest_digest: captured },
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        setStatus(
          status,
          decisionCopy(`Signed off ${release.id}.`, 'Assembler notice queued.', reply)
        );
        go(`/releases/${release.id}`);
        return;
      }
      reportFailure(reply);
    }

    async function shareAction(opener, lapses) {
      const regenerate = release.state === 'shared';
      setStatus(status, regenerate ? 'Updating link.' : 'Confirming derivatives.');
      const reply = await privileged({
        opener,
        needsReason: false,
        run: (proof) =>
          post(
            `/api/releases/${release.id}/${regenerate ? 'link/regenerate' : 'share'}`,
            { expires_at: lapses.value.trim() },
            { proof }
          ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 201) {
        setStatus(
          status,
          regenerate
            ? 'New link ready. The old link no longer works.'
            : `Shared ${release.id}. Every derivative is confirmed present.`
        );
        showLink(reply.body.url);
        await reload(false);
        return;
      }
      reportFailure(reply);
    }

    function showLink(url) {
      const full = window.location.origin + url;
      clear(linkBox);
      linkBox.append(el('a', { href: full, text: full, 'aria-label': 'Share link' }));
    }

    async function linkAction(opener, action) {
      setStatus(status, 'Updating link.');
      const reply = await privileged({
        opener,
        needsReason: false,
        run: (proof) => post(`/api/releases/${release.id}/link/${action}`, {}, { proof }),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200) {
        setStatus(status, 'Link revoked.');
        await reload(false);
        return;
      }
      reportFailure(reply);
    }

    async function openItem(item, opener) {
      setStatus(status, 'Preparing download.');
      const result = await claim(`/api/derivatives/${item.derivative_id}/download-grants`);
      if (result.grant.status === 503) {
        setStatus(
          status,
          'Download unavailable. Exhibit storage is unreachable. Your grant is still unused.',
          true
        );
        return;
      }
      if (result.grant.status !== 201) {
        setStatus(status, COPY.noLonger, true);
        return;
      }
      if (result.file && result.file.body instanceof Blob) {
        saveBlob(result.file.body, `${item.derivative_id}.bin`);
        setStatus(status, 'Download started.');
      }
      await reload(false);
    }

    function renderItems() {
      figure.textContent = String(release.items.length);
      syncRows(items.body, release.items, {
        key: (item) => item.id,
        signature: (item) =>
          `${item.label}|${item.superseded}|${item.opened_by_caller}|${release.state}`,
        build: (item) => {
          const actions = el('td');
          if (release.state === 'assembling') {
            actions.append(
              el('button', {
                type: 'button',
                text: `Remove ${item.label}`,
                on: {
                  click: async () => {
                    setStatus(status, 'Saving item.');
                    const reply = await remove(
                      `/api/releases/${release.id}/items/${item.id}`
                    );
                    if (reply.status === 200) {
                      setStatus(status, 'Item removed.');
                      await reload(false);
                      return;
                    }
                    setStatus(status, COPY.noLonger, true);
                  },
                },
              })
            );
          }
          if (release.state === 'submitted' && isLead() && !breakGlassHere()) {
            const open = el('button', {
              type: 'button',
              text: `Open ${item.label}`,
              on: { click: () => openItem(item, open) },
            });
            actions.append(open);
          }
          return el('tr', {}, [
            el('td', { class: 'mono', text: item.id }),
            el('td', { text: item.label }),
            el('td', { class: 'mono', text: String(item.size) }),
            el('td', {}, [
              item.superseded
                ? el('span', { class: 'mono' }, [icon('\u21BB'), ' Superseded'])
                : null,
              item.opened_by_caller
                ? el('span', { class: 'opened-mark' }, [icon('\u2713'), ' Opened'])
                : null,
            ]),
            actions,
          ]);
        },
      });
    }

    async function reload(background = true) {
      if (dead) return;
      const reply = await get(`/api/releases/${encodeURIComponent(releaseId)}`, {
        background,
      });
      if (reply.status === 404) {
        endAccess();
        return;
      }
      if (reply.status !== 200) return;
      release = reply.body;
      heading.textContent = release.name;
      stateLine.dataset.manifestDigest = release.manifest_digest;
      announce(stateLine, STATE_WORDS[release.state]);
      clear(meta);
      meta.append(
        el('span', { class: 'mono', text: release.id }),
        ' ',
        el('span', { class: 'mono', text: release.matter_ref }),
        ' ',
        el('span', { class: 'mono', text: `${release.total_bytes} bytes` })
      );
      const breaking = state.breakGlass.find(
        (item) => item.compartment_id === release.compartment_id
      );
      breakGlassTime.hidden = !breaking;
      if (breaking) {
        breakGlassTime.textContent = `Break-glass ends at ${String(breaking.ends_at).slice(11, 16)} UTC.`;
      }
      renderItems();
      await loadDerivatives();
      renderAssembly();
      renderDecisions();
    }

    await reload(false);

    return {
      refresh: async () => {
        await reload(true);
        await docketHandle.refresh(true);
      },
      dispose: () => {
        dead = true;
      },
    };
  },
};

export const reviews = {
  async mount(context) {
    const { docket, inspector } = context;
    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const count = el('p', {
      role: 'status',
      'aria-label': 'Review queue count',
      'aria-live': 'polite',
    });
    const queue = table('Review queue', ['Release', 'Name', 'Matter', 'Bytes', 'Items']);
    docket.append(
      figure,
      el('span', { dataset: { figureLabel: 'true' }, text: 'Waiting' }),
      el('h1', { text: 'Review queue' }),
      count,
      queue.node
    );
    inspector.append(el('p', { text: COPY.noRecord }));

    async function refresh(background = true) {
      const reply = await get('/api/reviews', { background });
      if (reply.status !== 200) return;
      const releases = reply.body.releases;
      figure.textContent = String(releases.length);
      announce(count, `${releases.length} waiting for a decision.`);
      syncRows(queue.body, releases, {
        key: (item) => item.id,
        signature: (item) => `${item.state}|${item.total_bytes}|${item.items.length}`,
        build: (item) =>
          el('tr', {}, [
            el('td', { class: 'mono' }, [
              el('a', {
                class: 'rowlink',
                href: `/releases/${item.id}`,
                'data-route': 'true',
                text: item.id,
              }),
            ]),
            el('td', { text: item.name }),
            el('td', { class: 'mono', text: item.matter_ref }),
            el('td', { class: 'mono', text: String(item.total_bytes) }),
            el('td', { class: 'mono', text: String(item.items.length) }),
          ]),
        onVanished: (row, bodyNode) => {
          const rows = Array.from(bodyNode.children);
          const target = rows.length ? rows[rows.length - 1].querySelector('a') : null;
          takeFocus(target || queue.node);
        },
      });
    }

    await refresh(false);
    return { refresh };
  },
};
