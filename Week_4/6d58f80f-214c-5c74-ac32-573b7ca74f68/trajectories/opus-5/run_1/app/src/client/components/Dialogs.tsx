import { useEffect, useState } from 'react';
import type { Folder, Grant, Person, Role } from '../../shared/types.js';
import { ApiFailure, api } from '../lib/api.js';
import {
  GENERIC_FAILURE,
  accessChanged,
  accessRemoved,
  dateRangeError,
  grantExists,
  handoverOpen,
  sharedWith,
} from '../../shared/copy.js';
import { announce } from '../lib/store.js';
import { onServerEvent } from '../lib/events.js';
import { FolderTree } from './FolderTree.js';
import { Modal } from './Modal.js';
import { PeoplePicker } from './PeoplePicker.js';

interface MoveDialogProps {
  folders: Folder[];
  onMove: (folderId: string) => void;
  onClose: () => void;
}

export const MoveDialog = ({ folders, onMove, onClose }: MoveDialogProps): JSX.Element => {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Modal label="Move to" onClose={onClose}>
      <h2>Move to</h2>
      <div className="destination-tree">
        <FolderTree
          label="Destination folders"
          folders={folders}
          openFolderId={chosen}
          onPick={setChosen}
          onOpen={onMove}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (chosen !== null) onMove(chosen);
          }}
        >
          Move here
        </button>
      </div>
    </Modal>
  );
};

