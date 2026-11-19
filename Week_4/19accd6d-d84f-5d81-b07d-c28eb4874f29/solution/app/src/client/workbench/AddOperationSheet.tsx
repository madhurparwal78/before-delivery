import { X } from "lucide-react";
import { useRef, useState } from "react";
import type { RefObject } from "react";
import { Modal } from "../ui/Modal";
import { addStep } from "./actions";
import { OperationListbox, stepIndex } from "./OperationListbox";
import { operationsMatching } from "./OperationsPane";

/** The phone's way to add an operation: a bottom sheet with a search field above a list of operation rows. */
export function AddOperationSheet({ onClose, returnFocus }: { onClose: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const results = operationsMatching(query);
  const choose = (operation: string): void => {
    addStep(operation);
    onClose();
  };
  return (
    <Modal title="Add operation" variant="sheet" onClose={onClose} initialFocus={search} returnFocus={returnFocus}>
      <div className="sheet-head">
        <input
          ref={search}
          type="search"
          aria-label="Search operations"
          placeholder="Search…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(stepIndex(active, event.key === "ArrowDown" ? 1 : -1, results.length));
            } else if (event.key === "Enter" && active >= 0 && results[active]) {
              event.preventDefault();
              choose(results[active]);
            }
          }}
        />
        <button type="button" className="sheet-close" onClick={onClose}>
          <X size={18} aria-hidden="true" />
          <span>Close</span>
        </button>
      </div>
      <div className="sheet-list">
        <OperationListbox label="Operation sheet" operations={results} active={active} onActive={setActive} onChoose={choose} />
      </div>
    </Modal>
  );
}
