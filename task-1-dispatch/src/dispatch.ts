import type { Assignment, Branch, Order } from './types.ts';
import { assignBranch } from './router.ts';

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

// 'YYYY-MM-DD' по Алматы (UTC+5) для ISO-момента
export function almatyDate(iso: string): string {
  return new Date(Date.parse(iso) + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}

// Проверяет формат и что такая дата существует (2026-02-30 — нет)
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export type BranchLoad = { branchId: string; date: string; assigned: number; limit: number };

export function createDispatch(branches: Branch[], orders: Order[]) {
  // orderId -> распределение
  const assignments = new Map<string, Assignment>();
  // `${branchId}|${date}` -> сколько заказов закреплено
  const load = new Map<string, number>();
  const loadKey = (branchId: string, date: string) => `${branchId}|${date}`;

  return {
    findOrder(id: string): Order | undefined {
      return orders.find((o) => o.id === id);
    },

    findBranch(id: string): Branch | undefined {
      return branches.find((b) => b.id === id);
    },

    // Повторный вызов возвращает сохранённое распределение и не занимает лимит ещё раз.
    // Код синхронный, поэтому проверка и запись атомарны в пределах процесса.
    assign(order: Order): Assignment {
      const existing = assignments.get(order.id);
      if (existing) return existing;

      const date = almatyDate(order.createdAt);
      const assignment = assignBranch(order, branches, (branchId) => load.get(loadKey(branchId, date)) ?? 0);

      assignments.set(order.id, assignment);
      if (assignment.branchId) {
        const key = loadKey(assignment.branchId, date);
        load.set(key, (load.get(key) ?? 0) + 1);
      }
      return assignment;
    },

    branchLoad(branch: Branch, date: string): BranchLoad {
      return {
        branchId: branch.id,
        date,
        assigned: load.get(loadKey(branch.id, date)) ?? 0,
        limit: branch.dailyLimit,
      };
    },
  };
}

export type Dispatch = ReturnType<typeof createDispatch>;
