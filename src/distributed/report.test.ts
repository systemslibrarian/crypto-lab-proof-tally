import { describe, expect, it } from 'vitest'
import type { RandomSource } from './noise'
import {
  createCorruptFixedZeroReport,
  createDistributedContextBinding,
  createDistributedProtocol,
  createHonestParticipantReport,
  demonstrationVerifyKey,
  DISTRIBUTED_MECHANISM_PARAMETERS,
  distributedContext,
  encodeDistributedContext,
  shiftedContribution,
  type ShardingMaterial,
} from './report'

class ByteQueue implements RandomSource {
  private offset = 0
  constructor(private readonly bytes: readonly number[]) {}
  fill(target: Uint8Array): void {
    if (this.offset + target.length > this.bytes.length) throw new Error('deterministic entropy exhausted')
    for (let index = 0; index < target.length; index += 1) target[index] = this.bytes[this.offset++]
  }
}

function material(id: number): ShardingMaterial {
  const nonce = new Uint8Array(16)
  nonce[14] = id >>> 8
  nonce[15] = id
  return {
    nonce,
    randomness: Uint8Array.from({ length: 64 }, (_, index) => (id * 67 + index * 29) & 0xff),
  }
}

const BINDING = createDistributedContextBinding('report-tests', ['Avery', 'Lane', 'Outlier'])

function laplaceFixture(u: number, v: number): number[] {
  return [u, 0, 0, u, ...Array.from({ length: v }, () => [0, 1]).flat(), 1, 1]
}

