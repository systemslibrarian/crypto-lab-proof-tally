import {
  add,
  evaluateLagrange,
  extendLagrangeValues,
  field,
  mul,
  pow,
  type Field64,
} from '../field/field64'
import type { ValidityCircuit } from './circuit'
import { gadgetPolynomialLength, wirePolynomialLength } from './gadget'

export function proofLength(circuit: ValidityCircuit): number {
  const wireLength = wirePolynomialLength(circuit.gadgetCalls)
  return circuit.gadget.arity + gadgetPolynomialLength(circuit.gadget.degree, wireLength)
}

export function proverRandomnessLength(circuit: ValidityCircuit): number {
  return circuit.gadget.arity
}

export function queryRandomnessLength(circuit: ValidityCircuit): number {
  return 1 + (circuit.evaluationOutputLength > 1 ? circuit.evaluationOutputLength : 0)
}

export function verifierLength(circuit: ValidityCircuit): number {
  return 1 + circuit.gadget.arity + 1
}

export function query(
  circuit: ValidityCircuit,
  measurementShare: readonly Field64[],
  proofShare: readonly Field64[],
  queryRandomness: readonly Field64[],
  numberOfShares: number,
): Field64[] {
  if (proofShare.length !== proofLength(circuit)) throw new RangeError('incorrect proof share length')
  if (queryRandomness.length !== queryRandomnessLength(circuit)) throw new RangeError('incorrect query randomness length')

  const wireLength = wirePolynomialLength(circuit.gadgetCalls)
  const polynomialLength = gadgetPolynomialLength(circuit.gadget.degree, wireLength)
  const wireSeeds = proofShare.slice(0, circuit.gadget.arity)
  const compressedPolynomial = proofShare.slice(circuit.gadget.arity, circuit.gadget.arity + polynomialLength)
  const polynomial = extendLagrangeValues(compressedPolynomial, 2 ** Math.ceil(Math.log2(polynomialLength)))
  const wires = wireSeeds.map((seed) => [seed])
  const step = polynomial.length / wireLength
  let calls = 0
  const output = circuit.evaluate(measurementShare, numberOfShares, (input) => {
    calls += 1
    input.forEach((value, index) => wires[index].push(value))
    return polynomial[calls * step]
  })
  wires.forEach((wire) => {
    while (wire.length < wireLength) wire.push(0n)
  })

  let randomnessOffset = 0
  let reducedOutput: Field64
  if (circuit.evaluationOutputLength > 1) {
    reducedOutput = output.reduce(
      (total, value, index) => add(total, mul(queryRandomness[index], value)),
      0n,
    )
    randomnessOffset = circuit.evaluationOutputLength
  } else {
    reducedOutput = output[0]
  }

  const testPoint = queryRandomness[randomnessOffset]
  if (pow(testPoint, BigInt(wireLength)) === field(1)) throw new Error('test point is a root of unity')
  const wireChecks = evaluateLagrange(wires, testPoint)
  const gadgetCheck = evaluateLagrange([polynomial], testPoint)[0]
  return [reducedOutput, ...wireChecks, gadgetCheck]
}