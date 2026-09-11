export interface SalaryReport {
  name: string
  reported: bigint
  sealedTruth: bigint
}

export const VALID_LIE_FIXTURE: readonly SalaryReport[] = [
  { name: 'Avery', reported: 84_200n, sealedTruth: 84_200n },
  { name: 'Blair', reported: 0n, sealedTruth: 91_750n },
  { name: 'Cameron', reported: 76_300n, sealedTruth: 76_300n },
]