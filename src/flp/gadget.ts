import {
  evaluatePolynomial,
  inverseNtt,
  multiplyLagrange,
  nextPowerOfTwo,
  ntt,
  type Field64,
} from '../field/field64'

export interface Gadget {
  readonly arity: number
  readonly degree: number
  evaluate(input: readonly Field64[]): Field64
  evaluatePolynomial(input: readonly Field64[][]): Field64[]
}

export class MulGadget implements Gadget {
  readonly arity = 2
  readonly degree = 2

  evaluate(input: readonly Field64[]): Field64 {
    if (input.length !== this.arity) throw new RangeError('multiplication gadget requires two inputs')
    return (input[0] * input[1]) % 18_446_744_069_414_584_321n
  }

  evaluatePolynomial(input: readonly Field64[][]): Field64[] {
    if (input.length !== this.arity) throw new RangeError('multiplication gadget requires two polynomials')
    return multiplyLagrange(input[0], input[1])
  }
}

export class PolyEvalGadget implements Gadget {
  readonly arity = 1
  readonly degree: number
  private readonly transformLength: number

  constructor(private readonly coefficients: readonly Field64[], calls: number) {
    if (coefficients.length === 0) throw new RangeError('polynomial must not be empty')
    this.degree = coefficients.length - 1
    this.transformLength = nextPowerOfTwo(gadgetPolynomialLength(this.degree, wirePolynomialLength(calls)))
  }

  evaluate(input: readonly Field64[]): Field64 {
    if (input.length !== this.arity) throw new RangeError('polynomial gadget requires one input')
    return evaluatePolynomial(this.coefficients, input[0])
  }

  evaluatePolynomial(input: readonly Field64[][]): Field64[] {
    if (input.length !== this.arity) throw new RangeError('polynomial gadget requires one polynomial')
    const monomial = inverseNtt(input[0], input[0].length)
    return ntt(monomial, this.transformLength).map((value) => evaluatePolynomial(this.coefficients, value))
  }
}

export function wirePolynomialLength(gadgetCalls: number): number {
  return nextPowerOfTwo(1 + gadgetCalls)
}

export function gadgetPolynomialLength(degree: number, wireLength: number): number {
  return degree * (wireLength - 1) + 1
}