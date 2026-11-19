import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import { announce } from '../main.js';
import type { EducationEntry, ExperienceEntry, Profile, SkillRow } from '../types.js';
import { degreeLabel, degreeNumeral, mutualLineText, firstNameOf, skillRowText } from '../format.js';
import { Dialog, Menu, MenuItem } from '../dialog.js';

const CONNECTION_BUTTONS: Record<string, string[]> = {
  none: ['Connect'],
  pending_sent: ['Withdraw'],
  pending_received: ['Accept', 'Ignore'],
  withdrawn: ['Connect'],
  ignored: ['Connect'],
  connected: ['Message', 'Remove connection'],
  blocked: [],
};

/** The Degree Roll: numeral swaps through the fixed slot over 480ms. */
const DegreeRoll = ({ degree, reduceMotion }: { degree: string; reduceMotion: boolean }): JSX.Element => {
  const [displayed, setDisplayed] = useState(degree);
  const [rolling, setRolling] = useState(false);
  const previous = useRef(degree);

  useEffect(() => {
    if (previous.current === degree) { setDisplayed(degree); return; }
    previous.current = degree;
    setDisplayed(degree);
    if (reduceMotion) return;
    setRolling(true);
    const timeout = setTimeout(() => setRolling(false), 480);
    return () => clearTimeout(timeout);
  }, [degree, reduceMotion]);

  const numeral = degreeNumeral(degree);
  const oldNumeral = degreeNumeral(displayed === degree ? displayed : displayed);

  return (
    <div
      className="degree-numeral"
      data-degree-roll
      data-degree={degree}
      aria-hidden="true"
    >
      <span className="numeral-slot">
        {rolling ? (
          <>
            <span className="numeral-roll roll-out" style={{ animation: 'rollOut 480ms ease-out forwards' }}>{degreeNumeral(displayed)}</span>
            <span className="numeral-roll roll-in" style={{ animation: 'rollIn 480ms ease-out forwards' }}>{numeral}</span>
          </>
        ) : (
          <span className="numeral-roll at-rest">{numeral}</span>
        )}
        <span className="visually-hidden">{oldNumeral}</span>
      </span>
    </div>
  );
};

