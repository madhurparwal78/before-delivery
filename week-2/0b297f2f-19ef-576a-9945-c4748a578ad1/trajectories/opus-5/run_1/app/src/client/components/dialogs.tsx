import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { fieldMessages, rejectionField } from '../../shared/copy';
import type { LoanObject, Placement, Wall } from '../../shared/types';
import {
  CENTRE_LINE_MM,
  formatLengthValue,
  formatLuxHours,
  formatWhole,
  lengthToMm,
  MIN_GAP_MM,
} from '../../shared/units';
import { ApiCallError } from '../api';
import { focusIds } from '../state/focus';
import { useApp } from '../state/store';
import { Dialog, ErrorSummary, FieldMessage, type FieldError } from './common';

type PlacementFieldName = 'wall' | 'offset' | 'centreHeight';

function errorsFrom(
  error: ApiCallError,
): { order: PlacementFieldName[]; messages: Partial<Record<PlacementFieldName, string>> } {
  const messages: Partial<Record<PlacementFieldName, string>> = {};
  const order: PlacementFieldName[] = [];
  const reason = error.body.error.reason;
  if (reason) {
    const field = rejectionField[reason];
    messages[field] = error.body.error.message;
    order.push(field);
  }
  for (const [field, message] of Object.entries(error.fields)) {
    const name: PlacementFieldName | null =
      field === 'offsetMm' ? 'offset' : field === 'centreHeightMm' ? 'centreHeight' : null;
    if (name && !messages[name]) {
      messages[name] = message;
      order.push(name);
    }
  }
  return { order, messages };
}

function summaryErrors(
  order: PlacementFieldName[],
  messages: Partial<Record<PlacementFieldName, string>>,
): FieldError[] {
  const sequence: PlacementFieldName[] = ['wall', 'offset', 'centreHeight'];
  return sequence
    .filter((field) => order.includes(field) && messages[field] !== undefined)
    .map((field) => ({ field, message: messages[field] as string }));
}

/** The leftmost offset on a wall that leaves the published gap to its neighbours. */
function suggestOffsetMm(
  wall: Wall,
  placements: readonly Placement[],
  widthMm: number,
): number {
  const occupied = placements
    .filter((placement) => placement.wallId === wall.id)
    .map((placement) => ({
      left: placement.offsetMm - placement.widthMm / 2,
      right: placement.offsetMm + placement.widthMm / 2,
    }))
    .sort((a, b) => a.left - b.left);
  let cursor = 0;
  for (const span of occupied) {
    if (span.left - MIN_GAP_MM - cursor >= widthMm) break;
    cursor = Math.max(cursor, span.right + MIN_GAP_MM);
  }
  const centre = Math.round(cursor + widthMm / 2);
  return Math.max(Math.round(widthMm / 2), Math.min(centre, wall.lengthMm - Math.round(widthMm / 2)));
}

export interface PlaceDialogProps {
  object: LoanObject;
  walls: Wall[];
  onClose: (options?: { keepFocus?: boolean }) => void;
}

