import { ReactElement, useEffect, useRef, useState } from 'react';
import { ApiCallError, api } from '../api';
import { Dialog } from '../components/Dialog';
import { LiveRegion } from '../components/LiveRegion';
import { cardDate, clock, dateAndClock, inputDateTime } from '../format';
import { Link } from '../router';
import {
  AssignmentsPayload,
  CREDENTIAL_TYPES,
  CredentialRecord,
  CredentialType,
  RequestObject,
  SETTING_LABELS,
  SessionUser,
} from '../types';

export function MyPage({ user }: { user: SessionUser }): ReactElement {
  const [work, setWork] = useState<AssignmentsPayload | null>(null);
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [timesheetFor, setTimesheetFor] = useState<RequestObject | null>(null);
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [signature, setSignature] = useState('');
  const [timesheetMessage, setTimesheetMessage] = useState('');
  const [timesheetFields, setTimesheetFields] = useState<Record<string, string>>({});
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [credentialType, setCredentialType] = useState<CredentialType>('NIC');
  const [credentialNumber, setCredentialNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [scan, setScan] = useState<File | null>(null);
  const [credentialMessage, setCredentialMessage] = useState('');
  const [credentialFields, setCredentialFields] = useState<Record<string, string>>({});
  const timesheetKey = useRef('');
  const scanInput = useRef<HTMLInputElement>(null);

  const load = async (): Promise<void> => {
    setWork(await api.assignments());
    setCredentials((await api.credentials()).credentials);
  };

  useEffect(() => {
    void load();
  }, []);

  const openTimesheet = (request: RequestObject): void => {
    setTimesheetFor(request);
    setActualStart(inputDateTime(request.start));
    setActualEnd(inputDateTime(request.end));
    setSignature('');
    setTimesheetFields({});
    setTimesheetMessage('');
    timesheetKey.current = crypto.randomUUID();
  };

  const submitTimesheet = async (): Promise<void> => {
    if (!timesheetFor) return;
    const seat = timesheetFor.seats.find((item) => item.interpreter?.id === user.id);
    if (!seat) return;
    setTimesheetMessage('Submitting timesheet…');
    setTimesheetFields({});
    try {
      const payload = await api.submitTimesheet(
        seat.id,
        { actual_start: actualStart, actual_end: actualEnd, signature_name: signature },
        timesheetKey.current,
      );
      setTimesheetMessage(
        `Timesheet for ${timesheetFor.ref} submitted: ${payload.timesheet.billed_hours} billed hours.`,
      );
      await load();
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      if (failure?.code === 'not_yet_ended') {
        setTimesheetMessage('You can submit after the assignment ends.');
      } else if (failure?.code === 'validation') {
        setTimesheetFields(failure.fields ?? {});
        setTimesheetMessage('Check the highlighted fields.');
      } else {
        setTimesheetMessage('That timesheet could not be submitted.');
      }
    }
  };

  const saveCredential = async (): Promise<void> => {
    if (!scan) {
      setCredentialFields({ scan: 'Choose a scan of the credential.' });
      setCredentialMessage('Check the highlighted fields.');
      return;
    }
    setCredentialMessage('Saving credential…');
    setCredentialFields({});
    try {
      const payload = await api.addCredential(
        { type: credentialType, number: credentialNumber, expires_on: expiresOn },
        scan,
      );
      setCredentialMessage(
        `${payload.credential.type} saved, valid through ${payload.credential.expires_on}.`,
      );
      await load();
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      if (failure?.code === 'storage_unavailable') {
        setCredentialMessage('File storage is unreachable. Nothing was saved.');
      } else if (failure?.code === 'validation') {
        setCredentialFields(failure.fields ?? {});
        setCredentialMessage('Check the highlighted fields.');
      } else if (failure?.code === 'unsupported_media_type') {
        setCredentialFields({ scan: 'Scans must be PDF, PNG or JPEG.' });
        setCredentialMessage('Check the highlighted fields.');
      } else {
        setCredentialMessage('That credential could not be saved.');
      }
    }
  };

  const now = Date.now();

  return (
    <main className="column">
      <h1>My work</h1>

      <section className="detail-section" aria-label="My offers">
        <h2>My offers</h2>
        {(work?.offers ?? []).length === 0 ? (
          <p>No open offers.</p>
        ) : (
          <ul className="plain">
            {(work?.offers ?? []).map((offer) => (
              <li key={offer.id}>
                <Link to={`/offers/${offer.token}`}>
                  {offer.request.ref} {offer.request.title}
                </Link>{' '}
                <span className="mono">
                  {cardDate(offer.request.start)} {clock(offer.request.start)}–
                  {clock(offer.request.end)}
                </span>{' '}
                · seat {offer.seat.position} of {offer.seat.total} ·{' '}
                <span className="mono">expires {dateAndClock(offer.expires_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section" aria-label="My assignments">
        <h2>My assignments</h2>
        {(work?.assignments ?? []).length === 0 ? (
          <p>No assignments yet.</p>
        ) : (
          <ul className="plain">
            {(work?.assignments ?? []).map((assignment) => {
              const seat = assignment.seats.find((item) => item.interpreter?.id === user.id);
              const ended = new Date(assignment.end).getTime() <= now;
              return (
                <li key={assignment.id} className="card">
                  <strong>
                    <span className="ref">{assignment.ref}</span> {assignment.title}
                  </strong>
                  <p className="card-meta">
                    {SETTING_LABELS[assignment.setting]} · {assignment.org_name} ·{' '}
                    <span className="mono">
                      {cardDate(assignment.start)} {clock(assignment.start)}–
                      {clock(assignment.end)}
                    </span>
                  </p>
                  <p>{assignment.location}</p>
                  {assignment.prep_files.length > 0 ? (
                    <ul className="plain">
                      {assignment.prep_files.map((file) => (
                        <li key={file.id}>
                          <a href={`/api/prep/${file.id}`}>{file.filename}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {seat?.timesheet ? (
                    <p>
                      Timesheet {seat.timesheet.status}:{' '}
                      <span className="mono">{seat.timesheet.billed_hours} h</span>
                    </p>
                  ) : ended ? (
                    <button type="button" onClick={() => openTimesheet(assignment)}>
                      Submit timesheet for {assignment.ref}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="detail-section" aria-label="My credentials">
        <h2>My credentials</h2>
        <ul className="plain">
          {credentials.map((credential) => (
            <li key={credential.id}>
              {credential.type} <span className="mono">{credential.number}</span> · expires{' '}
              <span className="mono">{credential.expires_on}</span> · {credential.status} ·{' '}
              <a href={`/api/credentials/${credential.id}/scan`}>scan</a>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setCredentialOpen(true)}>
          Add credential
        </button>
      </section>

      <LiveRegion label="Timesheet status" message={timesheetMessage} />
      <LiveRegion label="Credential status" message={credentialMessage} />

      {timesheetFor ? (
        <Dialog label={`Timesheet for ${timesheetFor.ref}`} onClose={() => setTimesheetFor(null)}>
          <h2>Timesheet for {timesheetFor.ref}</h2>
          <div className="field">
            <label htmlFor="actual-start">Actual start</label>
            <input
              id="actual-start"
              type="text"
              value={actualStart}
              onChange={(event) => setActualStart(event.target.value)}
            />
            {timesheetFields.actual_start ? (
              <p className="field-error">{timesheetFields.actual_start}</p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="actual-end">Actual end</label>
            <input
              id="actual-end"
              type="text"
              value={actualEnd}
              onChange={(event) => setActualEnd(event.target.value)}
            />
            {timesheetFields.actual_end ? (
              <p className="field-error">{timesheetFields.actual_end}</p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="signature">Signature name</label>
            <input
              id="signature"
              type="text"
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
            />
            {timesheetFields.signature_name ? (
              <p className="field-error">{timesheetFields.signature_name}</p>
            ) : null}
          </div>
          <p>{timesheetMessage}</p>
          <div className="row-actions">
            <button type="button" onClick={() => void submitTimesheet()}>
              Sign and submit
            </button>
            <button type="button" className="quiet" onClick={() => setTimesheetFor(null)}>
              Close
            </button>
          </div>
        </Dialog>
      ) : null}

      {credentialOpen ? (
        <Dialog label="Add credential" onClose={() => setCredentialOpen(false)}>
          <h2>Add credential</h2>
          <div className="field">
            <label htmlFor="credential-type">Credential type</label>
            <select
              id="credential-type"
              value={credentialType}
              onChange={(event) => setCredentialType(event.target.value as CredentialType)}
            >
              {CREDENTIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {credentialFields.type ? <p className="field-error">{credentialFields.type}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="credential-number">Credential number</label>
            <input
              id="credential-number"
              type="text"
              value={credentialNumber}
              onChange={(event) => setCredentialNumber(event.target.value)}
            />
            {credentialFields.number ? (
              <p className="field-error">{credentialFields.number}</p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="expires-on">Expires on</label>
            <input
              id="expires-on"
              type="text"
              placeholder="2027-06-30"
              value={expiresOn}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
            {credentialFields.expires_on ? (
              <p className="field-error">{credentialFields.expires_on}</p>
            ) : null}
          </div>
          <div className="field">
            <button type="button" onClick={() => scanInput.current?.click()}>
              Choose scan
            </button>
            <input
              ref={scanInput}
              type="file"
              hidden
              onChange={(event) => setScan(event.target.files?.[0] ?? null)}
            />
            <p>{scan ? scan.name : 'No scan chosen yet.'}</p>
            {credentialFields.scan ? <p className="field-error">{credentialFields.scan}</p> : null}
          </div>
          <p>{credentialMessage}</p>
          <div className="row-actions">
            <button type="button" onClick={() => void saveCredential()}>
              Save credential
            </button>
            <button type="button" className="quiet" onClick={() => setCredentialOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
