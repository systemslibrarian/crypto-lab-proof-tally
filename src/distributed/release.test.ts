import { describe, expect, it } from 'vitest'
import { tamperProofShare } from '../prio3/core'
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
  type BuiltParticipantReport,
  type DistributedContextBinding,
  type ShardingMaterial,
} from './report'
import {
  OneReleaseLedger,
  completeDelivery,
  createOmniscientTeachingTrace,
  releaseCommittedBatch,
  type CommittedBatch,
  type CommittedCohortMember,
  type DeliveredSubmission,
} from './release'

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
    randomness: Uint8Array.from({ length: 64 }, (_, index) => (id * 101 + index * 17) & 0xff),
  }
}

function builtParticipant(
  binding: DistributedContextBinding,
  index: number,
  honest: boolean,
): BuiltParticipantReport {
  const participant = { participantId: `person-${index}`, salaryDollars: BigInt(index + 1) * 5_000n }
  if (!honest) return createCorruptFixedZeroReport(binding, participant, material(index + 1))
  const result = createHonestParticipantReport(binding, participant, new ByteQueue([9]), material(index + 1))
  if (result.status !== 'built') throw new Error('inactive fixture unexpectedly aborted')
  return result.value
}

function fixtureBatch(
  batchId: string,
  honestCount = 6,
): { batch: CommittedBatch; built: BuiltParticipantReport[] } {
  const cohort: CommittedCohortMember[] = Array.from({ length: 12 }, (_, index) => ({
    participantId: `person-${index}`,
    integrity: index < honestCount ? 'honest' : 'corrupt-fixed-zero',
  }))
  const binding = createDistributedContextBinding(batchId, cohort.map((member) => member.participantId))
  const built = Array.from(
    { length: 12 },
    (_, index) => builtParticipant(binding, index, index < honestCount),
  )
  return {
    batch: {
      batchId,
      cohort,
      submissions: built.map((item) => completeDelivery(item.submission)),
      aggregatorTrust: 'non-colluding',
    },
    built,
  }
}