export function PlaceDialog({ object, walls, onClose }: PlaceDialogProps): ReactElement {
  const { unit, place, requestFocus, placements } = useApp();
  const [wallId, setWallId] = useState<string>(walls[0]?.id ?? '');
  const wall = walls.find((item) => item.id === wallId);
  const [offset, setOffset] = useState<string>(() =>
    walls[0]
      ? formatLengthValue(suggestOffsetMm(walls[0], placements, object.widthMm), unit)
      : '',
  );
  const [centreHeight, setCentreHeight] = useState<string>(formatLengthValue(CENTRE_LINE_MM, unit));
  const [heightOverride, setHeightOverride] = useState(false);
  const [messages, setMessages] = useState<Partial<Record<PlacementFieldName, string>>>({});
  const [order, setOrder] = useState<PlacementFieldName[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (wall) {
      setOffset(formatLengthValue(suggestOffsetMm(wall, placements, object.widthMm), unit));
    }
  }, [wallId, unit]);

  const errors = useMemo(() => summaryErrors(order, messages), [order, messages]);

  const submit = async (): Promise<void> => {
    const offsetMm = lengthToMm(offset, unit);
    const centreMm = lengthToMm(centreHeight, unit);
    if (offsetMm === null || centreMm === null) {
      const next: Partial<Record<PlacementFieldName, string>> = {};
      const nextOrder: PlacementFieldName[] = [];
      if (offsetMm === null) {
        next.offset = fieldMessages.millimetres;
        nextOrder.push('offset');
      }
      if (centreMm === null) {
        next.centreHeight = fieldMessages.millimetres;
        nextOrder.push('centreHeight');
      }
      setMessages(next);
      setOrder(nextOrder);
      requestFocus(focusIds.errorSummary('place'));
      return;
    }
    setSaving(true);
    const result = await place({
      objectId: object.id,
      wallId,
      offsetMm,
      centreHeightMm: centreMm,
      heightOverride,
    });
    setSaving(false);
    if (result.ok) {
      onClose({ keepFocus: true });
      return;
    }
    const mapped = errorsFrom(result.error);
    setMessages(mapped.messages);
    setOrder(mapped.order);
    requestFocus(focusIds.errorSummary('place'));
  };

  return (
    <Dialog title="Place work" onClose={() => onClose()} initialFocusId="place-wall">
      <ErrorSummary form="place" errors={errors} />
      <div className="field">
        <label htmlFor="place-wall">Wall</label>
        <select id="place-wall" value={wallId} onChange={(event) => setWallId(event.target.value)}>
          {walls.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <FieldMessage message={messages.wall} />
      </div>
      <div className="field">
        <label htmlFor="place-offset">Offset from left end</label>
        <input
          id="place-offset"
          type="text"
          value={offset}
          onChange={(event) => setOffset(event.target.value)}
        />
        <span className="unit-label">{unit}</span>
        <FieldMessage message={messages.offset} />
      </div>
      <div className="field">
        <label htmlFor="place-centreHeight">Centre height</label>
        <input
          id="place-centreHeight"
          type="text"
          value={centreHeight}
          onChange={(event) => setCentreHeight(event.target.value)}
        />
        <span className="unit-label">{unit}</span>
        <FieldMessage message={messages.centreHeight} />
      </div>
      <div className="field field-checkbox">
        <input
          id="place-override"
          type="checkbox"
          checked={heightOverride}
          onChange={(event) => setHeightOverride(event.target.checked)}
        />
        <label htmlFor="place-override">Off the centre line (exception)</label>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={() => void submit()} aria-disabled={saving}>
          Save placement
        </button>
        <button type="button" onClick={() => onClose()}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export interface PlacementDetailsDialogProps {
  placement: Placement;
  walls: Wall[];
  onClose: () => void;
}

export function PlacementDetailsDialog({
  placement,
  walls,
  onClose,
}: PlacementDetailsDialogProps): ReactElement {
  const { unit, saveMove, staff, requestFocus } = useApp();
  const [wallId, setWallId] = useState(placement.wallId);
  const [offset, setOffset] = useState(formatLengthValue(placement.offsetMm, unit));
  const [centreHeight, setCentreHeight] = useState(
    formatLengthValue(placement.centreHeightMm, unit),
  );
  const [heightOverride, setHeightOverride] = useState(placement.heightOverride);
  const [messages, setMessages] = useState<Partial<Record<PlacementFieldName, string>>>({});
  const [order, setOrder] = useState<PlacementFieldName[]>([]);
  const isCurator = staff?.role === 'curator';
  const errors = useMemo(() => summaryErrors(order, messages), [order, messages]);

  const submit = async (): Promise<void> => {
    const offsetMm = lengthToMm(offset, unit);
    const centreMm = lengthToMm(centreHeight, unit);
    if (offsetMm === null || centreMm === null) {
      const next: Partial<Record<PlacementFieldName, string>> = {};
      const nextOrder: PlacementFieldName[] = [];
      if (offsetMm === null) {
        next.offset = fieldMessages.millimetres;
        nextOrder.push('offset');
      }
      if (centreMm === null) {
        next.centreHeight = fieldMessages.millimetres;
        nextOrder.push('centreHeight');
      }
      setMessages(next);
      setOrder(nextOrder);
      requestFocus(focusIds.errorSummary('details'));
      return;
    }
    const result = await saveMove(placement.id, {
      offsetMm,
      centreHeightMm: centreMm,
      heightOverride,
      ...(isCurator ? { wallId } : {}),
    });
    if (result.ok) {
      onClose();
      return;
    }
    const mapped = errorsFrom(result.error);
    setMessages(mapped.messages);
    setOrder(mapped.order);
    requestFocus(focusIds.errorSummary('details'));
  };

  return (
    <Dialog title="Placement details" onClose={onClose} initialFocusId="details-offset">
      <ErrorSummary form="details" errors={errors} />
      {isCurator ? (
        <div className="field">
          <label htmlFor="details-wall">Wall</label>
          <select
            id="details-wall"
            value={wallId}
            onChange={(event) => setWallId(event.target.value)}
          >
            {walls.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <FieldMessage message={messages.wall} />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="details-offset">Offset from left end</label>
        <input
          id="details-offset"
          type="text"
          value={offset}
          onChange={(event) => setOffset(event.target.value)}
        />
        <span className="unit-label">{unit}</span>
        <FieldMessage message={messages.offset} />
      </div>
      <div className="field">
        <label htmlFor="details-centreHeight">Centre height</label>
        <input
          id="details-centreHeight"
          type="text"
          value={centreHeight}
          onChange={(event) => setCentreHeight(event.target.value)}
        />
        <span className="unit-label">{unit}</span>
        <FieldMessage message={messages.centreHeight} />
      </div>
      <div className="field field-checkbox">
        <input
          id="details-override"
          type="checkbox"
          checked={heightOverride}
          onChange={(event) => setHeightOverride(event.target.checked)}
        />
        <label htmlFor="details-override">Off the centre line (exception)</label>
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={() => void submit()}>
          Save
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function LuxDetailsDialog({
  placement,
  onClose,
}: {
  placement: Placement;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog title="Lux details" onClose={onClose} initialFocusId="lux-close">
      <ul className="lux-details">
        <li>{`Planned lux ${formatWhole(placement.plannedLux)} lux`}</li>
        <li>{`Lux limit ${formatWhole(placement.luxLimit)} lux`}</li>
        <li>{`Planned lux-hours ${formatLuxHours(placement.plannedLuxHours)} lux-hours`}</li>
        <li>{`Lux-hour budget ${formatLuxHours(placement.luxHourBudget)} lux-hours`}</li>
        <li>{`Status ${placement.luxStatus === 'over' ? 'Over budget' : 'Within limit'}`}</li>
      </ul>
      <div className="dialog-actions">
        <button type="button" id="lux-close" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
