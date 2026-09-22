#!/usr/bin/env node
/**
 * Replays every recorded §4.1c mutation and requires the test it names to go RED.
 *
 *   node tools/verdict-kill.mjs verify            # all records
 *   node tools/verdict-kill.mjs verify <marker>…  # just these
 *
 * Why this exists, on top of the coverage gate. The gate asks whether the killing
 * assertion RAN, which is the question a source scan could not answer. It cannot ask
 * whether that assertion would have CAUGHT anything, because on an unmutated page a
 * tautological call — one fed values read off the page in the same test — is
 * observationally identical to a correct one. Only a differential separates them, and
 * this is the differential: the recorded mutation is applied, the gate set is re-run, and
 * the named test must fail. A survivor means the record is not evidence, whatever the
 * spec's source says and whatever ran.
 *
 * The baseline is re-established first, in the same session, because a kill read against
 * a baseline that was never green proves nothing. Every run rebuilds through Playwright's
 * own webServer with CI=1, so reuseExistingServer is off and no stale listener can serve
 * unmutated code to a mutated run.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'e2e/verdict-mutations.json'), 'utf8'))
const GATE = ['e2e/claims.spec.ts', 'e2e/verdicts.spec.ts']
const SCRATCH = mkdtempSync(join(tmpdir(), 'proof-tally-kill-'))

const [, , command, ...only] = process.argv
if (command !== 'verify') {
  console.error('usage: verdict-kill.mjs verify [marker…]')
  process.exit(1)
}

const selected = only.length === 0 ? REGISTRY : REGISTRY.filter((entry) => only.includes(entry.marker))
const unknown = only.filter((marker) => !REGISTRY.some((entry) => entry.marker === marker))
if (unknown.length > 0) {
  console.error(`unknown marker(s): ${unknown.join(', ')}`)
  process.exit(1)
}

function digest(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}

/** Exits non-zero unless exactly one occurrence is replaced. A silent no-op reads as a survivor. */
function patch(entry, direction) {
  const path = join(ROOT, entry.file)
  const source = readFileSync(path, 'utf8')
  const from = direction === 'apply' ? entry.find : entry.replace
  const to = direction === 'apply' ? entry.replace : entry.find
  const occurrences = source.split(from).length - 1
  if (occurrences !== 1) {
    throw new Error(`${entry.file}: ${direction} ${entry.marker} expected exactly one occurrence, found ${occurrences}`)
  }
  writeFileSync(path, source.replace(from, to))
}

function runGate(label) {
  const report = join(SCRATCH, `${label}.json`)
  const result = spawnSync('npx', ['playwright', 'test', ...GATE, '--reporter=json', '--retries=0'], {
    cwd: ROOT,
    env: { ...process.env, CI: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: report },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  let parsed
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'))
  } catch {
    throw new Error(`playwright produced no JSON report for ${label}:\n${result.stdout}\n${result.stderr}`)
  }
  const specs = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec)
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of parsed.suites ?? []) walk(suite)
  return { specs, exitCode: result.status }
}

function outcome(specs, entry) {
  const [file, title] = entry.kills.split(' - ')
  const spec = specs.find((item) => basename(item.file) === file.trim() && item.title === title.trim())
  if (!spec) return { found: false, ok: false, detail: `${file.trim()} ran no test called "${title.trim()}"` }
  const statuses = spec.tests.flatMap((test) => test.results.map((result) => result.status))
  return { found: true, ok: spec.ok === true, detail: statuses.join(', ') }
}

const targets = [...new Set(selected.map((entry) => join(ROOT, entry.file)))]
const before = new Map(targets.map((path) => [path, digest(path)]))

console.log(`baseline: running the gate set unmutated, ${selected.length} record(s) to replay`)
const baseline = runGate('baseline')
const notGreen = selected.filter((entry) => !outcome(baseline.specs, entry).ok)
if (baseline.exitCode !== 0 || notGreen.length > 0) {
  console.error(`baseline is not green (exit ${baseline.exitCode}); a kill read against it would prove nothing.`)
  for (const entry of notGreen) console.error(`  ${entry.marker}: ${outcome(baseline.specs, entry).detail}`)
  process.exit(1)
}
console.log('baseline green\n')

const survivors = []
for (const [index, entry] of selected.entries()) {
  const position = `${String(index + 1).padStart(2)}/${selected.length}`
  let verdict
  try {
    patch(entry, 'apply')
    const mutated = runGate(entry.marker)
    const result = outcome(mutated.specs, entry)
    verdict = result.found && !result.ok ? 'KILLED' : 'SURVIVED'
    if (verdict === 'SURVIVED') survivors.push({ entry, detail: result.detail })
    console.log(`${position}  ${verdict.padEnd(8)} ${entry.marker.padEnd(22)} ${entry.kills}`)
  } finally {
    patch(entry, 'restore')
  }
}

for (const [path, hash] of before) {
  if (digest(path) !== hash) throw new Error(`${path} was not restored to its pre-run bytes`)
}
rmSync(SCRATCH, { recursive: true, force: true })

console.log(`\n${selected.length - survivors.length} killed, ${survivors.length} survived`)
for (const { entry, detail } of survivors) {
  console.log(`  SURVIVED ${entry.marker}: "${entry.kills}" stayed green under its own recorded mutation (${detail}). The record is not evidence.`)
}
process.exit(survivors.length === 0 ? 0 : 1)
