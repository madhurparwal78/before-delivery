import type { ShutdownPreview } from "../../shared/types.js";
import { addDays, dayLabel } from "../../shared/time.js";
import { Dialog } from "./Dialog.js";

const STEPS = ["Pull", "Estimate", "Check", "Timebox", "Shut down"] as const;
export type Step = (typeof STEPS)[number];

export function RitualRail({ current, onStep }: { current: Step; onStep: (step: Step) => void }) {
  return (
    <nav className="rail" aria-label="Morning ritual">
      <ol className="rail-list">
        {STEPS.map((step, i) => (
          <li key={step}>
            <button
              type="button"
              className="rail-step"
              aria-current={current === step ? "step" : undefined}
              onClick={() => onStep(step)}
            >
              <span className="rail-number mono" aria-hidden="true">
                {i + 1}
              </span>
              <span>{step}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

type ShutdownProps = {
  open: boolean;
  preview: ShutdownPreview | null;
  pending: boolean;
  onSend: () => void;
  onClose: () => void;
};

export function ShutdownDialog({ open, preview, pending, onSend, onClose }: ShutdownProps) {
  const tomorrow = preview ? dayLabel(addDays(preview.date, 1)) : "tomorrow";
  return (
    <Dialog title="Shut down" open={open} onClose={onClose}>
      {preview ? (
        <div className="shutdown">
          <section className="shutdown-list">
            <h3>Done</h3>
            {preview.done.length ? (
              <ul>{preview.done.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
            ) : (
              <p className="muted">Nothing marked done today.</p>
            )}
          </section>
          <section className="shutdown-list">
            <h3>Carry over to {tomorrow}</h3>
            {preview.carriedOver.length ? (
              <ul>{preview.carriedOver.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
            ) : (
              <p className="muted">Nothing left open.</p>
            )}
          </section>
          <section className="shutdown-list">
            <h3>Tomorrow starts with</h3>
            <p>
              {preview.tomorrowFirst ? (
                <>
                  {preview.tomorrowFirst.title} at <span className="mono">{preview.tomorrowFirst.startTime}</span>
                </>
              ) : (
                <span className="muted">Nothing scheduled yet.</span>
              )}
            </p>
          </section>
        </div>
      ) : (
        <p className="muted" aria-busy="true">
          Reading today's cards…
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button button-strong" aria-busy={pending} disabled={pending || !preview} onClick={onSend}>
          {pending ? "Shutting down…" : "Send shutdown"}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Not yet
        </button>
      </div>
    </Dialog>
  );
}
