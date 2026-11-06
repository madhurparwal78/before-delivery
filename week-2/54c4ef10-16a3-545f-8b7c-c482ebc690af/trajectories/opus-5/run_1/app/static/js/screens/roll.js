// The roll page: upload, strips, alignment, contact sheet and shooting log.
import * as api from '../api.js';
import { COPY, FORMAT_LABELS, LIMITS, fill } from '../boot.js';
import { badge, el, field, setFieldError } from '../dom.js';
import { readDraft } from '../drafts.js';
import * as format from '../format.js';
import { activity, app } from '../main.js';
import { counterList, stateWord } from '../components/counters.js';
import { entryList, showsManual } from '../components/entries.js';
import { openOverrideDialog } from '../components/overridedialog.js';
import { blankFramePrint } from './notfound.js';

function proposalSentence(proposal) {
  if (!proposal) return '';
  if (proposal.proposed_offset === null) return COPY.success.proposal_none;
  const best = bestRho(proposal);
  const signedOffset = proposal.proposed_offset === 0
    ? '0'
    : (proposal.proposed_offset > 0 ? `+${proposal.proposed_offset}` : `\u2212${Math.abs(proposal.proposed_offset)}`);
  if (proposal.proposed_slip_after !== null && proposal.proposed_slip_after !== undefined) {
    return fill(COPY.success.proposal_slip, {
      offset: signedOffset,
      s: proposal.proposed_slip_after,
      rho: format.unsigned(best, 2),
    });
  }
  return fill(COPY.success.proposal_offset, {
    offset: signedOffset,
    rho: format.unsigned(best, 2),
  });
}

function bestRho(proposal) {
  const pool = proposal.proposed_slip_after !== null && proposal.proposed_slip_after !== undefined
    ? proposal.slip_candidates.filter(
      (candidate) => candidate.offset === proposal.proposed_offset
        && candidate.slip_after === proposal.proposed_slip_after,
    )
    : proposal.candidates.filter((candidate) => candidate.offset === proposal.proposed_offset);
  return pool.length ? pool[0].rho : null;
}

export async function render(context) {
  const rollId = context.params[0];
  const roll = await api.get(`/api/rolls/${rollId}`);
  const section = el('section', { class: 'roll-page' });
  const host = el('div', { class: 'roll-body' });
  section.append(host);

  async function reload() {
    const [fresh, scansBody, sheet, alignment] = await Promise.all([
      api.get(`/api/rolls/${rollId}`),
      api.get(`/api/rolls/${rollId}/scans`),
      api.get(`/api/rolls/${rollId}/contact-sheet`),
      api.get(`/api/rolls/${rollId}/alignment`),
    ]);
    host.replaceChildren(
      header(fresh),
      counters(fresh),
      uploadForm(fresh, scansBody.scans, reload),
      strips(scansBody.scans, fresh),
      alignmentControls(fresh, sheet, alignment, reload),
      contactSheet(fresh, sheet, scansBody.scans, alignment),
      shootingLog(fresh, sheet, alignment, reload),
    );
  }

  await reload();
  return section;
}

function header(roll) {
  return el('header', { class: 'roll-header' }, [
    el('h1', { text: roll.name }),
    el('p', { class: 'muted figures' }, [
      el('span', { text: `${roll.stock} · EI ${roll.ei} · ` }),
      el('span', {
        text: `Push or pull ${format.signed(roll.push_pull, 0).replace('.00', '')} · `,
      }),
      el('span', { text: `Reciprocity exponent ${format.exponent(roll.reciprocity_p)} · ` }),
      el('span', { text: FORMAT_LABELS[roll.format] }),
    ]),
    el('p', { class: 'muted', text: roll.development_note }),
    el('p', { class: 'state', text: stateWord(roll.state) }),
    el('a', { href: `/rolls/${roll.id}/edit`, text: 'Edit roll' }),
  ]);
}

function counters(roll) {
  return el('section', {
    role: 'region',
    'aria-label': 'Roll counters',
    class: 'roll-counters',
  }, [counterList(roll.counters)]);
}

