import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { galleryCounts, matchProjects, pageOf, parseGalleryQuery, queryOfGallery, type GalleryFilter, EMPTY_FILTER } from "../../shared/gallery";
import { catalog, GALLERY_PAGE_SIZE } from "../boot";
import { focusClear } from "../focus";
import { serviceNames } from "../format";
import { Link, navigate, useLocation } from "../router";
import { rememberGalleryAddress, rememberOpenedTile, takeOpenedTile } from "../storage";

function resultsText(total: number): string {
  if (total === 0) return "No projects match these filters.";
  return total === 1 ? "1 project matches" : `${total} projects match`;
}

export function WorkPage() {
  const location = useLocation();
  const { filter, pages } = useMemo(() => parseGalleryQuery(location.search, catalog.services, catalog.industries), [location.search]);
  const [status, setStatus] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const firstService = useRef<HTMLButtonElement>(null);

  const matches = matchProjects(catalog.projects, filter);
  const shown = pageOf(matches, 0, pages * GALLERY_PAGE_SIZE).items;
  const counts = galleryCounts(catalog.projects, catalog.services, catalog.industries, filter);
  const filtered = filter.services.length > 0 || filter.industry !== null;

  useEffect(() => rememberGalleryAddress(`/work${location.search}`), [location.search]);

  useLayoutEffect(() => {
    const slug = takeOpenedTile();
    if (slug) focusClear(list.current?.querySelector<HTMLElement>(`a[href="/work/${slug}"]`));
  }, []);

  const apply = (next: GalleryFilter) => {
    navigate(`/work${queryOfGallery(next, catalog.services, 1)}`, { replace: true });
    setStatus(resultsText(matchProjects(catalog.projects, next).length));
  };

  const toggle = (id: string) => apply({ ...filter, services: filter.services.includes(id) ? filter.services.filter((chosen) => chosen !== id) : [...filter.services, id] });

  const showMore = () => {
    const before = shown.length;
    navigate(`/work${queryOfGallery(filter, catalog.services, pages + 1)}`, { replace: true });
    focusClear(list.current?.querySelectorAll<HTMLElement>("li a")[before]);
  };

  const clear = () => {
    apply(EMPTY_FILTER);
    focusClear(firstService.current);
  };

  return (
    <section className="page" data-section="work">
      <h1 tabIndex={-1}>Selected work</h1>
      <div className="filters">
        <div role="group" aria-label="Filter by service" className="chips">
          {catalog.services.map((service, at) => (
            <button key={service.id} ref={at === 0 ? firstService : undefined} type="button" className="chip" aria-pressed={filter.services.includes(service.id)} onClick={() => toggle(service.id)}>
              {service.name} ({counts.services[service.id]})
            </button>
          ))}
        </div>
        <div className="field-row">
          <label htmlFor="industry-filter">Industry</label>
          <select id="industry-filter" value={filter.industry ?? ""} onChange={(event) => apply({ ...filter, industry: event.target.value || null })}>
            <option value="">All industries ({counts.allIndustries})</option>
            {catalog.industries.map((industry) => <option key={industry.id} value={industry.id}>{industry.name} ({counts.industries[industry.id]})</option>)}
          </select>
          {filtered && <button type="button" className="button button--quiet" onClick={clear}>Clear filters</button>}
        </div>
        <div role="status" aria-label="Results" className="status">{status}</div>
      </div>
      <ul className="tiles" aria-label="Projects" ref={list}>
        {shown.map((project) => (
          <li key={project.slug} className="tile">
            <span className="tile-plate" aria-hidden="true" style={{ background: project.colours.ground }}>
              <span style={{ background: project.colours.accent }} />
            </span>
            <Link href={`/work/${project.slug}`} onClick={() => rememberOpenedTile(project.slug)}>{project.name}</Link>
            <p className="tile-industry">{project.industry}</p>
            <p className="tile-services">{serviceNames(project.services)}</p>
          </li>
        ))}
      </ul>
      {matches.length > 0 && <p className="shown-count">Showing {shown.length} of {matches.length}</p>}
      {matches.length > shown.length && <button type="button" className="button button--primary" onClick={showMore}>Show more work</button>}
      {matches.length === 0 && <button type="button" className="button button--primary" onClick={() => apply(EMPTY_FILTER)}>Show all projects</button>}
    </section>
  );
}
