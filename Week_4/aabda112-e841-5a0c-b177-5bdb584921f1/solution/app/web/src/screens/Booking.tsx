import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bandage, Scissors, Stethoscope, Syringe, UtensilsCrossed, BedDouble } from 'lucide-react';
import { PUBLIC_REASONS, SPECIES, SPECIES_LABEL, type PublicReason, type Species } from '../../../shared/domain';
import { ERROR_COPY } from '../../../shared/errors';
import { ApiError, get, post } from '../lib/api';
import { hm, instantDay, longDayLabel } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { Banner, Field, Pill, PillLink, EmptyCard, Skeleton } from '../components/ui';

interface Slot {
  start: string;
  vetId: string;
  vetName: string;
}

interface Clinic {
  name: string;
  slug: string;
  vets: { id: string; name: string }[];
}

const REASON_CARDS: Record<PublicReason, { icon: ReactNode; line: string }> = {
  'Check-up': { icon: <Stethoscope size={24} aria-hidden="true" />, line: 'A routine health check' },
  Vaccination: { icon: <Syringe size={24} aria-hidden="true" />, line: 'Boosters and protection' },
  'Limping or injury': { icon: <Bandage size={24} aria-hidden="true" />, line: 'Sore paw, limp or wound' },
  'Off their food': { icon: <UtensilsCrossed size={24} aria-hidden="true" />, line: 'Eating less than usual' },
};

const SERVICES = [
  { title: 'Consultations', body: 'Unhurried appointments with a vet who knows your animal.', icon: <Stethoscope size={28} aria-hidden="true" />, tone: 'mint' },
  { title: 'Vaccinations', body: 'Boosters on time, with a reminder before each one is due.', icon: <Syringe size={28} aria-hidden="true" />, tone: 'sky' },
  { title: 'Surgery', body: 'Planned procedures with careful monitoring before and after.', icon: <Scissors size={28} aria-hidden="true" />, tone: 'rose' },
  { title: 'Ward care', body: 'Medication rounds on schedule while your animal recovers.', icon: <BedDouble size={28} aria-hidden="true" />, tone: 'mint' },
] as const;

const INTERESTS = ['Preventive care and vaccines', 'Soft-tissue surgery', 'Dental care and dermatology', 'Rabbit and small-mammal medicine'];

