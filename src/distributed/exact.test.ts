import { describe, expect, it } from 'vitest'
import {
  runExactReplacementDisclosure,
  type ExactQueryMaterials,
} from './exact'
import type { ParticipantSalary, ShardingMaterial } from './report'

const PAYROLL: readonly ParticipantSalary[] = [
  { participantId: 'Avery', salaryDollars: 84_200n },
  { participantId: 'Blair', salaryDollars: 91_750n },
  { participantId: 'Cameron', salaryDollars: 76_300n },
  { participantId: 'Devon', salaryDollars: 108_400n },
  { participantId: 'Ellis', salaryDollars: 88_750n },
  { participantId: 'Frankie', salaryDollars: 95_600n },
  { participantId: 'Gray', salaryDollars: 112_300n },
  { participantId: 'Harper', salaryDollars: 79_900n },
  { participantId: 'Indigo', salaryDollars: 101_250n },
  { participantId: 'Jordan', salaryDollars: 93_400n },
  { participantId: 'Kai', salaryDollars: 86_500n },
  { participantId: 'Lane', salaryDollars: 119_800n },
]

function material(id: number): ShardingMaterial {
  const nonce = new Uint8Array(16)
  nonce[14] = id >>> 8
  nonce[15] = id
  return {
    nonce,
    randomness: Uint8Array.from({ length: 64 }, (_, index) => (id * 43 + index * 31) & 0xff),
  }
}

function materials(): ExactQueryMaterials {
  return {
    full: Array.from({ length: 12 }, (_, index) => material(index + 1)),
    replacement: Array.from({ length: 12 }, (_, index) => material(index + 101)),
  }
}

describe('exact overlapping-query disclosure', () => {
  it('uses two real twelve-slot Prio3 queries and reveals the zero-replaced target', () => {
    const result = runExactReplacementDisclosure(PAYROLL, 'Lane', materials())
    expect(result).toEqual({
      cohortSize: 12,
      targetParticipantId: 'Lane',
      fullAggregateUnits: 221n,
      replacementAggregateUnits: 198n,
      revealedTargetUnits: 23n,
      targetQuantizedUnits: 23n,
      targetWasReplacedWithUnits: 0n,
    })
    expect(result.fullAggregateUnits - result.replacementAggregateUnits).toBe(result.targetQuantizedUnits)
  })

  it('rejects a removed slot rather than silently changing to add/remove adjacency', () => {
    expect(() => runExactReplacementDisclosure(PAYROLL.slice(0, -1), 'Kai', materials())).toThrow(
      'requires 12 committed slots',
    )
  })

  it('rejects missing and duplicate identities', () => {
    expect(() => runExactReplacementDisclosure(PAYROLL, 'Missing', materials())).toThrow('not in the committed cohort')
    const duplicate = PAYROLL.map((participant, index) => index === 1 ? { ...participant, participantId: 'Avery' } : participant)
    expect(() => runExactReplacementDisclosure(duplicate, 'Lane', materials())).toThrow('nonempty and unique')
  })

  it('rejects reused nonces inside either exact query', () => {
    const baseline = materials()
    const full = [...baseline.full]
    full[1] = full[0]
    const reused: ExactQueryMaterials = { ...baseline, full }
    expect(() => runExactReplacementDisclosure(PAYROLL, 'Lane', reused)).toThrow('reused a report nonce')
  })

  it('requires deterministic material for every fixed slot when fixtures supply it', () => {
    const incomplete = materials()
    incomplete.replacement = incomplete.replacement.slice(0, -1)
    expect(() => runExactReplacementDisclosure(PAYROLL, 'Lane', incomplete)).toThrow('must match the fixed cohort')
  })
})
