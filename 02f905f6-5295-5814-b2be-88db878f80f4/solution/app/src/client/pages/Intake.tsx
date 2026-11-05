// Member intake at the bench: the form, the Fee panel, Accept and charge.
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { Piece, User } from "../../shared/api";
import { request } from "../api";
import { ErrorSummary } from "../components/ErrorSummary";
import { FeePanel, fieldId, IntakeFields, PhotoField, useIntake } from "../components/IntakeForm";

/** Keeps a focused field above a panel pinned to the bottom edge of a phone screen. */
function usePinnedPanel(panel: RefObject<HTMLElement | null>, form: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = panel.current;
    const area = form.current;
    if (!element || !area) return;
    const pinned = () => getComputedStyle(element).position === "fixed";
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--pinned-h", pinned() ? `${element.offsetHeight}px` : "0px");
    });
    observer.observe(element);
    const onFocus = (event: FocusEvent) => {
      if (!pinned() || !(event.target instanceof HTMLElement)) return;
      const box = event.target.getBoundingClientRect();
      const limit = window.innerHeight - element.offsetHeight - 12;
      if (box.bottom > limit) window.scrollBy({ top: box.bottom - limit, behavior: "instant" });
    };
    area.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      area.removeEventListener("focusin", onFocus);
      document.documentElement.style.setProperty("--pinned-h", "0px");
    };
  }, [panel, form]);
}

export function Intake({ user }: { user: User }) {
  const intake = useIntake();
  const [result, setResult] = useState<{ text: string; tone: "ok" | "error" | "" }>({ text: "", tone: "" });
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  usePinnedPanel(panel, form);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!intake.ready || busy) return;
    setBusy(true);
    intake.setErrors({});
    setResult({ text: "Saving photo, charge and receipt…", tone: "" });
    const outcome = await request<Piece>("POST", "/api/intakes", intake.body(), intake.submissionKey());
    setBusy(false);
    if (outcome.ok) {
      setResult({ text: `Piece ${outcome.data.number} accepted. Receipt sent to ${user.email}.`, tone: "ok" });
      intake.reset();
    } else if (outcome.status === 422 && outcome.error?.fields) {
      intake.setErrors(outcome.error.fields);
      setResult({ text: "", tone: "" });
    } else {
      setResult({ text: outcome.error?.message ?? "Intake not saved — the studio server is unreachable.", tone: "error" });
    }
  };

  return (
    <div className="page intake-page">
      <div className="page-head">
        <h1>Log a piece</h1>
        <p className="muted">Measured at the bench, charged per cubic inch.</p>
      </div>
      <div className="intake-layout">
        <form ref={form} className="intake-form pane" onSubmit={submit} aria-labelledby="intake-form-title" noValidate>
          <h2 id="intake-form-title" className="visually-hidden">
            Piece details
          </h2>
          <ErrorSummary errors={intake.errors} fieldId={fieldId} />
          <IntakeFields intake={intake} />
          <PhotoField intake={intake} />
          <div className="submit-row">
            <button type="submit" className="btn btn-primary" disabled={!intake.ready || busy}>
              Accept and charge
            </button>
            <p role="status" aria-label="Intake result" className={`result${result.tone ? ` is-${result.tone}` : ""}`}>
              {result.text}
            </p>
          </div>
        </form>
        <div ref={panel} className="fee-slot">
          <FeePanel estimate={intake.estimate} pinned />
        </div>
      </div>
    </div>
  );
}
