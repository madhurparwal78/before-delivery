import { useEffect, useMemo, useState } from 'preact/hooks';
import { Spinner } from '../ui/spinner.js';
import { SEAT_CREDITS, SEAT_LIMIT, formatCredits, formatNumber, modelOf, planLine } from '../../shared/catalog.js';
import { checkInvite } from '../../shared/rules.js';
import { api } from '../api.js';
import type { CreditEntry, Generation, Team } from '../data.js';
import { formatDate, formatDateTime, signed } from '../format.js';
import { Dialog } from '../ui/dialog.js';
import { Plus } from '../ui/icons.js';
import { useToast } from '../ui/toast.js';
import { GenerationCard, useGenerationUpdates } from './generation-card.js';
import { useSession } from './layout.js';

const KIND_WORDS: Record<CreditEntry['kind'], string> = {
  plan: 'Plan credits',
  seat: 'Seat added',
  charge: 'Generation',
  refund: 'Refund',
};

function CreditRow({ entry }: { entry: CreditEntry }) {
  return (
    <li class="history-row">
      <span class="history-kind">{KIND_WORDS[entry.kind]}</span>
      <span class="history-person">{entry.user_name}</span>
      <span class="history-when">{formatDateTime(entry.created_at)}</span>
      <span class={`history-amount figure ${entry.amount > 0 ? 'is-in' : 'is-out'}`}>{signed(entry.amount)}</span>
      <span class="history-after figure">{formatNumber(entry.balance_after)}</span>
    </li>
  );
}

function HistoryHead() {
  return (
    <li class="history-row history-head" aria-hidden="true">
      <span>Change</span>
      <span>By</span>
      <span>When (UTC)</span>
      <span class="history-amount">Credits</span>
      <span class="history-after">Balance after</span>
    </li>
  );
}

