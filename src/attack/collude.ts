import { addVectors, type Field64 } from '../field/field64'
import { revealMeasurementShares, type Prio3 } from '../prio3/core'
import type { Report } from '../prio3/types'

export function collude(protocol: Prio3, context: Uint8Array, report: Report): {
  shares: [Field64[], Field64[]]
  reconstructed: bigint
} {
  const shares = revealMeasurementShares(protocol, context, report)
  const encoded = addVectors(shares[0], shares[1])
  return { shares, reconstructed: protocol.options.circuit.truncate(encoded)[0] }
}