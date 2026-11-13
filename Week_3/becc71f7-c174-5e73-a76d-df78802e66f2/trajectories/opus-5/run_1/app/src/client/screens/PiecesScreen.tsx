import { useEffect, useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { focusHeadingOnArrival } from '../lib/landing.js';
import { claimResume, dropDialog, holdDialog } from '../lib/resume.js';
import type { Consignor, Piece, Session } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { brusselsDate, formatDateOnly } from '../../shared/brussels.js';
import { formatMoney, parseEuros } from '../../shared/money.js';
import {
  CATEGORIES,
  CONDITIONS,
  RAIL_STATUS_FILTERS,
  SIZES,
  pieceStatusLabel,
  sizeLabel,
} from '../../shared/options.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Field, RadioGroup, Select } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { Link, TableFrame } from '../components/layout.js';

const DIALOG = 'new-piece';

interface Draft {
  consignorId: string;
  category: string;
  brand: string;
  description: string;
  size: string;
  condition: string;
  askingPrice: string;
  intakeDate: string;
}

function emptyDraft(): Draft {
  return {
    consignorId: '',
    category: 'coats',
    brand: '',
    description: '',
    size: 'm',
    condition: 'very_good',
    askingPrice: '',
    intakeDate: brusselsDate(Date.now()),
  };
}

const CONTROL_IDS = {
  consignorId: 'piece-consignor',
  category: 'piece-category',
  brand: 'piece-brand',
  description: 'piece-description',
  size: 'piece-size',
  condition: 'piece-condition',
  askingPriceCents: 'piece-price',
  intakeDate: 'piece-intake',
};

export function PiecesScreen({ session, search }: { session: Session; search: string }) {
  const status = new URLSearchParams(search).get('status');
  const pieces = usePolling(
    () => get<{ pieces: Piece[] }>(`/api/pieces${status === null ? '' : `?status=${status}`}`),
    status ?? 'all',
  );
  const consignors = usePolling(
    () => get<{ consignors: Consignor[] }>('/api/consignors'),
    'consignors',
  );

  const dialog = useOverlay();
  const resumed = claimResume(DIALOG);
  const [draft, setDraft] = useState<Draft>(() =>
    resumed === null ? emptyDraft() : ({ ...emptyDraft(), ...resumed } as Draft),
  );
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (resumed !== null) dialog.open();
  }, []);

  const rows = pieces.data?.pieces ?? [];
  const chosen = rows.find((piece) => piece.id === selected) ?? rows[0];
  const available = (consignors.data?.consignors ?? []).filter(
    (consignor) => consignor.status !== 'erased',
  );

  const change = (next: Partial<Draft>): void => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      holdDialog(DIALOG, { ...merged });
      return merged;
    });
  };

  const save = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    const cents = parseEuros(draft.askingPrice);
    if (cents === null || cents < 100 || cents > 1_000_000) {
      fields['askingPriceCents'] = fieldCopy.askingPrice;
    }
    if (draft.consignorId === '') fields['consignorId'] = 'Choose a consignor.';
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending(true);
    try {
      const created = await post<{ piece: Piece }>('/api/pieces', {
        consignorId: draft.consignorId,
        category: draft.category,
        brand: draft.brand.trim(),
        description: draft.description.trim(),
        size: draft.size,
        condition: draft.condition,
        askingPriceCents: cents,
        intakeDate: draft.intakeDate,
      });
      announce(copy.pieceSaved(created.piece.tagCode));
      setProblems(noProblems);
      setDraft(emptyDraft());
      dropDialog(DIALOG);
      dialog.close();
      focusHeadingOnArrival();
      go(`/staff/pieces/${created.piece.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        const { failure } = error;
        setProblems(
          Object.keys(failure.fields).length > 0
            ? problemsOf(failure.fields)
            : problemsOf({}, failure.message),
        );
        announce(failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffShell session={session} layout="split">
      <h1 class="heading heading--1">Pieces</h1>

      <nav class="status-switcher" aria-label="Piece status">
        <ul class="status-switcher__list">
          <li>
            <Link
              href="/staff/pieces"
              class="status-switcher__link"
              {...(status === null ? { ariaCurrent: 'page' as const } : {})}
            >
              All
            </Link>
          </li>
          {RAIL_STATUS_FILTERS.map((option) => (
            <li key={option.value}>
              <Link
                href={`/staff/pieces?status=${option.value}`}
                class="status-switcher__link"
                {...(status === option.value ? { ariaCurrent: 'page' as const } : {})}
              >
                {option.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div class="split">
        <TableFrame name="Pieces">
          <table class="table" aria-label="Pieces">
            <thead>
              <tr>
                <th scope="col">Tag code</th>
                <th scope="col">Description</th>
                <th scope="col">Consignor</th>
                <th scope="col">Size</th>
                <th scope="col">Price</th>
                <th scope="col">Status</th>
                <th scope="col">Intake</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((piece) => (
                <tr
                  key={piece.id}
                  class={piece.id === chosen?.id ? 'is-selected' : ''}
                  onClick={() => setSelected(piece.id)}
                >
                  <td class="tabular">
                    <Link href={`/staff/pieces/${piece.id}`}>{piece.tagCode}</Link>
                  </td>
                  <td>{piece.description}</td>
                  <td>{piece.consignor.name}</td>
                  <td>{sizeLabel(piece.size)}</td>
                  <td class="tabular">{formatMoney(piece.currentPriceCents)}</td>
                  <td>{pieceStatusLabel(piece.status)}</td>
                  <td class="tabular">{formatDateOnly(piece.intakeDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>

        <aside class="detail">
          {chosen === undefined ? (
            <p>No piece chosen.</p>
          ) : (
            <>
              <h2 class="detail__heading tabular">{chosen.tagCode}</h2>
              <p>{chosen.description}</p>
              <p class="detail__meta">
                {chosen.brand}
                <span aria-hidden="true"> · </span>
                {sizeLabel(chosen.size)}
              </p>
              <p class="price tabular">{formatMoney(chosen.currentPriceCents)}</p>
              <p>{pieceStatusLabel(chosen.status)}</p>
              <Link href={`/staff/pieces/${chosen.id}`}>Open this piece</Link>
            </>
          )}
        </aside>
      </div>

      <div class="bottom-bar">
        <button
          type="button"
          class="button button--primary"
          ref={dialog.openerRef}
          onClick={() => {
            holdDialog(DIALOG, { ...draft });
            dialog.open();
          }}
        >
          New piece
        </button>
      </div>

      {dialog.mounted ? (
        <Overlay state={dialog} name="New piece" className="dialog--wide">
          <h2 class="dialog__heading">New piece</h2>
          <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
          <Select
            id={CONTROL_IDS.consignorId}
            label="Consignor"
            value={draft.consignorId}
            options={[
              { value: '', label: 'Choose a consignor' },
              ...available.map((consignor) => ({ value: consignor.id, label: consignor.name })),
            ]}
            onChange={(value) => change({ consignorId: value })}
            problem={problems.fields['consignorId']}
          />
          <Select
            id={CONTROL_IDS.category}
            label="Category"
            value={draft.category}
            options={CATEGORIES}
            onChange={(value) => change({ category: value })}
            problem={problems.fields['category']}
          />
          <Field
            id={CONTROL_IDS.brand}
            label="Brand"
            value={draft.brand}
            onInput={(value) => change({ brand: value })}
            problem={problems.fields['brand']}
          />
          <Field
            id={CONTROL_IDS.description}
            label="Description"
            value={draft.description}
            onInput={(value) => change({ description: value })}
            problem={problems.fields['description']}
          />
          <Select
            id={CONTROL_IDS.size}
            label="Size"
            value={draft.size}
            options={SIZES}
            onChange={(value) => change({ size: value })}
            problem={problems.fields['size']}
          />
          <RadioGroup
            id={CONTROL_IDS.condition}
            label="Condition"
            value={draft.condition}
            options={CONDITIONS}
            onChange={(value) => change({ condition: value })}
            problem={problems.fields['condition']}
          />
          <Field
            id={CONTROL_IDS.askingPriceCents}
            label="Asking price"
            value={draft.askingPrice}
            inputMode="decimal"
            onInput={(value) => change({ askingPrice: value })}
            problem={problems.fields['askingPriceCents']}
          />
          <Field
            id={CONTROL_IDS.intakeDate}
            label="Intake date"
            type="date"
            value={draft.intakeDate}
            onInput={(value) => change({ intakeDate: value })}
            problem={problems.fields['intakeDate']}
          />
          <DialogActions>
            <ActionButton label="Save piece" pending={pending} onPress={() => void save()} />
            <button
              type="button"
              class="button button--quiet"
              onClick={() => {
                dropDialog(DIALOG);
                dialog.close();
              }}
            >
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
