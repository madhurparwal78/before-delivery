// A jurisdiction's public page: its rule in force and any announced change, next to its listed exchanges.
import { useResource } from "../hooks";
import { Heading, Link } from "../router";
import { Icon } from "../ui/Icon";
import { Empty, Fig } from "../ui/Table";
import type { Exchange, Jurisdiction } from "../types";
import { formatDate, formatMoney } from "../../shared/format";
import { NetworkBand, PublicPage, REGION_LABELS, STATUS_LABELS } from "./chrome";
import { NotFoundContent } from "./NotFound";

export function JurisdictionPage({ code }: { code: string }) {
  const [loaded] = useResource<{ jurisdiction: Jurisdiction; exchanges: Exchange[] }>(`/api/public/jurisdictions/${encodeURIComponent(code)}`);
  if (loaded.state === "failed") return <PublicPage><NotFoundContent /></PublicPage>;
  return (
    <PublicPage>
      <NetworkBand compact />
      {loaded.state === "loading" ? (
        <section class="public-section"><div class="skeleton" aria-busy="true"><span /><span /><span /></div></section>
      ) : (
        <JurisdictionDetail j={loaded.data.jurisdiction} exchanges={loaded.data.exchanges} />
      )}
    </PublicPage>
  );
}

function JurisdictionDetail({ j, exchanges }: { j: Jurisdiction; exchanges: Exchange[] }) {
  return (
    <section class="public-section">
      <p class="crumbs"><Link href="/" class="crumb-link">Directory</Link> <span aria-hidden="true">/</span> <span class="fig">{j.code}</span></p>
      <Heading>{j.name}</Heading>
      <div class="detail-grid">
        <section class="panel" aria-labelledby="rule-heading">
          <h2 id="rule-heading">Travel Rule</h2>
          <dl class="facts">
            <dt>Status</dt>
            <dd><span class={`rule-status rule-${j.status}`}>{STATUS_LABELS[j.status]}</span></dd>
            <dt>Region</dt>
            <dd>{REGION_LABELS[j.region]}</dd>
            <dt>Threshold</dt>
            <dd>{j.thresholdCents !== null ? <Fig>{formatMoney(j.currency, j.thresholdCents)}</Fig> : <span class="muted">No rule in force</span>}</dd>
            <dt>In force since</dt>
            <dd>{j.inForceSince ? <Fig>{formatDate(j.inForceSince)}</Fig> : <span class="muted">Not in force</span>}</dd>
            <dt>Announced change</dt>
            <dd>{j.announcedChange
              ? <span><Fig>{formatMoney(j.currency, j.announcedChange.thresholdCents)}</Fig> from <Fig>{formatDate(j.announcedChange.takesEffectOn)}</Fig></span>
              : <span class="muted">None announced</span>}</dd>
          </dl>
        </section>
        <section class="panel" aria-labelledby="exchanges-heading">
          <h2 id="exchanges-heading">Listed exchanges</h2>
          <ul class="link-list" aria-label={`Exchanges listed in ${j.name}`}>
            {exchanges.map((e) => (
              <li key={e.slug}>
                <Link href={`/exchanges/${e.slug}`} class="card-link">
                  <span class="card-name">{e.name}</span>
                  <span class="muted network-text">{e.onNetwork ? "On the network" : "Off the network"}</span>
                  <Icon name="chevron" size={18} />
                </Link>
              </li>
            ))}
          </ul>
          {exchanges.length === 0 && <Empty />}
        </section>
      </div>
    </section>
  );
}
