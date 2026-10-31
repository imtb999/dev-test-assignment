// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/phone.ts';

test('normalizePhone: допустимые форматы', () => {
  for (const raw of ['+7 701 234 56 78', '87012345678', '8 (701) 234-56-78', '+7(701)2345678', '77012345678', ' +77012345678 ']) {
    assert.equal(normalizePhone(raw), '+77012345678', raw);
  }
});

test('normalizePhone: недопустимые', () => {
  for (const raw of [
    '',
    '7012345678', // без кода страны
    '+8 701 234 56 78',
    '+7 727 234 56 78', // городской Алматы
    '8 701 234 56 7',
    '8 701 234 56 789',
    '+7 701 234 56 78 доб. 1',
    '+7.701.234.56.78',
    '++77012345678',
  ]) {
    assert.equal(normalizePhone(raw), null, raw);
  }
});
