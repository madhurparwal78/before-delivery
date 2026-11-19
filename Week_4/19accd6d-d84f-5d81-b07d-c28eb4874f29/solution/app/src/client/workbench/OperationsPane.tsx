import { ChevronDown, Search, Star, X } from "lucide-react";
import { forwardRef, useId, useState } from "react";
import type { ChangeEvent, KeyboardEvent, Ref, RefObject } from "react";
import { FAMILIES } from "../../shared/operations/types";
import { OPERATIONS } from "../../shared/operations/catalogue";
import { Modal } from "../ui/Modal";
import { IconButton, TitleBar } from "../ui/Pane";
import { useStore } from "../store";
import { addStep, setFavourites } from "./actions";
import { OperationListbox, stepIndex } from "./OperationListbox";
import { workbench } from "./state";

const FINDER_PREFIX = "finder";

/** The operations whose name holds the text, case-insensitively, in catalogue order. */
export const operationsMatching = (query: string): string[] =>
  OPERATIONS.map((operation) => operation.name).filter((name) => name.toLowerCase().includes(query.toLowerCase()));

function FavouritesDialog({ onClose }: { onClose: () => void }) {
  const favourites = useStore(workbench, (state) => state.favourites);
  const toggle = (name: string): void =>
    setFavourites(favourites.includes(name) ? favourites.filter((item) => item !== name) : [...favourites, name]);
  return (
    <Modal title="Edit favourites" onClose={onClose}>
      <p className="modal-note">Tick the operations to pin above the families.</p>
      <ul className="checklist">
        {OPERATIONS.map((operation) => (
          <li key={operation.name}>
            <label>
              <input type="checkbox" checked={favourites.includes(operation.name)} onChange={() => toggle(operation.name)} />
              <span>{operation.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function Family({ family, open, onToggle }: { family: string; open: boolean; onToggle: () => void }) {
  const bodyId = useId();
  const [active, setActive] = useState(-1);
  const names = OPERATIONS.filter((operation) => operation.family === family).map((operation) => operation.name);
  return (
    <div className="family" data-open={open}>
      <button type="button" className="family-header" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        {family}
        <ChevronDown size={18} aria-hidden="true" className="chevron" />
      </button>
      <div className="family-body" id={bodyId}>
        <div className="family-body-inner">
          <OperationListbox label={family} operations={names} active={active} onActive={setActive} onChoose={addStep} />
        </div>
      </div>
    </div>
  );
}

const Finder = forwardRef(function Finder(
  { query, onQuery, active, onActive, onChoose, listId }: {
    query: string; onQuery: (value: string) => void; active: number; onActive: (index: number) => void;
    onChoose: (operation: string) => void; listId: string | null;
  },
  ref: Ref<HTMLInputElement>,
) {
  const results = operationsMatching(query);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (query === "") return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onActive(stepIndex(active, event.key === "ArrowDown" ? 1 : -1, results.length));
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && active >= 0 && results[active]) {
      event.preventDefault();
      onChoose(results[active]);
      event.currentTarget.select();
    }
  };
  return (
    <div className="finder">
      <Search size={18} aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        aria-label="Find operation"
        placeholder="Search…"
        autoComplete="off"
        spellCheck={false}
        value={query}
        aria-activedescendant={listId && active >= 0 ? `${listId}-option-${active}` : undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onQuery(event.target.value);
          onActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
});

export function OperationsPane({ finderRef }: { finderRef: RefObject<HTMLInputElement | null> }) {
  const favourites = useStore(workbench, (state) => state.favourites);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [openFamily, setOpenFamily] = useState<string | null>("Encoding");
  const [editing, setEditing] = useState(false);
  const [favouriteActive, setFavouriteActive] = useState(-1);
  const results = operationsMatching(query);
  const searching = query !== "";
  const chooseResult = (operation: string): void => {
    addStep(operation);
    finderRef.current?.focus();
    finderRef.current?.select();
  };
  return (
    <section role="region" aria-label="Operations" tabIndex={-1} className="pane operations">
      <TitleBar title="Operations">
        <IconButton label="Clear search" tabIndex={-1} disabled={!searching} onClick={() => setQuery("")}>
          <X size={20} aria-hidden="true" />
        </IconButton>
      </TitleBar>
      <Finder
        ref={finderRef}
        query={query}
        onQuery={setQuery}
        active={active}
        onActive={setActive}
        onChoose={addStep}
        listId={searching ? FINDER_PREFIX : null}
      />
      <div className="pane-body operations-body">
        {searching ? (
          <OperationListbox
            label="Operations"
            operations={results}
            active={active}
            onActive={setActive}
            onChoose={chooseResult}
            idPrefix={FINDER_PREFIX}
          />
        ) : (
          <>
            <div className="favourites-row">
              <span>Favourites</span>
              <IconButton label="Edit favourites" onClick={() => setEditing(true)}>
                <Star size={22} aria-hidden="true" fill="currentColor" />
              </IconButton>
            </div>
            <OperationListbox label="Favourites" operations={favourites} active={favouriteActive} onActive={setFavouriteActive} onChoose={addStep} />
            {FAMILIES.map((family) => (
              <Family key={family} family={family} open={openFamily === family} onToggle={() => setOpenFamily(openFamily === family ? null : family)} />
            ))}
          </>
        )}
      </div>
      <div className="status-strip">{searching ? `${results.length} of ${OPERATIONS.length} operations` : `${OPERATIONS.length} operations`}</div>
      {editing && <FavouritesDialog onClose={() => setEditing(false)} />}
    </section>
  );
}