export const ProfilePage = ({ handle }: { handle: string }): JSX.Element => {
  const { me, navigate, liveEvents, reduceMotion, config } = useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [blockedHere, setBlockedHere] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<{ path: ({ id: string; name: string; handle: string } | { private: boolean })[] } | null>(null);

  const isOwn = me?.handle === handle;

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.get<Profile>(`/api/profiles/${handle}`);
      setProfile(result);
      setMissing(false);
      setBlockedHere(false);
    } catch (err) {
      const e2 = err as { status?: number; body?: { error?: string } };
      setMissing(true);
      setProfile(null);
      void e2;
    }
    try {
      if (!isOwn) {
        const result = await api.get<{ path: ({ id: string; name: string; handle: string } | { private: boolean })[] }>(`/api/profiles/${handle}/path`);
        setPath(result);
      }
    } catch { setPath(null); }
  }, [handle, isOwn]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'connection' || event === 'profile_update' || event === 'blocked' || event === 'blocked_by' || event === 'clock') {
        void load();
      }
    });
  }, [liveEvents, load]);

  const connect = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await api.post<{ state: string }>(`/api/connections`, { member_id: profile.id });
      announce('Network announcements', `Invitation sent to ${profile.name}.`);
      await load();
    } catch (err) {
      const e2 = err as { status?: number; body?: { error?: string; retry_at?: string; limit?: number } };
      if (e2.body?.error === 'invite_cooldown' && e2.body.retry_at) {
        const retry = new Date(e2.body.retry_at);
        const tz = config?.time_zone ?? 'UTC';
        const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(retry);
        const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(retry).replace(/\u202f/g, ' ');
        announce('Network announcements', `You withdrew an invitation to ${profile.name}. You can invite them again on ${date} at ${time}.`);
      } else if (e2.body?.error === 'weekly_invite_limit') {
        announce('Network announcements', `You've reached the weekly invitation limit of ${(e2.body.limit ?? 0).toLocaleString('en-US')}.`);
      } else if (e2.status === 404) {
        setBlockedHere(true);
      } else {
        announce('Network announcements', 'Invitation not sent.');
      }
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/connections/${profile.id}/withdraw`, {});
      announce('Network announcements', 'Invitation withdrawn.');
      await load();
    } catch {
      announce('Network announcements', 'Invitation not sent.');
    } finally {
      setBusy(false);
    }
  };

  const accept = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/connections/${profile.id}/accept`, {});
      announce('Network announcements', `You are now connected with ${profile.name}. 1st degree.`);
      await load();
    } catch {
      announce('Network announcements', 'Invitation not sent.');
    } finally {
      setBusy(false);
    }
  };

  const ignore = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/connections/${profile.id}/ignore`, {});
      announce('Network announcements', 'Invitation ignored.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeConnection = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await api.delete(`/api/connections/${profile.id}`);
      announce('Network announcements', 'Connection removed.');
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const block = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/blocks`, { member_id: profile.id });
      announce('Network announcements', `You blocked ${profile.name}.`);
      setBlockOpen(false);
      setBlockedHere(true);
      setProfile(null);
      setMissing(true);
    } finally {
      setBusy(false);
    }
  };

  const follow = async (): Promise<void> => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      if (profile.following) {
        await api.delete(`/api/follows/${profile.id}`);
      } else {
        await api.post(`/api/follows`, { target_id: profile.id });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const message = (): void => {
    navigate(`/messaging/with/${handle}`);
  };

  if (missing || blockedHere || !profile) {
    return (
      <div className="big-empty">
        <h2>This profile isn't available</h2>
        {blockedHere && profile && (
          <>
            <p>You blocked {profile.name}.</p>
            <a href="/settings" onClick={(e) => { e.preventDefault(); navigate('/settings'); }}>Manage blocked members</a>
          </>
        )}
        {!blockedHere && <a href="/feed" onClick={(e) => { e.preventDefault(); navigate('/feed'); }}>Go to Home</a>}
      </div>
    );
  }

  const state = profile.connection_state ?? 'none';
  const buttons = CONNECTION_BUTTONS[state] ?? ['Connect'];
  const mutual = profile.mutual;
  const mutualText = mutual ? mutualLineText(mutual.count, mutual.named?.name ?? null) : '';
  const visibilityLabel = { public: 'Public', connections: 'Connections only', private: 'Private' }[profile.visibility] ?? 'Public';

  const placeholder = profile.visibility === 'connections' && state !== 'connected'
    ? `${firstNameOf(profile.name)} shares experience, education and skills with connections only.`
    : profile.visibility === 'private'
      ? `${firstNameOf(profile.name)} keeps this profile private.`
      : null;

  return (
    <>
      <div className="profile-top">
        {!isOwn && <DegreeRoll degree={profile.degree} reduceMotion={reduceMotion} />}
        {!isOwn && (
          <>
            <span className="degree-label-badge" data-degree-badge data-degree={profile.degree}>{degreeLabel(profile.degree)}</span>
            <a
              href={`/in/${handle}/mutual`}
              className="mutual-line"
              data-mutual-line
              data-count={mutual?.count ?? 0}
              onClick={(e) => { e.preventDefault(); navigate(`/in/${handle}/mutual`); }}
              style={{ visibility: (mutual?.count ?? 0) > 0 ? 'visible' : 'hidden' }}
            >
              {mutualText || '\u00a0'}
            </a>
          </>
        )}
        <h1 className="profile-name">{profile.name}</h1>
        {profile.headline && <p className="profile-headline">{profile.headline}</p>}
        {profile.location && <p className="profile-location">{profile.location}</p>}
        <div className="action-row">
          {buttons.includes('Connect') && (
            <button type="button" className="pink-button" onClick={() => { void connect(); }} disabled={busy}>Connect</button>
          )}
          {buttons.includes('Withdraw') && (
            <button type="button" className="text-button" onClick={() => { void withdraw(); }} disabled={busy}>Withdraw</button>
          )}
          {buttons.includes('Accept') && (
            <button type="button" className="pink-button" onClick={() => { void accept(); }} disabled={busy}>Accept</button>
          )}
          {buttons.includes('Ignore') && (
            <button type="button" className="text-button" onClick={() => { void ignore(); }} disabled={busy}>Ignore</button>
          )}
          {buttons.includes('Message') && (
            <button type="button" className="pink-button" onClick={message} disabled={busy}>Message</button>
          )}
          {buttons.includes('Remove connection') && (
            <button type="button" className="text-button" onClick={() => setDialog('remove')} disabled={busy}>Remove connection</button>
          )}
          {!isOwn && (
            <button type="button" className="text-button" aria-pressed={Boolean(profile.following)} onClick={() => { void follow(); }} disabled={busy}>
              {profile.following ? 'Following' : 'Follow'}
            </button>
          )}
          {isOwn && (
            <button type="button" className="text-button" onClick={() => { void api.post('/api/auth/signout', {}).then(() => { window.location.href = '/'; }); }}>
              Sign out
            </button>
          )}
          {!isOwn && (
            <>
              <button type="button" className="text-button" onClick={() => setMenuOpen(true)}>More actions</button>
              {menuOpen && (
                <Menu label="More actions" onClose={() => setMenuOpen(false)} align="right">
                  <MenuItem label={`Block ${profile.name}`} danger onSelect={() => { setMenuOpen(false); setBlockOpen(true); }} />
                </Menu>
              )}
            </>
          )}
        </div>
      </div>

      {path && path.path.length > 0 && (
        <section aria-label="How you're connected" className="profile-section">
          <h3>How you're connected</h3>
          <ul aria-label="Connection path">
            {path.path.map((entry, index) => (
              <li key={index}>
                {'private' in entry ? <span>Private member</span> : <a href={`/in/${entry.handle}`}>{entry.name}</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="profile-columns">
        <div>
          <section className="profile-section" aria-label="About">
            <h3>About</h3>
            {isOwn && <button type="button" className="text-button" onClick={() => setDialog('about')}>Edit about</button>}
            {placeholder && !isOwn ? <p>{placeholder}</p> : <p className="entry-text">{profile.about}</p>}
          </section>
          <section className="profile-section" aria-label="Experience">
            <h3>Experience</h3>
            {isOwn && <button type="button" className="text-button" onClick={() => setDialog('experience')}>Edit experience</button>}
            {placeholder && !isOwn ? <p>{placeholder}</p> : (
              <ul>
                {(profile.experience ?? []).map((experience, index) => (
                  <li key={index}>
                    <p>{experience.title}</p>
                    <p className="entry-headline">{experience.company}</p>
                    <p className="entry-time">{experience.start} — {experience.end ?? 'Present'}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div>
          <section className="profile-section" aria-label="Skills" aria-roledescription="region">
            <h3>Skills</h3>
            {isOwn && (
              <>
                <button type="button" className="text-button" onClick={() => setDialog('skills')}>Edit skills</button>
                <SkillOwnerPanel profile={profile} onSaved={load} />
              </>
            )}
            {placeholder && !isOwn ? <p>{placeholder}</p> : (
              <ul>
                {(profile.skills ?? []).map((skill) => (
                  <SkillRowView key={skill.name} skill={skill} canEndorse={!isOwn && state === 'connected'} onEndorsed={load} />
                ))}
              </ul>
            )}
          </section>
          <section className="profile-section" aria-label="Education">
            <h3>Education</h3>
            {isOwn && <button type="button" className="text-button" onClick={() => setDialog('education')}>Edit education</button>}
            {placeholder && !isOwn ? <p>{placeholder}</p> : (
              <ul>
                {(profile.education ?? []).map((education, index) => (
                  <li key={index}>
                    <p>{education.school}</p>
                    <p className="entry-headline">{education.degree}</p>
                    <p className="entry-time">{education.start} — {education.end ?? 'Present'}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {isOwn && (
        <>
          <button type="button" className="text-button" onClick={() => setDialog('intro')}>Edit intro</button>
          <button type="button" className="text-button" onClick={() => setDialog('photo')}>Change photo</button>
        </>
      )}

      {dialog === 'remove' && (
        <Dialog label="Remove connection?" onClose={() => setDialog(null)} closeButton={false}>
          <h2>Remove connection?</h2>
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => { void removeConnection(); }}>Remove</button>
            <button type="button" className="text-button" onClick={() => setDialog(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {blockOpen && (
        <Dialog label={`Block ${profile.name}?`} onClose={() => setBlockOpen(false)} closeButton={false}>
          <h2>Block {profile.name}?</h2>
          <div className="dialog-actions">
            <button type="button" className="pink-button" onClick={() => { void block(); }}>Block</button>
            <button type="button" className="text-button" onClick={() => setBlockOpen(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
      {dialog === 'intro' && <IntroDialog profile={profile} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'about' && <AboutDialog profile={profile} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'experience' && <ExperienceDialog profile={profile} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'education' && <EducationDialog profile={profile} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'skills' && <SkillsDialog profile={profile} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'photo' && <PhotoDialog onClose={() => setDialog(null)} onSaved={load} />}
      <p className="visually-hidden">Visibility: {visibilityLabel}</p>
    </>
  );
};

const SkillRowView = ({ skill, canEndorse, onEndorsed }: { skill: SkillRow; canEndorse: boolean; onEndorsed: () => void }): JSX.Element => {
  const [busy, setBusy] = useState(false);
  const endorse = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (skill.endorsed_by_me) {
        await api.delete(`/api/members/${'owner'}/skills/${encodeURIComponent(skill.name)}/endorsement`);
      }
      await onEndorsed();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li
      className="skill-row"
      data-skill={skill.name}
      data-endorsements={skill.endorsements}
      data-featured={skill.featured_position ? 'true' : undefined}
      data-featured-position={skill.featured_position ?? undefined}
    >
      <span>{skillRowText(skill.name, skill.endorsements)}</span>
      {skill.endorser_line && (
        <span className="endorser-line" data-endorser-line>{skill.endorser_line}</span>
      )}
      {canEndorse && (
        <button type="button" className="text-button" aria-pressed={skill.endorsed_by_me}
          onClick={() => { void endorse(); }} disabled={busy}>
          Endorse {skill.name}
        </button>
      )}
    </li>
  );
};

type SectionDialogProps = { profile: Profile; onClose: () => void; onSaved: () => void };

const ConflictBanner = ({ onReload, onKeep }: { onReload: () => void; onKeep: () => void }): JSX.Element => (
  <div role="alert">
    <p>Someone changed this section since you opened it.</p>
    <div className="dialog-actions">
      <button type="button" className="text-button" onClick={onReload}>Load latest</button>
      <button type="button" className="pink-button" onClick={onKeep}>Save mine anyway</button>
    </div>
  </div>
);

const IntroDialog = ({ profile, onClose, onSaved }: SectionDialogProps): JSX.Element => {
  const [name, setName] = useState(profile.name);
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [location, setLocation] = useState(profile.location ?? '');
  const [version, setVersion] = useState(profile.versions?.intro ?? 1);
  const [conflict, setConflict] = useState(false);
  const [current, setCurrent] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.patch<{ section: string; version: number }>(`/api/me/sections/intro`, { version, name, headline, location });
      setVersion(result.version);
      announce('Profile announcements', 'Section saved.');
      onSaved();
      onClose();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current_version?: number; current?: unknown } };
      if (e2.body?.error === 'version_conflict') {
        setConflict(true);
        setVersion(e2.body.current_version ?? version);
        setCurrent(e2.body.current as unknown as Profile);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Edit intro" onClose={onClose} closeButton={false}>
      <h2>Edit intro</h2>
      <label className="label" htmlFor="intro-name">Name</label>
      <input id="intro-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label" htmlFor="intro-headline">Headline</label>
      <input id="intro-headline" className="field" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      <label className="label" htmlFor="intro-location">Location</label>
      <input id="intro-location" className="field" value={location} onChange={(e) => setLocation(e.target.value)} />
      {conflict && (
        <ConflictBanner
          onReload={() => {
            setName((current?.name as string) ?? name);
            setHeadline(current?.headline ?? headline);
            setLocation(current?.location ?? location);
            setConflict(false);
          }}
          onKeep={() => { setConflict(false); void save(); }}
        />
      )}
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => { void save(); }} disabled={busy}>Save</button>
      </div>
    </Dialog>
  );
};

const AboutDialog = ({ profile, onClose, onSaved }: SectionDialogProps): JSX.Element => {
  const [about, setAbout] = useState(profile.about ?? '');
  const [version, setVersion] = useState(profile.versions?.about ?? 1);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.patch<{ version: number }>(`/api/me/sections/about`, { version, about });
      setVersion(result.version);
      announce('Profile announcements', 'Section saved.');
      onSaved();
      onClose();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current_version?: number; current?: { about?: string } } };
      if (e2.body?.error === 'version_conflict') {
        setConflict(true);
        setVersion(e2.body.current_version ?? version);
        if (e2.body.current?.about !== undefined) setAbout(e2.body.current.about);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Edit about" onClose={onClose} closeButton={false}>
      <h2>Edit about</h2>
      <label className="label" htmlFor="about-text">About</label>
      <textarea id="about-text" className="field" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} />
      {conflict && (
        <ConflictBanner onReload={() => setConflict(false)} onKeep={() => { setConflict(false); void save(); }} />
      )}
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => { void save(); }} disabled={busy}>Save</button>
      </div>
    </Dialog>
  );
};

const ExperienceDialog = ({ profile, onClose, onSaved }: SectionDialogProps): JSX.Element => {
  const [rows, setRows] = useState<ExperienceEntry[]>(profile.experience ?? []);
  const [version, setVersion] = useState(profile.versions?.experience ?? 1);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.patch<{ version: number }>(`/api/me/sections/experience`, {
        version, experience: rows.map((r) => ({ title: r.title, company: r.company, start: r.start, end: r.end })),
      });
      setVersion(result.version);
      announce('Profile announcements', 'Section saved.');
      onSaved();
      onClose();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current_version?: number } };
      if (e2.body?.error === 'version_conflict') {
        setConflict(true);
        setVersion(e2.body.current_version ?? version);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Edit experience" onClose={onClose} closeButton={false}>
      <h2>Edit experience</h2>
      {rows.map((row, index) => (
        <div key={index} className="entry">
          <label className="label" htmlFor={`exp-title-${index}`}>Title</label>
          <input id={`exp-title-${index}`} className="field" value={row.title}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, title: e.target.value } : r))} />
          <label className="label" htmlFor={`exp-company-${index}`}>Company</label>
          <input id={`exp-company-${index}`} className="field" value={row.company}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, company: e.target.value } : r))} />
          <label className="label" htmlFor={`exp-start-${index}`}>Start</label>
          <input id={`exp-start-${index}`} className="field" value={row.start}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, start: e.target.value } : r))} />
          <label className="label" htmlFor={`exp-end-${index}`}>End</label>
          <input id={`exp-end-${index}`} className="field" value={row.end ?? ''}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, end: e.target.value || null } : r))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setRows((prev) => [...prev, { title: '', company: '', start: '', end: null }])}>
        Add experience
      </button>
      {conflict && <ConflictBanner onReload={() => setConflict(false)} onKeep={() => { setConflict(false); void save(); }} />}
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => { void save(); }} disabled={busy}>Save</button>
      </div>
    </Dialog>
  );
};

