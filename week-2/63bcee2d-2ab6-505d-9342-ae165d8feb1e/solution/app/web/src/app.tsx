import { useLocation, match } from "./router";
import { OfficeProvider } from "./office/context";
import { CaseStudiesPage } from "./office/pages/casestudies";
import { EnquiriesPage } from "./office/pages/enquiries";
import { JoinPage } from "./office/pages/join";
import { LevellingPage } from "./office/pages/levelling";
import { MembersPage } from "./office/pages/members";
import { RolloutsPage } from "./office/pages/rollouts";
import { SignInPage } from "./office/pages/signin";
import { TenderPage } from "./office/pages/tender";
import { TenderSignInPage } from "./office/pages/tendersignin";
import { ProjectPage } from "./office/project";
import { PublicApp } from "./public/app";

// Top-level routing: office screens inside the office frame, everything else on the public site, which
// also draws the not-found page (the server marks a 404 address in the page it sends).

const serverNotFound = document.querySelector('meta[name="plumbline-status"]')?.getAttribute("content") === "404";
const firstPath = location.pathname;

function officeScreen(pathname: string) {
  let params: Record<string, string> | null;
  if (pathname === "/sign-in") return <SignInPage />;
  if ((params = match("/invite/:token", pathname))) return <JoinPage token={params.token} />;
  if ((params = match("/tender-sign-in/:token", pathname))) return <TenderSignInPage token={params.token} />;
  if (pathname === "/office" || pathname === "/office/") return <RolloutsPage />;
  if (pathname === "/office/members") return <MembersPage />;
  if (pathname === "/office/case-studies") return <CaseStudiesPage />;
  if (pathname === "/office/enquiries") return <EnquiriesPage />;
  if ((params = match("/office/projects/:id/:section", pathname))) return <ProjectPage id={params.id} section={params.section} />;
  if ((params = match("/office/tenders/:id/levelling", pathname))) return <LevellingPage id={params.id} />;
  if ((params = match("/office/tenders/:id", pathname))) return <TenderPage id={params.id} />;
  return null;
}

export function App() {
  const { pathname } = useLocation();
  const notFound = serverNotFound && pathname === firstPath;
  const office = notFound ? null : officeScreen(pathname);
  if (office) return <OfficeProvider>{office}</OfficeProvider>;
  return <PublicApp notFound={notFound} />;
}
