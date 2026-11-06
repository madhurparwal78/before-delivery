import { type ReactNode, useEffect, useRef, useState } from 'react';
import { COPY, FIELD_COPY, characterCreated } from '../../shared/copy.js';
import {
  APPEARANCES,
  APPEARANCE_NAMES,
  type Appearance,
  ITEM_NAMES,
  LOADOUT_ITEMS,
  type ItemKind,
} from '../../shared/domain.js';
import type { CharacterObject } from '../../shared/types.js';
import { ApiFailure, getWithEtag, patch, post } from '../api.js';
import { useRoster } from '../shell.js';
import { Dialog, ErrorSummary, FieldError, Status, summaryText } from '../ui.js';

export function CharacterPicker({
  characters,
  activeId,
  onPick,
}: {
  characters: readonly CharacterObject[];
  activeId: string | null;
  onPick: (character: CharacterObject) => void;
}): ReactNode {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = 'character-options';

  const filtered = characters.filter((character) =>
    character.name.toLowerCase().startsWith(text.trim().toLowerCase()),
  );
  const chosen = characters.find((character) => character.id === activeId);

  return (
    <div>
      <label htmlFor="character-combobox">Character</label>
      <input
        id="character-combobox"
        type="text"
        role="combobox"
        aria-label="Character"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] !== undefined ? `option-${filtered[active].id}` : undefined}
        value={open ? text : (chosen?.name ?? '')}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const pick = filtered[active];
            if (pick !== undefined) {
              onPick(pick);
              setOpen(false);
              setText('');
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setText('');
            setOpen(false);
          }
        }}
      />
      <ul role="listbox" id={listId} aria-label="Character" hidden={!open}>
        {filtered.map((character, index) => (
          <li
            key={character.id}
            id={`option-${character.id}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(character);
              setOpen(false);
              setText('');
            }}
          >
            {character.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RosterPage({ slug }: { slug: string }): ReactNode {
  /* Picking a character here makes it the active character on the world view. */
  const { characters, activeId, active: selected, pick, reload } = useRoster();
  const [status, setStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>('surveyor');
  const newButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selected !== null) setAppearance(selected.appearance);
  }, [selected]);

  return (
    <div className="page">
      <h1>Characters</h1>
      <button type="button" className="primary" ref={newButton} onClick={() => setDialogOpen(true)}>
        New character
      </button>
      <CharacterPicker
        characters={characters}
        activeId={activeId}
        onPick={(character) => pick(character.id)}
      />
      <div className="roster-layout">
        <ul className="roster-list" aria-label="Roster">
          {characters.map((character) => (
            <li key={character.id} className="card">
              <button type="button" onClick={() => pick(character.id)}>
                {character.name}
              </button>
              <p className="coins mono">{`${character.balance} coins`}</p>
            </li>
          ))}
        </ul>
        <div role="region" aria-label="Character details" className="card">
          {selected !== null ? (
            <>
              <h2 className="card-title">{selected.name}</h2>
              <p>{`Appearance: ${APPEARANCE_NAMES[selected.appearance]}`}</p>
              <p>
                {`Loadout: ${
                  selected.loadout.length === 0
                    ? 'none'
                    : selected.loadout.map((kind) => ITEM_NAMES[kind]).join(', ')
                }`}
              </p>
              <p className="coins mono">{`Coins: ${selected.balance}`}</p>
              <p>{`World: ${selected.world}`}</p>
              <p className="coords mono">{`Tile: ${selected.x}, ${selected.y}`}</p>
              <fieldset role="radiogroup" aria-label="Appearance">
                <legend>Appearance</legend>
                {APPEARANCES.map((option) => (
                  <label className="radio-row" key={option}>
                    <input
                      type="radio"
                      name="appearance"
                      checked={appearance === option}
                      aria-label={APPEARANCE_NAMES[option]}
                      onChange={() => setAppearance(option)}
                    />
                    <span>{APPEARANCE_NAMES[option]}</span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                onClick={() => {
                  void getWithEtag<CharacterObject>(`/api/characters/${selected.id}`)
                    .then((read) =>
                      patch<CharacterObject>(
                        `/api/characters/${selected.id}`,
                        { appearance },
                        read.etag,
                      ),
                    )
                    .then(async () => {
                      setStatus(COPY.appearanceSaved);
                      await reload();
                    })
                    .catch((error: unknown) => {
                      if (error instanceof ApiFailure) {
                        setStatus(
                          error.code === 'precondition_failed'
                            ? COPY.staleVersion
                            : error.message,
                        );
                      }
                    });
                }}
              >
                Save appearance
              </button>
            </>
          ) : null}
        </div>
      </div>
      <Status name="Roster status" text={status} />
      {dialogOpen ? (
        <NewCharacterDialog
          slug={slug}
          onClose={() => setDialogOpen(false)}
          onCreated={async (name) => {
            setDialogOpen(false);
            setStatus(characterCreated(name));
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

const FIELD_ORDER = [
  { field: 'name', targetId: 'new-character-name' },
  { field: 'appearance', targetId: 'new-character-appearance' },
  { field: 'loadout', targetId: 'new-character-loadout' },
];

function NewCharacterDialog({
  slug,
  onClose,
  onCreated,
}: {
  slug: string;
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState<Appearance | ''>('');
  const [loadout, setLoadout] = useState<ItemKind[]>([]);
  const [focusedItem, setFocusedItem] = useState(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const nameField = useRef<HTMLInputElement>(null);

  const toggle = (kind: ItemKind): void => {
    setLoadout((current) => {
      if (current.includes(kind)) return current.filter((item) => item !== kind);
      if (current.length >= 3) {
        setStatus(FIELD_COPY.loadoutTooMany);
        return current;
      }
      setStatus('');
      return [...current, kind];
    });
  };

  return (
    <Dialog label="New character" onClose={onClose} initialFocus={nameField}>
      <h2>New character</h2>
      <div>
        <label htmlFor="new-character-name">Name</label>
        <input
          id="new-character-name"
          type="text"
          aria-label="Name"
          ref={nameField}
          value={name}
          aria-describedby={fields.name === undefined ? undefined : 'new-character-name-error'}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError id="new-character-name-error" message={fields.name ?? ''} />
      </div>
      <fieldset role="radiogroup" aria-label="Appearance" id="new-character-appearance" tabIndex={-1}>
        <legend>Appearance</legend>
        {APPEARANCES.map((option) => (
          <label className="radio-row" key={option}>
            <input
              type="radio"
              name="new-appearance"
              checked={appearance === option}
              aria-label={APPEARANCE_NAMES[option]}
              onChange={() => setAppearance(option)}
            />
            <span>{APPEARANCE_NAMES[option]}</span>
          </label>
        ))}
        <FieldError id="new-character-appearance-error" message={fields.appearance ?? ''} />
      </fieldset>
      <ul
        role="listbox"
        aria-label="Loadout"
        aria-multiselectable="true"
        id="new-character-loadout"
        tabIndex={0}
        aria-activedescendant={`loadout-${LOADOUT_ITEMS[focusedItem]}`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setFocusedItem((index) => Math.min(index + 1, LOADOUT_ITEMS.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setFocusedItem((index) => Math.max(0, index - 1));
          } else if (event.key === ' ') {
            event.preventDefault();
            toggle(LOADOUT_ITEMS[focusedItem]);
          }
        }}
      >
        {LOADOUT_ITEMS.map((kind, index) => (
          <li
            key={kind}
            id={`loadout-${kind}`}
            role="option"
            aria-selected={loadout.includes(kind)}
            className={index === focusedItem ? 'radio-row carrying' : 'radio-row'}
            onMouseDown={(event) => {
              event.preventDefault();
              setFocusedItem(index);
              toggle(kind);
            }}
          >
            {`${loadoutLabel(kind)}${loadout.includes(kind) ? ' (chosen)' : ''}`}
          </li>
        ))}
      </ul>
      <FieldError id="new-character-loadout-error" message={fields.loadout ?? ''} />
      <button
        type="button"
        className="primary"
        onClick={() => {
          setFields({});
          setStatus('');
          void post<{ character: CharacterObject }>(`/api/servers/${slug}/characters`, {
            name,
            appearance,
            loadout,
          })
            .then((answer) => onCreated(answer.character.name))
            .catch((error: unknown) => {
              if (!(error instanceof ApiFailure)) return;
              if (error.code === 'validation') {
                setFields(error.fields);
                setStatus(summaryText(['name', 'appearance', 'loadout'], error.fields));
                const first = FIELD_ORDER.find((entry) => error.fields[entry.field] !== undefined);
                if (first !== undefined) document.getElementById(first.targetId)?.focus();
              } else if (error.code === 'roster_full') {
                setStatus(COPY.rosterFull);
              } else if (error.code === 'character_limit') {
                setStatus(error.message);
              } else {
                setStatus(error.message);
              }
            });
        }}
      >
        Create
      </button>
      {Object.keys(fields).length > 0 ? (
        <ErrorSummary
          name="New character status"
          order={FIELD_ORDER}
          fields={fields}
        />
      ) : (
        <Status name="New character status" text={status} />
      )}
    </Dialog>
  );
}

const LOADOUT_LABELS: Readonly<Record<ItemKind, string>> = {
  compass: 'Compass',
  rope: 'Rope',
  lantern: 'Lantern',
  trowel: 'Trowel',
  whistle: 'Whistle',
  map_case: 'Map case',
  wood: 'Wood',
  stone: 'Stone',
  brick: 'Brick',
  glass: 'Glass',
  fence: 'Fence',
  signpost: 'Signpost',
  window: 'Window',
  milestone: 'Milestone',
};

const loadoutLabel = (kind: ItemKind): string => LOADOUT_LABELS[kind];
