import { aggregateOutputShares, unshard } from '../prio3/aggregate'
import { NonceRegistry } from '../prio3/replay'
import type { Report } from '../prio3/types'
import {
  ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
  CONTRIBUTION_SHIFT_UNITS,
  EPSILON_DENOMINATOR,
  EPSILON_NUMERATOR,
  QUANTIZATION_STEP_DOLLARS,
  REPLACE_ONE_SENSITIVITY_UNITS,
  assertCommittedCohortSize,
  decodeShiftedAggregate,
  privacyAccounting,
  type PrivacyAccounting,
} from './parameters'
import {
  createDistributedProtocol,
  createDistributedContextBinding,
  demonstrationVerifyKey,
  distributedContext,
  type DistributedContextBinding,
  type DistributedParticipantReport,
  type ParticipantIntegrity,
  type TeachingContributionTrace,
} from './report'

export type AggregatorTrust = 'non-colluding' | 'colluding'
export type DeliveryState = 'both-aggregators' | 'leader-only' | 'helper-only' | 'not-delivered'

export interface CommittedCohortMember {
  participantId: string
  /** Omniscient teaching premise; Prio3 does not attest this label. */
  integrity: ParticipantIntegrity
}

export interface DeliveredSubmission {
  participantId: string
  delivery: DeliveryState
  report?: Report
}

/**
 * Membership is fixed by `cohort`. A pre-commit dropout is omitted before this
 * object exists; any absent or one-sided submission afterwards aborts the batch.
 * The caller must authenticate each DeliveredSubmission to its participantId:
 * the teaching wrapper models that intake boundary but does not implement it.
 */
export interface CommittedBatch {
  batchId: string
  cohort: readonly CommittedCohortMember[]
  submissions: readonly DeliveredSubmission[]
  aggregatorTrust: AggregatorTrust
}

export interface PublicPrivacyGuarantee {
  adjacency: 'fixed-size replace-one'
  epsilonNumerator: bigint
  epsilonDenominator: bigint
  sensitivityUnits: bigint
  advertisedMinimumHonestParticipants: number
  accounting: PrivacyAccounting
}

/** Deliberately contains no exact sum, per-client value, activation, or noise. */
export interface CollectorRelease {
  batchId: string
  participantCount: number
  noisyQuantizedUnits: bigint
  noisyDollars: bigint
  privacy: PublicPrivacyGuarantee
}

export type ReleaseAbortReason =
  | 'invalid-committed-cohort'
  | 'already-attempted'
  | 'aggregator-collusion'
  | 'insufficient-honest-participants'
  | 'submission-set-mismatch'
  | 'missing-submission'
  | 'partial-delivery'
  | 'duplicate-nonce'
  | 'preparation-rejected'
  | 'aggregate-bound-violation'

export type ReleaseResult =
  | { status: 'released'; collector: CollectorRelease }
  | { status: 'aborted'; batchId: string; reason: ReleaseAbortReason }

export interface OmniscientTeachingTrace {
  batchId: string
  exactQuantizedUnits: bigint
  totalNoiseUnits: bigint
  rawShiftedAggregateUnits: bigint
  noisyQuantizedUnits: bigint
  contributions: readonly TeachingContributionTrace[]
}

export class OneReleaseLedger {
  private readonly attemptedBatchIds = new Set<string>()

  claim(batchId: string): boolean {
    if (this.attemptedBatchIds.has(batchId)) return false
    this.attemptedBatchIds.add(batchId)
    return true
  }

  hasAttempted(batchId: string): boolean {
    return this.attemptedBatchIds.has(batchId)
  }
}

export function completeDelivery(submission: DistributedParticipantReport): DeliveredSubmission {
  return {
    participantId: submission.participantId,
    delivery: 'both-aggregators',
    report: submission.report,
  }
}

function abort(batchId: string, reason: ReleaseAbortReason): ReleaseResult {
  return { status: 'aborted', batchId, reason }
}

function hasUniqueNonemptyIds(values: readonly string[]): boolean {
  return values.every((value) => value.trim() !== '') && new Set(values).size === values.length
}

/**
 * Execute one all-or-nothing release. This wrapper supplies the cohort,
 * delivery, replay, and signed-decoding checks that raw Prio3 does not. It
 * assumes participantId labels were authenticated before this call.
 */
