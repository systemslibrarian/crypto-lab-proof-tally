import { observationViolations, recordedMutations } from './verdict-audit'

/**
 * Rule 4 is asserted here, after every test in the run has finished, because that is the
 * only place the whole record exists: Playwright runs spec files in separate workers, so
 * nothing inside a test can see what another worker executed.
 *
 * A throw here fails the run with exit 1. That ordering is guaranteed rather than
 * incidental, and globalTeardown is immune to file filtering — which matters, because the
 * failure this replaces was a rule that could be satisfied by text nobody ever ran.
 */
export default function globalTeardown(): void {
  const violations = observationViolations(recordedMutations())
  if (violations.length === 0) return
  throw new Error(
    `recorded kills whose assertion did not actually run, or ran against the page instead of against a derivation:\n\n${violations.map((line) => `  - ${line}`).join('\n\n')}\n`,
  )
}
