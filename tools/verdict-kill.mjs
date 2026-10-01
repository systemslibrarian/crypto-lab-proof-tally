#!/usr/bin/env node
/**
 * Replays every recorded §4.1c mutation and JUDGES it against the four rules a kill
 * has to clear. Nothing here is typed by a person: every verdict below is produced
 * by the run that earned it.
 *
 *   node tools/verdict-kill.mjs verify            # all records
 *   node tools/verdict-kill.mjs verify <marker>   # just these
 *
 * THE FOUR RULES, each enforced rather than assumed:
 *
 *   1. The owning test PASSED UNMUTATED in this same run. Checked per record, not
 *      suite-wide: a baseline that is green overall can still be green because the
 *      one test that matters never ran.
 *   2. The patch CHANGED THE FILE, and the restore returns the file's original md5.
 *      Both halves are checked for EVERY selected patch before any is applied, and
 *      the md5 is re-checked after each individual mutation, not once at the end.
 *      A restore that does not land aborts the whole run, because every verdict
 *      after it would be a statement about the file that stayed mutated rather than
 *      about its own mutation.
 *   3. The run served the MUTATED CODE, proved two ways because one is not enough:
 *      the built bundle's hash must MOVE, and the failure must not match a shape
 *      that means the code never ran at all (a build error, a server that never
 *      started, a refused connection, a port already held). CI=1 turns off
 *      reuseExistingServer and the preview server is --strictPort, so a listener
 *      left by an earlier run cannot answer for an unmutated build.
 *   4. A patch that DOES NOT COMPILE is DOES NOT BUILD, never a kill. The build runs
 *      explicitly before the gate so that answer is reached directly instead of
 *      arriving later as a webServer timeout.
 *
 * Each of the four was confirmed to BITE before this file was trusted, by the only
 * method that can confirm it: making each one fail on purpose.
 *
 *   rule 1  a dirty working tree is refused, naming the files
 *   rule 2  a record whose find equals its replace is refused as a no-op; one
 *           anchored on `const ` is refused at 97 occurrences. Both before any
 *           patch is applied
 *   rule 3  every KILLED line below carries the hashes it moved between, and a
 *           patch pointed at a cosmetic label its own test never reads came back
 *           SURVIVED rather than killed, with the bundle moving all the same
 *   rule 4  replacing `const agrees =` with `const agrees: number =` came back
 *           DOES NOT BUILD, quoting TS2322, and exited non-zero
 *
 * The restore-abort path is enforced per mutation but was not provoked: the
 * preflight establishes that each replacement is uniquely revertible before
 * anything is written, which leaves that branch reachable only if a build step
 * rewrites a source file mid-run. It is kept because the cost of being wrong about
 * that is every later verdict in the run.
 *
 * WHY THE WORK HAPPENS IN AN ISOLATED TREE
 *
 * The loop archives HEAD into a temporary directory and mutates THAT, with
 * node_modules symlinked. §4.1c's own warning is that a session dying mid-check
 * strands an inverted condition in the tree: four were caught here in one day, and
 * two did not break tsc. A `finally` that restores covers a thrown error and does
 * not cover a kill signal. Archiving also means a dirty working copy cannot change
 * the answer, so the loop refuses to run against one rather than reporting results
 * about a tree nobody else has.
 *
 * HOW THE OUTCOME IS READ
 *
 * From Playwright's JSON report, matched on spec FILE plus exact test TITLE, which
 * is what each record's `kills` field names. Reading the list reporter's text would
 * match a title that merely contains another, and several records here differ by a
 * few words.
 *
 * WHY THE WHOLE GATE SET RUNS, NEVER -g
 *
 * e2e/global-teardown.ts fails the run when any recorded kill's assertion did not
 * execute. A single-test run therefore cannot exit 0 in this lab: the named test
 * passes and the teardown fails on the other thirty-four. The gate runs whole once
 * per phase and the per-test answer is read out of the report.
 *
 * Results are NOT written back into e2e/verdict-mutations.json. The teardown above
 * already makes an unperformed record fail the suite, so an archived `observed`
 * string would be a second copy of an answer that is enforced anyway, which is the
 * choice crypto-lab-hidden-bit and crypto-lab-pqxdh-wire both made. §4.1c calls
 * writing back optional and enforcement the requirement. That enforcement is not
 * theoretical here: adding four synthetic records to the ledger while testing this
 * loop turned e2e/verdicts.spec.ts red, because a recorded mutation whose marker
 * the page never renders is itself a finding.
 */
import { createHash } from 'node:crypto'
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'e2e/verdict-mutations.json'), 'utf8'))
const GATE = ['e2e/claims.spec.ts', 'e2e/verdicts.spec.ts']

const [, , command, ...only] = process.argv
if (command !== 'verify') {
  console.error('usage: verdict-kill.mjs verify [marker...]')
  process.exit(1)
}

const selected = only.length === 0 ? REGISTRY : REGISTRY.filter((entry) => only.includes(entry.marker))
const unknown = only.filter((marker) => !REGISTRY.some((entry) => entry.marker === marker))
if (unknown.length > 0) {
  console.error(`unknown marker(s): ${unknown.join(', ')}`)
  process.exit(1)
}

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim()

