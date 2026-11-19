import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import type { CompanyPage as CompanyPageData, PersonCard } from '../types.js';
import { Dialog } from '../dialog.js';
import { localInputToIso } from '../format.js';

export const CompanyPage = ({ handle }: { handle: string }): JSX.Element => {
  const { navigate, liveEvents, config } = useApp();
  const [company, setCompany] = useState<CompanyPageData | null>(null);
  const [missing, setMissing] = useState(false);
  const [followers, setFollowers] = useState<PersonCard[] | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [workplace, setWorkplace] = useState('on-site');
  const [closes, setCloses] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.get<CompanyPageData>(`/api/companies/${handle}`);
      setCompany(result);
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [handle]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'job_update' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  if (missing || !company) {
    return (
      <div className="big-empty">
        <h2>We couldn't find that page.</h2>
        <a href="/feed">Go to Home</a>
      </div>
    );
  }

  const follow = async (): Promise<void> => {
    if (company.following) {
      await api.delete(`/api/follows/${company.id}`);
    } else {
      await api.post('/api/follows', { target_id: company.id });
    }
    await load();
  };

  const publish = async (): Promise<void> => {
    setError(null);
    const iso = localInputToIso(closes, config?.time_zone ?? 'UTC');
    if (iso === null) {
      setError('Use YYYY-MM-DD HH:MM.');
      return;
    }
    try {
      await api.post('/api/jobs', {
        company_id: company.id, title, location, workplace, closes_at: iso, description,
      });
      setPostOpen(false);
      await load();
    } catch (err) {
      const e2 = err as { body?: { fields?: Record<string, string> } };
      if (e2.body?.fields) setError(Object.values(e2.body.fields)[0] ?? 'Something went wrong. Try again.');
      else setError('Something went wrong. Try again.');
    }
  };

  return (
    <>
      <h1 className="profile-name">{company.name}</h1>
      <p className="entry-headline">{company.location}</p>
      <p className="entry-text">{company.about}</p>
      <p className="count-line">{company.follower_count === 1 ? '1 follower' : `${company.follower_count} followers`}</p>
      <div className="action-row">
        <button type="button" className="text-button" aria-pressed={company.following} onClick={() => { void follow(); }}>
          {company.following ? 'Following' : 'Follow'}
        </button>
        {company.is_admin && (
          <>
            <button type="button" className="pink-button" onClick={() => setPostOpen(true)}>Post a job</button>
            <button type="button" className="text-button" onClick={() => setEditOpen(true)}>Edit page</button>
            <button type="button" className="text-button" onClick={() => {
              void (async () => {
                const result = await api.get<{ followers: PersonCard[] }>(`/api/companies/${handle}/followers`);
                setFollowers(result.followers);
              })();
            }}>Show followers</button>
          </>
        )}
      </div>
      <section aria-label="Open jobs">
        <h2 aria-level={2}>Open jobs</h2>
        <ul>
          {company.open_jobs.map((job) => (
            <li key={job.id} className="job-card" data-job-id={job.id}>
              <h3><a href={`/jobs/${job.id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${job.id}`); }}>{job.title}</a></h3>
              <p>{job.location} · {job.workplace}</p>
            </li>
          ))}
        </ul>
      </section>
      {followers && (
        <section aria-label="Followers">
          <h2 aria-level={2}>Followers</h2>
          <ul aria-label="Followers">
            {followers.map((member) => (
              <li key={member.id}>{member.name}</li>
            ))}
          </ul>
        </section>
      )}
      {postOpen && (
        <Dialog label="Post a job" onClose={() => setPostOpen(false)} closeButton={false}>
          <h2>Post a job</h2>
          {error && <div role="alert">{error}</div>}
          <label className="label" htmlFor="post-title">Job title</label>
          <input id="post-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="label" htmlFor="post-location">Location</label>
          <input id="post-location" className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
          <label className="label" htmlFor="post-workplace">Workplace</label>
          <select id="post-workplace" className="field" value={workplace} onChange={(e) => setWorkplace(e.target.value)}>
            <option value="on-site">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
          <label className="label" htmlFor="post-closes">Closes</label>
          <input id="post-closes" className="field" placeholder="YYYY-MM-DD HH:MM" value={closes} onChange={(e) => setCloses(e.target.value)} />
          <label className="label" htmlFor="post-description">Description</label>
          <textarea id="post-description" className="field" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => { void publish(); }}>Publish job</button>
          </div>
        </Dialog>
      )}
      {editOpen && (
        <Dialog label="Edit page" onClose={() => setEditOpen(false)} closeButton={false}>
          <h2>Edit page</h2>
          <EditPageForm company={company} onSaved={() => { setEditOpen(false); void load(); }} />
        </Dialog>
      )}
    </>
  );
};

const EditPageForm = ({ company, onSaved }: { company: CompanyPageData; onSaved: () => void }): JSX.Element => {
  const [name, setName] = useState(company.name);
  const [location, setLocation] = useState(company.location);
  const [about, setAbout] = useState(company.about);

  return (
    <>
      <label className="label" htmlFor="edit-name">Name</label>
      <input id="edit-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label" htmlFor="edit-company-location">Location</label>
      <input id="edit-company-location" className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
      <label className="label" htmlFor="edit-about">About</label>
      <textarea id="edit-about" className="field" rows={4} value={about} onChange={(e) => setAbout(e.target.value)} />
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => {
          void (async () => {
            await api.patch(`/api/companies/${company.handle}`, { name, location, about });
            onSaved();
          })();
        }}>Save</button>
      </div>
    </>
  );
};
