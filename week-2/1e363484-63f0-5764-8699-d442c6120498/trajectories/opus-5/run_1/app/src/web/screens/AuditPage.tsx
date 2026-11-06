import { useEffect, useState } from 'react';
import { api, hasStatus, type MovedReading } from '../api';
import { MovedReadingsTable } from '../components/Tables';
import { COPY } from '../copy';
import { setNotice } from '../notice';
import { navigate } from '../router';

export interface AuditPageProps {
  readonly figureId: string;
}

export function AuditPage({ figureId }: AuditPageProps): React.ReactElement {
  const [moved, setMoved] = useState<MovedReading[] | null>(null);

  useEffect(() => {
    void api
      .figureAudit(figureId)
      .then((result) => setMoved(result.moved))
      .catch((error: unknown) => {
        if (hasStatus(error, 404)) {
          setNotice(COPY.lostAccess);
          navigate('/projects');
        } else if (hasStatus(error, 401)) navigate('/signin');
      });
  }, [figureId]);

  return (
    <div className="app-shell reading-column">
      <h1>Readings audit trail for {figureId}</h1>
      {moved !== null && moved.length === 0 ? <p>{COPY.auditEmpty}</p> : null}
      {moved !== null && moved.length > 0 ? <MovedReadingsTable moved={moved} /> : null}
    </div>
  );
}