interface NameDialogProps {
  label: string;
  fieldLabel: string;
  submitLabel: string;
  initial: string;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export const NameDialog = ({
  label,
  fieldLabel,
  submitLabel,
  initial,
  error,
  onSubmit,
  onClose,
}: NameDialogProps): JSX.Element => {
  const [name, setName] = useState(initial);
  return (
    <Modal label={label} onClose={onClose}>
      <h2>{label}</h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <div className="field">
          <label htmlFor="name-field">{fieldLabel}</label>
          <input
            id="name-field"
            type="text"
            aria-label={fieldLabel}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {error === null ? null : <p className="field-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface ShareDialogProps {
  itemType: 'folder' | 'file';
  itemId: string;
  itemName: string;
  onClose: () => void;
}

export const ShareDialog = ({
  itemType,
  itemId,
  itemName,
  onClose,
}: ShareDialogProps): JSX.Element => {
  const [person, setPerson] = useState<Person | null>(null);
  const [role, setRole] = useState<Role>('viewer');
  const [endDate, setEndDate] = useState('');
  const [range, setRange] = useState<{ today: string; max: string } | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const loadGrants = (): void => {
    void api
      .grants(itemType, itemId)
      .then((found) => setGrants(found.grants))
      .catch(() => undefined);
  };

  useEffect(() => {
    void api
      .grantDefaults()
      .then((defaults) => {
        setEndDate(defaults.defaultEndDate);
        setRange({ today: defaults.today, max: defaults.maxEndDate });
      })
      .catch(() => undefined);
    loadGrants();
    return onServerEvent((event) => {
      if (event.type === 'grants_changed' && event.data.itemId === itemId) loadGrants();
    });
  }, [itemId, itemType]);

  const submit = async (): Promise<void> => {
    if (person === null) return;
    setError(null);
    try {
      const created = await api.share({
        itemType,
        itemId,
        personId: person.id,
        role,
        endDate,
      });
      announce(sharedWith(itemName, person.name, created.grant.endDate));
      setPerson(null);
      setRole('viewer');
      setPickerKey((value) => value + 1);
      loadGrants();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'grant_exists') {
        announce(grantExists(person.name, itemName));
        loadGrants();
        return;
      }
      if (failure instanceof ApiFailure && failure.status === 422) {
        const message =
          Object.values(failure.fields)[0] ??
          (range === null ? GENERIC_FAILURE : dateRangeError(range.today, range.max));
        setError(message);
        announce(message);
        return;
      }
      announce(GENERIC_FAILURE);
    }
  };

  return (
    <Modal label={`Share ${itemName}`} onClose={onClose}>
      <h2>Share {itemName}</h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PeoplePicker
          key={pickerKey}
          label="Person"
          kind="partner"
          value={person}
          onPick={setPerson}
        />
        <fieldset role="radiogroup" aria-label="Access" className="field">
          <legend>Access</legend>
          {(['viewer', 'editor'] as const).map((option) => (
            <label className="radio-pill" key={option}>
              <input
                type="radio"
                name="access"
                aria-label={option === 'viewer' ? 'Viewer' : 'Editor'}
                checked={role === option}
                onChange={() => setRole(option)}
              />
              {option === 'viewer' ? 'Viewer' : 'Editor'}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="access-ends">Access ends</label>
          <input
            id="access-ends"
            type="date"
            aria-label="Access ends"
            value={endDate}
            min={range?.today}
            max={range?.max}
            onChange={(event) => setEndDate(event.target.value)}
          />
          {error === null ? null : <p className="field-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Share
          </button>
        </div>
      </form>
      <h3>People with access</h3>
      <ul className="access-list" aria-label="People with access">
        {grants.map((grant) => (
          <li key={grant.id}>
            <span>
              {grant.person.name} — {grant.person.firm}
            </span>
            <span className="num">Ends {grant.endDate}</span>
            <label>
              <span className="visually-hidden">Access for {grant.person.name}</span>
              <select
                aria-label={`Access for ${grant.person.name}`}
                value={grant.role}
                onChange={(event) => {
                  const next = event.target.value as Role;
                  void api
                    .changeGrant(grant.id, { role: next })
                    .then(() => {
                      announce(accessChanged(grant.person.name, next, itemName));
                      loadGrants();
                    })
                    .catch(() => announce(GENERIC_FAILURE));
                }}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void api
                  .removeGrant(grant.id)
                  .then(() => {
                    announce(accessRemoved(grant.person.name, itemName));
                    loadGrants();
                  })
                  .catch(() => announce(GENERIC_FAILURE));
              }}
            >
              Remove {grant.person.name}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

interface HandoverDialogProps {
  folder: Folder;
  onClose: () => void;
  onOffered: () => void;
}

export const HandoverDialog = ({
  folder,
  onClose,
  onOffered,
}: HandoverDialogProps): JSX.Element => {
  const [person, setPerson] = useState<Person | null>(null);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (person === null) return;
    try {
      const offered = await api.offerHandover({
        folderId: folder.id,
        toPersonId: person.id,
        days,
      });
      announce(`Offered ${folder.name} to ${person.name} until ${offered.handover.lapseDate}`);
      onOffered();
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'handover_open') {
        const message = handoverOpen(folder.name);
        setError(message);
        announce(message);
        return;
      }
      if (failure instanceof ApiFailure && failure.status === 422) {
        const message = Object.values(failure.fields)[0] ?? GENERIC_FAILURE;
        setError(message);
        announce(message);
        return;
      }
      announce(GENERIC_FAILURE);
    }
  };

  return (
    <Modal label={`Hand over ${folder.name}`} onClose={onClose}>
      <h2>Hand over {folder.name}</h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PeoplePicker
          label="New owner"
          kind="staff"
          excludeIds={[folder.owner.id]}
          value={person}
          onPick={setPerson}
        />
        <div className="field">
          <label htmlFor="days-to-accept">Days to accept</label>
          <input
            id="days-to-accept"
            type="number"
            aria-label="Days to accept"
            min={1}
            max={14}
            step={1}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          />
          {error === null ? null : <p className="field-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Offer
          </button>
        </div>
      </form>
    </Modal>
  );
};

interface DeleteConfirmProps {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const DeleteConfirm = ({ name, onConfirm, onClose }: DeleteConfirmProps): JSX.Element => (
  <Modal label="Delete forever?" role="alertdialog" onClose={onClose}>
    <h2>Delete forever?</h2>
    <p>{name} will be removed for good.</p>
    <div className="dialog-actions">
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="primary" onClick={onConfirm}>
        Delete forever
      </button>
    </div>
  </Modal>
);
