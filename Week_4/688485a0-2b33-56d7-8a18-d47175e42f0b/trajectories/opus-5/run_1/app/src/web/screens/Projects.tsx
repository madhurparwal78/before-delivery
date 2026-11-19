import { useEffect, useState } from 'react';
import {
  ApiFailure,
  CollectionSummary,
  MemberAnswer,
  PendingInvitation,
  Role,
  SessionUser,
  apiGet,
  apiSend,
} from '../api';
import { NO_INVITATIONS, invitationCreatedText, membersErrorText } from '../copy';
import { ConfirmDialog } from '../components/Dialog';
import { NotFoundScreen, PlainShell, ProjectShell, Skeleton } from '../components/Shell';
import { navigate } from '../router';

interface ProjectRow {
  id: string;
  name: string;
  role: Role;
}

export function ProjectsScreen({ user }: { user: SessionUser | null }): JSX.Element {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [name, setName] = useState('');
  const [collection, setCollection] = useState('');
  const [status, setStatus] = useState('');

  const load = (): void => {
    void apiGet<{ projects: ProjectRow[] }>('/api/projects')
      .then((answer) => setProjects(answer.projects))
      .catch(() => setProjects([]));
  };

  useEffect(load, []);

  const create = async (): Promise<void> => {
    try {
      const answer = await apiSend<{ project: { id: string }; collection: { id: string } }>('POST', '/api/projects', {
        name,
        collection,
      });
      navigate(`/p/${answer.project.id}/c/${answer.collection.id}`);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setStatus(failure.code === 'name_taken' ? 'A project with this name already exists' : 'Check the fields');
      }
    }
  };

  return (
    <PlainShell user={user}>
      <h1>YOUR JARS</h1>
      <ul className="row-list" aria-label="Projects" aria-busy={projects === null ? 'true' : undefined}>
        {projects === null ? (
          <li>
            <Skeleton lines={2} />
          </li>
        ) : (
          projects.map((project) => (
            <li key={project.id}>
              <a
                href={`/p/${project.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/p/${project.id}`);
                }}
              >
                {project.name}
              </a>{' '}
              <span className="secondary">{project.role}</span>
            </li>
          ))
        )}
      </ul>
      <h2>PUT IT IN THE JAR</h2>
      <div className="field">
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="first-collection">First collection name</label>
        <input
          id="first-collection"
          type="text"
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        />
      </div>
      <button type="button" className="primary" onClick={() => void create()}>
        Create project
      </button>
      <p role="status">{status}</p>
    </PlainShell>
  );
}

export function InvitesScreen({ user }: { user: SessionUser | null }): JSX.Element {
  const [invitations, setInvitations] = useState<PendingInvitation[] | null>(null);

  const load = (): void => {
    void apiGet<{ invitations: PendingInvitation[] }>('/api/invitations')
      .then((answer) => setInvitations(answer.invitations))
      .catch(() => setInvitations([]));
  };

  useEffect(load, []);

  return (
    <PlainShell user={user}>
      <h1>Invitations</h1>
      <ul className="row-list" aria-label="Invitations" aria-busy={invitations === null ? 'true' : undefined}>
        {(invitations ?? []).map((invitation) => (
          <li key={invitation.id}>
            <span>
              {invitation.project.name} as {invitation.role} from {invitation.inviter.name}
            </span>{' '}
            <button
              type="button"
              onClick={async () => {
                const answer = await apiSend<{ project_id: string }>(
                  'POST',
                  `/api/invitations/${invitation.id}/accept`,
                );
                navigate(`/p/${answer.project_id}`);
              }}
            >
              Accept
            </button>
          </li>
        ))}
      </ul>
      {invitations !== null && invitations.length === 0 ? <p>{NO_INVITATIONS}</p> : null}
    </PlainShell>
  );
}

