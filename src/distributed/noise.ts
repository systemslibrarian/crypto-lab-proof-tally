import {
  ABSOLUTE_NOISE_CAP_UNITS,
  ACTIVATION_DENOMINATOR,
  ACTIVATION_NUMERATOR,
  LAPLACE_SCALE_DENOMINATOR,
  LAPLACE_SCALE_NUMERATOR,
} from './parameters'

/** Minimal injectable entropy boundary: production uses Web Crypto; tests supply bytes. */
export interface RandomSource {
  fill(target: Uint8Array<ArrayBuffer>): void
}

export const webCryptoRandomSource: RandomSource = {
  fill(target: Uint8Array<ArrayBuffer>): void {
    const provider = globalThis.crypto
    if (provider === undefined) throw new Error('Web Crypto random source is unavailable')
    provider.getRandomValues(target)
  },
}

/** Uniform integer in [0, upperExclusive), using masked rejection without modulo bias. */
export function uniformBelow(upperExclusive: bigint, random: RandomSource): bigint {
  if (upperExclusive <= 0n) throw new RangeError('uniform upper bound must be positive')
  if (upperExclusive === 1n) return 0n

  const highestCandidate = upperExclusive - 1n
  const bitLength = highestCandidate.toString(2).length
  const byteLength = Math.ceil(bitLength / 8)
  const unusedHighBits = byteLength * 8 - bitLength
  const highByteMask = 0xff >>> unusedHighBits

  for (;;) {
    const bytes = new Uint8Array(byteLength)
    random.fill(bytes)
    bytes[0] &= highByteMask
    let candidate = 0n
    for (const byte of bytes) candidate = (candidate << 8n) | BigInt(byte)
    if (candidate < upperExclusive) return candidate
  }
}

/** Exact Bernoulli(numerator / denominator), assuming only uniform random bytes. */
export function sampleRationalBernoulli(
  numerator: bigint,
  denominator: bigint,
  random: RandomSource,
): boolean {
  if (denominator <= 0n || numerator < 0n || numerator > denominator) {
    throw new RangeError('Bernoulli probability must be a rational in [0, 1]')
  }
  if (numerator === 0n) return false
  if (numerator === denominator) return true
  return uniformBelow(denominator, random) < numerator
}

/**
 * Canonne--Kamath--Steinke Algorithm 1: exact Bernoulli(exp(-gamma))
 * for a non-negative rational gamma. It evaluates no floating-point exponential.
 * https://arxiv.org/abs/2004.00010
 */
export function sampleBernoulliExp(
  gammaNumerator: bigint,
  gammaDenominator: bigint,
  random: RandomSource,
): boolean {
  if (gammaDenominator <= 0n || gammaNumerator < 0n) {
    throw new RangeError('gamma must be a non-negative rational')
  }

  if (gammaNumerator <= gammaDenominator) {
    let k = 1n
    while (sampleRationalBernoulli(gammaNumerator, gammaDenominator * k, random)) k += 1n
    return k % 2n === 1n
  }

  const whole = gammaNumerator / gammaDenominator
  for (let index = 0n; index < whole; index += 1n) {
    if (!sampleBernoulliExp(1n, 1n, random)) return false
  }
  const remainder = gammaNumerator % gammaDenominator
  return sampleBernoulliExp(remainder, gammaDenominator, random)
}

export type BoundedLaplaceResult =
  | { status: 'sampled'; value: bigint }
  | { status: 'aborted'; reason: 'noise-cap-exceeded' }

/**
 * Canonne--Kamath--Steinke Algorithm 2 for Lap_Z(50), followed by a single
 * application-level cap decision. |Z| = B is accepted; |Z| > B aborts the
 * batch. The cap is never handled by retrying, which would condition the
 * output on success and silently change the mechanism.
 */
export function sampleBoundedDiscreteLaplace(
  random: RandomSource = webCryptoRandomSource,
): BoundedLaplaceResult {
  const s = LAPLACE_SCALE_DENOMINATOR
  const t = LAPLACE_SCALE_NUMERATOR

  for (;;) {
    const u = uniformBelow(t, random)
    if (!sampleBernoulliExp(u, t, random)) continue

    let v = 0n
    while (sampleBernoulliExp(1n, 1n, random)) v += 1n

    const x = u + t * v
    const y = x / s
    const negative = sampleRationalBernoulli(1n, 2n, random)
    if (negative && y === 0n) continue

    const value = negative ? -y : y
    if (value < -ABSOLUTE_NOISE_CAP_UNITS || value > ABSOLUTE_NOISE_CAP_UNITS) {
      return { status: 'aborted', reason: 'noise-cap-exceeded' }
    }
    return { status: 'sampled', value }
  }
}

export type ActivatedNoiseResult =
  | { status: 'sampled'; active: false; value: 0n }
  | { status: 'sampled'; active: true; value: bigint }
  | { status: 'aborted'; reason: 'noise-cap-exceeded' }

/** One honest client's beta-activated contribution to the joint noise. */
export function sampleActivatedNoise(
  random: RandomSource = webCryptoRandomSource,
): ActivatedNoiseResult {
  const active = sampleRationalBernoulli(ACTIVATION_NUMERATOR, ACTIVATION_DENOMINATOR, random)
  if (!active) return { status: 'sampled', active: false, value: 0n }
  const noise = sampleBoundedDiscreteLaplace(random)
  if (noise.status === 'aborted') return noise
  return { status: 'sampled', active: true, value: noise.value }
}