const EducationDialog = ({ profile, onClose, onSaved }: SectionDialogProps): JSX.Element => {
  const [rows, setRows] = useState<EducationEntry[]>(profile.education ?? []);
  const [version, setVersion] = useState(profile.versions?.education ?? 1);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.patch<{ version: number }>(`/api/me/sections/education`, {
        version, education: rows.map((r) => ({ school: r.school, degree: r.degree, start: r.start, end: r.end })),
      });
      setVersion(result.version);
      announce('Profile announcements', 'Section saved.');
      onSaved();
      onClose();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current_version?: number } };
      if (e2.body?.error === 'version_conflict') {
        setConflict(true);
        setVersion(e2.body.current_version ?? version);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Edit education" onClose={onClose} closeButton={false}>
      <h2>Edit education</h2>
      {rows.map((row, index) => (
        <div key={index} className="entry">
          <label className="label" htmlFor={`edu-school-${index}`}>School</label>
          <input id={`edu-school-${index}`} className="field" value={row.school}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, school: e.target.value } : r))} />
          <label className="label" htmlFor={`edu-degree-${index}`}>Degree</label>
          <input id={`edu-degree-${index}`} className="field" value={row.degree}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, degree: e.target.value } : r))} />
          <label className="label" htmlFor={`edu-start-${index}`}>Start</label>
          <input id={`edu-start-${index}`} className="field" value={row.start}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, start: e.target.value } : r))} />
          <label className="label" htmlFor={`edu-end-${index}`}>End</label>
          <input id={`edu-end-${index}`} className="field" value={row.end ?? ''}
            onChange={(e) => setRows((prev) => prev.map((r, i) => i === index ? { ...r, end: e.target.value || null } : r))} />
        </div>
      ))}
      <button type="button" className="text-button" onClick={() => setRows((prev) => [...prev, { school: '', degree: '', start: '', end: null }])}>
        Add education
      </button>
      {conflict && <ConflictBanner onReload={() => setConflict(false)} onKeep={() => { setConflict(false); void save(); }} />}
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => { void save(); }} disabled={busy}>Save</button>
      </div>
    </Dialog>
  );
};

