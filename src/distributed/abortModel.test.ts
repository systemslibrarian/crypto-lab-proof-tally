import { describe, expect, it } from 'vitest'
import {
  ABORT_AT_OR_BELOW,
  DEFAULT_RETRY_CAP,
  add,
  analyzeAbortRetry,
  assertNormalized,
  compare,
  divide,
  geometricHalfCdf,
  geometricHalfProbability,
  multiply,
  outcomeProbability,
  power,
  rational,
  rationalKey,
  selectiveAbortProbability,
  subtract,
  type Rational,
  type TranscriptEvent,
} from './abortModel'

function sum(events: readonly TranscriptEvent[], side: 'd0' | 'd1'): Rational {
  return events.reduce((total, event) => add(total, event[side]), rational(0n, 1n))
}

describe('exact rational arithmetic', () => {
  it('reduces signs and implements the four field operations without floating point', () => {
    expect(rational(-2n, -4n)).toEqual(rational(1n, 2n))
    expect(rational(2n, -4n)).toEqual(rational(-1n, 2n))
    expect(add(rational(1n, 3n), rational(1n, 6n))).toEqual(rational(1n, 2n))
    expect(subtract(rational(1n, 3n), rational(1n, 2n))).toEqual(rational(-1n, 6n))
    expect(multiply(rational(2n, 3n), rational(9n, 4n))).toEqual(rational(3n, 2n))
    expect(divide(rational(2n, 3n), rational(4n, 9n))).toEqual(rational(3n, 2n))
    expect(power(rational(2n, 3n), 3)).toEqual(rational(8n, 27n))
    expect(compare(rational(5n, 2n), rational(2n, 1n))).toBe(1)
    expect(rationalKey(rational(8n, 4n))).toBe('2')
    expect(rationalKey(rational(1n, 10n))).toBe('1/10')
  })

  it('rejects undefined rational operations and exponents', () => {
    expect(() => rational(1n, 0n)).toThrow('denominator')
    expect(() => divide(rational(1n, 2n), rational(0n, 1n))).toThrow('divide by zero')
    expect(() => power(rational(1n, 2n), -1)).toThrow('non-negative safe integer')
    expect(() => power(rational(1n, 2n), 1.5)).toThrow('non-negative safe integer')
  })
})

describe('two-sided geometric mechanism', () => {
  it('uses the exact normalized p=1/2 law and its closed-form tails', () => {
    expect(geometricHalfProbability(0n)).toEqual(rational(1n, 3n))
    expect(geometricHalfProbability(-3n)).toEqual(rational(1n, 24n))
    expect(geometricHalfProbability(3n)).toEqual(rational(1n, 24n))
    expect(geometricHalfCdf(-2n)).toEqual(rational(1n, 6n))
    expect(geometricHalfCdf(-1n)).toEqual(rational(1n, 3n))
    expect(geometricHalfCdf(0n)).toEqual(rational(2n, 3n))
    expect(geometricHalfCdf(2n)).toEqual(rational(11n, 12n))
  })

  it('shifts the same noise law by the neighboring query answers', () => {
    expect(outcomeProbability('D0', 0n)).toEqual(rational(1n, 3n))
    expect(outcomeProbability('D1', 0n)).toEqual(rational(1n, 6n))
    expect(outcomeProbability('D0', 1n)).toEqual(rational(1n, 6n))
    expect(outcomeProbability('D1', 1n)).toEqual(rational(1n, 3n))
  })
})

