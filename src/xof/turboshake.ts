import { turboshake128 } from '@noble/hashes/sha3-addons.js'
import { FIELD64_ENCODED_SIZE, FIELD64_MODULUS, type Field64 } from '../field/field64'

export const XOF_SEED_SIZE = 32
const TURBOSHAKE_DOMAIN = 1

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function littleEndian(value: number, length: number): Uint8Array {
  const result = new Uint8Array(length)
  let remaining = value
  for (let index = 0; index < length; index += 1) {
    result[index] = remaining & 0xff
    remaining >>>= 8
  }
  return result
}

function littleEndianBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index])
  return value
}

export class XofTurboShake128 {
  private readonly message: Uint8Array
  private consumed = 0

  constructor(seed: Uint8Array, dst: Uint8Array, binder: Uint8Array) {
    if (seed.length !== XOF_SEED_SIZE) throw new RangeError('XOF seed must be exactly 32 bytes')
    if (dst.length > 0xffff) throw new RangeError('domain-separation tag is too long')
    this.message = concat(littleEndian(dst.length, 2), dst, new Uint8Array([seed.length]), seed, binder)
  }

  next(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length <= 0) throw new RangeError('XOF length must be positive')
    const total = this.consumed + length
    const stream = turboshake128(this.message, { D: TURBOSHAKE_DOMAIN, dkLen: total })
    const output = stream.slice(this.consumed)
    this.consumed = total
    return output
  }

  nextField64Vector(length: number): Field64[] {
    const values: Field64[] = []
    while (values.length < length) {
      const candidate = littleEndianBigInt(this.next(FIELD64_ENCODED_SIZE))
      if (candidate < FIELD64_MODULUS) values.push(candidate)
    }
    return values
  }

  static deriveSeed(seed: Uint8Array, dst: Uint8Array, binder: Uint8Array): Uint8Array {
    return new XofTurboShake128(seed, dst, binder).next(XOF_SEED_SIZE)
  }
}