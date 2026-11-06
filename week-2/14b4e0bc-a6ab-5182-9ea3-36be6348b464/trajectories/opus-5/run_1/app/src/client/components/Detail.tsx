import type { ReactNode } from 'react';
import type { Tag } from '../../shared/domain.ts';
import type { ColumnBody } from '../lib/api.ts';
import { COPY } from '../lib/copy.ts';
import { useAppState } from '../lib/hooks.ts';
import { store } from '../lib/store.ts';
import { TagGlyph } from './glyphs.tsx';

const TAG_ORDER: Tag[] = ['PII', 'Confidential'];

function CertificationActions(): ReactNode {
  const state = useAppState();
  const asset = state.asset;
  if (asset === null || !store.canWrite()) return null;
  const role = state.session?.role;
  return (
    <div className="actions">
      {asset.state === 'draft' ? (
        <button type="button" data-focus-key="verify-button" onClick={() => store.openVerifyDialog()}>
          Verify
        </button>
      ) : null}
      {asset.state === 'draft' || asset.state === 'verified' ? (
        <button
          type="button"
          data-focus-key="deprecate-button"
          onClick={() => store.openDeprecateDialog()}
        >
          Deprecate
        </button>
      ) : null}
      {asset.state === 'deprecated' && role === 'Admin' ? (
        <button
          type="button"
          data-focus-key="reinstate-button"
          onClick={() => store.openReinstateDialog()}
        >
          Reinstate
        </button>
      ) : null}
    </div>
  );
}

