import { useEffect, useRef, useState, type JSX } from 'react';
import { api, get, RequestFailed } from '../api';
import { InlineAlert, Pill } from '../ui';
import { dayDdMon, hm } from '../time';
import { messageOf } from './today';

type Clinic = { name: string; slug: string; vets: { id: string; name: string }[] };
type Slot = { start: string; vetId: string; vetName: string };

const REASONS = ['Check-up', 'Vaccination', 'Limping or injury', 'Off their food'] as const;

const REASON_LINES: Record<string, string> = {
  'Check-up': 'A routine look over, nose to tail.',
  Vaccination: 'Boosters and first courses, mornings only.',
  'Limping or injury': 'Sore legs, cuts and sprains seen the same week.',
  'Off their food': 'Appetite, tummies and quiet days.',
};

const SERVICES: { title: string; line: string }[] = [
  { title: 'Day consults', line: 'Three consult rooms, so there is almost always a free slot.' },
  { title: 'Kennel care', line: 'Twelve kennels with a treatment round every few hours.' },
  { title: 'Imaging and labs', line: 'X-rays and lab reports kept on the animal’s own record.' },
  { title: 'Vaccination reminders', line: 'A note by email four weeks before each booster is due.' },
];

const VET_INTERESTS = ['dentistry', 'soft tissue surgery', 'exotics and rabbits', 'senior pets'];

