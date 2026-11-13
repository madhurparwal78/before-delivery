import type { KeyboardEvent } from 'react';
import { findCount } from '../../../shared/copy.ts';
import { useSceneSlice, useSceneStore } from '../../store/index.ts';
import { Button } from '../../ui/index.ts';
import { useFocusTarget } from '../focusTargets.tsx';

/** `search "Find"` over the drawing's top edge: `searchbox "Find text"`, `status "Find count"`, `button "Next match"`. */
export function FindBar() {
  const store = useSceneStore();
  const find = useSceneSlice((snapshot) => snapshot.find);
  const focusRef = useFocusTarget('find');
  if (!find.open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      store.nextMatch();
    }
  }

  return (
    <div className="chip search" role="search" aria-label="Find">
      <input
        ref={focusRef}
        className="field"
        type="search"
        aria-label="Find text"
        autoComplete="off"
        value={find.query}
        onChange={(event) => store.setFindQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="chip-text" role="status" aria-label="Find count">{findCount(find.index + 1, find.matches.length)}</span>
      <Button onClick={() => store.nextMatch()}>Next match</Button>
    </div>
  );
}
