import { useEffect, useRef, useState } from 'react';
import type { Piece, Render } from '../../../shared/api.js';
import { api, ApiFailure } from '../../lib/api.js';
import { useDialogFocus } from '../../lib/hooks.js';
import { ErrorSummary } from '../../components/ErrorSummary.js';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  edition_count: 'Editions',
  price_cents: 'Price (USD)',
  export_render_id: 'Export',
};

export interface PublishDialogProps {
  readonly open: boolean;
  readonly slug: string;
  readonly readyRenders: readonly Render[];
  readonly returnFocusTo: React.RefObject<HTMLElement | null>;
  onClose(): void;
  onPublished(piece: Piece): void;
}

/** Publishes a draft as a run of 1 to 500 numbered editions at a fixed price. */
export function PublishDialog({
  open,
  slug,
  readyRenders,
  returnFocusTo,
  onClose,
  onPublished,
}: PublishDialogProps): JSX.Element | null {
  const dialogRef = useDialogFocus(open, onClose, returnFocusTo);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const [editions, setEditions] = useState('30');
  const [price, setPrice] = useState('15.00');
  const [exportId, setExportId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    setExportId((current) => current || (readyRenders[0]?.id ?? ''));
  }, [open, readyRenders]);

  if (!open) return null;

  const submit = (): void => {
    const editionCount = Number.parseInt(editions, 10);
    const priceCents = Math.round(Number.parseFloat(price) * 100);
    const errors: Record<string, string> = {};
    if (!Number.isInteger(editionCount) || editionCount < 1 || editionCount > 500) {
      errors.edition_count = 'Publish a run of 1 to 500 editions.';
    }
    if (!Number.isFinite(priceCents) || priceCents < 100 || priceCents > 500000) {
      errors.price_cents = 'Price each edition between $1.00 and $5,000.00.';
    }
    if (exportId === '') {
      errors.export_render_id = 'Choose a ready export.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    setFieldErrors({});
    void api
      .post<Piece>(`/api/pieces/${slug}/publish`, {
        body: {
          edition_count: editionCount,
          price_cents: priceCents,
          export_render_id: exportId,
        },
      })
      .then(onPublished)
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) setFieldErrors(error.fields);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Publish edition run"
      ref={dialogRef}
    >
      <div className="modal__panel">
        <h2 className="modal__title display">Publish edition run.</h2>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ErrorSummary errors={fieldErrors} labels={FIELD_LABELS} />

          <label className="field" htmlFor="edition_count">
            <span className="field__label">Editions</span>
            <input
              id="edition_count"
              ref={firstFieldRef}
              type="number"
              aria-label="Editions"
              min={1}
              max={500}
              step={1}
              value={editions}
              onChange={(event) => setEditions(event.target.value)}
            />
            {fieldErrors.edition_count && <span className="field-error">{fieldErrors.edition_count}</span>}
          </label>

          <label className="field" htmlFor="price_cents">
            <span className="field__label">Price (USD)</span>
            <input
              id="price_cents"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
            {fieldErrors.price_cents && <span className="field-error">{fieldErrors.price_cents}</span>}
          </label>

          <label className="field" htmlFor="export_render_id">
            <span className="field__label">Export</span>
            <select
              id="export_render_id"
              value={exportId}
              onChange={(event) => setExportId(event.target.value)}
            >
              <option value="">Choose a ready export</option>
              {readyRenders.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.aspect} · {entry.resolution} · {entry.duration_s}s · {entry.format.toUpperCase()}
                </option>
              ))}
            </select>
            {fieldErrors.export_render_id && (
              <span className="field-error">{fieldErrors.export_render_id}</span>
            )}
          </label>

          <div className="modal__actions">
            <button type="submit" className="next-action" disabled={busy}>
              Publish run
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
