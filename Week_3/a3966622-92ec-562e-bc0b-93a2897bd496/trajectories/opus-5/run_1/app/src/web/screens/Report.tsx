import { useEffect, useState } from 'react';
import { DEFECT_NAMES } from '../../domain/defects.ts';
import { send } from '../api.ts';
import { LADDER_REFUSED_HEADING } from '../format.ts';
import type { LadderReport } from '../types.ts';
import { NotFound } from './NotFound.tsx';

export function ReportScreen({ id }: { id: string }): JSX.Element {
  const [report, setReport] = useState<LadderReport | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void (async () => {
      const reply = await send<LadderReport>(
        'GET',
        `/api/ladder-reports/${encodeURIComponent(id)}`,
      ).catch(() => null);
      if (reply === null) return;
      if (!reply.ok) {
        setMissing(true);
        return;
      }
      setReport(reply.data);
    })();
  }, [id]);

  if (missing) return <NotFound />;
  if (report === null) return <p>Loading...</p>;

  return (
    <section className="pane" aria-label={`Ladder report ${report.id}`}>
      <h1>{`Ladder report ${report.id}`}</h1>
      {report.refused && <h2>{LADDER_REFUSED_HEADING}</h2>}
      <div className="rows">
        <div className="row">
          <span>{report.compliant ? 'Compliant' : 'Non-compliant'}</span>
          <span className="mono">{report.move_ref}</span>
          <span>{report.location === 'deck' ? 'Filed from deck' : 'Filed from pilot boat'}</span>
          <span className="mono">{report.filed_at.replace('T', ' ')}</span>
          <span>{report.filed_by}</span>
        </div>
      </div>
      <h3>Defects</h3>
      <ul aria-label="Defects">
        {report.defects.map((code) => (
          <li key={code}>{DEFECT_NAMES[code] ?? code}</li>
        ))}
        {report.defects.length === 0 && <li className="dim">No defects</li>}
      </ul>
      {report.note !== '' && <p>{report.note}</p>}
      <h3>Photos</h3>
      <ul aria-label="Photos">
        {report.photos.map((photo, index) => (
          <li key={photo.photo_id}>
            <a href={`/api/photos/${photo.photo_id}/content`}>{`Download photo ${index + 1}`}</a>
            <span className="mono">{` SHA-256 ${photo.sha256}`}</span>
          </li>
        ))}
        {report.photos.length === 0 && <li className="dim">No photos</li>}
      </ul>
      <p>
        <a href={`/moves/${report.move_ref}`}>{`Open ${report.move_ref}`}</a>
      </p>
    </section>
  );
}
