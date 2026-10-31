import type { Booking, Master, Service } from './types.ts';
import { fromMinutes, overlaps, toMinutes, weekday, type Range } from './time.ts';

export const SLOT_STEP_MIN = 15;

const MIN_MS = 60_000;

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(
  master: Master,
  service: Service,
  date: string,
  bookings: Booking[],
  now: Date = new Date(0),
): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  // Всё переводим в минуты от полуночи даты по Алматы
  const midnight = Date.parse(`${date}T00:00:00+05:00`);
  const toDayMin = (iso: string) => (Date.parse(iso) - midnight) / MIN_MS;

  const busy: Range[] = [
    ...day.breaks.map((b) => ({ start: toMinutes(b.from), end: toMinutes(b.to) })),
    ...bookings
      .filter((b) => b.masterId === master.id && b.status === 'active')
      .map((b) => ({ start: toDayMin(b.start), end: toDayMin(b.end) })),
  ];
  const nowMin = (now.getTime() - midnight) / MIN_MS;

  const result: string[] = [];
  const end = toMinutes(day.to);
  for (let t = toMinutes(day.from); t + service.durationMin <= end; t += SLOT_STEP_MIN) {
    const slot = { start: t, end: t + service.durationMin };
    if (t <= nowMin) continue;
    if (busy.some((b) => overlaps(slot, b))) continue;
    result.push(fromMinutes(t));
  }
  return result;
}
