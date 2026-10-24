import type { Prio3 } from '../prio3/core'
import { createPrio3Sum } from '../prio3/instances'
import type { Report } from '../prio3/types'
import { sampleActivatedNoise, webCryptoRandomSource, type RandomSource } from './noise'
import {
  ABSOLUTE_NOISE_CAP_UNITS,
  ACTIVATION_DENOMINATOR,
  ACTIVATION_NUMERATOR,
  ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
  CONTRIBUTION_SHIFT_UNITS,
  EPSILON_DENOMINATOR,
  EPSILON_NUMERATOR,
  LAPLACE_SCALE_DENOMINATOR,
  LAPLACE_SCALE_NUMERATOR,
  MAX_COMMITTED_COHORT_SIZE,
  MAX_QUANTIZED_UNITS,
  MAX_SHIFTED_CONTRIBUTION_UNITS,
  QUANTIZATION_STEP_DOLLARS,
  REPLACE_ONE_SENSITIVITY_UNITS,
  SALARY_CEILING_DOLLARS,
  SALARY_FLOOR_DOLLARS,
  assertCommittedCohortSize,
  clampAndQuantizeSalary,
} from './parameters'

const DEMONSTRATION_VERIFY_KEY = Uint8Array.from({ length: 32 }, (_, index) => 0xa5 ^ index)
const CONTEXT_MAGIC = 'proof-tally/s04/distributed-dp'
const CONTEXT_FORMAT_VERSION = 1

export type ParticipantIntegrity = 'honest' | 'corrupt-fixed-zero'
export type ActivationState = 'active' | 'inactive' | 'not-applicable'

export interface ParticipantSalary {
  participantId: string
  salaryDollars: bigint
}

export interface DistributedContextBinding {
  readonly batchId: string
  readonly orderedParticipantIds: readonly string[]
}

/**
 * Every fixed choice that changes the meaning or privacy accounting of a
 * distributed report. The canonical context serializes this whole descriptor,
 * so a report prepared under a different mechanism cannot cross tasks.
 */
export interface DistributedMechanismParameters {
  readonly vdafDraft: string
  readonly vdafInstance: 'Prio3Sum'
  readonly field: 'Field64'
  readonly aggregatorCount: 2
  readonly salaryFloorDollars: bigint
  readonly salaryCeilingDollars: bigint
  readonly quantizationStepDollars: bigint
  readonly quantizationRule: 'clamp-then-floor'
  readonly minimumQuantizedUnits: 0n
  readonly maximumQuantizedUnits: bigint
  readonly adjacency: 'fixed-size-replace-one'
  readonly sensitivityUnits: bigint
  readonly epsilonNumerator: bigint
  readonly epsilonDenominator: bigint
  readonly activationNumerator: bigint
  readonly activationDenominator: bigint
  readonly activationMode: 'independent-per-honest-client'
  readonly advertisedMinimumHonestParticipants: number
  readonly laplaceScaleNumerator: bigint
  readonly laplaceScaleDenominator: bigint
  readonly absoluteNoiseCapUnits: bigint
  readonly capRule: 'accept-absolute-cap-abort-above-no-retry'
  readonly contributionShiftUnits: bigint
  readonly maximumShiftedContributionUnits: bigint
  readonly maximumCommittedCohortSize: number
  readonly releasePolicy: 'one-release-attempt-after-report-assembly'
  readonly samplerVersion: string
}

export const DISTRIBUTED_MECHANISM_PARAMETERS: DistributedMechanismParameters = Object.freeze({
  vdafDraft: 'draft-irtf-cfrg-vdaf-22',
  vdafInstance: 'Prio3Sum',
  field: 'Field64',
  aggregatorCount: 2,
  salaryFloorDollars: SALARY_FLOOR_DOLLARS,
  salaryCeilingDollars: SALARY_CEILING_DOLLARS,
  quantizationStepDollars: QUANTIZATION_STEP_DOLLARS,
  quantizationRule: 'clamp-then-floor',
  minimumQuantizedUnits: 0n,
  maximumQuantizedUnits: MAX_QUANTIZED_UNITS,
  adjacency: 'fixed-size-replace-one',
  sensitivityUnits: REPLACE_ONE_SENSITIVITY_UNITS,
  epsilonNumerator: EPSILON_NUMERATOR,
  epsilonDenominator: EPSILON_DENOMINATOR,
  activationNumerator: ACTIVATION_NUMERATOR,
  activationDenominator: ACTIVATION_DENOMINATOR,
  activationMode: 'independent-per-honest-client',
  advertisedMinimumHonestParticipants: ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
  laplaceScaleNumerator: LAPLACE_SCALE_NUMERATOR,
  laplaceScaleDenominator: LAPLACE_SCALE_DENOMINATOR,
  absoluteNoiseCapUnits: ABSOLUTE_NOISE_CAP_UNITS,
  capRule: 'accept-absolute-cap-abort-above-no-retry',
  contributionShiftUnits: CONTRIBUTION_SHIFT_UNITS,
  maximumShiftedContributionUnits: MAX_SHIFTED_CONTRIBUTION_UNITS,
  maximumCommittedCohortSize: MAX_COMMITTED_COHORT_SIZE,
  releasePolicy: 'one-release-attempt-after-report-assembly',
  samplerVersion: 'canonne-kamath-steinke-algorithms-1-and-2/lap-z-rational/v1',
})