function uploadForm(roll, scans, reload) {
  const fileField = field('Strip scan', el('input', { type: 'file', accept: '.png,.tif,.tiff' }));
  const dpiField = field('Scan DPI', el('input', {
    type: 'number', min: 300, max: 10000, step: 1, value: 1200,
  }));
  const edgeField = field('First edge number', el('input', {
    type: 'number', min: 0, max: 99, step: 1, value: 1,
  }));
  const submit = el('button', { type: 'submit', class: 'solid', text: 'Upload strip' });
  const progressHost = el('div', { class: 'progress-host' });
  const form = el('form', { class: 'upload', novalidate: true }, [
    fileField.wrapper,
    dpiField.wrapper,
    edgeField.wrapper,
    submit,
    progressHost,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFieldError(fileField, '');
    setFieldError(dpiField, '');
    setFieldError(edgeField, '');
    const file = fileField.control.files[0];
    if (!file) return;
    if (file.size > LIMITS.upload_bytes) {
      setFieldError(fileField, COPY.error.too_large);
      activity(COPY.error.too_large);
      fileField.control.focus();
      return;
    }
    submit.disabled = true;
    const bar = el('div', {
      role: 'progressbar',
      'aria-label': 'Upload progress',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
      class: 'progress',
    }, [el('span', { class: 'progress-fill' })]);
    progressHost.append(bar);
    activity(fill(COPY.pending.upload, { filename: file.name }));
    try {
      const sha256 = await api.fileDigest(file);
      const scan = await api.uploadStrip({
        rollId: roll.id,
        file,
        dpi: Number(dpiField.control.value),
        firstEdge: Number(edgeField.control.value),
        size: file.size,
        sha256,
        onProgress: (percent) => {
          bar.setAttribute('aria-valuenow', String(percent));
          bar.firstChild.style.width = `${percent}%`;
        },
      });
      activity(fill(COPY.success.upload, { filename: file.name }));
      await reload();
      focusStrip(scan.position);
    } catch (failure) {
      handleUploadFailure(failure, { file, fileField, dpiField, edgeField, submit, scans });
    } finally {
      bar.remove();
      submit.disabled = false;
    }
  });
  return form;
}

function focusStrip(position) {
  const link = document.querySelector(`[data-strip="${position}"] a`);
  if (link) link.focus();
}

function handleUploadFailure(failure, context) {
  const { fileField, dpiField, edgeField, submit, scans } = context;
  if (failure.status === 0) {
    activity(COPY.success.upload_failed);
    submit.focus();
    return;
  }
  if (failure.status === 409 && failure.code === 'duplicate_scan') {
    activity(COPY.error.duplicate_scan);
    const existing = scans.find((scan) => scan.id === failure.body.scan_id);
    if (existing) focusStrip(existing.position);
    return;
  }
  if (failure.status === 413 || failure.status === 415) {
    const copy = COPY.error[failure.code] || COPY.error.too_large;
    setFieldError(fileField, copy);
    activity(copy);
    fileField.control.focus();
    return;
  }
  if (failure.status === 422) {
    const fileMessages = ['size', 'sha256', 'file']
      .filter((key) => failure.fields[key])
      .map((key) => failure.fields[key]);
    if (fileMessages.length > 0) {
      setFieldError(fileField, fileMessages.join('\n'));
    }
    if (failure.fields.dpi) setFieldError(dpiField, failure.fields.dpi);
    if (failure.fields.first_edge) setFieldError(edgeField, failure.fields.first_edge);
    const first = fileMessages[0] || failure.fields.dpi || failure.fields.first_edge;
    activity(first || '');
    if (fileMessages.length > 0) fileField.control.focus();
    else if (failure.fields.dpi) dpiField.control.focus();
    else if (failure.fields.first_edge) edgeField.control.focus();
    return;
  }
  if (failure.status === 503) {
    activity(COPY.error.storage_unavailable_upload);
    submit.focus();
    return;
  }
  activity(COPY.error[failure.code] || '');
}

function strips(scans, roll) {
  if (scans.length === 0) {
    return el('div', { class: 'empty-state' }, [
      blankFramePrint(),
      el('p', { class: 'muted', text: COPY.empty.no_strips }),
    ]);
  }
  return el(
    'ul',
    { class: 'strips', role: 'list', 'aria-label': 'Strips' },
    scans.map((scan) => el('li', {
      class: 'strip-item',
      dataset: { strip: String(scan.position) },
    }, [
      el('a', {
        href: `/rolls/${roll.id}/scans/${scan.id}`,
        text: `Strip ${scan.position}`,
      }),
      el('span', { class: 'state', text: stateWord(scan.state) }),
      el('span', { class: 'figures', text: `${scan.size} bytes` }),
      el('span', { class: 'figures', text: scan.sha256.slice(0, 12) }),
      el('a', {
        href: `/api/scans/${scan.id}/original`,
        text: 'Download original',
        target: '_blank',
        rel: 'noopener',
      }),
    ])),
  );
}

