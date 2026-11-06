import { useEffect, useState } from "react";
import type { Me } from "../shared/api.js";
import { api, whenSessionEnds } from "./api.js";
import { FeedbackProvider, useFeedback } from "./feedback.js";
import { CompaniesPage } from "./pages/Companies.js";
import { CompanyPage } from "./pages/CompanyDetail.js";
import { FeatureDetailPage } from "./pages/FeatureDetail.js";
import { FeaturesPage } from "./pages/Features.js";
import { ImportPage } from "./pages/Import.js";
import { InboxPage } from "./pages/Inbox.js";
import { InvitePage } from "./pages/Invite.js";
import { PublicRoadmapPage } from "./pages/PublicRoadmap.js";
import { RoadmapPage } from "./pages/Roadmap.js";
import { SettingsPage } from "./pages/Settings.js";
import { SignInPage } from "./pages/SignIn.js";
import { navigate, usePath } from "./router.js";
import { Shell } from "./shell/Shell.js";

function MemberPage({ path, me }: { path: string; me: Me }) {
  const [, section = "", id] = path.split("/");
  switch (section) {
    case "inbox": return <InboxPage me={me} noteId={id ?? null} />;
    case "features": return id ? <FeatureDetailPage me={me} featureId={id} /> : <FeaturesPage me={me} />;
    case "roadmap": return <RoadmapPage me={me} />;
    case "companies": return id ? <CompanyPage me={me} companyId={id} /> : <CompaniesPage />;
    case "import": return <ImportPage />;
    case "settings": return me.user.role === "head_of_product" ? <SettingsPage me={me} /> : <InboxPage me={me} noteId={null} />;
    default: return <InboxPage me={me} noteId={null} />;
  }
}

function Member({ path }: { path: string }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api.get<Me>("/api/me").then(setMe, () => undefined);
  }, []);
  if (!me) return <div className="boot" aria-busy="true" />;
  return (
    <Shell me={me} path={path}>
      <MemberPage path={path} me={me} />
    </Shell>
  );
}

function Routes() {
  const path = usePath();
  const feedback = useFeedback();
  useEffect(() => {
    whenSessionEnds(() => {
      if (location.pathname === "/signin") return;
      navigate("/signin");
      feedback.warn("Your session ended. Sign in again.");
    });
  }, [feedback]);
  if (path === "/signin") return <SignInPage />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite?.[1]) return <InvitePage token={invite[1]} />;
  const shared = /^\/r\/([^/]+)$/.exec(path);
  if (shared?.[1]) return <PublicRoadmapPage token={shared[1]} />;
  return <Member path={path} />;
}

export function App() {
  return (
    <FeedbackProvider>
      <Routes />
    </FeedbackProvider>
  );
}
