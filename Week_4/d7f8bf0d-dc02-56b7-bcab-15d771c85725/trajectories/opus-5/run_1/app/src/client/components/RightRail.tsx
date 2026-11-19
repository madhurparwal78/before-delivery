import { useEffect, useState } from 'react';
import type { BlockState, SnapshotBlock } from '../../shared/protocol.js';
import { writeView } from '../lib/viewState.js';
import { useStore } from '../store.js';
import { useRouteChoice } from './RouteChoice.js';

const STATE_WORDS: Record<BlockState, string> = {
  free: 'Free',
  reserved: 'Reserved',
  occupied: 'Occupied',
  out_of_service: 'Out of service',
};

export function RoutePanel(): JSX.Element {
  const { session, view, actions, routePreview, blockResults } = useStore();
  const choice = useRouteChoice();
  const [query, setQuery] = useState('');
  const trainId = view.train;

  useEffect(() => {
    if (!trainId || !choice.destination) {
      actions.clearPreview();
      return;
    }
    actions.previewRoute(trainId, choice.destination, choice.via || null);
  }, [trainId, choice.destination, choice.via, actions]);

  const blocks = session?.blocks ?? [];
  const conflictBlock = blocks.find((block) => block.id === routePreview?.conflict_block_id);

  return (
    <section className="panel" aria-label="Route" data-testid="route-panel">
      <h3>Route</h3>
      <div role="listbox" aria-label="Trains" className="trains-list">
        {(session?.trains ?? []).map((train) => (
          <div
            key={train.id}
            role="option"
            tabIndex={0}
            aria-selected={train.id === trainId}
            aria-label={`Train ${train.number}`}
            className="train-option"
            onClick={() => writeView({ train: train.id })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') writeView({ train: train.id });
            }}
          >
            Train {train.number}
            <span style={{ opacity: 0.7, fontWeight: 400 }}>{train.name}</span>
          </div>
        ))}
      </div>

      <label className="field">
        <span>Destination block</span>
        <select
          value={choice.destination}
          onChange={(event) => choice.setDestination(event.target.value)}
        >
          <option value="">No block</option>
          {blocks.map((block) => (
            <option key={block.id} value={block.id}>
              Block {block.number} {block.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Via block</span>
        <select value={choice.via} onChange={(event) => choice.setVia(event.target.value)}>
          <option value="">No block</option>
          {blocks.map((block) => (
            <option key={block.id} value={block.id}>
              Block {block.number} {block.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Time limit</span>
        <input
          type="number"
          min={1}
          max={720}
          step={1}
          value={choice.timeLimitMinutes}
          onChange={(event) =>
            choice.setTimeLimitMinutes(Number.parseInt(event.target.value, 10) || 60)
          }
        />
      </label>

      <p className="route-preview" data-testid="route-preview">
        {routePreview === null
          ? ''
          : routePreview.clear
            ? `Route: ${routePreview.route_block_ids
                .map(
                  (blockId) => blocks.find((block) => block.id === blockId)?.number ?? '',
                )
                .join(', ')}`
            : `Blocked at Block ${conflictBlock?.number ?? ''} by Train ${
                routePreview.other_train_number ?? ''
              }`}
      </p>

      <CancelAuthorityButton />

      <label className="field">
        <span>Block search</span>
        <input
          type="search"
          role="searchbox"
          aria-label="Block search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            actions.searchBlocks(event.target.value);
          }}
        />
      </label>
      {blockResults.length > 0 ? (
        <div role="listbox" aria-label="Block results" className="trains-list">
          {blockResults.map((block) => (
            <div
              key={block.id}
              role="option"
              tabIndex={0}
              aria-selected={block.id === view.block}
              aria-label={`Block ${block.number} ${block.name}`}
              className="train-option"
              onClick={() => writeView({ block: block.id })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') writeView({ block: block.id });
              }}
            >
              Block {block.number} {block.name}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CancelAuthorityButton(): JSX.Element {
  const { session, view, actions } = useStore();
  const authority = session?.authorities.find(
    (entry) => entry.state === 'Granted' && entry.train_id === view.train,
  );
  return (
    <button
      className="mini"
      disabled={!authority}
      onClick={() => authority && void actions.cancelAuthority(authority.id)}
    >
      Cancel authority
    </button>
  );
}

function RenameDialog({
  block,
  onClose,
}: {
  block: SnapshotBlock;
  onClose: () => void;
}): JSX.Element {
  const { actions } = useStore();
  const [name, setName] = useState(block.name);
  return (
    <div className="modal-centre" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Rename"
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          void actions.renameBlock(block.id, name).then(onClose);
        }}
      >
        <h2>Rename</h2>
        <label className="field">
          <span>New name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="lipped" type="submit">
          Save name
        </button>
        <button className="mini" type="button" onClick={onClose}>
          Close
        </button>
      </form>
    </div>
  );
}

export function BlockSchematic(): JSX.Element {
  const { session, actions, role } = useStore();
  const [renaming, setRenaming] = useState<SnapshotBlock | null>(null);
  const canRename = role === 'founder' || role === 'manager';

  return (
    <section className="panel panel-scroll" style={{ overflowY: 'auto' }}>
      <h3>Blocks</h3>
      <table className="data" aria-label="Block schematic">
        <thead>
          <tr>
            <th>No.</th>
            <th>Name</th>
            <th>State</th>
            <th>Train</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(session?.blocks ?? []).map((block) => (
            <tr key={block.id} data-testid={`block-row-${block.number}`}>
              <td className="figure">{block.number}</td>
              <td>{block.name}</td>
              <td data-testid={`block-state-${block.number}`}>
                <span className={`state-chip state-${block.state}`}>
                  {STATE_WORDS[block.state]}
                </span>
              </td>
              <td className="figure">{block.train_number ?? '—'}</td>
              <td>
                <div className="row-actions">
                  {canRename ? (
                    <button className="mini" onClick={() => setRenaming(block)}>
                      Rename
                    </button>
                  ) : null}
                  <button
                    className="mini"
                    onClick={() =>
                      void actions.setBlockService(
                        block.id,
                        block.state !== 'out_of_service',
                      )
                    }
                  >
                    {block.state === 'out_of_service' ? 'Return to service' : 'Out of service'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {renaming ? <RenameDialog block={renaming} onClose={() => setRenaming(null)} /> : null}
    </section>
  );
}

export function RightRail(): JSX.Element {
  return (
    <div className="right-rail">
      <RoutePanel />
      <BlockSchematic />
    </div>
  );
}
