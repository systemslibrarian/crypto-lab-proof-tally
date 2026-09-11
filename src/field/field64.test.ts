import { describe, expect, it } from 'vitest'
import {
  FIELD64_MODULUS,
  add,
  decodeField64,
  encodeField64,
  field,
  inverse,
  mul,
  sub,
} from './field64'

describe('Field64', () => {
  it('reduces addition, subtraction, and multiplication modulo the Goldilocks prime', () => {
    expect(add(FIELD64_MODULUS - 1n, 2n)).toBe(1n)
    expect(sub(0n, 1n)).toBe(FIELD64_MODULUS - 1n)
    expect(mul(FIELD64_MODULUS - 1n, FIELD64_MODULUS - 1n)).toBe(1n)
  })

  it('computes multiplicative inverses', () => {
    expect(mul(7n, inverse(7n))).toBe(1n)
  })

  it('round-trips the draft little-endian field encoding', () => {
    const value = field(0x4c7432a7da165e35n)
    expect(Array.from(encodeField64(value))).toEqual([0x35, 0x5e, 0x16, 0xda, 0xa7, 0x32, 0x74, 0x4c])
    expect(decodeField64(encodeField64(value))).toBe(value)
  })

  it('rejects non-canonical encodings', () => {
    expect(() => decodeField64(new Uint8Array(8).fill(0xff))).toThrow('modulus overflow')
  })
})