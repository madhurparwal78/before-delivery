import type { GateError } from '../../shared/types';
import { copy } from '../../shared/copy';
import { GateRows } from './Margin';
import { Modal } from './ui';

export type PublishView =
  | { kind: 'blocked'; errors: GateError[] }
  | { kind: 'confirm'; changed: number; busy: boolean; error: string | null };

interface PublishDialogProps {
  view: PublishView;
  versionTitle: string;
  returnTo: HTMLElement | null;
  onJump: (error: GateError) => void;
  onPublish: () => void;
  onClose: () => void;
}

/** The blocked view lists the problems; the confirm view asks. Both are named by their heading. */
export function PublishDialog(props: PublishDialogProps) {
  const { view } = props;
  if (view.kind === 'blocked') {
    return (
      <Modal title={copy.blockedHeading(view.errors.length)} onClose={props.onClose} returnTo={props.returnTo} focusHeading>
        <GateRows errors={view.errors} onJump={props.onJump} />
        <div class="actions">
          <button type="button" class="button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={copy.confirmHeading(props.versionTitle)} onClose={props.onClose} returnTo={props.returnTo} focusHeading>
      <p>{copy.confirmText(view.changed)}</p>
      {view.error && <p class="field-error">{view.error}</p>}
      <div class="actions">
        <button type="button" class="button" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" class="button primary" aria-busy={view.busy ? 'true' : undefined} onClick={props.onPublish}>
          Publish now
        </button>
      </div>
    </Modal>
  );
}
