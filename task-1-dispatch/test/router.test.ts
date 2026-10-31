import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

const ala1 = branch({ id: 'b-ala-1', city: 'Алматы', lat: 43.2402, lon: 76.915, pickupPointIds: ['pp-1'] });
const ala2 = branch({ id: 'b-ala-2', city: 'Алматы', lat: 43.265, lon: 76.835 });

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  // заказ ближе к b-ala-2, но пункт выдачи закреплён за b-ala-1
  const res = assignBranch(order({ pickupPointId: 'pp-1', lat: 43.266, lon: 76.836 }), [ala1, ala2, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-1', rule: 'pickup_point' });
});

test('pickup_point: неизвестный пункт выдачи — идём дальше по правилам', () => {
  const res = assignBranch(order({ city: 'Астана', pickupPointId: 'pp-x' }), [ala1, ala2, astana]);
  assert.equal(res.rule, 'city');
});

test('pickup_point: пункт неактивного филиала не считается', () => {
  const closed = { ...ala1, active: false };
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [closed, ala2, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-2', rule: 'city' });
});

test('city: в городе заказа один филиал магазина', () => {
  // координаты ближе к Алматы, но город — Астана
  const res = assignBranch(order({ city: 'Астана' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'city' });
});

test('city: срабатывает и без координат', () => {
  const res = assignBranch(order({ city: 'Астана', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.branchId, 'b-ast');
});

test('city: филиалы другого магазина не учитываются', () => {
  const foreign = branch({ id: 'b-foreign', storeId: 's-2', city: 'Астана' });
  const res = assignBranch(order({ city: 'Астана' }), [almaty, astana, foreign]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'city' });
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  // Филиал «за городом» ближе по прямой, но город заказа — Алматы
  const suburb = branch({ id: 'b-sub', city: 'Каскелен', lat: 43.2, lon: 76.62 });
  const o = order({ lat: 43.2, lon: 76.7 });
  assert.deepEqual(assignBranch(o, [ala1, ala2, suburb]), { orderId: 'o-1', branchId: 'b-ala-2', rule: 'geo' });
});

test('geo: в городе заказа нет филиалов — ближайший из всех', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.87, lon: 77.07 }), [ala1, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-1', rule: 'geo' });
});

test('лимит: заполненный филиал пропускается', () => {
  const full = { ...ala1, dailyLimit: 2 };
  const load = (id: string) => (id === 'b-ala-1' ? 2 : 0);
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [full, ala2, astana], load);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-2', rule: 'geo' });
});

test('лимит: single при заполненном филиале — unassigned', () => {
  const res = assignBranch(order({}), [{ ...almaty, dailyLimit: 1 }], () => 1);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: заполнены все — unassigned', () => {
  const res = assignBranch(order({}), [ala1, ala2], () => 100);
  assert.equal(res.rule, 'unassigned');
});

test('лимит: без координат запасной филиал не выбрать — unassigned', () => {
  const res = assignBranch(order({ city: 'Астана', lat: null, lon: null }), [almaty, astana], (id) =>
    id === 'b-ast' ? 100 : 0,
  );
  assert.equal(res.rule, 'unassigned');
});

test('лимит: manual не проверяет лимит', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana], () => 1000);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});
