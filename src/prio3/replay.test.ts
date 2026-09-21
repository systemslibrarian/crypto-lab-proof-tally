import { describe, expect, it } from 'vitest'
import { aggregateOutputShares, unshard } from './aggregate'
import { createPrio3Sum } from './instances'
import { NonceRegistry } from './replay'

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
}

const context = hex('736f6d65206170706c69636174696f6e')
const nonce = hex('000102030405060708090a0b0c0d0e0f')
const verifyKey = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const randomness = hex(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f' +
  '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f',
)

describe('replay is refused outside the VDAF, not by it', () => {
  it('prepares a replayed report a second time and accepts it', () => {
    const protocol = createPrio3Sum(16_777_215n)
    const report = protocol.shard(context, 125_000n, nonce, randomness)
    expect(protocol.prepare(verifyKey, context, report).accepted).toBe(true)
    expect(protocol.prepare(verifyKey, context, report).accepted).toBe(true)
  })

  it('doubles the aggregate when the replay is not refused', () => {
    const protocol = createPrio3Sum(16_777_215n)
    const report = protocol.shard(context, 125_000n, nonce, randomness)
    const first = protocol.prepare(verifyKey, context, report)
    const replay = protocol.prepare(verifyKey, context, report)
    const single = unshard([first.outputShares![0], first.outputShares![1]], 1)
    const doubled = unshard(
      [
        aggregateOutputShares([first.outputShares![0], replay.outputShares![0]]),
        aggregateOutputShares([first.outputShares![1], replay.outputShares![1]]),
      ],
      2,
    )
    expect(single).toBe(125_000n)
    expect(doubled).toBe(250_000n)
  })

  it('admits a nonce once and refuses the identical report afterwards', () => {
    const protocol = createPrio3Sum(16_777_215n)
    const registry = new NonceRegistry()
    const report = protocol.shard(context, 125_000n, nonce, randomness)
    expect(registry.admit(report)).toBe(true)
    expect(registry.has(report)).toBe(true)
    expect(registry.admit(report)).toBe(false)
    expect(registry.size).toBe(1)
  })

  it('admits a distinct nonce carrying the same measurement', () => {
    const protocol = createPrio3Sum(16_777_215n)
    const registry = new NonceRegistry()
    const other = new Uint8Array(nonce)
    other[15] ^= 1
    expect(registry.admit(protocol.shard(context, 125_000n, nonce, randomness))).toBe(true)
    expect(registry.admit(protocol.shard(context, 125_000n, other, randomness))).toBe(true)
    expect(registry.size).toBe(2)
  })

  it('refuses a nonce that is not sixteen bytes and forgets nothing until cleared', () => {
    const protocol = createPrio3Sum(16_777_215n)
    const registry = new NonceRegistry()
    const report = protocol.shard(context, 125_000n, nonce, randomness)
    registry.admit(report)
    expect(() => registry.admit({ ...report, nonce: nonce.slice(0, 15) })).toThrow('exactly 16 bytes')
    expect(registry.has(report)).toBe(true)
    registry.clear()
    expect(registry.has(report)).toBe(false)
    expect(registry.size).toBe(0)
  })
})
