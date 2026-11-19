// The Choose calibration dialog: link a ready or stale calibration set to one batch.
import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { createDialog } from '../core/dialog.js';
import { staleWarning, stateWord } from '../core/format.js';

// onLinked(batch) is called after the server accepted the link.
export async function openCalibrationChooser({ batch, opener, onLinked }) {
  const [{ candidates }, { calibration_sets: sets }] = await Promise.all([
    api('GET', `/api/batches/${batch.id}/calibration-candidates`),
    api('GET', '/api/calibration-sets'),
  ]);
  const maxAge = new Map(sets.map((set) => [set.id, set.max_age_days]));
  const dialog = createDialog({ name: 'Choose calibration' });
  const result = liveRegion('Calibration result');
  const usable = candidates.filter((candidate) => candidate.status === 'ready' || candidate.status === 'stale');

  async function link(candidate) {
    try {
      const reply = await api('POST', `/api/batches/${batch.id}/calibration`, { body: { calibration_set_id: candidate.calibration_set_id } });
      await onLinked(reply.batch);
      announce(result, reply.warning === 'stale' ? staleWarning(maxAge.get(candidate.calibration_set_id)) : `${candidate.name} will calibrate this batch.`);
    } catch (error) {
      announce(result, error.message);
    }
  }

  dialog.body.append(
    usable.length
      ? h('ul', { class: 'candidate-list', role: 'list' }, usable.map((candidate) => h('li', { class: 'candidate' },
        h('div', {},
          h('strong', {}, candidate.name),
          h('p', { class: 'muted' }, `${stateWord(candidate.kind)} set, ${candidate.status}. ${candidate.matches ? 'Matches this batch.' : candidate.reasons.join('; ')}`)),
        h('button', { type: 'button', class: 'btn', onclick: () => link(candidate) }, `Use ${candidate.name}`))))
      : h('p', {}, 'No ready calibration sets yet. Add a set in the Library and mark it ready.'),
    result);
  dialog.actions.append(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Done'));
  dialog.open(opener);
}
