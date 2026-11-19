import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MarketingLayout } from "./marketing.jsx";
import { Icon, Status } from "./components.jsx";
import { api, ApiError } from "./api.js";

const CATEGORIES = [
  "Databases", "Sales & Support Analytics", "Finance & Ops Analytics",
  "Marketing Analytics", "Product Analytics", "Engineering Analytics",
  "Files", "Unstructured", "Warehouses and Lakes", "Others",
];

function searchParamsToState(params) {
  const q = params.get("q") || "";
  const type = (params.get("type") || "").split(",").filter(Boolean);
  const availability = (params.get("availability") || "").split(",").filter(Boolean);
  const category = params.get("category") || "";
  return { q, type, availability, category };
}

function stateToSearchParams(state) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.type.length) params.set("type", state.type.join(","));
  if (state.availability.length) params.set("availability", state.availability.join(","));
  if (state.category) params.set("category", state.category);
  return params;
}

export default function ConnectorsPage() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(() => searchParamsToState(params));
  const [definitions, setDefinitions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const seqRef = useRef(0);
  const [shown, setShown] = useState(null);

  useEffect(() => {
    setState(searchParamsToState(params));
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    const current = ++seqRef.current;
    setLoaded(false);
    const query = stateToSearchParams(state).toString();
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await api(`/api/connector-definitions${query ? `?${query}` : ""}`);
        if (!cancelled && current === seqRef.current) {
          setDefinitions(data.definitions);
          setShown(data.definitions.length);
          setLoaded(true);
        }
      } catch (error) {
        if (!cancelled && current === seqRef.current) {
          setDefinitions([]);
          setShown(0);
          setLoaded(true);
        }
      }
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.q, state.type.join(","), state.availability.join(","), state.category]);

  const push = (next, replace = false) => {
    const search = stateToSearchParams(next).toString();
    setParams(search ? new URLSearchParams(search) : new URLSearchParams(),
      { replace });
  };

  const toggle = (listName, value) => {
    const list = state[listName];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const nextState = { ...state, [listName]: next };
    setState(nextState);
    push(nextState);
  };

  const setCategory = (value) => {
    const nextState = { ...state, category: value };
    setState(nextState);
    push(nextState);
  };

  const onSearch = (e) => {
    const value = e.target.value.slice(0, 100);
    const nextState = { ...state, q: value };
    setState(nextState);
    const search = stateToSearchParams(nextState).toString();
    window.history.replaceState(null, "",
      `${window.location.pathname}${search ? `?${search}` : ""}`);
  };

  const clearAll = () => {
    const nextState = { q: "", type: [], availability: [], category: "" };
    setState(nextState);
    push(nextState);
  };

  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <MarketingLayout>
      <section className="section wrap">
        <span className="eyebrow">Connector catalog</span>
        <h1>Reach the data in every system you run.</h1>
        <p className="grad" style={{ fontSize: "1.2rem", fontWeight: 600 }}>
          For people and agents alike.
        </p>
        <ul style={{ marginTop: "1.4rem", maxWidth: "70ch" }}>
          {[
            "Open code: read, fork, or extend any connector",
            "Incremental syncs that absorb schema changes for you",
            "Run it hosted, on your own servers, or in your own cloud",
            "Usage-based pricing you can forecast",
            "800K pipelines a day across 9,000+ teams",
          ].map((item) => (
            <li key={item} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
              <span style={{ color: "var(--violet)" }}><Icon name="tick" /></span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="wrap catalog-layout" data-layout="catalog">
        <style>{`@media (max-width: 991px) { [data-layout="catalog"] { grid-template-columns: 1fr; } }`}</style>
        <aside>
          <button type="button" className="btn btn-outline btn-sm"
            style={{ marginBottom: "0.9rem", display: "none" }}
            onClick={() => setFiltersOpen(true)}>Filters</button>
          <div className="filters-panel">
            <div className="field">
              <label htmlFor="catalog-search">Search connectors</label>
              <input id="catalog-search" className="input" type="text" value={state.q}
                maxLength={100} placeholder="Search connectors"
                onChange={onSearch} />
            </div>
            <fieldset style={{ border: "none", padding: 0 }}>
              <legend className="label-mono" style={{ color: "var(--muted)" }}>
                Connector Type
              </legend>
              {[["source", "Sources"], ["destination", "Destinations"], ["agent", "Agent Capabilities"]]
                .map(([value, label]) => (
                  <label className="check" key={value}>
                    <input type="checkbox" checked={state.type.includes(value)}
                      onChange={() => toggle("type", value)} />
                    <span className="check-label">{label}</span>
                  </label>
                ))}
            </fieldset>
            <fieldset style={{ border: "none", padding: 0 }}>
              <legend className="label-mono" style={{ color: "var(--muted)" }}>
                Availability
              </legend>
              {[["cloud", "Cloud"], ["oss", "OSS"], ["hybrid", "Hybrid"]].map(([value, label]) => (
                <label className="check" key={value}>
                  <input type="checkbox" checked={state.availability.includes(value)}
                    onChange={() => toggle("availability", value)} />
                  <span className="check-label">{label}</span>
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: "none", padding: 0 }}>
              <legend className="label-mono" style={{ color: "var(--muted)" }}>Use case</legend>
              <label className="check">
                <input type="radio" name="use-case" checked={!state.category}
                  onChange={() => setCategory("")} />
                <span className="check-label">All</span>
              </label>
              {CATEGORIES.map((category) => (
                <label className="check" key={category}>
                  <input type="radio" name="use-case" checked={state.category === category}
                    onChange={() => setCategory(category)} />
                  <span className="check-label">{category}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="btn btn-outline btn-sm" onClick={clearAll}>
              Clear all
            </button>
          </div>
        </aside>
        <div>
          <p style={{ margin: "0 0 1rem" }}>
            <Status name="catalog" message={loaded ? `Showing ${shown}` : "Showing…"}
              id="catalog-status" />
          </p>
          <div className="catalog-grid">
            {definitions.map((definition) => (
              <Link key={definition.id} to="/connectors"
                className="connector-card" aria-label={definition.name}>
                <span className="monogram" aria-hidden="true">
                  {definition.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <span style={{ display: "block", color: "var(--ink)", fontWeight: 600 }}>
                    {definition.name}
                  </span>
                  <span style={{ display: "block", fontSize: "0.82rem", color: "var(--muted)" }}>
                    {definition.category}
                  </span>
                  <span className="connector-tags">
                    {definition.availability.map((tag) => (
                      <span className="tag" key={tag}>{tag}</span>
                    ))}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
