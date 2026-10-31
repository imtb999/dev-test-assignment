// @rev kc-31
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Booking, Master, Service } from './types.ts';

const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

export const masters: Master[] = load('masters.json');
export const services: Service[] = load('services.json');

// Имитация сетевой задержки до БД. Не убирать: в проде запросы тоже не мгновенные.
const latency = () => new Promise((r) => setTimeout(r, 5 + Math.random() * 15));

export function createBookingRepo(initial: Booking[]) {
  const bookings = initial.map((b) => ({ ...b }));

  return {
    async listByMaster(masterId: string): Promise<Booking[]> {
      await latency();
      return bookings.filter((b) => b.masterId === masterId).map((b) => ({ ...b }));
    },

    async get(id: string): Promise<Booking | null> {
      await latency();
      const found = bookings.find((b) => b.id === id);
      return found ? { ...found } : null;
    },

    async insert(booking: Booking): Promise<void> {
      await latency();
      bookings.push({ ...booking });
    },

    async update(id: string, patch: Partial<Booking>): Promise<void> {
      await latency();
      const found = bookings.find((b) => b.id === id);
      if (found) Object.assign(found, patch);
    },
  };
}

export type BookingRepo = ReturnType<typeof createBookingRepo>;

export const bookingRepo = createBookingRepo(load('bookings.json'));
