import { ChevronDown, Download } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import type { FeatureSummary, Me } from "../../shared/api.js";
import { FEATURE_STATUS_LABELS } from "../../shared/lifecycles.js";
import { StatusWord } from "../ui/StatusWord.js";
import { api, request } from "../api.js";
import { useFeedback } from "../feedback.js";
import { twoDecimals } from "../format.js";
import { Link } from "../router.js";

function ExportButton() {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const download = async (): Promise<void> => {
    setBusy(true);
    feedback.clearAlert();
    try {
      const file = await request<Blob>("GET", "/api/exports/features.csv");
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "evidence-desk-features.csv";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      feedback.fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="button" aria-busy={busy} disabled={busy} onClick={() => void download()}>
      <Download aria-hidden="true" size={16} />{busy ? "Preparing export…" : "Export CSV"}
    </button>
  );
}

export function FeaturesPage({ me }: { me: Me }) {
  const feedback = useFeedback();
  const [features, setFeatures] = useState<FeatureSummary[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    api.get<{ features: FeatureSummary[] }>("/api/features").then((r) => setFeatures(r.features), (error: unknown) => feedback.fail(error));
  }, [feedback]);

  const toggle = (id: string): void => setOpen((o) => {
    const next = new Set(o);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <div className="page-body">
      <header className="page-head">
        <h1>Feature ranking</h1>
        {me.user.role === "head_of_product" && <ExportButton />}
      </header>
      <p className="lede">Every feature ranked by priority: objective fit × impact × confidence ÷ effort.</p>
      <table aria-label="Feature ranking" className="table ranking">
        <thead>
          <tr>
            <th scope="col" className="cell-num">Rank</th>
            <th scope="col">Feature</th>
            <th scope="col" className="col-extra">Status</th>
            <th scope="col" className="cell-num col-extra">Insights</th>
            <th scope="col" className="cell-num col-extra">Companies</th>
            <th scope="col" className="cell-num col-extra">Impact</th>
            <th scope="col" className="cell-num col-extra">Effort</th>
            <th scope="col" className="cell-num col-extra">Confidence</th>
            <th scope="col" className="cell-num col-extra">Objective fit</th>
            <th scope="col" className="cell-num">Priority</th>
          </tr>
        </thead>
        <tbody>
          {features?.map((f) => (
            <Fragment key={f.id}>
              <tr>
                <td className="cell-num num">{f.rank}</td>
                <td>
                  <Link href={`/features/${f.id}`}>{f.name}</Link>
                  <button type="button" className="button-quiet details-toggle col-narrow" aria-expanded={open.has(f.id)} aria-controls={`details-${f.id}`} onClick={() => toggle(f.id)}>
                    Details <ChevronDown aria-hidden="true" size={14} className={open.has(f.id) ? "flip" : ""} />
                  </button>
                </td>
                <td className="col-extra"><StatusWord status={f.status} /></td>
                <td className="cell-num num col-extra">{f.insightCount}</td>
                <td className="cell-num num col-extra">{f.companyCount}</td>
                <td className="cell-num num col-extra">{f.impact}</td>
                <td className="cell-num num col-extra">{f.effort}</td>
                <td className="cell-num num col-extra">{f.confidence}%</td>
                <td className="cell-num num col-extra">{twoDecimals(f.objectiveFit)}</td>
                <td className="cell-num num">{twoDecimals(f.priority)}</td>
              </tr>
              {open.has(f.id) && (
                <tr id={`details-${f.id}`} className="details-row col-narrow-row">
                  <td colSpan={10}>
                    <dl className="details-grid">
                      <div><dt>Status</dt><dd>{FEATURE_STATUS_LABELS[f.status]}</dd></div>
                      <div><dt>Insights</dt><dd className="num">{f.insightCount}</dd></div>
                      <div><dt>Companies</dt><dd className="num">{f.companyCount}</dd></div>
                      <div><dt>Impact</dt><dd className="num">{f.impact}</dd></div>
                      <div><dt>Effort</dt><dd className="num">{f.effort}</dd></div>
                      <div><dt>Confidence</dt><dd className="num">{f.confidence}%</dd></div>
                      <div><dt>Objective fit</dt><dd className="num">{twoDecimals(f.objectiveFit)}</dd></div>
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {features?.length === 0 && <p className="empty-line">No features yet.</p>}
    </div>
  );
}
