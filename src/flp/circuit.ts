import { add, field, inverse, mul, sub, type Field64 } from '../field/field64'
import { MulGadget, PolyEvalGadget, type Gadget } from './gadget'

export interface ValidityCircuit {
  readonly gadget: Gadget
  readonly gadgetCalls: number
  readonly measurementLength: number
  readonly outputLength: number
  readonly evaluationOutputLength: number
  encode(measurement: bigint): Field64[]
  evaluate(
    measurement: readonly Field64[],
    numberOfShares: number,
    evaluateGadget: (input: readonly Field64[]) => Field64,
  ): Field64[]
  truncate(measurement: readonly Field64[]): Field64[]
}

export class CountCircuit implements ValidityCircuit {
  readonly gadget = new MulGadget()
  readonly gadgetCalls = 1
  readonly measurementLength = 1
  readonly outputLength = 1
  readonly evaluationOutputLength = 1

  encode(measurement: bigint): Field64[] {
    if (measurement !== 0n && measurement !== 1n) throw new RangeError('count measurement must be 0 or 1')
    return [measurement]
  }

  evaluate(
    measurement: readonly Field64[],
    _numberOfShares: number,
    evaluateGadget: (input: readonly Field64[]) => Field64,
  ): Field64[] {
    if (measurement.length !== 1) throw new RangeError('incorrect Count measurement length')
    return [sub(evaluateGadget([measurement[0], measurement[0]]), measurement[0])]
  }

  truncate(measurement: readonly Field64[]): Field64[] {
    if (measurement.length !== 1) throw new RangeError('incorrect Count measurement length')
    return [...measurement]
  }
}

export class SumCircuit implements ValidityCircuit {
  readonly gadget: Gadget
  readonly gadgetCalls: number
  readonly measurementLength: number
  readonly outputLength = 1
  readonly evaluationOutputLength: number
  readonly bits: number

  constructor(readonly maximum: bigint) {
    if (maximum <= 0n || maximum >= 18_446_744_069_414_584_321n) {
      throw new RangeError('Sum maximum must fit in Field64')
    }
    this.bits = maximum.toString(2).length
    this.gadgetCalls = this.bits
    this.measurementLength = this.bits
    this.evaluationOutputLength = this.bits
    this.gadget = new PolyEvalGadget([0n, field(-1), 1n], this.bits)
  }

  encode(measurement: bigint): Field64[] {
    return encodeRangeCheckedInteger(measurement, this.maximum)
  }

  evaluate(
    measurement: readonly Field64[],
    _numberOfShares: number,
    evaluateGadget: (input: readonly Field64[]) => Field64,
  ): Field64[] {
    if (measurement.length !== this.measurementLength) throw new RangeError('incorrect Sum measurement length')
    return measurement.map((bit) => evaluateGadget([bit]))
  }

  truncate(measurement: readonly Field64[]): Field64[] {
    if (measurement.length !== this.measurementLength) throw new RangeError('incorrect Sum measurement length')
    return [decodeRangeCheckedInteger(measurement, this.maximum)]
  }
}

export function encodeRangeCheckedInteger(value: bigint, maximum: bigint): Field64[] {
  if (value < 0n || value > maximum) throw new RangeError('measurement is outside the configured range')
  const bits = maximum.toString(2).length
  const lowerWeightsMaximum = 2n ** BigInt(bits - 1) - 1n
  const finalWeight = maximum - lowerWeightsMaximum
  const lower = value <= lowerWeightsMaximum ? value : value - finalWeight
  const finalBit = value <= lowerWeightsMaximum ? 0n : 1n
  const encoded = Array.from({ length: bits - 1 }, (_, index) => (lower >> BigInt(index)) & 1n)
  encoded.push(finalBit)
  return encoded
}

export function decodeRangeCheckedInteger(encoded: readonly Field64[], maximum: bigint): Field64 {
  const bits = maximum.toString(2).length
  if (encoded.length !== bits) throw new RangeError('incorrect range-check encoding length')
  const finalWeight = maximum - (2n ** BigInt(bits - 1) - 1n)
  let decoded = 0n
  for (let index = 0; index < bits - 1; index += 1) {
    decoded = add(decoded, mul(field(2n ** BigInt(index)), encoded[index]))
  }
  return add(decoded, mul(field(finalWeight), encoded[bits - 1]))
}

export function shareInverse(numberOfShares: number): Field64 {
  return inverse(field(numberOfShares))
}