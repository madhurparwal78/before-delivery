import { addClinicDays, clinicToday, instantOfSlot, serverNow } from './clock';
import { one, transaction, withAdvisoryLock } from './db';
import {
  addNoteParagraphs,
  createAppointment,
  createClient,
  createClinic,
  createHospitalisation,
  createInvoice,
  createPatient,
  createRoom,
  createStockItem,
  createUser,
} from './seedkit';

const SEED_LOCK = 814_273;

/** Creates the demo clinics on first start, once, under a database lock. */
export async function seedOnFirstStart(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    const existing = await one<{ id: string }>('select id from clinics limit 1');
    if (existing) return;
    const now = serverNow();
    const today = clinicToday();
    const at = (date: string, hour: number, minute: number): number =>
      instantOfSlot(date, hour * 60 + minute) ?? now;

    await transaction(async (tx) => {
      const halberton = await createClinic(tx, {
        name: 'Halberton Road Animal Hospital',
        slug: 'halberton-road',
      });
      const rooms = [];
      for (const [index, name] of ['Consult 1', 'Consult 2', 'Consult 3'].entries()) {
        rooms.push(await createRoom(tx, { clinicId: halberton, name, sort: index }));
      }
      await createUser(tx, {
        clinicId: halberton,
        name: 'Maya Brennan',
        email: 'maya.brennan@halberton.test',
        role: 'front-desk',
      });
      const tomasz = await createUser(tx, {
        clinicId: halberton,
        name: 'Tomasz Wren',
        email: 'tomasz.wren@halberton.test',
        role: 'nurse',
      });
      const imani = await createUser(tx, {
        clinicId: halberton,
        name: 'Dr Imani Okafor',
        email: 'imani.okafor@halberton.test',
        role: 'vet',
      });
      const callum = await createUser(tx, {
        clinicId: halberton,
        name: 'Dr Callum Reyes',
        email: 'callum.reyes@halberton.test',
        role: 'vet',
      });
      await createUser(tx, {
        clinicId: halberton,
        name: 'Priya Nandakumar',
        email: 'priya.nandakumar@halberton.test',
        role: 'manager',
      });

      const nia = await createClient(tx, {
        clinicId: halberton,
        name: 'Nia Ashworth',
        email: 'nia.ashworth@example.test',
      });
      const biscuit = await createPatient(tx, {
        clinicId: halberton,
        clientId: nia,
        name: 'Biscuit',
        species: 'dog',
        weightGrams: 12_400,
        vaccinations: [{ vaccine: 'DHPPi', dueDate: addClinicDays(today, 35) }],
        weights: [
          { recordedOn: addClinicDays(today, -90), grams: 12_000 },
          { recordedOn: addClinicDays(today, -60), grams: 12_150 },
          { recordedOn: addClinicDays(today, -30), grams: 12_400 },
        ],
      });
      const juniper = await createPatient(tx, {
        clinicId: halberton,
        clientId: nia,
        name: 'Juniper',
        species: 'cat',
        weightGrams: 4_100,
        vaccinations: [{ vaccine: 'FVRCP', dueDate: addClinicDays(today, 40) }],
      });
      const owen = await createClient(tx, {
        clinicId: halberton,
        name: 'Owen Pritchard',
        email: 'owen.pritchard@example.test',
      });
      const mochi = await createPatient(tx, {
        clinicId: halberton,
        clientId: owen,
        name: 'Mochi',
        species: 'rabbit',
        weightGrams: 1_900,
      });
      const saffron = await createPatient(tx, {
        clinicId: halberton,
        clientId: owen,
        name: 'Saffron',
        species: 'dog',
        weightGrams: 8_300,
      });
      await createPatient(tx, {
        clinicId: halberton,
        clientId: owen,
        name: 'Pickle',
        species: 'cat',
        weightGrams: 3_600,
      });

      await createStockItem(tx, {
        clinicId: halberton,
        name: 'Meloxicam 1.5 mg/ml oral suspension 10 ml',
        reorderPoint: 6,
        unitPricePence: 1850,
        batches: [
          { batch: 'MX-2411', expiresOn: addClinicDays(today, 20), quantity: 6 },
          { batch: 'MX-2502', expiresOn: addClinicDays(today, 200), quantity: 18 },
        ],
        now,
      });
      await createStockItem(tx, {
        clinicId: halberton,
        name: 'Cefalexin 250 mg tablets (10)',
        onHand: 18,
        reorderPoint: 5,
        unitPricePence: 1440,
        now,
      });
      await createStockItem(tx, {
        clinicId: halberton,
        name: 'Nobivac DHPPi vaccine dose',
        onHand: 40,
        reorderPoint: 10,
        unitPricePence: 1295,
        now,
      });
      await createStockItem(tx, {
        clinicId: halberton,
        name: 'Sterile saline 500 ml',
        onHand: 12,
        reorderPoint: 4,
        unitPricePence: 640,
        now,
      });

      await createAppointment(tx, {
        clinicId: halberton,
        patientId: biscuit,
        vetId: imani,
        roomId: rooms[0],
        start: at(today, 9, 0),
        minutes: 15,
        reason: 'Consult',
        status: 'booked',
      });
      await createAppointment(tx, {
        clinicId: halberton,
        patientId: juniper,
        vetId: callum,
        roomId: rooms[1],
        start: at(today, 9, 30),
        minutes: 15,
        reason: 'Vaccination',
        status: 'booked',
      });
      await createAppointment(tx, {
        clinicId: halberton,
        patientId: mochi,
        vetId: imani,
        roomId: rooms[0],
        start: at(today, 10, 0),
        minutes: 15,
        reason: 'Consult',
        status: 'booked',
      });

      const pastDate = addClinicDays(today, -30);
      const pastConsult = await createAppointment(tx, {
        clinicId: halberton,
        patientId: biscuit,
        vetId: imani,
        roomId: rooms[0],
        start: at(pastDate, 10, 30),
        minutes: 15,
        reason: 'Consult',
        status: 'completed',
      });
      await addNoteParagraphs(
        tx,
        pastConsult,
        [
          'Biscuit presented for a routine check after a mild limp on the left hind leg. Bright, alert and well hydrated.',
          'Advised rest for five days and a weight check at the next visit. Owner happy with the plan.',
        ],
        imani,
      );

      await createHospitalisation(tx, {
        clinicId: halberton,
        patientId: biscuit,
        kennel: 'K3',
        treatments: [
          { name: 'meloxicam', firstAt: at(today, 8, 0), intervalHours: 8, count: 4 },
        ],
        now,
        givenBy: tomasz,
      });
      await createHospitalisation(tx, {
        clinicId: halberton,
        patientId: saffron,
        kennel: 'K5',
        treatments: [
          { name: 'cefalexin', firstAt: at(today, 9, 0), intervalHours: 12, count: 4 },
        ],
        now,
        givenBy: tomasz,
      });

      const marlow = await createClinic(tx, {
        name: 'Marlow Court Veterinary Centre',
        slug: 'marlow-court',
      });
      for (const [index, name] of ['Consult A', 'Consult B', 'Consult C'].entries()) {
        await createRoom(tx, { clinicId: marlow, name, sort: index });
      }
      const hester = await createUser(tx, {
        clinicId: marlow,
        name: 'Dr Hester Vale',
        email: 'hester.vale@marlow.test',
        role: 'vet',
      });
      await createUser(tx, {
        clinicId: marlow,
        name: 'Lewis Ocampo',
        email: 'lewis.ocampo@marlow.test',
        role: 'manager',
      });
      const rhys = await createClient(tx, {
        clinicId: marlow,
        name: 'Rhys Halloran',
        email: 'rhys.halloran@example.test',
      });
      const quill = await createPatient(tx, {
        clinicId: marlow,
        clientId: rhys,
        name: 'Quill',
        species: 'cat',
        weightGrams: 3_900,
      });
      const dressing = await createStockItem(tx, {
        clinicId: marlow,
        name: 'Wound dressing pack',
        onHand: 20,
        reorderPoint: 5,
        unitPricePence: 450,
        now,
      });
      await createInvoice(tx, {
        clinicId: marlow,
        patientId: quill,
        status: 'issued',
        lines: [{ stockItemId: dressing, quantity: 2 }],
        now,
        actorId: hester,
      });
    });
  });
}
