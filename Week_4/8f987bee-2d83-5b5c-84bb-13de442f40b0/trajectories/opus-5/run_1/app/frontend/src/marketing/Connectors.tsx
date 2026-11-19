import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MarketingLayout } from "./Chrome";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";

interface Definition {
  id: string;
  name: string;
  slug: string;
  type: string;
  category: string;
  availability: string[];
  runnable: boolean;
  custom: boolean;
  version: number;
}

const CATEGORIES = [
  "Finance & Ops Analytics",
  "Databases",
  "Sales & Support Analytics",
  "Marketing Analytics",
  "Product Analytics",
  "Files",
  "Engineering Analytics",
  "Unstructured",
  "Others",
  "Warehouses and Lakes",
];

const TYPE_BOXES: { label: string; value: string }[] = [
  { label: "Sources", value: "source" },
  { label: "Destinations", value: "destination" },
  { label: "Agent Capabilities", value: "agent" },
];

const AVAILABILITY_BOXES: { label: string; value: string }[] = [
  { label: "Cloud", value: "cloud" },
  { label: "OSS", value: "oss" },
  { label: "Hybrid", value: "hybrid" },
];

const CHECKLIST = [
  "Open code: read, fork, or extend any connector",
  "Incremental syncs that absorb schema changes for you",
  "Run it hosted, on your own servers, or in your own cloud",
  "Usage-based pricing you can forecast",
  "800K pipelines a day across 9,000+ teams",
];

interface Controls {
  q: string;
  type: string[];
  availability: string[];
  category: string;
}

function readControls(search: string): Controls {
  const parameters = new URLSearchParams(search);
  const list = (name: string) =>
    (parameters.get(name) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return {
    q: parameters.get("q") ?? "",
    type: list("type"),
    availability: list("availability"),
    category: parameters.get("category") ?? "",
  };
}

function writeControls(controls: Controls): string {
  const parameters = new URLSearchParams();
  if (controls.q) parameters.set("q", controls.q);
  if (controls.type.length) parameters.set("type", controls.type.join(","));
  if (controls.availability.length) parameters.set("availability", controls.availability.join(","));
  if (controls.category) parameters.set("category", controls.category);
  const query = parameters.toString();
  return query ? `?${query}` : "";
}

export function Connectors(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const controls = useMemo(() => readControls(location.search), [location.search]);
  const [typed, setTyped] = useState(controls.q);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    setTyped(controls.q);
  }, [controls.q]);

  useEffect(() => {
    const ticket = ++latest.current;
    const address = `/api/connector-definitions${writeControls(controls)}`;
    void api<{ definitions: Definition[] }>("GET", address, { anonymous: true })
      .then((answer) => {
        if (ticket === latest.current) setDefinitions(answer.definitions);
      })
      .catch(() => {
        if (ticket === latest.current) setDefinitions([]);
      });
  }, [controls]);

  const apply = (next: Controls, replace: boolean) => {
    navigate(`/connectors${writeControls(next)}`, { replace });
  };

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  useEffect(() => {
    if (typed === controls.q) return;
    const timer = window.setTimeout(() => apply({ ...controls, q: typed }, true), 220);
    return () => window.clearTimeout(timer);
  }, [typed, controls]);

  return (
    <MarketingLayout>
      <section className="band dotted">
        <h1>
          Reach the data in every system you run.{" "}
          <span className="gradient-line">For people and agents alike.</span>
        </h1>
        <ul>
          {CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <div className="band">
        <div className="catalog-layout">
          <details className="filter-panel" open>
            <summary>Filters</summary>
            <form onSubmit={(event) => event.preventDefault()}>
            <div className="field search-field">
              <label htmlFor="catalog-search">
                <Icon name="search" />
                Search connectors
              </label>
              <input
                id="catalog-search"
                type="text"
                className="search-input"
                maxLength={100}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            <fieldset className="filter-group">
              <legend>Connector Type</legend>
              {TYPE_BOXES.map((box) => (
                <div className="check-row" key={box.value}>
                  <input
                    type="checkbox"
                    id={`type-${box.value}`}
                    checked={controls.type.includes(box.value)}
                    onChange={() => apply({ ...controls, type: toggle(controls.type, box.value) }, false)}
                  />
                  <label htmlFor={`type-${box.value}`}>{box.label}</label>
                </div>
              ))}
            </fieldset>
            <fieldset className="filter-group">
              <legend>Availability</legend>
              {AVAILABILITY_BOXES.map((box) => (
                <div className="check-row" key={box.value}>
                  <input
                    type="checkbox"
                    id={`availability-${box.value}`}
                    checked={controls.availability.includes(box.value)}
                    onChange={() =>
                      apply({ ...controls, availability: toggle(controls.availability, box.value) }, false)
                    }
                  />
                  <label htmlFor={`availability-${box.value}`}>{box.label}</label>
                </div>
              ))}
            </fieldset>
            <fieldset className="filter-group">
              <legend>Use case</legend>
              <div className="check-row">
                <input
                  type="radio"
                  name="category"
                  id="category-all"
                  checked={controls.category === ""}
                  onChange={() => apply({ ...controls, category: "" }, false)}
                />
                <label htmlFor="category-all">All</label>
              </div>
              {CATEGORIES.map((category) => (
                <div className="check-row" key={category}>
                  <input
                    type="radio"
                    name="category"
                    id={`category-${category}`}
                    checked={controls.category === category}
                    onChange={() => apply({ ...controls, category }, false)}
                  />
                  <label htmlFor={`category-${category}`}>{category}</label>
                </div>
              ))}
            </fieldset>
            <button
              type="button"
              className="button outline"
              onClick={() => apply({ q: "", type: [], availability: [], category: "" }, false)}
            >
              Clear all
            </button>
            </form>
          </details>
          <div>
            <p className="plain-label" role="status" aria-live="polite" aria-label="Catalog results">
              Showing {definitions.length}
            </p>
            <div className="catalog-grid">
              {definitions.map((definition) => (
                <Link key={definition.id} to="/connectors" className="catalog-card" aria-label={definition.name}>
                  <span className="monogram" aria-hidden="true">
                    {definition.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{definition.name}</strong>
                    <span style={{ display: "block", color: "var(--muted)", fontSize: "0.85rem" }}>
                      {definition.category}
                    </span>
                    <span className="chips">
                      {definition.availability.map((tag) => (
                        <span className="chip" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  </span>
                  <Icon name="external" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
