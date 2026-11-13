import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { finishName, hubName, modelName } from "../shared/catalogue.js";
import { STATUS, lockedStatus } from "../shared/copy.js";
import { readingBlocksLock } from "../shared/derive.js";
import { rupees } from "../shared/money.js";
import type { Lock } from "../shared/types.js";
import { applyLock, acting, refreshMine } from "./mine.js";
import { call } from "./net.js";
import { room, readAgain } from "./live.js";
import { closePrompt, ensureSignedIn, register, requestSignIn, session, signIn, type Fault } from "./session.js";
import { RANK, announce } from "./status.js";
import { Store, useStore } from "./store.js";
import { Layer } from "./ui.js";

// --- Sign in

export function SignInDialog(): JSX.Element {
  const prompt = useStore(session, (s) => s.prompt);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [fault, setFault] = useState<Fault>({});
  const [busy, setBusy] = useState(false);
  const mobileRef = useRef<HTMLInputElement>(null);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = creating ? await register(name, mobile, password) : await signIn(mobile, password);
    setBusy(false);
    if (result) setFault(result);
    else {
      setPassword("");
      setFault({});
    }
  };

  return (
    <Layer open={prompt !== null} label="Sign in" onClose={closePrompt} initial="input">
      <h2>{creating ? "Create your account." : "Sign in to carry on."}</h2>
      <form class="form" onSubmit={submit} noValidate>
        {creating ? (
          <label class="field-label">
            <span>Full name</span>
            <input class="input" type="text" role="textbox" aria-label="Full name" autocomplete="name" value={name} aria-invalid={fault.name ? "true" : undefined} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            {fault.name ? <span class="fault">{fault.name}</span> : null}
          </label>
        ) : null}
        <label class="field-label">
          <span>Mobile number</span>
          <input ref={mobileRef} class="input" type="text" role="textbox" aria-label="Mobile number" inputMode="numeric" autocomplete="username" value={mobile} aria-invalid={fault.mobile ? "true" : undefined} onInput={(e) => setMobile((e.target as HTMLInputElement).value)} />
          {fault.mobile ? <span class="fault">{fault.mobile}</span> : null}
        </label>
        <label class="field-label">
          <span>Password</span>
          <input class="input" type="password" role="textbox" aria-label="Password" autocomplete={creating ? "new-password" : "current-password"} value={password} aria-invalid={fault.password ? "true" : undefined} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
          {fault.password ? <span class="fault">{fault.password}</span> : null}
        </label>
        {fault.form ? <p class="fault">{fault.form}</p> : null}
        <div class="actions">
          <button class="btn primary" type="submit">
            {creating ? "Create account" : "Sign in"}
          </button>
          <button
            class="link-quiet"
            type="button"
            onClick={() => {
              setCreating(!creating);
              setFault({});
            }}
          >
            {creating ? "I already have an account" : "New here? Create an account"}
          </button>
        </div>
      </form>
    </Layer>
  );
}

// --- Confirm your lock

const lockDialog = new Store<{ open: boolean }>({ open: false });
const openLockDialog = (): void => lockDialog.set({ open: true });
const closeLockDialog = (): void => lockDialog.set({ open: false });

/** What pressing `Lock this price` does: sign in first when nobody is, then the dialog follows. */
export async function pressLock(): Promise<void> {
  if (await ensureSignedIn()) openLockDialog();
  else requestSignIn(() => openLockDialog());
}

export function LockDialog(): JSX.Element {
  const open = useStore(lockDialog, (s) => s.open);
  const reading = useStore(room, (s) => s.drawn);
  const failed = useStore(room, (s) => s.failed);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) setPending(false);
  }, [open]);
  const q = reading?.quote;
  const blocked = pending || readingBlocksLock(reading, failed);

  const submitLock = async (): Promise<void> => {
    if (blocked || !reading) return;
    setPending(true);
    announce(STATUS.checking, RANK.lock);
    const sent = reading;
    const r = await acting(() => call<{ lock: Lock }>("POST", "/api/locks", { hub: sent.hub, model: sent.model, finish: sent.finish, stepEffectiveFrom: sent.quote.stepEffectiveFrom }));
    setPending(false);
    if (r.ok) {
      applyLock(r.data.lock);
      if (r.data.lock.state === "locked") announce(lockedStatus(r.data.lock), RANK.lock);
      closeLockDialog();
      void refreshMine();
    } else if (r.code === "price_moved" || r.status === 503) {
      readAgain();
    } else if (r.code === "none_left") {
      announce(STATUS.finishGone, RANK.lock);
      closeLockDialog();
    } else if (r.code === "lock_exists_other_finish") {
      announce(STATUS.otherLock, RANK.lock);
      closeLockDialog();
    }
  };

  return (
    <Layer open={open} label="Confirm your lock" onClose={closeLockDialog} initial="[data-confirm]">
      <h2>Confirm your lock.</h2>
      <dl>
        <dt>Model</dt>
        <dd>{reading ? modelName(reading.model) : ""}</dd>
        <dt>Finish</dt>
        <dd>{reading ? finishName(reading.finish) : ""}</dd>
        <dt>Hub</dt>
        <dd>{reading ? hubName(reading.hub) : ""}</dd>
        <dt>On-road</dt>
        <dd class="total">{q ? rupees(q.onRoadPaise) : "Reading price…"}</dd>
        <dt>Held until</dt>
        <dd>{reading ? reading.lockPreview.expiresLabel : ""}</dd>
      </dl>
      <p class="muted">The amounts are fixed when the hub accepts your lock.</p>
      <div class="actions">
        <button class="btn primary" type="button" data-confirm aria-disabled={blocked ? "true" : undefined} onClick={() => void submitLock()}>
          Confirm lock
        </button>
        <button class="btn" type="button" onClick={closeLockDialog}>
          Keep looking
        </button>
      </div>
    </Layer>
  );
}
