import { describe, expect, it } from 'vitest'
import { FIELD64_MODULUS } from '../field/field64'
import {
  ABSOLUTE_NOISE_CAP_UNITS,
  ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
  CONTRIBUTION_SHIFT_UNITS,
  MAX_QUANTIZED_UNITS,
  MAX_SHIFTED_CONTRIBUTION_UNITS,
  QUANTIZATION_STEP_DOLLARS,
  REPLACE_ONE_SENSITIVITY_UNITS,
  activationFailureFraction,
  assertAggregateCannotWrapField,
  assertCommittedCohortSize,
  clampAndQuantizeSalary,
  decodeShiftedAggregate,
  maximumShiftedAggregate,
  privacyAccounting,
} from './parameters'

describe('S04 fixed parameters and quantization', () => {
  it.each([
    [-1n, 0n, 0n],
    [0n, 0n, 0n],
    [4_999n, 4_999n, 0n],
    [5_000n, 5_000n, 1n],
    [249_999n, 249_999n, 49n],
    [250_000n, 250_000n, 50n],
    [480_000n, 250_000n, 50n],
  ])('clamps %s to %s and floors it to %s units', (supplied, clamped, units) => {
    expect(clampAndQuantizeSalary(supplied)).toEqual({
      suppliedDollars: supplied,
      clampedDollars: clamped,
      units,
    })
  })

  it('declares the fixed-size replace-one sensitivity from the actual endpoints', () => {
    const low = clampAndQuantizeSalary(-10_000n).units
    const high = clampAndQuantizeSalary(900_000n).units
    expect(high - low).toBe(REPLACE_ONE_SENSITIVITY_UNITS)
    expect(MAX_QUANTIZED_UNITS).toBe(50n)
    expect(QUANTIZATION_STEP_DOLLARS).toBe(5_000n)
  })

  it('derives the shifted contribution and aggregate bounds', () => {
    expect(CONTRIBUTION_SHIFT_UNITS).toBe(ABSOLUTE_NOISE_CAP_UNITS)
    expect(MAX_SHIFTED_CONTRIBUTION_UNITS).toBe(8_242n)
    expect(maximumShiftedAggregate(12)).toBe(98_904n)
    expect(maximumShiftedAggregate(12)).toBeLessThan(FIELD64_MODULUS)
    expect(() => assertAggregateCannotWrapField(12)).not.toThrow()
  })

  it('refuses invalid committed cohort sizes', () => {
    for (const invalid of [0, 13, 1.5, Number.NaN]) {
      expect(() => assertCommittedCohortSize(invalid)).toThrow('committed cohort size')
    }
  })

  it('decodes signed totals only after checking the canonical raw bound', () => {
    expect(decodeShiftedAggregate(0n, 12)).toBe(-49_152n)
    expect(decodeShiftedAggregate(49_152n, 12)).toBe(0n)
    expect(decodeShiftedAggregate(98_904n, 12)).toBe(49_752n)
    expect(() => decodeShiftedAggregate(-1n, 12)).toThrow('outside')
    expect(() => decodeShiftedAggregate(98_905n, 12)).toThrow('outside')
  })
})

describe('S04 privacy accounting', () => {
  it('keeps the none-active probability exact at and below the advertised threshold', () => {
    expect(ADVERTISED_MINIMUM_HONEST_PARTICIPANTS).toBe(6)
    expect(activationFailureFraction(6)).toEqual({ numerator: 1n, denominator: 1_000_000n })
    expect(activationFailureFraction(5)).toEqual({ numerator: 1n, denominator: 100_000n })
    expect(activationFailureFraction(0)).toEqual({ numerator: 1n, denominator: 1n })
  })

  it('uses the exact cap-tail formula and a conservative union bound', () => {
    const accounting = privacyAccounting(6, 12)
    expect(accounting.noneActiveDeltaApproximation).toBe(1e-6)
    expect(Math.abs(accounting.perActiveDrawCapTailApproximation / 2.619578294758e-36 - 1)).toBeLessThan(1e-12)
    expect(Math.abs(accounting.capTailUnionBoundApproximation / 3.143493953710e-35 - 1)).toBeLessThan(1e-12)
    expect(Math.abs(accounting.capCouplingDeltaApproximation / 1.168839644595e-34 - 1)).toBeLessThan(1e-12)
    expect(accounting.capTailUnionBoundApproximation).toBe(12 * accounting.perActiveDrawCapTailApproximation)
    expect(accounting.totalDeltaAccountingTerms).toEqual([
      { numerator: 1n, denominator: 1_000_000n },
      accounting.capCouplingDeltaApproximation,
    ])
  })

  it('rejects impossible honesty counts', () => {
    expect(() => privacyAccounting(-1, 12)).toThrow('honest participant count')
    expect(() => privacyAccounting(13, 12)).toThrow('honest participant count')
    expect(() => activationFailureFraction(1.5)).toThrow('honest participant count')
  })
})
