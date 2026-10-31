// @rev kc-31
import { randomUUID } from 'node:crypto';
import type { Booking, Master, Service } from './types.ts';
import type { BookingRepo } from './store.ts';
import { getSlots } from './slots.ts';
import { normalizePhone } from './phone.ts';

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;
const CANCEL_DEADLINE_MS = 2 * 60 * 60 * 1000;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({
  ok: false,
  status,
  error,
});

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

// ISO с обязательным часовым поясом: 2030-11-18T15:00:00+05:00, 2030-11-18T10:00:00.000Z
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// Момент -> дата и 'HH:mm' по Алматы
function toAlmaty(ms: number): { date: string; time: string } {
  const iso = new Date(ms + ALMATY_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

type Deps = {
  masters: Master[];
  services: Service[];
  repo: BookingRepo;
  now: () => Date;
};

export function createBookingService({ masters, services, repo, now }: Deps) {
  // Очередь операций на мастера: проверка слота и вставка идут без чередования
  const locks = new Map<string, Promise<unknown>>();
  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  function resolve(masterId: unknown, serviceId: unknown): Result<{ master: Master; service: Service }> {
    if (typeof masterId !== 'string' || typeof serviceId !== 'string') return fail(400, 'invalid_request');
    const master = masters.find((m) => m.id === masterId);
    if (!master) return fail(404, 'master_not_found');
    const service = services.find((s) => s.id === serviceId);
    if (!service) return fail(404, 'service_not_found');
    if (!service.masterIds.includes(master.id)) return fail(400, 'service_not_offered');
    return { ok: true, value: { master, service } };
  }

  async function freeSlots(master: Master, service: Service, date: string): Promise<string[]> {
    const bookings = await repo.listByMaster(master.id);
    return getSlots(master, service, date, bookings, now());
  }

  return {
    async slots(masterId: string, serviceId: string | null, date: string | null) {
      if (!masters.some((m) => m.id === masterId)) return fail(404, 'master_not_found');
      if (!serviceId || !date || !isValidDate(date)) return fail(400, 'invalid_request');
      const found = resolve(masterId, serviceId);
      if (!found.ok) return found;
      const { master, service } = found.value;
      const slots = await freeSlots(master, service, date);
      return { ok: true as const, value: { masterId, serviceId, date, slots } };
    },

    async create(input: unknown): Promise<Result<Booking>> {
      if (!input || typeof input !== 'object') return fail(400, 'invalid_request');
      const { masterId, serviceId, start, clientPhone } = input as Record<string, unknown>;

      if (typeof start !== 'string' || !ISO_WITH_TZ.test(start)) return fail(400, 'invalid_start');
      const startMs = Date.parse(start);
      if (Number.isNaN(startMs)) return fail(400, 'invalid_start');

      const phone = typeof clientPhone === 'string' ? normalizePhone(clientPhone) : null;
      if (!phone) return fail(400, 'invalid_phone');

      const found = resolve(masterId, serviceId);
      if (!found.ok) return found;
      const { master, service } = found.value;

      const { date, time } = toAlmaty(startMs);
      // Слоты кратны минуте: секунды и миллисекунды должны быть нулевыми
      const onMinute = startMs % 60_000 === 0;

      return withLock(master.id, async () => {
        const slots = await freeSlots(master, service, date);
        if (!onMinute || !slots.includes(time)) return fail(409, 'slot_unavailable');

        const booking: Booking = {
          id: `bk-${randomUUID()}`,
          masterId: master.id,
          serviceId: service.id,
          start: new Date(startMs).toISOString(),
          end: new Date(startMs + service.durationMin * 60_000).toISOString(),
          clientPhone: phone,
          status: 'active',
        };
        await repo.insert(booking);
        return { ok: true as const, value: booking };
      });
    },

    async cancel(id: string): Promise<Result<Booking>> {
      const booking = await repo.get(id);
      if (!booking) return fail(404, 'booking_not_found');
      if (booking.status === 'cancelled') return { ok: true, value: booking };

      if (Date.parse(booking.start) - now().getTime() < CANCEL_DEADLINE_MS) return fail(409, 'too_late');

      await repo.update(id, { status: 'cancelled' });
      return { ok: true, value: { ...booking, status: 'cancelled' } };
    },
  };
}

export type BookingService = ReturnType<typeof createBookingService>;
