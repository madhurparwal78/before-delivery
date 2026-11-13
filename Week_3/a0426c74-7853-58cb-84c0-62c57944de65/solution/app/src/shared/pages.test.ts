import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchPage } from './pages.ts';

describe('pages by path', () => {
  it('matches each page and captures its parts', () => {
    assert.deepEqual(matchPage('/'), { page: 'landing', params: [] });
    assert.deepEqual(matchPage('/signin'), { page: 'signin', params: [] });
    assert.deepEqual(matchPage('/drawings/d1'), { page: 'drawing', params: ['d1'] });
    assert.deepEqual(matchPage('/versions/v1'), { page: 'review', params: ['v1'] });
    assert.deepEqual(matchPage('/v/tok'), { page: 'viewLink', params: ['tok'] });
  });

  it('matches nothing else', () => {
    for (const path of ['/drawings', '/drawings/', '/drawings/a/b', '/folders/', '/nope', '//']) assert.equal(matchPage(path), null, path);
  });
});
