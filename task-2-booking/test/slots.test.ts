// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Booking, Master, Service } from '../src/types.ts';

const day = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  // 2030-11-18 — понедельник
  const slots = getSlots(master, cut, '2030-11-18', []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', []), []);
});

const withBreak: Master = {
  ...master,
  schedule: { ...master.schedule, mon: { from: '10:00', to: '14:00', breaks: [{ from: '12:00', to: '12:30' }] } },
};

const booking = (start: string, end: string, status: Booking['status'] = 'active'): Booking => ({
  id: `bk-${start}`,
  masterId: 'm-1',
  serviceId: 's-cut',
  start,
  end,
  clientPhone: '+77012345678',
  status,
});

test('getSlots: слот не пересекает перерыв', () => {
  const slots = getSlots(withBreak, cut, '2030-11-18', []);
  // 11:00–12:00 вплотную к перерыву подходит, 11:15–12:45 уже нет; после перерыва с 12:30
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '12:30', '12:45', '13:00']);
});

test('getSlots: занятое время не выдаётся, отменённые записи не мешают', () => {
  const bookings = [
    // 10:30–11:00 по Алматы
    booking('2030-11-18T05:30:00.000Z', '2030-11-18T06:00:00.000Z'),
    // отменённая 12:00–13:00
    booking('2030-11-18T07:00:00.000Z', '2030-11-18T08:00:00.000Z', 'cancelled'),
    // запись другого мастера
    { ...booking('2030-11-18T06:00:00.000Z', '2030-11-18T08:00:00.000Z'), masterId: 'm-2' },
  ];
  assert.deepEqual(getSlots(master, cut, '2030-11-18', bookings), ['11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: запись, заданная в UTC на другую дату по UTC, учитывается', () => {
  // 2030-11-17T19:00Z = 18.11 00:00 по Алматы — до начала рабочего дня, не мешает
  const early = booking('2030-11-17T19:00:00.000Z', '2030-11-17T20:00:00.000Z');
  assert.equal(getSlots(master, cut, '2030-11-18', [early]).length, 9);
});

test('getSlots: прошедшее время не выдаётся', () => {
  // сейчас 11:05 по Алматы
  const now = new Date('2030-11-18T06:05:00Z');
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [], now), ['11:15', '11:30', '11:45', '12:00']);
  // ровно 11:15 — слот 11:15 уже не «позже текущего момента»
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [], new Date('2030-11-18T06:15:00Z'))[0], '11:30');
  // завтрашний день целиком доступен
  assert.equal(getSlots(master, cut, '2030-11-19', [], now).length, 9);
});

test('getSlots: длинная услуга, не влезающая в день', () => {
  const long: Service = { ...cut, durationMin: 240 };
  assert.deepEqual(getSlots(master, long, '2030-11-18', []), []);
});
