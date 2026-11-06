import type { PageRule } from "../http/pages.js";
import type { Route } from "../http/router.js";
import * as caseStudies from "./casestudies.js";
import * as certificates from "./certificates.js";
import * as drawings from "./drawings.js";
import * as enquiries from "./enquiries.js";
import * as finishes from "./finishes.js";
import * as members from "./members.js";
import * as projects from "./projects.js";
import * as session from "./session.js";
import * as shopDrawings from "./shopdrawings.js";
import * as siteWalk from "./sitewalk.js";
import * as stages from "./stages.js";
import * as tenders from "./tenders.js";
import * as variations from "./variations.js";

const modules = [session, members, projects, stages, drawings, tenders, variations, certificates, shopDrawings, siteWalk, finishes,
  caseStudies, enquiries];

export const routes: Route[] = modules.flatMap((module) => module.routes);
export const pages: PageRule[] = [...members.pages, ...caseStudies.pages, ...tenders.pages];
