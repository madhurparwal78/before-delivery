import { useState, type ReactElement } from 'react';
import { COLLECTION_NAME } from '../../shared/copy';
import type { Lender, LoanObject } from '../../shared/types';
import { formatLengthValue } from '../../shared/units';
import { focusIds } from '../state/focus';
import { useApp } from '../state/store';
import { Dialog, ErrorSummary, FieldMessage, type FieldError } from './common';

const formFields = [
  'title',
  'objectNumber',
  'lenderId',
  'medium',
  'unit',
  'width',
  'height',
  'luxLimit',
  'luxHourBudget',
  'insuranceValueGbp',
  'registrarNote',
] as const;

type FormField = (typeof formFields)[number];

export interface ObjectFormDialogProps {
  mode: 'add' | 'edit';
  object?: LoanObject;
  lenders: Lender[];
  onClose: () => void;
  onSaved: (objectId: string) => void;
}

export function ObjectFormDialog({
  mode,
  object,
  lenders,
  onClose,
  onSaved,
}: ObjectFormDialogProps): ReactElement {
  const { unit, saveObject, requestFocus } = useApp();
  const [title, setTitle] = useState(object?.title ?? '');
  const [objectNumber, setObjectNumber] = useState(object?.objectNumber ?? '');
  const [lenderId, setLenderId] = useState(
    object ? (object.lenderId ?? 'collection') : '',
  );
  const [medium, setMedium] = useState(object?.medium ?? '');
  const [width, setWidth] = useState(
    object ? formatLengthValue(object.widthMm, unit) : '',
  );
  const [height, setHeight] = useState(
    object ? formatLengthValue(object.heightMm, unit) : '',
  );
  const [luxLimit, setLuxLimit] = useState(object ? String(object.luxLimit) : '');
  const [luxHourBudget, setLuxHourBudget] = useState(
    object ? String(object.luxHourBudget) : '',
  );
  const [insuranceValueGbp, setInsuranceValue] = useState(
    object ? String(object.insuranceValueGbp) : '',
  );
  const [registrarNote, setRegistrarNote] = useState(object?.registrarNote ?? '');
  const [messages, setMessages] = useState<Partial<Record<FormField, string>>>({});

  const errors: FieldError[] = formFields
    .filter((field) => messages[field] !== undefined)
    .map((field) => ({ field, message: messages[field] as string }));

  const submit = async (): Promise<void> => {
    const body: Record<string, unknown> = {
      title,
      objectNumber,
      lenderId: lenderId === 'collection' ? null : lenderId,
      medium,
      width,
      height,
      unit,
      luxLimit,
      luxHourBudget,
      insuranceValueGbp,
      registrarNote,
    };
    const result = await saveObject(body, object?.id);
    if (result.ok) {
      onSaved(result.objectId);
      return;
    }
    const next: Partial<Record<FormField, string>> = {};
    for (const [field, message] of Object.entries(result.error.fields)) {
      if ((formFields as readonly string[]).includes(field)) {
        next[field as FormField] = message;
      }
    }
    setMessages(next);
    requestFocus(focusIds.errorSummary('object'));
  };

  return (
    <Dialog
      title={mode === 'add' ? 'Add object' : 'Edit object'}
      onClose={onClose}
      initialFocusId="object-title"
    >
      <ErrorSummary form="object" errors={errors} />
      <div className="field">
        <label htmlFor="object-title">Title</label>
        <input
          id="object-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <FieldMessage message={messages.title} />
      </div>
      <div className="field">
        <label htmlFor="object-objectNumber">Object number</label>
        <input
          id="object-objectNumber"
          type="text"
          value={objectNumber}
          onChange={(event) => setObjectNumber(event.target.value)}
        />
        <FieldMessage message={messages.objectNumber} />
      </div>
      <div className="field">
        <label htmlFor="object-lenderId">Lender</label>
        <select
          id="object-lenderId"
          value={lenderId}
          onChange={(event) => setLenderId(event.target.value)}
        >
          <option value="">Choose a lender</option>
          <option value="collection">{COLLECTION_NAME}</option>
          {lenders.map((lender) => (
            <option key={lender.id} value={lender.id}>
              {lender.name}
            </option>
          ))}
        </select>
        <FieldMessage message={messages.lenderId} />
      </div>
      <div className="field">
        <label htmlFor="object-medium">Medium</label>
        <input
          id="object-medium"
          type="text"
          value={medium}
          onChange={(event) => setMedium(event.target.value)}
        />
        <FieldMessage message={messages.medium} />
      </div>
      <div className="field">
        <label htmlFor="object-width">Width</label>
        <input
          id="object-width"
          type="text"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        />
        <span className="unit-label">{unit}</span>
        <FieldMessage message={messages.width} />
      </div>
      <div className="field">
        <label htmlFor="object-height">Height</label>
        <input
          id="object-height"
          type="text"
          value={height}
          onChange={(event) => setHeight(event.target.value)}
        />
        <span className="unit-label">{unit}</span>
        <FieldMessage message={messages.height} />
      </div>
      <div className="field">
        <label htmlFor="object-luxLimit">Lux limit</label>
        <input
          id="object-luxLimit"
          type="text"
          value={luxLimit}
          onChange={(event) => setLuxLimit(event.target.value)}
        />
        <FieldMessage message={messages.luxLimit} />
      </div>
      <div className="field">
        <label htmlFor="object-luxHourBudget">Lux-hour budget</label>
        <input
          id="object-luxHourBudget"
          type="text"
          value={luxHourBudget}
          onChange={(event) => setLuxHourBudget(event.target.value)}
        />
        <FieldMessage message={messages.luxHourBudget} />
      </div>
      <div className="field">
        <label htmlFor="object-insuranceValueGbp">Insurance value</label>
        <input
          id="object-insuranceValueGbp"
          type="text"
          value={insuranceValueGbp}
          onChange={(event) => setInsuranceValue(event.target.value)}
        />
        <FieldMessage message={messages.insuranceValueGbp} />
      </div>
      <div className="field">
        <label htmlFor="object-registrarNote">Registrar note</label>
        <input
          id="object-registrarNote"
          type="text"
          value={registrarNote}
          onChange={(event) => setRegistrarNote(event.target.value)}
        />
        <FieldMessage message={messages.registrarNote} />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={() => void submit()}>
          Save object
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
