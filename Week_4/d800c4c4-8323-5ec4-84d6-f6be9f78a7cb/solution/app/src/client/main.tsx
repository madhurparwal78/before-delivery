import "./styles.css";
import { options, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { request, type Role } from "./api";
import { Account } from "./screens/Account";
import { Desk } from "./screens/Desk";
import { FeePage } from "./screens/Fee";
import { Join } from "./screens/Join";
import { LoanPage } from "./screens/Loan";
import { NotFound } from "./screens/NotFound";
import { Office } from "./screens/Office";
import { Pegboard } from "./screens/Pegboard";
import { SignIn } from "./screens/SignIn";
import { onNavigate, takeJoinedFlag } from "./nav";
import { LANDING, signInAgainHref } from "./session";
import { Shell, type Me } from "./shell";

// Effects run right after the render that scheduled them, not on the next animation frame,
// so a screen's first read and focus never wait on frame timing.
options.requestAnimationFrame = (callback) => void Promise.resolve().then(callback);

type Screen =
  | { kind: "pegboard" }
  | { kind: "signin" }
  | { kind: "join" }
  | { kind: "account" }
  | { kind: "desk" }
  | { kind: "office" }
  | { kind: "loan"; id: number }
  | { kind: "fee"; id: number }
  | { kind: "not-found" };

function screenFor(path: string): Screen {
  const loan = /^\/loans\/(\d+)$/.exec(path);
  const fee = /^\/fees\/(\d+)$/.exec(path);
  if (path === "/") return { kind: "pegboard" };
  if (path === "/signin") return { kind: "signin" };
  if (path === "/join") return { kind: "join" };
  if (path === "/account") return { kind: "account" };
  if (path === "/desk") return { kind: "desk" };
  if (path === "/office") return { kind: "office" };
  if (loan) return { kind: "loan", id: Number(loan[1]) };
  if (fee) return { kind: "fee", id: Number(fee[1]) };
  return { kind: "not-found" };
}

const PROTECTED: Partial<Record<Screen["kind"], readonly Role[]>> = {
  account: ["member"],
  desk: ["coordinator", "volunteer"],
  office: ["coordinator"],
  loan: ["coordinator", "volunteer", "member"],
  fee: ["coordinator", "volunteer", "member"],
};

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [, setTick] = useState(0);
  const rerender = () => {
    setMe(undefined);
    setTick((t) => t + 1);
  };
  onNavigate(rerender);
  const path = window.location.pathname;
  useEffect(() => {
    void request<Me>("GET", "/api/me").then((answer) => setMe(answer.status === 200 ? answer.body : null));
  }, [path]);
  useEffect(() => {
    const back = () => rerender();
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const screen = screenFor(path);
  if (me === undefined) return <Shell me={null} ownsBoard={screen.kind === "pegboard" || screen.kind === "desk"}>{null}</Shell>;
  const allowed = PROTECTED[screen.kind];
  if (allowed && !me) {
    window.location.replace(signInAgainHref(path));
    return null;
  }
  if ((screen.kind === "signin" || screen.kind === "join") && me) {
    window.location.replace(LANDING[me.user.role]);
    return null;
  }
  const ownsBoard = screen.kind === "pegboard" || screen.kind === "desk";
  const body = (() => {
    if (allowed && me && !allowed.includes(me.user.role)) return <NotFound />;
    switch (screen.kind) {
      case "pegboard":
        return <Pegboard me={me} />;
      case "signin":
        return <SignIn />;
      case "join":
        return <Join />;
      case "account":
        return <Account me={me!} fromJoin={takeJoinedFlag()} />;
      case "desk":
        return <Desk me={me!} />;
      case "office":
        return <Office me={me!} />;
      case "loan":
        return <LoanPage me={me!} id={screen.id} />;
      case "fee":
        return <FeePage me={me!} id={screen.id} />;
      case "not-found":
        return <NotFound />;
    }
  })();
  return (
    <Shell me={me} ownsBoard={ownsBoard}>
      {body}
    </Shell>
  );
}

render(<App />, document.getElementById("root")!);
