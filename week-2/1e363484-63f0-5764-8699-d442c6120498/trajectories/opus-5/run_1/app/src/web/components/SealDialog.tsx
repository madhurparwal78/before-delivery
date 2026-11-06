import { useEffect, useRef } from 'react';
import type { Preview } from '../api';
import { COPY } from '../copy';
import { intervalDisplay, signedTonnes } from '../format';
import { Dialog } from './Dialog';

export interface SealDialogProps {
  readonly preview: Preview;
  readonly pending: boolean;
  readonly refusal: string | null;
  readonly confirmDisabled: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function SealDialog(props: SealDialogProps): React.ReactElement {
  const { preview } = props;
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (props.refusal !== null && props.confirmDisabled) cancelRef.current?.focus();
  }, [props.refusal, props.confirmDisabled]);

  return (
    <Dialog label="Seal figure" onClose={props.onCancel} initialFocus="first">
      <h2>Seal figure</h2>
      <dl className="figure-panel">
        <dt>Interval</dt>
        <dd className="num">
          {intervalDisplay(Date.parse(preview.start))} to {intervalDisplay(Date.parse(preview.end))}
        </dd>
        <dt>Sensors</dt>
        <dd className="num">{preview.sensor_ids.join(', ')}</dd>
        <dt>Coverage</dt>
        <dd className="num">{preview.coverage_pct}%</dd>
        <dt>Net tCO2e</dt>
        <dd className="num">{signedTonnes(preview.net_tco2e)}</dd>
        <dt>Buffer tCO2e</dt>
        <dd className="num">{preview.buffer_tco2e}</dd>
        <dt>Credited tCO2e</dt>
        <dd className="num">{signedTonnes(preview.credited_tco2e)}</dd>
        <dt>Fingerprint</dt>
        <dd className="num">{preview.fingerprint.slice(0, 12)}</dd>
      </dl>
      <div className="dialog-actions">
        <button
          type="button"
          className={props.pending || props.confirmDisabled ? undefined : 'armed'}
          disabled={props.pending || props.confirmDisabled}
          onClick={props.onConfirm}
        >
          {props.pending ? COPY.sealingLabel : 'Confirm seal'}
        </button>
        <button type="button" ref={cancelRef} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {props.refusal === null ? null : (
        <div role="alert" className="alert">
          {props.refusal}
        </div>
      )}
    </Dialog>
  );
}
