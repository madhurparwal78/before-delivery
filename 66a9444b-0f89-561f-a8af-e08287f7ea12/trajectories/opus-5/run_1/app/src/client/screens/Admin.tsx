import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { formatDeadline } from '../lib/festival.js';
import { useUser } from '../lib/store.js';
import type { AuditEntry, Named, PricePolicy, Role, User } from '../lib/types.js';
import type { JSX } from 'react';

const ROLES: Role[] = [
  'visitor',
  'group_booker',
  'artist',
  'curator',
  'box_office',
  'finance',
  'admin',
];

interface Edition {
  name: string;
  first_day: string;
  last_day: string;
}

export function AdminScreen(): JSX.Element {
  const { user, loading } = useUser();
  const [staff, setStaff] = useState<User[]>([]);
  const [venues, setVenues] = useState<Named[]>([]);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [policy, setPolicy] = useState<PricePolicy | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [status, setStatus] = useState('');
  const [newStaff, setNewStaff] = useState({
    email: '',
    name: '',
    password: '',
    role: 'box_office' as Role,
    organisation_id: '',
  });
  const [newVenue, setNewVenue] = useState({ id: '', name: '' });

  const load = useCallback(async () => {
    const [staffBody, venueBody, editionBody, policyBody, auditBody] = await Promise.all([
      request<{ users: User[] }>('/api/admin/staff'),
      request<{ venues: Named[] }>('/api/admin/venues'),
      request<Edition>('/api/admin/edition'),
      request<PricePolicy>('/api/admin/price-policy'),
      request<{ entries: AuditEntry[] }>('/api/admin/audit?limit=60'),
    ]);
    setStaff(staffBody.users);
    setVenues(venueBody.venues);
    setEdition(editionBody);
    setPolicy(policyBody);
    setAudit(auditBody.entries);
  }, []);

  useEffect(() => {
    if (user === null || user.role !== 'admin') return;
    void load();
  }, [user, load]);

  if (loading) return <section className="wide ground-paper">Loading…</section>;
  if (user === null || user.role !== 'admin') {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Admin</h1>
        <p>Only admins can use this screen.</p>
      </section>
    );
  }

  const changeRole = async (member: User, role: Role): Promise<void> => {
    try {
      await request(`/api/admin/staff/${member.id}`, {
        method: 'PATCH',
        body: { role, organisation_id: role === 'group_booker' ? member.organisation_id : null },
      });
      setStatus('Saved.');
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'last_admin'
          ? 'There must be at least one admin.'
          : 'That change was refused.',
      );
    }
  };

  const addStaff = async (): Promise<void> => {
    try {
      await request('/api/admin/staff', {
        method: 'POST',
        body: {
          email: newStaff.email,
          name: newStaff.name,
          password: newStaff.password,
          role: newStaff.role,
          organisation_id: newStaff.organisation_id === '' ? null : newStaff.organisation_id,
        },
      });
      setStatus('Saved.');
      setNewStaff({ email: '', name: '', password: '', role: 'box_office', organisation_id: '' });
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'email_taken'
          ? 'An account with this email already exists.'
          : 'Check the details and try again.',
      );
    }
  };

  const addVenue = async (): Promise<void> => {
    try {
      await request('/api/admin/venues', { method: 'POST', body: newVenue });
      setStatus('Saved.');
      setNewVenue({ id: '', name: '' });
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'venue_exists'
          ? 'That venue id already exists.'
          : 'Check the venue id and name.',
      );
    }
  };

  const saveEdition = async (): Promise<void> => {
    if (edition === null) return;
    try {
      await request('/api/admin/edition', { method: 'PUT', body: edition });
      setStatus('Saved.');
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'sessions_outside_edition'
          ? 'Those dates would exclude existing sessions.'
          : 'Check the festival dates.',
      );
    }
  };

  const savePrices = async (): Promise<void> => {
    if (policy === null) return;
    try {
      const saved = await request<PricePolicy>('/api/admin/price-policy', {
        method: 'PUT',
        headers: { 'if-match': String(policy.version) },
        body: {
          full_festival_full_cents: policy.full_festival_full_cents,
          full_festival_reduced_cents: policy.full_festival_reduced_cents,
          day_full_cents: policy.day_full_cents,
          day_reduced_cents: policy.day_reduced_cents,
          group_discount_percent: policy.group_discount_percent,
        },
      });
      setPolicy(saved);
      setStatus('Saved.');
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus(
        error.failure.code === 'stale_version'
          ? 'Someone else changed these prices. Reload to see their version.'
          : 'Check the prices and try again.',
      );
    }
  };

  return (
    <section className="admin wide ground-paper">
      <h1 className="display">Admin</h1>
      <p className="status" role="status" aria-label="Admin status">
        {status}
      </p>

      <table className="ruled" aria-label="Staff">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <tr key={member.id}>
              <td>{member.name}</td>
              <td>{member.email}</td>
              <td>
                <label>
                  <span className="visually-hidden">{`Role for ${member.name}`}</span>
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    onChange={(event) => void changeRole(member, event.target.value as Role)}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <fieldset>
        <legend>Add staff member</legend>
        <div className="field">
          <label htmlFor="staff-name">Name</label>
          <input
            id="staff-name"
            type="text"
            value={newStaff.name}
            onChange={(event) => setNewStaff({ ...newStaff, name: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="staff-email">Email</label>
          <input
            id="staff-email"
            type="email"
            value={newStaff.email}
            onChange={(event) => setNewStaff({ ...newStaff, email: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="staff-password">Password</label>
          <input
            id="staff-password"
            type="password"
            value={newStaff.password}
            onChange={(event) => setNewStaff({ ...newStaff, password: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="staff-role">Role</label>
          <select
            id="staff-role"
            value={newStaff.role}
            onChange={(event) => setNewStaff({ ...newStaff, role: event.target.value as Role })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="staff-organisation">Organisation id</label>
          <input
            id="staff-organisation"
            type="text"
            value={newStaff.organisation_id}
            onChange={(event) => setNewStaff({ ...newStaff, organisation_id: event.target.value })}
          />
        </div>
        <button type="button" className="primary" onClick={() => void addStaff()}>
          Add staff member
        </button>
      </fieldset>

      <table className="ruled" aria-label="Venues">
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">Name</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => (
            <tr key={venue.id}>
              <td className="figures">{venue.id}</td>
              <td>{venue.name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <fieldset>
        <legend>Add venue</legend>
        <div className="field">
          <label htmlFor="venue-id">Venue id</label>
          <input
            id="venue-id"
            type="text"
            value={newVenue.id}
            onChange={(event) => setNewVenue({ ...newVenue, id: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="venue-name">Venue name</label>
          <input
            id="venue-name"
            type="text"
            value={newVenue.name}
            onChange={(event) => setNewVenue({ ...newVenue, name: event.target.value })}
          />
        </div>
        <button type="button" className="primary" onClick={() => void addVenue()}>
          Add venue
        </button>
      </fieldset>

      {edition !== null ? (
        <fieldset>
          <legend>Edition</legend>
          <div className="field">
            <label htmlFor="edition-first">First festival day</label>
            <input
              id="edition-first"
              type="text"
              value={edition.first_day}
              onChange={(event) => setEdition({ ...edition, first_day: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="edition-last">Last festival day</label>
            <input
              id="edition-last"
              type="text"
              value={edition.last_day}
              onChange={(event) => setEdition({ ...edition, last_day: event.target.value })}
            />
          </div>
          <button type="button" className="primary" onClick={() => void saveEdition()}>
            Save edition
          </button>
        </fieldset>
      ) : null}

      {policy !== null ? (
        <fieldset>
          <legend>Prices</legend>
          <div className="field">
            <label htmlFor="price-ff-full">Full-festival pass, full rate</label>
            <input
              id="price-ff-full"
              type="text"
              inputMode="numeric"
              value={policy.full_festival_full_cents}
              onChange={(event) =>
                setPolicy({ ...policy, full_festival_full_cents: Number(event.target.value) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="price-ff-reduced">Full-festival pass, reduced rate</label>
            <input
              id="price-ff-reduced"
              type="text"
              inputMode="numeric"
              value={policy.full_festival_reduced_cents}
              onChange={(event) =>
                setPolicy({ ...policy, full_festival_reduced_cents: Number(event.target.value) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="price-day-full">Day pass, full rate</label>
            <input
              id="price-day-full"
              type="text"
              inputMode="numeric"
              value={policy.day_full_cents}
              onChange={(event) => setPolicy({ ...policy, day_full_cents: Number(event.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="price-day-reduced">Day pass, reduced rate</label>
            <input
              id="price-day-reduced"
              type="text"
              inputMode="numeric"
              value={policy.day_reduced_cents}
              onChange={(event) =>
                setPolicy({ ...policy, day_reduced_cents: Number(event.target.value) })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="price-group">Group discount percent</label>
            <input
              id="price-group"
              type="text"
              inputMode="numeric"
              value={policy.group_discount_percent}
              onChange={(event) =>
                setPolicy({ ...policy, group_discount_percent: Number(event.target.value) })
              }
            />
          </div>
          <button type="button" className="primary" onClick={() => void savePrices()}>
            Save prices
          </button>
        </fieldset>
      ) : null}

      <table className="ruled" aria-label="Audit trail">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((entry) => (
            <tr key={entry.id}>
              <td className="figures">{formatDeadline(entry.at)}</td>
              <td>{`${entry.actor} (${entry.actor_role})`}</td>
              <td>{entry.action}</td>
              <td className="figures">{`${entry.target_type} ${entry.target_id}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
