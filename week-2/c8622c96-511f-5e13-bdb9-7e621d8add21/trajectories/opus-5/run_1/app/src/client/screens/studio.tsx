import { useCallback, useEffect, useRef, useState } from 'react';
import { displayPercent, parseDollarsToMinor, parsePercentToBasisPoints } from '../../domain/money.js';
import {
  displayCoopDate,
  displayCoopTime,
  isValidLocalDateTime,
  resolveCoopWallTime,
} from '../../domain/time.js';
import {
  NoAnswer,
  RequestFailed,
  request,
  uploadFrame,
  type EssayView,
  type RoyaltyLine,
  type Session,
  type StudioEssay,
} from '../api.js';
import { displayMoney, essayStateLabel, monthLabel } from '../format.js';

const STALE_SAVE =
  'This essay was changed elsewhere. Reload it before saving; your edits are still in the form.';
const NETWORK_FAILURE = 'Couldn’t reach Saltprint Desk. Nothing was changed; try again.';
const STORAGE_DOWN = 'Image storage is unreachable. Nothing was uploaded; try again shortly.';

interface CreditRow {
  handle: string;
  share: string;
}

interface FormState {
  id: string | null;
  version: number;
  title: string;
  caption: string;
  lift: string;
  exclusiveDays: string;
  standardDays: string;
  exclusivePrice: string;
  standardPrice: string;
  credits: CreditRow[];
}

function blankForm(session: Session): FormState {
  return {
    id: null,
    version: 0,
    title: '',
    caption: '',
    lift: '',
    exclusiveDays: '3',
    standardDays: '7',
    exclusivePrice: '450.00',
    standardPrice: '120.00',
    credits: [{ handle: session.contributor_handle ?? '', share: '' }],
  };
}

function formFromEssay(essay: EssayView): FormState {
  return {
    id: essay.id,
    version: essay.version,
    title: essay.title,
    caption: essay.caption,
    lift: essay.lift_local,
    exclusiveDays: String(essay.exclusive_days),
    standardDays: String(essay.standard_days),
    exclusivePrice: (essay.exclusive_price_minor / 100).toFixed(2),
    standardPrice: (essay.standard_price_minor / 100).toFixed(2),
    credits: essay.credits.map((credit) => ({
      handle: credit.handle,
      share: displayPercent(credit.split_bp ?? 0),
    })),
  };
}

function sharesTotalBp(credits: CreditRow[]): number {
  return credits.reduce((total, credit) => total + (parsePercentToBasisPoints(credit.share) ?? 0), 0);
}

function liftPreview(lift: string): string {
  if (!isValidLocalDateTime(lift)) return '';
  const resolved = resolveCoopWallTime(lift);
  const base = `Lifts ${displayCoopTime(resolved.at)}`;
  if (resolved.resolution === 'first_occurrence') {
    return `${base} That time happens twice on ${displayCoopDate(resolved.at)}; Saltprint uses the first.`;
  }
  if (resolved.resolution === 'shifted_after_gap') {
    return `${base} That time doesn't exist on ${displayCoopDate(
      resolved.at,
    )}; Saltprint uses ${displayCoopTime(resolved.at)}.`;
  }
  return base;
}

function numberOrText(value: string): number | string {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isInteger(parsed) ? parsed : value;
}

function moneyOrText(value: string): number | string {
  const parsed = parseDollarsToMinor(value);
  return parsed === null ? value : parsed;
}