/* The archive below is taken from HEAD, so uncommitted work would be absent from
   the tree every verdict describes. Commit first. */
const dirty = git('status', '--porcelain', '--untracked-files=no')
if (dirty && !process.env.MUTATION_ALLOW_DIRTY) {
  console.error('Refusing to run: uncommitted changes to tracked files.\n')
  console.error(dirty)
  console.error('\nThe isolated tree is archived from HEAD and would not contain them.')
  console.error('Commit first. MUTATION_ALLOW_DIRTY=1 overrides, knowing that.')
  process.exit(2)
}

/* Rule 2, for every selected patch, BEFORE any of them is applied. A patch that
   cannot make the round trip is a broken RECORD; finding that out halfway through
   leaves a mutated file behind and poisons every verdict after it.
   Read from the TREE, not from ROOT: the patches are applied there, and checking
   one set of bytes while mutating another is the near-miss this file exists to be
   above. */
function preflight(tree) {
  const unroundtrippable = []
  for (const entry of selected) {
    const text = readFileSync(join(tree, entry.file), 'utf8')
    const anchors = text.split(entry.find).length - 1
    if (anchors !== 1) {
      unroundtrippable.push(`${entry.marker}: find occurs ${anchors}x in ${entry.file}, expected exactly 1`)
      continue
    }
    const after = text.replace(entry.find, entry.replace)
    if (after === text) {
      unroundtrippable.push(`${entry.marker}: the patch is a no-op, it would not change ${entry.file}`)
    } else if (after.split(entry.replace).length - 1 !== 1) {
      const n = after.split(entry.replace).length - 1
      unroundtrippable.push(`${entry.marker}: replace occurs ${n}x after applying, so it cannot be reverted`)
    }
  }
  if (unroundtrippable.length > 0) {
    console.error('Refusing to run: these records cannot make the round trip.\n')
    for (const line of unroundtrippable) console.error(`  ${line}`)
    rmSync(tree, { recursive: true, force: true })
    process.exit(2)
  }
}

const sha = git('rev-parse', 'HEAD').slice(0, 7)
const TREE = mkdtempSync(join(tmpdir(), 'proof-tally-kill-'))
const SCRATCH = mkdtempSync(join(tmpdir(), 'proof-tally-reports-'))
execSync(`git -C ${ROOT} archive HEAD | tar -x -C ${TREE}`, { stdio: 'pipe' })
symlinkSync(join(ROOT, 'node_modules'), join(TREE, 'node_modules'))
console.log(`isolated tree: ${TREE}`)
console.log(`archived from: ${sha}`)
preflight(TREE)
console.log(`${selected.length} record(s) make the round trip\n`)

const digest = (rel) => createHash('md5').update(readFileSync(join(TREE, rel))).digest('hex').slice(0, 12)

const DIST = join(TREE, 'dist', 'assets')
function bundleHash() {
  if (!existsSync(DIST)) return null
  const h = createHash('sha256')
  for (const file of readdirSync(DIST).sort()) h.update(file).update(readFileSync(join(DIST, file)))
  return h.digest('hex').slice(0, 12)
}

/** Rule 4. Returns the build output when it fails, so the reason is reportable. */
function build() {
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: TREE,
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const ESC = String.fromCharCode(27)
const strip = (text) => text.split(new RegExp(`${ESC}\\[[0-9;]*m`, 'g')).join('')

/* Rule 3's second half: red for one of these means the code never ran, so the red
   is about the harness and not about the verdict. */
const NOT_A_KILL = [
  { pattern: /error TS\d+|Build failed|Transform failed|Could not resolve/i, label: 'build error' },
  { pattern: /webServer.*did not start|Timed out waiting .* from config\.webServer/i, label: 'server never started' },
  { pattern: /net::ERR_CONNECTION_REFUSED/i, label: 'nothing served on the port' },
  { pattern: /is already (?:used|in use)|EADDRINUSE/i, label: 'port already held' },
]
const notAKill = (output) => NOT_A_KILL.find(({ pattern }) => pattern.test(strip(output)))?.label ?? null

function runGate(label) {
  const report = join(SCRATCH, `${label}.json`)
  const result = spawnSync('npx', ['playwright', 'test', ...GATE, '--reporter=json', '--retries=0'], {
    cwd: TREE,
    env: { ...process.env, CI: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: report },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  let parsed
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'))
  } catch {
    return { specs: null, exitCode: result.status, output }
  }
  const specs = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) specs.push(spec)
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of parsed.suites ?? []) walk(suite)
  return { specs, exitCode: result.status, output }
}

/** The record's own test, found by spec file plus exact title. */
function outcome(specs, entry) {
  const [file, title] = entry.kills.split(' - ')
  const spec = specs?.find((item) => basename(item.file) === file.trim() && item.title === title.trim())
  if (!spec) return { found: false, ok: false, detail: `${file.trim()} ran no test called "${title.trim()}"` }
  const statuses = spec.tests.flatMap((test) => test.results.map((result) => result.status))
  return { found: true, ok: spec.ok === true, detail: statuses.join(', ') }
}

