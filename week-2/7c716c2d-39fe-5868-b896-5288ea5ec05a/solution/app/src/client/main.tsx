// The page: landing rules, the signed-out and no-workspace screens, and the workspace shell.
import "./styles.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { boot } from "./boot";
import { dropDraft, keepUnsaved, settleDraftOwner } from "./draft";
import { api, get, nextPerson, watchApi, type Me } from "./api";
import { Notices } from "./components/Notices";
import { CreateAccount, Invitations, SignIn, Welcome } from "./screens/Public";
import { Workspace } from "./screens/Workspace";
import { navigate, useLocation, type Location } from "./router";
import { ServicesProvider } from "./services";

const WELCOME_FLAG = "tr_welcome";

function redirectFor(location: Location, me: Me | null): string | null {
  const path = location.path;
  if (!me) {
    if (path === "/sign-in" || path === "/create-account") return null;
    if (path === "/") return "/sign-in";
    return `/sign-in?next=${encodeURIComponent(path + location.search)}`;
  }
  if (!me.workspace) return path === "/invitations" ? null : "/invitations";
  if (path === "/" || path === "/invitations" || path === "/sign-in" || path === "/create-account") return "/issues";
  if (path === "/welcome") return sessionStorage.getItem(WELCOME_FLAG) ? null : "/issues";
  if ((path === "/settings" || path.startsWith("/settings/")) && me.person.role !== "owner") return "/issues";
  if (path === "/account" && me.person.role === "owner") return "/settings";
  return null;
}

function Root(): JSX.Element {
  const location = useLocation();
  const [me, setMe] = useState<Me | null | undefined>(boot ? (boot.signed_in?.me ?? null) : undefined);
  const refreshStatus = useRef<() => void>(() => undefined);

  const person = useRef<string | null>(boot?.signed_in?.me.person.id ?? null);

  /** Everything the page holds for this person goes; only an unsaved doc edit survives, in this tab. */
  const signedOut = useCallback(() => {
    if (person.current === null) return;
    person.current = null;
    nextPerson();
    const docId = keepUnsaved();
    setMe(null);
    navigate(docId ? `/sign-in?next=${encodeURIComponent(`/docs/${docId}`)}` : "/sign-in", { replace: true, state: { signedOut: true } });
  }, []);

  const adopt = useCallback((next: Me | null) => {
    if ((next?.person.id ?? null) !== person.current) nextPerson();
    person.current = next?.person.id ?? null;
    if (next) settleDraftOwner(next.person.id);
    setMe(next);
  }, []);

  useEffect(() => {
    watchApi({ serviceTrouble: () => refreshStatus.current(), signedOut });
    if (boot) return;
    get<Me>("/api/me")
      .then(adopt)
      .catch(() => adopt(null));
  }, [signedOut, adopt]);

  const redirect = me === undefined ? null : redirectFor(location, me);
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
    if (location.path !== "/welcome") sessionStorage.removeItem(WELCOME_FLAG);
  }, [redirect, location.path]);

  const signOut = async (): Promise<void> => {
    dropDraft();
    person.current = null;
    await api("DELETE", "/api/session").catch(() => undefined);
    nextPerson();
    setMe(null);
    navigate("/sign-in", { replace: true });
  };

  let screen: JSX.Element | null = null;
  if (me !== undefined && !redirect) {
    if (!me) {
      screen =
        location.path === "/create-account" ? (
          <CreateAccount
            onCreated={(person) => {
              adopt({ person, workspace: null });
              navigate("/invitations", { replace: true });
            }}
          />
        ) : (
          <SignIn
            signedOut={Boolean((location.state as { signedOut?: boolean } | null)?.signedOut)}
            next={new URLSearchParams(location.search).get("next")}
            onSignedIn={adopt}
          />
        );
    } else if (!me.workspace) {
      screen = (
        <Invitations
          me={me}
          onSignOut={() => void signOut()}
          onJoined={(joined) => {
            sessionStorage.setItem(WELCOME_FLAG, "1");
            adopt(joined);
            navigate("/welcome", { replace: true });
          }}
        />
      );
    } else if (location.path === "/welcome") {
      screen = <Welcome workspace={me.workspace.name} onSignOut={() => void signOut()} />;
    } else {
      screen = (
        <Workspace
          key={me.person.id}
          person={me.person}
          workspace={me.workspace}
          location={location}
          onSignOut={() => void signOut()}
          onSignedOut={signedOut}
          onNotice={() => refreshStatus.current()}
        />
      );
    }
  }

  return (
    <ServicesProvider refreshRef={(refresh) => (refreshStatus.current = refresh)}>
      <Notices me={me ?? null} path={location.path} />
      {screen}
    </ServicesProvider>
  );
}

/** Every face above the fold; the first render waits for them so no fallback text swaps and reflows. */
const FACES = ["400 1em 'IBM Plex Sans'", "600 1em 'IBM Plex Sans'", "500 1em 'IBM Plex Sans Condensed'", "600 1em 'IBM Plex Sans Condensed'", "400 1em 'IBM Plex Mono'", "500 1em 'IBM Plex Mono'"];
const FONT_WAIT_MS = 800;

const root = createRoot(document.getElementById("root") as HTMLElement);
const render = (): void => flushSync(() => root.render(<Root />));
const fonts = Promise.all(FACES.map((face) => document.fonts.load(face)));
void Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).then(render, render);
