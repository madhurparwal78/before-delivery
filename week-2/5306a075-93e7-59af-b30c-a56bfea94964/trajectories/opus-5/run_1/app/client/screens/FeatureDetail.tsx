import { useCallback, useEffect, useState } from 'react';
import type { FeatureDetail as FeatureDetailShape, FeatureStatus, Objective } from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { FieldError } from '../components/Dialog';
import { FEATURE_STATUS_LABELS, IMPORTANCE_LABELS } from '../labels';
import { Link, useRoute } from '../router';

const FIT_LABELS = ['None', 'Low', 'Medium', 'High'];

const STATUS_ACTIONS: { to: FeatureStatus | 'restore'; label: string; from: FeatureStatus[] }[] = [
  { to: 'planned', label: 'Move to planned', from: ['candidate'] },
  { to: 'in_progress', label: 'Start work', from: ['planned'] },
  { to: 'archived', label: 'Archive', from: ['candidate', 'planned', 'in_progress', 'released'] },
  { to: 'restore', label: 'Restore', from: ['archived'] },
];

export function FeatureDetail(): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const featureId = route.slice('/features/'.length);
  const [feature, setFeature] = useState<FeatureDetailShape | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [effort, setEffort] = useState(1);
  const [confidence, setConfidence] = useState(10);
  const [fits, setFits] = useState<Record<string, number>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});

  const adopt = useCallback((loaded: FeatureDetailShape) => {
    setFeature(loaded);
    setName(loaded.name);
    setDescription(loaded.publicDescription);
    setEffort(loaded.effort);
    setConfidence(loaded.confidence);
    setFits(loaded.fits);
  }, []);

  const load = useCallback(async () => {
    const data = await request<{ feature: FeatureDetailShape }>(`/api/features/${featureId}`);
    adopt(data.feature);
  }, [featureId, adopt]);

  useEffect(() => {
    void load();
    void request<{ objectives: Objective[] }>('/api/objectives').then((data) => setObjectives(data.objectives));
  }, [load]);

  if (feature === null) return <main className="feature-detail" />;

  const saveDetails = async (): Promise<void> => {
    setDetailErrors({});
    app.setPending('Saving details…');
    try {
      await request(`/api/features/${featureId}`, {
        method: 'PATCH',
        body: { name, publicDescription: description },
      });
      await load();
      app.setSaveStatus('Feature details saved.');
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) {
        if (error.status === 422) setDetailErrors(error.fields);
        else app.setAlert(error.message);
      }
    }
  };

  const saveScores = async (): Promise<void> => {
    setScoreErrors({});
    app.setPending('Saving scores…');
    try {
      const data = await request<{ feature: { priority: number } }>(`/api/features/${featureId}/scores`, {
        method: 'PATCH',
        body: { version: feature.version, effort, confidence, fits },
      });
      await load();
      app.setSaveStatus(`Scores saved. Priority ${data.feature.priority.toFixed(2)}.`);
    } catch (error) {
      app.setSaveStatus('');
      if (!(error instanceof ApiError)) return;
      if (error.code === 'version_conflict') {
        const current = error.detail.current as {
          version: number;
          effort: number;
          confidence: number;
          fits: Record<string, number>;
        };
        setEffort(current.effort);
        setConfidence(current.confidence);
        setFits(current.fits);
        setFeature({ ...feature, version: current.version });
        app.setAlert(
          `Someone else saved these scores first. Current values: effort ${current.effort}, ` +
            `confidence ${current.confidence}%. The form now shows them; review and save again.`,
        );
        return;
      }
      if (error.status === 422) setScoreErrors(error.fields);
      else app.setAlert(error.message);
    }
  };

  const changeStatus = async (to: FeatureStatus | 'restore'): Promise<void> => {
    try {
      const data = await request<{ feature: { status: FeatureStatus } }>(`/api/features/${featureId}/status`, {
        method: 'POST',
        body: { to },
      });
      await load();
      app.setSaveStatus(`Status changed to ${FEATURE_STATUS_LABELS[data.feature.status]}.`);
    } catch (error) {
      if (error instanceof ApiError) app.setAlert(error.message);
    }
  };

  const canEdit = app.user?.role === 'head_of_product' || app.user?.role === 'product_manager';

  return (
    <main className="feature-detail">
      <h1 className="display">{feature.name}</h1>

      {canEdit ? (
        <section className="panel" role="group" aria-label="Feature details">
          <h2>Feature details</h2>
          <div className="field">
            <label htmlFor="feature-name">Feature name</label>
            <input
              id="feature-name"
              type="text"
              aria-label="Feature name"
              aria-describedby="feature-name-error"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError id="feature-name-error" message={detailErrors.name} />
          </div>
          <div className="field">
            <label htmlFor="feature-description">Public description</label>
            <textarea
              id="feature-description"
              aria-label="Public description"
              aria-describedby="feature-description-error"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FieldError id="feature-description-error" message={detailErrors.publicDescription} />
          </div>
          <button type="button" className="button accent" onClick={() => void saveDetails()}>
            Save details
          </button>
        </section>
      ) : null}

      <section className="panel">
        <h2>Status</h2>
        <p>{FEATURE_STATUS_LABELS[feature.status]}</p>
        <div className="row">
          {STATUS_ACTIONS.filter((action) => action.from.includes(feature.status)).map((action) => (
            <button
              key={action.label}
              type="button"
              className="button"
              onClick={() => void changeStatus(action.to)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>

      {canEdit ? (
        <section className="panel" role="group" aria-label="Scores">
          <h2>Scores</h2>
          <div className="field">
            <label htmlFor="feature-effort">Effort</label>
            <input
              id="feature-effort"
              type="number"
              min={1}
              max={100}
              step={1}
              aria-label="Effort"
              aria-describedby="feature-effort-error"
              value={effort}
              onChange={(event) => setEffort(Number(event.target.value))}
            />
            <FieldError id="feature-effort-error" message={scoreErrors.effort} />
          </div>
          <div className="field">
            <label htmlFor="feature-confidence">Confidence</label>
            <input
              id="feature-confidence"
              type="number"
              min={10}
              max={100}
              step={1}
              aria-label="Confidence"
              aria-describedby="feature-confidence-error"
              value={confidence}
              onChange={(event) => setConfidence(Number(event.target.value))}
            />
            <FieldError id="feature-confidence-error" message={scoreErrors.confidence} />
          </div>
          {objectives.map((objective) => (
            <div className="field" key={objective.id}>
              <label htmlFor={`fit-${objective.id}`}>{objective.name} fit</label>
              <select
                id={`fit-${objective.id}`}
                aria-label={`${objective.name} fit`}
                value={fits[objective.id] ?? 0}
                onChange={(event) =>
                  setFits((current) => ({ ...current, [objective.id]: Number(event.target.value) }))
                }
              >
                {FIT_LABELS.map((label, level) => (
                  <option key={label} value={level}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <FieldError id="feature-fits-error" message={scoreErrors.fits} />
          <button type="button" className="button accent" onClick={() => void saveScores()}>
            Save scores
          </button>
        </section>
      ) : null}

      <section className="panel">
        <h2>Derived numbers</h2>
        <dl className="derived">
          <div>
            <dt>Insights</dt>
            <dd className="figure">{feature.insightCount}</dd>
          </div>
          <div>
            <dt>Companies</dt>
            <dd className="figure">{feature.companyCount}</dd>
          </div>
          <div>
            <dt>Impact</dt>
            <dd className="figure">{feature.impact}</dd>
          </div>
          <div>
            <dt>Objective fit</dt>
            <dd className="figure">{feature.objectiveFit.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd className="figure">{feature.priority.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Rank</dt>
            <dd className="figure">
              {feature.rank ?? '—'} of {feature.rankTotal}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Score history</h2>
        <ul aria-label="Score history" className="score-history">
          {feature.scoreVersions.map((version) => (
            <li key={version.version} className="figure">
              v{version.version} · effort {version.effort} · confidence {version.confidence}% · priority{' '}
              {version.priority.toFixed(2)}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Requested by</h2>
        <ul aria-label="Requested by">
          {feature.requestedBy.map((entry) => (
            <li key={entry.companyId}>
              <Link to={`/companies/${entry.companyId}`}>{entry.companyName}</Link> ·{' '}
              <span className="figure">{entry.insightCount}</span> insights
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Linked quotes</h2>
        <ul className="linked-quotes">
          {feature.insights.map((insight) => (
            <li key={insight.id}>
              <blockquote>{insight.quote}</blockquote>
              <Link to={`/inbox/${insight.noteId}`}>Open note</Link>
              <span className="evidence-importance">{IMPORTANCE_LABELS[insight.importance]}</span>
            </li>
          ))}
        </ul>
      </section>

      {feature.subfeatures.length > 0 ? (
        <section className="panel">
          <h2>Subfeatures</h2>
          <ul>
            {feature.subfeatures.map((subfeature) => (
              <li key={subfeature.id}>
                {subfeature.name} · {FEATURE_STATUS_LABELS[subfeature.status]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