describe('strict distributed release', () => {
  it('prepares all twelve real Prio3 reports and exposes only the noisy collector result', () => {
    const { batch, built } = fixtureBatch('valid-six-honest')
    const result = releaseCommittedBatch(batch, new OneReleaseLedger())
    expect(result.status).toBe('released')
    if (result.status !== 'released') throw new Error(`unexpected abort: ${result.reason}`)

    expect(result.collector.noisyQuantizedUnits).toBe(78n)
    expect(result.collector.noisyDollars).toBe(390_000n)
    expect(result.collector.participantCount).toBe(12)
    expect(result.collector.privacy.accounting.noneActiveDelta).toEqual({
      numerator: 1n,
      denominator: 1_000_000n,
    })

    const collectorKeys = Object.keys(result.collector).sort()
    expect(collectorKeys).toEqual(['batchId', 'noisyDollars', 'noisyQuantizedUnits', 'participantCount', 'privacy'])
    expect(collectorKeys.some((key) => /exact|noise|activation|contribution/i.test(key))).toBe(false)

    const teaching = createOmniscientTeachingTrace(
      result.collector,
      built.map((item) => item.teachingTrace),
    )
    expect(teaching.exactQuantizedUnits).toBe(78n)
    expect(teaching.totalNoiseUnits).toBe(0n)
    expect(teaching.rawShiftedAggregateUnits).toBe(49_230n)
  })

  it('publishes threshold accounting without revealing the actual honest-client count', () => {
    const threshold = fixtureBatch('public-accounting-threshold', 6)
    const allHonest = fixtureBatch('public-accounting-all-honest', 12)
    const thresholdResult = releaseCommittedBatch(threshold.batch, new OneReleaseLedger())
    const allHonestResult = releaseCommittedBatch(allHonest.batch, new OneReleaseLedger())
    if (thresholdResult.status !== 'released' || allHonestResult.status !== 'released') {
      throw new Error('public-accounting fixtures unexpectedly aborted')
    }

    expect(thresholdResult.collector.privacy).toEqual(allHonestResult.collector.privacy)
    expect(thresholdResult.collector.privacy.accounting.noneActiveDelta).toEqual({
      numerator: 1n,
      denominator: 1_000_000n,
    })
    expect(JSON.stringify(thresholdResult.collector, (_, value) => typeof value === 'bigint' ? String(value) : value))
      .not.toContain('honestParticipants')
  })

  it('decodes a negative aggregate with ordinary bigint subtraction', () => {
    const protocol = createDistributedProtocol()
    const cohort = Array.from({ length: 6 }, (_, index) => ({
      participantId: `negative-${index}`,
      integrity: 'honest' as const,
    }))
    const binding = createDistributedContextBinding(
      'negative-signed-result',
      cohort.map((member) => member.participantId),
    )
    const submissions: DeliveredSubmission[] = cohort.map((member, index) => ({
      participantId: member.participantId,
      delivery: 'both-aggregators',
      report: protocol.shard(
        distributedContext(binding),
        0n,
        material(100 + index).nonce,
        material(100 + index).randomness,
      ),
    }))
    const result = releaseCommittedBatch(
      { batchId: 'negative-signed-result', cohort, submissions, aggregatorTrust: 'non-colluding' },
      new OneReleaseLedger(),
    )
    expect(result.status).toBe('released')
    if (result.status === 'released') expect(result.collector.noisyQuantizedUnits).toBe(-24_576n)
  })

  it('aborts rather than aggregating a missing committed report', () => {
    const { batch } = fixtureBatch('missing')
    const result = releaseCommittedBatch(
      { ...batch, submissions: batch.submissions.slice(0, -1) },
      new OneReleaseLedger(),
    )
    expect(result).toEqual({ status: 'aborted', batchId: 'missing', reason: 'missing-submission' })
  })

  it.each(['leader-only', 'helper-only', 'not-delivered'] as const)(
    'aborts a %s post-commit delivery without releasing a subset',
    (delivery) => {
      const { batch } = fixtureBatch(`partial-${delivery}`)
      const submissions = [...batch.submissions]
      submissions[3] = { ...submissions[3], delivery }
      expect(releaseCommittedBatch({ ...batch, submissions }, new OneReleaseLedger())).toEqual({
        status: 'aborted',
        batchId: `partial-${delivery}`,
        reason: 'partial-delivery',
      })
    },
  )

  it('aborts duplicate nonces before preparation can count a replay', () => {
    const { batch } = fixtureBatch('duplicate-nonce')
    const submissions = [...batch.submissions]
    submissions[1] = { ...submissions[1], report: submissions[0].report }
    expect(releaseCommittedBatch({ ...batch, submissions }, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'duplicate-nonce',
      reason: 'duplicate-nonce',
    })
  })

  it('rejects reports transplanted into a different committed batch', () => {
    const { batch } = fixtureBatch('bound-batch-a')
    const transplanted = { ...batch, batchId: 'bound-batch-b' }
    expect(releaseCommittedBatch(transplanted, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'bound-batch-b',
      reason: 'preparation-rejected',
    })
  })

  it('characterizes that same-context roster labels need external sender authentication', () => {
    const { batch } = fixtureBatch('sender-authentication-omitted')
    const submissions = batch.submissions.map((submission) => ({ ...submission }))
    const firstReport = submissions[0].report
    submissions[0].report = submissions[1].report
    submissions[1].report = firstReport

    const result = releaseCommittedBatch({ ...batch, submissions }, new OneReleaseLedger())
    expect(result.status).toBe('released')
    if (result.status === 'released') expect(result.collector.noisyQuantizedUnits).toBe(78n)
  })

  it('rejects reports when the exact committed cohort order changes', () => {
    const { batch } = fixtureBatch('ordered-cohort')
    const reordered = { ...batch, cohort: [...batch.cohort].reverse() }
    expect(releaseCommittedBatch(reordered, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'ordered-cohort',
      reason: 'preparation-rejected',
    })
  })

  it('rejects a report proved under a mismatched mechanism parameter context', () => {
    const { batch } = fixtureBatch('parameter-bound')
    const binding = createDistributedContextBinding(
      batch.batchId,
      batch.cohort.map((member) => member.participantId),
    )
    const alteredContext = encodeDistributedContext(binding, {
      ...DISTRIBUTED_MECHANISM_PARAMETERS,
      epsilonNumerator: 2n,
    })
    const protocol = createDistributedProtocol()
    const altered = protocol.shard(
      alteredContext,
      4_097n,
      material(220).nonce,
      material(220).randomness,
    )
    expect(protocol.prepare(demonstrationVerifyKey(), alteredContext, altered).accepted).toBe(true)
    const submissions = [...batch.submissions]
    submissions[0] = { ...submissions[0], report: altered }
    expect(releaseCommittedBatch({ ...batch, submissions }, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'parameter-bound',
      reason: 'preparation-rejected',
    })
  })

  it('aborts the whole batch when one proof is rejected', () => {
    const { batch } = fixtureBatch('rejected-proof')
    const submissions = [...batch.submissions]
    submissions[4] = { ...submissions[4], report: tamperProofShare(submissions[4].report!) }
    expect(releaseCommittedBatch({ ...batch, submissions }, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'rejected-proof',
      reason: 'preparation-rejected',
    })
  })

  it('rejects duplicate or foreign submission identities', () => {
    const { batch } = fixtureBatch('bad-submission-set')
    const submissions = [...batch.submissions]
    submissions[1] = { ...submissions[1], participantId: submissions[0].participantId }
    expect(releaseCommittedBatch({ ...batch, submissions }, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'bad-submission-set',
      reason: 'submission-set-mismatch',
    })
  })

  it('refuses below-threshold and all-corrupt teaching scenarios', () => {
    const five = fixtureBatch('five-honest', 5).batch
    expect(releaseCommittedBatch(five, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'five-honest',
      reason: 'insufficient-honest-participants',
    })
    const zero = fixtureBatch('all-corrupt', 0).batch
    expect(releaseCommittedBatch(zero, new OneReleaseLedger())).toEqual({
      status: 'aborted',
      batchId: 'all-corrupt',
      reason: 'insufficient-honest-participants',
    })
  })

  it('refuses a colluding-aggregator scenario instead of claiming composed privacy', () => {
    const { batch } = fixtureBatch('colluding')
    expect(releaseCommittedBatch(
      { ...batch, aggregatorTrust: 'colluding' },
      new OneReleaseLedger(),
    )).toEqual({ status: 'aborted', batchId: 'colluding', reason: 'aggregator-collusion' })
  })

  it('allows only one attempt per committed batch, including after an abort', () => {
    const ledger = new OneReleaseLedger()
    const { batch } = fixtureBatch('one-attempt')
    const incomplete = { ...batch, submissions: batch.submissions.slice(0, -1) }
    expect(releaseCommittedBatch(incomplete, ledger)).toMatchObject({ reason: 'missing-submission' })
    expect(ledger.hasAttempted('one-attempt')).toBe(true)
    expect(releaseCommittedBatch(batch, ledger)).toEqual({
      status: 'aborted',
      batchId: 'one-attempt',
      reason: 'already-attempted',
    })
  })

  it('validates the fixed cohort before consuming a release id', () => {
    const ledger = new OneReleaseLedger()
    const { batch } = fixtureBatch('invalid-cohort')
    const duplicate = [...batch.cohort]
    duplicate[1] = duplicate[0]
    expect(releaseCommittedBatch({ ...batch, cohort: duplicate }, ledger)).toMatchObject({
      reason: 'invalid-committed-cohort',
    })
    expect(ledger.hasAttempted('invalid-cohort')).toBe(false)
  })

  it('rejects a teaching trace that cannot independently reproduce the release', () => {
    const { batch, built } = fixtureBatch('bad-teaching-trace')
    const result = releaseCommittedBatch(batch, new OneReleaseLedger())
    if (result.status !== 'released') throw new Error('fixture unexpectedly aborted')
    const traces = built.map((item) => item.teachingTrace)
    traces[0] = {
      ...traces[0],
      noiseUnits: traces[0].noiseUnits + 1n,
      shiftedContributionUnits: traces[0].shiftedContributionUnits + 1n,
    }
    expect(() => createOmniscientTeachingTrace(result.collector, traces)).toThrow('does not reproduce')

    const shiftedMismatch = built.map((item) => item.teachingTrace)
    shiftedMismatch[0] = {
      ...shiftedMismatch[0],
      shiftedContributionUnits: shiftedMismatch[0].shiftedContributionUnits + 1n,
    }
    expect(() => createOmniscientTeachingTrace(result.collector, shiftedMismatch)).toThrow('inconsistent shifted')
  })
})
