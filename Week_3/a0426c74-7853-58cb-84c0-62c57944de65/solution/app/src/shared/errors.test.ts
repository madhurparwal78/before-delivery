import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from './copy.ts';
import { ApiError, earlier, fieldError, fieldsError, firstByOrder, invalid, serverFault } from './errors.ts';

describe('errors', () => {
  it('builds the invalid family through one shape', () => {
    assert.deepEqual(fieldError('name', 'Too long.').toBody(), { error: 'invalid', message: 'Too long.', fields: { name: 'Too long.' } });
    assert.equal(fieldError('x').message, copy.invalidValue('x'));
    assert.deepEqual(fieldsError({ username: 'a', password: 'b' }).toBody(), { error: 'invalid', message: 'a', fields: { username: 'a', password: 'b' } });
    assert.deepEqual(invalid('Nope.').toBody(), { error: 'invalid', message: 'Nope.' });
    assert.equal(invalid('Nope.').status, 422);
  });

  it('puts the error the published order lists first', () => {
    const forbidden = new ApiError('forbidden', 'f');
    const stale = new ApiError('stale_base', 's');
    assert.equal(earlier(stale, forbidden), forbidden);
    assert.equal(earlier(forbidden, stale), forbidden);
    assert.equal(firstByOrder([stale, forbidden, invalid('i')]), forbidden);
    assert.equal(firstByOrder([]), null);
  });

  it('answers an unexpected fault with the neutral sentence and no published code', () => {
    assert.deepEqual(serverFault().toBody(), { error: 'storage_unavailable', message: copy.SERVER_FAULT });
  });
});
