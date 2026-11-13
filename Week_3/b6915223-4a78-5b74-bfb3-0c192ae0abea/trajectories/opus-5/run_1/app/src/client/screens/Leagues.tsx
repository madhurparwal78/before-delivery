import { useEffect, useState } from 'react';
import type { LeagueSummary } from '../../shared/types.ts';
import { api, RequestFailed } from '../api.ts';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { Link } from '../router.tsx';

export const Leagues = () => {
  const announce = useAnnounce();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<'create' | 'join' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const refresh = async (): Promise<void> => {
    setLeagues((await api.leagues()).leagues);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending('create');
    setFieldErrors({});
    try {
      const league = await api.createLeague(name);
      setName('');
      await refresh();
      announce('League updates', `League created. Share code ${league.code ?? ''}.`);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.body.fields !== undefined) setFieldErrors(error.body.fields);
      announce('League updates', error.body.message);
    } finally {
      setPending(null);
    }
  };

  const join = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending('join');
    setFieldErrors({});
    try {
      const league = await api.joinLeague(code);
      setCode('');
      await refresh();
      announce('League updates', `Joined ${league.name}.`);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.status === 404) announce('League updates', 'No league uses that code.');
      else if (error.status === 409) announce('League updates', 'You are already in this league.');
      else {
        if (error.body.fields !== undefined) setFieldErrors(error.body.fields);
        announce('League updates', error.body.message);
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="page">
      <h1>Leagues</h1>
      <table aria-label="My leagues" className="figures-table">
        <thead>
          <tr>
            <th scope="col">League</th>
            <th scope="col">Rank</th>
            <th scope="col">Members</th>
          </tr>
        </thead>
        <tbody>
          {leagues.map((league) => (
            <tr key={league.id}>
              <td>
                <Link to={`/leagues/${league.id}`}>{league.name}</Link>
              </td>
              <td className="mono">{league.rank ?? '—'}</td>
              <td className="mono">{league.members}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={create} className="stack">
        <label htmlFor="league-name">League name</label>
        <input
          id="league-name"
          value={name}
          aria-describedby={fieldErrors.name === undefined ? undefined : 'league-name-error'}
          onChange={(event) => setName(event.target.value)}
        />
        {fieldErrors.name !== undefined && (
          <p id="league-name-error" className="field-error">
            {fieldErrors.name}
          </p>
        )}
        <button type="submit" disabled={pending === 'create'}>
          {pending === 'create' ? 'Creating…' : 'Create league'}
        </button>
      </form>

      <form onSubmit={join} className="stack">
        <label htmlFor="join-code">Join code</label>
        <input
          id="join-code"
          value={code}
          className="mono"
          aria-describedby={fieldErrors.code === undefined ? undefined : 'join-code-error'}
          onChange={(event) => setCode(event.target.value)}
        />
        {fieldErrors.code !== undefined && (
          <p id="join-code-error" className="field-error">
            {fieldErrors.code}
          </p>
        )}
        <button type="submit" disabled={pending === 'join'}>
          {pending === 'join' ? 'Joining…' : 'Join league'}
        </button>
      </form>

      <LiveRegion name="League updates" />
    </section>
  );
};