export function PublicBookingScreen({ slug }: { slug: string }): JSX.Element {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [missing, setMissing] = useState(false);
  const [day, setDay] = useState('');
  const [reason, setReason] = useState<string>('Check-up');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [chosenMessage, setChosenMessage] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [petName, setPetName] = useState('');
  const [species, setSpecies] = useState('dog');
  const [petLabel, setPetLabel] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);
  const petToken = new URLSearchParams(window.location.search).get('pet');

  useEffect(() => {
    void get<Clinic>(`/api/public/clinics/${slug}`)
      .then(setClinic)
      .catch(() => setMissing(true));
    void get<{ clinicDate: string }>('/api/time').then((time) => setDay(time.clinicDate));
    if (petToken) {
      void get<{ petName: string; species: string; ownerName: string; ownerEmail: string }>(
        `/api/public/clinics/${slug}/pets/${petToken}`,
      )
        .then((pet) => {
          setPetLabel(pet.petName);
          setPetName(pet.petName);
          setSpecies(pet.species);
          setOwnerName(pet.ownerName);
          setEmail(pet.ownerEmail);
        })
        .catch(() => setPetLabel(null));
    }
  }, [slug, petToken]);

  const loadSlots = async (targetDay: string, targetReason: string): Promise<void> => {
    if (!targetDay) return;
    const current = ticket.current + 1;
    ticket.current = current;
    try {
      const data = await get<{ date: string; slots: Slot[] }>(
        `/api/public/clinics/${slug}/slots?date=${targetDay}&reason=${encodeURIComponent(targetReason)}`,
      );
      if (ticket.current !== current) return;
      setSlots(data.slots);
      setChosen((held) => {
        if (!held) return held;
        const stillThere = data.slots.some(
          (slot) => slot.start === held.start && slot.vetId === held.vetId,
        );
        if (stillThere) return held;
        setChosenMessage('That slot was just taken. Pick another time.');
        return null;
      });
    } catch {
      if (ticket.current === current) setSlots([]);
    }
  };

  useEffect(() => {
    void loadSlots(day, reason);
  }, [day, reason]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadSlots(day, reason), 15_000);
    return () => window.clearInterval(timer);
  }, [day, reason]);

  const focusDay = (): void => document.getElementById('booking-day')?.focus();

  const confirm = async (): Promise<void> => {
    if (!chosen) return;
    setBusy(true);
    try {
      const result = await api<{ code: string }>(
        'POST',
        `/api/public/clinics/${slug}/bookings`,
        {
          start: chosen.start,
          vetId: chosen.vetId,
          reason,
          ownerName,
          ownerEmail: email,
          petName,
          species,
          ...(petToken ? { petToken } : {}),
        },
      );
      window.location.assign(`/book/${slug}/confirmation/${result.code}`);
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'slot_taken') {
        setChosen(null);
        setChosenMessage('That slot was just taken. Pick another time.');
        void loadSlots(day, reason);
      } else {
        setFailure(messageOf(error));
      }
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <main className="centred-page">
        <div className="empty-card tint-sky">
          <p className="card-title">We couldn&apos;t find that page.</p>
        </div>
      </main>
    );
  }

  const byVet = (clinic?.vets ?? []).map((vet) => ({
    vet,
    times: slots.filter((slot) => slot.vetId === vet.id),
  }));

  return (
    <div className="public-page">
      <header className="public-header">
        <span className="public-clinic">{clinic?.name ?? ''}</span>
        <Pill onClick={focusDay}>Book a visit</Pill>
      </header>
      <main>
        <section className="split-band public-hero">
          <div className="split-grid">
            <div className="split-navy">
              <p className="hero-clinic">{clinic?.name ?? ''}</p>
              <h1>Book a visit for your animal</h1>
              <Pill onClick={focusDay}>Choose a time</Pill>
            </div>
            <div className="split-live hero-art" aria-hidden="true">
              <span className="art-block mint" />
              <span className="art-block sky" />
              <span className="art-pill rose" />
              <span className="art-animal" />
            </div>
          </div>
          <div className="split-strip" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>

        <section className="public-section">
          <div role="radiogroup" aria-label="Reason for visit" className="reason-cards">
            {REASONS.map((name) => (
              <div
                key={name}
                role="radio"
                aria-checked={reason === name}
                tabIndex={reason === name ? 0 : -1}
                className={`reason-card${reason === name ? ' chosen' : ''}`}
                onClick={() => setReason(name)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    setReason(name);
                  }
                }}
              >
                <span className="reason-icon" aria-hidden="true" />
                <span className="reason-label">{name}</span>
                <span className="reason-line">{REASON_LINES[name]}</span>
                {reason === name ? <span className="reason-chosen">Chosen</span> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="public-section booking-form">
          {petLabel ? <p className="pet-label">{`Booking for ${petLabel}`}</p> : null}
          <div className="field">
            <label htmlFor="booking-day">Day</label>
            <input
              id="booking-day"
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
          {slots.length === 0 ? (
            <div className="empty-card tint-sky">
              <p className="card-title">No times are available on this day.</p>
            </div>
          ) : (
            byVet
              .filter((entry) => entry.times.length > 0)
              .map((entry) => (
                <div role="group" aria-label={entry.vet.name} key={entry.vet.id} className="vet-times">
                  <p className="card-title">{entry.vet.name}</p>
                  <div className="time-buttons">
                    {entry.times.map((slot) => (
                      <button
                        key={`${slot.start}-${slot.vetId}`}
                        type="button"
                        className="time-button"
                        aria-label={`${hm(slot.start)} with ${slot.vetName}`}
                        aria-pressed={chosen?.start === slot.start && chosen?.vetId === slot.vetId}
                        onClick={() => {
                          setChosen(slot);
                          setChosenMessage(null);
                        }}
                      >
                        {hm(slot.start)}
                      </button>
                    ))}
                  </div>
                </div>
              ))
          )}
          <p role="status" aria-label="Chosen time" className="chosen-time">
            {chosenMessage
              ? chosenMessage
              : chosen
                ? `You chose ${hm(chosen.start)} with ${chosen.vetName} on ${dayDdMon(chosen.start)}.`
                : 'No time chosen yet.'}
          </p>
          {chosen ? (
            <div className="owner-fields">
              <div className="field">
                <label htmlFor="owner-name">Your name</label>
                <input
                  id="owner-name"
                  type="text"
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="owner-email">Email</label>
                <input
                  id="owner-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pet-name">Pet name</label>
                <input
                  id="pet-name"
                  type="text"
                  value={petName}
                  onChange={(event) => setPetName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pet-species">Species</label>
                <select
                  id="pet-species"
                  value={species}
                  onChange={(event) => setSpecies(event.target.value)}
                >
                  <option value="dog">Dog</option>
                  <option value="cat">Cat</option>
                  <option value="rabbit">Rabbit</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <Pill busy={busy} onClick={() => void confirm()}>
                Confirm booking
              </Pill>
              <InlineAlert message={failure} />
            </div>
          ) : null}
        </section>

        <section className="public-section" aria-label="Our services">
          <h2 className="section-title">Our services</h2>
          <div className="service-tiles">
            {SERVICES.map((service) => (
              <article className="service-tile" key={service.title}>
                <span className="service-art" aria-hidden="true" />
                <h3>{service.title}</h3>
                <p>{service.line}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="vets-band" aria-label="Meet the vets">
          <div className="vets-art" aria-hidden="true">
            {(clinic?.vets ?? []).map((vet) => (
              <span className="vet-circle" key={vet.id}>
                {vet.name
                  .split(/\s+/)
                  .slice(-2)
                  .map((part) => part[0])
                  .join('')}
              </span>
            ))}
          </div>
          <div className="vets-words">
            <blockquote className="vet-quote">
              “We keep one clock and one list, so nothing is given late.”
              <cite>{clinic?.vets[0]?.name ?? ''}</cite>
            </blockquote>
            {(clinic?.vets ?? []).map((vet, index) => (
              <p key={vet.id}>{`${vet.name} — ${VET_INTERESTS[index % VET_INTERESTS.length]}`}</p>
            ))}
          </div>
        </section>
      </main>
      <footer className="public-footer" role="contentinfo">
        <a href={`/book/${slug}`}>Online booking</a>
        <p>Roundbook by Larchmere Veterinary Systems</p>
      </footer>
    </div>
  );
}

export function ConfirmationScreen({ slug, code }: { slug: string; code: string }): JSX.Element {
  const [booking, setBooking] = useState<{
    clinicName: string;
    petName: string;
    vetName: string;
    start: string;
    ownerEmail: string;
  } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void get<{
      clinicName: string;
      petName: string;
      vetName: string;
      start: string;
      ownerEmail: string;
    }>(`/api/public/bookings/${code}`)
      .then(setBooking)
      .catch(() => setMissing(true));
  }, [code]);

  if (missing) {
    return (
      <main className="centred-page">
        <div className="empty-card tint-sky">
          <p className="card-title">We couldn&apos;t find that page.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="public-page">
      <header className="public-header">
        <span className="public-clinic">{booking?.clinicName ?? ''}</span>
        <Pill onClick={() => window.location.assign(`/book/${slug}`)}>Book a visit</Pill>
      </header>
      <main className="centred-page">
        <div className="empty-card tint-mint confirmation-card">
          <h1>Your visit is booked</h1>
          {booking ? (
            <>
              <p>{`${booking.petName} is booked with ${booking.vetName} on ${dayDdMon(
                booking.start,
              )} at ${hm(booking.start)}.`}</p>
              <p>{`A confirmation email is on its way to ${booking.ownerEmail}.`}</p>
            </>
          ) : null}
        </div>
      </main>
      <footer className="public-footer" role="contentinfo">
        <a href={`/book/${slug}`}>Online booking</a>
        <p>Roundbook by Larchmere Veterinary Systems</p>
      </footer>
    </div>
  );
}
