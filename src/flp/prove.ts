import { type Field64 } from '../field/field64'
import { gadgetPolynomialLength, wirePolynomialLength } from './gadget'
import type { ValidityCircuit } from './circuit'

export function prove(
  circuit: ValidityCircuit,
  measurement: readonly Field64[],
  proverRandomness: readonly Field64[],
): Field64[] {
  if (proverRandomness.length !== circuit.gadget.arity) throw new RangeError('incorrect prover randomness length')
  const wireLength = wirePolynomialLength(circuit.gadgetCalls)
  const wires = proverRandomness.map((seed) => [seed])
  let calls = 0
  circuit.evaluate(measurement, 1, (input) => {
    calls += 1
    input.forEach((value, index) => wires[index].push(value))
    return circuit.gadget.evaluate(input)
  })
  if (calls !== circuit.gadgetCalls) throw new Error('validity circuit made an unexpected number of gadget calls')
  wires.forEach((wire) => {
    while (wire.length < wireLength) wire.push(0n)
  })
  const polynomial = circuit.gadget.evaluatePolynomial(wires)
  return [
    ...proverRandomness,
    ...polynomial.slice(0, gadgetPolynomialLength(circuit.gadget.degree, wireLength)),
  ]
}