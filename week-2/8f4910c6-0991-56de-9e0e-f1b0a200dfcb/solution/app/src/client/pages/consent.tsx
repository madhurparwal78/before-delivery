// Guardian consent (/consent/<token>): approve or decline a minor's application through a single-use link.

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { definePage } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Button } from "../ui/button.js";
import { StatusLine, useAnnouncer } from "../ui/status.js";
import { isOfficeId } from "../../shared/zones.js";
import { CITY } from "../public-data.js";

interface Consent {
  applicantFirstName: string;
  office: string;
  expiresAt: string;
}

function DeadConsent() {
  return (
    <section className="gone">
      <Heading lines={["This consent link no longer works"]} />
      <p>Ask Vesper &amp; Rowe to send a new link if you still need to decide.</p>
    </section>
  );
}

function ConsentPage({ token }: { token: string }) {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [dead, setDead] = useState(false);
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);
  const [done, setDone] = useState(false);
  const { message, announce } = useAnnouncer();
  const path = `/api/consents/${encodeURIComponent(token)}`;

  useEffect(() => {
    void api<Consent>("GET", path).then((result) => {
      if (result.ok) setConsent(result.data);
      else setDead(true);
    });
  }, [path]);

  if (dead) return <DeadConsent />;
  if (!consent) return <p className="muted">Loading…</p>;
  const name = consent.applicantFirstName;

  const decide = async (decision: "approve" | "decline") => {
    setPending(decision);
    const result = await api("POST", path, { decision });
    setPending(null);
    if (result.ok) {
      setDone(true);
      announce(decision === "approve" ? `Thank you. You approved ${name}'s application.`
        : `You declined ${name}'s application. We will not contact them again.`);
    } else if (result.status === 410) {
      setDead(true);
    } else {
      announce("Your decision could not be saved. Try again in a moment.");
    }
  };

  return (
    <section className="consent">
      <p className="eyebrow">Guardian consent</p>
      <Heading lines={[`${name}'s application`]} />
      <p className="lede">{name} has applied to join the New Faces board at Vesper &amp; Rowe Talent
        {isOfficeId(consent.office) ? ` in ${CITY[consent.office]}` : ""}. Because {name} is under 18, our scouts review
        the application only after a parent or guardian approves it.</p>
      <StatusLine name="Consent" message={message} />
      {done ? null : (
        <div className="btn-row">
          <Button pending={pending === "approve"} pendingLabel="Saving…" disabled={pending !== null}
            onClick={() => void decide("approve")}>Approve application</Button>
          <Button variant="quiet" pending={pending === "decline"} pendingLabel="Saving…" disabled={pending !== null}
            onClick={() => void decide("decline")}>Decline application</Button>
        </div>
      )}
    </section>
  );
}

definePage({ pattern: "/consent/:token", kind: "public", render: (match) => <ConsentPage token={match.params.token} /> });
