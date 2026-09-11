import { LoanEventType, type LoanEvent } from '@family-ledger/shared';
import type { InterestInput, PrincipalSegment, RatePeriod } from './interest.js';

/**
 * Project an immutable event stream (spec §12) into the calc engine's input.
 * The event ledger is the source of truth; this is the pure reduction from
 * events to the {principalSegments, ratePeriods} the balance engine consumes.
 *
 * Mapping:
 *  - PRINCIPAL_ADD    -> +amountFen principal segment on its effectiveDate.
 *  - PRINCIPAL_REPAY  -> -amountFen principal segment on its effectiveDate.
 *  - RATE_CHANGE      -> a rate period starting on its effectiveDate.
 *  - CORRECTION       -> a signed principal delta (sign carried in amountFen)
 *                        and/or a rate change if `rate` is present.
 *
 * `amountFen` for repayments is stored as a positive magnitude; we negate here.
 * CORRECTION amounts are stored already-signed so a correction can move debt
 * in either direction.
 */
export function toInterestInput(events: LoanEvent[], asOf: string): InterestInput {
  const principalSegments: PrincipalSegment[] = [];
  const ratePeriods: RatePeriod[] = [];

  for (const e of events) {
    switch (e.eventType) {
      case LoanEventType.PRINCIPAL_ADD:
        principalSegments.push({
          deltaFen: requireAmount(e),
          effectiveDate: e.effectiveDate,
        });
        break;
      case LoanEventType.PRINCIPAL_REPAY:
        principalSegments.push({
          deltaFen: -Math.abs(requireAmount(e)),
          effectiveDate: e.effectiveDate,
        });
        break;
      case LoanEventType.RATE_CHANGE:
        ratePeriods.push({
          annualEffectiveRate: requireRate(e),
          effectiveFrom: e.effectiveDate,
        });
        break;
      case LoanEventType.CORRECTION:
        // A correction may adjust principal (signed) and/or rate.
        if (e.amountFen != null) {
          principalSegments.push({
            deltaFen: e.amountFen,
            effectiveDate: e.effectiveDate,
          });
        }
        if (e.rate != null) {
          ratePeriods.push({
            annualEffectiveRate: e.rate,
            effectiveFrom: e.effectiveDate,
          });
        }
        break;
      default: {
        // Exhaustiveness guard: unknown event types must not be silently
        // ignored, since that would corrupt the derived balance.
        const _never: never = e.eventType;
        throw new Error(`Unhandled loan event type: ${String(_never)}`);
      }
    }
  }

  return { principalSegments, ratePeriods, asOf };
}

function requireAmount(e: LoanEvent): number {
  if (e.amountFen == null) {
    throw new Error(`Event ${e._id} (${e.eventType}) missing amountFen`);
  }
  return e.amountFen;
}

function requireRate(e: LoanEvent): string {
  if (e.rate == null) {
    throw new Error(`Event ${e._id} (${e.eventType}) missing rate`);
  }
  return e.rate;
}
