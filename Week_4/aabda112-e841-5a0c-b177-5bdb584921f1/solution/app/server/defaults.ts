import { addDays, clinicDate, clinicInstant } from '../shared/clinictime.js';
import { now } from './clock.js';
import { type Db, one } from './db.js';
import { seedWorld } from './seed.js';

/** First start: the two clinics of the brief's seed data. Runs once, when no clinic exists. */
export async function seedDefaults(db: Db, origin: string): Promise<void> {
  if ((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM clinics'))!.n > 0) return;
  const day = clinicDate(now());
  const at = (date: string, hour: number, minute = 0) => clinicInstant(date, hour, minute)!.toISOString();
  const ago = (days: number) => addDays(day, -days);
  const staff = (ref: string, clinic: string, name: string, email: string, role: string) => ({ ref, clinic, name, email, role });
  const ids = await seedWorld(
    db,
    {
      clinics: [
        { ref: 'halberton', name: 'Halberton Road Animal Hospital', slug: 'halberton-road' },
        { ref: 'marlow', name: 'Marlow Court Veterinary Centre', slug: 'marlow-court' },
      ],
      users: [
        staff('maya', 'halberton', 'Maya Brennan', 'maya.brennan@halberton.test', 'front-desk'),
        staff('tomasz', 'halberton', 'Tomasz Wren', 'tomasz.wren@halberton.test', 'nurse'),
        staff('imani', 'halberton', 'Dr Imani Okafor', 'imani.okafor@halberton.test', 'vet'),
        staff('callum', 'halberton', 'Dr Callum Reyes', 'callum.reyes@halberton.test', 'vet'),
        staff('priya', 'halberton', 'Priya Nandakumar', 'priya.nandakumar@halberton.test', 'manager'),
        staff('hester', 'marlow', 'Dr Hester Vale', 'hester.vale@marlow.test', 'vet'),
        staff('lewis', 'marlow', 'Lewis Ocampo', 'lewis.ocampo@marlow.test', 'manager'),
      ],
      rooms: [
        { ref: 'c1', clinic: 'halberton', name: 'Consult 1' },
        { ref: 'c2', clinic: 'halberton', name: 'Consult 2' },
        { ref: 'c3', clinic: 'halberton', name: 'Consult 3' },
        { ref: 'ca', clinic: 'marlow', name: 'Consult A' },
        { ref: 'cb', clinic: 'marlow', name: 'Consult B' },
        { ref: 'cc', clinic: 'marlow', name: 'Consult C' },
      ],
      clients: [
        { ref: 'nia', clinic: 'halberton', name: 'Nia Ashworth', email: 'nia.ashworth@example.test' },
        { ref: 'owen', clinic: 'halberton', name: 'Owen Pritchard', email: 'owen.pritchard@example.test' },
        { ref: 'rhys', clinic: 'marlow', name: 'Rhys Halloran', email: 'rhys.halloran@example.test' },
      ],
      patients: [
        {
          ref: 'biscuit', clinic: 'halberton', client: 'nia', name: 'Biscuit', species: 'dog', weightGrams: 12400,
          vaccinations: [{ vaccine: 'DHPPi', dueDate: addDays(day, 35) }],
          weights: [{ recordedOn: ago(90), grams: 12000 }, { recordedOn: ago(60), grams: 12150 }, { recordedOn: ago(30), grams: 12400 }],
        },
        { ref: 'juniper', clinic: 'halberton', client: 'nia', name: 'Juniper', species: 'cat', weightGrams: 4100, vaccinations: [{ vaccine: 'FVRCP', dueDate: addDays(day, 40) }] },
        { ref: 'mochi', clinic: 'halberton', client: 'owen', name: 'Mochi', species: 'rabbit', weightGrams: 1900 },
        { ref: 'saffron', clinic: 'halberton', client: 'owen', name: 'Saffron', species: 'dog', weightGrams: 8300 },
        { ref: 'pickle', clinic: 'halberton', client: 'owen', name: 'Pickle', species: 'cat', weightGrams: 3600 },
        { ref: 'quill', clinic: 'marlow', client: 'rhys', name: 'Quill', species: 'cat', weightGrams: 3900 },
      ],
      appointments: [
        { ref: 'a1', clinic: 'halberton', patient: 'biscuit', vet: 'imani', room: 'c1', start: at(day, 9), reason: 'Consult', status: 'booked' },
        { ref: 'a2', clinic: 'halberton', patient: 'juniper', vet: 'callum', room: 'c2', start: at(day, 9, 30), reason: 'Vaccination', status: 'booked' },
        { ref: 'a3', clinic: 'halberton', patient: 'mochi', vet: 'imani', room: 'c1', start: at(day, 10), reason: 'Consult', status: 'booked' },
        { ref: 'past', clinic: 'halberton', patient: 'biscuit', vet: 'imani', room: 'c1', start: at(ago(30), 9), reason: 'Consult', status: 'completed' },
      ],
      hospitalised: [
        { ref: 'h1', patient: 'biscuit', kennel: 'K3', treatments: [{ name: 'meloxicam', firstAt: at(day, 8), intervalHours: 8, count: 4, givenDoses: [] }] },
        { ref: 'h2', patient: 'saffron', kennel: 'K5', treatments: [{ name: 'cefalexin', firstAt: at(day, 9), intervalHours: 12, count: 4, givenDoses: [] }] },
      ],
      stock: [
        {
          ref: 'meloxicam', clinic: 'halberton', name: 'Meloxicam 1.5 mg/ml oral suspension 10 ml', reorderPoint: 6, unitPricePence: 1850,
          batches: [{ batch: 'MX-2411', expiresOn: addDays(day, 20), quantity: 6 }, { batch: 'MX-2502', expiresOn: addDays(day, 200), quantity: 18 }],
        },
        { ref: 'cefalexin', clinic: 'halberton', name: 'Cefalexin 250 mg tablets (10)', onHand: 18, reorderPoint: 5, unitPricePence: 1440 },
        { ref: 'nobivac', clinic: 'halberton', name: 'Nobivac DHPPi vaccine dose', onHand: 40, reorderPoint: 10, unitPricePence: 1295 },
        { ref: 'saline', clinic: 'halberton', name: 'Sterile saline 500 ml', onHand: 12, reorderPoint: 4, unitPricePence: 640 },
        { ref: 'dressing', clinic: 'marlow', name: 'Wound dressing pack', onHand: 20, reorderPoint: 5, unitPricePence: 450 },
      ],
      invoices: [{ ref: 'inv', clinic: 'marlow', patient: 'quill', status: 'issued', discountPercent: 0, lines: [{ stock: 'dressing', quantity: 2 }] }],
    },
    origin,
  );
  const past = ids.appointments.past;
  await db.query(
    `INSERT INTO note_ops (appointment_id, n, version, text, edited_by, at) VALUES
       ($1, 1, 1, $2, $3, $5), ($1, 2, 1, $4, $3, $5)`,
    [
      past,
      'Annual check-up. Bright and alert, coat in good condition, no concerns on examination.',
      ids.users.imani.id,
      'Weight steady. Vaccination booster due; owner reminded about dental chews.',
      now(),
    ],
  );
}
