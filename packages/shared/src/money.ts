/**
 * Money is stored and transmitted as integer kobo (1 NGN = 100 kobo) to avoid floating-point totals.
 */

export const KOBO_PER_NAIRA = 100;

export function nairaToKobo(naira: number): number {
  if (!Number.isFinite(naira)) throw new Error('Invalid amount');
  return Math.round(naira * KOBO_PER_NAIRA);
}

export function koboToNaira(kobo: number): number {
  return kobo / KOBO_PER_NAIRA;
}

/** Formats integer kobo as a naira string, e.g. 1250050 -> "₦12,500.50". Whole-naira amounts omit decimals. */
export function formatNaira(kobo: number, opts: { alwaysShowKobo?: boolean } = {}): string {
  const negative = kobo < 0;
  const abs = Math.abs(Math.trunc(kobo));
  const whole = Math.floor(abs / KOBO_PER_NAIRA);
  const fraction = abs % KOBO_PER_NAIRA;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showFraction = opts.alwaysShowKobo || fraction !== 0;
  const fractionStr = showFraction ? `.${fraction.toString().padStart(2, '0')}` : '';
  return `${negative ? '-' : ''}₦${wholeStr}${fractionStr}`;
}

/**
 * Multiplies a unit price (kobo) by a quantity that may be fractional for measured goods
 * (e.g. 2.5 yards). Quantities are limited to 2 decimal places, so the computation is done in
 * hundredths to keep it integer-exact before the final rounding.
 */
export function lineTotalKobo(unitPriceKobo: number, quantity: number): number {
  const qtyHundredths = Math.round(quantity * 100);
  return Math.round((unitPriceKobo * qtyHundredths) / 100);
}

export interface PricingInput {
  retailPriceKobo: number;
  wholesalePriceKobo?: number | null;
  wholesaleMinQuantity?: number | null;
}

/** Returns the applicable unit price and whether wholesale pricing applied for a quantity. */
export function resolveUnitPrice(p: PricingInput, quantity: number): { unitPriceKobo: number; wholesale: boolean } {
  if (
    p.wholesalePriceKobo != null &&
    p.wholesaleMinQuantity != null &&
    p.wholesaleMinQuantity > 0 &&
    quantity >= p.wholesaleMinQuantity
  ) {
    return { unitPriceKobo: p.wholesalePriceKobo, wholesale: true };
  }
  return { unitPriceKobo: p.retailPriceKobo, wholesale: false };
}
