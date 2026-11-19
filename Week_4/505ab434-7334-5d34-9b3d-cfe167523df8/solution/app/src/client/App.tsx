import { useEffect, type ReactNode } from "react";
import { matchPage, mayOpen, type ScreenId } from "../shared/routes.ts";
import { navigate, onNavigate, usePath } from "./lib/router.tsx";
import { useSession } from "./lib/session.tsx";
import { PageStatusProvider } from "./ui/Status.tsx";
import { Shell } from "./ui/Shell.tsx";
import { Activate } from "./screens/Activate.tsx";
import { AdminAssets } from "./screens/AdminAssets.tsx";
import { AdminAudit } from "./screens/AdminAudit.tsx";
import { AdminGrants } from "./screens/AdminGrants.tsx";
import { AdminPeople } from "./screens/AdminPeople.tsx";
import { ChapterScreen } from "./screens/Chapter.tsx";
import { Editor } from "./screens/Editor.tsx";
import { Home } from "./screens/Home.tsx";
import { Library } from "./screens/Library.tsx";
import { NotFound } from "./screens/NotFound.tsx";
import { Queue } from "./screens/Queue.tsx";
import { RequestPage } from "./screens/RequestPage.tsx";
import { Requests } from "./screens/Requests.tsx";
import { RuleScreen } from "./screens/Rule.tsx";
import { RuleIndex } from "./screens/Rules.tsx";
import { SignIn } from "./screens/SignIn.tsx";

const SCREENS: Record<ScreenId, (props: { params: string[] }) => ReactNode> = {
  home: Home,
  chapter: ChapterScreen,
  rules: RuleIndex,
  rule: RuleScreen,
  signin: SignIn,
  activate: Activate,
  library: Library,
  requests: Requests,
  request: RequestPage,
  queue: Queue,
  editor: Editor,
  adminAssets: AdminAssets,
  adminGrants: AdminGrants,
  adminAudit: AdminAudit,
  adminPeople: AdminPeople,
};

export function App(): ReactNode {
  const path = usePath();
  const { ready, me } = useSession();
  const match = matchPage(path);
  const role = me?.principal.role ?? null;
  const denied = match !== null && !mayOpen(match.route.access, role);
  const toSignIn = ready && denied && role === null;

  useEffect(() => {
    onNavigate(() => window.scrollTo(0, 0));
  }, []);
  useEffect(() => {
    if (toSignIn) navigate("/signin", true);
  }, [toSignIn]);

  if (!ready || toSignIn) return null;
  if (!match || denied) {
    return (
      <PageStatusProvider>
        <Shell>
          <NotFound />
        </Shell>
      </PageStatusProvider>
    );
  }
  const Screen = SCREENS[match.route.screen];
  const content = <Screen key={path} params={match.params} />;
  return <PageStatusProvider>{match.route.screen === "home" ? content : <Shell wide={match.route.screen !== "signin" && match.route.screen !== "activate"}>{content}</Shell>}</PageStatusProvider>;
}
