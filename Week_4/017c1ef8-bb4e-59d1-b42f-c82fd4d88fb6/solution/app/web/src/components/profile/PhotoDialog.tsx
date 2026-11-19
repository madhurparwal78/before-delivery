import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { announce } from '../../announce';
import { formatCount } from '../../format';
import type { Profile } from '../../types';
import { Alert, Button, Dialog } from '../../ui';

interface Uploaded {
  photo_id: string;
  url: string;
}

interface Props {
  profile: Profile;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/** Photo upload failures, in the brief's words. */
function uploadProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.body.error === 'photo_too_large') return `Photos can be up to ${formatCount(Number(error.body.limit))} bytes.`;
    if (error.body.error === 'photo_type') return 'Choose a JPEG or PNG image.';
    if (error.status === 503) return 'Uploads are unavailable right now. Try again later.';
  }
  return 'Something went wrong. Try again.';
}

/** Change photo: a chosen file uploads at once and counts as attached only after storage confirms it; Save then sets it. */
export function PhotoDialog({ profile, open, onClose, onSaved }: Props) {
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!open) return;
    setUploaded(null);
    setUploading(false);
    setProblem('');
  }, [open]);

  const choose = async (file: File): Promise<void> => {
    setProblem('');
    setUploaded(null);
    setUploading(true);
    announce('Feed announcements', 'Uploading…');
    try {
      const stored = await api.upload<Uploaded>('/api/uploads/photo', file, file.name);
      setUploaded(stored);
      announce('Feed announcements', 'Photo attached.');
    } catch (error) {
      setProblem(uploadProblem(error));
    } finally {
      setUploading(false);
    }
  };

  const finish = async (change: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await change();
      announce('Profile announcements', 'Section saved.');
      onClose();
      await onSaved();
    } catch (error) {
      setProblem(uploadProblem(error));
    } finally {
      setBusy(false);
    }
  };

  const shown = uploaded?.url ?? profile.photo_url ?? null;

  return (
    <Dialog name="Change photo" open={open} onClose={onClose}>
      <h2 className="pf-dialog-title">Change photo</h2>
      <div className="stack-s">
        {shown ? <img className="pf-photo" src={shown} alt="" /> : null}
        <div className="field">
          <label htmlFor="field-photo" className="field-label">
            Photo
          </label>
          <input
            id="field-photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png"
            className="pf-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void choose(file);
              event.target.value = '';
            }}
          />
        </div>
        {uploading ? <p>Uploading…</p> : null}
        <Alert>{problem}</Alert>
        <div className="dialog-actions">
          <Button disabled={busy || uploading || !uploaded} onClick={() => uploaded && void finish(() => api.put('/api/me/photo', { photo_id: uploaded.photo_id }))}>
            Save
          </Button>
          {profile.photo_url && !uploaded ? (
            <Button className="pf-quiet" disabled={busy || uploading} onClick={() => void finish(() => api.delete('/api/me/photo'))}>
              Remove photo
            </Button>
          ) : null}
          <Button className="pf-quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