function patch(entry, direction) {
  const path = join(TREE, entry.file)
  const source = readFileSync(path, 'utf8')
  const from = direction === 'apply' ? entry.find : entry.replace
  const to = direction === 'apply' ? entry.replace : entry.find
  const occurrences = source.split(from).length - 1
  if (occurrences !== 1) {
    throw new Error(`${entry.file}: ${direction} ${entry.marker} expected exactly one occurrence, found ${occurrences}`)
  }
  const next = source.replace(from, to)
  if (next === source) throw new Error(`${entry.file}: ${direction} ${entry.marker} produced an identical file`)
  writeFileSync(path, next)
}

function abort(message) {
  console.error(`\n${message}`)
  rmSync(TREE, { recursive: true, force: true })
  rmSync(SCRATCH, { recursive: true, force: true })
  process.exit(2)
}

console.log('building the baseline in the isolated tree...')
const baselineBuild = build()
if (!baselineBuild.ok) {
  abort(`The baseline does not build in the isolated tree. Nothing below would mean anything.\n\n${strip(baselineBuild.output).split('\n').slice(-20).join('\n')}`)
}
const baselineHash = bundleHash()
console.log(`baseline bundle ${baselineHash}`)

console.log('running the gate set unmutated...')
const baseline = runGate('baseline')
const notGreen = selected.filter((entry) => !outcome(baseline.specs, entry).ok)
if (baseline.exitCode !== 0 || notGreen.length > 0) {
  for (const entry of notGreen) console.error(`  ${entry.marker}: ${outcome(baseline.specs, entry).detail}`)
  abort(`The unmutated gate is not green (exit ${baseline.exitCode}); a kill read against it would prove nothing.\n\n${strip(baseline.output).split('\n').slice(-20).join('\n')}`)
}
console.log(`baseline green, ${baseline.specs.length} specs\n`)

const results = []
for (const [index, entry] of selected.entries()) {
  const position = `${String(index + 1).padStart(2)}/${selected.length}`
  const before = digest(entry.file)
  let verdict
  let detail = ''
  let hashes = ''
  try {
    patch(entry, 'apply')
    const built = build()
    if (!built.ok) {
      verdict = 'DOES NOT BUILD'
      detail = (strip(built.output).match(/error TS\d+[^\n]*/) ?? [''])[0]
    } else {
      const mutatedHash = bundleHash()
      if (mutatedHash === baselineHash) {
        verdict = 'BUNDLE UNCHANGED'
      } else {
        const mutated = runGate(entry.marker)
        const shape = notAKill(mutated.output)
        const result = outcome(mutated.specs, entry)
        verdict = shape
          ? `NOT A KILL (${shape})`
          : !result.found
            ? 'NOT A KILL (its test did not run)'
            : result.ok
              ? 'SURVIVED'
              : 'KILLED'
        detail = result.detail
        hashes = `${baselineHash} -> ${mutatedHash}`
      }
    }
  } finally {
    patch(entry, 'restore')
  }
  const rebuilt = build()
  const restoredHash = rebuilt.ok ? bundleHash() : null
  if (digest(entry.file) !== before) {
    abort(`${entry.marker}: ${entry.file} did not return to md5 ${before}. Aborting: every verdict after this one would describe that file rather than its own mutation.`)
  }
  if (rebuilt.ok && restoredHash !== baselineHash) {
    abort(`${entry.marker}: the bundle did not return to ${baselineHash} after restoring ${entry.file}. Aborting for the same reason.`)
  }
  results.push({ entry, verdict, detail })
  const trail = hashes ? `${hashes} -> ${restoredHash}` : detail
  console.log(`${position}  ${verdict.padEnd(18)} ${entry.marker.padEnd(24)} ${trail}`)
}

rmSync(TREE, { recursive: true, force: true })
rmSync(SCRATCH, { recursive: true, force: true })

const killed = results.filter((r) => r.verdict === 'KILLED')
const survived = results.filter((r) => r.verdict === 'SURVIVED')
const broken = results.filter((r) => r.verdict !== 'KILLED' && r.verdict !== 'SURVIVED')
console.log(`\n${killed.length}/${results.length} killed, ${survived.length} survived, ${broken.length} neither`)
for (const { entry, detail } of survived) {
  console.log(`  SURVIVED ${entry.marker}: "${entry.kills}" stayed green under its own recorded mutation (${detail}). The record is not evidence.`)
}
for (const { entry, verdict, detail } of broken) {
  console.log(`  ${verdict} ${entry.marker}${detail ? `: ${detail}` : ''}`)
}
if (broken.length > 0) {
  console.log('\nDOES NOT BUILD is a broken PATCH, not a surviving mutation: fix the patch and re-run.')
  console.log('BUNDLE UNCHANGED means the edit never reached the browser.')
}
process.exit(killed.length === results.length ? 0 : 1)
