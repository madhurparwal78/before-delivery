// The workspace's public directory listing: withdraw it or list it again.
import { useState } from "preact/hooks";
import { api } from "../api";
import { useResource } from "../hooks";
import { Heading } from "../router";
import { say } from "../store";
import { ActionNote, Button } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Fig } from "../ui/Table";
import { useDesk } from "./desk";

interface Listing {
  slug: string;
  listed: boolean;
}

const LISTING = "listing";

export function ListingScreen() {
  const desk = useDesk();
  const [loaded] = useResource<{ listing: Listing }>(`/api${desk.base}/listing`);
  const [saved, setSaved] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const listing = saved ?? (loaded.state === "ready" ? loaded.data.listing : null);

  const toggle = async (listed: boolean) => {
    say(LISTING, "Saving…", "pending");
    setBusy(true);
    const result = await api<{ listing: Listing }>("PUT", `/api${desk.base}/listing`, { json: { listed } });
    setBusy(false);
    if (result.ok) {
      setSaved(result.data.listing);
      say(LISTING, listed ? "Listed again." : "Listing withdrawn.", "success");
    } else {
      say(LISTING, result.error.message, "refusal");
    }
  };

  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Directory listing</Heading>
          <p class="lede">Whether {desk.workspace.legalName} appears in the public directory, its search and the sitemap.</p>
        </div>
        {!listing ? <div class="skeleton" aria-busy="true"><span /><span /><span /></div> : (
          <div class="panel listing-panel">
            <p class={`listing-state${listing.listed ? " is-listed" : ""}`}>
              <Icon name={listing.listed ? "listing" : "ring"} />
              <span>{listing.listed ? "Listed in the public directory." : "Not listed."}</span>
            </p>
            <dl class="facts">
              <dt>Public page</dt>
              <dd>{listing.listed ? <a class="link-control" href={`/exchanges/${listing.slug}`}><Fig>/exchanges/{listing.slug}</Fig></a> : <Fig>/exchanges/{listing.slug}</Fig>}</dd>
            </dl>
            <p class="field-hint">
              {listing.listed
                ? "Withdrawing removes the exchange from the directory, search and sitemap; its page answers that the listing was withdrawn."
                : "Listing again puts the exchange back in the directory, search and sitemap at once."}
            </p>
            <div class="form-actions">
              {listing.listed
                ? <Button variant="danger" disabled={busy} onClick={() => toggle(false)}>Withdraw listing</Button>
                : <Button variant="primary" disabled={busy} onClick={() => toggle(true)}>List again</Button>}
            </div>
            <ActionNote action={LISTING} />
          </div>
        )}
      </section>
    </div>
  );
}
