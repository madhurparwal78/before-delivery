import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { EditCompanyDialog } from '../components/jobs/EditCompanyDialog';
import { JobCards } from '../components/jobs/JobCards';
import { PostJobDialog } from '../components/jobs/PostJobDialog';
import { SOMETHING_WENT_WRONG } from '../components/jobs/jobModel';
import { plural } from '../format';
import { useLive } from '../live';
import type { JobCard, PersonCard } from '../types';
import { Alert, Button, EmptyState } from '../ui';
import '../components/jobs/jobs.css';

interface CompanyObject {
  id: string;
  handle: string;
  name: string;
  location: string;
  about: string;
  follower_count: number;
  following: boolean;
  is_admin: boolean;
  open_jobs: JobCard[];
}

/** A company page: followers, open jobs, and for its admins Post a job, Edit page and the follower list. */
export default function Company() {
  const { handle = '' } = useParams();
  const [company, setCompany] = useState<CompanyObject | null>(null);
  const [followers, setFollowers] = useState<PersonCard[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [alert, setAlert] = useState('');

  const load = (): void => {
    api
      .get<CompanyObject>(`/api/companies/${handle}`)
      .then(async (loaded) => {
        const list = loaded.is_admin ? (await api.get<{ followers: PersonCard[] }>(`/api/companies/${handle}/followers`)).followers : null;
        setFollowers(list);
        setCompany(loaded);
      })
      .catch(() => setMissing(true));
  };

  useEffect(load, [handle]);
  useLive(['job', 'clock', 'reconnected'], load);

  if (missing) return <EmptyState heading="h1" sentence="We couldn't find that page." action={{ label: 'Go to Home', to: '/feed' }} />;
  if (!company) return null;

  const toggleFollow = async (): Promise<void> => {
    setAlert('');
    try {
      if (company.following) await api.delete(`/api/follows/${company.id}`);
      else await api.post('/api/follows', { target_id: company.id });
      load();
    } catch {
      setAlert(SOMETHING_WENT_WRONG);
    }
  };

  return (
    <div className="stack company-page">
      <header className="stack-s">
        <h1 className="page-title">{company.name}</h1>
        {company.location ? <p className="muted">{company.location}</p> : null}
        <p className="t-larger">{plural(company.follower_count, 'follower')}</p>
        {company.about ? <p className="job-description">{company.about}</p> : null}
      </header>
      <div className="row">
        <Button aria-pressed={company.following} onClick={() => void toggleFollow()}>
          {company.following ? 'Following' : 'Follow'}
        </Button>
        {company.is_admin ? <Button onClick={() => setPosting(true)}>Post a job</Button> : null}
        {company.is_admin ? <Button onClick={() => setEditing(true)}>Edit page</Button> : null}
      </div>
      <Alert>{alert}</Alert>
      <section className="stack-s section-gap" aria-labelledby="company-jobs">
        <h2 id="company-jobs" className="t-larger">
          Open jobs
        </h2>
        {company.open_jobs.length > 0 ? <JobCards jobs={company.open_jobs} label="Open jobs" /> : <p className="muted">No open jobs.</p>}
      </section>
      {company.is_admin ? (
        <section className="stack-s section-gap step-2" aria-labelledby="company-followers">
          <h2 id="company-followers" className="t-larger">
            Followers
          </h2>
          {followers && followers.length > 0 ? (
            <ul className="plain-list followers" aria-label="Followers">
              {followers.map((follower) => (
                <li key={follower.id} className="surface">
                  <Link className="follower-name" to={`/in/${follower.handle}`}>{follower.name}</Link>
                  <p className="muted">{follower.headline}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No followers yet.</p>
          )}
        </section>
      ) : null}
      {company.is_admin ? (
        <>
          <PostJobDialog
            companyId={company.id}
            open={posting}
            onClose={() => setPosting(false)}
            onPublished={() => {
              setPosting(false);
              load();
            }}
          />
          <EditCompanyDialog
            handle={company.handle}
            initial={{ name: company.name, location: company.location, about: company.about }}
            open={editing}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              load();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
