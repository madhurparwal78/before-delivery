import { useState, type JSX } from 'react';
import { VAULT_PASSPHRASE_MIN_LENGTH } from '../shared/envelope';
import { Icon } from './icons';
import { store } from './state';
import { Dialog, useCairn } from './ui';

export function AccountDialog(): JSX.Element | null {
  const state = useCairn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [deviceName, setDeviceName] = useState(state.deviceName);
  const [passphraseOpen, setPassphraseOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  if (!state.accountDialogOpen) return null;
  const notebook = store.currentNotebook();

  const signedOutForm = (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void store.signIn({ email, password, device_name: deviceName });
      }}
    >
      <label className="field">
        <span className="field-label">Email</span>
        <input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        {state.accountFields.email ? <span className="field-error">{state.accountFields.email}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input
          type="password"
          role="textbox"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {state.accountFields.password ? <span className="field-error">{state.accountFields.password}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">Display name</span>
        <input aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        {state.accountFields.display_name ? (
          <span className="field-error">{state.accountFields.display_name}</span>
        ) : null}
      </label>
      <label className="field">
        <span className="field-label">Device name</span>
        <input aria-label="Device name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
        {state.accountFields.device_name ? (
          <span className="field-error">{state.accountFields.device_name}</span>
        ) : null}
      </label>
      <div className="dialog-actions">
        <button type="submit" className="primary">
          Sign in
        </button>
        <button
          type="button"
          onClick={() => void store.createAccount({ email, password, display_name: displayName, device_name: deviceName })}
        >
          Create account
        </button>
      </div>
    </form>
  );

  const signedIn = state.account !== null;

  return (
    <>
      <Dialog name="Account" onClose={() => store.setAccountDialogOpen(false)}>
        {signedIn ? null : signedOutForm}

        <p className="status-line" role="status" aria-label="Account status">
          {state.accountStatus ?? ''}
        </p>
        {state.accountError ? (
          <p className="field-error" role="alert">
            <Icon name="warning" className="brick" />
            {state.accountError}
          </p>
        ) : null}

        {signedIn ? (
          <>
            <section className="plans" aria-label="Plans">
              <h3>Plans</h3>
              <div className="plan-buttons">
                <button type="button" onClick={() => void store.changePlan('sync', 'add')}>
                  Add Sync
                </button>
                <button type="button" onClick={() => void store.changePlan('sync', 'cancel')}>
                  Cancel Sync
                </button>
                <button type="button" onClick={() => void store.changePlan('publish', 'add')}>
                  Add Publish
                </button>
                <button type="button" onClick={() => void store.changePlan('publish', 'cancel')}>
                  Cancel Publish
                </button>
              </div>
              <p className="status-line" role="status" aria-label="Plan status">
                {state.planStatus ?? [store.planLine('sync'), store.planLine('publish')].filter(Boolean).join(' · ')}
              </p>
            </section>

            <section className="devices">
              <h3>Devices</h3>
              <ul className="device-list" aria-label="Devices">
                {state.devices.map((device) => (
                  <li key={device.id}>
                    <span>{device.name}</span>
                    <span className="muted">{device.approved ? 'approved' : 'waiting for approval'}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="vault-actions">
              <h3>Vault</h3>
              {notebook && !notebook.vaultId ? (
                <button type="button" onClick={() => setPassphraseOpen(true)}>
                  Enable sync for this notebook
                </button>
              ) : null}
              {notebook?.vaultId && notebook.role === 'owner' ? (
                <button type="button" onClick={() => setInviteOpen(true)}>
                  Invite partner
                </button>
              ) : null}
              {state.unlockVaultId === null ? (
                <p className="status-line" role="status" aria-label="Vault status">
                  {state.vaultStatus ?? ''}
                </p>
              ) : null}
            </section>

            <div className="dialog-actions">
              <button type="button" onClick={() => void store.signOut()}>
                Sign out
              </button>
            </div>
          </>
        ) : null}
      </Dialog>

      {passphraseOpen ? <SetPassphraseDialog onClose={() => setPassphraseOpen(false)} /> : null}
      {inviteOpen ? <InviteDialog onClose={() => setInviteOpen(false)} /> : null}
    </>
  );
}

function SetPassphraseDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const create = (): void => {
    if (passphrase.length < VAULT_PASSPHRASE_MIN_LENGTH) {
      setProblem(`Use at least ${VAULT_PASSPHRASE_MIN_LENGTH} characters. A lost passphrase cannot be recovered.`);
      return;
    }
    if (passphrase !== confirmation) {
      setProblem('Both passphrases must match.');
      return;
    }
    onClose();
    void store.createVault(passphrase);
  };

  return (
    <Dialog name="Set vault passphrase" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span className="field-label">Vault passphrase</span>
          <input
            type="password"
            role="textbox"
            aria-label="Vault passphrase"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Confirm passphrase</span>
          <input
            type="password"
            role="textbox"
            aria-label="Confirm passphrase"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="submit" className="primary">
            Create vault
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function UnlockVaultDialog(): JSX.Element | null {
  const state = useCairn();
  const [passphrase, setPassphrase] = useState('');
  if (!state.unlockVaultId) return null;
  const vaultId = state.unlockVaultId;

  return (
    <Dialog name="Unlock vault" onClose={() => store.dismissUnlock()}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void store.unlockVault(vaultId, passphrase);
        }}
      >
        <label className="field">
          <span className="field-label">Vault passphrase</span>
          <input
            type="password"
            role="textbox"
            aria-label="Vault passphrase"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <p className="status-line" role="status" aria-label="Vault status">
          {state.vaultStatus ?? ''}
        </p>
        <div className="dialog-actions">
          <button type="submit" className="primary">
            Unlock
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [email, setEmail] = useState('');
  return (
    <Dialog name="Invite partner" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
          void store.invitePartner(email);
        }}
      >
        <label className="field">
          <span className="field-label">Partner email</span>
          <input aria-label="Partner email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="submit" className="primary">
            Send invite
          </button>
        </div>
      </form>
    </Dialog>
  );
}
