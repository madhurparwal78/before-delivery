import { catalog } from "../boot";
import { Link } from "../router";

export function StudioPage() {
  const { principles, people, stages } = catalog.studio;
  return (
    <section className="page" data-section="studio">
      <h1 tabIndex={-1}>The studio</h1>
      <p className="lede prose">Two founders, two designers, one room in Kochi. We take on six projects a season so each one gets our full attention.</p>
      <h2>What we care about</h2>
      <div className="principles">
        {principles.map((principle) => (
          <div key={principle.name}>
            <h3>{principle.name}</h3>
            <p className="prose">{principle.text}</p>
          </div>
        ))}
      </div>
      <h2>The people</h2>
      <ul className="people">
        {people.map((person) => (
          <li key={person.name}>
            <p className="person-name">{person.name}</p>
            <p className="person-role">{person.role}</p>
            <p>{person.line}</p>
          </li>
        ))}
      </ul>
      <h2>How a project runs</h2>
      <ol className="stages">
        {stages.map((stage) => (
          <li key={stage.name}>
            <span className="stage-name">{stage.name}</span>
            <span>{stage.text}</span>
          </li>
        ))}
      </ol>
      <p className="panel-links">
        <Link className="button button--quiet" href="/pricing">See the price list</Link>
        <Link className="button button--primary" href="/contact">Start a project</Link>
      </p>
    </section>
  );
}
