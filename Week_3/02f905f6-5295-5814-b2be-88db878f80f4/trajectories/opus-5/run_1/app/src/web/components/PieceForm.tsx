import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Clay, GlazeCone, Plan, Quote, Shape, Unit } from '../../shared/types';
import { formatMoney, PLAN_LABELS } from '../../shared/labels';
import { ApiFailure, api, newIdempotencyKey, uploadPhoto } from '../api';
import { ErrorSummary, LiveRegion, quiet, type LiveMessage } from './bits';

const FIELD_LABELS: Record<string, string> = {
  shape: 'Shape',
  unit: 'Units',
  length: 'Length',
  width: 'Width',
  diameter: 'Diameter',
  height: 'Height',
  plan: 'Firing plan',
  cone: 'Glaze cone',
  clay_id: 'Clay body',
  photo_id: 'Intake photo',
  guest_name: 'Guest name',
  guest_email: 'Guest email',
};

const PHOTO_COPY = {
  pending: 'Uploading photo…',
  attached: 'Photo attached',
  type: 'Use a JPEG, PNG, WebP or HEIC photo',
  size: 'Photo is over 8,000,000 bytes',
  storage: 'Photo not saved — storage is unreachable. Try again in a minute.',
} as const;

const FEE_COPY = {
  pending: 'Working out the fee…',
  incomplete: 'Fee appears when every size is filled in',
} as const;

export interface PiecePayload {
  shape: Shape;
  unit: Unit;
  length?: string;
  width?: string;
  diameter?: string;
  height: string;
  plan: Plan;
  clay_id: string;
  cone: GlazeCone | null;
  photo_id: string;
}

export interface PieceFormProps {
  clays: Clay[];
  submitLabel: string;
  resultName: string;
  pendingText: string;
  extraPayload?: Record<string, unknown>;
  renderExtra?: (fields: Record<string, string>) => ReactNode;
  onSubmit: (payload: PiecePayload, idempotencyKey: string) => Promise<LiveMessage>;
  pinFeePanel?: boolean;
}

function convert(value: string, to: Unit): string {
  if (value.trim() === '') return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const inches = to === 'cm' ? number * 2.54 : number / 2.54;
  return inches.toFixed(2);
}

