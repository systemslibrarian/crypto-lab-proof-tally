import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The run-scoped record of which assertions actually EXECUTED.
 *
 * A recorded kill used to be checked by reading the spec's source for the helper call it
 * names. That enforces a MENTION, not an execution: a call inside a comment, inside dead
 * code, or inside a different test reads exactly the same to a substring scan, and a
 * mutation whose kill was "proven" that way ships green. So the helpers write down the
 * (spec file, test title, marker) triples they are entered with, and the coverage check
 * reads those back after the whole run.
 *
 * Playwright runs spec files in separate worker processes, so a module-level Set cannot
 * aggregate any of this. Each worker appends its own file under `.verdict-run/`, which
 * globalSetup empties and stamps with a fresh run id before any worker starts. Lines
 * carrying any other id are ignored, so a sink left behind by an earlier run — or by a
 * run whose globalSetup was removed — cannot satisfy the check.
 */

export type HelperName = 'expectVerdict' | 'expectClaim'

/** The expectation a helper was HANDED, normalised to JSON. Not what the page rendered. */
export type Expectation = Record<string, string | readonly string[]>

export interface Observation {
  run: string
  file: string
  title: string
  marker: string
  helper: HelperName
  expected: Expectation
}

const SINK = fileURLToPath(new URL('../.verdict-run/', import.meta.url))
const RUN_ID_PATH = `${SINK}run-id`

let cachedRunId: string | undefined

/** Called once by globalSetup: clears the sink and stamps this run. */
export function startRun(): string {
  rmSync(SINK, { recursive: true, force: true })
  mkdirSync(SINK, { recursive: true })
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  writeFileSync(RUN_ID_PATH, id)
  cachedRunId = id
  return id
}

export function runId(): string {
  if (cachedRunId !== undefined) return cachedRunId
  try {
    cachedRunId = readFileSync(RUN_ID_PATH, 'utf8').trim()
  } catch {
    throw new Error(
      '.verdict-run/run-id is missing, so no assertion can be shown to have run. globalSetup in playwright.config.ts is what writes it; a run without it proves nothing and must not be read as clean.',
    )
  }
  return cachedRunId
}

/** One helper entry. Appended per worker process, so concurrent workers never interleave. */
export function observe(observation: Omit<Observation, 'run'>): void {
  mkdirSync(SINK, { recursive: true })
  appendFileSync(`${SINK}worker-${process.pid}.jsonl`, `${JSON.stringify({ run: runId(), ...observation })}\n`)
}

/** Everything this run observed, in the order each worker wrote it. */
export function observations(): Observation[] {
  const id = runId()
  let files: string[]
  try {
    files = readdirSync(SINK).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
  return files
    .flatMap((name) => readFileSync(`${SINK}${name}`, 'utf8').split('\n').filter((line) => line !== ''))
    .map((line) => JSON.parse(line) as Observation)
    .filter((entry) => entry.run === id)
}
