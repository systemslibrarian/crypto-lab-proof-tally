import { aggregateOutputShares, unshard } from '../prio3/aggregate'
import { createPrio3Sum } from '../prio3/instances'
import { NonceRegistry } from '../prio3/replay'
import {
  MAX_COMMITTED_COHORT_SIZE,
  MAX_QUANTIZED_UNITS,
  clampAndQuantizeSalary,
} from './parameters'
import { demonstrationVerifyKey, type ParticipantSalary, type ShardingMaterial } from './report'

const FULL_QUERY_CONTEXT = new TextEncoder().encode('proof-tally/s04/exact-disclosure/full/v1')
const REPLACEMENT_QUERY_CONTEXT = new TextEncoder().encode('proof-tally/s04/exact-disclosure/replacement/v1')

export interface ExactQueryMaterials {
  full: readonly ShardingMaterial[]
  replacement: readonly ShardingMaterial[]
}

/** Explicitly insecure teaching trace from two exact, overlapping releases. */
export interface ExactReplacementDisclosure {
  cohortSize: typeof MAX_COMMITTED_COHORT_SIZE
  targetParticipantId: string
  fullAggregateUnits: bigint
  replacementAggregateUnits: bigint
  revealedTargetUnits: bigint
  targetQuantizedUnits: bigint
  targetWasReplacedWithUnits: 0n
}

function aggregateExactQuery(
  values: readonly bigint[],
  context: Uint8Array,
  materials?: readonly ShardingMaterial[],
): bigint {
  if (materials !== undefined && materials.length !== values.length) {
    throw new RangeError('exact-query sharding material must match the fixed cohort')
  }
  const protocol = createPrio3Sum(MAX_QUANTIZED_UNITS)
  const verifyKey = demonstrationVerifyKey()
  const registry = new NonceRegistry()
  const outputs = values.map((value, index) => {
    const material = materials?.[index]
    const report = material === undefined
      ? protocol.shard(context, value)
      : protocol.shard(context, value, material.nonce, material.randomness)
    if (!registry.admit(report)) throw new Error('exact query reused a report nonce')
    const trace = protocol.prepare(verifyKey, context, report)
    if (!trace.accepted || trace.outputShares === undefined) {
      throw new Error('exact Prio3 query rejected a committed report')
    }
    return trace.outputShares
  })
  const leader = aggregateOutputShares(outputs.map(([share]) => share))
  const helper = aggregateOutputShares(outputs.map(([, share]) => share))
  return unshard([leader, helper], values.length)
}

/**
 * Run two real, twelve-slot Prio3Sum queries. The second query replaces the
 * target with zero; it never removes a row. Differencing the exact releases
 * therefore reveals the target's bounded, quantized value while preserving
 * the fixed-size replace-one comparison used by the lesson.
 */
export function runExactReplacementDisclosure(
  participants: readonly ParticipantSalary[],
  targetParticipantId: string,
  materials?: ExactQueryMaterials,
): ExactReplacementDisclosure {
  if (participants.length !== MAX_COMMITTED_COHORT_SIZE) {
    throw new RangeError(`exact disclosure fixture requires ${MAX_COMMITTED_COHORT_SIZE} committed slots`)
  }
  const ids = participants.map((participant) => participant.participantId)
  if (ids.some((id) => id.trim() === '') || new Set(ids).size !== ids.length) {
    throw new RangeError('exact disclosure participant ids must be nonempty and unique')
  }
  const targetIndex = ids.indexOf(targetParticipantId)
  if (targetIndex === -1) throw new RangeError('exact disclosure target is not in the committed cohort')

  const quantized = participants.map((participant) => clampAndQuantizeSalary(participant.salaryDollars).units)
  const replacement = quantized.map((value, index) => index === targetIndex ? 0n : value)
  const fullAggregateUnits = aggregateExactQuery(quantized, FULL_QUERY_CONTEXT, materials?.full)
  const replacementAggregateUnits = aggregateExactQuery(
    replacement,
    REPLACEMENT_QUERY_CONTEXT,
    materials?.replacement,
  )
  const revealedTargetUnits = fullAggregateUnits - replacementAggregateUnits

  return {
    cohortSize: MAX_COMMITTED_COHORT_SIZE,
    targetParticipantId,
    fullAggregateUnits,
    replacementAggregateUnits,
    revealedTargetUnits,
    targetQuantizedUnits: quantized[targetIndex],
    targetWasReplacedWithUnits: 0n,
  }
}
