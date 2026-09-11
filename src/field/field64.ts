export const FIELD64_MODULUS = 18_446_744_069_414_584_321n
export const FIELD64_GENERATOR_ORDER = 2n ** 32n
export const FIELD64_ENCODED_SIZE = 8

export type Field64 = bigint

export function field(value: bigint | number): Field64 {
  const reduced = BigInt(value) % FIELD64_MODULUS
  return reduced < 0n ? reduced + FIELD64_MODULUS : reduced
}

export function add(left: Field64, right: Field64): Field64 {
  return field(left + right)
}

export function sub(left: Field64, right: Field64): Field64 {
  return field(left - right)
}

export function neg(value: Field64): Field64 {
  return field(-value)
}

export function mul(left: Field64, right: Field64): Field64 {
  return field(left * right)
}

export function pow(base: Field64, exponent: bigint): Field64 {
  let result = 1n
  let factor = field(base)
  let remaining = exponent
  while (remaining > 0n) {
    if (remaining & 1n) result = mul(result, factor)
    factor = mul(factor, factor)
    remaining >>= 1n
  }
  return result
}

export function inverse(value: Field64): Field64 {
  if (value === 0n) throw new RangeError('zero has no multiplicative inverse')
  return pow(value, FIELD64_MODULUS - 2n)
}

export function divide(left: Field64, right: Field64): Field64 {
  return mul(left, inverse(right))
}

export function addVectors(left: readonly Field64[], right: readonly Field64[]): Field64[] {
  if (left.length !== right.length) throw new RangeError('mismatched vector sizes')
  return left.map((value, index) => add(value, right[index]))
}

export function subVectors(left: readonly Field64[], right: readonly Field64[]): Field64[] {
  if (left.length !== right.length) throw new RangeError('mismatched vector sizes')
  return left.map((value, index) => sub(value, right[index]))
}

export function sumVector(values: readonly Field64[]): Field64 {
  return values.reduce((total, value) => add(total, value), 0n)
}

function assertPowerOfTwo(value: number): number {
  const logarithm = Math.ceil(Math.log2(value))
  if (value <= 0 || value !== 2 ** logarithm) throw new RangeError(`${value} must be a power of two`)
  return logarithm
}

export function nextPowerOfTwo(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('value must be a positive integer')
  return 2 ** Math.ceil(Math.log2(value))
}

function bitReverse(width: number, value: number): number {
  let result = 0
  for (let index = 0; index < width; index += 1) {
    result = (result << 1) | ((value >> index) & 1)
  }
  return result
}

export function field64Generator(): Field64 {
  return pow(7n, 4_294_967_295n)
}

export function nthRoot(logOrder: number): Field64 {
  return pow(field64Generator(), FIELD64_GENERATOR_ORDER >> BigInt(logOrder))
}

export function nthRootPowers(length: number): Field64[] {
  const root = nthRoot(assertPowerOfTwo(length))
  return Array.from({ length }, (_, index) => pow(root, BigInt(index)))
}

export function ntt(polynomial: readonly Field64[], length: number, offsetRoot = false): Field64[] {
  const logLength = assertPowerOfTwo(length)
  if (polynomial.length > length) throw new RangeError('polynomial is longer than transform')
  const padded = [...polynomial, ...Array<Field64>(length - polynomial.length).fill(0n)]
  const output = Array.from({ length }, (_, index) => padded[bitReverse(logLength, index)])

  for (let level = 1; level <= logLength; level += 1) {
    let twiddle = offsetRoot ? nthRoot(level + 1) : 1n
    const halfBlock = 2 ** (level - 1)
    const root = nthRoot(level)
    for (let index = 0; index < halfBlock; index += 1) {
      for (let block = 0; block < length >> level; block += 1) {
        const offset = (block << level) + index
        const left = output[offset]
        const right = mul(twiddle, output[offset + halfBlock])
        output[offset] = add(left, right)
        output[offset + halfBlock] = sub(left, right)
      }
      twiddle = mul(twiddle, root)
    }
  }
  return output
}

export function inverseNtt(polynomial: readonly Field64[], length: number): Field64[] {
  const output = ntt(polynomial, length)
  output.push(output.shift() ?? 0n)
  output.reverse()
  const inverseLength = inverse(field(length))
  return output.map((value) => mul(value, inverseLength))
}