export interface ShardingMaterial {
  nonce: Uint8Array
  randomness: Uint8Array
}

export interface DistributedParticipantReport {
  participantId: string
  report: Report
}

/** Omniscient teaching data. This must never be placed in CollectorRelease. */
export interface TeachingContributionTrace {
  participantId: string
  integrity: ParticipantIntegrity
  suppliedSalaryDollars: bigint
  clampedSalaryDollars: bigint
  quantizedUnits: bigint
  activation: ActivationState
  noiseUnits: bigint
  shiftedContributionUnits: bigint
}

export interface BuiltParticipantReport {
  submission: DistributedParticipantReport
  teachingTrace: TeachingContributionTrace
}

export type HonestReportResult =
  | { status: 'built'; value: BuiltParticipantReport }
  | { status: 'aborted'; reason: 'noise-cap-exceeded'; participantId: string }

function encodeUint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('context uint32 is outside its canonical range')
  }
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value)
}

function encodeUint64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError('context uint64 is outside its canonical range')
  }
  const output = new Uint8Array(8)
  let remaining = value
  for (let index = output.length - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return output
}

function encodeText(value: string): Uint8Array {
  if (!isWellFormedUnicode(value)) throw new RangeError('context text contains an unpaired surrogate')
  const bytes = new TextEncoder().encode(value)
  const length = encodeUint32(bytes.length)
  const output = new Uint8Array(length.length + bytes.length)
  output.set(length)
  output.set(bytes, length.length)
  return output
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

export function createDistributedContextBinding(
  batchId: string,
  orderedParticipantIds: readonly string[],
): DistributedContextBinding {
  assertCommittedCohortSize(orderedParticipantIds.length)
  if (batchId.trim() === '') throw new RangeError('distributed batch id must not be empty')
  if (!isWellFormedUnicode(batchId)) throw new RangeError('distributed batch id must be well-formed Unicode')
  if (orderedParticipantIds.some((participantId) => participantId.trim() === '')) {
    throw new RangeError('distributed participant ids must not be empty')
  }
  if (orderedParticipantIds.some((participantId) => !isWellFormedUnicode(participantId))) {
    throw new RangeError('distributed participant ids must be well-formed Unicode')
  }
  if (new Set(orderedParticipantIds).size !== orderedParticipantIds.length) {
    throw new RangeError('distributed participant ids must be unique')
  }
  return Object.freeze({
    batchId,
    orderedParticipantIds: Object.freeze([...orderedParticipantIds]),
  })
}

/**
 * Canonical, length-prefixed binary encoding. Strings are UTF-8 with uint32
 * byte lengths; all integers use fixed-width big-endian encodings. The field
 * order below is the version-1 schema and is therefore part of the protocol.
 */
export function encodeDistributedContext(
  binding: DistributedContextBinding,
  parameters: DistributedMechanismParameters,
): Uint8Array {
  const canonical = createDistributedContextBinding(binding.batchId, binding.orderedParticipantIds)
  const parts: Uint8Array[] = [
    encodeText(CONTEXT_MAGIC),
    encodeUint32(CONTEXT_FORMAT_VERSION),
    encodeText(canonical.batchId),
    encodeUint32(canonical.orderedParticipantIds.length),
    ...canonical.orderedParticipantIds.map(encodeText),
    encodeText(parameters.vdafDraft),
    encodeText(parameters.vdafInstance),
    encodeText(parameters.field),
    encodeUint32(parameters.aggregatorCount),
    encodeUint64(parameters.salaryFloorDollars),
    encodeUint64(parameters.salaryCeilingDollars),
    encodeUint64(parameters.quantizationStepDollars),
    encodeText(parameters.quantizationRule),
    encodeUint64(parameters.minimumQuantizedUnits),
    encodeUint64(parameters.maximumQuantizedUnits),
    encodeText(parameters.adjacency),
    encodeUint64(parameters.sensitivityUnits),
    encodeUint64(parameters.epsilonNumerator),
    encodeUint64(parameters.epsilonDenominator),
    encodeUint64(parameters.activationNumerator),
    encodeUint64(parameters.activationDenominator),
    encodeText(parameters.activationMode),
    encodeUint32(parameters.advertisedMinimumHonestParticipants),
    encodeUint64(parameters.laplaceScaleNumerator),
    encodeUint64(parameters.laplaceScaleDenominator),
    encodeUint64(parameters.absoluteNoiseCapUnits),
    encodeText(parameters.capRule),
    encodeUint64(parameters.contributionShiftUnits),
    encodeUint64(parameters.maximumShiftedContributionUnits),
    encodeUint32(parameters.maximumCommittedCohortSize),
    encodeText(parameters.releasePolicy),
    encodeText(parameters.samplerVersion),
  ]
  return concat(parts)
}

export function distributedContext(binding: DistributedContextBinding): Uint8Array {
  return encodeDistributedContext(binding, DISTRIBUTED_MECHANISM_PARAMETERS)
}

export function demonstrationVerifyKey(): Uint8Array {
  return new Uint8Array(DEMONSTRATION_VERIFY_KEY)
}

export function createDistributedProtocol(): Prio3 {
  return createPrio3Sum(MAX_SHIFTED_CONTRIBUTION_UNITS)
}

export function shiftedContribution(quantizedUnits: bigint, noiseUnits: bigint): bigint {
  if (quantizedUnits < 0n || quantizedUnits > MAX_QUANTIZED_UNITS) {
    throw new RangeError('quantized contribution is outside [0, 50]')
  }
  if (noiseUnits < -ABSOLUTE_NOISE_CAP_UNITS || noiseUnits > ABSOLUTE_NOISE_CAP_UNITS) {
    throw new RangeError('noise contribution exceeds the absolute cap')
  }
  const shifted = quantizedUnits + noiseUnits + CONTRIBUTION_SHIFT_UNITS
  if (shifted < 0n || shifted > MAX_SHIFTED_CONTRIBUTION_UNITS) {
    throw new RangeError('shifted contribution is outside the Prio3Sum range')
  }
  return shifted
}

function assertParticipantId(participantId: string): void {
  if (participantId.trim() === '') throw new RangeError('participant id must not be empty')
}

function shardContribution(
  binding: DistributedContextBinding,
  participantId: string,
  contribution: bigint,
  material?: ShardingMaterial,
): DistributedParticipantReport {
  if (!binding.orderedParticipantIds.includes(participantId)) {
    throw new RangeError('participant is not in the distributed context cohort')
  }
  const protocol = createDistributedProtocol()
  const context = distributedContext(binding)
  const report = material === undefined
    ? protocol.shard(context, contribution)
    : protocol.shard(context, contribution, material.nonce, material.randomness)
  return { participantId, report }
}

export function createHonestParticipantReport(
  binding: DistributedContextBinding,
  participant: ParticipantSalary,
  random: RandomSource = webCryptoRandomSource,
  material?: ShardingMaterial,
): HonestReportResult {
  assertParticipantId(participant.participantId)
  const quantized = clampAndQuantizeSalary(participant.salaryDollars)
  const sampled = sampleActivatedNoise(random)
  if (sampled.status === 'aborted') {
    return {
      status: 'aborted',
      reason: sampled.reason,
      participantId: participant.participantId,
    }
  }

  const shifted = shiftedContribution(quantized.units, sampled.value)
  return {
    status: 'built',
    value: {
      submission: shardContribution(binding, participant.participantId, shifted, material),
      teachingTrace: {
        participantId: participant.participantId,
        integrity: 'honest',
        suppliedSalaryDollars: quantized.suppliedDollars,
        clampedSalaryDollars: quantized.clampedDollars,
        quantizedUnits: quantized.units,
        activation: sampled.active ? 'active' : 'inactive',
        noiseUnits: sampled.value,
        shiftedContributionUnits: shifted,
      },
    },
  }
}

/**
 * A corrupt participant can choose a valid combined input. This fixture fixes
 * its noise to zero; Prio3 validates only the resulting shifted integer and
 * does not prove the decomposition, randomness, activation, or salary truth.
 */
export function createCorruptFixedZeroReport(
  binding: DistributedContextBinding,
  participant: ParticipantSalary,
  material?: ShardingMaterial,
): BuiltParticipantReport {
  assertParticipantId(participant.participantId)
  const quantized = clampAndQuantizeSalary(participant.salaryDollars)
  const shifted = shiftedContribution(quantized.units, 0n)
  return {
    submission: shardContribution(binding, participant.participantId, shifted, material),
    teachingTrace: {
      participantId: participant.participantId,
      integrity: 'corrupt-fixed-zero',
      suppliedSalaryDollars: quantized.suppliedDollars,
      clampedSalaryDollars: quantized.clampedDollars,
      quantizedUnits: quantized.units,
      activation: 'not-applicable',
      noiseUnits: 0n,
      shiftedContributionUnits: shifted,
    },
  }
}
