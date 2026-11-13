import { useEffect, useRef, useState } from "react";
import { get } from "../api";
import { SpecimenTile, rowCaption, TileLoading } from "../components/SpecimenTile";
import { useLoad, usePageTitle } from "../hooks";
import { Link } from "../router";
import { useSession } from "../session";
import { SiteHeader } from "../shell/SiteHeader";
import type { Company } from "../../shared/api";

const SAMPLE_LABS = ["fernhollow-assay-labs", "thistlecombe-biologics", "larkspur-core-facility"] as const;

export function Landing() {
  usePageTitle("Know the bench");
  const { me } = useSession();
  // Only viewers who can open /employer see the link; for other roles it would lead to Not found.
  const employerLink = !me || me.role === "employer_admin" || me.role === "recruiter";
  const labs = useLoad(async () => {
    const answers = await Promise.all(SAMPLE_LABS.map((slug) => get<Company>(`/api/companies/${slug}`)));
    const found = answers.flatMap((answer) => (answer.ok ? [answer.data] : []));
    return { ok: true as const, status: 200, data: found };
  }, []);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    function update() {
      const middle = window.innerHeight / 2;
      let current = 0;
      sections.current.forEach((section, index) => {
        if (!section) return;
        const box = section.getBoundingClientRect();
        if (box.top + box.height / 2 <= middle + 1) current = index;
      });
      setActive(current);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [labs.data]);

  const list = labs.data ?? [];
  const lab = list[active] ?? list[0];
  const glass = (slug: string) => {
    const found = list.find((candidate) => candidate.slug === slug);
    const row = found?.pay_rows[0];
    return { seed: found?.name ?? slug, caption: row ? rowCaption(row) : (found?.name ?? "") };
  };

  return (
    <div className="split landing">
      <SiteHeader />
      <div className="split-field">
        {employerLink ? <Link to="/employer" className="field-link">For employers</Link> : null}
        {lab ? <SpecimenTile bandKey={lab.slug} rows={[]} unlocked={false} glass={glass} /> : <TileLoading />}
      </div>
      <div className="split-main">
        <section className="hero">
          <h1>Know the bench before you take the job.</h1>
          <p className="sentence">Pay ranges open only once enough people have shared theirs, so no one can be picked out.</p>
          <div>
            <Link to="/jobs" className="btn">Search lab jobs</Link>
          </div>
        </section>
        <div className="lab-sections">
          {list.map((entry, index) => (
            <section key={entry.slug} className="lab-section" ref={(element) => { sections.current[index] = element; }}>
              <h2>{entry.name}</h2>
              <p>{entry.city_name}</p>
              <p>
                <Link to={`/companies/${entry.slug}`}>Read about {entry.name}</Link>
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
