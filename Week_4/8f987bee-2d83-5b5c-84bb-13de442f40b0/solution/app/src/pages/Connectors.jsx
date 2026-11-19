import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import CatalogCard from "../components/CatalogCard.jsx";
import { Search, Tick } from "../components/Icons.jsx";

const TYPES = [["source", "Sources"], ["destination", "Destinations"], ["agent", "Agent Capabilities"]];
const AVAILABILITY = [["cloud", "Cloud"], ["oss", "OSS"], ["hybrid", "Hybrid"]];
const CHECKLIST = [
  "Open code: read, fork, or extend any connector",
  "Incremental syncs that absorb schema changes for you",
  "Run it hosted, on your own servers, or in your own cloud",
  "Usage-based pricing you can forecast",
  "800K pipelines a day across 9,000+ teams",
];
const Q_MAX = 100;

const listOf = (params, key) => (params.get(key) || "").split(",").filter(Boolean);

// The address holds the catalog state with the API's own parameters, so a shared link shows the same cards.
export default function Connectors() {
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [shown, setShown] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = params.get("q") || "";
  const types = listOf(params, "type");
  const availability = listOf(params, "availability");
  const category = params.get("category") || "";
  const query = params.toString();

  useEffect(() => {
    fetch("/api/connector-definitions")
      .then((r) => r.json())
      .then((body) => setCategories([...new Set(body.definitions.map((d) => d.category))]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/connector-definitions${query ? `?${query}` : ""}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { definitions: [] }))
      .then((body) => setShown(body.definitions))
      .catch(() => {});
    return () => controller.abort();
  }, [query]);

  const update = (changes, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace });
  };
  const toggle = (key, list, value) => {
    const chosen = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    update({ [key]: chosen.join(",") });
  };

  return (
    <>
      <section className="page-hero dots">
        <div className="container two-col hero-split">
          <div className="section-head">
            <span className="label eyebrow">Connector catalog</span>
            <h1 className="display">
              <span className="line">Reach the data in every system you run.</span>{" "}
              <span className="line grad-text">For people and agents alike.</span>
            </h1>
          </div>
          <ul className="checklist">
            {CHECKLIST.map((item) => <li key={item}><Tick />{item}</li>)}
          </ul>
        </div>
      </section>
      <section className="container catalog">
        <div className="filters">
          <div className="search">
            <label htmlFor="catalog-search" className="sr-only">Search connectors</label>
            <Search />
            <input id="catalog-search" className="input" type="text" placeholder="Search connectors" maxLength={Q_MAX}
              value={q} onChange={(e) => update({ q: e.target.value }, true)} />
          </div>
          <button type="button" className="btn btn-outline filters-toggle" aria-expanded={filtersOpen}
            aria-controls="catalog-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters</button>
          <div id="catalog-filters" className={`filters-body ${filtersOpen ? "open" : ""}`}>
            <fieldset>
              <legend className="label">Connector Type</legend>
              {TYPES.map(([value, label]) => (
                <label className="check" key={value}>
                  <input type="checkbox" checked={types.includes(value)} onChange={() => toggle("type", types, value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="label">Availability</legend>
              {AVAILABILITY.map(([value, label]) => (
                <label className="check" key={value}>
                  <input type="checkbox" checked={availability.includes(value)}
                    onChange={() => toggle("availability", availability, value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="label">Use case</legend>
              {["", ...categories].map((name) => (
                <label className="check" key={name || "all"}>
                  <input type="radio" name="use-case" checked={category === name} onChange={() => update({ category: name })} />
                  {name || "All"}
                </label>
              ))}
            </fieldset>
            <button type="button" className="btn btn-outline" onClick={() => setParams(new URLSearchParams())}>Clear all</button>
          </div>
        </div>
        <div>
          <p role="status" aria-label="Catalog results" className="label status-line">
            {shown === null ? "Loading connectors" : `Showing ${shown.length}`}
          </p>
          <ul className={`catalog-grid${shown === null ? " loading" : ""}`}>
            {(shown || []).map((definition) => (
              <li key={definition.id}><CatalogCard definition={definition} to="/signin" /></li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
