// The signed-in frame shared by the desk and the drop page: session check, header, sign-out, action runner.

import { LogOut, Menu } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { User } from "../../shared/api.js";
import { del, get, type Result } from "../api.js";
import { COPY, genericProblem } from "../copy.js";
import { useFeedback } from "../feedback.js";
import { navigate } from "../hooks.js";
import { Button } from "../ui/forms.js";

const ROLE_LABELS: Record<User["role"], string> = { broker: "Broker", beekeeper: "Beekeeper", grower: "Grower" };

/** The signed-in user; a signed-out visit returns to sign-in. */
export function useSession(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    void get<{ user: User }>("/api/me").then((result) => {
      if (result.ok) setUser(result.data.user);
      else navigate("/", true);
    });
  }, []);
  return user;
}

type Failure = Extract<Result<unknown>, { ok: false }>;

interface ActionOptions<T> {
  pending: string;
  call: () => Promise<Result<T>>;
  success: (data: T, status: number) => string | void;
  /** Work to finish (refresh, close) before the success copy is announced, so the copy marks a settled page. */
  then?: (data: T, status: number) => Promise<void> | void;
  /** Copy for a refusal this action names; undefined falls back to the shared copy. */
  refusal?: (failure: Failure) => string | undefined;
  stateLabel?: () => string;
}

/** Runs one async action: busy button, pending and success copy in "Desk updates", refusals in "Desk problems". */
export function useAction() {
  const feedback = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, options: ActionOptions<T>): Promise<Result<T>> => {
      setBusy(key);
      feedback.clearProblem();
      feedback.update(options.pending);
      const result = await options.call();
      if (result.ok) {
        await options.then?.(result.data, result.status);
        setBusy(null);
        const copy = options.success(result.data, result.status);
        if (copy) feedback.update(copy);
        return result;
      }
      setBusy(null);
      feedback.update("");
      if (result.status === 401) {
        feedback.problem(COPY.sessionEnded);
        navigate("/");
        return result;
      }
      if (result.status !== 422) feedback.problem(options.refusal?.(result) ?? genericProblem(result, options.stateLabel));
      return result;
    },
    [feedback],
  );
  return { busy, run };
}

interface HeaderProps {
  user: User | null;
  skipTarget?: string;
}

export function DeskHeader({ user, skipTarget }: HeaderProps) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    await del("/api/session");
    setBusy(false);
    feedback.update("");
    navigate("/");
  };
  return (
    <header className="desk-header">
      {skipTarget ? (
        <a
          className="skip-link"
          href={`#${skipTarget}`}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(skipTarget)?.focus();
          }}
        >
          Skip to plat map
        </a>
      ) : null}
      <p className="wordmark">Swarmline Bloom Desk</p>
      <div className="who">
        {user ? (
          <span className="who-name">
            {user.name} <span className="who-role">· {ROLE_LABELS[user.role]}</span>
          </span>
        ) : null}
        <Button onClick={signOut} busy={busy} className="sign-out">
          <LogOut aria-hidden="true" size={18} strokeWidth={1.5} />
          Sign out
        </Button>
      </div>
    </header>
  );
}

interface ToggleProps {
  open: boolean;
  onClick: () => void;
  ref: React.Ref<HTMLButtonElement>;
}

export function OrchardsToggle({ open, onClick, ref }: ToggleProps) {
  return (
    <div className="desk-toolbar">
      <button ref={ref} type="button" className="button button-outline orchards-toggle" aria-expanded={open} aria-controls="orchard-rail" onClick={onClick}>
        <Menu aria-hidden="true" size={18} strokeWidth={1.5} />
        <span className="button-label">Orchards</span>
      </button>
    </div>
  );
}
