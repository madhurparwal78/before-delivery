import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { one, query } from './infra/db.js';
import { SCHEMA } from './infra/schema.js';
import { ensureBucket, StoreDown } from './infra/store.js';
import { config } from './config.js';
import {
  addDaysIso,
  isoDateIn,
  nextClockChange,
  resolveWallTime,
  splitIsoDate,
} from '../domain/time.js';
import type { Language } from '../domain/privateCopy.js';
import type { FrameRate } from '../domain/timecode.js';
import type { Place, Town } from '../domain/time.js';
import { newStamp } from './api/support.js';

type SeedProducer = {
  name: string;
  email: string;
  town: Town;
  language: Language;
};

type SeedClient = {
  name: string;
  place: Place;
  producer: SeedProducer;
};

const CLIENTS: SeedClient[] = [
  {
    name: 'Hudson Yard Pictures',
    place: 'newYork',
    producer: {
      name: 'Marcus Hale',
      email: 'marcus.hale@hudsonyard.example',
      town: 'newYork',
      language: 'en',
    },
  },
  {
    name: 'STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM',
    place: 'netherlands',
    producer: {
      name: 'Zoë Ørsted',
      email: 'zoe.orsted@noordzee.example',
      town: 'amsterdam',
      language: 'nl',
    },
  },
  {
    name: 'Maple & Lake Films',
    place: 'ontario',
    producer: {
      name: 'Élodie Tremblay',
      email: 'elodie.tremblay@mapleandlake.example',
      town: 'toronto',
      language: 'fr',
    },
  },
  {
    name: 'Gulf Meridian Airways',
    place: 'dubai',
    producer: {
      name: 'ليلى حداد',
      email: 'layla.haddad@gulfmeridian.example',
      town: 'dubai',
      language: 'ar',
    },
  },
];

type SeedJob = {
  title: string;
  clientName: string;
  frameRate: FrameRate;
  targetSeconds: number;
  adId: string;
  durations: number[];
  state: string;
};

const JOBS: SeedJob[] = [
  {
    title: 'Harbour Light',
    clientName: 'Hudson Yard Pictures',
    frameRate: '29.97',
    targetSeconds: 30,
    adId: 'HUDS0000301H',
    durations: Array.from({ length: 12 }, () => 75),
    state: 'signedOff',
  },
  {
    title: 'Polder Run',
    clientName: 'STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM',
    frameRate: '25',
    targetSeconds: 30,
    adId: 'NOOR0000302H',
    durations: [...Array.from({ length: 11 }, () => 62), 68],
    state: 'draft',
  },
  {
    title: 'Maple Line',
    clientName: 'Maple & Lake Films',
    frameRate: '23.976',
    targetSeconds: 15,
    adId: 'MAPL0000303H',
    durations: Array.from({ length: 12 }, () => 30),
    state: 'inReview',
  },
  {
    title: 'Gulf Morning',
    clientName: 'Gulf Meridian Airways',
    frameRate: '25',
    targetSeconds: 6,
    adId: 'GULF0000304D',
    durations: Array.from({ length: 12 }, () => 12),
    state: 'draft',
  },
];

/** Each copy applies its schema and seed idempotently on serve. */
export async function applySchemaAndSeed(): Promise<void> {
  await query(SCHEMA);
  try {
    await ensureBucket();
  } catch (error) {
    if (!(error instanceof StoreDown)) throw error;
  }
  const already = await one<{ value: string }>("select value from app_meta where key = 'seeded'", []);
  if (already) return;
  const firstStart = new Date(Math.floor(Date.now() / 1000) * 1000);
  await query('insert into app_meta (key, value) values ($1,$2)', [
    'firstStartAt',
    firstStart.toISOString(),
  ]);
  await seed(firstStart);
  await query('insert into app_meta (key, value) values ($1,$2)', ['seeded', '1']);
}

