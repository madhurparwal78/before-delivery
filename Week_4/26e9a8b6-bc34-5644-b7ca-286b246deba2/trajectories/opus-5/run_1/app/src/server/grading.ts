import { randomBytes, randomUUID } from 'node:crypto';
import { execute } from './db/index.js';
import { createAccount } from './domain/accounts.js';
import { addToCollection, createCollection } from './domain/engagement.js';
import { seedGuide } from './seed.js';
import { BIKE_HUB, COFFEE_GRINDER, GAME_CONTROLLER } from './seed-data.js';

const GIVEN_NAMES = ['Avril', 'Teodor', 'Marta', 'Hallvard', 'Ingrid', 'Rune', 'Saskia', 'Johan'];
const FAMILY_NAMES = ['Teague', 'Dulsky', 'Brannigan', 'Sorbo', 'Halvorsen', 'Keane', 'Vos', 'Rindal'];

const WORLD_PASSWORD = 'bench-vice-72';

function suffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function inventedName(index: number, tail: string): string {
  const given = GIVEN_NAMES[index % GIVEN_NAMES.length] ?? 'Avril';
  const family = FAMILY_NAMES[(index * 3 + 1) % FAMILY_NAMES.length] ?? 'Teague';
  return `${given} ${family} ${tail}`;
}

export interface WorldPerson {
  id: string;
  name: string;
  email: string;
  password: string;
}

export interface WorldGuide {
  id: string;
  slug: string;
  title: string;
}

export interface World {
  author: WorldPerson;
  coauthor: WorldPerson;
  reader: WorldPerson;
  newcomer: WorldPerson;
  guides: {
    public: WorldGuide;
    private: WorldGuide;
    withdrawn: WorldGuide;
    draft: WorldGuide;
  };
  collection: { id: string; slug: string; title: string };
  question: { id: string; guide_id: string; step: number };
}

const ROLES = ['author', 'coauthor', 'reader', 'newcomer'] as const;

async function makePerson(role: string, index: number, tail: string): Promise<WorldPerson> {
  const email = `${role}-${randomBytes(6).toString('hex')}@example.test`;
  const name = inventedName(index, tail);
  const user = await createAccount(name, email, WORLD_PASSWORD);
  if (user === null) throw new Error(`could not create the ${role} account`);
  if (role !== 'newcomer') {
    await execute('UPDATE users SET confirmed = true WHERE id = $1', [user.id]);
  }
  return { id: user.id, name, email, password: WORLD_PASSWORD };
}

/** One fresh, isolated world each call. World creation sends no mail. */
export async function createWorld(): Promise<World> {
  const tail = suffix();
  const people = {} as Record<(typeof ROLES)[number], WorldPerson>;
  for (const [index, role] of ROLES.entries()) {
    people[role] = await makePerson(role, index, tail);
  }

  const [publicGuide, privateGuide, draftGuide, withdrawnGuide] = await Promise.all([
    seedGuide({
      ownerId: people.author.id,
      title: `Coffee grinder: fit new burrs ${tail}`,
      spec: COFFEE_GRINDER,
      visibility: 'public',
      publishVersion: 3,
      coauthorId: people.coauthor.id,
    }),
    seedGuide({
      ownerId: people.author.id,
      title: `Bike hub: private notes ${tail}`,
      spec: BIKE_HUB,
      visibility: 'private',
      publishVersion: 1,
    }),
    seedGuide({
      ownerId: people.author.id,
      title: `Bike hub: regrease the bearings ${tail}`,
      spec: BIKE_HUB,
      visibility: 'public',
      publishVersion: null,
      coauthorId: people.coauthor.id,
    }),
    seedGuide({
      ownerId: people.author.id,
      title: `Game controller: replace a stick ${tail}`,
      spec: GAME_CONTROLLER,
      visibility: 'public',
      publishVersion: 1,
      withdrawn: true,
    }),
  ]);

  const collection = await createCollection(
    people.author.id,
    `Kitchen fixes ${tail}`,
    'public',
  );
  await addToCollection(collection.id, publicGuide.id);

  const questionId = randomUUID();
  await execute(
    'INSERT INTO questions (id, guide_id, step, text, asked_by) VALUES ($1, $2, $3, $4, $5)',
    [questionId, publicGuide.id, 2, 'Which way does the upper burr turn?', people.reader.id],
  );

  const asWorldGuide = (guide: { id: string; slug: string; title: string }): WorldGuide => ({
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
  });

  return {
    author: people.author,
    coauthor: people.coauthor,
    reader: people.reader,
    newcomer: people.newcomer,
    guides: {
      public: asWorldGuide(publicGuide),
      private: asWorldGuide(privateGuide),
      withdrawn: asWorldGuide(withdrawnGuide),
      draft: asWorldGuide(draftGuide),
    },
    collection,
    question: { id: questionId, guide_id: publicGuide.id, step: 2 },
  };
}