describe('distributed Prio3 contribution reports', () => {
  it('maps both signed cap endpoints into the exact Prio3Sum range', () => {
    expect(shiftedContribution(0n, -4_096n)).toBe(0n)
    expect(shiftedContribution(50n, 4_096n)).toBe(8_242n)
    expect(() => shiftedContribution(-1n, 0n)).toThrow('[0, 50]')
    expect(() => shiftedContribution(51n, 0n)).toThrow('[0, 50]')
    expect(() => shiftedContribution(0n, -4_097n)).toThrow('absolute cap')
    expect(() => shiftedContribution(50n, 4_097n)).toThrow('absolute cap')
  })

  it('builds and prepares a real Prio3Sum(8242) report for an inactive honest client', () => {
    const built = createHonestParticipantReport(
      BINDING,
      { participantId: 'Lane', salaryDollars: 119_800n },
      new ByteQueue([9]), // 9 is outside the activation interval [0, 9)
      material(1),
    )
    expect(built.status).toBe('built')
    if (built.status !== 'built') throw new Error('fixture unexpectedly aborted')
    expect(built.value.teachingTrace).toMatchObject({
      quantizedUnits: 23n,
      activation: 'inactive',
      noiseUnits: 0n,
      shiftedContributionUnits: 4_119n,
    })

    const protocol = createDistributedProtocol()
    const trace = protocol.prepare(
      demonstrationVerifyKey(),
      distributedContext(BINDING),
      built.value.submission.report,
    )
    expect(protocol.options.circuit.encode(8_242n)).toHaveLength(14)
    expect(trace.accepted).toBe(true)
  })

  it('clamps before quantization and labels a corrupt fixed-zero choice honestly', () => {
    const built = createCorruptFixedZeroReport(
      BINDING,
      { participantId: 'Outlier', salaryDollars: 480_000n },
      material(2),
    )
    expect(built.teachingTrace).toEqual({
      participantId: 'Outlier',
      integrity: 'corrupt-fixed-zero',
      suppliedSalaryDollars: 480_000n,
      clampedSalaryDollars: 250_000n,
      quantizedUnits: 50n,
      activation: 'not-applicable',
      noiseUnits: 0n,
      shiftedContributionUnits: 4_146n,
    })
  })

  it('propagates a final Laplace value above B as a reportless batch abort', () => {
    const entropy = [0, ...laplaceFixture(47, 81)] // active, then +4097
    const result = createHonestParticipantReport(
      BINDING,
      { participantId: 'Avery', salaryDollars: 84_200n },
      new ByteQueue(entropy),
      material(3),
    )
    expect(result).toEqual({
      status: 'aborted',
      reason: 'noise-cap-exceeded',
      participantId: 'Avery',
    })
  })

  it('rejects an empty participant identity before consuming entropy', () => {
    expect(() => createHonestParticipantReport(
      BINDING,
      { participantId: '  ', salaryDollars: 10_000n },
      new ByteQueue([]),
      material(4),
    )).toThrow('participant id')
  })

  it('uses an unambiguous canonical batch and ordered-cohort encoding', () => {
    const first = createDistributedContextBinding('a', ['bc'])
    const second = createDistributedContextBinding('ab', ['c'])
    const reordered = createDistributedContextBinding('report-tests', ['Lane', 'Avery', 'Outlier'])
    expect(distributedContext(first)).not.toEqual(distributedContext(second))
    expect(distributedContext(BINDING)).not.toEqual(distributedContext(reordered))
    expect(distributedContext(BINDING)).toEqual(distributedContext(BINDING))
  })

  it('copies and freezes the committed cohort and rejects lossy UTF-8 inputs', () => {
    const participantIds = ['Avery', 'Lane']
    const binding = createDistributedContextBinding('immutable-batch', participantIds)
    participantIds.reverse()
    expect(binding.orderedParticipantIds).toEqual(['Avery', 'Lane'])
    expect(Object.isFrozen(binding)).toBe(true)
    expect(Object.isFrozen(binding.orderedParticipantIds)).toBe(true)
    expect(() => createDistributedContextBinding('\ud800', ['Avery'])).toThrow('well-formed Unicode')
    expect(() => createDistributedContextBinding('batch', ['\udc00'])).toThrow('well-formed Unicode')
  })

  it('binds every fixed mechanism parameter into the canonical context', () => {
    const fixed = distributedContext(BINDING)
    const alterations: readonly [keyof typeof DISTRIBUTED_MECHANISM_PARAMETERS, unknown][] = [
      ['vdafDraft', 'draft-irtf-cfrg-vdaf-23'],
      ['vdafInstance', 'Prio3Count'],
      ['field', 'Field128'],
      ['aggregatorCount', 3],
      ['salaryFloorDollars', 1n],
      ['salaryCeilingDollars', 249_999n],
      ['quantizationStepDollars', 4_999n],
      ['quantizationRule', 'round-to-nearest'],
      ['minimumQuantizedUnits', 1n],
      ['maximumQuantizedUnits', 51n],
      ['adjacency', 'add-remove-one'],
      ['sensitivityUnits', 49n],
      ['epsilonNumerator', 2n],
      ['epsilonDenominator', 2n],
      ['activationNumerator', 8n],
      ['activationDenominator', 11n],
      ['activationMode', 'shared-coin'],
      ['advertisedMinimumHonestParticipants', 7],
      ['laplaceScaleNumerator', 49n],
      ['laplaceScaleDenominator', 2n],
      ['absoluteNoiseCapUnits', 4_095n],
      ['capRule', 'truncate-at-cap'],
      ['contributionShiftUnits', 4_095n],
      ['maximumShiftedContributionUnits', 8_243n],
      ['maximumCommittedCohortSize', 11],
      ['releasePolicy', 'retry-after-abort'],
      ['samplerVersion', 'different-sampler/v2'],
    ]

    expect(alterations.map(([field]) => field).sort()).toEqual(
      Object.keys(DISTRIBUTED_MECHANISM_PARAMETERS).sort(),
    )
    for (const [field, value] of alterations) {
      const altered = {
        ...DISTRIBUTED_MECHANISM_PARAMETERS,
        [field]: value,
      } as typeof DISTRIBUTED_MECHANISM_PARAMETERS
      expect(encodeDistributedContext(BINDING, altered), field).not.toEqual(fixed)
    }
  })

  it('refuses to build a report for a participant outside the bound cohort', () => {
    expect(() => createCorruptFixedZeroReport(
      BINDING,
      { participantId: 'Mallory', salaryDollars: 10_000n },
      material(9),
    )).toThrow('not in the distributed context cohort')
  })
})
