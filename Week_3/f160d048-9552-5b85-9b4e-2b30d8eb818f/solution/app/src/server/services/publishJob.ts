import { first, rows } from "../db/pool";
import { inUnit } from "../db/unit";
import { refuse } from "../http/fail";
import { payBandOf, type CityId, type RoleFamilyId, type WorkPatternId } from "../../shared/reference";
import { listedJobDocument } from "./searchDocs";
import { putDocuments, removeDocuments, search, SearchUnavailable } from "./search";

type DraftJob = {
  id: string; company_id: string; company_slug: string; city: CityId; role_family: RoleFamilyId; remote: WorkPatternId; pay_low: number;
};

async function alertsMatching(job: DraftJob): Promise<{ id: string; user_id: string; q: string }[]> {
  const candidates = await rows<{ id: string; user_id: string; q: string }>(
    `SELECT id, user_id, q FROM alerts
      WHERE (cardinality(city) = 0 OR $1 = ANY(city)) AND (cardinality(role) = 0 OR $2 = ANY(role))
        AND (cardinality(remote) = 0 OR $3 = ANY(remote)) AND (cardinality(band) = 0 OR $4 = ANY(band))`,
    [job.city, job.role_family, job.remote, payBandOf(job.pay_low)],
  );
  const matches = await Promise.all(
    candidates.map(async (alert) => {
      if (alert.q === "") return alert;
      const found = await search("jobs", { q: alert.q, filter: [[`company_id = ${JSON.stringify(job.company_id)}`]], limit: 1000 });
      return found.hits.some((hit) => hit["id"] === job.id) ? alert : undefined;
    }),
  );
  return matches.filter((alert) => alert !== undefined);
}

/**
 * Lists a draft job: its search document is indexed first, and only then does the job become listed.
 * If search is unreachable the job stays a draft and the caller answers 503.
 */
export async function publishDraftJob(jobId: string): Promise<void> {
  const draft = await first<DraftJob>(
    `SELECT j.id, j.company_id, c.slug AS company_slug, j.city, j.role_family, j.remote, j.pay_low
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1 AND j.status = 'draft'`,
    [jobId],
  );
  if (!draft) return;
  const listedAt = (await first<{ now: Date }>("SELECT app_now() AS now"))?.now ?? new Date();
  let matched: { id: string; user_id: string; q: string }[];
  try {
    const document = await listedJobDocument(jobId, listedAt);
    if (!document) throw refuse("not_found");
    await putDocuments("jobs", [document]);
    try {
      matched = await alertsMatching(draft);
    } catch (error) {
      await removeDocuments("jobs", [jobId]).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof SearchUnavailable) throw refuse("search_unavailable");
    throw error;
  }
  await inUnit(async (unit) => {
    const listed = await unit.first<{ id: string }>(
      "UPDATE jobs SET status = 'listed', listed_at = $2 WHERE id = $1 AND status = 'draft' RETURNING id",
      [jobId, listedAt],
    );
    if (!listed) return;
    for (const alert of matched) {
      const updated = await unit.first<{ new_count: number }>("UPDATE alerts SET new_count = new_count + 1 WHERE id = $1 RETURNING new_count", [alert.id]);
      if (!updated) continue;
      const batch = await unit.first<{ id: number }>(
        `INSERT INTO alert_batches (alert_id, opened_at) VALUES ($1, app_now())
         ON CONFLICT (alert_id) WHERE sent_at IS NULL DO UPDATE SET alert_id = EXCLUDED.alert_id RETURNING id`,
        [alert.id],
      );
      await unit.query("INSERT INTO alert_batch_jobs (batch_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [batch?.id, jobId]);
      unit.emit({ type: "alert.matched", audience: [`user:${alert.user_id}`], data: { alert_id: alert.id, new_count: updated.new_count } });
    }
    unit.emit({ type: "company.changed", audience: ["all"], data: { slug: draft.company_slug } });
    await unit.audit("job_listed", jobId, null, {});
  });
}
