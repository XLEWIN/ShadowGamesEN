import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin, adminLabel } from '../tgcloud/lib/auth.js';

test('only the whitelisted owner IDs are admins', () => {
  assert.equal(isAdmin(8953843780), true);
  assert.equal(isAdmin(8301883098), true);
  assert.equal(isAdmin(123456), false);
  assert.equal(isAdmin('8953843780x'), false);
  assert.equal(adminLabel(8953843780), 'admin');
  assert.equal(adminLabel(1), 'user');
});
