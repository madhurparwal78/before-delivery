import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { LibraryCard } from "../../shared/api.ts";
import { APPLICATIONS } from "../../shared/domain.ts";
import { api, get, messageOf } from "../lib/api.ts";
import { calendarDate } from "../lib/format.ts";
import { navigate } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";
import { Alert, Button, Dialog, usePageStatus } from "../ui/index.ts";

function newSubmissionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `dialog "Request <card name>"`: one named use of one card, with the engagement cap notice. */
export function RequestDialog({ card, onClose }: { card: LibraryCard; onClose: () => void }): ReactNode {
  const { me } = useSession();
  const say = usePageStatus();
  const engagement = me!.engagement;
  // Created when the dialog opens and reused for every press until it closes: a double press makes one request.
  const key = useRef(newSubmissionKey());
  const [application, setApplication] = useState("social");
  const [territories, setTerritories] = useState<string[]>(engagement ? engagement.territories.slice(0, 1) : []);
  const [startsOn, setStartsOn] = useState(me!.today);
  const [endsOn, setEndsOn] = useState("");
  const [liveRules, setLiveRules] = useState<string[]>([]);
  const [cited, setCited] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<{ rules: { identifier: string }[] }>("/api/rules").then((body) => setLiveRules(body.rules.map((rule) => rule.identifier)));
  }, []);

  const toggle = (list: string[], value: string): string[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const outlasts = engagement !== null && endsOn !== "" && endsOn > engagement.endsOn;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await api<{ id: string }>("POST", "/api/requests", {
        idempotencyKey: key.current,
        assetId: card.assetId,
        variantId: card.variantId,
        applicationClass: application,
        territories,
        campaignStartsOn: startsOn,
        campaignEndsOn: endsOn,
        citedRules: cited,
        note,
        submit: true,
      });
      say(`${created.id} submitted.`);
      navigate(`/requests/${created.id}`);
    } catch (failure) {
      setError(messageOf(failure));
      setPending(false);
    }
  }

  return (
    <Dialog name={`Request ${card.cardName}`} onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <h2>{`Request ${card.cardName}`}</h2>
        <div className="field">
          <label htmlFor="req-application">Application</label>
          <select id="req-application" value={application} onChange={(event) => setApplication(event.target.value)}>
            {APPLICATIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="field">
          <legend>Territories</legend>
          <div className="check-grid">
            {(engagement?.territories ?? []).map((code) => (
              <label key={code} className="check">
                <input type="checkbox" checked={territories.includes(code)} onChange={() => setTerritories((list) => toggle(list, code))} />
                {code}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="date-pair">
          <div className="field">
            <label htmlFor="req-start">Campaign start</label>
            <input id="req-start" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="req-end">Campaign end</label>
            <input id="req-end" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </div>
        </div>
        <div role="status" aria-label="Request notices" className={outlasts ? "notice" : undefined}>
          {outlasts && engagement ? `Your engagement ends on ${calendarDate(engagement.endsOn)}, so any grant will end by then.` : ""}
        </div>
        <fieldset className="field">
          <legend>Cited rules</legend>
          <div className="check-grid rules-grid">
            {liveRules.map((identifier) => (
              <label key={identifier} className="check">
                <input type="checkbox" checked={cited.includes(identifier)} onChange={() => setCited((list) => toggle(list, identifier))} />
                {identifier}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="req-note">Note</label>
          <textarea id="req-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <Alert message={error} />
        <div className="dialog-actions">
          <Button primary type="submit" pending={pending && "save"}>
            Submit request
          </Button>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
