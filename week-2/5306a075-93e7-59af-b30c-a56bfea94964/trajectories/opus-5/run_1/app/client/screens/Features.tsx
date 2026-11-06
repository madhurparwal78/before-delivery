import { Fragment, useEffect, useState } from 'react';
import type { FeatureSummary } from '../../shared/types';
import { request, requestBlob } from '../api';
import { useApp } from '../app-state';
import { Link } from '../router';
import { FEATURE_STATUS_LABELS } from '../labels';

export function Features(): JSX.Element {
  const app = useApp();
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [narrow, setNarrow] = useState(() => innerWidth < 900);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onResize = (): void => setNarrow(innerWidth < 900);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    void request<{ features: FeatureSummary[] }>('/api/features').then((data) => setFeatures(data.features));
  }, []);

  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const { blob, filename } = await requestBlob('/api/exports/features.csv');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="features">
      <div className="screen-head">
        <h1 className="display">Feature ranking</h1>
        {app.user?.role === 'head_of_product' ? (
          <button type="button" className="button" onClick={() => void download()}>
            {exporting ? 'Preparing export…' : 'Export CSV'}
          </button>
        ) : null}
      </div>
      <table className="ranking" aria-label="Feature ranking">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Feature</th>
            {narrow ? null : (
              <>
                <th scope="col">Status</th>
                <th scope="col">Insights</th>
                <th scope="col">Companies</th>
                <th scope="col">Impact</th>
                <th scope="col">Effort</th>
                <th scope="col">Confidence</th>
                <th scope="col">Objective fit</th>
              </>
            )}
            <th scope="col">Priority</th>
          </tr>
        </thead>
        <tbody>
          {features.map((feature) => (
            <Fragment key={feature.id}>
              <tr>
                <td className="figure">{feature.rank}</td>
                <td>
                  <Link to={`/features/${feature.id}`}>{feature.name}</Link>
                  {narrow ? (
                    <button
                      type="button"
                      className="button quiet"
                      aria-expanded={open.has(feature.id)}
                      onClick={() =>
                        setOpen((current) => {
                          const next = new Set(current);
                          if (next.has(feature.id)) next.delete(feature.id);
                          else next.add(feature.id);
                          return next;
                        })
                      }
                    >
                      Details
                    </button>
                  ) : null}
                </td>
                {narrow ? null : (
                  <>
                    <td>{FEATURE_STATUS_LABELS[feature.status]}</td>
                    <td className="figure">{feature.insightCount}</td>
                    <td className="figure">{feature.companyCount}</td>
                    <td className="figure">{feature.impact}</td>
                    <td className="figure">{feature.effort}</td>
                    <td className="figure">{feature.confidence}</td>
                    <td className="figure">{feature.objectiveFit.toFixed(2)}</td>
                  </>
                )}
                <td className="figure">{feature.priority.toFixed(2)}</td>
              </tr>
              {narrow && open.has(feature.id) ? (
                <tr className="details-row">
                  <td colSpan={3}>
                    <dl>
                      <div>
                        <dt>Status</dt>
                        <dd>{FEATURE_STATUS_LABELS[feature.status]}</dd>
                      </div>
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
                        <dt>Effort</dt>
                        <dd className="figure">{feature.effort}</dd>
                      </div>
                      <div>
                        <dt>Confidence</dt>
                        <dd className="figure">{feature.confidence}</dd>
                      </div>
                      <div>
                        <dt>Objective fit</dt>
                        <dd className="figure">{feature.objectiveFit.toFixed(2)}</dd>
                      </div>
                    </dl>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </main>
  );
}