export function PieceForm(props: PieceFormProps): JSX.Element {
  const [shape, setShape] = useState<Shape>('rectangular');
  const [unit, setUnit] = useState<Unit>('in');
  const [sizes, setSizes] = useState<Record<'length' | 'width' | 'diameter' | 'height', string>>({
    length: '',
    width: '',
    diameter: '',
    height: '',
  });
  const [plan, setPlan] = useState<Plan>('bisque_and_glaze');
  const [cone, setCone] = useState<GlazeCone>('6');
  const [clayId, setClayId] = useState<string>(props.clays[0]?.id ?? '');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<LiveMessage>(quiet);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [feeMessage, setFeeMessage] = useState<LiveMessage>({
    text: FEE_COPY.incomplete,
    tone: 'idle',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LiveMessage>(quiet);
  const [sending, setSending] = useState(false);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (clayId === '' && props.clays[0]) setClayId(props.clays[0].id);
  }, [props.clays, clayId]);

  const sizeKeys: ('length' | 'width' | 'diameter' | 'height')[] =
    shape === 'rectangular' ? ['length', 'width', 'height'] : ['diameter', 'height'];

  const touched = (): void => {
    keyRef.current = null;
    setSummary({});
  };

  /** The live estimate: one quote per keystroke, repainted in place. */
  useEffect(() => {
    const complete = sizeKeys.every((key) => sizes[key].trim() !== '');
    if (!complete) {
      setQuote(null);
      setFeeMessage({ text: FEE_COPY.incomplete, tone: 'idle' });
      return;
    }
    setFeeMessage({ text: FEE_COPY.pending, tone: 'pending' });
    const payload: Record<string, string> = { shape, unit, plan };
    for (const key of sizeKeys) payload[key] = sizes[key];
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .post<Quote>('/api/quote', payload)
        .then((fresh) => {
          if (cancelled) return;
          setQuote(fresh);
          setFields((current) => {
            const next = { ...current };
            for (const key of ['length', 'width', 'diameter', 'height']) delete next[key];
            return next;
          });
          setFeeMessage({
            text: `Fee $${formatMoney(fresh.fee_cents)}${
              fresh.minimum_applied ? ' (order minimum)' : ''
            } for ${fresh.cubic_inches} cubic inches`,
            tone: 'good',
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setQuote(null);
          if (error instanceof ApiFailure && error.status === 422) {
            setFields((current) => ({ ...current, ...error.fields }));
          }
          setFeeMessage({ text: FEE_COPY.incomplete, tone: 'bad' });
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shape, unit, plan, sizes.length, sizes.width, sizes.diameter, sizes.height]);

  const changeSize = (key: 'length' | 'width' | 'diameter' | 'height', value: string): void => {
    touched();
    setSizes((current) => ({ ...current, [key]: value }));
  };

  const changeUnit = (next: Unit): void => {
    if (next === unit) return;
    touched();
    setUnit(next);
    setSizes((current) => ({
      length: convert(current.length, next),
      width: convert(current.width, next),
      diameter: convert(current.diameter, next),
      height: convert(current.height, next),
    }));
  };

  const choosePhoto = async (file: File | undefined): Promise<void> => {
    touched();
    setPhotoId(null);
    if (!file) {
      setPhotoMessage(quiet);
      return;
    }
    setPhotoMessage({ text: PHOTO_COPY.pending, tone: 'pending' });
    try {
      const stored = await uploadPhoto(file);
      setPhotoId(stored.photo_id);
      setPhotoMessage({ text: PHOTO_COPY.attached, tone: 'good' });
      setFields((current) => {
        const next = { ...current };
        delete next.photo_id;
        return next;
      });
    } catch (error) {
      const status = error instanceof ApiFailure ? error.status : 0;
      const text =
        status === 415 ? PHOTO_COPY.type : status === 413 ? PHOTO_COPY.size : PHOTO_COPY.storage;
      setPhotoMessage({ text, tone: 'bad' });
    }
  };

  const ready = photoId !== null && quote !== null && !sending;

  const submit = async (): Promise<void> => {
    if (!ready || !photoId || !quote) return;
    if (keyRef.current === null) keyRef.current = newIdempotencyKey();
    const payload: PiecePayload = {
      shape,
      unit,
      height: sizes.height,
      plan,
      clay_id: clayId,
      cone: plan === 'bisque_only' ? null : cone,
      photo_id: photoId,
      ...(shape === 'rectangular'
        ? { length: sizes.length, width: sizes.width }
        : { diameter: sizes.diameter }),
    };
    setSending(true);
    setFields({});
    setSummary({});
    setResult({ text: props.pendingText, tone: 'pending' });
    try {
      const message = await props.onSubmit(payload, keyRef.current);
      setResult(message);
      keyRef.current = null;
      setPhotoId(null);
      setPhotoMessage(quiet);
      setSizes({ length: '', width: '', diameter: '', height: '' });
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        setSummary(error.fields);
        setResult(quiet);
      } else if (error instanceof ApiFailure) {
        setResult({ text: error.body.message, tone: 'bad' });
      } else {
        setResult({ text: 'The studio server is unreachable.', tone: 'bad' });
      }
    } finally {
      setSending(false);
    }
  };

  const unitWord = unit === 'in' ? 'in' : 'cm';

  return (
    <div className="intake-grid">
      <div>
        <ErrorSummary fields={summary} labels={FIELD_LABELS} />

        <fieldset role="radiogroup" aria-label="Shape">
          <legend>Shape</legend>
          <div className="radio-row">
            {(
              [
                ['round', 'Round'],
                ['rectangular', 'Rectangular'],
                ['plate', 'Plate'],
              ] as [Shape, string][]
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="shape"
                  value={value}
                  checked={shape === value}
                  onChange={() => {
                    touched();
                    setShape(value);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          {fields.shape && <p className="field-error">{fields.shape}</p>}
        </fieldset>

        <fieldset role="radiogroup" aria-label="Units">
          <legend>Units</legend>
          <div className="radio-row">
            {(
              [
                ['in', 'in'],
                ['cm', 'cm'],
              ] as [Unit, string][]
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="unit"
                  value={value}
                  checked={unit === value}
                  onChange={() => changeUnit(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {sizeKeys.map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`field-${key}`}>
              {key === 'length'
                ? 'Length'
                : key === 'width'
                  ? 'Width'
                  : key === 'diameter'
                    ? 'Diameter'
                    : 'Height'}
            </label>
            <div className="field-unit">
              <input
                id={`field-${key}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={sizes[key]}
                aria-describedby={fields[key] ? `error-${key}` : undefined}
                onChange={(event) => changeSize(key, event.target.value)}
              />
              <span className="unit">{unitWord}</span>
            </div>
            {fields[key] && (
              <p className="field-error" id={`error-${key}`}>
                {fields[key]}
              </p>
            )}
          </div>
        ))}

        <div className="field">
          <label htmlFor="field-clay_id">Clay body</label>
          <select
            id="field-clay_id"
            value={clayId}
            onChange={(event) => {
              touched();
              setClayId(event.target.value);
            }}
          >
            {props.clays.map((clay) => (
              <option key={clay.id} value={clay.id}>
                {clay.name} (cone {clay.max_cone})
              </option>
            ))}
          </select>
          {fields.clay_id && <p className="field-error">{fields.clay_id}</p>}
        </div>

        <div className="field">
          <label htmlFor="field-plan">Firing plan</label>
          <select
            id="field-plan"
            value={plan}
            onChange={(event) => {
              touched();
              setPlan(event.target.value as Plan);
            }}
          >
            {(['bisque_and_glaze', 'bisque_only', 'glaze_only'] as Plan[]).map((value) => (
              <option key={value} value={value}>
                {PLAN_LABELS[value]}
              </option>
            ))}
          </select>
          {fields.plan && <p className="field-error">{fields.plan}</p>}
        </div>

        <div className="field">
          <label htmlFor="field-cone">Glaze cone</label>
          <select
            id="field-cone"
            value={cone}
            disabled={plan === 'bisque_only'}
            onChange={(event) => {
              touched();
              setCone(event.target.value as GlazeCone);
            }}
          >
            <option value="06">Cone 06</option>
            <option value="6">Cone 6</option>
          </select>
          {fields.cone && <p className="field-error">{fields.cone}</p>}
        </div>

        {props.renderExtra?.(fields)}

        <div className="field">
          <label htmlFor="field-photo_id">Intake photo</label>
          <input
            id="field-photo_id"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/*"
            capture="environment"
            onChange={(event) => void choosePhoto(event.target.files?.[0])}
          />
          <LiveRegion name="Photo upload" message={photoMessage} />
          {fields.photo_id && <p className="field-error">{fields.photo_id}</p>}
        </div>

        <p>
          <button
            type="button"
            className="primary"
            aria-disabled={!ready}
            onClick={() => {
              if (ready) void submit();
            }}
          >
            {props.submitLabel}
          </button>
        </p>
        <LiveRegion name={props.resultName} message={result} />
      </div>

      <aside
        className={`fee-panel${props.pinFeePanel ? ' pinned' : ''}`}
        role="region"
        aria-label="Fee"
      >
        <h3>Fee</h3>
        <LiveRegion name="Fee estimate" message={feeMessage} />
        <dl>
          {quote ? (
            <>
              {quote.sides_in.length && (
                <>
                  <dt>Length</dt>
                  <dd>{quote.sides_in.length} in</dd>
                  <dt>Width</dt>
                  <dd>{quote.sides_in.width} in</dd>
                </>
              )}
              {quote.sides_in.diameter && (
                <>
                  <dt>Diameter</dt>
                  <dd>{quote.sides_in.diameter} in</dd>
                </>
              )}
              <dt>Height</dt>
              <dd>{quote.sides_in.height} in</dd>
              <dt>Volume</dt>
              <dd>{quote.cubic_inches} in³</dd>
              <dt>Rate</dt>
              <dd>${quote.rate_per_cubic_inch} per in³</dd>
              <dt>Discount</dt>
              <dd>{quote.discount_percent}%</dd>
              <dt>Order minimum</dt>
              <dd>${formatMoney(quote.order_minimum_cents)}</dd>
              <dt>Fee</dt>
              <dd className="fee-total">${formatMoney(quote.fee_cents)}</dd>
            </>
          ) : null}
        </dl>
      </aside>
    </div>
  );
}
