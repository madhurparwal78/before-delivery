import { formatMonth } from '../../format';
import type { EducationEntry, ExperienceEntry } from '../../types';
import { LinkButton } from '../../ui';

const period = (start: string, end: string | null): string => `${formatMonth(start)} – ${end ? formatMonth(end) : 'Present'}`;

interface SectionProps {
  title: string;
  className: string;
  /** The owner's edit control: its accessible name is `Edit <section>`. */
  edit?: { label: string; onClick: () => void };
  children?: React.ReactNode;
}

function Section({ title, className, edit, children }: SectionProps) {
  return (
    <section className={`pf-section ${className}`} aria-label={title}>
      <div className="pf-section-head">
        <h2 className="pf-section-title">{title}</h2>
        {edit ? (
          <LinkButton className="pf-edit" onClick={edit.onClick}>
            {edit.label}
          </LinkButton>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function AboutSection({ about, onEdit }: { about: string; onEdit?: () => void }) {
  if (about === '' && !onEdit) return null;
  return (
    <Section title="About" className="pf-about" edit={onEdit ? { label: 'Edit about', onClick: onEdit } : undefined}>
      <p className="pf-prose">{about}</p>
    </Section>
  );
}

export function ExperienceSection({ entries, onEdit }: { entries: ExperienceEntry[]; onEdit?: () => void }) {
  if (entries.length === 0 && !onEdit) return null;
  return (
    <Section title="Experience" className="pf-experience" edit={onEdit ? { label: 'Edit experience', onClick: onEdit } : undefined}>
      <ul className="plain-list stack-s">
        {entries.map((entry, index) => (
          <li key={`${entry.title}-${entry.company}-${index}`} className="pf-entry">
            <p className="pf-entry-title">{entry.title}</p>
            <p>{entry.company}</p>
            <p className="muted">{period(entry.start, entry.end)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function EducationSection({ entries, onEdit }: { entries: EducationEntry[]; onEdit?: () => void }) {
  if (entries.length === 0 && !onEdit) return null;
  return (
    <Section title="Education" className="pf-education" edit={onEdit ? { label: 'Edit education', onClick: onEdit } : undefined}>
      <ul className="plain-list stack-s">
        {entries.map((entry, index) => (
          <li key={`${entry.school}-${entry.degree}-${index}`} className="pf-entry">
            <p className="pf-entry-title">{entry.school}</p>
            <p>{entry.degree}</p>
            <p className="muted">{period(entry.start, entry.end)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