describe('CL084 abort/retry teaching analysis', () => {
  const analysis = analyzeAbortRetry(DEFAULT_RETRY_CAP)

  it('uses the declared outcome-only policy and derives its one-attempt probabilities', () => {
    expect(analysis.threshold).toBe(ABORT_AT_OR_BELOW)
    expect(analysis.threshold).toBe(-1n)
    expect(selectiveAbortProbability('D0')).toEqual(rational(1n, 3n))
    expect(selectiveAbortProbability('D1')).toEqual(rational(1n, 6n))
    expect(analysis.selectiveOneAttempt.abortProbability).toEqual({
      D0: rational(1n, 3n),
      D1: rational(1n, 6n),
    })
  })

  it('normalizes every complete observer transcript for both neighbors', () => {
    for (const events of [
      analysis.ordinary.events,
      analysis.selectiveOneAttempt.events,
      analysis.conditionedOnPublication.events,
      analysis.cappedSelectiveRetry.events,
      analysis.feedbackDisabledControl.events,
    ]) {
      expect(sum(events, 'd0')).toEqual(rational(1n, 1n))
      expect(sum(events, 'd1')).toEqual(rational(1n, 1n))
      expect(() => assertNormalized(events)).not.toThrow()
    }
  })

  it('detects a deliberately unnormalized transcript', () => {
    expect(() => assertNormalized([
      { label: 'missing mass', d0: rational(1n, 2n), d1: rational(1n, 1n) },
    ])).toThrow('D0 transcript probabilities sum to 1/2, not 1')
  })

  it('keeps one ordinary release and one visible selective-abort attempt tight at ln(2)', () => {
    expect(analysis.ordinary.envelope.tightRatio).toEqual(rational(2n, 1n))
    expect(analysis.selectiveOneAttempt.envelope.tightRatio).toEqual(rational(2n, 1n))
  })

  it('re-normalizes success-conditioned publication and exposes the changed bound', () => {
    expect(analysis.conditionedOnPublication.zeroProbability).toEqual({
      D0: rational(1n, 2n),
      D1: rational(1n, 5n),
    })
    expect(analysis.conditionedOnPublication.envelope.tightRatio).toEqual(rational(5n, 2n))
    expect(analysis.conditionedOnPublication.envelope.witness).toBe('publish s = 0')
    expect(analysis.conditionedOnPublication.envelope.direction).toBe('D0/D1')
    expect(analysis.conditionedOnPublication.deltaAtOriginalRatio).toEqual(rational(1n, 10n))
  })

  it('enumerates the complete capped-three transcript and gets the tight composed ratio', () => {
    expect(analysis.retryCap).toBe(3)
    expect(analysis.cappedSelectiveRetry.events.map((event) => event.label)).toEqual([
      'P: publish s = 0',
      'P: publish s >= 1',
      'A P: publish s = 0',
      'A P: publish s >= 1',
      'A A P: publish s = 0',
      'A A P: publish s >= 1',
      'A A A: cap reached',
    ])
    expect(analysis.cappedSelectiveRetry.allAbortProbability).toEqual({
      D0: rational(1n, 27n),
      D1: rational(1n, 216n),
    })
    expect(analysis.cappedSelectiveRetry.envelope.tightRatio).toEqual(rational(8n, 1n))
  })

  it('keeps the independent-abort control at the original bound', () => {
    expect(analysis.feedbackDisabledControl.independentAbortProbability).toEqual(rational(1n, 3n))
    expect(analysis.feedbackDisabledControl.allAbortProbability).toEqual({
      D0: rational(1n, 27n),
      D1: rational(1n, 27n),
    })
    expect(analysis.feedbackDisabledControl.envelope.tightRatio).toEqual(rational(2n, 1n))
  })

  it('keeps public, aborter-only, and omniscient teaching views distinct', () => {
    expect(analysis.observerBoundary).toEqual({
      publicSeesRejectedCandidate: false,
      outcomeAborterSeesCandidateBeforeDecision: true,
      independentAborterSeesCandidateBeforeDecision: false,
      teacherSeesBothNeighborDistributions: true,
    })
  })

  it('supports smaller caps but rejects zero, oversized, and non-integral caps', () => {
    expect(analyzeAbortRetry(1).cappedSelectiveRetry.envelope.tightRatio).toEqual(rational(2n, 1n))
    expect(analyzeAbortRetry(2).cappedSelectiveRetry.envelope.tightRatio).toEqual(rational(4n, 1n))
    expect(() => analyzeAbortRetry(0)).toThrow('integer from 1 through 3')
    expect(() => analyzeAbortRetry(4)).toThrow('integer from 1 through 3')
    expect(() => analyzeAbortRetry(1.5)).toThrow('integer from 1 through 3')
  })
})
