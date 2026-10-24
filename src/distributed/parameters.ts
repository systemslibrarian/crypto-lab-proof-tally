import { FIELD64_MODULUS } from '../field/field64'

/**
 * Fixed parameters for the S04 teaching composition.
 *
 * Sampling code uses only the exact integer/rational constants below. The few
 * floating-point values produced by privacyAccounting() are explanatory upper
 * bounds; they are never used to decide whether a random event occurs.
 */
export const MAX_COMMITTED_COHORT_SIZE = 12
export const SALARY_FLOOR_DOLLARS = 0n
export const SALARY_CEILING_DOLLARS = 250_000n
export const QUANTIZATION_STEP_DOLLARS = 5_000n
export const MAX_QUANTIZED_UNITS = 50n
export const REPLACE_ONE_SENSITIVITY_UNITS = 50n

export const EPSILON_NUMERATOR = 1n
export const EPSILON_DENOMINATOR = 1n
export const LAPLACE_SCALE_NUMERATOR = 50n
export const LAPLACE_SCALE_DENOMINATOR = 1n

export const ACTIVATION_NUMERATOR = 9n
export const ACTIVATION_DENOMINATOR = 10n
export const INACTIVE_NUMERATOR = ACTIVATION_DENOMINATOR - ACTIVATION_NUMERATOR
export const ADVERTISED_MINIMUM_HONEST_PARTICIPANTS = 6

export const ABSOLUTE_NOISE_CAP_UNITS = 4_096n
export const CONTRIBUTION_SHIFT_UNITS = ABSOLUTE_NOISE_CAP_UNITS
export const MAX_SHIFTED_CONTRIBUTION_UNITS =
  MAX_QUANTIZED_UNITS + 2n * ABSOLUTE_NOISE_CAP_UNITS

export interface QuantizedSalary {
  suppliedDollars: bigint
  clampedDollars: bigint
  units: bigint
}

export interface ExactFraction {
  numerator: bigint
  denominator: bigint
}

export interface PrivacyAccounting {
  /** Exact rational probability that none of the declared honest clients activates. */
  noneActiveDelta: ExactFraction
  /** Floating-point rendering of noneActiveDelta; not used by a sampler. */
  noneActiveDeltaApproximation: number
  /** Binary64 approximation of the exact discrete-Laplace probability that |Y| exceeds B. */
  perActiveDrawCapTailApproximation: number
  /** Binary64 approximation of the analytic union bound n * tail (without beta credit). */
  capTailUnionBoundApproximation: number
  /** Binary64 approximation of the analytic coupling bound (1 + exp(epsilon)) * eta. */
  capCouplingDeltaApproximation: number
  /**
   * Keep the additive terms separate: binary64 cannot retain a ~1e-34 term
   * when it is added to 1e-6. A UI should render "1e-6 + 1.17e-34", not claim
   * that a rounded floating-point sum is the mathematical upper bound.
   */
  totalDeltaAccountingTerms: readonly [ExactFraction, number]
}

export function clampAndQuantizeSalary(suppliedDollars: bigint): QuantizedSalary {
  const clampedDollars = suppliedDollars < SALARY_FLOOR_DOLLARS
    ? SALARY_FLOOR_DOLLARS
    : suppliedDollars > SALARY_CEILING_DOLLARS
      ? SALARY_CEILING_DOLLARS
      : suppliedDollars
  return {
    suppliedDollars,
    clampedDollars,
    units: clampedDollars / QUANTIZATION_STEP_DOLLARS,
  }
}

export function assertCommittedCohortSize(cohortSize: number): void {
  if (!Number.isSafeInteger(cohortSize) || cohortSize < 1 || cohortSize > MAX_COMMITTED_COHORT_SIZE) {
    throw new RangeError(`committed cohort size must be an integer from 1 to ${MAX_COMMITTED_COHORT_SIZE}`)
  }
}

export function maximumShiftedAggregate(cohortSize: number): bigint {
  assertCommittedCohortSize(cohortSize)
  return BigInt(cohortSize) * MAX_SHIFTED_CONTRIBUTION_UNITS
}

export function assertAggregateCannotWrapField(cohortSize: number): void {
  const maximum = maximumShiftedAggregate(cohortSize)
  if (maximum >= FIELD64_MODULUS) {
    throw new RangeError('configured shifted aggregate can wrap Field64')
  }
}

/**
 * Decode a canonical, non-wrapped Prio3Sum result as an ordinary signed bigint.
 * Do not replace this subtraction with Field64 subtraction: negative noisy
 * totals are application values, not residues to be mapped back into the field.
 */
export function decodeShiftedAggregate(rawShiftedAggregate: bigint, cohortSize: number): bigint {
  assertAggregateCannotWrapField(cohortSize)
  const maximum = maximumShiftedAggregate(cohortSize)
  if (rawShiftedAggregate < 0n || rawShiftedAggregate > maximum) {
    throw new RangeError('shifted aggregate is outside the committed cohort bound')
  }
  return rawShiftedAggregate - BigInt(cohortSize) * CONTRIBUTION_SHIFT_UNITS
}

export function activationFailureFraction(honestParticipants: number): ExactFraction {
  if (!Number.isSafeInteger(honestParticipants) || honestParticipants < 0) {
    throw new RangeError('honest participant count must be a non-negative integer')
  }
  return {
    numerator: INACTIVE_NUMERATOR ** BigInt(honestParticipants),
    denominator: ACTIVATION_DENOMINATOR ** BigInt(honestParticipants),
  }
}

export function privacyAccounting(honestParticipants: number, cohortSize: number): PrivacyAccounting {
  assertCommittedCohortSize(cohortSize)
  if (!Number.isSafeInteger(honestParticipants) || honestParticipants < 0 || honestParticipants > cohortSize) {
    throw new RangeError('honest participant count must be an integer inside the committed cohort')
  }

  const noneActiveDelta = activationFailureFraction(honestParticipants)
  const noneActiveDeltaApproximation = Number(noneActiveDelta.numerator) / Number(noneActiveDelta.denominator)
  const scale = Number(LAPLACE_SCALE_NUMERATOR) / Number(LAPLACE_SCALE_DENOMINATOR)
  const epsilon = Number(EPSILON_NUMERATOR) / Number(EPSILON_DENOMINATOR)
  const cap = Number(ABSOLUTE_NOISE_CAP_UNITS)

  // Lemma 30 in Canonne--Kamath--Steinke gives
  // P(|Y| > B) = 2 exp(-B/t) / (exp(1/t) + 1) for Y <- Lap_Z(t).
  const perActiveDrawCapTailApproximation = (2 * Math.exp(-cap / scale)) / (Math.exp(1 / scale) + 1)
  // This deliberately forgoes the activation-probability tightening. The union
  // bound is stable even when tau is too small for 1 - (1 - tau)^n in binary64.
  const capTailUnionBoundApproximation = cohortSize * perActiveDrawCapTailApproximation
  const capCouplingDeltaApproximation = (1 + Math.exp(epsilon)) * capTailUnionBoundApproximation

  return {
    noneActiveDelta,
    noneActiveDeltaApproximation,
    perActiveDrawCapTailApproximation,
    capTailUnionBoundApproximation,
    capCouplingDeltaApproximation,
    totalDeltaAccountingTerms: [noneActiveDelta, capCouplingDeltaApproximation],
  }
}
