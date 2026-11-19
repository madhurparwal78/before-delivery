import { useEffect, useState, type ReactElement } from 'react';
import { ROLE_LABELS, type Channel, type ChannelMember, type Message, type Role, type User } from '../shared/api';
import { ApiFailure, apiGet, apiSend } from './api';
import { Dialog, ErrorSummary } from './Dialog';
import { when, zoneName } from './format';
import { RoleChip } from './Chips';

interface ConflictState {
  version: number;
  text: string;
  editorName: string;
  editedAt: string;
}

export function EditMessageDialog({
  message,
  onClose,
  onSaved,
  onNotice,
}: {
  message: Message;
  onClose: () => void;
  onSaved: (version: number) => void;
  onNotice: (copy: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(message.text);
  const [expected, setExpected] = useState(message.version);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [windowClosed, setWindowClosed] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await apiSend<{ message: Message }>('PATCH', `/api/messages/${message.id}`, {
        text: draft,
        expected_version: expected,
      });
      onSaved(result.message.version);
      onNotice(`Edit saved as version ${result.message.version}.`);
      onClose();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'stale_version' && error.body.current !== undefined) {
        const current = error.body.current;
        setConflict({
          version: current.version,
          text: current.text,
          editorName: current.edited_by.name,
          editedAt: current.edited_at,
        });
        setExpected(current.version);
        onNotice('Someone saved a newer version. Your draft is still here.');
      } else if (error instanceof ApiFailure && error.code === 'edit_window_closed') {
        setWindowClosed(true);
        setFieldError(error.message);
      } else if (error instanceof ApiFailure) {
        setFieldError(error.message);
        onNotice(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog label="Edit message" onClose={onClose}>
      <h2>Edit message</h2>
      {fieldError !== null ? <ErrorSummary errors={{ text: fieldError }} /> : null}
      <label htmlFor="field-text">Message text</label>
      <textarea
        id="field-text"
        aria-label="Message text"
        value={draft}
        rows={5}
        onChange={(event) => setDraft(event.target.value)}
      />
      {fieldError !== null ? <p className="field-error">{fieldError}</p> : null}
      {conflict !== null ? (
        <section aria-label="Newer version" className="newer-version">
          <h3>Newer version</h3>
          <p className="message-text">{conflict.text}</p>
          <p>{`Saved by ${conflict.editorName} at ${when(conflict.editedAt)}`}</p>
        </section>
      ) : null}
      <div className="dialog-actions">
        {windowClosed ? null : (
          <button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save edit'}
          </button>
        )}
        {conflict !== null && !windowClosed ? (
          <>
            <button type="button" onClick={() => setDraft(conflict.text)}>
              Use newer text
            </button>
            <button type="button" disabled={saving} onClick={() => void save()}>
              Save over it
            </button>
          </>
        ) : null}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function DeleteMessageDialog({
  message,
  onClose,
  onDeleted,
  onNotice,
}: {
  message: Message;
  onClose: () => void;
  onDeleted: () => void;
  onNotice: (copy: string) => void;
}): ReactElement {
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog label="Delete this message?" onClose={onClose}>
      <h2>Delete this message?</h2>
      <div className="dialog-actions">
        <button
          type="button"
          disabled={deleting}
          onClick={() => {
            setDeleting(true);
            void apiSend<void>('DELETE', `/api/messages/${message.id}`)
              .then(() => {
                onNotice('Message deleted.');
                onDeleted();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) onNotice(error.message);
                setDeleting(false);
                onClose();
              });
          }}
        >
          {deleting ? 'Deleting…' : 'Delete for everyone'}
        </button>
        <button type="button" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Dialog>
  );
}

export function MembersDialog({
  channel,
  me,
  onClose,
  onNotice,
}: {
  channel: Channel;
  me: User;
  onClose: () => void;
  onNotice: (copy: string) => void;
}): ReactElement {
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const ops = me.role === 'ops_manager';

  const reload = (): void => {
    void apiGet<{ channel: Channel; members: ChannelMember[] }>(`/api/channels/${channel.id}`).then((result) =>
      setMembers(result.members),
    );
    if (ops) void apiGet<{ members: User[] }>('/api/workspace/members').then((result) => setPeople(result.members));
  };

  useEffect(reload, [channel.id, ops]);

  const candidates = people.filter(
    (person) => person.status === 'active' && !members.some((member) => member.user.id === person.id),
  );

  return (
    <Dialog label={`Members of ${channel.name}`} onClose={onClose}>
      <h2>{`Members of ${channel.name}`}</h2>
      <ul aria-label="Current members" className="member-list">
        {members.map((member) => (
          <li key={member.user.id}>
            <span>{member.user.name}</span>
            <span className="mono">{`@${member.user.handle}`}</span>
            <RoleChip label={ROLE_LABELS[member.user.role]} />
            {member.user.email !== undefined ? <span className="member-email">{member.user.email}</span> : null}
            {ops ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  void apiSend<void>('DELETE', `/api/channels/${channel.id}/members/${member.user.id}`)
                    .then(() => onNotice(`${member.user.name} removed from #${channel.name}.`))
                    .catch((error: unknown) => {
                      if (error instanceof ApiFailure) onNotice(error.message);
                    })
                    .finally(() => {
                      setSaving(false);
                      reload();
                    });
                }}
              >
                {saving ? 'Saving…' : `Remove ${member.user.name}`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {ops ? (
        <div className="add-member">
          <label htmlFor="field-user_id">Add a person</label>
          <select
            id="field-user_id"
            aria-label="Add a person"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose a person</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {`${person.name} (${person.email ?? ''})`}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void apiSend<{ member: ChannelMember }>('POST', `/api/channels/${channel.id}/members`, {
                user_id: choice,
              })
                .then((result) => onNotice(`${result.member.user.name} added to #${channel.name}.`))
                .catch((error: unknown) => {
                  if (error instanceof ApiFailure) onNotice(error.message);
                })
                .finally(() => {
                  setSaving(false);
                  setChoice('');
                  reload();
                });
            }}
          >
            {saving ? 'Saving…' : 'Add to channel'}
          </button>
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function WorkspacePeopleDialog({
  me,
  onClose,
  onNotice,
}: {
  me: User;
  onClose: () => void;
  onNotice: (copy: string) => void;
}): ReactElement {
  const [people, setPeople] = useState<User[]>([]);
  const [confirming, setConfirming] = useState<User | null>(null);
  const [working, setWorking] = useState(false);

  const reload = (): void => {
    void apiGet<{ members: User[] }>('/api/workspace/members').then((result) => setPeople(result.members));
  };
  useEffect(reload, []);

  if (confirming !== null) {
    return (
      <Dialog label={`Deactivate ${confirming.name}?`} onClose={() => setConfirming(null)}>
        <h2>{`Deactivate ${confirming.name}?`}</h2>
        <div className="dialog-actions">
          <button
            type="button"
            disabled={working}
            onClick={() => {
              setWorking(true);
              void apiSend<{ member: User }>('DELETE', `/api/workspace/members/${confirming.id}`)
                .then(() => onNotice(`${confirming.name} can no longer sign in.`))
                .catch((error: unknown) => {
                  if (error instanceof ApiFailure) onNotice(error.message);
                })
                .finally(() => {
                  setWorking(false);
                  setConfirming(null);
                  reload();
                });
            }}
          >
            {working ? 'Deactivating…' : 'Deactivate'}
          </button>
          <button type="button" onClick={() => setConfirming(null)}>
            Keep access
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog label="Workspace people" onClose={onClose}>
      <h2>Workspace people</h2>
      <ul className="member-list">
        {people.map((person) => (
          <li key={person.id}>
            <span>{person.name}</span>
            <span className="mono">{`@${person.handle}`}</span>
            <RoleChip label={ROLE_LABELS[person.role]} />
            {person.email !== undefined ? <span className="member-email">{person.email}</span> : null}
            {person.id === me.id ? null : (
              <button type="button" onClick={() => setConfirming(person)}>
                {`Deactivate ${person.name}`}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function InviteDialog({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice: (copy: string) => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <Dialog label="Invite technician" onClose={onClose}>
      <h2>Invite technician</h2>
      <ErrorSummary errors={errors} />
      <label htmlFor="field-name">Name</label>
      <input id="field-name" aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
      {errors['name'] !== undefined ? <p className="field-error">{errors['name']}</p> : null}
      <label htmlFor="field-email">Email</label>
      <input id="field-email" aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
      {errors['email'] !== undefined ? <p className="field-error">{errors['email']}</p> : null}
      <label htmlFor="field-role">Role</label>
      <select id="field-role" aria-label="Role" value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="">Choose a role</option>
        <option value="dispatcher">Dispatcher</option>
        <option value="field_technician">Field technician</option>
        <option value="crew_lead">Crew lead</option>
        <option value="ops_manager">Operations manager</option>
      </select>
      {errors['role'] !== undefined ? <p className="field-error">{errors['role']}</p> : null}
      <div className="dialog-actions">
        <button
          type="button"
          disabled={sending}
          onClick={() => {
            setSending(true);
            setErrors({});
            void apiSend<{ member: User; invite_email: string }>('POST', '/api/workspace/members', {
              name,
              email,
              role: role as Role,
            })
              .then((result) => {
                if (result.invite_email === 'queued') {
                  onNotice(`Invite saved. The email to ${result.member.email ?? email} is queued until mail is reachable.`);
                } else {
                  onNotice(`Invite emailed to ${result.member.email ?? email}.`);
                }
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  setErrors(error.body.errors ?? { email: error.message });
                  if (error.body.errors === undefined) onNotice(error.message);
                }
              })
              .finally(() => setSending(false));
          }}
        >
          {sending ? 'Sending…' : 'Send invite'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function SchedulePostDialog({
  channel,
  onClose,
  onNotice,
  onScheduled,
}: {
  channel: Channel;
  onClose: () => void;
  onNotice: (copy: string) => void;
  onScheduled: () => void;
}): ReactElement {
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <Dialog label="Schedule post" onClose={onClose}>
      <h2>Schedule post</h2>
      <ErrorSummary errors={errors} />
      <label htmlFor="field-text">Post text</label>
      <textarea id="field-text" aria-label="Post text" value={text} onChange={(event) => setText(event.target.value)} />
      {errors['text'] !== undefined ? <p className="field-error">{errors['text']}</p> : null}
      <label htmlFor="field-local_date">Date</label>
      <input id="field-local_date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      {errors['local_date'] !== undefined ? <p className="field-error">{errors['local_date']}</p> : null}
      <label htmlFor="field-local_time">Time</label>
      <input id="field-local_time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      {errors['local_time'] !== undefined ? <p className="field-error">{errors['local_time']}</p> : null}
      <label className="checkbox-row">
        <input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />
        Repeat weekly
      </label>
      <p>{`Times are in ${zoneName()}`}</p>
      <div className="dialog-actions">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setErrors({});
            void apiSend<{ scheduled: { next_fire_local: string | null } }>(
              'POST',
              `/api/channels/${channel.id}/scheduled`,
              { text, local_date: date, local_time: time, repeat: weekly ? 'weekly' : 'none' },
            )
              .then((result) => {
                onNotice(
                  `Scheduled for ${result.scheduled.next_fire_local === null ? '' : when(result.scheduled.next_fire_local)}.`,
                );
                onScheduled();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) setErrors(error.body.errors ?? { text: error.message });
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? 'Scheduling…' : 'Schedule'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
