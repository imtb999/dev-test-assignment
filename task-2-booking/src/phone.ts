// @rev kc-31
// Коды мобильных операторов Казахстана: 700–708, 747, 750–751, 760–764, 771, 775–778.
// Городские номера тоже начинаются с 7 (727 — Алматы), их не принимаем.
const MOBILE_CODE = /^7(0[0-8]|47|5[01]|6[0-4]|7[15-8])\d{7}$/;

// Казахстанский мобильный: +7 7XX XXX XX XX. Возвращает '+77012345678' или null.
// Принимаем +7…, 8… и 7… (11 цифр), допускаем пробелы, скобки и дефисы.
export function normalizePhone(raw: string): string | null {
  const value = raw.trim();
  if (!/^\+?[\d\s()-]+$/.test(value)) return null;

  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11) return null;

  const plus = value.startsWith('+');
  const prefixOk = plus ? digits[0] === '7' : digits[0] === '7' || digits[0] === '8';
  if (!prefixOk) return null;

  const national = digits.slice(1);
  if (!MOBILE_CODE.test(national)) return null;

  return `+7${national}`;
}
