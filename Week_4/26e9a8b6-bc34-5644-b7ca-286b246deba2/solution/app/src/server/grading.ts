import { randomBytes, randomUUID } from 'node:crypto';
import { createUser } from './auth';
import { transaction, type Db } from './db';
import { bikeHub, coffeeGrinder, gameController } from './seed-data';
import { insertModel, seedGuide, storeSampleObject } from './seed';

const first = ['Marta', 'Idris', 'Noor', 'Tomas', 'Lena', 'Kofi', 'Saskia', 'Anselm', 'Priya', 'Wren', 'Matteo', 'Ines'];
const last = ['Okafor', 'Lindqvist', 'Brandao', 'Haddad', 'Moreau', 'Tanaka', 'Voss', 'Quill', 'Ferreira', 'Abara', 'Novak', 'Reyes'];
const pick = (list: string[]) => list[randomBytes(1)[0]! % list.length]!;

function suffixOf(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
}

/** One fresh, isolated world: four people, four guides with their own model copies in MinIO, a collection and a question. */
export async function createWorld(): Promise<unknown> {
  const suffix = suffixOf();
  const modelIds = { public: randomUUID(), private: randomUUID(), draft: randomUUID(), withdrawn: randomUUID() };
  await Promise.all([
    storeSampleObject(modelIds.public, coffeeGrinder.sample),
    storeSampleObject(modelIds.private, bikeHub.sample),
    storeSampleObject(modelIds.draft, bikeHub.sample),
    storeSampleObject(modelIds.withdrawn, gameController.sample),
  ]);
  const person = (role: string) => ({
    name: `${pick(first)} ${pick(last)} ${suffix}`,
    email: `${role}-${suffix}${randomBytes(2).toString('hex')}@example.test`,
    password: randomBytes(9).toString('base64url'),
  });
  const people = { author: person('author'), coauthor: person('coauthor'), reader: person('reader'), newcomer: person('newcomer') };
  return transaction(async (db) => {
    const users = {
      author: await createUser(db, people.author.name, people.author.email, people.author.password, true),
      coauthor: await createUser(db, people.coauthor.name, people.coauthor.email, people.coauthor.password, true),
      reader: await createUser(db, people.reader.name, people.reader.email, people.reader.password, true),
      newcomer: await createUser(db, people.newcomer.name, people.newcomer.email, people.newcomer.password, false),
    };
    for (const [key, sample] of [['public', coffeeGrinder], ['private', bikeHub], ['draft', bikeHub], ['withdrawn', gameController]] as const)
      await insertModel(db, modelIds[key], sample.sample);
    const titled = (base: string) => `${base} ${suffix}`;
    const publicGuide = await seedGuide(db, {
      seed: coffeeGrinder, ownerId: users.author.id, title: titled(coffeeGrinder.titleForOdile),
      slug: `${coffeeGrinder.slugForOdile}-${suffix}`, modelId: modelIds.public, state: 'published', versionNumbers: [1, 2, 3],
    });
    const privateGuide = await seedGuide(db, {
      seed: bikeHub, ownerId: users.author.id, title: titled('Bike hub: private notes'), slug: `bike-hub-private-notes-${suffix}`,
      modelId: modelIds.private, visibility: 'private', state: 'published', versionNumbers: [1],
    });
    const draftGuide = await seedGuide(db, {
      seed: bikeHub, ownerId: users.author.id, title: titled(bikeHub.titleForOdile),
      slug: `${bikeHub.slugForOdile}-${suffix}`, modelId: modelIds.draft, state: 'draft', versionNumbers: [1],
    });
    const withdrawnGuide = await seedGuide(db, {
      seed: gameController, ownerId: users.author.id, title: titled(gameController.titleForOdile),
      slug: `${gameController.slugForOdile}-${suffix}`, modelId: modelIds.withdrawn, state: 'withdrawn', publishedVersion: 1, versionNumbers: [1],
    });
    for (const guide of [publicGuide, draftGuide])
      await db.query('INSERT INTO coauthors (guide_id, user_id) VALUES ($1, $2)', [guide.id, users.coauthor.id]);
    const collection = await insertCollection(db, users.author.id, titled('Kitchen fixes'), `kitchen-fixes-${suffix}`, publicGuide.id);
    const questionId = randomUUID();
    await db.query('INSERT INTO questions (id, guide_id, step, text, asked_by) VALUES ($1, $2, 2, $3, $4)', [
      questionId, publicGuide.id, 'Which way does the upper burr turn?', users.reader.id,
    ]);
    const shown = (guide: { id: string; slug: string }, title: string) => ({ id: guide.id, slug: guide.slug, title });
    return {
      author: { ...people.author, id: users.author.id },
      coauthor: { ...people.coauthor, id: users.coauthor.id },
      reader: { ...people.reader, id: users.reader.id },
      newcomer: { ...people.newcomer, id: users.newcomer.id },
      guides: {
        public: shown(publicGuide, titled(coffeeGrinder.titleForOdile)),
        private: shown(privateGuide, titled('Bike hub: private notes')),
        draft: shown(draftGuide, titled(bikeHub.titleForOdile)),
        withdrawn: shown(withdrawnGuide, titled(gameController.titleForOdile)),
      },
      collection: { id: collection.id, slug: collection.slug, title: titled('Kitchen fixes') },
      question: { id: questionId, guide_id: publicGuide.id, step: 2 },
    };
  });
}

async function insertCollection(db: Db, ownerId: string, title: string, slug: string, guideId: string) {
  const id = randomUUID();
  await db.query('INSERT INTO collections (id, slug, owner_id, title, visibility) VALUES ($1, $2, $3, $4, $5)', [id, slug, ownerId, title, 'public']);
  await db.query('INSERT INTO collection_items (collection_id, guide_id, position) VALUES ($1, $2, 1)', [id, guideId]);
  return { id, slug };
}
