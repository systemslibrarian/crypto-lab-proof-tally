import { type Field64 } from '../field/field64'
import type { ValidityCircuit } from './circuit'
import { verifierLength } from './query'

export interface Decision {
  valid: boolean
  circuitOutput: Field64
  gadgetConsistent: boolean
}

export function decide(circuit: ValidityCircuit, verifier: readonly Field64[]): Decision {
  if (verifier.length !== verifierLength(circuit)) throw new RangeError('incorrect verifier length')
  const circuitOutput = verifier[0]
  const wireChecks = verifier.slice(1, 1 + circuit.gadget.arity)
  const gadgetCheck = verifier.at(-1) ?? 0n
  const gadgetConsistent = circuit.gadget.evaluate(wireChecks) === gadgetCheck
  return { valid: circuitOutput === 0n && gadgetConsistent, circuitOutput, gadgetConsistent }
}