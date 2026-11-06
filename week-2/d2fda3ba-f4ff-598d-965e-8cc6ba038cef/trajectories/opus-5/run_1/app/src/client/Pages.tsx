import { useEffect, useState, type JSX } from 'react';
import { formatDisplayTime } from '../shared/time';
import { ApiError, api } from './api';
import { COPY } from './copy';
import { store } from './state';
import { useCairn } from './ui';

export function ApprovalPage({ token }: { token: string }): JSX.Element {
  const [status, setStatus] = useState('');

  const approve = async (): Promise<void> => {
    try {
      await api.approveDevice(token);
      setStatus(COPY.deviceApproval.approved);
    } catch (error) {
      if (error instanceof ApiError && error.failure.code === 'link_expired') {
        setStatus(COPY.deviceApproval.expired);
        return;
      }
      if (error instanceof ApiError && error.failure.code === 'link_used') {
        setStatus(COPY.deviceApproval.alreadyUsed);
        return;
      }
      setStatus(error instanceof ApiError ? error.failure.message : 'Could not reach Cairn.');
    }
  };

  return (
    <main className="single-column">
      <h1>Approve a new device</h1>
      <p className="muted">
        Approving lets that browser pull your encrypted vault. It still needs the vault passphrase to read anything.
      </p>
      <button type="button" className="primary" onClick={() => void approve()}>
        Approve this device
      </button>
      <p className="status-line" role="status" aria-label="Device approval status">
        {status}
      </p>
    </main>
  );
}

export function InvitePage({ token }: { token: string }): JSX.Element {
  const [status, setStatus] = useState('');

  const accept = async (): Promise<void> => {
    try {
      const answer = await api.acceptInvite(token);
      const vault = await api.vault(answer.vault.id);
      const inviter = vault.members.find((member) => member.role === 'owner');
      setStatus(COPY.vault.inviteAccepted(inviter?.display_name ?? answer.vault.name));
      await store.refreshAccountData();
    } catch (error) {
      if (error instanceof ApiError && error.failure.code === 'link_expired') {
        setStatus(COPY.vault.inviteExpired);
        return;
      }
      if (error instanceof ApiError && error.failure.code === 'invite_email_mismatch') {
        setStatus(COPY.vault.wrongRecipient);
        return;
      }
      if (error instanceof ApiError && error.failure.code === 'unauthenticated') {
        setStatus('Sign in on this browser first, then open the invite link again.');
        return;
      }
      setStatus(error instanceof ApiError ? error.failure.message : 'Could not reach Cairn.');
    }
  };

  return (
    <main className="single-column">
      <h1>Join a shared vault</h1>
      <p className="muted">
        The investigator shares the vault passphrase separately. Cairn never sends it by email.
      </p>
      <button type="button" className="primary" onClick={() => void accept()}>
        Accept invite
      </button>
      <p className="status-line" role="status" aria-label="Vault status">
        {status}
      </p>
    </main>
  );
}

interface OpsRow {
  email: string;
  timeZone: string;
  sync: string;
  writableUntil: string;
  publish: string;
  warningAt: string;
  takedownAt: string;
  vaults: number;
  blobs: number;
  bytes: number;
  live: string;
}

export function OpsConsole(): JSX.Element {
  const state = useCairn();
  const [rows, setRows] = useState<OpsRow[]>([]);
  const [source, setSource] = useState('');
  const [sweepStatus, setSweepStatus] = useState('');
  const [problem, setProblem] = useState('');

  const load = async (): Promise<void> => {
    try {
      const answer = await api.opsAccounts();
      const zone = state.account?.time_zone ?? 'UTC';
      const when = (value: string | null | undefined): string =>
        value ? formatDisplayTime(new Date(value), zone) : '—';
      let latestCheck: string | null = null;
      setRows(
        answer.accounts.map((entry) => {
          latestCheck = entry.sync?.checked_at ?? latestCheck;
          return {
            email: entry.account.email,
            timeZone: entry.account.time_zone,
            sync: entry.sync?.state ?? 'unknown',
            writableUntil: when(entry.sync?.writable_until),
            publish: entry.publish?.state ?? 'unknown',
            warningAt: when(entry.publish?.warning_at),
            takedownAt: when(entry.publish?.takedown_at),
            vaults: entry.vault_count,
            blobs: entry.blob_count,
            bytes: entry.stored_bytes,
            live: entry.live_dossiers.map((dossier) => dossier.slug).join(', ') || '—',
          };
        }),
      );
      setSource(answer.source === 'killbill' ? COPY.ops.live : COPY.ops.cached(when(latestCheck)));
      setProblem('');
    } catch (error) {
      setProblem(
        error instanceof ApiError && error.failure.code === 'not_operator'
          ? 'This console is for operator accounts.'
          : 'Sign in as the operator account to see the console.',
      );
    }
  };

  useEffect(() => {
    void load();
  }, [state.account?.id]);

  const sweep = async (): Promise<void> => {
    setSweepStatus(COPY.ops.running);
    try {
      const answer = await api.sweep();
      setSweepStatus(COPY.ops.done(answer.warnings_sent, answer.dossiers_taken_down));
    } catch (error) {
      setSweepStatus(error instanceof ApiError ? error.failure.message : 'Could not run the lapse check.');
    }
    await load();
  };

  return (
    <main className="ops">
      <h1>Operator console</h1>
      <div className="ops-head">
        <p className="status-line" role="status" aria-label="Billing source">
          {source}
        </p>
        <button type="button" className="primary" onClick={() => void sweep()}>
          Run lapse check now
        </button>
        <p className="status-line" role="status" aria-label="Lapse check">
          {sweepStatus}
        </p>
      </div>
      {problem ? <p className="field-error">{problem}</p> : null}

      <div className="ops-table-region" tabIndex={0} aria-label="Accounts region">
        <table aria-label="Accounts">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Time zone</th>
              <th scope="col">Sync</th>
              <th scope="col">Writable until</th>
              <th scope="col">Publish</th>
              <th scope="col">Warning at</th>
              <th scope="col">Takedown at</th>
              <th scope="col">Vaults</th>
              <th scope="col">Ciphertext blobs</th>
              <th scope="col">Stored bytes</th>
              <th scope="col">Live dossiers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.email}>
                <td data-label="Account">{row.email}</td>
                <td data-label="Time zone">{row.timeZone}</td>
                <td data-label="Sync">{row.sync}</td>
                <td data-label="Writable until" className="mono">
                  {row.writableUntil}
                </td>
                <td data-label="Publish">{row.publish}</td>
                <td data-label="Warning at" className="mono">
                  {row.warningAt}
                </td>
                <td data-label="Takedown at" className="mono">
                  {row.takedownAt}
                </td>
                <td data-label="Vaults" className="mono">
                  {row.vaults}
                </td>
                <td data-label="Ciphertext blobs" className="mono">
                  {row.blobs}
                </td>
                <td data-label="Stored bytes" className="mono">
                  {row.bytes}
                </td>
                <td data-label="Live dossiers">{row.live}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted ops-footer">{COPY.ops.envelopeFooter}</p>
    </main>
  );
}
