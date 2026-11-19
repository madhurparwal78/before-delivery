import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api.js';
import { Link } from '../lib/router.js';
import { TopBar } from '../components/TopBar.js';
import { NotFound } from './NotFound.js';
import type { PublicCluster as PublicClusterShape } from '../../shared/types.js';

export function PublicCluster({ clusterId }: { clusterId: string }): JSX.Element {
  const [cluster, setCluster] = useState<PublicClusterShape | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
    void apiGet<PublicClusterShape>(`/api/public/clusters/${clusterId}`)
      .then(setCluster)
      .catch(() => setMissing(true));
  }, [clusterId]);

  if (missing) {
    return <NotFound />;
  }
  if (cluster === null) {
    return (
      <>
        <TopBar />
        <div className="page" />
      </>
    );
  }

  return (
    <>
      <TopBar />
      <div className="page">
        <h1>{cluster.title}</h1>
        <p>{cluster.publicDescription}</p>
        <p>
          <Link to={`/@${cluster.curator.handle}`}>
            {cluster.curator.displayName} @{cluster.curator.handle}
          </Link>
        </p>
        <ul className="order-list" aria-label="Credits">
          {cluster.credits.map((credit) => (
            <li key={credit.handle} className="order-item">
              {credit.displayName} <span className="mono">@{credit.handle}</span>
            </li>
          ))}
        </ul>
        <p>
          <span className="count">{cluster.publicItemCount}</span> items
        </p>
        <ul className="masonry" aria-label="Items">
          {cluster.items.map((item) => (
            <li key={item.id}>
              <div className="card">
                {item.kind === 'clip' ? (
                  <video src={item.mediaUrl} muted playsInline preload="metadata" />
                ) : (
                  <img src={item.mediaUrl} alt="" />
                )}
                <div className="card-body">
                  <h3 className="card-title">{item.title}</h3>
                  {item.kind === 'still' ? (
                    <p className="timecode">
                      {item.sourceClipTitle} · {item.timecode}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