async function seed(firstStart: Date): Promise<void> {
  const password = await hashPassword('desk-pass-2027');
  const noorId = randomUUID();
  const theoId = randomUUID();
  await query(
    `insert into desks (id, name, email, email_folded, password_hash, created_at)
     values ($1,'Noor Bakker','noor@noorbakkerboards.example','noor@noorbakkerboards.example',$2,$3),
            ($4,'Theo Lindqvist','theo@noorbakkerboards.example','theo@noorbakkerboards.example',$2,$3)`,
    [noorId, password, firstStart, theoId],
  );

  const amsterdamToday = isoDateIn(firstStart, 'amsterdam');
  const dueDate = addDaysIso(amsterdamToday, 21);

  const clientIds = new Map<string, string>();
  const producerIds = new Map<string, string>();
  for (const client of CLIENTS) {
    const clientId = randomUUID();
    clientIds.set(client.name, clientId);
    await query(
      `insert into clients (id, desk_id, name, place, state, created_at)
       values ($1,$2,$3,$4,'active',$5)`,
      [clientId, noorId, client.name, client.place, firstStart],
    );
    const producerId = randomUUID();
    producerIds.set(client.producer.name, producerId);
    await query(
      `insert into producers (id, client_id, name, email, town, language, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        producerId,
        clientId,
        client.producer.name,
        client.producer.email,
        client.producer.town,
        client.producer.language,
        firstStart,
      ],
    );
  }

  const jobIds = new Map<string, string>();
  for (const job of JOBS) {
    const jobId = randomUUID();
    jobIds.set(job.title, jobId);
    await query(
      `insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds,
                         frame_rate, aspect, state, stamp, next_frame_number, next_cut_number,
                         created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'16:9',$9,$10,13,3,$11)`,
      [
        jobId,
        noorId,
        clientIds.get(job.clientName),
        job.title,
        job.adId,
        dueDate,
        job.targetSeconds,
        job.frameRate,
        job.state,
        newStamp(),
        firstStart,
      ],
    );
    for (const [index, duration] of job.durations.entries()) {
      const number = index + 1;
      await query(
        `insert into frames (id, job_id, number, position, duration_frames, action_note,
                             audio_note, shot, visual, file_name, width, height, sha256,
                             drawing_kind, created_at)
         values ($1,$2,$3,$4,$5,$6,'',$7,$6,$8,1280,720,null,'seeded',$9)`,
        [
          randomUUID(),
          jobId,
          number,
          number,
          duration,
          `Action for frame ${number}.`,
          String(number),
          `frame-${number}.svg`,
          firstStart,
        ],
      );
    }
    for (const [index, name] of ['First pass', 'Second pass'].entries()) {
      const cutId = randomUUID();
      await query(
        `insert into cuts (id, job_id, number, name, frame_rate, created_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [cutId, jobId, index + 1, name, job.frameRate, firstStart],
      );
      for (const [frameIndex, duration] of job.durations.entries()) {
        const number = frameIndex + 1;
        await query(
          `insert into cut_frames (id, cut_id, number, position, duration_frames, action_note,
                                   audio_note, shot, visual, file_name, width, height, sha256,
                                   drawing_kind)
           values ($1,$2,$3,$4,$5,$6,'',$7,$6,$8,1280,720,null,'seeded')`,
          [
            randomUUID(),
            cutId,
            number,
            number,
            duration,
            `Action for frame ${number}.`,
            String(number),
            `frame-${number}.svg`,
          ],
        );
      }
    }
  }

  const harbourLight = jobIds.get('Harbour Light') as string;
  const mapleLine = jobIds.get('Maple Line') as string;
  const polderRun = jobIds.get('Polder Run') as string;
  const marcus = producerIds.get('Marcus Hale') as string;
  const elodie = producerIds.get('Élodie Tremblay') as string;

  await query(
    `update cuts set signed_off_at = $1, signed_off_by = 'Marcus Hale',
                     signed_off_producer_id = $2
      where job_id = $3 and number = 1`,
    [firstStart, marcus, harbourLight],
  );

  for (const note of [
    { text: 'Hold the harbour light a beat longer.', state: 'open' },
    { text: 'Bring the boat in from the left.', state: 'done' },
  ]) {
    await query(
      `insert into notes (id, job_id, producer_id, review_page_id, frame, x, y, typed_name,
                          state, text, created_at)
       values ($1,$2,$3,null,4,50.0,50.0,'Marcus Hale',$4,$5,$6)`,
      [randomUUID(), harbourLight, marcus, note.state, note.text, firstStart],
    );
  }

  const endedPage = randomUUID();
  await query(
    `insert into review_pages (id, job_id, producer_id, cut_number, token, state, ends_at,
                               reminder_at, notes_sent_at, typed_name, created_at)
     values ($1,$2,$3,2,$4,'ended',$5,null,$5,'Élodie Tremblay',$5)`,
    [endedPage, mapleLine, elodie, randomUUID().replace(/-/g, ''), firstStart],
  );
  await query(
    `insert into notes (id, job_id, producer_id, review_page_id, frame, x, y, typed_name,
                        state, text, created_at)
     values ($1,$2,$3,$4,4,50.0,50.0,'Élodie Tremblay','open','Le plan est un peu court.',$5)`,
    [randomUUID(), mapleLine, elodie, endedPage, firstStart],
  );

  await query(
    `insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date,
                       until_date, fee, licence_id, created_at)
     values ($1,$2,'hr-1001','Lantern Street','Ilse Voss',30,'NL',$3,$4,'120.00','lic-401',$5)`,
    [
      randomUUID(),
      polderRun,
      addDaysIso(amsterdamToday, -30),
      addDaysIso(amsterdamToday, -1),
      firstStart,
    ],
  );
  const torontoToday = isoDateIn(firstStart, 'toronto');
  await query(
    `insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date,
                       until_date, fee, licence_id, created_at)
     values ($1,$2,'hr-1002','Tidal Grid','Joost Amani',15,'CA',$3,$4,'120.00','lic-402',$5)`,
    [
      randomUUID(),
      mapleLine,
      addDaysIso(torontoToday, -30),
      addDaysIso(torontoToday, 3),
      firstStart,
    ],
  );

  for (const date of callDates(firstStart)) {
    const start = resolveWallTime('newYork', splitIsoDate(date), { hour: 9, minute: 0 });
    if (start.kind === 'skipped') continue;
    const id = randomUUID();
    await query(
      `insert into calls (id, desk_id, producer_id, date, time, minutes, note, starts_at,
                          ends_at, uid, sequence, state, created_at)
       values ($1,$2,$3,$4,'09:00',30,'First look, cut 2',$5,$6,$7,0,'booked',$8)`,
      [
        id,
        noorId,
        marcus,
        date,
        start.instant,
        new Date(start.instant.getTime() + 30 * 60000),
        `${id}@noorbakkerboards.example`,
        firstStart,
      ],
    );
  }

  await query(
    `insert into letters (id, job_id, currency, scope, fee_minor, state, stamp, changed_at,
                          producer_id, token, ends_at, pdf_stored, created_at)
     values ($1,$2,'CAD','Boards and story reel',600000,'sent',$3,$4,$5,$6,$7,false,$4)`,
    [
      randomUUID(),
      mapleLine,
      newStamp(),
      firstStart,
      elodie,
      randomUUID().replace(/-/g, ''),
      new Date(firstStart.getTime() + config.timers.feePageSeconds * 1000),
    ],
  );

  const fjordlight = randomUUID();
  await query(
    `insert into clients (id, desk_id, name, place, state, created_at)
     values ($1,$2,'Fjordlight Studio','netherlands','active',$3)`,
    [fjordlight, theoId, firstStart],
  );
  await query(
    `insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds,
                       frame_rate, aspect, state, stamp, created_at)
     values ($1,$2,$3,'Quiet Harbour','FJOR0000401H',$4,15,'25','16:9','draft',$5,$6)`,
    [randomUUID(), theoId, fjordlight, dueDate, newStamp(), firstStart],
  );
}

/** The last weekday before the next clock change, and the first weekday after. */
function callDates(firstStart: Date): string[] {
  const change = nextClockChange(firstStart, ['newYork', 'amsterdam']);
  const changeDate = isoDateIn(change, 'newYork');
  return [previousWeekday(changeDate), nextWeekday(changeDate)];
}

function weekdayOf(iso: string): number {
  const parts = splitIsoDate(iso);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function previousWeekday(iso: string): string {
  let date = addDaysIso(iso, -1);
  while (weekdayOf(date) === 0 || weekdayOf(date) === 6) date = addDaysIso(date, -1);
  return date;
}

function nextWeekday(iso: string): string {
  let date = addDaysIso(iso, 1);
  while (weekdayOf(date) === 0 || weekdayOf(date) === 6) date = addDaysIso(date, 1);
  return date;
}