function Illustration() {
  return (
    <svg className="hero-art" viewBox="0 0 520 340" role="presentation" aria-hidden="true">
      <rect x="20" y="30" width="250" height="150" rx="18" fill="#DCEEE8" />
      <rect x="40" y="52" width="130" height="14" rx="7" fill="#0F3B33" opacity="0.7" />
      <rect x="40" y="80" width="190" height="10" rx="5" fill="#0F3B33" opacity="0.25" />
      <rect x="40" y="100" width="160" height="10" rx="5" fill="#0F3B33" opacity="0.25" />
      <rect x="40" y="132" width="78" height="30" rx="15" fill="#3AE3C0" />
      <rect x="128" y="132" width="78" height="30" rx="15" fill="#EBD3E0" />
      <rect x="290" y="60" width="200" height="120" rx="18" fill="#CDF3FD" />
      <circle cx="326" cy="100" r="18" fill="#0B3B52" opacity="0.8" />
      <rect x="354" y="90" width="110" height="12" rx="6" fill="#0B3B52" opacity="0.5" />
      <rect x="354" y="112" width="80" height="10" rx="5" fill="#0B3B52" opacity="0.25" />
      <rect x="306" y="140" width="64" height="26" rx="13" fill="#0F4DAE" />
      <g transform="translate(70 190)">
        <ellipse cx="170" cy="96" rx="110" ry="52" fill="#EBD3E0" />
        <circle cx="276" cy="60" r="44" fill="#EBD3E0" />
        <path d="M244 34c-18-22-40-12-34 18 4 14 18 14 28 4z" fill="#4A1B3A" opacity="0.8" />
        <path d="M304 32c20-18 38-6 30 20-6 14-20 12-28 0z" fill="#4A1B3A" opacity="0.8" />
        <circle cx="262" cy="56" r="5" fill="#4A1B3A" />
        <circle cx="292" cy="56" r="5" fill="#4A1B3A" />
        <ellipse cx="278" cy="76" rx="12" ry="8" fill="#4A1B3A" />
        <rect x="108" y="124" width="26" height="46" rx="13" fill="#EBD3E0" />
        <rect x="196" y="124" width="26" height="46" rx="13" fill="#EBD3E0" />
        <path d="M62 80c-30-10-40-40-26-58" stroke="#EBD3E0" strokeWidth="20" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

function PublicFrame({ clinicName, slug, children, showPill = true }: { clinicName: string; slug: string; children: ReactNode; showPill?: boolean }) {
  return (
    <>
      <header className="public-header">
        <div className="header-row">
          <span className="clinic-name">{clinicName}</span>
          <span className="grow" />
          {showPill &&
            (location.pathname.endsWith('/confirmation') || location.pathname.includes('/confirmation/') ? (
              <PillLink to={`/book/${slug}`}>Book a visit</PillLink>
            ) : (
              <Pill onClick={() => focusDay()}>Book a visit</Pill>
            ))}
        </div>
      </header>
      <main className="public-page">{children}</main>
      <footer className="site-footer public-footer">
        <nav aria-label="Public links" className="footer-grid">
          <Link to={`/book/${slug}`}>Online booking</Link>
        </nav>
        <p className="footer-line">Roundbook by Larchmere Veterinary Systems</p>
      </footer>
    </>
  );
}

function focusDay() {
  const day = document.getElementById('booking-day');
  day?.scrollIntoView({ block: 'center' });
  day?.focus();
}

export function Booking({ slug }: { slug: string }) {
  const { search } = useRouter();
  const [clinic, setClinic] = useState<Clinic | null>();
  const [day, setDay] = useState('');
  const [reason, setReason] = useState<PublicReason>('Check-up');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [lostMessage, setLostMessage] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [petName, setPetName] = useState('');
  const [species, setSpecies] = useState<Species>('dog');
  const [token, setToken] = useState<{ value: string; pet: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0);
  const chosenRef = useRef<Slot | null>(null);
  chosenRef.current = chosen;
  const sending = useRef(false);
  const { navigate } = useRouter();

  useEffect(() => {
    get<Clinic>(`/api/public/clinics/${slug}`).then(setClinic, () => setClinic(null));
    get<{ clinicDate: string }>('/api/time').then((t) => setDay(t.clinicDate), () => undefined);
  }, [slug]);

  useEffect(() => {
    const value = new URLSearchParams(search).get('pet');
    if (!value) return;
    get<{ petName: string; species: Species; ownerName: string; ownerEmail: string }>(`/api/public/clinics/${slug}/pets/${encodeURIComponent(value)}`).then(
      (pet) => {
        setToken({ value, pet: pet.petName });
        setOwnerName(pet.ownerName);
        setOwnerEmail(pet.ownerEmail);
        setPetName(pet.petName);
        setSpecies(pet.species);
      },
      () => undefined,
    );
  }, [slug, search]);

  /** Times always belong to the day and reason chosen last: an answer for an earlier choice is dropped. */
  const loadSlots = (forDay: string, forReason: PublicReason, refresh: boolean) => {
    if (!forDay) return;
    const mine = ++loadSeq.current;
    get<{ slots: Slot[] }>(`/api/public/clinics/${slug}/slots?date=${forDay}&reason=${encodeURIComponent(forReason)}`).then(
      (answer) => {
        if (mine !== loadSeq.current) return;
        setSlots(answer.slots);
        const kept = chosenRef.current;
        if (kept && refresh && !answer.slots.some((s) => s.start === kept.start && s.vetId === kept.vetId)) {
          setChosen(null);
          setLostMessage(ERROR_COPY.slot_taken);
        }
      },
      () => undefined,
    );
  };

  useEffect(() => {
    setChosen(null);
    setLostMessage(null);
    setSlots(null);
    loadSlots(day, reason, false);
    const timer = window.setInterval(() => loadSlots(day, reason, true), 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, reason, slug]);

  const submit = async () => {
    if (!chosen || sending.current) return;
    sending.current = true;
    setBusy(true);
    setFieldErrors({});
    setBanner(null);
    try {
      const made = await post<{ code: string }>(`/api/public/clinics/${slug}/bookings`, {
        start: chosen.start,
        vetId: chosen.vetId,
        reason,
        ownerName,
        ownerEmail,
        petName,
        species,
        ...(token ? { petToken: token.value } : {}),
      });
      navigate(`/book/${slug}/confirmation/${made.code}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'slot_taken') {
        setChosen(null);
        setLostMessage(error.message);
        loadSlots(day, reason, false);
      } else if (error instanceof ApiError && error.status === 422 && error.field && ['ownerName', 'ownerEmail', 'petName'].includes(error.field)) {
        setFieldErrors({ [error.field]: error.message });
      } else {
        setBanner(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
      setBusy(false);
      sending.current = false;
    }
  };

  if (clinic === undefined) return null;
  if (clinic === null) {
    return (
      <main className="centered">
        <EmptyCard title="We couldn't find that page." tone="sky" />
      </main>
    );
  }

  const byVet = clinic.vets
    .map((v) => ({ vet: v, slots: (slots ?? []).filter((s) => s.vetId === v.id) }))
    .filter((g) => g.slots.length > 0);
  const showFields = chosen !== null || token !== null || ownerName !== '' || ownerEmail !== '' || petName !== '';
  const status = chosen ? `You chose ${hm(chosen.start)} with ${chosen.vetName} on ${instantDay(chosen.start)}.` : (lostMessage ?? 'No time chosen yet.');

  return (
    <PublicFrame clinicName={clinic.name} slug={slug}>
      <div className="band hero">
        <div className="band-left">
          <p className="eyebrow">{clinic.name}</p>
          <h1>Book a visit for your animal</h1>
          <div className="band-actions">
            <Pill onClick={() => focusDay()}>Choose a time</Pill>
          </div>
        </div>
        <div className="band-right hero-right">
          <Illustration />
        </div>
      </div>
      <div className="strip" aria-hidden="true">
        <span />
        <span />
      </div>

      <section className="public-section" aria-labelledby="reason-heading">
        <h2 id="reason-heading" className="section-heading">
          What brings you in?
        </h2>
        <div role="radiogroup" aria-label="Reason for visit" className="reason-grid">
          {PUBLIC_REASONS.map((r) => (
            <label key={r} className={`reason-card ${reason === r ? 'chosen' : ''}`}>
              <input type="radio" name="reason" value={r} aria-label={r} checked={reason === r} onChange={() => setReason(r)} />
              <span className="reason-icon">{REASON_CARDS[r].icon}</span>
              <span className="reason-label">{r}</span>
              <span className="reason-line">{REASON_CARDS[r].line}</span>
              {reason === r && <span className="reason-mark">Chosen</span>}
            </label>
          ))}
        </div>
      </section>

      <section className="public-section booking-form" aria-labelledby="time-heading">
        <h2 id="time-heading" className="section-heading">
          Pick a time
        </h2>
        {token && <p className="booking-for">{`Booking for ${token.pet}`}</p>}
        <Field id="booking-day" label="Day">
          <input id="booking-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        {day && <p className="muted">{longDayLabel(day)}</p>}
        {slots === null ? (
          <Skeleton rows={2} />
        ) : byVet.length === 0 ? (
          <p className="no-times">No times are available on this day.</p>
        ) : (
          byVet.map(({ vet, slots: list }) => (
            <div key={vet.id} role="group" aria-label={vet.name} className="vet-times">
              <p className="vet-name">{vet.name}</p>
              <div className="time-grid">
                {list.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    className="time-button"
                    aria-label={`${hm(s.start)} with ${vet.name}`}
                    aria-pressed={chosen?.start === s.start && chosen.vetId === s.vetId}
                    onClick={() => {
                      setChosen(s);
                      setLostMessage(null);
                    }}
                  >
                    {hm(s.start)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
        <p role="status" aria-label="Chosen time" className="chosen-time">
          {status}
        </p>
        {showFields && (
          <form
            className="owner-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field id="owner-name" label="Your name" error={fieldErrors.ownerName}>
              <input id="owner-name" type="text" autoComplete="name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} aria-describedby={fieldErrors.ownerName ? 'owner-name-error' : undefined} />
            </Field>
            <Field id="owner-email" label="Email" error={fieldErrors.ownerEmail}>
              <input id="owner-email" type="email" autoComplete="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} aria-describedby={fieldErrors.ownerEmail ? 'owner-email-error' : undefined} />
            </Field>
            <Field id="pet-name" label="Pet name" error={fieldErrors.petName}>
              <input id="pet-name" type="text" value={petName} onChange={(e) => setPetName(e.target.value)} aria-describedby={fieldErrors.petName ? 'pet-name-error' : undefined} />
            </Field>
            <Field id="pet-species" label="Species">
              <select id="pet-species" value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
                {SPECIES.map((s) => (
                  <option key={s} value={s}>
                    {SPECIES_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Banner message={banner} />
            <Pill type="submit" busy={busy} disabled={!chosen}>
              Confirm booking
            </Pill>
          </form>
        )}
      </section>

      <section aria-label="Our services" className="public-section">
        <h2 className="section-heading">What we look after</h2>
        <div className="service-grid">
          {SERVICES.map((s) => (
            <div key={s.title} className="service-tile">
              <span className={`service-art tint-${s.tone}`}>{s.icon}</span>
              <h3 className="card-title">{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Meet the vets" className="vets-band">
        <div className="vets-art" aria-hidden="true">
          {clinic.vets.slice(0, 4).map((v, i) => (
            <span key={v.id} className="vet-card">
              <span className={`vet-circle tone-${i % 3}`}>
                {v.name
                  .replace(/^Dr\.?\s+/i, '')
                  .split(/\s+/)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <span>{v.name}</span>
            </span>
          ))}
        </div>
        <div className="vets-text">
          {clinic.vets[0] && (
            <figure>
              <blockquote>We take the time to listen to you and to your animal.</blockquote>
              <figcaption>{clinic.vets[0].name}</figcaption>
            </figure>
          )}
          <ul className="vet-lines">
            {clinic.vets.map((v, i) => (
              <li key={v.id}>{`${v.name}: ${INTERESTS[i % INTERESTS.length]}`}</li>
            ))}
          </ul>
        </div>
      </section>
    </PublicFrame>
  );
}

export function Confirmation({ slug, code }: { slug: string; code: string }) {
  const [booking, setBooking] = useState<{ clinicName: string; petName: string; vetName: string; start: string; ownerEmail: string } | null>();
  useEffect(() => {
    get<{ clinicName: string; petName: string; vetName: string; start: string; ownerEmail: string }>(`/api/public/bookings/${code}`).then(setBooking, () => setBooking(null));
  }, [code]);
  if (booking === undefined) return null;
  if (booking === null) {
    return (
      <main className="centered">
        <EmptyCard title="We couldn't find that page." tone="sky" />
      </main>
    );
  }
  return (
    <PublicFrame clinicName={booking.clinicName} slug={slug}>
      <div className="solo-card">
        <div className="empty-card tint-mint confirmation">
          <h1 className="empty-title">Your visit is booked</h1>
          <p>{`${booking.petName} is booked with ${booking.vetName} on ${instantDay(booking.start)} at ${hm(booking.start)}.`}</p>
          <p>{`A confirmation email is on its way to ${booking.ownerEmail}.`}</p>
        </div>
      </div>
    </PublicFrame>
  );
}
