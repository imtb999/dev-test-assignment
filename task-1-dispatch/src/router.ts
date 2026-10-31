import type { Assignment, Branch, Order, Rule } from './types.ts';
import { distanceKm } from './geo.ts';

// Сколько заказов уже закреплено за филиалом в сутки заказа (по Алматы)
export type LoadFn = (branchId: string) => number;

const noLoad: LoadFn = () => 0;

export function assignBranch(order: Order, branches: Branch[], load: LoadFn = noLoad): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);

  // manual лимит не проверяет: менеджер решил сам
  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return result(order, manual, 'manual');
  }

  const picked = pickByRules(order, own);
  if (!picked) return result(order, null, 'unassigned');

  const isFull = (b: Branch) => load(b.id) >= b.dailyLimit;
  if (!isFull(picked.branch)) return result(order, picked.branch, picked.rule);

  const fallback = findNearest(order, own.filter((b) => !isFull(b)));
  if (fallback) return result(order, fallback, 'geo');

  return result(order, null, 'unassigned');
}

function pickByRules(order: Order, own: Branch[]): { branch: Branch; rule: Rule } | null {
  if (own.length === 1) return { branch: own[0], rule: 'single' };

  if (order.pickupPointId) {
    const byPoint = own.find((b) => b.pickupPointIds.includes(order.pickupPointId!));
    if (byPoint) return { branch: byPoint, rule: 'pickup_point' };
  }

  const inCity = own.filter((b) => b.city === order.city);
  if (inCity.length === 1) return { branch: inCity[0], rule: 'city' };

  const nearest = findNearest(order, inCity.length > 1 ? inCity : own);
  if (nearest) return { branch: nearest, rule: 'geo' };

  return null;
}

function result(order: Order, branch: Branch | null, rule: Rule): Assignment {
  return { orderId: order.id, branchId: branch?.id ?? null, rule };
}

function findNearest(order: Order, branches: Branch[]): Branch | null {
  if (order.lat === null || order.lon === null) return null;

  let best: Branch | null = null;
  let bestDist = Infinity;
  for (const b of branches) {
    const d = distanceKm(order.lat, order.lon, b.lat, b.lon);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
