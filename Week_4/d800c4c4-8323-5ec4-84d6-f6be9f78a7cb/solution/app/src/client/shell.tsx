import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { request, type Board, type Counts, type Membership, type ServiceStatus, type User } from "./api";
import { prefersReducedMotion, usePoll } from "./components/ui";

export interface Me {
  user: User;
  membership: Membership | null;
}

interface ShellState {
  me: Me | null;
  status: ServiceStatus;
  /** Ask for a status read every second (a Desk with a pending-photo loan selected). */
  setFastStatus: (fast: boolean) => void;
  /** Show the board counts a screen read itself; `bumped` animates the On the wall numeral after own hangs. */
  setCounts: (counts: Counts, bumped?: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);
export const useShell = () => useContext(ShellContext)!;

const STORAGE_BANNER = "Photo storage is down. Check-ins are held as pending photo until it is back.";
const BILLING_BANNER = "Billing is down. Joins, payments, waivers and check-ins that raise a fee will wait until it is back.";

function Numeral({ value, bumped }: { value: number; bumped: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useLayoutEffect(() => {
    if (bumped && value > shown.current && ref.current && !prefersReducedMotion()) {
      ref.current.animate(
        [
          { transform: "translateY(0.6em)", opacity: 0.2 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { duration: 240, easing: "cubic-bezier(.2,.8,.3,1)" },
      );
    }
    shown.current = value;
  }, [value, bumped]);
  return (
    <span class="count-value num" ref={ref}>
      {value}
    </span>
  );
}

export function Shell({ me, ownsBoard, children }: { me: Me | null; ownsBoard: boolean; children: ComponentChildren }) {
  const [status, setStatus] = useState<ServiceStatus>({ storage: "up", billing: "up" });
  const [fast, setFast] = useState(false);
  const [counts, setCountsState] = useState<{ value: Counts; bumped: boolean } | null>(null);
  const readStatus = useCallback(async () => {
    const answer = await request<ServiceStatus>("GET", "/api/status");
    if (answer.status === 200) setStatus(answer.body);
  }, []);
  const readCounts = useCallback(async () => {
    const answer = await request<Board>("GET", "/api/board");
    if (answer.status === 200) setCountsState({ value: answer.body.counts, bumped: false });
  }, []);
  useEffect(() => {
    void readStatus();
    if (!ownsBoard) void readCounts();
  }, []);
  usePoll(readStatus, fast ? 1000 : 10_000);
  usePoll(readCounts, 10_000, !ownsBoard);
  const banner = [status.storage === "down" ? STORAGE_BANNER : "", status.billing === "down" ? BILLING_BANNER : ""].filter(Boolean).join(" ");
  const role = me?.user.role;
  const state: ShellState = {
    me,
    status,
    setFastStatus: setFast,
    setCounts: (value, bumped = false) => setCountsState({ value, bumped }),
  };
  return (
    <ShellContext.Provider value={state}>
      <header class="top-bar">
        <a class="wordmark" href="/">
          Pegworth
        </a>
        <div role="group" aria-label="Board counts" class="board-counts">
          <span class="count">
            On the wall <Numeral value={counts?.value.on_wall ?? 0} bumped={counts?.bumped ?? false} />
          </span>
          <span class="count">
            Out on loan <span class="count-value num">{counts?.value.out ?? 0}</span>
          </span>
          <span class="count">
            Missing <span class="count-value num">{counts?.value.missing ?? 0}</span>
          </span>
        </div>
        <nav class="top-nav" aria-label="Screens">
          <a href="/">Pegboard</a>
          {role === "member" && <a href="/account">Account</a>}
          {(role === "volunteer" || role === "coordinator") && <a href="/desk">Desk</a>}
          {role === "coordinator" && <a href="/office">Office</a>}
          {me ? (
            <button
              type="button"
              class="link-button"
              onClick={async () => {
                await request("DELETE", "/api/session");
                window.location.assign("/");
              }}
            >
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              </svg>
              Sign out
            </button>
          ) : (
            <a href="/signin">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m10 17 5-5-5-5" />
                <path d="M15 12H3" />
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              </svg>
              Sign in
            </a>
          )}
        </nav>
      </header>
      <div role="status" aria-label="Service status" class={banner ? "service-banner" : "service-banner is-empty"}>
        {banner}
      </div>
      <main class="screen">{children}</main>
    </ShellContext.Provider>
  );
}
