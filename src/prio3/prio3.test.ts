import { describe, expect, it } from 'vitest'
import { addVectors, encodeField64Vector } from '../field/field64'
import { aggregateOutputShares, unshard } from './aggregate'
import { tamperProofShare } from './core'
import { createPrio3Count, createPrio3Sum } from './instances'

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const context = hex('736f6d65206170706c69636174696f6e')
const nonce = hex('000102030405060708090a0b0c0d0e0f')
const verifyKey = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const randomness = hex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' +
  '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f',
)

describe('draft-irtf-cfrg-vdaf-22 Prio3', () => {
  it('matches the Prio3Count_0 input-share KAT', () => {
    const protocol = createPrio3Count()
    const report = protocol.shard(context, 1n, nonce, randomness)
    expect(toHex(protocol.encodeInputShare(report.inputShares[0]))).toBe(
      '355e16daa732744c34dc71fa4c85d209f9af2ecf751609386ed9e2714ecc9e6bb2277498ac41e75c01d81b4cb8485926',
    )
    expect(toHex(protocol.encodeInputShare(report.inputShares[1]))).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    )
  })

  it('matches the Prio3Count_0 verifier and output KAT', () => {
    const protocol = createPrio3Count()
    const report = protocol.shard(context, 1n, nonce, randomness)
    const [leaderState, leaderVerifier] = protocol.verifyInit(verifyKey, context, 0, nonce, report.inputShares[0])
    const [helperState, helperVerifier] = protocol.verifyInit(verifyKey, context, 1, nonce, report.inputShares[1])
    expect(toHex(protocol.encodeVerifierShare(leaderVerifier))).toBe(
      'cd7905720f16e5d9ef7657a336307ae8f3fe96d36cc09019257268349e7a7d72',
    )
    expect(toHex(protocol.encodeVerifierShare(helperVerifier))).toBe(
      '3486fa8defe91a26a2eb81c1638c36bcf227593ab1b0e78b0d2775a9788ca884',
    )
    expect(toHex(protocol.encodeOutputShare(leaderState.outputShare))).toBe('355e16daa732744c')
    expect(toHex(protocol.encodeOutputShare(helperState.outputShare))).toBe('cda1e92557cd8bb3')
    expect(protocol.prepare(verifyKey, context, report).accepted).toBe(true)
  })

  it('matches the Prio3Sum_0 verifier, output, and aggregate KAT', () => {
    const protocol = createPrio3Sum(255n)
    const report = protocol.shard(context, 100n, nonce, randomness)
    const [leaderState, leaderVerifier] = protocol.verifyInit(verifyKey, context, 0, nonce, report.inputShares[0])
    const [helperState, helperVerifier] = protocol.verifyInit(verifyKey, context, 1, nonce, report.inputShares[1])
    expect(toHex(protocol.encodeVerifierShare(leaderVerifier))).toBe(
      '8ae6c9427194bcbd4f7ec37b2d71efde7103dba5d9ce9b82',
    )
    expect(toHex(protocol.encodeVerifierShare(helperVerifier))).toBe(
      '771936bd8d6b4342fcd39293142d00ba0dbe587ac2359285',
    )
    expect(toHex(protocol.encodeOutputShare(leaderState.outputShare))).toBe('e3ad3d4d7d6f5765')
    expect(toHex(protocol.encodeOutputShare(helperState.outputShare))).toBe('8252c2b28190a89a')
    expect(toHex(encodeField64Vector(addVectors(leaderState.outputShare, [0n])))).toBe('e3ad3d4d7d6f5765')
    expect(unshard([leaderState.outputShare, helperState.outputShare], 1)).toBe(100n)
  })

  it('rejects an out-of-range encoded Sum at preparation', () => {
    const protocol = createPrio3Sum(16_777_215n)
    const maliciousEncoding = [4_000_000_000n, ...Array<bigint>(23).fill(0n)]
    const trace = protocol.prepare(verifyKey, context, protocol.shardEncoded(context, maliciousEncoding, nonce, randomness))
    expect(trace.accepted).toBe(false)
    expect(trace.cause).toBe('combined verifier nonzero')
  })

  it('rejects a flipped field element in the leader proof share', () => {
    const protocol = createPrio3Count()
    const report = protocol.shard(context, 1n, nonce, randomness)
    const trace = protocol.prepare(verifyKey, context, tamperProofShare(report))
    expect(trace.accepted).toBe(false)
  })

  it('aggregates only accepted output shares and refuses an empty aggregate', () => {
    const protocol = createPrio3Count()
    const reports = [0n, 1n, 1n].map((measurement, index) => {
      const reportNonce = new Uint8Array(nonce)
      reportNonce[15] = index
      return protocol.prepare(verifyKey, context, protocol.shard(context, measurement, reportNonce, randomness))
    })
    const accepted = reports.filter((report) => report.accepted && report.outputShares)
    const leader = aggregateOutputShares(accepted.map((report) => report.outputShares![0]))
    const helper = aggregateOutputShares(accepted.map((report) => report.outputShares![1]))
    expect(unshard([leader, helper], accepted.length)).toBe(2n)
    expect(() => aggregateOutputShares([])).toThrow('zero reports')
  })
})