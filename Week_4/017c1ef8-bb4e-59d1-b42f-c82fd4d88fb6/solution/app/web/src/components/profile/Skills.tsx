import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { api, ApiError } from '../../api';
import { announce } from '../../announce';
import { formatCount, plural } from '../../format';
import type { Profile, Skill } from '../../types';
import { Alert, Button, Field } from '../../ui';

interface Props {
  profile: Profile;
  owner: boolean;
  /** The viewer is a 1st degree connection and the Degree Roll has finished: Endorse buttons are offered. */
  endorsable: boolean;
  /** Read the profile again (skills order and counts). */
  onChanged: () => Promise<void>;
}

interface SavedSkills {
  version: number;
  current: { skills: string[]; featured: string[] };
}

interface Draft {
  names: string[];
  featured: string[];
  kind: 'add' | 'remove' | 'feature' | 'move';
  /** Where focus goes when the save is refused: the moved option or the pressed row's button. */
  focus?: { skill: string; control: 'option' | 'toggle' };
}

const FEATURED_LIMIT_TEXT = 'You can feature up to 3 skills.';
const STALE_ORDER_TEXT = "Your skills changed somewhere else. This order wasn't saved.";
const SECTION_CONFLICT_TEXT = 'Someone changed this section since you opened it.';

const featuredOf = (skills: Skill[]): string[] =>
  skills
    .filter((skill) => skill.featured_position !== null)
    .sort((a, b) => (a.featured_position ?? 0) - (b.featured_position ?? 0))
    .map((skill) => skill.name);

const rowText = (skill: Skill): string => `${skill.name} · ${skill.endorsements === 0 ? 'No endorsements yet' : plural(skill.endorsements, 'endorsement')}`;

/** The order after dropping `name` on the upper or lower half of the option at `target`. */
function reordered(featured: string[], name: string, target: number, after: boolean): string[] {
  const from = featured.indexOf(name);
  const slot = target + (after ? 1 : 0);
  const rest = featured.filter((entry) => entry !== name);
  rest.splice(slot - (from < slot ? 1 : 0), 0, name);
  return rest;
}

function problemOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.body.error === 'skill_limit') return `You can list up to ${formatCount(Number(error.body.limit))} skills.`;
    if (error.body.error === 'featured_limit') return FEATURED_LIMIT_TEXT;
    if (error.body.error === 'validation') return String(error.field('skills') ?? error.field('featured') ?? 'Something went wrong. Try again.');
  }
  return 'Something went wrong. Try again.';
}

