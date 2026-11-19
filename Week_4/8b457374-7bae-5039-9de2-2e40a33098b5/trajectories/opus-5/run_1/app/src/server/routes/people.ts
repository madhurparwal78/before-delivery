import { FIELD_COPY } from '../../shared/copy.js';
import { pool } from '../data/db.js';
import { insertPerson } from '../data/people.js';
import { FieldErrors, readString } from '../domain/validation.js';
import { json, requirePerson, type Router } from '../http/router.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerPeopleRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/people',
    auth: 'none',
    body: 'json',
    handle: async (ctx) => {
      const errors = new FieldErrors();
      const name = readString(ctx.body, 'name') ?? '';
      const email = readString(ctx.body, 'email') ?? '';
      if (name.length < 1 || name.length > 80) errors.add('name', FIELD_COPY.name);
      if (email.length < 1 || email.length > 254 || !EMAIL.test(email)) {
        errors.add('email', FIELD_COPY.email);
      }
      errors.throwIfAny();

      const { person, key } = await insertPerson(pool, name, email);
      return json(201, { id: person.id, name: person.name, email: person.email, key });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/me',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      return json(200, { id: person.id, name: person.name, email: person.email });
    },
  });
}
