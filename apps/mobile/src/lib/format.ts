import { BUSINESS_TIMEZONE, UNIT_LABELS, formatNaira, type MeasurementUnit } from '@kkdm/shared';

export { formatNaira };

export function unitLabel(unit: MeasurementUnit, quantity = 1) {
  const l = UNIT_LABELS[unit];
  return quantity === 1 ? l.singular : l.plural;
}

export function formatQuantity(quantity: number, unit: MeasurementUnit) {
  const q = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, '');
  return `${q} ${unitLabel(unit, quantity)}`;
}

/** Timestamps are stored in UTC and shown in Africa/Lagos business time. */
export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-NG', { timeZone: BUSINESS_TIMEZONE, ...opts }).format(new Date(iso));
  } catch {
    return new Date(iso).toDateString();
  }
}

export function formatDateTime(iso: string | null | undefined) {
  return formatDate(iso, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatTime(iso: string | null | undefined) {
  return formatDate(iso, { hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(iso);
}

export function nairaInputToKobo(value: string): number | null {
  const cleaned = value.replace(/[₦,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function koboToNairaInput(kobo: number | null | undefined) {
  if (kobo == null) return '';
  return (kobo / 100).toString();
}

export function titleCase(s: string) {
  return s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