/** The skills region: rows with endorsement counts, Endorse for connections, and the owner's editing and featured list. */
export function Skills({ profile, owner, endorsable, onChanged }: Props) {
  const [skills, setSkills] = useState<Skill[]>(profile.skills ?? []);
  const [featured, setFeatured] = useState<string[]>(featuredOf(profile.skills ?? []));
  const [problem, setProblem] = useState('');
  const [conflict, setConflict] = useState<{ draft: Draft; version: number } | null>(null);
  const [newSkill, setNewSkill] = useState('');
  const [stop, setStop] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const version = useRef(profile.versions?.skills ?? 1);
  const saving = useRef(false);
  const focusAfter = useRef<string | null>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLElement>(null);

  // A fresh read replaces the local copy unless a save is in flight (the save reads again when it ends).
  useEffect(() => {
    if (saving.current) return;
    setSkills(profile.skills ?? []);
    setFeatured(featuredOf(profile.skills ?? []));
    version.current = Math.max(version.current, profile.versions?.skills ?? 0);
  }, [profile.skills, profile.versions?.skills]);

  useLayoutEffect(() => {
    const name = focusAfter.current;
    if (name === null) return;
    focusAfter.current = null;
    [...(listbox.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((option) => option.dataset.option === name)?.focus();
  }, [featured]);

  const names = skills.map((skill) => skill.name);

  const focusRevert = (draft: Draft): void => {
    if (!draft.focus) return;
    if (draft.focus.control === 'option') focusAfter.current = draft.focus.skill;
    else {
      const row = [...(region.current?.querySelectorAll<HTMLElement>('[data-skill]') ?? [])].find((item) => item.dataset.skill === draft.focus?.skill);
      row?.querySelector<HTMLElement>('[data-toggle-feature]')?.focus();
    }
  };

  const save = async (draft: Draft, sendVersion: number): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    setProblem('');
    try {
      const saved = await api.patch<SavedSkills>('/api/me/sections/skills', { version: sendVersion, skills: draft.names, featured: draft.featured });
      version.current = saved.version;
      saving.current = false;
      setConflict(null);
      await onChanged();
      return true;
    } catch (error) {
      saving.current = false;
      const stale = error instanceof ApiError && error.status === 409 && error.body.error === 'version_conflict';
      if (stale) {
        const current = error.body.current as SavedSkills['current'];
        version.current = Number(error.body.current_version);
        if (draft.kind === 'feature' || draft.kind === 'move') {
          setFeatured(current.featured);
          setProblem(STALE_ORDER_TEXT);
          focusRevert(draft);
          await onChanged().catch(() => undefined);
        } else {
          setConflict({ draft, version: version.current });
        }
      } else {
        setFeatured(featuredOf(skills));
        setProblem(problemOf(error));
        focusRevert(draft);
      }
      return false;
    }
  };

  const move = async (name: string, nextFeatured: string[]): Promise<void> => {
    if (nextFeatured.join('|') === featured.join('|')) return;
    setFeatured(nextFeatured);
    focusAfter.current = name;
    setStop(name);
    const saved = await save({ names, featured: nextFeatured, kind: 'move', focus: { skill: name, control: 'option' } }, version.current);
    if (saved) announce('Profile announcements', `${name} moved to position ${nextFeatured.indexOf(name) + 1} of ${nextFeatured.length}.`);
  };

  const toggleFeature = async (name: string): Promise<void> => {
    const next = featured.includes(name) ? featured.filter((entry) => entry !== name) : [...featured, name];
    setFeatured(next);
    const saved = await save({ names, featured: next, kind: 'feature', focus: { skill: name, control: 'toggle' } }, version.current);
    if (saved) announce('Profile announcements', 'Section saved.');
  };

  const addSkill = async (): Promise<void> => {
    const added = newSkill.trim();
    if (added === '') return;
    const saved = await save({ names: [...names, added], featured, kind: 'add' }, version.current);
    if (saved) {
      setNewSkill('');
      announce('Profile announcements', 'Section saved.');
    }
  };

  const removeSkill = async (name: string): Promise<void> => {
    const saved = await save({ names: names.filter((entry) => entry !== name), featured: featured.filter((entry) => entry !== name), kind: 'remove' }, version.current);
    if (saved) announce('Profile announcements', 'Section saved.');
  };

  const endorse = async (skill: Skill): Promise<void> => {
    if (pending) return;
    setPending(skill.name);
    setProblem('');
    const path = `/api/members/${profile.id}/skills/${encodeURIComponent(skill.name)}/endorsement`;
    try {
      const result = await (skill.endorsed_by_me ? api.delete<Skill>(path) : api.put<Skill>(path));
      setSkills((current) => current.map((entry) => (entry.name === skill.name ? { ...entry, endorsements: result.endorsements, endorsed_by_me: result.endorsed_by_me } : entry)));
      announce('Profile announcements', result.endorsed_by_me ? `Endorsed ${skill.name}.` : 'Endorsement removed.');
    } catch {
      setProblem('Something went wrong. Try again.');
    } finally {
      setPending(null);
    }
  };

  const onOptionKey = (event: ReactKeyboardEvent<HTMLDivElement>, name: string): void => {
    const index = featured.indexOf(name);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const to = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= featured.length) return;
      const next = [...featured];
      next.splice(index, 1);
      next.splice(to, 0, name);
      void move(name, next);
      return;
    }
    const options = [...(listbox.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const target = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1;
    if (target < 0 && event.key !== 'Home') return;
    event.preventDefault();
    options[Math.min(options.length - 1, Math.max(0, target))]?.focus();
  };

  const onOptionPointerDown = (event: ReactPointerEvent<HTMLDivElement>, name: string): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const start = { x: event.clientX, y: event.clientY };
    let dragged = false;
    const onMove = (moved: PointerEvent): void => {
      if (!dragged && Math.abs(moved.clientX - start.x) + Math.abs(moved.clientY - start.y) > 4) {
        dragged = true;
        setDragging(name);
      }
    };
    const onUp = (released: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragging(null);
      if (!dragged || released.type === 'pointercancel') return;
      const over = document.elementFromPoint(released.clientX, released.clientY)?.closest<HTMLElement>('[role="option"]');
      const targetName = over?.dataset.option;
      if (!over || targetName === undefined || targetName === name) return;
      const box = over.getBoundingClientRect();
      void move(name, reordered(featured, name, featured.indexOf(targetName), released.clientY > box.top + box.height / 2));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (skills.length === 0 && !owner) return null;
  const tabStop = stop !== null && featured.includes(stop) ? stop : featured[0];

  return (
    <section ref={region} className="pf-section pf-skills" aria-label="Skills">
      <h2 className="pf-section-title">Skills</h2>
      {owner && featured.length > 0 ? (
        <div className="pf-featured">
          <p className="muted" id="featured-hint">
            Featured, in order. Alt with the arrow keys moves one.
          </p>
          <div ref={listbox} role="listbox" aria-label="Featured skills" aria-describedby="featured-hint" className="pf-listbox">
            {featured.map((name) => (
              <div
                key={name}
                role="option"
                aria-selected={name === tabStop}
                tabIndex={name === tabStop ? 0 : -1}
                data-option={name}
                data-dragging={dragging === name ? 'true' : undefined}
                className="pf-option t-larger"
                onFocus={() => setStop(name)}
                onKeyDown={(event) => onOptionKey(event, name)}
                onPointerDown={(event) => onOptionPointerDown(event, name)}
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ul className="plain-list pf-skill-list">
        {skills.map((skill) => {
          const place = featured.indexOf(skill.name);
          return (
            <li
              key={skill.name}
              className="pf-skill surface"
              data-skill={skill.name}
              data-endorsements={skill.endorsements}
              data-featured={place >= 0 ? 'true' : undefined}
              data-featured-position={place >= 0 ? place + 1 : undefined}
            >
              <p className="pf-skill-line">{rowText(skill)}</p>
              {skill.endorser_line ? (
                <p className="muted" data-endorser-line>
                  {skill.endorser_line}
                </p>
              ) : null}
              <div className="pf-skill-actions">
                {endorsable && !owner ? (
                  <Button className="pf-quiet" aria-pressed={skill.endorsed_by_me} disabled={pending !== null} onClick={() => void endorse(skill)}>
                    {`Endorse ${skill.name}`}
                  </Button>
                ) : null}
                {owner ? (
                  <>
                    <Button className="pf-quiet" data-toggle-feature="" onClick={() => void toggleFeature(skill.name)}>
                      {place >= 0 ? `Unfeature ${skill.name}` : `Feature ${skill.name}`}
                    </Button>
                    <Button className="pf-quiet" onClick={() => void removeSkill(skill.name)}>
                      {`Remove ${skill.name}`}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {owner ? (
        <form
          className="pf-add-skill"
          onSubmit={(event) => {
            event.preventDefault();
            void addSkill();
          }}
        >
          <Field label="Add a skill" name="add-skill" value={newSkill} onChange={(event) => setNewSkill(event.target.value)} />
          <Button type="submit">Add skill</Button>
        </form>
      ) : null}
      <Alert>{conflict ? SECTION_CONFLICT_TEXT : problem}</Alert>
      {conflict ? (
        <div className="pf-conflict">
          <Button
            className="pf-quiet"
            onClick={() => {
              version.current = conflict.version;
              setConflict(null);
              void onChanged();
            }}
          >
            Load latest
          </Button>
          <Button className="pf-quiet" onClick={() => void save(conflict.draft, conflict.version)}>
            Save mine anyway
          </Button>
        </div>
      ) : null}
    </section>
  );
}
