/**
 * Exact, bounded-retry accounting for the lab's CL084 abort/retry teaching model.
 *
 * This is deliberately separate from the S04 Prio3 release path.  The model has
 * neighboring query answers f(D0)=0 and f(D1)=1 and releases
 *
 *   M(D) = f(D) + Z,  Pr[Z=z] = 1 / (3 * 2^|z|).
 *
 * M is tight pure ln(2)-DP for sensitivity one.  An outcome-only aborter sees a
 * candidate and aborts exactly when it is at most -1.  The public transcript sees
 * ABORT or the published candidate, never a rejected candidate.  All arithmetic
 * below is reduced BigInt rational arithmetic; no sampled estimate is used.
 */

export interface Rational {
  numerator: bigint
  denominator: bigint
}

export type Neighbor = 'D0' | 'D1'

export interface TranscriptEvent {
  label: string
  d0: Rational
  d1: Rational
}

export interface RatioEnvelope {
  tightRatio: Rational
  witness: string
  direction: 'D0/D1' | 'D1/D0'
}

export interface ObserverBoundary {
  publicSeesRejectedCandidate: false
  outcomeAborterSeesCandidateBeforeDecision: true
  independentAborterSeesCandidateBeforeDecision: false
  teacherSeesBothNeighborDistributions: true
}

export interface AbortRetryAnalysis {
  threshold: bigint
  retryCap: number
  ordinary: {
    events: readonly TranscriptEvent[]
    envelope: RatioEnvelope
  }
  selectiveOneAttempt: {
    events: readonly TranscriptEvent[]
    abortProbability: Readonly<Record<Neighbor, Rational>>
    envelope: RatioEnvelope
  }
  conditionedOnPublication: {
    events: readonly TranscriptEvent[]
    zeroProbability: Readonly<Record<Neighbor, Rational>>
    envelope: RatioEnvelope
    deltaAtOriginalRatio: Rational
  }
  cappedSelectiveRetry: {
    events: readonly TranscriptEvent[]
    allAbortProbability: Readonly<Record<Neighbor, Rational>>
    envelope: RatioEnvelope
  }
  feedbackDisabledControl: {
    events: readonly TranscriptEvent[]
    independentAbortProbability: Rational
    allAbortProbability: Readonly<Record<Neighbor, Rational>>
    envelope: RatioEnvelope
  }
  observerBoundary: ObserverBoundary
}

export const ABORT_AT_OR_BELOW = -1n
export const DEFAULT_RETRY_CAP = 3
export const MAX_RETRY_CAP = 3

const ZERO = rational(0n, 1n)
const ONE = rational(1n, 1n)
const ORIGINAL_RATIO = rational(2n, 1n)
const INDEPENDENT_ABORT_PROBABILITY = rational(1n, 3n)

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

function gcd(left: bigint, right: bigint): bigint {
  let a = absolute(left)
  let b = absolute(right)
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

export function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new RangeError('a rational denominator cannot be zero')
  const sign = denominator < 0n ? -1n : 1n
  const divisor = gcd(numerator, denominator)
  return {
    numerator: sign * numerator / divisor,
    denominator: sign * denominator / divisor,
  }
}

export function rationalKey(value: Rational): string {
  return value.denominator === 1n
    ? value.numerator.toString()
    : `${value.numerator}/${value.denominator}`
}

export function add(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

export function subtract(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

export function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator)
}

export function divide(left: Rational, right: Rational): Rational {
  if (right.numerator === 0n) throw new RangeError('cannot divide by zero')
  return rational(left.numerator * right.denominator, left.denominator * right.numerator)
}

