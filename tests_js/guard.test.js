import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeText, safeId, safeInt, safeCode, safeWord, safeCallbackData, safeQuery, clampNumber,
} from '../tgcloud/lib/guard.js';

test('safeText strips control characters and enforces length', () => {
  assert.equal(safeText('hi\u0000there', 20), 'hithere');
  assert.equal(safeText('abcdef', 3), 'abc');
});

test('safeId only accepts safe integers', () => {
  assert.equal(safeId('8953843780'), 8953843780);
  assert.equal(safeId('not-a-number'), null);
  assert.equal(safeId('1.5'), null);
});

test('safeInt clamps into range with a fallback', () => {
  assert.equal(safeInt('999', { min: 4, max: 6, fallback: 5 }), 6);
  assert.equal(safeInt('bad', { min: 4, max: 6, fallback: 5 }), 5);
});

test('room codes, words and callback data are strictly formatted', () => {
  assert.equal(safeCode('abc12'), 'ABC12');
  assert.equal(safeCode('a;b'), null);
  assert.equal(safeWord('DROP', 4), 'drop');
  assert.equal(safeWord('DROP TABLE', 5), null);
  assert.equal(safeCallbackData('sgb:change'), 'sgb:change');
  assert.equal(safeCallbackData('sgb:change;DROP'), null);
  assert.equal(safeQuery('a'.repeat(500)).length, 256);
  assert.equal(clampNumber('99', 1, 10, 5), 10);
});