function alignmentControls(roll, sheet, alignment, reload) {
  const sentence = el('p', {
    class: 'muted proposal',
    text: proposalSentence(alignment.proposal),
  });
  const propose = el('button', { type: 'button', class: 'solid', text: 'Propose alignment' });
  const accept = el('button', {
    type: 'button',
    class: 'solid',
    text: 'Accept proposed offset',
    disabled: !(alignment.proposal && alignment.proposal.proposed_offset !== null),
  });
  const override = el('button', { type: 'button', class: 'ghost', text: 'Override alignment' });

  propose.addEventListener('click', async () => {
    activity(COPY.pending.proposal);
    try {
      const proposal = await api.post(`/api/rolls/${roll.id}/alignment/proposal`);
      activity(proposalSentence(proposal));
      sentence.textContent = proposalSentence(proposal);
      accept.disabled = proposal.proposed_offset === null;
      alignment.proposal = proposal;
    } catch (failure) {
      activity(COPY.error[failure.code] || '');
    }
  });

  accept.addEventListener('click', async () => {
    const proposal = alignment.proposal;
    if (!proposal || proposal.proposed_offset === null) return;
    activity(COPY.pending.alignment);
    try {
      const saved = await api.put(`/api/rolls/${roll.id}/alignment`, {
        version: alignment.version,
        offset: proposal.proposed_offset,
        slip_after: proposal.proposed_slip_after,
        overrides: alignment.overrides,
      });
      activity(fill(COPY.success.alignment, {
        aligned: saved.counters.aligned,
        unmatched: saved.counters.unmatched_notes,
      }));
      await reload();
    } catch (failure) {
      if (failure.status === 412) {
        activity(COPY.error.stale_alignment);
        return;
      }
      activity(COPY.error[failure.code] || Object.values(failure.fields)[0] || '');
    }
  });

  override.addEventListener('click', () => {
    openOverrideDialog({
      roll,
      entries: sheet.entries,
      frames: sheet.frames,
      alignment,
      opener: override,
      onSaved: reload,
    });
  });

  return el('section', { class: 'alignment' }, [
    el('h2', { text: 'Alignment' }),
    el('div', { class: 'row' }, [propose, accept, override]),
    sentence,
  ]);
}

function contactSheet(roll, sheet, scans, alignment) {
  if (sheet.frames.length === 0) {
    return el('div', { class: 'empty-state' }, [
      blankFramePrint(),
      el('p', { class: 'muted', text: 'No frames yet.' }),
    ]);
  }
  const entriesById = new Map(sheet.entries.map((entry) => [entry.id, entry]));
  return el(
    'ul',
    { class: 'contact-sheet', role: 'list', 'aria-label': 'Contact sheet' },
    sheet.frames.map((frame) => {
      const entry = frame.entry_id ? entriesById.get(frame.entry_id) : null;
      return el('li', { class: 'frame-card' }, [
        el('a', {
          href: `/rolls/${roll.id}/scans/${frame.scan_id}?frame=${frame.number}`,
          text: `Open frame ${frame.number}`,
          class: 'frame-open',
        }),
        el('span', { class: 'figures', text: `Frame ${frame.number}` }),
        el('span', { class: 'figures', text: `Edge ${frame.edge_number}` }),
        el('span', { text: frame.title }),
        el('span', { text: entry ? `Note ${entry.counter}` : 'No note' }),
        frame.unexposed ? badge('Unexposed') : null,
        frame.flag === 'flagged' ? badge('Flagged') : null,
        frame.blank_slot ? badge('Blank slot') : null,
        entry && showsManual(entry, alignment) ? badge('Manual') : null,
      ]);
    }),
  );
}

function shootingLog(roll, sheet, alignment, reload) {
  const draft = readDraft(app.account ? app.account.id : null);
  const restore = draft && draft.kind === 'note'
    && draft.path === window.location.pathname + window.location.search
    ? draft
    : null;
  if (sheet.entries.length === 0) {
    return el('p', { class: 'muted', text: 'No notes yet.' });
  }
  return entryList('Shooting log', sheet.entries, {
    roll,
    alignment,
    reload,
    restore,
  });
}
