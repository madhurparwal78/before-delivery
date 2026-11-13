import { useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { failureMessage, post } from "../../lib/api";
import type { Shipment } from "./types";

interface Props {
  shipment: Shipment;
  onClose: () => void;
  onCancelled: () => void;
}

export function CancelDialog({ shipment, onClose, onCancelled }: Props): ReactNode {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cancelShipment = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await post(`/api/shipments/${shipment.shipment_id}/cancel`, {});
      onCancelled();
      onClose();
    } catch (failure) {
      setProblem(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Cancel shipment" onClose={onClose}>
      <p>
        The parcel from {shipment.seller_name} stops here, and what you paid for it goes back to where it came from.
      </p>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      <div className="dialog__actions">
        <Button variant="primary" busy={busy} onClick={() => void cancelShipment()}>
          Yes, stop this parcel
        </Button>
        <Button onClick={onClose}>Keep it</Button>
      </div>
    </Dialog>
  );
}
