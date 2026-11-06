// The Roll page: header, counters, upload, strips, alignment, contact sheet and shooting log.
import { get, post, put } from '../api.js';
import { failureCopy } from '../copy.js';
import { announce, field, h, replace } from '../dom.js';
import { fixed, signedWhole } from '../format.js';
import { paintProcedural } from '../prints.js';
import { PreviewUnavailable, drawFrameCrop } from '../tint.js';
import { STATE_WORDS, counters } from './archive.js';
import { entryList, isManual } from './entry_list.js';
import { notFoundPage } from './shared.js';
import { takeDraft } from '../session.js';
import { openOverrideDialog } from './override_dialog.js';
import { uploadStrip } from './upload.js';

function proposalSentence(proposal) {
  if (proposal.proposed_offset === null) return 'Not enough exposed frames to propose an offset. Choose one in Override alignment.';
  const slip = proposal.proposed_slip_after;
  const candidate = slip === null
    ? proposal.candidates.find((c) => c.offset === proposal.proposed_offset)
    : proposal.slip_candidates.find((c) => c.offset === proposal.proposed_offset && c.slip_after === slip);
  const offset = signedWhole(proposal.proposed_offset);
  const rho = `ρ ${fixed(candidate.rho)}`;
  return slip === null ? `Proposed offset ${offset} (${rho}).` : `Proposed offset ${offset}, slip after note ${slip} (${rho}).`;
}

