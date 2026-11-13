import { formatAperture } from '../shared/optics.js';
import type { Observation } from '../shared/types.js';
import { openDialog } from './dialogs.js';
import { enqueue } from './journal.js';
import { dropDraft } from './drafts.js';
import { sendSoon } from './sync.js';

/** The muted details line shared by history rows and session rows. */
export function observationDetails(observation: Observation): string {
  const time =
    observation.local_time && observation.local_offset
      ? ` · ${observation.local_time} local, UTC${observation.local_offset}`
      : '';
  return (
    `${observation.evening_date}${time} · ` +
    `${formatAperture(observation.derived.aperture_mm)} mm · ${observation.derived.magnification}×`
  );
}

export function askToDeleteObservation(options: {
  observation: Observation;
  opener: HTMLElement;
  afterQueued: () => void;
}): void {
  const { observation } = options;
  openDialog({
    name: 'Delete observation?',
    text: `Delete ${observation.designation} from the evening of ${observation.evening_date}? This can't be undone.`,
    confirmLabel: 'Delete',
    cancelLabel: 'Keep observation',
    opener: options.opener,
    onConfirm: () => {
      void (async () => {
        await enqueue(
          {
            client_op_id: crypto.randomUUID(),
            kind: 'observation.delete',
            observation_id: observation.id,
            base_version: observation.version,
          },
          {
            designation: observation.designation,
            evening_date: observation.evening_date,
            observation_id: observation.id,
          },
        );
        await dropDraft(observation.id);
        sendSoon();
        options.afterQueued();
      })();
    },
  });
}
