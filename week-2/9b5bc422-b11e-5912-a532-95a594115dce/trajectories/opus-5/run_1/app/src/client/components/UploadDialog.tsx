import { empty } from '../../domain/copy.ts';
import { useStore } from '../hooks.ts';
import { account } from '../store/sync.ts';
import { Dialog } from './Dialog.tsx';

export function UploadDialog() {
  const state = useStore();
  const count = [...state.workspace.documents.values()].filter(
    (document) => document.kind === 'document' && !document.trashed,
  ).length;

  return (
    <Dialog name="Upload this workspace?" onClose={() => account.closeUploadDialog()}>
      <h2 className="display">Upload this workspace?</h2>
      <p>{empty.uploadDialogBody(count)}</p>
      <div className="dialog-actions">
        <button type="button" className="button" data-autofocus onClick={() => void account.chooseUpload()}>
          Upload this workspace
        </button>
        <button type="button" className="button" onClick={() => void account.chooseKeep()}>
          Keep it on this device
        </button>
      </div>
    </Dialog>
  );
}