export function ProjectHomeScreen({ user, pid }: { user: SessionUser | null; pid: string }): JSX.Element {
  const [project, setProject] = useState<{ name: string; role: Role } | null>(null);
  const [missing, setMissing] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void apiGet<{ name: string; role: Role }>(`/api/projects/${pid}`)
      .then((answer) => setProject({ name: answer.name, role: answer.role }))
      .catch(() => setMissing(true));
    void apiGet<{ collections: CollectionSummary[] }>(`/api/projects/${pid}/collections`)
      .then((answer) => setCollections(answer.collections))
      .catch(() => setCollections([]));
  }, [pid, nonce]);

  if (missing) return <NotFoundScreen user={user} />;

  return (
    <ProjectShell user={user} pid={pid} cid={null} section={null} projectName={project?.name ?? ''}>
      <h1>{project?.name ?? ''}</h1>
      <ul className="row-list" aria-label="Collections" aria-busy={collections === null ? 'true' : undefined}>
        {(collections ?? []).map((collection) => (
          <li key={collection.id}>
            <a
              href={`/p/${pid}/c/${collection.id}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/p/${pid}/c/${collection.id}`);
              }}
            >
              {collection.name}
            </a>{' '}
            <span className="count">{collection.count}</span>
          </li>
        ))}
      </ul>
      {project?.role === 'owner' ? (
        <>
          <h2>Add a collection</h2>
          <div className="field">
            <label htmlFor="collection-name">Collection name</label>
            <input id="collection-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="inline">
            <button
              type="button"
              className="primary"
              onClick={async () => {
                try {
                  await apiSend('POST', `/api/projects/${pid}/collections`, { name });
                  setName('');
                  setNonce(nonce + 1);
                  setStatus('');
                } catch (failure) {
                  if (failure instanceof ApiFailure) {
                    setStatus(failure.code === 'name_taken' ? 'That name is taken' : 'Check the name');
                  }
                }
              }}
            >
              Create collection
            </button>
            <button type="button" onClick={() => setConfirming(true)}>
              Delete project
            </button>
          </div>
          <p role="status">{status}</p>
        </>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          label={`Delete project ${project?.name ?? ''}?`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await apiSend('DELETE', `/api/projects/${pid}`);
            navigate('/projects');
          }}
        />
      ) : null}
    </ProjectShell>
  );
}

export function MembersScreen({ user, pid }: { user: SessionUser | null; pid: string }): JSX.Element {
  const [project, setProject] = useState<{ name: string; role: Role } | null>(null);
  const [missing, setMissing] = useState(false);
  const [members, setMembers] = useState<MemberAnswer[]>([]);
  const [invitations, setInvitations] = useState<Array<{ id: string; email: string; role: string }>>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'reader'>('editor');
  const [status, setStatus] = useState('');
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGet<{ name: string; role: Role }>(`/api/projects/${pid}`)
      .then((answer) => setProject({ name: answer.name, role: answer.role }))
      .catch(() => setMissing(true));
    void apiGet<{ members: MemberAnswer[]; invitations: Array<{ id: string; email: string; role: string }> }>(
      `/api/projects/${pid}/members`,
    )
      .then((answer) => {
        setMembers(answer.members);
        setInvitations(answer.invitations);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pid, nonce]);

  if (missing) return <NotFoundScreen user={user} />;
  const owner = project?.role === 'owner';

  return (
    <ProjectShell user={user} pid={pid} cid={null} section="members" projectName={project?.name ?? ''}>
      <h1>Members</h1>
      <ul className="row-list" aria-label="Members" aria-busy={loading ? 'true' : undefined}>
        {members.map((member) => (
          <li key={member.user_id}>
            <span>
              {member.name} <span className="secondary">{member.email}</span>
            </span>
            {owner && member.role !== 'owner' ? (
              <span className="inline">
                <label className="visually-hidden" htmlFor={`role-${member.user_id}`}>
                  Role for {member.email}
                </label>
                <select
                  id={`role-${member.user_id}`}
                  aria-label={`Role for ${member.email}`}
                  value={member.role}
                  onChange={async (event) => {
                    await apiSend('PATCH', `/api/projects/${pid}/members/${member.user_id}`, {
                      role: event.target.value,
                    });
                    setNonce(nonce + 1);
                  }}
                >
                  <option value="editor">editor</option>
                  <option value="reader">reader</option>
                </select>
                <button
                  type="button"
                  aria-label={`Remove ${member.email}`}
                  onClick={async () => {
                    await apiSend('DELETE', `/api/projects/${pid}/members/${member.user_id}`);
                    setNonce(nonce + 1);
                  }}
                >
                  Remove
                </button>
              </span>
            ) : (
              <span className="secondary"> {member.role}</span>
            )}
          </li>
        ))}
      </ul>
      {owner ? (
        <>
          <h2>Invite someone</h2>
          <div className="field">
            <label htmlFor="invite-email">Invite email</label>
            <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Invite role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as 'editor' | 'reader')}
            >
              <option value="editor">editor</option>
              <option value="reader">reader</option>
            </select>
          </div>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              try {
                await apiSend('POST', `/api/projects/${pid}/invitations`, { email, role });
                setStatus(invitationCreatedText(email.trim().toLowerCase()));
                setEmail('');
                setNonce(nonce + 1);
              } catch (failure) {
                if (failure instanceof ApiFailure) setStatus(membersErrorText(failure));
              }
            }}
          >
            Send invitation
          </button>
          <h3>Pending</h3>
          <ul className="row-list" aria-label="Pending invitations">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <span>
                  {invitation.email} as {invitation.role}
                </span>{' '}
                <button
                  type="button"
                  aria-label={`Revoke ${invitation.email}`}
                  onClick={async () => {
                    await apiSend('DELETE', `/api/projects/${pid}/invitations/${invitation.id}`);
                    setNonce(nonce + 1);
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p role="status" aria-label="Members status">
        {status}
      </p>
    </ProjectShell>
  );
}