export function releaseCommittedBatch(batch: CommittedBatch, ledger: OneReleaseLedger): ReleaseResult {
  const cohortSize = batch.cohort.length
  const cohortIds = batch.cohort.map((member) => member.participantId)
  let binding: DistributedContextBinding
  try {
    assertCommittedCohortSize(cohortSize)
    binding = createDistributedContextBinding(batch.batchId, cohortIds)
  } catch {
    return abort(batch.batchId, 'invalid-committed-cohort')
  }
  if (!hasUniqueNonemptyIds(cohortIds)) {
    return abort(batch.batchId, 'invalid-committed-cohort')
  }
  if (!ledger.claim(batch.batchId)) return abort(batch.batchId, 'already-attempted')

  if (batch.aggregatorTrust === 'colluding') return abort(batch.batchId, 'aggregator-collusion')
  const honestParticipants = batch.cohort.filter((member) => member.integrity === 'honest').length
  if (honestParticipants < ADVERTISED_MINIMUM_HONEST_PARTICIPANTS) {
    return abort(batch.batchId, 'insufficient-honest-participants')
  }

  const submissionIds = batch.submissions.map((submission) => submission.participantId)
  const cohortIdSet = new Set(cohortIds)
  if (!hasUniqueNonemptyIds(submissionIds) || submissionIds.some((id) => !cohortIdSet.has(id))) {
    return abort(batch.batchId, 'submission-set-mismatch')
  }

  const byParticipant = new Map(batch.submissions.map((submission) => [submission.participantId, submission]))
  const ordered = cohortIds.map((id) => byParticipant.get(id))
  if (ordered.some((submission) => submission === undefined)) return abort(batch.batchId, 'missing-submission')
  if (ordered.some((submission) => submission!.delivery !== 'both-aggregators')) {
    return abort(batch.batchId, 'partial-delivery')
  }
  if (ordered.some((submission) => submission!.report === undefined)) {
    return abort(batch.batchId, 'missing-submission')
  }

  const protocol = createDistributedProtocol()
  const context = distributedContext(binding)
  const verifyKey = demonstrationVerifyKey()
  const nonceRegistry = new NonceRegistry()
  const outputShares: [bigint[], bigint[]][] = []

  for (const submission of ordered) {
    const report = submission!.report!
    try {
      if (!nonceRegistry.admit(report)) return abort(batch.batchId, 'duplicate-nonce')
      const trace = protocol.prepare(verifyKey, context, report)
      if (!trace.accepted || trace.outputShares === undefined) {
        return abort(batch.batchId, 'preparation-rejected')
      }
      outputShares.push(trace.outputShares)
    } catch {
      return abort(batch.batchId, 'preparation-rejected')
    }
  }

  // Never filter to an accepted subset: exactly the committed cohort reached here.
  if (outputShares.length !== cohortSize) return abort(batch.batchId, 'missing-submission')
  const leaderAggregate = aggregateOutputShares(outputShares.map(([leader]) => leader))
  const helperAggregate = aggregateOutputShares(outputShares.map(([, helper]) => helper))
  const rawShiftedAggregate = unshard([leaderAggregate, helperAggregate], cohortSize)

  let noisyQuantizedUnits: bigint
  try {
    noisyQuantizedUnits = decodeShiftedAggregate(rawShiftedAggregate, cohortSize)
  } catch {
    return abort(batch.batchId, 'aggregate-bound-violation')
  }

  const collector: CollectorRelease = {
    batchId: batch.batchId,
    participantCount: cohortSize,
    noisyQuantizedUnits,
    noisyDollars: noisyQuantizedUnits * QUANTIZATION_STEP_DOLLARS,
    privacy: {
      adjacency: 'fixed-size replace-one',
      epsilonNumerator: EPSILON_NUMERATOR,
      epsilonDenominator: EPSILON_DENOMINATOR,
      sensitivityUnits: REPLACE_ONE_SENSITIVITY_UNITS,
      advertisedMinimumHonestParticipants: ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
      // The collector learns the advertised threshold accounting, not the
      // omniscient teaching scenario's actual honest-participant count.
      accounting: privacyAccounting(ADVERTISED_MINIMUM_HONEST_PARTICIPANTS, cohortSize),
    },
  }
  return { status: 'released', collector }
}

/**
 * Construct the explicitly omniscient learner trace outside the collector API.
 * The checks prevent a row-arithmetic or aggregate-decomposition mismatch from
 * explaining a release. Sender/roster authentication remains an external input.
 */
export function createOmniscientTeachingTrace(
  collector: CollectorRelease,
  contributions: readonly TeachingContributionTrace[],
): OmniscientTeachingTrace {
  if (contributions.length !== collector.participantCount) {
    throw new RangeError('teaching trace does not match collector participant count')
  }
  const ids = contributions.map((contribution) => contribution.participantId)
  if (!hasUniqueNonemptyIds(ids)) throw new RangeError('teaching trace participant ids must be unique')
  if (contributions.some((contribution) => (
    contribution.shiftedContributionUnits
      !== contribution.quantizedUnits + contribution.noiseUnits + CONTRIBUTION_SHIFT_UNITS
  ))) {
    throw new Error('teaching trace has an inconsistent shifted contribution')
  }

  const exactQuantizedUnits = contributions.reduce((sum, contribution) => sum + contribution.quantizedUnits, 0n)
  const totalNoiseUnits = contributions.reduce((sum, contribution) => sum + contribution.noiseUnits, 0n)
  const rawShiftedAggregateUnits = contributions.reduce(
    (sum, contribution) => sum + contribution.shiftedContributionUnits,
    0n,
  )
  if (exactQuantizedUnits + totalNoiseUnits !== collector.noisyQuantizedUnits) {
    throw new Error('teaching decomposition does not reproduce the collector release')
  }
  if (rawShiftedAggregateUnits !== (
    collector.noisyQuantizedUnits + BigInt(collector.participantCount) * CONTRIBUTION_SHIFT_UNITS
  )) {
    throw new Error('teaching shifted aggregate does not reproduce the collector release')
  }

  return {
    batchId: collector.batchId,
    exactQuantizedUnits,
    totalNoiseUnits,
    rawShiftedAggregateUnits,
    noisyQuantizedUnits: collector.noisyQuantizedUnits,
    contributions: [...contributions],
  }
}
