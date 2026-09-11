import {
  addVectors,
  decodeField64Vector,
  encodeField64Vector,
  subVectors,
  type Field64,
} from '../field/field64'
import type { ValidityCircuit } from '../flp/circuit'
import { decide } from '../flp/decide'
import { prove } from '../flp/prove'
import {
  proofLength,
  proverRandomnessLength,
  query,
  queryRandomnessLength,
} from '../flp/query'
import { XOF_SEED_SIZE, XofTurboShake128 } from '../xof/turboshake'
import type {
  HelperInputShare,
  InputShare,
  LeaderInputShare,
  PreparationTrace,
  Report,
  VerifierShare,
  VerifyState,
} from './types'

const DRAFT_FORMAT_VERSION = 18
const NUMBER_OF_SHARES = 2
const NUMBER_OF_PROOFS = 1
const USAGE_MEASUREMENT_SHARE = 1
const USAGE_PROOF_SHARE = 2
const USAGE_PROVER_RANDOMNESS = 4
const USAGE_QUERY_RANDOMNESS = 5

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function bigEndian(value: number, length: number): Uint8Array {
  const output = new Uint8Array(length)
  let remaining = value
  for (let index = length - 1; index >= 0; index -= 1) {
    output[index] = remaining & 0xff
    remaining >>>= 8
  }
  return output
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export interface Prio3Options {
  id: number
  name: 'Prio3Count' | 'Prio3Sum'
  circuit: ValidityCircuit
}

export class Prio3 {
  readonly randomSize = NUMBER_OF_SHARES * XOF_SEED_SIZE

  constructor(readonly options: Prio3Options) {}

  private domainSeparationTag(usage: number, context: Uint8Array): Uint8Array {
    return concat(
      new Uint8Array([DRAFT_FORMAT_VERSION, 0]),
      bigEndian(this.options.id, 4),
      bigEndian(usage, 2),
      context,
    )
  }

  private expand(
    seed: Uint8Array,
    usage: number,
    context: Uint8Array,
    binder: Uint8Array,
    length: number,
  ): Field64[] {
    return new XofTurboShake128(seed, this.domainSeparationTag(usage, context), binder).nextField64Vector(length)
  }

  shard(
    context: Uint8Array,
    measurement: bigint,
    nonce = randomBytes(16),
    randomness = randomBytes(this.randomSize),
  ): Report {
    return this.shardEncoded(context, this.options.circuit.encode(measurement), nonce, randomness)
  }

  shardEncoded(
    context: Uint8Array,
    encodedMeasurement: readonly Field64[],
    nonce = randomBytes(16),
    randomness = randomBytes(this.randomSize),
  ): Report {
    if (nonce.length !== 16) throw new RangeError('nonce must be exactly 16 bytes')
    if (randomness.length !== this.randomSize) throw new RangeError('incorrect sharding randomness length')
    if (encodedMeasurement.length !== this.options.circuit.measurementLength) {
      throw new RangeError('incorrect encoded measurement length')
    }
    const helperSeed = randomness.slice(0, XOF_SEED_SIZE)
    const proverSeed = randomness.slice(XOF_SEED_SIZE)
    const helperMeasurement = this.expand(
      helperSeed,
      USAGE_MEASUREMENT_SHARE,
      context,
      new Uint8Array([1]),
      this.options.circuit.measurementLength,
    )
    const leaderMeasurement = subVectors(encodedMeasurement, helperMeasurement)
    const proverRandomness = this.expand(
      proverSeed,
      USAGE_PROVER_RANDOMNESS,
      context,
      new Uint8Array([NUMBER_OF_PROOFS]),
      proverRandomnessLength(this.options.circuit),
    )
    const fullProof = prove(this.options.circuit, encodedMeasurement, proverRandomness)
    const helperProof = this.expand(
      helperSeed,
      USAGE_PROOF_SHARE,
      context,
      new Uint8Array([NUMBER_OF_PROOFS, 1]),
      proofLength(this.options.circuit),
    )
    const leaderProof = subVectors(fullProof, helperProof)
    return {
      nonce,
      inputShares: [
        { role: 'leader', measurement: leaderMeasurement, proof: leaderProof },
        { role: 'helper', seed: helperSeed },
      ],
    }
  }

  private expandInputShare(context: Uint8Array, aggregatorId: number, inputShare: InputShare): [Field64[], Field64[]] {
    if (aggregatorId === 0) {
      if (inputShare.role !== 'leader') throw new Error('leader received a helper share')
      return [inputShare.measurement, inputShare.proof]
    }
    if (inputShare.role !== 'helper') throw new Error('helper received a leader share')
    return [
      this.expand(
        inputShare.seed,
        USAGE_MEASUREMENT_SHARE,
        context,
        new Uint8Array([aggregatorId]),
        this.options.circuit.measurementLength,
      ),
      this.expand(
        inputShare.seed,
        USAGE_PROOF_SHARE,
        context,
        new Uint8Array([NUMBER_OF_PROOFS, aggregatorId]),
        proofLength(this.options.circuit),
      ),
    ]
  }

  verifyInit(
    verifyKey: Uint8Array,
    context: Uint8Array,
    aggregatorId: 0 | 1,
    nonce: Uint8Array,
    inputShare: InputShare,
  ): [VerifyState, VerifierShare] {
    if (verifyKey.length !== XOF_SEED_SIZE) throw new RangeError('verify key must be exactly 32 bytes')
    const [measurementShare, proofShare] = this.expandInputShare(context, aggregatorId, inputShare)
    const outputShare = this.options.circuit.truncate(measurementShare)
    const queryRandomness = this.expand(
      verifyKey,
      USAGE_QUERY_RANDOMNESS,
      context,
      concat(new Uint8Array([NUMBER_OF_PROOFS]), nonce),
      queryRandomnessLength(this.options.circuit),
    )
    return [
      { outputShare },
      { values: query(this.options.circuit, measurementShare, proofShare, queryRandomness, NUMBER_OF_SHARES) },
    ]
  }

  prepare(verifyKey: Uint8Array, context: Uint8Array, report: Report): PreparationTrace {
    const [leaderState, leaderVerifier] = this.verifyInit(verifyKey, context, 0, report.nonce, report.inputShares[0])
    const [helperState, helperVerifier] = this.verifyInit(verifyKey, context, 1, report.nonce, report.inputShares[1])
    const combinedVerifier = addVectors(leaderVerifier.values, helperVerifier.values)
    const decision = decide(this.options.circuit, combinedVerifier)
    const base = {
      verifierShares: [leaderVerifier, helperVerifier] as [VerifierShare, VerifierShare],
      combinedVerifier,
    }
    if (!decision.gadgetConsistent) {
      return { ...base, accepted: false, cause: 'gadget consistency failed' }
    }
    if (!decision.valid) {
      return { ...base, accepted: false, cause: 'combined verifier nonzero' }
    }
    return {
      ...base,
      accepted: true,
      cause: 'combined verifier is zero',
      outputShares: [leaderState.outputShare, helperState.outputShare],
    }
  }

  encodeInputShare(inputShare: InputShare): Uint8Array {
    return inputShare.role === 'leader'
      ? concat(encodeField64Vector(inputShare.measurement), encodeField64Vector(inputShare.proof))
      : inputShare.seed
  }

  decodeInputShare(aggregatorId: 0 | 1, encoded: Uint8Array): InputShare {
    if (aggregatorId === 1) {
      if (encoded.length !== XOF_SEED_SIZE) throw new RangeError('incorrect helper input-share length')
      return { role: 'helper', seed: encoded }
    }
    const measurementBytes = this.options.circuit.measurementLength * 8
    const proofBytes = proofLength(this.options.circuit) * 8
    if (encoded.length !== measurementBytes + proofBytes) throw new RangeError('incorrect leader input-share length')
    return {
      role: 'leader',
      measurement: decodeField64Vector(encoded.slice(0, measurementBytes)),
      proof: decodeField64Vector(encoded.slice(measurementBytes)),
    }
  }

  encodeVerifierShare(share: VerifierShare): Uint8Array {
    return encodeField64Vector(share.values)
  }

  encodeOutputShare(share: readonly Field64[]): Uint8Array {
    return encodeField64Vector(share)
  }

  measurementShares(context: Uint8Array, report: Report): [Field64[], Field64[]] {
    const leader = [...report.inputShares[0].measurement]
    const helper = this.expandInputShare(context, 1, report.inputShares[1])[0]
    return [leader, helper]
  }
}

export function tamperProofShare(report: Report): Report {
  const proof = [...report.inputShares[0].proof]
  proof[0] = (proof[0] + 1n) % 18_446_744_069_414_584_321n
  return {
    nonce: report.nonce,
    inputShares: [{ ...report.inputShares[0], proof }, report.inputShares[1]],
  }
}

export function revealMeasurementShares(protocol: Prio3, context: Uint8Array, report: Report): [Field64[], Field64[]] {
  return protocol.measurementShares(context, report)
}

export type { LeaderInputShare, HelperInputShare }