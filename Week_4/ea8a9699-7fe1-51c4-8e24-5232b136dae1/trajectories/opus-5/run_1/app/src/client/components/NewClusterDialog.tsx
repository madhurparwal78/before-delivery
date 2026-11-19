import { useState } from 'react';
import { ApiFailure, apiSend } from '../lib/api.js';
import { Dialog } from './Dialog.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from './ErrorSummary.js';
import type { Cluster } from '../../shared/types.js';

const formName = 'new-cluster';

interface NewClusterDialogProps {
  workspaceSlug: string;
  workspaceName: string;
  onClose: () => void;
  onCreated: (cluster: Cluster) => void;
  onSeatMissing: () => void;
}

export function NewClusterDialog({
  workspaceSlug,
  workspaceName,
  onClose,
  onCreated,
  onSeatMissing,
}: NewClusterDialogProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [publicDescription, setPublicDescription] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [errors, setErrors] = useState<FormErrors>(noFormErrors);
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      const cluster = await apiSend<Cluster>('POST', `/api/workspaces/${workspaceSlug}/clusters`, {
        title,
        publicDescription,
        internalNote,
      });
      onCreated(cluster);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'seat_required') {
        onSeatMissing();
        onClose();
        return;
      }
      setErrors({ fields: error instanceof ApiFailure ? error.fieldErrors : {}, token: Date.now() });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog name="New cluster" onClose={onClose}>
      <h2>New cluster in {workspaceName}</h2>
      <ErrorSummary formName={formName} errors={errors} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor={`${formName}-title`}>Title</label>
          <input
            type="text"
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            {...fieldProps(formName, 'title', errors)}
          />
          <FieldError formName={formName} field="title" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor={`${formName}-publicDescription`}>Public description</label>
          <textarea
            value={publicDescription}
            onChange={(event) => setPublicDescription(event.target.value)}
            {...fieldProps(formName, 'publicDescription', errors)}
          />
          <FieldError formName={formName} field="publicDescription" errors={errors} />
        </div>
        <div className="field">
          <label htmlFor={`${formName}-internalNote`}>Internal note</label>
          <textarea
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
            {...fieldProps(formName, 'internalNote', errors)}
          />
          <FieldError formName={formName} field="internalNote" errors={errors} />
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={pending}>
            Create cluster
          </button>
        </div>
      </form>
    </Dialog>
  );
}