export function compare(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

export function power(value: Rational, exponent: number): Rational {
  if (!Number.isSafeInteger(exponent) || exponent < 0) throw new RangeError('the exponent must be a non-negative safe integer')
  return rational(value.numerator ** BigInt(exponent), value.denominator ** BigInt(exponent))
}

function complement(value: Rational): Rational {
  return subtract(ONE, value)
}

function positivePart(value: Rational): Rational {
  return compare(value, ZERO) > 0 ? value : ZERO
}

function queryAnswer(dataset: Neighbor): bigint {
  return dataset === 'D0' ? 0n : 1n
}

/** Exact PMF of the two-sided geometric noise used by this teaching model. */
export function geometricHalfProbability(noise: bigint): Rational {
  return rational(1n, 3n * (2n ** absolute(noise)))
}

/** Exact Pr[Z <= maximum] for the same two-sided geometric distribution. */
export function geometricHalfCdf(maximum: bigint): Rational {
  if (maximum < 0n) {
    const magnitude = -maximum
    return rational(1n, 3n * (2n ** (magnitude - 1n)))
  }
  return subtract(ONE, rational(1n, 3n * (2n ** maximum)))
}

export function outcomeProbability(dataset: Neighbor, outcome: bigint): Rational {
  return geometricHalfProbability(outcome - queryAnswer(dataset))
}

export function selectiveAbortProbability(
  dataset: Neighbor,
  threshold: bigint = ABORT_AT_OR_BELOW,
): Rational {
  return geometricHalfCdf(threshold - queryAnswer(dataset))
}

function eventProbabilitySum(events: readonly TranscriptEvent[], dataset: Neighbor): Rational {
  return events.reduce((sum, event) => add(sum, dataset === 'D0' ? event.d0 : event.d1), ZERO)
}

export function assertNormalized(events: readonly TranscriptEvent[]): void {
  for (const dataset of ['D0', 'D1'] as const) {
    const total = eventProbabilitySum(events, dataset)
    if (compare(total, ONE) !== 0) {
      throw new Error(`${dataset} transcript probabilities sum to ${rationalKey(total)}, not 1`)
    }
  }
}

function ratioEnvelope(events: readonly TranscriptEvent[]): RatioEnvelope {
  let best: RatioEnvelope | undefined
  for (const event of events) {
    if (event.d0.numerator === 0n || event.d1.numerator === 0n) {
      throw new Error(`event ${event.label} has zero probability in a neighbor`)
    }
    const candidates: RatioEnvelope[] = [
      { tightRatio: divide(event.d0, event.d1), witness: event.label, direction: 'D0/D1' },
      { tightRatio: divide(event.d1, event.d0), witness: event.label, direction: 'D1/D0' },
    ]
    for (const candidate of candidates) {
      if (best === undefined || compare(candidate.tightRatio, best.tightRatio) > 0) best = candidate
    }
  }
  if (best === undefined) throw new Error('a ratio envelope needs at least one event')
  return best
}

function deltaAtRatio(events: readonly TranscriptEvent[], ratio: Rational): Rational {
  let d0AgainstD1 = ZERO
  let d1AgainstD0 = ZERO
  for (const event of events) {
    d0AgainstD1 = add(d0AgainstD1, positivePart(subtract(event.d0, multiply(ratio, event.d1))))
    d1AgainstD0 = add(d1AgainstD0, positivePart(subtract(event.d1, multiply(ratio, event.d0))))
  }
  return compare(d0AgainstD1, d1AgainstD0) >= 0 ? d0AgainstD1 : d1AgainstD0
}

function ordinaryEvents(): TranscriptEvent[] {
  const d0NonPositive = geometricHalfCdf(0n)
  const d1NonPositive = geometricHalfCdf(-1n)
  const events = [
    { label: 'publish s <= 0', d0: d0NonPositive, d1: d1NonPositive },
    { label: 'publish s >= 1', d0: complement(d0NonPositive), d1: complement(d1NonPositive) },
  ]
  assertNormalized(events)
  return events
}

function oneAttemptEvents(threshold: bigint): TranscriptEvent[] {
  const d0Abort = selectiveAbortProbability('D0', threshold)
  const d1Abort = selectiveAbortProbability('D1', threshold)
  const d0Zero = outcomeProbability('D0', 0n)
  const d1Zero = outcomeProbability('D1', 0n)
  const events = [
    { label: 'ABORT', d0: d0Abort, d1: d1Abort },
    { label: 'publish s = 0', d0: d0Zero, d1: d1Zero },
    {
      label: 'publish s >= 1',
      d0: subtract(subtract(ONE, d0Abort), d0Zero),
      d1: subtract(subtract(ONE, d1Abort), d1Zero),
    },
  ]
  assertNormalized(events)
  return events
}

function conditionedEvents(oneAttempt: readonly TranscriptEvent[]): TranscriptEvent[] {
  const abort = oneAttempt[0]
  const d0Success = complement(abort.d0)
  const d1Success = complement(abort.d1)
  const events = oneAttempt.slice(1).map((event) => ({
    label: event.label,
    d0: divide(event.d0, d0Success),
    d1: divide(event.d1, d1Success),
  }))
  assertNormalized(events)
  return events
}

function cappedSelectiveEvents(oneAttempt: readonly TranscriptEvent[], retryCap: number): TranscriptEvent[] {
  const abort = oneAttempt[0]
  const published = oneAttempt.slice(1)
  const events: TranscriptEvent[] = []
  for (let aborted = 0; aborted < retryCap; aborted += 1) {
    const prefix = aborted === 0 ? 'P' : `${'A '.repeat(aborted)}P`.trim()
    for (const event of published) {
      events.push({
        label: `${prefix}: ${event.label}`,
        d0: multiply(power(abort.d0, aborted), event.d0),
        d1: multiply(power(abort.d1, aborted), event.d1),
      })
    }
  }
  events.push({
    label: `${'A '.repeat(retryCap).trim()}: cap reached`,
    d0: power(abort.d0, retryCap),
    d1: power(abort.d1, retryCap),
  })
  assertNormalized(events)
  return events
}

function independentAbortEvents(ordinary: readonly TranscriptEvent[], retryCap: number): TranscriptEvent[] {
  const abort = INDEPENDENT_ABORT_PROBABILITY
  const continueProbability = complement(abort)
  const events: TranscriptEvent[] = []
  for (let aborted = 0; aborted < retryCap; aborted += 1) {
    const prefix = aborted === 0 ? 'P' : `${'A '.repeat(aborted)}P`.trim()
    for (const event of ordinary) {
      const prefixProbability = multiply(power(abort, aborted), continueProbability)
      events.push({
        label: `${prefix}: ${event.label}`,
        d0: multiply(prefixProbability, event.d0),
        d1: multiply(prefixProbability, event.d1),
      })
    }
  }
  const terminal = power(abort, retryCap)
  events.push({ label: `${'A '.repeat(retryCap).trim()}: cap reached`, d0: terminal, d1: terminal })
  assertNormalized(events)
  return events
}

export function analyzeAbortRetry(retryCap: number = DEFAULT_RETRY_CAP): AbortRetryAnalysis {
  if (!Number.isSafeInteger(retryCap) || retryCap < 1 || retryCap > MAX_RETRY_CAP) {
    throw new RangeError(`retry cap must be an integer from 1 through ${MAX_RETRY_CAP}`)
  }

  const ordinary = ordinaryEvents()
  const selectiveOne = oneAttemptEvents(ABORT_AT_OR_BELOW)
  const conditioned = conditionedEvents(selectiveOne)
  const cappedSelective = cappedSelectiveEvents(selectiveOne, retryCap)
  const feedbackDisabled = independentAbortEvents(ordinary, retryCap)
  const oneAbort = selectiveOne[0]
  const cappedTerminal = cappedSelective.at(-1)!
  const controlTerminal = feedbackDisabled.at(-1)!

  return {
    threshold: ABORT_AT_OR_BELOW,
    retryCap,
    ordinary: { events: ordinary, envelope: ratioEnvelope(ordinary) },
    selectiveOneAttempt: {
      events: selectiveOne,
      abortProbability: { D0: oneAbort.d0, D1: oneAbort.d1 },
      envelope: ratioEnvelope(selectiveOne),
    },
    conditionedOnPublication: {
      events: conditioned,
      zeroProbability: { D0: conditioned[0].d0, D1: conditioned[0].d1 },
      envelope: ratioEnvelope(conditioned),
      deltaAtOriginalRatio: deltaAtRatio(conditioned, ORIGINAL_RATIO),
    },
    cappedSelectiveRetry: {
      events: cappedSelective,
      allAbortProbability: { D0: cappedTerminal.d0, D1: cappedTerminal.d1 },
      envelope: ratioEnvelope(cappedSelective),
    },
    feedbackDisabledControl: {
      events: feedbackDisabled,
      independentAbortProbability: INDEPENDENT_ABORT_PROBABILITY,
      allAbortProbability: { D0: controlTerminal.d0, D1: controlTerminal.d1 },
      envelope: ratioEnvelope(feedbackDisabled),
    },
    observerBoundary: {
      publicSeesRejectedCandidate: false,
      outcomeAborterSeesCandidateBeforeDecision: true,
      independentAborterSeesCandidateBeforeDecision: false,
      teacherSeesBothNeighborDistributions: true,
    },
  }
}
