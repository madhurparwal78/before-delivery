// A listed exchange's public page; a withdrawn listing answers gone.
import { useResource } from "../hooks";
import { Heading, Link } from "../router";
import { Icon } from "../ui/Icon";
import { Fig } from "../ui/Table";
import type { Exchange, Jurisdiction } from "../types";
import { NetworkBand, PublicPage, REGION_LABELS, STATUS_LABELS } from "./chrome";
import { NotFoundContent } from "./NotFound";

export function ExchangePage({ slug }: { slug: string }) {
  const [loaded] = useResource<{ exchange: Exchange }>(`/api/public/exchanges/${encodeURIComponent(slug)}`);
  if (loaded.state === "failed" && loaded.status === 410) {
    return (
      <PublicPage>
        <section class="public-section notice">
          <Icon name="ring" size={28} />
          <Heading>Listing withdrawn</Heading>
          <p class="muted">{loaded.error.message}</p>
          <Link href="/" class="button button-quiet">Go to the directory</Link>
        </section>
      </PublicPage>
    );
  }
  if (loaded.state === "failed") return <PublicPage><NotFoundContent /></PublicPage>;
  return (
    <PublicPage>
      <NetworkBand compact />
      {loaded.state === "loading"
        ? <section class="public-section"><div class="skeleton" aria-busy="true"><span /><span /><span /></div></section>
        : <ExchangeDetail exchange={loaded.data.exchange} />}
    </PublicPage>
  );
}

function ExchangeDetail({ exchange }: { exchange: Exchange }) {
  const [jurisdiction] = useResource<{ jurisdiction: Jurisdiction }>(`/api/public/jurisdictions/${exchange.jurisdictionCode}`);
  const name = jurisdiction.state === "ready" ? jurisdiction.data.jurisdiction.name : exchange.jurisdictionCode;
  return (
    <section class="public-section">
      <p class="crumbs"><Link href="/" class="crumb-link">Directory</Link> <span aria-hidden="true">/</span> <span>Listed exchange</span></p>
      <Heading>{exchange.name}</Heading>
      <section class="panel detail-panel" aria-labelledby="exchange-details">
        <h2 id="exchange-details">Details</h2>
        <dl class="facts">
          <dt>Jurisdiction</dt>
          <dd><Link href={`/jurisdictions/${exchange.jurisdictionCode}`} class="inline-control">{name} <Fig>({exchange.jurisdictionCode})</Fig></Link></dd>
          <dt>Region</dt>
          <dd>{REGION_LABELS[exchange.region]}</dd>
          <dt>Travel Rule</dt>
          <dd><span class={`rule-status rule-${exchange.status}`}>{STATUS_LABELS[exchange.status]}</span></dd>
          <dt>Network</dt>
          <dd>
            <span class={`network network-${exchange.onNetwork ? "on" : "off"}`}>
              <span class="network-dot" aria-hidden="true" />
              {exchange.onNetwork ? "On the network: signed messages" : "Off the network: data request pages by mail"}
            </span>
          </dd>
        </dl>
      </section>
    </section>
  );
}
