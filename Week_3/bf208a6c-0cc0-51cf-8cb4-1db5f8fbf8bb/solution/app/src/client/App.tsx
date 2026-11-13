import { useEffect, useState } from "react";
import { ApiFailure, get } from "./api";
import { SignIn, SignUp } from "./Auth";
import { BoardScreen } from "./BoardScreen";
import { Dashboard } from "./Dashboard";
import { InvitePage } from "./InvitePage";
import { Landing } from "./Landing";
import { NotFound } from "./Screens";
import { useLocation } from "./router";
import type { Account } from "../shared/types";

export function App() {
  const [me, setMe] = useState<Account | null | undefined>(undefined);
  const { path } = useLocation();
  useEffect(() => {
    get<{ user: Account }>("/api/me").then(
      (found) => setMe(found.user),
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 401) setMe(null);
        else throw error;
      },
    );
  }, []);
  if (me === undefined) return <div className="screen" aria-busy="true" />;

  const signedOut = (): void => setMe(null);
  const [, area, id] = path.split("/");
  if (path === "/") return me ? <Dashboard me={me} onSignedOut={signedOut} /> : <Landing />;
  if (path === "/signin") return <SignIn onSignedIn={setMe} />;
  if (path === "/signup") return <SignUp onSignedIn={setMe} />;
  if (area === "b" && id) return <BoardScreen key={path} source={{ kind: "board", id }} me={me} onSignedOut={signedOut} />;
  if (area === "s" && id) return <BoardScreen key={path} source={{ kind: "link", token: id, embed: false }} me={me} onSignedOut={signedOut} />;
  if (area === "embed" && id) return <BoardScreen key={path} source={{ kind: "link", token: id, embed: true }} me={null} onSignedOut={signedOut} />;
  if (area === "invite" && id) return <InvitePage token={id} me={me} />;
  return <NotFound />;
}
