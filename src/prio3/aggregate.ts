import { addVectors, type Field64 } from '../field/field64'

export function aggregateOutputShares(outputShares: readonly Field64[][]): Field64[] {
  if (outputShares.length === 0) throw new RangeError('cannot aggregate zero reports')
  return outputShares.reduce((aggregate, share) => addVectors(aggregate, share), [0n])
}

export function unshard(aggregatorShares: readonly [Field64[], Field64[]], acceptedReports: number): bigint {
  if (acceptedReports < 1) throw new RangeError('aggregate is undefined for zero reports')
  return addVectors(aggregatorShares[0], aggregatorShares[1])[0]
}