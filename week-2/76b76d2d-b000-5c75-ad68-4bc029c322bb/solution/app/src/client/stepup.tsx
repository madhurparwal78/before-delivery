import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { StepupPurpose } from "../shared/domain.ts";
import { api } from "./api.ts";
import { useApp } from "./context.tsx";
import { Dialog, Field, useAction } from "./ui.tsx";

type Challenge = { id: string; expires_at: string; delivery: "sent" | "queued"; masked_email: string };

/**
 * Step-up dialog (brief: Dialogs, Stored credit and step-up). Opening sends a code; a successful Verify
 * waits for `onVerified` (checkout fetches a fresh quote), then closes and focuses the unlocked action.
 */
export function StepUp({ purpose, open, onClose, onVerified, unlocked }: {
  purpose: StepupPurpose; open: boolean; onClose: () => void; onVerified: (validUntil: string) => Promise<void>; unlocked: RefObject<HTMLElement>;
}) {
  const { t } = useApp();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [returnTo, setReturnTo] = useState<RefObject<HTMLElement> | undefined>(undefined);
  const send = useAction();
  const verify = useAction();
  const opened = useRef(false);

  const start = () => {
    void send.run(
      () => (challenge ? api<{ challenge: Challenge }>("POST", "/api/stepup/resend", { challenge_id: challenge.id }) : api<{ challenge: Challenge }>("POST", "/api/stepup/start", { purpose })),
      (data) => {
        setChallenge(data.challenge);
        return t.codeSent(data.challenge.masked_email);
      },
    );
  };
  useLayoutEffect(() => {
    if (open && !opened.current) {
      setReturnTo(undefined);
      setCode("");
      if (!challenge) start();
    }
    opened.current = open;
  }, [open]);

  const submit = (event: Event) => {
    event.preventDefault();
    if (!challenge) return;
    let validUntil = "";
    void verify.run(
      () => api<{ stepup: { verified: true; valid_until: string } }>("POST", "/api/stepup/verify", { challenge_id: challenge.id, code: code.trim() }),
      (data) => {
        validUntil = data.stepup.valid_until;
        return t.verified;
      },
    ).then(async (ok) => {
      if (!ok) return;
      await onVerified(validUntil);
      setChallenge(null);
      setReturnTo(unlocked);
      onClose();
    });
  };

  return (
    <Dialog title={t.stepupTitle} open={open} onClose={onClose} returnFocus={returnTo}>
      <form class="dialog-body" onSubmit={submit} noValidate>
        <p class="muted">{t.stepupIntro}</p>
        <Field label={t.code} value={code} onInput={setCode} autocomplete="one-time-code" inputMode="numeric" error={verify.fields["code"]} />
        <div role="status" aria-live="polite" class="status-line">{verify.status || send.status}</div>
        <div role="alert" class={verify.error || send.error ? "alert-line is-shown" : "alert-line"}>
          {verify.error ? <p>{verify.error}</p> : send.error ? <p>{send.error}</p> : null}
        </div>
        <div class="dialog-actions">
          <button type="submit" class="button primary" disabled={verify.busy || !challenge}>{verify.busy ? t.working : t.verifyCode}</button>
          <button type="button" class="button ghost" disabled={send.busy} onClick={start}>{send.busy ? t.working : t.resend}</button>
          <button type="button" class="button ghost" onClick={onClose}>{t.close}</button>
        </div>
      </form>
    </Dialog>
  );
}
