import { LoanEventType, type LoanEvent } from '@family-ledger/shared';
import type { InterestInput, PrincipalSegment, RatePeriod } from './interest.js';

/**
 * Project the immutable v2 event stream into the calc engine input.
 * Formal events remain the source of truth.
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
        if (e.amountFen != null) {
          principalSegments.push({
            deltaFen: e.amountFen,
            effectiveDate: e.effectiveDate,
          });
        }
        if (e.rate != null) {
          ratePeriods.push({
            annualEffectiveRate: e.rate.annualEffectiveRate,
            effectiveFrom: e.effectiveDate,
          });
        }
        break;
      case LoanEventType.LOAN_CLOSED:
        // Lifecycle marker only. It does not rewrite historical money math.
        break;
      default: {
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
  return e.rate.annualEffectiveRate;
}
