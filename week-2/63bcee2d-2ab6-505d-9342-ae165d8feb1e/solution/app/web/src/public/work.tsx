import { useEffect, useState } from "react";
import { get } from "../api";
import { navigate, useQuery } from "../router";
import { PageHeading } from "./heading";
import type { FeaturedCard } from "./rail";
import { PublicLink, RollLink } from "./shell";

// The work index: the sector filter with published counts and the grid or list view, both kept in the
// URL as ?sector= and ?view= with a history entry per choice.

interface Sectors {
  total: number;
  sectors: { key: string; label: string; count: number }[];
}

const SECTOR_KEYS = ["retail", "workplace", "food_beverage"];
const SECTOR_LABEL: Record<string, string> = { retail: "Retail", workplace: "Workplace", food_beverage: "Food & beverage" };

export function WorkPage() {
  const query = useQuery();
  const sector = SECTOR_KEYS.includes(query.get("sector") ?? "") ? (query.get("sector") as string) : "";
  const view = query.get("view") === "list" ? "list" : "grid";
  const [sectors, setSectors] = useState<Sectors | null>(null);
  const [listed, setListed] = useState<{ sector: string; items: (FeaturedCard & { summary: string })[] } | null>(null);

  useEffect(() => {
    void get<Sectors>("/api/public/sectors").then((result) => result.ok && setSectors(result.data));
  }, []);

  useEffect(() => {
    let current = true;
    void get<{ caseStudies: (FeaturedCard & { summary: string })[] }>(`/api/public/case-studies${sector ? `?sector=${sector}` : ""}`)
      .then((result) => {
        if (current && result.ok) setListed({ sector, items: result.data.caseStudies });
      });
    return () => {
      current = false;
    };
  }, [sector]);

  const go = (next: { sector?: string; view?: string }): void => {
    const params = new URLSearchParams();
    const s = next.sector ?? sector;
    const v = next.view ?? view;
    if (s) params.set("sector", s);
    if (v !== "grid") params.set("view", v);
    const search = params.toString();
    navigate(`/work${search ? `?${search}` : ""}`);
  };

  const items = listed && listed.sector === sector ? listed.items : [];
  const filters = [{ key: "", label: "All", count: sectors?.total ?? 0 },
    ...(sectors?.sectors ?? []).map((s) => ({ key: s.key, label: s.label, count: s.count }))];

  return (
    <>
      <section className="section section-plaster work-head" data-tone="light">
        <div className="grid">
          <p className="sheet-caption"><span>Index</span><span>Case studies</span><span>{sectors ? `${sectors.total} published` : "Published work"}</span></p>
          <PageHeading title="Work · Marrow Hall Interiors" lines={["Work"]} />
          <p className="hero-lede">Rollouts we have drawn, tendered, built and signed off, store by store.</p>
          <div className="work-controls">
            <div role="group" aria-labelledby="sector-label" className="filter">
              <span id="sector-label" className="control-label">Sector</span>
              {sectors && filters.map((filter) => (
                <button key={filter.key || "all"} type="button" className="toggle" aria-pressed={filter.key === sector}
                  onClick={() => go({ sector: filter.key })}>{`${filter.label} (${filter.count})`}</button>
              ))}
            </div>
            <div role="radiogroup" aria-labelledby="view-label" className="filter view-switch">
              <span id="view-label" className="control-label">View</span>
              {(["grid", "list"] as const).map((option) => (
                <label key={option} className="segment">
                  <input type="radio" name="work-view" value={option} checked={view === option} onChange={() => go({ view: option })} />
                  <span>{option === "grid" ? "Grid" : "List"}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="section section-plaster work-list" data-tone="light">
        <div className="grid">
          <ul aria-label="Case studies" className={view === "list" ? "case-list" : "case-grid"}>
            {items.map((item) => (
              <li key={item.slug}>
                <PublicLink href={`/work/${item.slug}`} className="card-link">
                  {view === "grid" && <img src={item.coverUrl} alt="" width={1600} height={1000} loading="lazy" />}
                  <span className="card-title">{item.title}</span>
                </PublicLink>
                <p className="card-meta"><span>{SECTOR_LABEL[item.sector]}</span><span>{item.location}</span></p>
                {view === "list" && <p className="case-summary">{item.summary}</p>}
              </li>
            ))}
          </ul>
          {listed && !items.length && <p className="empty-line">No published case studies in this sector yet.</p>}
        </div>
      </section>
      <section className="section section-dark cta" data-tone="dark">
        <div className="grid">
          <h2 className="section-heading">Your rollout could be next.</h2>
          <RollLink href="/start?step=1" label="Start a project" />
        </div>
      </section>
    </>
  );
}
