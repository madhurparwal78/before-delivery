import { first } from "../db/pool";
import { isModerator, isTeam, type Viewer } from "../domain/viewer";

const OPEN_PAGES = new Set([
  "/", "/sign-in", "/join", "/join/confirm", "/forgot-password", "/reset-password", "/jobs", "/companies",
]);
const MEMBER_PAGES = [
  /^\/channels(?:\/[^/]+)?$/, /^\/contribute(?:\/(?:review|pay|interview))?$/, /^\/me\/contributions$/, /^\/saved$/,
  /^\/alerts$/, /^\/applications$/,
];

/** Whether the shell for this path is a real page for this viewer; 404 for unknown or hidden pages. */
export async function pageIsVisible(pathname: string, viewer: Viewer | null): Promise<boolean> {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (OPEN_PAGES.has(path)) return true;
  if (MEMBER_PAGES.some((pattern) => pattern.test(path))) {
    if (!viewer || viewer.role === "member") return path.startsWith("/channels/") ? channelExists(path) : true;
    return false;
  }
  if (path === "/moderation") return !viewer || isModerator(viewer);
  if (path === "/founder") return !viewer || viewer.role === "founder";
  if (path === "/employer" || path === "/employer/jobs/new") return !viewer || isTeam(viewer);
  let match = /^\/companies\/([^/]+)(?:\/reviews\/([^/]+))?$/.exec(path);
  if (match) return companyPageExists(match[1] ?? "", match[2]);
  match = /^\/jobs\/([^/]+)(\/apply)?$/.exec(path);
  if (match) {
    if (match[2] && viewer && viewer.role !== "member") return false;
    return jobIsVisible(match[1] ?? "", viewer);
  }
  match = /^\/applications\/([^/]+)$/.exec(path);
  if (match) return !viewer || ownsApplication(match[1] ?? "", viewer);
  match = /^\/employer\/applications\/([^/]+)$/.exec(path);
  if (match) return !viewer || teamOwnsApplication(match[1] ?? "", viewer);
  match = /^\/employer\/jobs\/([^/]+)$/.exec(path);
  if (match) return !viewer || teamOwnsJob(match[1] ?? "", viewer);
  return false;
}

async function channelExists(path: string): Promise<boolean> {
  const slug = path.slice("/channels/".length);
  return (await first("SELECT 1 FROM channels WHERE slug = $1", [slug])) !== undefined;
}

async function companyPageExists(slug: string, reviewId: string | undefined): Promise<boolean> {
  const company = await first<{ id: string }>("SELECT id FROM companies WHERE slug = $1", [slug]);
  if (!company) return false;
  if (reviewId === undefined) return true;
  const review = await first(
    "SELECT 1 FROM posts WHERE id = $1 AND company_id = $2 AND kind = 'review' AND state = 'approved' AND deleted_at IS NULL",
    [reviewId, company.id],
  );
  return review !== undefined;
}

async function jobIsVisible(id: string, viewer: Viewer | null): Promise<boolean> {
  const job = await first<{ status: string; company_id: string }>("SELECT status, company_id FROM jobs WHERE id = $1", [id]);
  if (!job) return false;
  if (job.status !== "draft") return true;
  return viewer !== null && isTeam(viewer) && viewer.companyId === job.company_id;
}

async function ownsApplication(id: string, viewer: Viewer): Promise<boolean> {
  return (await first("SELECT 1 FROM applications WHERE id = $1 AND user_id = $2", [id, viewer.id])) !== undefined;
}

async function teamOwnsApplication(id: string, viewer: Viewer): Promise<boolean> {
  return (
    (await first(
      "SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = $1 AND j.company_id = $2",
      [id, viewer.companyId],
    )) !== undefined
  );
}

async function teamOwnsJob(id: string, viewer: Viewer): Promise<boolean> {
  return (await first("SELECT 1 FROM jobs WHERE id = $1 AND company_id = $2", [id, viewer.companyId])) !== undefined;
}
