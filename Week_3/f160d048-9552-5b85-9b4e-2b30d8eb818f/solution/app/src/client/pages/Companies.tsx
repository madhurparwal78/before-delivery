import { useRef, useState } from "react";
import { get } from "../api";
import { FacetGroup } from "../components/Facets";
import { Band } from "../components/ui";
import { useDebounce, useLoad } from "../hooks";
import { Link, setAddress, useLocation } from "../router";
import { Screen } from "../shell/Page";
import { CITIES } from "../../shared/reference";
import type { CompanyHit, CompanySearch } from "../../shared/api";

function pageLink(query: URLSearchParams, page: number): string {
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  return `/companies?${params.toString()}`;
}

const reviewCount = (count: number): string => (count === 1 ? "1 review" : `${count} reviews`);

function CompanyItem({ company }: { company: CompanyHit }) {
  return (
    <li data-id={company.slug}>
      <Link className="item-title" to={`/companies/${company.slug}`}>{company.name}</Link>
      <p className="meta figure">
        {company.city_name} · {company.rating === null ? "No ratings yet" : company.rating.toFixed(1)} · {reviewCount(company.review_count)}
      </p>
    </li>
  );
}

export function Companies() {
  const { query } = useLocation();
  const [text, setText] = useState(query.get("q") ?? "");
  const cities = query.getAll("city");
  const afterLast = useRef<HTMLButtonElement>(null);
  const results = useLoad(() => get<CompanySearch>(`/api/companies/search?${query.toString()}`), [query.toString()]);

  const applySearch = (nextText: string, nextCities: string[]) => {
    const params = new URLSearchParams();
    if (nextText.trim() !== "") params.set("q", nextText.trim());
    nextCities.forEach((city) => params.append("city", city));
    setAddress(`/companies${params.toString() ? `?${params}` : ""}`, false);
  };
  useDebounce(text, () => applySearch(text, cities), 300, text.trim() !== (query.get("q") ?? ""));

  const data = results.data;
  const toggle = (id: string) => applySearch(text, cities.includes(id) ? cities.filter((city) => city !== id) : [...cities, id]);
  return (
    <Screen title="Companies" band={data?.fallback === "by_city" ? <Band>Search is unavailable right now. Showing all companies by city instead.</Band> : null}>
      <h1 className="page-title">Companies</h1>
      <div className="search-bar">
        <div className="field combo">
          <label htmlFor="company-search">Search companies</label>
          <input id="company-search" type="search" value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" />
        </div>
      </div>
      <FacetGroup
        label="City"
        items={CITIES.map((city) => ({ id: city.id, label: city.name, count: data?.fallback ? undefined : data?.facets["city"]?.[city.id] ?? 0 }))}
        selected={cities}
        onToggle={(item) => toggle(item.id)}
        afterLast={afterLast}
      />
      {data?.fallback === "by_city" ? (
        <ul className="by-city" aria-label="Companies by city">
          {data.cities.map((entry) => (
            <li key={entry.city}>
              <h3>{entry.city_name}</h3>
              <ul>
                {entry.companies.map((company) => (
                  <CompanyItem key={company.slug} company={company} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : data ? (
        <>
          <ul className="results" aria-label="Company results">
            {data.hits.map((company) => (
              <CompanyItem key={company.slug} company={company} />
            ))}
          </ul>
          <div className="pager">
            {data.page > 1 ? <Link to={pageLink(query, data.page - 1)}>Previous page</Link> : null}
            {data.page * data.page_size < data.total ? <Link to={pageLink(query, data.page + 1)}>Next page</Link> : null}
          </div>
          {data.hits.length === 0 ? (
            <div className="empty">
              <p>No companies match.</p>
              <Link to="/companies" className="btn">Show all companies</Link>
            </div>
          ) : null}
        </>
      ) : (
        <p>Loading</p>
      )}
    </Screen>
  );
}
