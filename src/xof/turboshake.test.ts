import { describe, expect, it } from 'vitest'
import { XofTurboShake128 } from './turboshake'

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('XofTurboShake128', () => {
  const seed = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
  const dst = hex('646f6d61696e2073657061726174696f6e20746167')
  const binder = hex('62696e64657220737472696e67')

  it('matches the draft-22 derive-seed known-answer test', () => {
    expect(toHex(XofTurboShake128.deriveSeed(seed, dst, binder))).toBe(
      'b62ef0a2778190792d4d42d8c167ba20e0c37a3f319ba79645829c427d70eea5',
    )
  })

  it('preserves the XOF stream across successive reads', () => {
    const whole = new XofTurboShake128(seed, dst, binder).next(48)
    const split = new XofTurboShake128(seed, dst, binder)
    expect(toHex(new Uint8Array([...split.next(16), ...split.next(32)]))).toBe(toHex(whole))
  })
})