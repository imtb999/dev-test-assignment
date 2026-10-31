import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';
import { createBookingService } from '../src/booking.ts';
import { createBookingRepo, masters, services } from '../src/store.ts';
import type { Booking } from '../src/types.ts';

// Понедельник 2030-11-18, m-1 работает 10:00–19:00 с перерывом 14:00–15:00
const DATE = '2030-11-18';

const seed: Booking[] = [
  // 10:00–11:00 по Алматы
  {
    id: 'bk-1',
    masterId: 'm-1',
    serviceId: 's-cut',
    start: '2030-11-18T05:00:00.000Z',
    end: '2030-11-18T06:00:00.000Z',
    clientPhone: '+77012345678',
    status: 'active',
  },
  // 16:00–17:00, отменена
  {
    id: 'bk-3',
    masterId: 'm-1',
    serviceId: 's-cut',
    start: '2030-11-18T11:00:00.000Z',
    end: '2030-11-18T12:00:00.000Z',
    clientPhone: '+77475550011',
    status: 'cancelled',
  },
];

let server: Server;
let base = '';
let current = new Date('2030-11-18T03:00:00Z'); // 08:00 по Алматы

beforeEach(async () => {
  current = new Date('2030-11-18T03:00:00Z');
  const service = createBookingService({ masters, services, repo: createBookingRepo(seed), now: () => current });
  server = createApp(service, masters, services);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const book = (over: Record<string, unknown> = {}) =>
  call('POST', '/bookings', {
    masterId: 'm-1',
    serviceId: 's-cut',
    start: `${DATE}T15:00:00+05:00`,
    clientPhone: '8 (701) 234-56-78',
    ...over,
  });

test('slots: занятое время, перерыв и отменённые записи', async () => {
  const res = await call('GET', `/masters/m-1/slots?serviceId=s-cut&date=${DATE}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.masterId, 'm-1');
  assert.equal(res.body.serviceId, 's-cut');
  assert.equal(res.body.date, DATE);
  const slots: string[] = res.body.slots;
  assert.equal(slots[0], '11:00');
  assert.ok(slots.includes('13:00'));
  assert.ok(!slots.includes('13:15'));
  assert.ok(!slots.includes('14:30'));
  assert.ok(slots.includes('16:00'));
  assert.equal(slots.at(-1), '18:00');
});

test('slots: ошибки', async () => {
  assert.equal((await call('GET', `/masters/m-1/slots?date=${DATE}`)).status, 400);
  assert.equal((await call('GET', '/masters/m-1/slots?serviceId=s-cut')).status, 400);
  assert.equal((await call('GET', '/masters/m-1/slots?serviceId=s-cut&date=2030-02-30')).status, 400);
  assert.equal((await call('GET', `/masters/m-1/slots?serviceId=s-mani&date=${DATE}`)).status, 400);
  assert.equal((await call('GET', `/masters/m-9/slots?serviceId=s-cut&date=${DATE}`)).status, 404);
  assert.equal((await call('GET', `/masters/m-1/slots?serviceId=s-nope&date=${DATE}`)).status, 404);
});

test('create: успешная запись', async () => {
  const res = await book();
  assert.equal(res.status, 201);
  assert.match(res.body.id, /^bk-/);
  assert.deepEqual(
    { ...res.body, id: undefined },
    {
      id: undefined,
      masterId: 'm-1',
      serviceId: 's-cut',
      start: '2030-11-18T10:00:00.000Z',
      end: '2030-11-18T11:00:00.000Z',
      clientPhone: '+77012345678',
      status: 'active',
    },
  );
  const slots = (await call('GET', `/masters/m-1/slots?serviceId=s-cut&date=${DATE}`)).body.slots;
  assert.ok(!slots.includes('15:00'));
  assert.ok(!slots.includes('14:45'));
});

test('create: start в UTC тоже принимается', async () => {
  assert.equal((await book({ start: '2030-11-18T10:00:00Z' })).status, 201);
});

test('create: время не из свободных слотов — 409', async () => {
  for (const start of [
    `${DATE}T10:30:00+05:00`, // занято bk-1
    `${DATE}T14:15:00+05:00`, // перерыв
    `${DATE}T15:05:00+05:00`, // не на сетке 15 минут
    `${DATE}T15:00:30+05:00`,
    `${DATE}T18:30:00+05:00`, // не влезает до конца дня
    '2030-11-17T15:00:00+05:00', // воскресенье
    '2030-11-18T02:00:00Z', // 07:00, до открытия
  ]) {
    const res = await book({ start });
    assert.equal(res.status, 409, start);
    assert.deepEqual(res.body, { error: 'slot_unavailable' });
  }
});

test('create: прошедшее время — 409', async () => {
  current = new Date('2030-11-18T10:30:00Z'); // 15:30
  assert.equal((await book()).status, 409);
});

test('create: некорректные данные — 400, неизвестный мастер — 404', async () => {
  assert.equal((await book({ clientPhone: '+1 202 555 0100' })).status, 400);
  assert.equal((await book({ clientPhone: 87012345678 })).status, 400);
  assert.equal((await book({ start: '2030-11-18T15:00:00' })).status, 400); // без часового пояса
  assert.equal((await book({ start: 'завтра' })).status, 400);
  assert.equal((await book({ serviceId: 's-mani' })).status, 400);
  assert.equal((await book({ masterId: undefined })).status, 400);
  assert.equal((await book({ masterId: 'm-9' })).status, 404);
  assert.equal((await call('POST', '/bookings', '{not json')).status, 400);
});

test('create: два одновременных бронирования одного времени — создаётся одно', async () => {
  const results = await Promise.all([
    book({ clientPhone: '+77011111111' }),
    book({ clientPhone: '+77022222222' }),
    book({ clientPhone: '+77033333333', serviceId: 's-brows', start: `${DATE}T16:00:00+05:00` }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 201, 409]);
  const conflict = results.find((r) => r.status === 409)!;
  assert.deepEqual(conflict.body, { error: 'slot_unavailable' });
});

test('create: много параллельных запросов на пересекающееся время', async () => {
  const starts = ['15:00', '15:15', '15:30', '15:45', '16:00'];
  const results = await Promise.all(starts.map((t) => book({ start: `${DATE}T${t}:00+05:00` })));
  const created = results.filter((r) => r.status === 201).map((r) => r.body as Booking);
  // пересекающиеся записи не создались
  for (const a of created) {
    for (const b of created) {
      if (a !== b) assert.ok(a.end <= b.start || b.end <= a.start, `${a.start} и ${b.start} пересекаются`);
    }
  }
  assert.ok(created.length >= 1 && created.length <= 2);
});

test('cancel: отмена, повторная отмена и отменённое время снова свободно', async () => {
  const created = (await book()).body as Booking;
  const first = await call('DELETE', `/bookings/${created.id}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'cancelled');
  const again = await call('DELETE', `/bookings/${created.id}`);
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'cancelled');
  const slots = (await call('GET', `/masters/m-1/slots?serviceId=s-cut&date=${DATE}`)).body.slots;
  assert.ok(slots.includes('15:00'));
});

test('cancel: меньше чем за 2 часа — 409 too_late', async () => {
  const created = (await book()).body as Booking; // 15:00
  current = new Date('2030-11-18T08:00:01Z'); // 13:00:01
  const res = await call('DELETE', `/bookings/${created.id}`);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'too_late' });
  current = new Date('2030-11-18T08:00:00Z'); // ровно за 2 часа — ещё можно
  assert.equal((await call('DELETE', `/bookings/${created.id}`)).status, 200);
});

test('cancel: нет записи — 404', async () => {
  assert.equal((await call('DELETE', '/bookings/bk-nope')).status, 404);
});
