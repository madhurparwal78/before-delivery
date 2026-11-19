import type { ReactNode } from "react";
import { Dialog } from "./Dialog.jsx";
import { submitDialogBody } from "../../shared/copy.js";

export interface SubmitDialogProps {
  findingCount: number;
  violationCount: number;
  foresterEmail: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function SubmitDialog(props: SubmitDialogProps): ReactNode {
  return (
    <Dialog
      title="Submit findings set"
      onClose={props.onClose}
      footer={
        <>
          <button
            type="button"
            className="button button--primary"
            aria-disabled={props.pending}
            onClick={() => {
              if (props.pending) return;
              props.onConfirm();
            }}
          >
            {props.pending ? "Submitting..." : "Confirm submit"}
          </button>
          <button type="button" className="button" onClick={props.onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p>
        {submitDialogBody(props.findingCount, props.violationCount, props.foresterEmail)}
      </p>
    </Dialog>
  );
}
