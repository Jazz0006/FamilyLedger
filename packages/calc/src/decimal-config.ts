import { Decimal } from 'decimal.js';

/**
 * Pinned Decimal configuration. This is part of the money contract: every
 * environment (miniprogram, cloud function, tests) MUST use these exact
 * settings so the same events + dates yield byte-identical amounts (spec §18).
 *
 * - precision 40: far more than enough for 分-scale money over decades of
 *   daily compounding without accumulating representation error.
 * - ROUND_HALF_UP: the rounding applied when we finally quantise to 分.
 *
 * We call Decimal.set() (global config) AND export a local clone so importing
 * this module is sufficient to guarantee the configuration.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Rounding mode used when quantising a full-precision value down to 分. */
export const FEN_ROUNDING = Decimal.ROUND_HALF_UP;

/** Round a full-precision Decimal amount (in 分) to an integer 分. */
export function toFen(amount: Decimal): number {
  return amount.toDecimalPlaces(0, FEN_ROUNDING).toNumber();
}
