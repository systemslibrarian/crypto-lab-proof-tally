import type { Field64 } from '../field/field64'

export interface LeaderInputShare {
  role: 'leader'
  measurement: Field64[]
  proof: Field64[]
}

export interface HelperInputShare {
  role: 'helper'
  seed: Uint8Array
}

export type InputShare = LeaderInputShare | HelperInputShare

export interface Report {
  nonce: Uint8Array
  inputShares: [LeaderInputShare, HelperInputShare]
}

export interface VerifyState {
  outputShare: Field64[]
}

export interface VerifierShare {
  values: Field64[]
}

export interface PreparationTrace {
  accepted: boolean
  cause: 'combined verifier is zero' | 'combined verifier nonzero' | 'gadget consistency failed'
  verifierShares: [VerifierShare, VerifierShare]
  combinedVerifier: Field64[]
  outputShares?: [Field64[], Field64[]]
}