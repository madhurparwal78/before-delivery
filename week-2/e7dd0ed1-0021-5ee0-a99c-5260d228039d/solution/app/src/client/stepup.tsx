// Step-up confirmation (brief: Interactions, Step-up confirmation). Any action the server refuses
// with step_up_required opens this dialog; on success the action is sent once more by `api`. The
// console never tracks confirmed_until: it asks again only when the server says so.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiError, MUTATION_HEADERS, onStepUp, retryAfter } from "./api";
import { STORAGE_OUTAGE, throttledSignIn } from "./copy";
import { Dialog, Field } from "./dialog";

interface Pending {
  settle: (confirmed: boolean) => void;
}

export function StepUpHost(): JSX.Element | null {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    onStepUp(() => new Promise<boolean>((settle) => setPending({ settle })));
    return () => onStepUp(null);
  }, []);
  if (!pending) return null;
  const finish = (confirmed: boolean): void => {
    setPending(null);
    pending.settle(confirmed);
  };
  return <ConfirmDialog onDone={finish} />;
}

function ConfirmDialog({ onDone }: { onDone: (confirmed: boolean) => void }): JSX.Element {
  const [code, setCode] = useState("");
  const [alert, setAlert] = useState("");
  const [checking, setChecking] = useState(false);

  const confirm = async (event: Event): Promise<void> => {
    event.preventDefault();
    setChecking(true);
    setAlert("Checking code…");
    const response = await fetch("/api/me/two-step/confirm", {
      method: "POST",
      headers: { ...MUTATION_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    if (response?.ok) {
      onDone(true);
      return;
    }
    setChecking(false);
    if (!response) {
      setAlert(STORAGE_OUTAGE);
      return;
    }
    const error = new ApiError(response.status, await response.json());
    if (error.code === "rate_limited") setAlert(throttledSignIn(retryAfter(error)));
    else if (error.code === "service_unavailable") setAlert(STORAGE_OUTAGE);
    else setAlert(error.body.errors?.["code"] ?? error.body.errors?.["recovery_code"] ?? error.message);
  };

  return (
    <Dialog title="Confirm it's you" onClose={() => onDone(false)}>
      <form class="form" onSubmit={confirm}>
        <p class="dialog__text">Enter the current code from your authenticator app to continue.</p>
        <Field label="Authenticator code">
          {(described, id) => (
            <input id={id} data-autofocus class="mono-input" inputMode="numeric" autocomplete="one-time-code" value={code}
              aria-describedby={described} onInput={(e) => setCode(e.currentTarget.value)} />
          )}
        </Field>
        <p role="alert" class="dialog__alert">
          {alert}
        </p>
        <div class="form__actions">
          <button type="button" class="button" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button type="submit" class="button button--primary" disabled={checking}>
            Confirm
          </button>
        </div>
      </form>
    </Dialog>
  );
}
