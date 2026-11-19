import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { SOMETHING_WENT_WRONG } from './jobModel';
import { Alert, Button, Dialog } from '../../ui';
import { HistoryList } from './HistoryList';
import type { ApplicationObject } from './jobModel';

export interface ApplicationTarget {
  id: string;
  name: string;
}

/** The poster's view of one application. Opening it counts as the poster opening the application. */
export function ApplicationDialog({ target, onClose }: { target: ApplicationTarget | null; onClose: () => void }) {
  const shown = useRef<ApplicationTarget | null>(target);
  if (target) shown.current = target;
  const [application, setApplication] = useState<ApplicationObject | null>(null);
  const [alert, setAlert] = useState('');

  useEffect(() => {
    if (!target) return;
    setApplication(null);
    setAlert('');
    api.get<ApplicationObject>(`/api/applications/${target.id}`).then(setApplication, () => setAlert(SOMETHING_WENT_WRONG));
  }, [target?.id]);

  const name = shown.current?.name ?? '';
  return (
    <Dialog name={`Application from ${name}`} open={target !== null} onClose={onClose}>
      <div className="stack">
        <h2 className="t-larger">{`Application from ${name}`}</h2>
        {application ? (
          <>
            <p className="muted">{application.applicant?.headline}</p>
            <p className="t-larger">{application.status_text}</p>
            {application.resume_url ? (
              <a href={application.resume_url} download>
                Download resume
              </a>
            ) : null}
            <HistoryList title={application.job.title} history={application.history} viewer="poster" />
          </>
        ) : null}
        <Alert>{alert}</Alert>
        <div className="dialog-actions">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
