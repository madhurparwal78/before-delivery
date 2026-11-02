import { enc, TAGS, type Tag } from "../lib.ts";
import { Glyph, Glyphs, Icon, IdText } from "../ui.tsx";
import type { AssetDetail, ColumnRead } from "./types.ts";

export type TagAction = "tag" | "withdraw" | "suppress" | "lift";

/** The tag controls a column shows for one tag, in the DP-37 replacement order. */
export function tagControls(column: ColumnRead, tag: Tag): { action: TagAction; label: string }[] {
  const out: { action: TagAction; label: string }[] = [];
  const effective = column.effective_tags.includes(tag);
  const direct = column.direct_tags.includes(tag);
  const suppressed = column.suppressed_tags.includes(tag);
  if (direct) out.push({ action: "withdraw", label: `Withdraw ${tag}` });
  if (!effective && !suppressed) out.push({ action: "tag", label: `Tag ${tag}` });
  if (effective && !direct) out.push({ action: "suppress", label: `Suppress ${tag}` });
  if (suppressed) out.push({ action: "lift", label: `Lift ${tag} suppression` });
  return out;
}

const ORDER: Tag[] = ["Confidential", "PII"];

interface AssetProps {
  asset: AssetDetail;
  live: boolean;
  curate: boolean;
  admin: boolean;
  canDownload: boolean;
  selected: Set<string>;
  bulkTag: Tag;
  onSelect(name: string, checked: boolean): void;
  onBulkTag(tag: Tag): void;
  onApply(): void;
  onOpenColumn(columnId: string): void;
  onCertify(kind: "verify" | "deprecate" | "reinstate"): void;
  onUpstream(assetId: string): void;
}

