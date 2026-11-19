// Public cluster page (brief: Screens > Public cluster): only the published fields and public items.
import { useEffect, useState } from "react";
import type { PublicCluster as Shape } from "../../shared/api.js";
import { api } from "../lib/api.js";
import { linkClick } from "../lib/router.js";
import { Thumb, utcMinute } from "../components/bits.js";
import { Masonry, WALL_COLUMNS } from "../components/Masonry.js";
import { NotFound } from "./NotFound.js";

export function PublicCluster({ id }: { id: string }) {
  const [cluster, setCluster] = useState<Shape | null | undefined>(undefined);
  useEffect(() => {
    void api<Shape>("GET", `/api/public/clusters/${encodeURIComponent(id)}`).then((answer) => setCluster(answer.ok ? answer.data : null));
  }, [id]);
  if (cluster === null) return <NotFound />;
  if (cluster === undefined) {
    return (
      <main className="public" id="main">
        <div className="skeleton-block" aria-hidden="true" />
      </main>
    );
  }
  const curator = `/@${cluster.curator.handle}`;
  return (
    <main className="public" id="main">
      <header className="public__head">
        <h1 className="page-title">{cluster.title}</h1>
        {cluster.publicDescription && <p className="lede">{cluster.publicDescription}</p>}
        <p className="public__meta">
          <span>
            Curated by{" "}
            <a href={curator} onClick={(e) => linkClick(e, curator)}>
              {cluster.curator.displayName} @{cluster.curator.handle}
            </a>
          </span>
          <span className="mono">{cluster.publicItemCount} items</span>
          <span className="mono">Published {utcMinute(cluster.publishedAt)} UTC</span>
        </p>
        <div className="public__credits">
          <h2 className="section-title">Credits</h2>
          <ul aria-label="Credits" className="credits">
            {cluster.credits.map((person) => (
              <li key={person.handle}>
                <a href={`/@${person.handle}`} onClick={(e) => linkClick(e, `/@${person.handle}`)}>
                  {person.displayName} <span className="muted">@{person.handle}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </header>
      <Masonry
        className="public__items"
        label="Items"
        columns={WALL_COLUMNS}
        items={cluster.items.map((item) => ({
          key: item.id,
          render: (style, ref) => (
            <li key={item.id} className="card card--public" style={style} ref={ref as React.Ref<HTMLLIElement>}>
              <div className="card__media">
                <Thumb src={item.mediaUrl} kind={item.kind} alt={item.title} />
              </div>
              <div className="card__body">
                <p className="card__title">
                  <span className="mono card__slot">{item.position}</span> {item.title}
                </p>
                {item.kind === "still" && (
                  <p className="card__meta mono">
                    {item.sourceClipTitle} · {item.timecode}
                  </p>
                )}
              </div>
            </li>
          ),
        }))}
      />
    </main>
  );
}