const SkillsDialog = ({ profile, onClose, onSaved }: SectionDialogProps): JSX.Element => {
  const { config } = useApp();
  const [skills, setSkills] = useState<string[]>((profile.skills ?? []).map((s) => s.name));
  const [featured, setFeatured] = useState<string[]>((profile.skills ?? []).filter((s) => s.featured_position !== null).map((s) => s.name));
  const [version, setVersion] = useState(profile.versions?.skills ?? 1);
  const [newSkill, setNewSkill] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const maxSkills = config?.max_skills ?? 50;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.patch<{ version: number; current: { skills: string[]; featured: string[] } }>(`/api/me/sections/skills`, {
        version, skills, featured,
      });
      setVersion(result.version);
      announce('Profile announcements', 'Section saved.');
      onSaved();
      onClose();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current_version?: number; current?: { skills: string[]; featured: string[] }; limit?: number } };
      if (e2.body?.error === 'version_conflict') {
        setConflict(true);
        setVersion(e2.body.current_version ?? version);
        if (e2.body.current) {
          setSkills(e2.body.current.skills);
          setFeatured(e2.body.current.featured);
        }
      } else if (e2.body?.error === 'skill_limit') {
        setError(`You can list up to ${(e2.body.limit ?? maxSkills).toLocaleString('en-US')} skills.`);
      } else if (e2.body?.error === 'featured_limit') {
        setError('You can feature up to 3 skills.');
      }
    } finally {
      setBusy(false);
    }
  };

  const addSkill = (): void => {
    const name = newSkill.trim();
    if (name.length === 0) return;
    if (skills.length + 1 > maxSkills) {
      setError(`You can list up to ${maxSkills.toLocaleString('en-US')} skills.`);
      return;
    }
    setError(null);
    setSkills((prev) => [...prev, name]);
    setNewSkill('');
  };

  return (
    <Dialog label="Edit skills" onClose={onClose} closeButton={false}>
      <h2>Skills</h2>
      {error && <div role="alert">{error}</div>}
      <ul>
        {skills.map((skill) => (
          <li key={skill} className="skill-row">
            <span>{skill}</span>
            <button type="button" className="text-button" onClick={() => setSkills((prev) => prev.filter((s) => s !== skill))}>
              Remove {skill}
            </button>
            {!featured.includes(skill) ? (
              <button type="button" className="text-button" onClick={() => setFeatured((prev) => [...prev, skill])}>
                Feature {skill}
              </button>
            ) : (
              <button type="button" className="text-button" onClick={() => setFeatured((prev) => prev.filter((s) => s !== skill))}>
                Unfeature {skill}
              </button>
            )}
          </li>
        ))}
      </ul>
      <label className="label" htmlFor="new-skill">Add a skill</label>
      <input id="new-skill" className="field" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} />
      <button type="button" className="text-button" onClick={addSkill}>Add skill</button>
      {conflict && <ConflictBanner onReload={() => setConflict(false)} onKeep={() => { setConflict(false); void save(); }} />}
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => { void save(); }} disabled={busy}>Save</button>
      </div>
    </Dialog>
  );
};

