import { useCallback, useEffect, useId, useState } from "react";
import type { FeatureDetail, FeatureSummary, Me, Objective } from "../../shared/api.js";
import { FEATURE_STATUS_LABELS, featureTargets, type FeatureTarget } from "../../shared/lifecycles.js";
import { api, isFailure } from "../api.js";
import { useFeedback } from "../feedback.js";
import { IMPORTANCE_LABELS, twoDecimals } from "../format.js";
import { Link } from "../router.js";
import { StatusWord } from "../ui/StatusWord.js";

const FIT_LABELS = ["None", "Low", "Medium", "High"];
const TARGET_LABELS: Record<FeatureTarget, string> = {
  candidate: "Candidate", planned: "Move to planned", in_progress: "Start work", released: "Released", archived: "Archive", restore: "Restore",
};

interface ScoreForm { effort: string; confidence: string; fits: Record<string, number> }
const formOf = (f: Pick<FeatureSummary, "effort" | "confidence" | "fits">): ScoreForm => ({ effort: String(f.effort), confidence: String(f.confidence), fits: { ...f.fits } });

export function FeatureDetailPage({ me, featureId }: { me: Me; featureId: string }) {
  const feedback = useFeedback();
  const id = useId();
  const [feature, setFeature] = useState<FeatureDetail | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scores, setScores] = useState<ScoreForm>({ effort: "", confidence: "", fits: {} });
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"details" | "scores" | null>(null);
  const canEdit = me.user.role !== "customer_success";

  const load = useCallback(async (resetForms: boolean): Promise<FeatureDetail | null> => {
    try {
      const [detail, objs] = await Promise.all([
        api.get<{ feature: FeatureDetail }>(`/api/features/${featureId}`),
        api.get<{ objectives: Objective[] }>("/api/objectives"),
      ]);
      setFeature(detail.feature);
      setObjectives(objs.objectives);
      if (resetForms) {
        setName(detail.feature.name);
        setDescription(detail.feature.publicDescription);
        setScores(formOf(detail.feature));
      }
      return detail.feature;
    } catch (error) {
      feedback.fail(error, (f) => (f.status === 404 ? "This feature does not exist." : null));
      return null;
    }
  }, [featureId, feedback]);

  useEffect(() => { void load(true); }, [load]);

  const saveDetails = async (): Promise<void> => {
    setBusy("details");
    setDetailErrors({});
    feedback.clearAlert();
    try {
      await api.patch(`/api/features/${featureId}`, { name, publicDescription: description });
      feedback.say("save", "Feature details saved.");
      const fresh = await load(false);
      if (fresh) setName(fresh.name);
    } catch (error) {
      if (isFailure(error, 422)) setDetailErrors(error.fields);
      else feedback.fail(error);
    } finally {
      setBusy(null);
    }
  };

  const saveScores = async (): Promise<void> => {
    if (!feature) return;
    setBusy("scores");
    setScoreErrors({});
    feedback.clearAlert();
    const toNumber = (value: string): number | string => (value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value);
    try {
      const { feature: saved } = await api.patch<{ feature: FeatureSummary }>(`/api/features/${featureId}/scores`, {
        version: feature.version, effort: toNumber(scores.effort), confidence: toNumber(scores.confidence), fits: scores.fits,
      });
      feedback.say("save", `Scores saved. Priority ${twoDecimals(saved.priority)}.`);
      await load(true);
    } catch (error) {
      if (isFailure(error, 409) && error.code === "version_conflict") {
        const current = error.body.current as { version: number; effort: number; confidence: number; fits: Record<string, number> };
        feedback.warn(`Someone else saved these scores first. Current values: effort ${current.effort}, confidence ${current.confidence}%. The form now shows them; review and save again.`);
        setScores(formOf(current));
        await load(false);
      } else if (isFailure(error, 422)) setScoreErrors(error.fields);
      else feedback.fail(error);
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (to: FeatureTarget): Promise<void> => {
    feedback.clearAlert();
    try {
      const { feature: changed } = await api.post<{ feature: FeatureSummary }>(`/api/features/${featureId}/status`, { to });
      feedback.say("save", `Status changed to ${FEATURE_STATUS_LABELS[changed.status]}.`);
      await load(false);
    } catch (error) {
      feedback.fail(error);
    }
  };

  if (!feature) return <div className="page-body" aria-busy="true" />;
  const errorFor = (errors: Record<string, string>, field: string) =>
    errors[field] ? <p id={`${id}-${field}-error`} className="field-error">{errors[field]}</p> : null;
  const described = (errors: Record<string, string>, field: string) => (errors[field] ? `${id}-${field}-error` : undefined);

  return (
    <div className="page-body feature-detail">
      <p className="crumb"><Link href="/features">Feature ranking</Link></p>
      <header className="page-head page-head-start">
        <h1>{feature.name}</h1>
        <p className="status-line badge"><StatusWord status={feature.status} /></p>
      </header>

      <dl className="figures">
        <div><dt>Rank</dt><dd className="num">{feature.rank === null ? "—" : `${feature.rank} of ${feature.rankTotal}`}</dd></div>
        <div><dt>Priority</dt><dd className="num">{twoDecimals(feature.priority)}</dd></div>
        <div><dt>Objective fit</dt><dd className="num">{twoDecimals(feature.objectiveFit)}</dd></div>
        <div><dt>Impact</dt><dd className="num">{feature.impact}</dd></div>
        <div><dt>Insights</dt><dd className="num">{feature.insightCount}</dd></div>
        <div><dt>Companies</dt><dd className="num">{feature.companyCount}</dd></div>
      </dl>

      {canEdit && (
        <div className="status-actions">
          {featureTargets(feature.status).map((to) => (
            <button key={to} type="button" className={to === "archived" ? "button-quiet" : "button"} onClick={() => void changeStatus(to)}>{TARGET_LABELS[to]}</button>
          ))}
        </div>
      )}

      <div className="detail-grid">
        <fieldset className="panel" disabled={!canEdit}>
          <legend>Feature details</legend>
          <form onSubmit={(e) => { e.preventDefault(); void saveDetails(); }}>
            <div className="field">
              <label htmlFor={`${id}-name`}>Feature name</label>
              <input id={`${id}-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={described(detailErrors, "name")} />
              {errorFor(detailErrors, "name")}
            </div>
            <div className="field">
              <label htmlFor={`${id}-description`}>Public description</label>
              <textarea id={`${id}-description`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-describedby={described(detailErrors, "publicDescription")} />
              {errorFor(detailErrors, "publicDescription")}
            </div>
            <button type="submit" className="button" aria-busy={busy === "details"} disabled={busy !== null}>{busy === "details" ? "Saving details…" : "Save details"}</button>
          </form>
        </fieldset>

        <fieldset className="panel" disabled={!canEdit}>
          <legend>Scores</legend>
          <form onSubmit={(e) => { e.preventDefault(); void saveScores(); }}>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-effort`}>Effort</label>
                <input id={`${id}-effort`} type="number" inputMode="numeric" value={scores.effort} onChange={(e) => setScores({ ...scores, effort: e.target.value })} aria-describedby={described(scoreErrors, "effort")} />
                {errorFor(scoreErrors, "effort")}
              </div>
              <div className="field">
                <label htmlFor={`${id}-confidence`}>Confidence</label>
                <input id={`${id}-confidence`} type="number" inputMode="numeric" value={scores.confidence} onChange={(e) => setScores({ ...scores, confidence: e.target.value })} aria-describedby={described(scoreErrors, "confidence")} />
                {errorFor(scoreErrors, "confidence")}
              </div>
            </div>
            {objectives.map((o) => (
              <div className="field" key={o.id}>
                <label htmlFor={`${id}-fit-${o.id}`}>{o.name} fit</label>
                <select id={`${id}-fit-${o.id}`} value={FIT_LABELS[scores.fits[o.id] ?? 0]}
                  onChange={(e) => setScores({ ...scores, fits: { ...scores.fits, [o.id]: Math.max(0, FIT_LABELS.indexOf(e.target.value)) } })}>
                  {FIT_LABELS.map((label) => <option key={label} value={label}>{label}</option>)}
                </select>
              </div>
            ))}
            {errorFor(scoreErrors, "fits")}
            <button type="submit" className="button" aria-busy={busy === "scores"} disabled={busy !== null}>{busy === "scores" ? "Saving scores…" : "Save scores"}</button>
          </form>
        </fieldset>
      </div>

      <section className="panel">
        <h2>Score history</h2>
        {feature.scoreVersions.length === 0 ? <p className="empty-line">No saved scores yet.</p> : (
          <ul aria-label="Score history" className="history">
            {feature.scoreVersions.map((v) => (
              <li key={v.version} className="num">v{v.version} · effort {v.effort} · confidence {v.confidence}% · priority {twoDecimals(v.priority)}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="detail-grid">
        <section className="panel">
          <h2>Requested by</h2>
          {feature.requestedBy.length === 0 ? <p className="empty-line">No company has asked for this yet.</p> : (
            <ul aria-label="Requested by" className="plain-list">
              {feature.requestedBy.map((r) => (
                <li key={r.companyId}><Link href={`/companies/${r.companyId}`}>{r.companyName}</Link> · <span className="num">{r.insightCount}</span> insights</li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Linked quotes</h2>
          {feature.insights.length === 0 ? <p className="empty-line">No quotes linked yet.</p> : (
            <ul aria-label="Linked quotes" className="quote-list">
              {feature.insights.map((i) => (
                <li key={i.id}>
                  <blockquote><Link href={`/inbox/${i.noteId}`}>{i.quote}</Link></blockquote>
                  <span className="badge">{IMPORTANCE_LABELS[i.importance]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
