import { type ReactElement } from "react";
import { Announcements } from "../announce";
import { initialStatus } from "../settings";
import { ToastHost } from "../toast";
import { matchPath, useLocation } from "../router";
import { Apply } from "../pages/Apply";
import { Applications, ApplicationDetail } from "../pages/Applications";
import { Alerts } from "../pages/Alerts";
import { Channel, Channels } from "../pages/Channels";
import { CompanyPage } from "../pages/Company";
import { Companies } from "../pages/Companies";
import { Contribute } from "../pages/Contribute";
import { Employer, NewJob } from "../pages/Employer";
import { Forgot, Join, JoinConfirm, Reset, SignIn } from "../pages/Auth";
import { Founder } from "../pages/Founder";
import { JobPage } from "../pages/JobPage";
import { Jobs } from "../pages/Jobs";
import { Landing } from "../pages/Landing";
import { Moderation } from "../pages/Moderation";
import { MyContributions } from "../pages/MyContributions";
import { Pipeline, Applicant } from "../pages/Pipeline";
import { ReviewLink } from "../pages/ReviewLink";
import { Saved } from "../pages/Saved";
import { Guard, NotFound } from "./Page";

type Params = Record<string, string>;
const routes: [string, (params: Params) => ReactElement][] = [
  ["/", () => <Landing />],
  ["/sign-in", () => <SignIn />],
  ["/join", () => <Join />],
  ["/join/confirm", () => <JoinConfirm />],
  ["/forgot-password", () => <Forgot />],
  ["/reset-password", () => <Reset />],
  ["/jobs", () => <Jobs />],
  ["/jobs/:id", ({ id }) => <JobPage id={id ?? ""} />],
  ["/jobs/:id/apply", ({ id }) => <Guard roles={["member"]}><Apply id={id ?? ""} /></Guard>],
  ["/companies", () => <Companies />],
  ["/companies/:slug", ({ slug }) => <CompanyPage slug={slug ?? ""} />],
  ["/companies/:slug/reviews/:id", ({ slug, id }) => <ReviewLink slug={slug ?? ""} id={id ?? ""} />],
  ["/contribute", () => <Guard roles={["member"]}><Contribute kind="chooser" /></Guard>],
  ["/contribute/review", () => <Guard roles={["member"]}><Contribute kind="review" /></Guard>],
  ["/contribute/pay", () => <Guard roles={["member"]}><Contribute kind="pay_report" /></Guard>],
  ["/contribute/interview", () => <Guard roles={["member"]}><Contribute kind="interview_note" /></Guard>],
  ["/me/contributions", () => <Guard roles={["member"]}><MyContributions /></Guard>],
  ["/saved", () => <Guard roles={["member"]}><Saved /></Guard>],
  ["/alerts", () => <Guard roles={["member"]}><Alerts /></Guard>],
  ["/applications", () => <Guard roles={["member"]}><Applications /></Guard>],
  ["/applications/:id", ({ id }) => <Guard roles={["member"]}><ApplicationDetail id={id ?? ""} /></Guard>],
  ["/channels", () => <Guard roles={["member"]}><Channels /></Guard>],
  ["/channels/:slug", ({ slug }) => <Guard roles={["member"]}><Channel slug={slug ?? ""} /></Guard>],
  ["/moderation", () => <Guard roles={["moderator", "founder"]}><Moderation /></Guard>],
  ["/employer", () => <Guard roles={["employer_admin", "recruiter"]}><Employer /></Guard>],
  ["/employer/jobs/new", () => <Guard roles={["employer_admin", "recruiter"]}><NewJob /></Guard>],
  ["/employer/jobs/:id", ({ id }) => <Guard roles={["employer_admin", "recruiter"]}><Pipeline id={id ?? ""} /></Guard>],
  ["/employer/applications/:id", ({ id }) => <Guard roles={["employer_admin", "recruiter"]}><Applicant id={id ?? ""} /></Guard>],
  ["/founder", () => <Guard roles={["founder"]}><Founder /></Guard>],
];

const firstPath = location.pathname;

export function App() {
  const { path } = useLocation();
  const served404 = initialStatus === 404 && path === firstPath;
  let page: ReactElement = <NotFound />;
  if (!served404) {
    for (const [pattern, render] of routes) {
      const params = matchPath(pattern, path);
      if (params) {
        page = render(params);
        break;
      }
    }
  }
  return (
    <>
      {page}
      <ToastHost />
      <Announcements />
    </>
  );
}