export async function render(main, { params }) {
  const rollId = params[0];
  const first = await get(`/api/rolls/${rollId}`);
  if (!first.ok) return notFoundPage(main);
  const state = {};

  async function load() {
    const [roll, entries, scans, sheet, alignment] = await Promise.all([
      get(`/api/rolls/${rollId}`), get(`/api/rolls/${rollId}/entries`), get(`/api/rolls/${rollId}/scans`),
      get(`/api/rolls/${rollId}/contact-sheet`), get(`/api/rolls/${rollId}/alignment`)]);
    Object.assign(state, { roll: roll.data, entries: entries.data.entries, scans: scans.data.scans, sheet: sheet.data,
      alignment: alignment.data });
  }
  await load();

  const header = h('header', { class: 'page-head' });
  const counterRegion = h('section', { 'aria-label': 'Roll counters', class: 'section' });
  const stripsHolder = h('div', {});
  const proposalText = h('p', { class: 'muted' });
  const propose = h('button', { type: 'button' }, 'Propose alignment');
  const accept = h('button', { type: 'button' }, 'Accept proposed offset');
  const override = h('button', { type: 'button' }, 'Override alignment');
  const contact = h('ul', { role: 'list', 'aria-label': 'Contact sheet', class: 'contact' });
  const logContext = {
    rolls: new Map(), frameNumbers: new Map(), manual: new Map(), showRoll: false, entryById: (id) => state.entries.find((e) => e.id === id),
    onChange: async () => { await refresh(); },
  };
  const log = entryList('Shooting log', [], logContext);

  async function refresh() {
    await load();
    paint();
  }

  function paint() {
    const { roll, scans, sheet, alignment } = state;
    replace(header, h('h1', {}, roll.name),
      h('p', { class: 'muted' }, `${roll.stock} · EI ${roll.ei}`),
      h('p', { class: 'small' }, `Push or pull ${signedWhole(roll.push_pull)} · Reciprocity exponent ${roll.reciprocity_p.toFixed(2)}`),
      roll.development_note ? h('p', {}, roll.development_note) : null,
      h('p', { class: 'state-word' }, STATE_WORDS[roll.state]),
      h('a', { class: 'button', href: `/rolls/${roll.id}/edit` }, 'Edit roll'));
    replace(counterRegion, counters(roll));
    paintStrips(scans);
    const proposal = alignment.proposal;
    proposalText.textContent = proposal ? proposalSentence(proposal) : '';
    accept.disabled = !(proposal && proposal.proposed_offset !== null);
    const numbers = new Map(sheet.frames.map((frame) => [frame.id, frame.number]));
    const entryOf = new Map(state.entries.filter((e) => e.frame_id).map((e) => [e.frame_id, e]));
    replace(contact, ...sheet.frames.map((frame) => contactItem(frame, entryOf.get(frame.id), alignment.source === 'manual')));
    logContext.rolls.set(roll.id, roll);
    logContext.frameNumbers = numbers;
    logContext.manual.set(roll.id, alignment.source === 'manual');
    log.paint(state.entries);
  }

  function paintStrips(scans) {
    const items = scans.map((scan) => h('li', {}, h('div', { class: 'row-meta' },
      h('a', { href: `/rolls/${rollId}/scans/${scan.id}` }, `Strip ${scan.position}`),
      h('span', {}, STATE_WORDS[scan.state] ?? scan.state[0].toUpperCase() + scan.state.slice(1)),
      h('span', { class: 'muted' }, `${scan.size} bytes`), h('span', { class: 'muted' }, scan.sha256.slice(0, 12)),
      h('a', { href: `/api/scans/${scan.id}/original`, download: scan.filename }, 'Download original'))));
    const empty = scans.length === 0 ? emptyStrips() : null;
    replace(stripsHolder, h('ul', { role: 'list', 'aria-label': 'Strips', class: 'rows' }, items), empty);
  }

  function emptyStrips() {
    const blank = h('canvas', { 'aria-hidden': 'true', class: 'blank-frame' });
    queueMicrotask(() => paintProcedural(blank, 'blank'));
    return h('div', { class: 'empty' }, blank, h('p', {}, 'No strips yet.'));
  }

  function contactItem(frame, entry, manualAlignment) {
    const scan = state.scans.find((s) => s.id === frame.scan_id);
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    drawFrameCrop(canvas, scan, frame).catch((error) => {
      if (!(error instanceof PreviewUnavailable)) throw error;
      canvas.style.aspectRatio = '4 / 3';
      paintProcedural(canvas, 'blank');
    });
    const manual = entry && isManual(entry, manualAlignment);
    return h('li', {},
      h('a', { href: `/rolls/${rollId}/scans/${frame.scan_id}?frame=${frame.number}`, 'aria-label': `Open frame ${frame.number}` }, canvas),
      h('div', { class: 'meta' },
        h('p', {}, h('strong', {}, `Frame ${frame.number}`), ' ', `Edge ${frame.edge_number}`, frame.title ? ` · ${frame.title}` : ''),
        h('p', { class: 'muted' }, entry ? `Note ${entry.counter}` : 'No note'),
        frame.blank_slot ? h('span', { class: 'badge' }, 'Blank slot') : null,
        frame.unexposed ? h('span', { class: 'badge' }, 'Unexposed') : null,
        frame.flag === 'flagged' ? h('span', { class: 'badge' }, 'Flagged') : null,
        manual ? h('span', { class: 'badge' }, 'Manual') : null));
  }

  async function saveAlignment(body) {
    announce('Saving alignment…');
    const response = await put(`/api/rolls/${rollId}/alignment`, { version: state.alignment.version, ...body });
    if (!response.ok) {
      announce(failureCopy(response));
      return response;
    }
    const counts = response.data.counters;
    announce(`Alignment saved: ${counts.aligned} notes matched, ${counts.unmatched_notes} unmatched.`);
    await refresh();
    return response;
  }

  propose.addEventListener('click', async () => {
    announce('Comparing notes with frames…');
    const response = await post(`/api/rolls/${rollId}/alignment/proposal`);
    if (!response.ok) {
      announce(failureCopy(response));
      return;
    }
    state.alignment.proposal = response.data;
    proposalText.textContent = proposalSentence(response.data);
    accept.disabled = response.data.proposed_offset === null;
    announce(proposalSentence(response.data));
  });
  accept.addEventListener('click', () => {
    const { proposal, overrides } = state.alignment;
    saveAlignment({ offset: proposal.proposed_offset, slip_after: proposal.proposed_slip_after, overrides });
  });
  override.addEventListener('click', () => openOverrideDialog(override, state, saveAlignment));

  const upload = buildUpload();
  function buildUpload() {
    const file = h('input', { type: 'file', accept: '.png,.tif,.tiff,image/png,image/tiff' });
    const dpi = h('input', { type: 'number', step: 1, value: 1200 });
    const edge = h('input', { type: 'number', step: 1, value: 1 });
    const fields = { file: field('Strip scan', file), dpi: field('Scan DPI', dpi), first_edge: field('First edge number', edge) };
    const send = h('button', { type: 'submit', class: 'primary' }, 'Upload strip');
    const progress = h('div', { role: 'progressbar', 'aria-label': 'Upload progress', 'aria-valuemin': 0, 'aria-valuemax': 100, class: 'progress', hidden: true },
      h('div', {}));
    const form = h('form', { class: 'form', novalidate: true }, fields.file.root, fields.dpi.root, fields.first_edge.root, send, progress);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      uploadStrip({ rollId, file, dpi, edge, fields, send, progress, refresh });
    });
    return form;
  }

  main.append(header, counterRegion,
    h('section', { class: 'section' }, h('h2', {}, 'Upload a strip'), upload),
    h('section', { class: 'section' }, h('h2', {}, 'Strips'), stripsHolder),
    h('section', { class: 'section' }, h('h2', {}, 'Alignment'),
      h('div', { class: 'actions', style: 'display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px' }, propose, accept, override), proposalText),
    h('section', { class: 'section' }, h('h2', {}, 'Contact sheet'), contact),
    h('section', { class: 'section' }, h('h2', {}, 'Shooting log'), log.root));
  paint();
  const kept = takeDraft('note');
  if (kept && kept.url === location.pathname + location.search) log.restore(kept);
  return undefined;
}
