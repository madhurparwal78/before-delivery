// A casting package (/p/<token>): Shortlist or Pass shows at once and rolls back with exact copy when the
// server refuses; Download photos fetches the ZIP. A dead link shows the dead-link page.

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { definePage } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Portrait } from "../ui/portrait.js";
import { Button } from "../ui/button.js";
import { StatusLine, useAnnouncer } from "../ui/status.js";
import { compactReach, formatOfficeTime } from "../../shared/format.js";
import { girthBoth, heightBoth } from "../../shared/measure.js";
import { CITY, type Profile } from "../public-data.js";

type Decision = "shortlisted" | "passed" | "undecided";

interface PackageTalent extends Profile {
  decision: Decision;
}

interface PackageView {
  title: string;
  expiresAt: string;
  shortlistedCount: number;
  talent: PackageTalent[];
}

const STORAGE_DOWN = "Photo storage is unreachable, so the download could not be prepared. Try again in a few minutes.";

function DeadLink() {
  return (
    <section className="gone">
      <Heading lines={["This package link no longer opens"]} />
      <p>Ask your Vesper &amp; Rowe booker for a new link.</p>
    </section>
  );
}

function refusal(code: string, name: string): string {
  if (code === "link_expired") return `This package link has expired, so your choice for ${name} was not saved.`;
  if (code === "not_found") return `${name} is no longer in this package.`;
  return `This package link was revoked, so your choice for ${name} was not saved.`;
}

function PackagePage({ token }: { token: string }) {
  const [view, setView] = useState<PackageView | null>(null);
  const [dead, setDead] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { message, announce } = useAnnouncer();
  const base = `/api/p/${encodeURIComponent(token)}`;

  useEffect(() => {
    void api<PackageView>("GET", base).then((result) => {
      if (result.ok) setView(result.data);
      else setDead(true);
    });
  }, [base]);

  if (dead) return <DeadLink />;
  if (!view) return <p className="muted">Loading the package…</p>;

  const setDecision = (slug: string, decision: Decision) =>
    setView((current) => current && {
      ...current,
      talent: current.talent.map((t) => (t.slug === slug ? { ...t, decision } : t)),
    });

  const choose = async (talent: PackageTalent, pressed: Exclude<Decision, "undecided">) => {
    const before = talent.decision;
    const decision: Decision = before === pressed ? "undecided" : pressed;
    setDecision(talent.slug, decision);
    const result = await api("PUT", `${base}/decisions/${encodeURIComponent(talent.slug)}`, { decision });
    if (result.ok) {
      announce(decision === "shortlisted" ? `Shortlisted ${talent.displayName}.`
        : decision === "passed" ? `Passed on ${talent.displayName}.` : `Cleared your choice for ${talent.displayName}.`);
      return;
    }
    setDecision(talent.slug, before);
    announce(refusal(result.error.error, talent.displayName));
    if (result.error.error === "not_found") {
      setView((current) => current && { ...current, talent: current.talent.filter((t) => t.slug !== talent.slug) });
    }
  };

  const download = async () => {
    setDownloading(true);
    let response: Response | null = null;
    try {
      response = await fetch(`${base}/photos.zip`);
    } catch {
      response = null;
    }
    setDownloading(false);
    if (!response || !response.ok) {
      if (response?.status === 410) setDead(true);
      else announce(STORAGE_DOWN);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${view.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "package"}-photos.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    announce("Your download has started.");
  };

  const shortlisted = view.talent.filter((t) => t.decision === "shortlisted").length;
  return (
    <>
      <p className="eyebrow">Casting package</p>
      <Heading lines={[view.title]} />
      <p className="muted">This link works until {formatOfficeTime(view.expiresAt, "toronto")}.</p>
      <StatusLine name="Package" message={message} />
      <div className="card-grid package-grid">
        {view.talent.map((talent) => {
          const id = `pkg-${talent.slug}`;
          const height = talent.measurements.heightCm;
          return (
            <article key={talent.slug} className="talent-card" aria-labelledby={id}>
              <Portrait src={talent.portfolio[0]?.url ?? talent.coverPhotoUrl} alt={`${talent.displayName}, portrait`}
                name={talent.displayName} />
              <h2 id={id} className="talent-card-name">{talent.displayName}</h2>
              <dl className="facts">
                <div><dt>Office</dt><dd>{CITY[talent.office]}</dd></div>
                {height !== null ? <div><dt>Height</dt><dd className="num">{heightBoth(height)}</dd></div> : null}
                {talent.measurements.waistCm !== null
                  ? <div><dt>Waist</dt><dd className="num">{girthBoth(talent.measurements.waistCm)}</dd></div> : null}
                <div><dt>Reach</dt><dd className="num">{compactReach(talent.reach.total)}</dd></div>
              </dl>
              {talent.portfolio.length > 1 ? (
                <ul className="thumbs" aria-label={`More photos of ${talent.displayName}`}>
                  {talent.portfolio.slice(1).map((photo, i) => (
                    <li key={photo.photoId}><img src={photo.url} alt={`${talent.displayName}, photo ${i + 2} of ${talent.portfolio.length}`}
                      loading="lazy" /></li>
                  ))}
                </ul>
              ) : null}
              <div className="btn-row choice-row">
                <Button variant="quiet" aria-pressed={talent.decision === "shortlisted"}
                  onClick={() => void choose(talent, "shortlisted")}>Shortlist</Button>
                <Button variant="quiet" aria-pressed={talent.decision === "passed"}
                  onClick={() => void choose(talent, "passed")}>Pass</Button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="sticky-bar package-bar">
        <p role="status" className="num">{shortlisted} shortlisted</p>
        <Button pending={downloading} pendingLabel="Preparing photos…" onClick={() => void download()}>Download photos</Button>
      </div>
    </>
  );
}

definePage({ pattern: "/p/:token", kind: "public", render: (match) => <PackagePage token={match.params.token} /> });