export function GenerationPage({ id }: { id: string }) {
  const [generation, setGeneration] = useState<Generation | null | undefined>(undefined);
  const [entries, setEntries] = useState<CreditEntry[]>([]);

  const loadEntries = () =>
    api<{ entries: CreditEntry[] }>('GET', '/credits').then(
      (reply) => reply.ok && setEntries(reply.data.entries.filter((entry) => entry.generation_id === id)),
    );

  useEffect(() => {
    api<Generation>('GET', `/generations/${id}`).then((reply) => setGeneration(reply.ok ? reply.data : null));
    void loadEntries();
  }, [id]);

  const list = useMemo(() => (generation ? [generation] : null), [generation]);
  useGenerationUpdates(list, setGeneration);

  if (generation === null) {
    return (
      <div class="studio-page empty">
        <h1 class="heading studio-title">That generation does not exist.</h1>
        <a class="button button-light" href="/studio/projects">Back to projects</a>
      </div>
    );
  }
  if (!generation) {
    return (
      <div class="studio-page">
        <div class="skeleton skeleton-title" />
        <div class="skeleton skeleton-hero" />
      </div>
    );
  }
  const model = modelOf(generation.model)!;
  return (
    <div class="studio-page generation-page">
      <h1 class="heading studio-title">Generation</h1>
      <GenerationCard
        generation={generation}
        large
        onChange={(next) => {
          setGeneration(next);
          void loadEntries();
        }}
      />
      <dl class="details card">
        <div><dt>Prompt</dt><dd>{generation.prompt}</dd></div>
        <div><dt>Model</dt><dd>{model.name}</dd></div>
        <div>
          <dt>{generation.duration ? 'Length' : 'Images'}</dt>
          <dd>{generation.duration ? `${generation.duration} s` : generation.image_count}</dd>
        </div>
        <div><dt>Aspect</dt><dd>{generation.aspect}</dd></div>
        <div><dt>Cost</dt><dd class="figure">{formatCredits(generation.cost)}</dd></div>
        <div><dt>Started by</dt><dd>{generation.started_by}</dd></div>
        <div><dt>Started</dt><dd>{formatDateTime(generation.created_at)}</dd></div>
        {generation.finished_at && <div><dt>Finished</dt><dd>{formatDateTime(generation.finished_at)}</dd></div>}
      </dl>
      <section aria-labelledby="generation-credits">
        <h2 id="generation-credits" class="heading-small">Charge and refund</h2>
        <ul class="history card">
          <HistoryHead />
          {entries.map((entry) => (
            <CreditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </section>
    </div>
  );
}

export function CreditsPage() {
  const { me } = useSession();
  const [data, setData] = useState<{ balance: number; entries: CreditEntry[] } | null>(null);

  useEffect(() => {
    api<{ balance: number; entries: CreditEntry[] }>('GET', '/credits').then((reply) => reply.ok && setData(reply.data));
  }, []);

  return (
    <div class="studio-page">
      <h1 class="heading studio-title">Credits</h1>
      <div class="card balance-card">
        {data ? <p class="balance-figure figure">{formatCredits(data.balance)}</p> : <div class="skeleton skeleton-figure" />}
        {me && <p class="balance-plan">{planLine(me.workspace.plan)}</p>}
      </div>
      <section aria-labelledby="history-title">
        <h2 id="history-title" class="heading-small">History</h2>
        {data ? (
          <ul class="history card">
            <HistoryHead />
            {data.entries.map((entry) => (
              <CreditRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <div class="skeleton skeleton-rows" />
        )}
      </section>
    </div>
  );
}

function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const checked = checkInvite({ email });
    if (!checked.ok) return setError(checked.errors.email);
    setBusy(true);
    const reply = await api('POST', '/team/invitations', { email });
    setBusy(false);
    if (reply.ok) return onSent();
    if (reply.error === 'seats_full') setError(`Your team already uses all ${SEAT_LIMIT} seats.`);
    else if (reply.error === 'account_or_invitation_exists') setError('That person already has an account or an invitation.');
    else setError(reply.errors?.email ?? 'The invitation could not be sent.');
  };
  return (
    <Dialog title="Invite teammate" onClose={onClose}>
      <form class="stack" noValidate onSubmit={submit}>
        <p class="dialog-text">
          They get an email with a link to join. Their seat adds {formatNumber(SEAT_CREDITS)} credits to the shared balance.
        </p>
        <div class={`field${error ? ' has-error' : ''}`}>
          <label for="invite-email">Email</label>
          <input
            id="invite-email"
            class="input"
            type="email"
            data-autofocus
            value={email}
            onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
            aria-describedby={error ? 'invite-email-error' : undefined}
            aria-invalid={error ? 'true' : undefined}
          />
          {error && (
            <p id="invite-email-error" class="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div class="dialog-actions">
          <button type="button" class="button button-light" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button-dark" disabled={busy}>
            {busy && <Spinner />}
            Send invite
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveDialog({ person, workspace, onClose, onRemoved }: {
  person: Team['members'][number];
  workspace: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true);
    const reply = await api('DELETE', `/team/members/${person.id}`);
    setBusy(false);
    if (reply.ok) onRemoved();
    else setError('This member could not be removed.');
  };
  return (
    <Dialog title="Remove member" onClose={onClose}>
      <p class="dialog-text">
        Remove {person.name} ({person.email}) from {workspace}? They lose access at once. Their generations and the credits
        they used stay in the history, and no credits are taken back.
      </p>
      {error && (
        <p class="field-error" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="button button-light" onClick={onClose} data-autofocus>
          Cancel
        </button>
        <button type="button" class="button button-danger" onClick={remove} disabled={busy}>
          {busy && <Spinner />}
          Remove member
        </button>
      </div>
    </Dialog>
  );
}

export function TeamPage() {
  const { me, refresh } = useSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Team['members'][number] | null>(null);
  const toast = useToast();

  const load = () => api<Team>('GET', '/team').then((reply) => reply.ok && setTeam(reply.data));
  useEffect(() => {
    void load();
  }, []);

  if (me && me.workspace.plan !== 'team') {
    return (
      <div class="studio-page">
        <h1 class="heading studio-title">Team</h1>
        <div class="card notice">
          <p>Teams share one credit balance. Team workspaces are set up by our sales team.</p>
          <a class="text-link" href="/team-plan">See the Team plan</a>
        </div>
      </div>
    );
  }

  const owner = me?.user.role === 'owner';
  const revoke = async (id: string) => {
    const reply = await api('DELETE', `/team/invitations/${id}`);
    if (reply.ok) toast('Invitation revoked.');
    await load();
  };

  return (
    <div class="studio-page">
      <div class="page-head">
        <h1 class="heading studio-title">Team</h1>
        {owner && (
          <button type="button" class="button button-light" onClick={() => setInviting(true)}>
            <Plus size={16} /> Invite teammate
          </button>
        )}
      </div>
      {!team ? (
        <div class="skeleton skeleton-rows" />
      ) : (
        <>
          <p class="seats">
            <span class="figure">{team.seats_used}</span> of {team.seat_limit} seats used
          </p>
          <section aria-labelledby="members-title">
            <h2 id="members-title" class="heading-small">Members</h2>
            <ul class="people card">
              {team.members.map((person) => (
                <li key={person.id} class="person">
                  <span class="person-name">{person.name}</span>
                  <span class="person-email">{person.email}</span>
                  <span class="badge badge-neutral">{person.role === 'owner' ? 'Owner' : 'Member'}</span>
                  <span class="person-date">Joined {formatDate(person.joined_at)}</span>
                  {owner && person.id !== me?.user.id ? (
                    <button type="button" class="button button-light button-small" onClick={() => setRemoving(person)}>
                      Remove
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="invitations-title">
            <h2 id="invitations-title" class="heading-small">Pending invitations</h2>
            {team.invitations.length === 0 ? (
              <p class="empty-line">No pending invitations.</p>
            ) : (
              <ul class="people card">
                {team.invitations.map((invitation) => (
                  <li key={invitation.id} class="person invitation-row">
                    <span class="person-email">{invitation.email}</span>
                    <span class="person-date">Sent {formatDate(invitation.created_at)}</span>
                    {owner && (
                      <button type="button" class="button button-light button-small" onClick={() => revoke(invitation.id)}>
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onSent={() => {
            setInviting(false);
            toast('Invitation sent.');
            void load();
          }}
        />
      )}
      {removing && me && (
        <RemoveDialog
          person={removing}
          workspace={me.workspace.name}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            toast('Member removed.');
            void load();
            void refresh();
          }}
        />
      )}
    </div>
  );
}