export function AssetPane(p: AssetProps) {
  const a = p.asset;
  const bulk = p.curate && p.live;
  return (
    <section class="asset-detail" aria-label="Asset detail" role="region">
      <h2 id="asset-heading" class="asset-heading" aria-label={a.id} tabIndex={-1} data-focus-key="asset-heading"><IdText id={a.id} /></h2>
      <dl class="facts">
        <div><dt>Kind</dt><dd>{a.kind}</dd></div>
        <div><dt>Owner</dt><dd>{a.owner.name}</dd></div>
        <div><dt>State</dt><dd><span class={`state state-${a.state}`}>{a.state}</span></dd></div>
        <div><dt>Terms</dt><dd>{a.terms.length ? a.terms.map((t) => t.name).join(", ") : "None"}</dd></div>
        <div class="facts-wide"><dt>Description</dt><dd class="wrap">{a.description}</dd></div>
        <div class="facts-wide"><dt>Tagged columns</dt>
          <dd class="counts">
            <span class="count-pair">Tagged <span class="mono">{a.tagged_column_count}</span></span>
            <span class="count-pair"><Glyph tag="PII" /><span class="mono">{a.pii_column_count}</span></span>
            <span class="count-pair"><Glyph tag="Confidential" /><span class="mono">{a.confidential_column_count}</span></span>
          </dd>
        </div>
      </dl>
      {a.deprecated_upstream && (
        <div role="note" aria-label="Deprecated upstream" class="warning">
          {"Upstream "}
          <a href={`/catalog?asset=${enc(a.deprecated_upstream)}`} class="mono" onClick={(e) => (e.preventDefault(), p.onUpstream(a.deprecated_upstream!))}>
            {a.deprecated_upstream}
          </a>
          {" is deprecated. Values here may stop updating."}
        </div>
      )}
      {a.evidence && (
        <div class="evidence">
          {p.canDownload && p.live && (
            <a class="evidence-link wrap" href={`/api/assets/${enc(a.id)}/evidence`} download={a.evidence.filename} aria-label={`Download evidence ${a.evidence.filename}`}>
              <Icon name="download" />
              <span>{a.evidence.filename}</span>
            </a>
          )}
          {(!p.canDownload || !p.live) && <span class="wrap">{a.evidence.filename}</span>}
          <span class="sha mono wrap">{`SHA-256 ${a.evidence.sha256}`}</span>
        </div>
      )}
      {p.curate && p.live && (
        <div class="cert-actions">
          {a.state === "draft" && <button type="button" class="btn btn-ink" data-focus-key="cert-verify" onClick={() => p.onCertify("verify")}>Verify</button>}
          {(a.state === "draft" || a.state === "verified") && (
            <button type="button" class="btn btn-quiet" data-focus-key="cert-deprecate" onClick={() => p.onCertify("deprecate")}>Deprecate</button>
          )}
          {a.state === "deprecated" && p.admin && (
            <button type="button" class="btn btn-quiet" data-focus-key="cert-reinstate" onClick={() => p.onCertify("reinstate")}>Reinstate</button>
          )}
        </div>
      )}
      {bulk && (
        <div class="bulk-bar">
          <label class="bulk-label" for="bulk-tag">Tag to apply</label>
          <select id="bulk-tag" data-focus-key="bulk" value={p.bulkTag} onChange={(e) => p.onBulkTag(e.currentTarget.value as Tag)}>
            <option value="PII">PII</option>
            <option value="Confidential">Confidential</option>
          </select>
          <button type="button" class="btn btn-ink" id="bulk-apply" data-focus-key="bulk" onClick={p.onApply}>Apply tag to selected</button>
        </div>
      )}
      <div role="table" aria-label="Columns" class={`table columns-table${bulk ? " with-select" : ""}`}>
        <div role="rowgroup" class="thead">
          <div role="row" class="tr">
            {bulk && <span role="columnheader">Select</span>}
            <span role="columnheader">Name</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Tags</span>
            <span role="columnheader">Samples</span>
          </div>
        </div>
        <div role="rowgroup">
          {a.columns.map((c) => (
            <div role="row" class="tr" key={c.id}>
              {bulk && (
                <span role="cell" data-label="Select" class="cell-select">
                  <label class="check-hit">
                    <input type="checkbox" aria-label={`Select ${c.name}`} checked={p.selected.has(c.id)}
                      onChange={(e) => p.onSelect(c.id, e.currentTarget.checked)} />
                  </label>
                </span>
              )}
              <span role="cell" data-label="Name">
                <button type="button" class="col-open wrap" data-focus-key={`col-${c.id}`} onClick={() => p.onOpenColumn(c.id)}>{c.name}</button>
              </span>
              <span role="cell" data-label="Type" class="mono cell-type">{c.data_type}</span>
              <span role="cell" data-label="Tags"><Glyphs tags={c.effective_tags} /></span>
              <span role="cell" data-label="Samples" class="mono">
                <span class="samples">
                  {c.samples.map((s, i) => <span key={i} class="sample wrap">{s}</span>)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ColumnProps {
  column: ColumnRead;
  controls: boolean;
  onAction(action: TagAction, tag: Tag): void;
}

export function ColumnPane({ column: c, controls, onAction }: ColumnProps) {
  const inherited = c.effective_tags.filter((t) => !c.direct_tags.includes(t));
  return (
    <section class="column-detail" role="region" aria-label="Column detail">
      <h3 id="column-heading" class="column-heading" aria-label={c.id} tabIndex={-1}><IdText id={c.id} /></h3>
      <dl class="facts">
        <div><dt>Direct tags</dt><dd>{c.direct_tags.length ? <><Glyphs tags={c.direct_tags} /> {c.direct_tags.join(", ")}</> : "None"}</dd></div>
        <div><dt>Inherited tags</dt><dd>{inherited.length ? <><Glyphs tags={inherited} /> {inherited.join(", ")}</> : "None"}</dd></div>
        <div><dt>Suppressed</dt><dd>{c.suppressed_tags.join(", ") || "None"}</dd></div>
      </dl>
      <ul aria-label="Tag sources" class="tag-sources">
        {ORDER.filter((t) => c.tag_sources[t]).flatMap((t) =>
          c.tag_sources[t].map((source) => (
            <li key={`${t}-${source}`}>
              {source === c.id ? `${t} set directly` : <>{`${t} inherited from `}<span class="mono">{source}</span></>}
            </li>
          )),
        )}
      </ul>
      {controls && (
        <div class="tag-controls">
          {TAGS.flatMap((tag) =>
            tagControls(c, tag).map((ctl) => (
              <button key={ctl.label} type="button" class="btn btn-quiet" data-focus-key={`ctl-${ctl.label}`} onClick={() => onAction(ctl.action, tag)}>
                {ctl.label}
              </button>
            )),
          )}
        </div>
      )}
      <div class="column-samples">
        <span class="field-label">Samples</span>
        <ul class="samples-list mono">
          {c.samples.map((s, i) => <li key={i} class="wrap">{s}</li>)}
        </ul>
      </div>
    </section>
  );
}
