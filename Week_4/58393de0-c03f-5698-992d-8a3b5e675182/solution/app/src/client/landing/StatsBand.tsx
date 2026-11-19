import { STATS } from "./content";
import { StatsDoodles } from "./doodles";

/** The classroom stats doodle band: three plain classroom facts over outline doodles. */
export function StatsBand() {
  return (
    <section id="classrooms" className="stats-band" aria-label="Classroom stats">
      <StatsDoodles />
      <div className="column stats-inner">
        <h2>Built for the room you actually teach in</h2>
        <ul className="stats-list">
          {STATS.map((stat) => (
            <li key={stat.figure}>
              <span className="stat-figure figures">{stat.figure}</span>
              <span className="stat-label">{stat.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
