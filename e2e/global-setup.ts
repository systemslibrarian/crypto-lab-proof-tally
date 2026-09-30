import { startRun } from './verdict-observations'

/**
 * Stamps a fresh run id and empties the observation sink before any worker starts, so a
 * file left behind by an earlier run cannot satisfy the coverage check at the end of this
 * one. Runs whatever subset of specs was selected, which is why the check at teardown
 * refuses a narrowed run rather than judging it.
 */
export default function globalSetup(): void {
  startRun()
}
