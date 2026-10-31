// @rev kc-31
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { almatyDate, createDispatch, isValidDate } from '../src/dispatch.ts';
import type { Branch, Order } from '../src/types.ts';

const dataDir = join(import.meta.dirname, '..', 'data');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(dataDir, f), 'utf8')) as T;
const branches = read<Branch[]>('branches.json');
const orders = read<Order[]>('orders.json');

const server = createApp(createDispatch(branches, orders), branches);
let base = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const assign = async (id: string) => {
  const res = await fetch(`${base}/orders/${id}/assign`, { method: 'POST' });
  return { status: res.status, body: await res.json() };
};
const load = async (id: string, date?: string) => {
  const res = await fetch(`${base}/branches/${id}/load${date === undefined ? '' : `?date=${date}`}`);
  return { status: res.status, body: await res.json() };
};

test('almatyDate: сутки считаются по UTC+5', () => {
  assert.equal(almatyDate('2026-11-15T18:59:59Z'), '2026-11-15');
  assert.equal(almatyDate('2026-11-15T19:00:00Z'), '2026-11-16');
});

test('isValidDate', () => {
  assert.equal(isValidDate('2026-11-16'), true);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-1-6'), false);
  assert.equal(isValidDate('завтра'), false);
});

// Тесты ниже идут по порядку и делят состояние сервера
test('assign: нет заказа — 404', async () => {
  assert.equal((await assign('o-404')).status, 404);
});

test('assign: правила на данных из data/', async () => {
  assert.deepEqual((await assign('o-101')).body, { orderId: 'o-101', branchId: 'b-ala-1', rule: 'pickup_point' });
  assert.deepEqual((await assign('o-102')).body, { orderId: 'o-102', branchId: 'b-ast-1', rule: 'manual' });
  assert.deepEqual((await assign('o-103')).body, { orderId: 'o-103', branchId: 'b-ast-1', rule: 'city' });
  assert.deepEqual((await assign('o-104')).body, { orderId: 'o-104', branchId: 'b-ala-2', rule: 'geo' });
  assert.deepEqual((await assign('o-105')).body, { orderId: 'o-105', branchId: 'b-shy-1', rule: 'single' });
  assert.deepEqual((await assign('o-106')).body, { orderId: 'o-106', branchId: null, rule: 'unassigned' });
  assert.deepEqual((await assign('o-107')).body, { orderId: 'o-107', branchId: 'b-ala-2', rule: 'geo' });
  // manual на неактивный b-ala-3, пункт выдачи тоже его — уходит по geo
  assert.deepEqual((await assign('o-108')).body, { orderId: 'o-108', branchId: 'b-ala-1', rule: 'geo' });
});

test('assign: лимит b-ala-1 (3 в сутки) переполняется — заказ уходит в ближайший свободный', async () => {
  // 16.11 у b-ala-1 уже o-101 и o-108, o-109 занимает последнее место
  assert.deepEqual((await assign('o-109')).body, { orderId: 'o-109', branchId: 'b-ala-1', rule: 'pickup_point' });
  assert.deepEqual((await assign('o-110')).body, { orderId: 'o-110', branchId: 'b-ala-2', rule: 'geo' });
  // o-112 — 00:10 17.11 по Алматы, новые сутки
  assert.deepEqual((await assign('o-112')).body, { orderId: 'o-112', branchId: 'b-ala-1', rule: 'pickup_point' });
  // o-113 — 23:50 15.11 по Алматы
  assert.deepEqual((await assign('o-113')).body, { orderId: 'o-113', branchId: 'b-ala-1', rule: 'pickup_point' });
});

test('assign: повторный вызов возвращает то же и не занимает лимит', async () => {
  const before = (await load('b-ala-2', '2026-11-16')).body.assigned;
  const [a, b] = await Promise.all([assign('o-104'), assign('o-104')]);
  assert.deepEqual(a.body, { orderId: 'o-104', branchId: 'b-ala-2', rule: 'geo' });
  assert.deepEqual(b.body, a.body);
  assert.equal((await load('b-ala-2', '2026-11-16')).body.assigned, before);
});

test('load: загрузка за дату по Алматы', async () => {
  assert.deepEqual((await load('b-ala-1', '2026-11-16')).body, {
    branchId: 'b-ala-1',
    date: '2026-11-16',
    assigned: 3,
    limit: 3,
  });
  assert.equal((await load('b-ala-1', '2026-11-17')).body.assigned, 1);
  assert.equal((await load('b-ala-1', '2026-11-15')).body.assigned, 1);
  assert.equal((await load('b-ala-1', '2026-01-01')).body.assigned, 0);
});

test('load: нет даты или дата некорректная — 400, нет филиала — 404', async () => {
  assert.equal((await load('b-ala-1')).status, 400);
  assert.equal((await load('b-ala-1', '2026-13-01')).status, 400);
  assert.equal((await load('b-ala-1', '16.11.2026')).status, 400);
  assert.equal((await load('b-nope', '2026-11-16')).status, 404);
});
