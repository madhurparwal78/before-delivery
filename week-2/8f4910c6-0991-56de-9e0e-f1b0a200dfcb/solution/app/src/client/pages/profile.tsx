// A public talent profile (/talent/<slug>): measurements in both units, reach per platform and in total,
// the portfolio, and Add to tray. A withdrawn or erased talent shows the gone page.

import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Link, definePage, useLocation } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Portrait } from "../ui/portrait.js";
import { TrayButton } from "./boards.js";
import { compactReach } from "../../shared/format.js";
import { feetAndInches, girthBoth, heightBoth } from "../../shared/measure.js";
import { CITY, boardById, boardHref, type Profile } from "../public-data.js";

type Loaded = { kind: "profile"; profile: Profile } | { kind: "gone" } | { kind: "missing" } | { kind: "loading" };

function GonePage() {
  return (
    <section className="gone">
      <Heading lines={["No longer represented"]} />
      <p>This talent is no longer represented by Vesper &amp; Rowe Talent.</p>
      <p><Link href="/boards">Browse the boards</Link></p>
    </section>
  );
}

function Facts({ profile, unit }: { profile: Profile; unit: string }) {
  const { heightCm, chestCm, waistCm, hipsCm } = profile.measurements;
  const height = heightCm === null ? null
    : unit === "ft_in" ? `${feetAndInches(heightCm)} / ${heightCm} cm` : heightBoth(heightCm);
  const reach: Array<[string, number | null]> = [
    ["Instagram", profile.reach.instagram],
    ["TikTok", profile.reach.tiktok],
    ["YouTube", profile.reach.youtube],
  ];
  return (
    <div className="profile-facts">
      <dl className="facts">
        <div><dt>Office</dt><dd>{CITY[profile.office]}</dd></div>
        <div><dt>Board</dt><dd>{boardById(profile.board)?.title}</dd></div>
        {height ? <div><dt>Height</dt><dd className="num">{height}</dd></div> : null}
        {chestCm !== null ? <div><dt>Chest</dt><dd className="num">{girthBoth(chestCm)}</dd></div> : null}
        {waistCm !== null ? <div><dt>Waist</dt><dd className="num">{girthBoth(waistCm)}</dd></div> : null}
        {hipsCm !== null ? <div><dt>Hips</dt><dd className="num">{girthBoth(hipsCm)}</dd></div> : null}
      </dl>
      <h2 className="facts-title">Reach</h2>
      <dl className="facts">
        {reach.filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0).map(([platform, count]) => (
          <div key={platform}><dt>{platform}</dt><dd className="num">{compactReach(count)}</dd></div>
        ))}
        <div><dt>Total</dt><dd className="num">{compactReach(profile.reach.total)}</dd></div>
      </dl>
    </div>
  );
}

function ProfilePage({ slug }: { slug: string }) {
  const { query } = useLocation();
  const unit = query.get("unit") === "ft_in" ? "ft_in" : "cm";
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const portrait = useRef<HTMLLIElement>(null);
  useEffect(() => {
    let live = true;
    void api<Profile>("GET", `/api/public/talent/${encodeURIComponent(slug)}`).then((result) => {
      if (!live) return;
      if (result.ok) setLoaded({ kind: "profile", profile: result.data });
      else setLoaded({ kind: result.status === 410 ? "gone" : "missing" });
    });
    return () => {
      live = false;
    };
  }, [slug]);

  if (loaded.kind === "loading") return <p className="muted">Loading the profile…</p>;
  if (loaded.kind === "gone") return <GonePage />;
  if (loaded.kind === "missing") {
    return (
      <section className="gone">
        <Heading lines={["Talent not found"]} />
        <p className="muted">No talent has that address. <Link href="/boards">Browse the boards</Link>.</p>
      </section>
    );
  }
  const { profile } = loaded;
  const board = boardById(profile.board);
  const total = profile.portfolio.length;
  return (
    <article className="profile" aria-labelledby="profile-name">
      {board ? <p className="back-link"><Link href={boardHref(board.slug, { unit })}>All {board.title} talent</Link></p> : null}
      <Heading id="profile-name" lines={[profile.displayName]} />
      <div className="profile-layout">
        <div className="profile-side">
          <Facts profile={profile} unit={unit} />
          <TrayButton card={profile} portrait={() => portrait.current?.querySelector<HTMLElement>(".portrait-frame") ?? null} />
        </div>
        <ul className="portfolio-grid" aria-label="Portfolio">
          {total ? profile.portfolio.map((photo, i) => (
            <li key={photo.photoId} ref={i === 0 ? portrait : undefined}>
              <Portrait src={photo.url} alt={`${profile.displayName}, photo ${i + 1} of ${total}`} name={profile.displayName} />
            </li>
          )) : (
            <li ref={portrait}><Portrait src={null} alt={`${profile.displayName}, portrait to come`} name={profile.displayName} /></li>
          )}
        </ul>
      </div>
    </article>
  );
}

definePage({ pattern: "/talent/:slug", kind: "public", render: (match) => <ProfilePage slug={match.params.slug} /> });
