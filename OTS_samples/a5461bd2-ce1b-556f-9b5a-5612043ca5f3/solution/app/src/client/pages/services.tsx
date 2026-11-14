import { type KeyboardEvent, useRef, useState } from "react";
import { matchProjects } from "../../shared/gallery";
import type { Service } from "../../shared/types";
import { catalog } from "../boot";
import { Link, navigate } from "../router";

function Panel({ service }: { service: Service }) {
  const [open, setOpen] = useState<number[]>([]);
  const examples = matchProjects(catalog.projects, { services: [service.id], industry: null });
  const toggle = (at: number) => setOpen((steps) => (steps.includes(at) ? steps.filter((step) => step !== at) : [...steps, at]));
  return (
    <div role="tabpanel" id="service-panel" aria-labelledby={`service-tab-${service.id}`} className="panel">
      <h2>{service.name}</h2>
      <p className="prose">{service.purpose}</p>
      <h3>Deliverables</h3>
      <ul className="deliverables">
        {service.deliverables.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <h3>Process</h3>
      <ol className="steps">
        {service.steps.map((step, at) => (
          <li key={step.name}>
            <button type="button" className="step-button" aria-expanded={open.includes(at)} aria-controls={`step-${at}`} onClick={() => toggle(at)}>
              <span>{at + 1}. {step.name}</span>
            </button>
            <p id={`step-${at}`} hidden={!open.includes(at)}>{step.text}</p>
          </li>
        ))}
      </ol>
      <h3>Examples</h3>
      <ul className="examples">
        {examples.map((project) => <li key={project.slug}><Link href={`/work/${project.slug}`}>{project.name}</Link></li>)}
      </ul>
      <p className="panel-links">
        <Link className="button button--quiet" href={`/work?service=${service.id}`}>See all {service.name} work</Link>
        <Link className="button button--quiet" href={`/pricing?category=${service.id}`}>See {service.name} prices</Link>
        <Link className="button button--primary" href={`/contact?service=${service.id}`}>Enquire about {service.name}</Link>
      </p>
    </div>
  );
}

export function ServicesPage({ service }: { service: Service }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = catalog.services.findIndex((candidate) => candidate.id === service.id);

  const select = (target: number) => {
    const chosen = catalog.services[target];
    if (!chosen) return;
    navigate(`/services/${chosen.id}`, { replace: true });
    tabs.current[target]?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = catalog.services.length - 1;
    const target = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <section className="page" data-section="services">
      <h1 tabIndex={-1}>Services</h1>
      <div role="tablist" aria-label="Services" className="tabs" onKeyDown={onKeyDown}>
        {catalog.services.map((candidate, index) => (
          <button
            key={candidate.id}
            ref={(element) => { tabs.current[index] = element; }}
            type="button"
            role="tab"
            id={`service-tab-${candidate.id}`}
            aria-selected={candidate.id === service.id}
            aria-controls={candidate.id === service.id ? "service-panel" : undefined}
            tabIndex={candidate.id === service.id ? 0 : -1}
            className="tab"
            onClick={() => select(index)}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <Panel key={service.id} service={service} />
    </section>
  );
}