const PhotoDialog = ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): JSX.Element => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog label="Change photo" onClose={onClose} closeButton={false}>
      <h2>Change photo</h2>
      {error && <div role="alert">{error}</div>}
      <input
        type="file"
        aria-label="Photo"
        accept="image/jpeg,image/png"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.append('file', file);
            const response = await fetch('/api/uploads/photo', { method: 'POST', body: form });
            const body = await response.json() as { photo_id?: string; error?: string; limit?: number };
            if (!response.ok) {
              if (body.error === 'photo_too_large') setError(`Photos can be up to ${(body.limit ?? 0).toLocaleString('en-US')} bytes.`);
              else if (body.error === 'storage_unavailable') setError('Uploads are unavailable right now. Try again later.');
              else setError('Choose a JPEG or PNG image.');
            } else if (body.photo_id) {
              await api.put('/api/me/photo', { photo_id: body.photo_id });
              announce('Profile announcements', 'Section saved.');
              onSaved();
              onClose();
            }
          } finally {
            setBusy(false);
          }
        }}
      />
      <div className="dialog-actions">
        <button type="button" className="pink-button" onClick={() => { void api.delete('/api/me/photo').then(() => { onSaved(); onClose(); }); }} disabled={busy}>
          Remove photo
        </button>
      </div>
    </Dialog>
  );
};