function ColumnsTable(): ReactNode {
  const state = useAppState();
  const asset = state.asset;
  if (asset === null) return null;
  const writable = store.canWrite();
  return (
    <table role="table" aria-label="Columns" className="columns-table">
      <thead role="rowgroup">
        <tr role="row">
          {writable ? (
            <th role="columnheader" scope="col">
              Select
            </th>
          ) : null}
          <th role="columnheader" scope="col">
            Name
          </th>
          <th role="columnheader" scope="col">
            Type
          </th>
          <th role="columnheader" scope="col">
            Tags
          </th>
          <th role="columnheader" scope="col">
            Samples
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {asset.columns.map((column) => (
          <tr role="row" key={column.id} className="column-row">
            {writable ? (
              <td role="cell">
                <span className="cell-label">Select</span>
                <input
                  type="checkbox"
                  aria-label={`Select ${column.name}`}
                  checked={state.selectedColumns.includes(column.id)}
                  onChange={() => store.toggleColumnSelection(column.id)}
                />
              </td>
            ) : null}
            <td role="cell">
              <span className="cell-label">Name</span>
              <button
                type="button"
                className="column-name"
                data-focus-key={`column-row:${column.id}`}
                onClick={() => store.openColumn(column.id)}
              >
                {column.name}
              </button>
            </td>
            <td role="cell">
              <span className="cell-label">Type</span>
              <span className="mono">{column.data_type}</span>
            </td>
            <td role="cell">
              <span className="cell-label">Tags</span>
              {column.effective_tags.map((tag) => (
                <TagGlyph key={tag} tag={tag} />
              ))}
            </td>
            <td role="cell">
              <span className="cell-label">Samples</span>
              {column.samples.slice(0, 3).map((sample, index) => (
                <span className="mono sample" key={`${column.id}-${index}`}>
                  {sample}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BulkTagBar(): ReactNode {
  const state = useAppState();
  if (!store.canWrite()) return null;
  return (
    <div className="bulk-bar">
      <label htmlFor="bulk-tag">Tag to apply</label>
      <select
        id="bulk-tag"
        value={state.bulkTag}
        onChange={(event) => store.setBulkTag(event.target.value as Tag)}
      >
        {TAG_ORDER.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-focus-key="apply-bulk"
        onClick={() => void store.applyBulkTag()}
      >
        Apply tag to selected
      </button>
    </div>
  );
}

function tagControls(column: ColumnBody): { label: string; run: () => void }[] {
  const controls: { label: string; run: () => void }[] = [];
  for (const tag of TAG_ORDER) {
    const direct = column.direct_tags.includes(tag);
    const effective = column.effective_tags.includes(tag);
    const suppressed = column.suppressed_tags.includes(tag);
    if (!effective && !suppressed) {
      controls.push({ label: `Tag ${tag}`, run: () => void store.addTag(column.id, tag) });
    }
    if (direct) {
      controls.push({ label: `Withdraw ${tag}`, run: () => void store.withdrawTag(column.id, tag) });
    }
    if (effective && !direct) {
      controls.push({ label: `Suppress ${tag}`, run: () => store.openSuppressDialog(tag) });
    }
    if (suppressed) {
      controls.push({
        label: `Lift ${tag} suppression`,
        run: () => void store.liftSuppression(column.id, tag),
      });
    }
  }
  return controls;
}

function ColumnDetail(): ReactNode {
  const state = useAppState();
  const column = state.column;
  if (column === null) return null;
  const inherited = column.effective_tags.filter((tag) => !column.direct_tags.includes(tag));
  const sourceLines: { tag: Tag; text: string }[] = [];
  for (const tag of column.effective_tags) {
    for (const source of column.tag_sources[tag] ?? []) {
      sourceLines.push({
        tag,
        text: source === column.id ? COPY.tagSourceDirect(tag) : COPY.tagSourceInherited(tag, source),
      });
    }
  }
  return (
    <section role="region" aria-label="Column detail" className="column-detail">
      <h3 tabIndex={-1} data-focus-key="column-heading" className="mono">
        {column.id}
      </h3>
      <p>
        Direct tags:{' '}
        {column.direct_tags.map((tag) => (
          <TagGlyph key={tag} tag={tag} />
        ))}
      </p>
      <p>
        Inherited tags:{' '}
        {inherited.map((tag) => (
          <TagGlyph key={tag} tag={tag} />
        ))}
      </p>
      <p>
        Suppressed tags:{' '}
        {column.suppressed_tags.map((tag) => (
          <span key={tag} className="suppressed mono">
            {tag}
          </span>
        ))}
      </p>
      <ul aria-label="Tag sources" className="tag-sources">
        {sourceLines.map((line, index) => (
          <li key={`${line.tag}-${index}`} className="mono">
            {line.text}
          </li>
        ))}
      </ul>
      {store.canWrite() ? (
        <div className="actions">
          {tagControls(column).map((control) => (
            <button
              key={control.label}
              type="button"
              data-focus-key={`tag:${control.label}`}
              onClick={control.run}
            >
              {control.label}
            </button>
          ))}
        </div>
      ) : null}
      <p className="samples">
        {column.samples.map((sample, index) => (
          <span key={index} className="mono sample">
            {sample}
          </span>
        ))}
      </p>
    </section>
  );
}

/** The detail pane: the asset, its certification, its columns and the open column. */
export function Detail(): ReactNode {
  const state = useAppState();
  const asset = state.asset;
  if (asset === null) return null;
  const showEvidence =
    asset.evidence !== null && state.session?.role !== 'Viewer' && !store.isPointInTime();
  return (
    <section role="region" aria-label="Asset detail" className="detail">
      <h2 tabIndex={-1} data-focus-key="asset-heading" className="asset-heading">
        {asset.id}
      </h2>
      <dl className="asset-facts">
        <dt>Kind</dt>
        <dd>{asset.kind}</dd>
        <dt>Description</dt>
        <dd>{asset.description}</dd>
        <dt>Owner</dt>
        <dd>{asset.owner.name}</dd>
        <dt>Certification</dt>
        <dd>{asset.state}</dd>
        <dt>Terms</dt>
        <dd>{asset.terms.map((term) => term.name).join(', ')}</dd>
        <dt>Columns tagged</dt>
        <dd className="mono">
          {asset.tagged_column_count} <TagGlyph tag="PII" />
          {asset.pii_column_count} <TagGlyph tag="Confidential" />
          {asset.confidential_column_count}
        </dd>
      </dl>
      {asset.deprecated_upstream === null ? null : (
        <div role="note" aria-label="Deprecated upstream" className="note">
          {COPY.deprecatedUpstreamBefore}
          <a
            href={`/catalog?asset=${encodeURIComponent(asset.deprecated_upstream)}`}
            onClick={(event) => {
              event.preventDefault();
              store.openAsset(asset.deprecated_upstream as string);
              store.requestFocus('asset-heading');
            }}
          >
            {asset.deprecated_upstream}
          </a>
          {COPY.deprecatedUpstreamAfter}
        </div>
      )}
      <CertificationActions />
      {showEvidence && asset.evidence !== null ? (
        <p className="evidence">
          <a
            href={`/api/assets/${encodeURIComponent(asset.id)}/evidence`}
            aria-label="Download evidence"
            className="break-anywhere"
          >
            {asset.evidence.filename}
          </a>
          <span className="mono break-anywhere">{asset.evidence.sha256}</span>
        </p>
      ) : null}
      <BulkTagBar />
      <ColumnsTable />
      <ColumnDetail />
    </section>
  );
}
