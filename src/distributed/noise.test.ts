import { describe, expect, it } from 'vitest'
import { ABSOLUTE_NOISE_CAP_UNITS } from './parameters'
import {
  sampleActivatedNoise,
  sampleBernoulliExp,
  sampleBoundedDiscreteLaplace,
  sampleRationalBernoulli,
  uniformBelow,
  type RandomSource,
} from './noise'

class ByteQueue implements RandomSource {
  private offset = 0

  constructor(private readonly bytes: readonly number[]) {}

  fill(target: Uint8Array): void {
    if (this.offset + target.length > this.bytes.length) throw new Error('deterministic entropy exhausted')
    for (let index = 0; index < target.length; index += 1) {
      const value = this.bytes[this.offset]
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('invalid test byte')
      target[index] = value
      this.offset += 1
    }
  }

  get consumed(): number {
    return this.offset
  }
}

/**
 * Entropy that makes Algorithm 2 choose U=u and V=v for t=50, then the
 * requested sign. For 0<u<50, [0,0,u] makes BernoulliExp(u/50) stop at odd
 * K=3. Each [0,1] makes BernoulliExp(1) return true; [1] terminates V.
 */
function laplaceFixture(u: number, v: number, negative = false): number[] {
  if (u <= 0 || u >= 50) throw new RangeError('this fixture expects 0 < u < 50')
  return [u, 0, 0, u, ...Array.from({ length: v }, () => [0, 1]).flat(), 1, negative ? 0 : 1]
}

describe('exact integer randomness', () => {
  it('samples a uniform integer with masked rejection rather than modulo reduction', () => {
    const random = new ByteQueue([255, 9])
    expect(uniformBelow(10n, random)).toBe(9n)
    expect(random.consumed).toBe(2)
  })

  it('handles rational Bernoulli endpoints without consuming entropy', () => {
    const random = new ByteQueue([])
    expect(sampleRationalBernoulli(0n, 10n, random)).toBe(false)
    expect(sampleRationalBernoulli(10n, 10n, random)).toBe(true)
    expect(random.consumed).toBe(0)
  })

  it('rejects invalid exact probabilities and uniform bounds', () => {
    const random = new ByteQueue([])
    expect(() => uniformBelow(0n, random)).toThrow('positive')
    expect(() => sampleRationalBernoulli(-1n, 10n, random)).toThrow('[0, 1]')
    expect(() => sampleRationalBernoulli(11n, 10n, random)).toThrow('[0, 1]')
    expect(() => sampleBernoulliExp(1n, 0n, random)).toThrow('gamma')
  })
})

describe('CKS Algorithm 1', () => {
  it('returns one exactly for gamma zero without asking for randomness', () => {
    const random = new ByteQueue([])
    expect(sampleBernoulliExp(0n, 1n, random)).toBe(true)
    expect(random.consumed).toBe(0)
  })

  it('follows the odd/even stopping rule for gamma 1/50', () => {
    expect(sampleBernoulliExp(1n, 50n, new ByteQueue([1]))).toBe(true) // stop at K=1
    expect(sampleBernoulliExp(1n, 50n, new ByteQueue([0, 1]))).toBe(false) // stop at K=2
    expect(sampleBernoulliExp(1n, 50n, new ByteQueue([0, 0, 1]))).toBe(true) // stop at K=3
  })

  it('decomposes gamma above one into exact recursive factors', () => {
    // First Bernoulli(exp(-1)) stops at even K=2, so the gamma=3/2 product is false.
    expect(sampleBernoulliExp(3n, 2n, new ByteQueue([1]))).toBe(false)
    // The whole-unit factor and the 1/2 remainder both succeed.
    expect(sampleBernoulliExp(3n, 2n, new ByteQueue([0, 1, 1]))).toBe(true)
  })
})

describe('CKS Algorithm 2 with an absolute application cap', () => {
  it('samples zero without floating-point arithmetic', () => {
    // U=0; D=1 exactly; V stops at zero; choose the non-negative zero representation.
    expect(sampleBoundedDiscreteLaplace(new ByteQueue([0, 1, 1]))).toEqual({ status: 'sampled', value: 0n })
  })

  it('restarts after the Algorithm 2 Bernoulli-exp rejection', () => {
    // First U=49 has D=0 (K stops even); the restarted iteration returns +1.
    const bytes = [49, 0, 49, 1, 1, 1, 1]
    const random = new ByteQueue(bytes)
    expect(sampleBoundedDiscreteLaplace(random)).toEqual({ status: 'sampled', value: 1n })
    expect(random.consumed).toBe(bytes.length)
  })

  it('rejects the negative representation of zero and restarts', () => {
    // The first iteration produces -0; the required restart then returns +1.
    const bytes = [0, 1, 0, 1, 1, 1, 1]
    const random = new ByteQueue(bytes)
    expect(sampleBoundedDiscreteLaplace(random)).toEqual({ status: 'sampled', value: 1n })
    expect(random.consumed).toBe(bytes.length)
  })

  it('accepts both +B and -B at the boundary', () => {
    const positive = new ByteQueue(laplaceFixture(46, 81, false)) // 46 + 50*81 = 4096
    const negative = new ByteQueue(laplaceFixture(46, 81, true))
    expect(sampleBoundedDiscreteLaplace(positive)).toEqual({ status: 'sampled', value: ABSOLUTE_NOISE_CAP_UNITS })
    expect(sampleBoundedDiscreteLaplace(negative)).toEqual({ status: 'sampled', value: -ABSOLUTE_NOISE_CAP_UNITS })
  })

  it('aborts at B+1 instead of retrying the cap failure', () => {
    const bytes = laplaceFixture(47, 81, false) // 47 + 50*81 = 4097
    const random = new ByteQueue(bytes)
    expect(sampleBoundedDiscreteLaplace(random)).toEqual({ status: 'aborted', reason: 'noise-cap-exceeded' })
    expect(random.consumed).toBe(bytes.length)
  })

  it('uses an exact 9/10 activation and skips the Laplace sampler when inactive', () => {
    const inactive = new ByteQueue([9])
    expect(sampleActivatedNoise(inactive)).toEqual({ status: 'sampled', active: false, value: 0n })
    expect(inactive.consumed).toBe(1)

    const active = new ByteQueue([0, 0, 1, 1])
    expect(sampleActivatedNoise(active)).toEqual({ status: 'sampled', active: true, value: 0n })
    expect(active.consumed).toBe(4)
  })

  it('propagates an active client cap abort without drawing another Laplace value', () => {
    const laplace = laplaceFixture(47, 81, false)
    const bytes = [0, ...laplace]
    const random = new ByteQueue(bytes)
    expect(sampleActivatedNoise(random)).toEqual({ status: 'aborted', reason: 'noise-cap-exceeded' })
    expect(random.consumed).toBe(bytes.length)
  })
})
