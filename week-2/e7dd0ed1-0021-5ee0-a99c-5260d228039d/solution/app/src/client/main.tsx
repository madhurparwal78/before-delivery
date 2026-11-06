// Browser entry: one shell serves every page route and this picks the screen from the address bar
// (brief: Screens and layout, Page access and redirects).
import "./styles.css";
import { type JSX, options, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiError, type Me, api } from "./api";
import { generalCopy } from "./copy";
import { AcceptInvite, SignIn } from "./auth";
import { Console } from "./console";
import { Marketing } from "./marketing";
import { Ops } from "./ops";
import { Account } from "./account";
import { StepUpHost } from "./stepup";
import { usePlace } from "./router";

// Effects run right after each commit instead of on the next animation frame, so data loads, focus moves
// and status lines never wait on frame timing. Only the Replica Wake is paced by frames.
options.requestAnimationFrame = (callback) => queueMicrotask(callback);

type Area = "console" | "ops" | "account";

// Signed-in areas: anonymous visitors go to sign-in; each role is sent to the area it may use, and
// the account page is open to everyone.
function SignedIn({ area, children }: { area: Area; children: (me: Me) => JSX.Element }): JSX.Element | null {
  const [me, setMe] = useState<Me | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    api<Me>("GET", "/api/me").then(
      (found) => {
        if (area !== "account" && found.user.operator !== (area === "ops")) location.replace(found.user.operator ? "/ops" : "/console");
        else setMe(found);
      },
      (error: unknown) => {
        if (!(error instanceof ApiError && (error.code === "unauthenticated" || error.code === "two_step_required"))) setFailure(generalCopy(error));
      },
    );
  }, [area]);
  if (failure) return <p class="status status--line">{failure}</p>;
  return me && children(me);
}

function App(): JSX.Element | null {
  const place = usePlace();
  const [, first, token] = place.path.split("/");
  if (place.path === "/") return <Marketing />;
  if (first === "signin") return <SignIn />;
  if (first === "invite" && token) return <AcceptInvite token={decodeURIComponent(token)} />;
  if (first === "console") return <SignedIn area="console">{(me) => <Console me={me} place={place} />}</SignedIn>;
  if (first === "ops") return <SignedIn area="ops">{() => <Ops place={place} />}</SignedIn>;
  if (first === "account") return <SignedIn area="account">{(me) => <Account me={me} />}</SignedIn>;
  return null;
}
// The first paint waits for the self-hosted faces (or 3 s), so a late font swap never rewraps the page under
// the reader (brief: Motion, one element moves at a time).
const FACES = ['500 1em "Space Grotesk"', '700 1em "Space Grotesk"', '400 1em "IBM Plex Sans"', '500 1em "IBM Plex Sans"',
  '600 1em "IBM Plex Sans"', '400 1em "JetBrains Mono"', '500 1em "JetBrains Mono"'];
const fontsReady = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined);
void Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 3000))]).then(() =>
  render(
    <>
      <App />
      <StepUpHost />
    </>,
    document.getElementById("app") as HTMLElement,
  ),
);