export function evaluatePolynomial(coefficients: readonly Field64[], point: Field64): Field64 {
  if (coefficients.length === 0) return 0n
  let result = coefficients.at(-1) ?? 0n
  for (let index = coefficients.length - 2; index >= 0; index -= 1) {
    result = add(mul(result, point), coefficients[index])
  }
  return result
}

export function evaluateLagrange(polynomials: readonly Field64[][], point: Field64): Field64[] {
  if (polynomials.length === 0) return []
  const length = polynomials[0].length
  if (!polynomials.every((polynomial) => polynomial.length === length)) {
    throw new RangeError('Lagrange polynomials must have equal lengths')
  }
  assertPowerOfTwo(length)
  const nodes = nthRootPowers(length)
  let product = 1n
  const outputs = polynomials.map((polynomial) => polynomial[0])
  let difference = sub(nodes[0], point)
  for (let index = 1; index < length; index += 1) {
    product = mul(product, difference)
    difference = sub(nodes[index], point)
    const term = mul(product, nodes[index])
    polynomials.forEach((polynomial, polynomialIndex) => {
      outputs[polynomialIndex] = add(
        mul(outputs[polynomialIndex], difference),
        mul(term, polynomial[index]),
      )
    })
  }
  const factor = mul(pow(field(-1), BigInt(length - 1)), inverse(field(length)))
  return outputs.map((value) => mul(value, factor))
}

export function extendLagrangeValues(values: readonly Field64[], length: number): Field64[] {
  assertPowerOfTwo(length)
  if (values.length > length) throw new RangeError('too many polynomial evaluations')
  const result = [...values]
  const nodes = nthRootPowers(length)
  const weights = Array<Field64>(length).fill(0n)
  for (let index = 0; index < result.length; index += 1) {
    let product = 1n
    for (let other = 0; other < result.length; other += 1) {
      if (index !== other) product = mul(product, sub(nodes[index], nodes[other]))
    }
    weights[index] = product
  }
  for (let index = result.length; index < length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      weights[previous] = mul(weights[previous], sub(nodes[previous], nodes[index]))
    }
    let numerator = 0n
    let denominator = 1n
    result.forEach((value, valueIndex) => {
      numerator = add(mul(numerator, weights[valueIndex]), mul(denominator, value))
      denominator = mul(denominator, weights[valueIndex])
    })
    let weight = 1n
    for (let previous = 0; previous < index; previous += 1) {
      weight = mul(weight, sub(nodes[index], nodes[previous]))
    }
    weights[index] = weight
    result.push(neg(mul(mul(weight, numerator), inverse(denominator))))
  }
  return result
}

export function multiplyLagrange(left: readonly Field64[], right: readonly Field64[]): Field64[] {
  if (left.length !== right.length) throw new RangeError('Lagrange polynomials must have equal lengths')
  const length = left.length
  assertPowerOfTwo(length)
  const leftDouble = interleave(left, ntt(inverseNtt(left, length), length, true))
  const rightDouble = interleave(right, ntt(inverseNtt(right, length), length, true))
  return leftDouble.map((value, index) => mul(value, rightDouble[index]))
}

function interleave(even: readonly Field64[], odd: readonly Field64[]): Field64[] {
  return even.flatMap((value, index) => [value, odd[index]])
}

export function encodeField64(value: Field64): Uint8Array {
  const bytes = new Uint8Array(FIELD64_ENCODED_SIZE)
  let remaining = field(value)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
}

export function decodeField64(bytes: Uint8Array): Field64 {
  if (bytes.length !== FIELD64_ENCODED_SIZE) {
    throw new RangeError('Field64 encoding must be exactly 8 bytes')
  }
  let value = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index])
  }
  if (value >= FIELD64_MODULUS) throw new RangeError('Field64 modulus overflow')
  return value
}

export function encodeField64Vector(values: readonly Field64[]): Uint8Array {
  const encoded = new Uint8Array(values.length * FIELD64_ENCODED_SIZE)
  values.forEach((value, index) => encoded.set(encodeField64(value), index * FIELD64_ENCODED_SIZE))
  return encoded
}

export function decodeField64Vector(bytes: Uint8Array): Field64[] {
  if (bytes.length % FIELD64_ENCODED_SIZE !== 0) {
    throw new RangeError('Field64 vector length must be a multiple of 8 bytes')
  }
  const values: Field64[] = []
  for (let offset = 0; offset < bytes.length; offset += FIELD64_ENCODED_SIZE) {
    values.push(decodeField64(bytes.slice(offset, offset + FIELD64_ENCODED_SIZE)))
  }
  return values
}