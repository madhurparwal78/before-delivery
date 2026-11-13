import { useState } from 'react';
import { DEFECT_NAMES } from '../../domain/defects.ts';
import { NoReply, send } from '../api.ts';
import { NO_REPLY } from '../format.ts';
import { useKeyedControl } from '../hooks.ts';
import type { LadderReport, Move } from '../types.ts';
import { FormErrors } from './FormErrors.tsx';
import { Panel } from './Panel.tsx';

type StoredPhoto = { photo_id: string; sha256: string };

export function LadderReportDialog({
  move,
  open,
  onClose,
  onFiled,
}: {
  move: Move;
  open: boolean;
  onClose: () => void;
  onFiled: () => void;
}): JSX.Element {
  const [compliant, setCompliant] = useState<boolean | null>(null);
  const [location, setLocation] = useState<'deck' | 'pilot_boat'>('deck');
  const [defects, setDefects] = useState<string[]>([]);
  const [refuse, setRefuse] = useState(false);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [failedPhoto, setFailedPhoto] = useState<File | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const control = useKeyedControl();

  const upload = (file: File): void => {
    setAnnouncement('Uploading photo...');
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        const reply = await send<{ photo_id: string; sha256: string }>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/photos`,
          { bytes: { data: bytes, contentType: file.type } },
        );
        if (reply.ok) {
          setPhotos((current) => [...current, reply.data]);
          setFailedPhoto(null);
          setAnnouncement(`Photo stored. SHA-256 ${reply.data.sha256}`);
          return;
        }
        setFailedPhoto(file);
        if (reply.status === 503) {
          setAnnouncement('Evidence store unreachable - photo kept on this device, retry when it returns.');
        } else if (reply.status === 413) {
          setAnnouncement('Photo is over 5,000,000 bytes.');
        } else if (reply.status === 415) {
          setAnnouncement('Photo is not a JPEG, PNG or WebP image.');
        } else {
          setAnnouncement(reply.error.message);
        }
      } catch (cause) {
        setFailedPhoto(file);
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      }
    })();
  };

  const file = (): void => {
    if (control.pending) return;
    const body: Record<string, unknown> = {
      compliant: compliant === true,
      defects,
      refuse_boarding: refuse,
      location,
      note,
      photo_ids: photos.map((photo) => photo.photo_id),
    };
    const key = control.keyFor(JSON.stringify([move.ref, body]));
    control.setPending(true);
    setAnnouncement('Filing report...');
    void (async () => {
      try {
        const reply = await send<LadderReport>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/ladder-reports`,
          { body, key },
        );
        control.replyReceived();
        if (reply.ok) {
          setErrors({});
          setAnnouncement(`Report ${reply.data.id} filed`);
          onFiled();
          return;
        }
        const fields = reply.error.errors ?? { report: reply.error.message };
        setErrors(fields);
        setAnnouncement(`${Object.keys(fields).length} fields need attention`);
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  return (
    <Panel open={open} label="Ladder report" kind="dialog" onClose={onClose}>
      <h3>{`Ladder report for ${move.ref}`}</h3>
      <fieldset>
        <legend>Ladder state</legend>
        <div role="radiogroup" aria-label="Ladder state" id="report-compliant">
          <label className="choice">
            <input
              type="radio"
              name="ladder-state"
              aria-label="Compliant"
              checked={compliant === true}
              onChange={() => {
                setCompliant(true);
                setDefects([]);
                setRefuse(false);
              }}
            />
            Compliant
          </label>
          <label className="choice">
            <input
              type="radio"
              name="ladder-state"
              aria-label="Non-compliant"
              checked={compliant === false}
              onChange={() => setCompliant(false)}
            />
            Non-compliant
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Filed from</legend>
        <div role="radiogroup" aria-label="Filed from">
          <label className="choice">
            <input
              type="radio"
              name="filed-from"
              aria-label="Deck"
              checked={location === 'deck'}
              onChange={() => setLocation('deck')}
            />
            Deck
          </label>
          <label className="choice">
            <input
              type="radio"
              name="filed-from"
              aria-label="Pilot boat"
              checked={location === 'pilot_boat'}
              onChange={() => setLocation('pilot_boat')}
            />
            Pilot boat
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Defects</legend>
        <div role="group" aria-label="Defects" id="report-defects">
          {Object.entries(DEFECT_NAMES).map(([code, name]) => (
            <label key={code} className="touch-row choice">
              <input
                type="checkbox"
                aria-label={name}
                checked={defects.includes(code)}
                onChange={(event) =>
                  setDefects((current) =>
                    event.target.checked
                      ? [...current, code]
                      : current.filter((entry) => entry !== code),
                  )
                }
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="touch-row choice">
        <input
          id="report-refuse_boarding"
          type="checkbox"
          aria-label="Refuse boarding"
          checked={refuse}
          onChange={(event) => setRefuse(event.target.checked)}
        />
        Refuse boarding
      </label>
      <label>
        Report note
        <textarea
          aria-label="Report note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <label>
        Ladder photo
        <input
          id="report-photo_ids"
          type="file"
          aria-label="Ladder photo"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen !== undefined) upload(chosen);
          }}
        />
      </label>
      <ul aria-label="Chosen photos">
        {photos.map((photo) => (
          <li key={photo.photo_id} className="mono">
            {`Photo stored SHA-256 ${photo.sha256}`}
          </li>
        ))}
        {failedPhoto !== null && (
          <li>
            Photo not stored
            <button type="button" onClick={() => upload(failedPhoto)}>
              Retry photo upload
            </button>
          </li>
        )}
      </ul>
      <FormErrors errors={errors} prefix="report" />
      <div className="keel-controls">
        <button type="button" className="primary" onClick={file}>
          File report
        </button>
        <button type="button" onClick={onClose}>
          Close report
        </button>
      </div>
      <div role="status" aria-label="Report announcements" className="announce">
        {announcement}
      </div>
    </Panel>
  );
}
