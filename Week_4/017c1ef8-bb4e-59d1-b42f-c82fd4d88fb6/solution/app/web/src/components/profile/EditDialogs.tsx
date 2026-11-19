import { Field } from '../../ui';
import { Button } from '../../ui';
import type { EducationEntry, ExperienceEntry, Profile } from '../../types';
import { SectionDialog } from './SectionDialog';

interface Common {
  profile: Profile;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const versionOf = (profile: Profile, section: 'intro' | 'about' | 'experience' | 'education'): number => profile.versions?.[section] ?? 1;

interface IntroForm {
  name: string;
  headline: string;
  location: string;
}

export function EditIntroDialog({ profile, open, onClose, onSaved }: Common) {
  return (
    <SectionDialog<IntroForm>
      name="Edit intro"
      section="intro"
      open={open}
      onClose={onClose}
      version={versionOf(profile, 'intro')}
      initial={{ name: profile.name, headline: profile.headline, location: profile.location ?? '' }}
      fromCurrent={(current) => ({ name: text(current.name), headline: text(current.headline), location: text(current.location) })}
      toBody={(form) => ({ ...form })}
      labelOf={(path) => path.charAt(0).toUpperCase() + path.slice(1)}
      onSaved={onSaved}
    >
      {(form, setForm, errors) => (
        <>
          <Field label="Name" name="name" value={form.name} error={errors.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Field label="Headline" name="headline" value={form.headline} error={errors.headline} onChange={(event) => setForm({ ...form, headline: event.target.value })} />
          <Field label="Location" name="location" value={form.location} error={errors.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
        </>
      )}
    </SectionDialog>
  );
}

export function EditAboutDialog({ profile, open, onClose, onSaved }: Common) {
  return (
    <SectionDialog<{ about: string }>
      name="Edit about"
      section="about"
      open={open}
      onClose={onClose}
      version={versionOf(profile, 'about')}
      initial={{ about: profile.about ?? '' }}
      fromCurrent={(current) => ({ about: text(current.about) })}
      toBody={(form) => ({ ...form })}
      labelOf={() => 'About'}
      onSaved={onSaved}
    >
      {(form, setForm, errors) => (
        <Field label="About" name="about" multiline rows={8} value={form.about} error={errors.about} onChange={(event) => setForm({ about: event.target.value })} />
      )}
    </SectionDialog>
  );
}

interface Row {
  first: string;
  second: string;
  start: string;
  end: string;
}

const MONTH_FIELD = { start: 'Start', end: 'End' } as const;

interface RowsProps {
  rows: Row[];
  setRows: (next: Row[]) => void;
  errors: Record<string, string>;
  prefix: 'experience' | 'education';
  labels: { first: string; second: string; add: string; remove: string; firstKey: string; secondKey: string };
}

/** The rows of an experience or education form: two text fields and the start and end months per row. */
function Rows({ rows, setRows, errors, prefix, labels }: RowsProps) {
  const change = (index: number, patch: Partial<Row>): void => setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="stack-s">
      {rows.map((row, index) => (
        <fieldset key={index} className="pf-row-fieldset">
          <Field label={labels.first} name={`${prefix}-${index}-${labels.firstKey}`} value={row.first} error={errors[`${prefix}.${index}.${labels.firstKey}`]} onChange={(event) => change(index, { first: event.target.value })} />
          <Field label={labels.second} name={`${prefix}-${index}-${labels.secondKey}`} value={row.second} error={errors[`${prefix}.${index}.${labels.secondKey}`]} onChange={(event) => change(index, { second: event.target.value })} />
          <Field label={MONTH_FIELD.start} name={`${prefix}-${index}-start`} hint="YYYY-MM" value={row.start} error={errors[`${prefix}.${index}.start`]} onChange={(event) => change(index, { start: event.target.value })} />
          <Field label={MONTH_FIELD.end} name={`${prefix}-${index}-end`} hint="YYYY-MM, empty while current" value={row.end} error={errors[`${prefix}.${index}.end`]} onChange={(event) => change(index, { end: event.target.value })} />
          <Button className="pf-quiet" onClick={() => setRows(rows.filter((_, at) => at !== index))}>
            {`${labels.remove} ${index + 1}`}
          </Button>
        </fieldset>
      ))}
      <Button className="pf-quiet" onClick={() => setRows([...rows, { first: '', second: '', start: '', end: '' }])}>
        {labels.add}
      </Button>
    </div>
  );
}

const rowLabel = (path: string, firstLabel: string, secondLabel: string, first: string, second: string): string => {
  const [, index, field] = path.split('.');
  const place = Number(index) + 1;
  const named = field === first ? firstLabel : field === second ? secondLabel : field === 'start' ? 'Start' : 'End';
  return `${named} ${place}`;
};

export function EditExperienceDialog({ profile, open, onClose, onSaved }: Common) {
  const toRows = (entries: ExperienceEntry[]): Row[] => entries.map((entry) => ({ first: entry.title, second: entry.company, start: entry.start, end: entry.end ?? '' }));
  const fromCurrent = (current: Record<string, unknown>): Row[] => toRows((current.experience ?? []) as ExperienceEntry[]);
  return (
    <SectionDialog<Row[]>
      name="Edit experience"
      section="experience"
      open={open}
      onClose={onClose}
      version={versionOf(profile, 'experience')}
      initial={toRows(profile.experience ?? [])}
      fromCurrent={fromCurrent}
      toBody={(rows) => ({ experience: rows.map((row) => ({ title: row.first, company: row.second, start: row.start, end: row.end.trim() === '' ? null : row.end.trim() })) })}
      labelOf={(path) => rowLabel(path, 'Title', 'Company', 'title', 'company')}
      onSaved={onSaved}
    >
      {(rows, setRows, errors) => (
        <Rows rows={rows} setRows={setRows} errors={errors} prefix="experience" labels={{ first: 'Title', second: 'Company', firstKey: 'title', secondKey: 'company', add: 'Add experience', remove: 'Remove experience' }} />
      )}
    </SectionDialog>
  );
}

export function EditEducationDialog({ profile, open, onClose, onSaved }: Common) {
  const toRows = (entries: EducationEntry[]): Row[] => entries.map((entry) => ({ first: entry.school, second: entry.degree, start: entry.start, end: entry.end ?? '' }));
  const fromCurrent = (current: Record<string, unknown>): Row[] => toRows((current.education ?? []) as EducationEntry[]);
  return (
    <SectionDialog<Row[]>
      name="Edit education"
      section="education"
      open={open}
      onClose={onClose}
      version={versionOf(profile, 'education')}
      initial={toRows(profile.education ?? [])}
      fromCurrent={fromCurrent}
      toBody={(rows) => ({ education: rows.map((row) => ({ school: row.first, degree: row.second, start: row.start, end: row.end.trim() === '' ? null : row.end.trim() })) })}
      labelOf={(path) => rowLabel(path, 'School', 'Degree', 'school', 'degree')}
      onSaved={onSaved}
    >
      {(rows, setRows, errors) => (
        <Rows rows={rows} setRows={setRows} errors={errors} prefix="education" labels={{ first: 'School', second: 'Degree', firstKey: 'school', secondKey: 'degree', add: 'Add education', remove: 'Remove education' }} />
      )}
    </SectionDialog>
  );
}