export function Studio({ session }: { session: Session }): React.ReactElement {
  const [essays, setEssays] = useState<StudioEssay[]>([]);
  const [contributors, setContributors] = useState<Array<{ handle: string; name: string }>>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [stale, setStale] = useState(false);
  const firstError = useRef<string | null>(null);

  const load = useCallback(() => {
    void request<{ essays: StudioEssay[] }>('/api/studio/essays')
      .then((result) => {
        setEssays(result.data.essays);
        const names = new Map<string, string>();
        for (const essay of result.data.essays) {
          for (const credit of essay.credits) names.set(credit.handle, credit.name);
        }
        if (session.contributor_handle) names.set(session.contributor_handle, session.name);
        setContributors([...names].map(([handle, name]) => ({ handle, name })));
      })
      .catch(() => undefined);
  }, [session.contributor_handle, session.name]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!firstError.current) return;
    const selector = `[data-field="${firstError.current}"]`;
    document.querySelector<HTMLElement>(selector)?.focus();
    firstError.current = null;
  }, [fields]);

  const current = form;
  const editing = current?.id ? essays.find((essay) => essay.id === current.id) ?? null : null;

  const openEssay = (essay: StudioEssay): void => {
    setForm(formFromEssay(essay));
    setFields({});
    setStale(false);
    setStatus('');
  };

  const applyFailure = (failure: unknown): void => {
    if (failure instanceof RequestFailed) {
      if (failure.body.code === 'version_conflict') {
        setStale(true);
        setStatus('');
        return;
      }
      const given = failure.body.fields ?? {};
      setFields(given);
      firstError.current = Object.keys(given)[0] ?? null;
      setStatus('');
      return;
    }
    if (failure instanceof NoAnswer) setStatus(NETWORK_FAILURE);
  };

  const save = async (): Promise<void> => {
    if (!current) return;
    setStatus('Saving…');
    setStale(false);
    const body = {
      title: current.title,
      caption: current.caption,
      lift_local: current.lift,
      exclusive_days: numberOrText(current.exclusiveDays),
      standard_days: numberOrText(current.standardDays),
      exclusive_price_minor: moneyOrText(current.exclusivePrice),
      standard_price_minor: moneyOrText(current.standardPrice),
      credits: current.credits.map((credit) => ({
        contributor: credit.handle,
        split_bp: parsePercentToBasisPoints(credit.share) ?? credit.share,
      })),
    };
    try {
      const result = current.id
        ? await request<EssayView>(`/api/essays/${current.id}`, {
            method: 'PATCH',
            body,
            headers: { 'If-Match': `"${current.version}"` },
          })
        : await request<EssayView>('/api/essays', { method: 'POST', body });
      setFields({});
      setForm(formFromEssay(result.data));
      setStatus('Draft saved.');
      load();
    } catch (failure) {
      applyFailure(failure);
    }
  };

  const upload = async (files: FileList): Promise<void> => {
    if (!current?.id) return;
    for (const file of [...files]) {
      setUploadStatus(`Uploading ${file.name}…`);
      try {
        const result = await uploadFrame(current.id, file, '');
        setForm((previous) =>
          previous ? { ...previous, version: result.data.essay_version } : previous,
        );
        setUploadStatus(`${file.name} uploaded.`);
      } catch (failure) {
        if (failure instanceof RequestFailed) {
          setUploadStatus(
            failure.body.code === 'storage_unavailable'
              ? STORAGE_DOWN
              : `${file.name}: ${failure.body.fields?.file ?? failure.body.message}`,
          );
        } else {
          setUploadStatus(NETWORK_FAILURE);
        }
        break;
      }
    }
    load();
  };

  const editCaption = async (frameId: string, caption: string): Promise<void> => {
    try {
      const result = await request<{ essay_version: number }>(`/api/frames/${frameId}`, {
        method: 'PATCH',
        body: { caption },
      });
      setForm((previous) =>
        previous ? { ...previous, version: result.data.essay_version } : previous,
      );
      load();
    } catch (failure) {
      applyFailure(failure);
    }
  };

  const submit = async (): Promise<void> => {
    if (!current?.id) return;
    setStatus('Submitting…');
    try {
      const result = await request<EssayView>(`/api/essays/${current.id}/submit`, {
        method: 'POST',
        body: {},
      });
      setForm(formFromEssay(result.data));
      setStatus('Submitted. In review.');
      load();
    } catch (failure) {
      applyFailure(failure);
    }
  };

  const requestWithdrawal = async (essayId: string): Promise<void> => {
    try {
      await request(`/api/essays/${essayId}/withdrawal-request`, { method: 'POST', body: {} });
      setStatus('Withdrawal requested.');
      load();
    } catch (failure) {
      applyFailure(failure);
    }
  };

  const totalBp = current ? sharesTotalBp(current.credits) : 0;

  return (
    <main>
      <h1>Studio</h1>
      <div className="studio-columns">
        <section>
          <h2>My essays</h2>
          <ul className="plain">
            {essays.map((essay) => (
              <li key={essay.id}>
                <span>
                  <strong>{essay.title}</strong>
                  <br />
                  <span className="mono">{essayStateLabel(essay.state)}</span>
                  <br />
                  <span className="mono">{essay.lift_display}</span>
                  {essay.licences.map((licence) => (
                    <span key={`${licence.newsroom.slug}-${licence.window_end}`} className="mono">
                      <br />
                      {licence.newsroom.name} · {licence.kind} · {licence.window_end_display} ·{' '}
                      {displayMoney(licence.amount_minor)}
                    </span>
                  ))}
                </span>
                <button type="button" onClick={() => openEssay(essay)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setForm(blankForm(session))}>
            New essay
          </button>
        </section>
        {current ? (
          <section>
            <h2>{current.id ? current.title : 'New essay'}</h2>
            {stale ? (
              <p role="alert" className="alert">
                {STALE_SAVE}
              </p>
            ) : null}
            {(editing?.desk_notes ?? []).map((note) => (
              <p key={note.at} className="alert">
                Desk note · {note.at_display}: {note.note}
              </p>
            ))}
            <form
              aria-label="Essay details"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="field">
                <label htmlFor="essay-title">Title</label>
                <input
                  id="essay-title"
                  data-field="title"
                  type="text"
                  aria-describedby={fields.title ? 'error-title' : undefined}
                  value={current.title}
                  onChange={(event) => setForm({ ...current, title: event.target.value })}
                />
                {fields.title ? (
                  <p className="field-error" id="error-title">
                    {fields.title}
                  </p>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="essay-caption">Caption</label>
                <textarea
                  id="essay-caption"
                  data-field="caption"
                  aria-describedby={fields.caption ? 'error-caption' : undefined}
                  value={current.caption}
                  onChange={(event) => setForm({ ...current, caption: event.target.value })}
                />
                {fields.caption ? (
                  <p className="field-error" id="error-caption">
                    {fields.caption}
                  </p>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="essay-lift">Embargo lift (co-op time)</label>
                <input
                  id="essay-lift"
                  data-field="lift_local"
                  type="text"
                  className="mono"
                  placeholder="YYYY-MM-DDTHH:mm"
                  aria-describedby={fields.lift_local ? 'error-lift' : 'lift-preview'}
                  value={current.lift}
                  onChange={(event) => setForm({ ...current, lift: event.target.value })}
                />
                <p className="mono" id="lift-preview">
                  {liftPreview(current.lift)}
                </p>
                {fields.lift_local ? (
                  <p className="field-error" id="error-lift">
                    {fields.lift_local}
                  </p>
                ) : null}
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="essay-exclusive-days">Exclusive window days</label>
                  <input
                    id="essay-exclusive-days"
                    data-field="exclusive_days"
                    type="number"
                    className="mono"
                    aria-describedby={fields.exclusive_days ? 'error-exclusive-days' : undefined}
                    value={current.exclusiveDays}
                    onChange={(event) => setForm({ ...current, exclusiveDays: event.target.value })}
                  />
                  {fields.exclusive_days ? (
                    <p className="field-error" id="error-exclusive-days">
                      {fields.exclusive_days}
                    </p>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="essay-standard-days">Standard window days</label>
                  <input
                    id="essay-standard-days"
                    data-field="standard_days"
                    type="number"
                    className="mono"
                    aria-describedby={fields.standard_days ? 'error-standard-days' : undefined}
                    value={current.standardDays}
                    onChange={(event) => setForm({ ...current, standardDays: event.target.value })}
                  />
                  {fields.standard_days ? (
                    <p className="field-error" id="error-standard-days">
                      {fields.standard_days}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="essay-exclusive-price">Exclusive price (USD)</label>
                  <input
                    id="essay-exclusive-price"
                    data-field="exclusive_price_minor"
                    type="text"
                    className="mono"
                    aria-describedby={
                      fields.exclusive_price_minor ? 'error-exclusive-price' : undefined
                    }
                    value={current.exclusivePrice}
                    onChange={(event) =>
                      setForm({ ...current, exclusivePrice: event.target.value })
                    }
                  />
                  {fields.exclusive_price_minor ? (
                    <p className="field-error" id="error-exclusive-price">
                      {fields.exclusive_price_minor}
                    </p>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="essay-standard-price">Standard price (USD)</label>
                  <input
                    id="essay-standard-price"
                    data-field="standard_price_minor"
                    type="text"
                    className="mono"
                    aria-describedby={
                      fields.standard_price_minor ? 'error-standard-price' : undefined
                    }
                    value={current.standardPrice}
                    onChange={(event) => setForm({ ...current, standardPrice: event.target.value })}
                  />
                  {fields.standard_price_minor ? (
                    <p className="field-error" id="error-standard-price">
                      {fields.standard_price_minor}
                    </p>
                  ) : null}
                </div>
              </div>
              {current.credits.map((credit, index) => (
                <div className="credit-row" key={index}>
                  <div>
                    <label htmlFor={`credit-${index + 1}`}>{`Co-contributor ${index + 1}`}</label>
                    <select
                      id={`credit-${index + 1}`}
                      data-field="credits"
                      aria-describedby={fields.credits ? 'error-credits' : undefined}
                      value={credit.handle}
                      onChange={(event) => {
                        const credits = [...current.credits];
                        credits[index] = { ...credit, handle: event.target.value };
                        setForm({ ...current, credits });
                      }}
                    >
                      <option value="">—</option>
                      {contributors.map((contributor) => (
                        <option key={contributor.handle} value={contributor.handle}>
                          {contributor.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`share-${index + 1}`}>{`Share ${index + 1} (percent)`}</label>
                    <input
                      id={`share-${index + 1}`}
                      type="text"
                      className="mono"
                      value={credit.share}
                      onChange={(event) => {
                        const credits = [...current.credits];
                        credits[index] = { ...credit, share: event.target.value };
                        setForm({ ...current, credits });
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...current,
                        credits: current.credits.filter((_, position) => position !== index),
                      })
                    }
                  >
                    {`Remove co-contributor ${index + 1}`}
                  </button>
                </div>
              ))}
              {fields.credits ? (
                <p className="field-error" id="error-credits">
                  {fields.credits}
                </p>
              ) : null}
              <p
                className={`shares-total mono ${totalBp === 10000 ? 'exact' : 'short'}`}
              >{`Shares total ${displayPercent(totalBp)}% of 100.00%`}</p>
              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    setForm({ ...current, credits: [...current.credits, { handle: '', share: '' }] });
                    window.setTimeout(() => {
                      document
                        .querySelector<HTMLSelectElement>(`#credit-${current.credits.length + 1}`)
                        ?.focus();
                    }, 0);
                  }}
                >
                  Add co-contributor
                </button>
                <button type="submit">Save draft</button>
              </div>
            </form>
            <span className="status" role="status" aria-label="Essay status">
              {status}
            </span>
            {current.id ? (
              <>
                <div className="field">
                  <label htmlFor="essay-upload">Upload frames</label>
                  <input
                    id="essay-upload"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png"
                    onChange={(event) => {
                      if (event.target.files) void upload(event.target.files);
                    }}
                  />
                </div>
                <span className="status" role="status" aria-label="Upload status">
                  {uploadStatus}
                </span>
                <div className="thumb-strip">
                  {(editing?.frames ?? []).map((frame) => (
                    <div key={frame.id}>
                      <img src={frame.grid_url} alt="" />
                      <label htmlFor={`frame-caption-${frame.position}`}>
                        {`Caption for frame ${frame.position}`}
                      </label>
                      <input
                        id={`frame-caption-${frame.position}`}
                        type="text"
                        defaultValue={frame.caption}
                        onBlur={(event) => void editCaption(frame.id, event.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <div className="row">
                  <button type="button" onClick={() => void submit()}>
                    Submit for review
                  </button>
                  <button
                    type="button"
                    onClick={() => void requestWithdrawal(current.id as string)}
                  >
                    Request withdrawal
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

export function Royalties(): React.ReactElement {
  const [lines, setLines] = useState<RoyaltyLine[]>([]);

  useEffect(() => {
    void request<{ lines: RoyaltyLine[] }>('/api/studio/royalties')
      .then((result) => setLines(result.data.lines))
      .catch(() => undefined);
  }, []);

  return (
    <main>
      <h1>Royalties</h1>
      <table className="stacked" aria-label="My royalties">
        <thead>
          <tr>
            <th>Month</th>
            <th>Essay</th>
            <th>Share</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.month}-${line.licence_id}`}>
              <td data-label="Month" className="mono">
                {monthLabel(line.month)}
              </td>
              <td data-label="Essay">{line.essay_title}</td>
              <td data-label="Share" className="mono">
                {displayPercent(line.split_bp)}%
              </td>
              <td data-label="Amount" className="mono">
                {displayMoney(line.amount_minor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