/** Owner's featured-skills listbox with keyboard reorder and drag. */
const SkillOwnerPanel = ({ profile, onSaved }: { profile: Profile; onSaved: () => void }): JSX.Element | null => {
  const featured = (profile.skills ?? []).filter((s) => s.featured_position !== null)
    .sort((a, b) => (a.featured_position ?? 0) - (b.featured_position ?? 0));
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [version, setVersion] = useState(profile.versions?.skills ?? 1);
  const listRef = useRef<HTMLDivElement | null>(null);

  if (featured.length === 0) return null;

  const skills = (profile.skills ?? []).map((s) => s.name);
  const saveOrder = async (order: string[]): Promise<void> => {
    try {
      const result = await api.patch<{ version: number }>(`/api/me/sections/skills`, {
        version, skills, featured: order,
      });
      setVersion(result.version);
      announce('Profile announcements', 'Section saved.');
      onSaved();
    } catch (err) {
      const e2 = err as { body?: { error?: string; current?: { skills: string[]; featured: string[] } } };
      if (e2.body?.error === 'version_conflict') {
        announce('Profile announcements', 'Your skills changed somewhere else. This order wasn\'t saved.');
        if (e2.body.current) setVersion(profile.versions?.skills ?? 1);
        onSaved();
      }
    }
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= featured.length) return;
    const order = featured.map((s) => s.name);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    announce('Profile announcements', `${moved} moved to position ${to + 1} of ${featured.length}.`);
    void saveOrder(order);
  };

  return (
    <div
      ref={listRef}
      className="featured-listbox"
      role="listbox"
      aria-label="Featured skills"
      tabIndex={focusIndex === null ? 0 : -1}
      onKeyDown={(e) => {
        const index = focusIndex ?? 0;
        if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex(Math.min(index + 1, featured.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex(Math.max(index - 1, 0)); }
        else if (e.key === 'Home') { e.preventDefault(); setFocusIndex(0); }
        else if (e.key === 'End') { e.preventDefault(); setFocusIndex(featured.length - 1); }
        else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(index, index - 1); setFocusIndex(Math.max(index - 1, 0)); }
        else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(index, index + 1); setFocusIndex(Math.min(index + 1, featured.length - 1)); }
      }}
    >
      {featured.map((skill, index) => (
        <div
          key={skill.name}
          role="option"
          aria-selected={focusIndex === index}
          tabIndex={-1}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer.getData('text/plain'));
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            const target = after ? index + 1 : index;
            if (from !== target) move(from, from < target ? target - 1 : target);
          }}
          onFocus={() => setFocusIndex(index)}
        >
          {skill.name}
        </div>
      ))}
    </div>
  );
};
