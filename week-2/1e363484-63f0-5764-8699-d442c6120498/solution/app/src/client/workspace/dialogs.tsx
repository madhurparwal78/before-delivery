// The Unit breakdown and Seal figure dialogs of the workspace.

import { Stamp } from "lucide-react";
import { useRef, type RefObject } from "react";
import { COPY } from "../copy";
import { intervalDisplay, signed } from "../format";
import type { Preview } from "../types";
import { Dialog } from "../ui/Dialog";
import { ContributionsTable, Num } from "../ui/tables";

export function UnitBreakdownDialog({ preview, open, onClose, returnFocus }: {
  preview: Preview | null; open: boolean; onClose: () => void; returnFocus: RefObject<HTMLElement | null>;
}) {
  const close = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} title="Unit breakdown" onDismiss={onClose} initialFocus={close} returnFocus={returnFocus} className="dialog-wide">
      {preview && (
        <>
          <dl className="factors">
            <div><dt>CO2 tonnes</dt><dd className="num">Σ FC × 1800 s × 0.00004401 g/µmol × area ÷ 1 000 000</dd></div>
            <div><dt>CH4 tonnes CO2e</dt><dd className="num">Σ FCH4 × 1800 s × 0.00000001604 g/nmol × 27.0 (GWP100) × area ÷ 1 000 000</dd></div>
          </dl>
          <p className="dialog-meta num">{intervalDisplay(preview.start, preview.end)}</p>
          <ContributionsTable
            name="Unit breakdown"
            contributions={preview.contributions}
            totals={{ co2: preview.co2_tco2e, ch4: preview.ch4_tco2e, net: preview.net_tco2e }}
          />
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" ref={close} onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export interface SealUi {
  key: string;
  preview: Preview;
  phase: "ready" | "pending" | "answered";
  message: string | null;
  confirmBlocked: boolean;
}

export function SealDialog({ seal, onConfirm, onCancel, confirmButton, cancelButton, returnFocus }: {
  seal: SealUi | null;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButton: RefObject<HTMLButtonElement | null>;
  cancelButton: RefObject<HTMLButtonElement | null>;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const p = seal?.preview;
  const pending = seal?.phase === "pending";
  return (
    <Dialog open={seal !== null} title="Seal figure" onDismiss={onCancel} initialFocus={confirmButton} returnFocus={returnFocus} locked={pending}>
      {p && (
        <dl className="seal-summary">
          <div><dt>Interval</dt><dd><Num>{intervalDisplay(p.start, p.end)}</Num></dd></div>
          <div><dt>Sensors</dt><dd><Num>{p.sensor_ids.join(", ")}</Num></dd></div>
          <div><dt>Coverage</dt><dd><Num>{p.coverage_pct}%</Num> <span className="muted-note">floor <Num>{p.floor_pct}%</Num></span></dd></div>
          <div><dt>Net tCO2e</dt><dd><Num>{signed(p.net_tco2e)}</Num></dd></div>
          <div><dt>Buffer tCO2e</dt><dd><Num>{p.buffer_tco2e}</Num> <span className="muted-note">at <Num>{p.buffer_pct}%</Num></span></dd></div>
          <div className="seal-credited"><dt>Credited tCO2e</dt><dd><Num className="strong">{signed(p.credited_tco2e)}</Num></dd></div>
          <div><dt>Fingerprint</dt><dd><Num className="fingerprint">{p.fingerprint.slice(0, 12)}</Num></dd></div>
        </dl>
      )}
      {seal?.message && <p role="alert" className="alert">{seal.message}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" ref={cancelButton} onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="button" className="btn btn-confirm" ref={confirmButton} onClick={onConfirm} disabled={pending || seal?.confirmBlocked}>
          <Stamp size={16} aria-hidden="true" /> {pending ? COPY.sealingLabel : "Confirm seal"}
        </button>
      </div>
    </Dialog>
  );
}
