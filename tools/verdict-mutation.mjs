#!/usr/bin/env node
/**
 * Applies or restores one recorded §4.1c verdict mutation, so a kill is reproducible
 * rather than a claim in a commit body.
 *
 *   node tools/verdict-mutation.mjs list
 *   node tools/verdict-mutation.mjs apply <marker>
 *   node tools/verdict-mutation.mjs restore <marker>
 *
 * A mutation counts as a kill only when the unmutated baseline passed in the same run,
 * the failure is that verdict's own assertion, and the server served the mutated code
 * (CI=1, which turns off reuseExistingServer).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const registry = JSON.parse(readFileSync(new URL('e2e/verdict-mutations.json', root), 'utf8'))

const [, , command, marker] = process.argv

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (command === 'list') {
  for (const entry of registry) console.log(`${entry.marker}\t${entry.file}\t${entry.kills}`)
  process.exit(0)
}

if (command !== 'apply' && command !== 'restore') {
  fail('usage: verdict-mutation.mjs list | apply <marker> | restore <marker>')
}

const entry = registry.find((item) => item.marker === marker)
if (!entry) fail(`unknown marker: ${marker}`)

const path = fileURLToPath(new URL(entry.file, root))
const source = readFileSync(path, 'utf8')
const from = command === 'apply' ? entry.find : entry.replace
const to = command === 'apply' ? entry.replace : entry.find

const occurrences = source.split(from).length - 1
if (occurrences !== 1) {
  fail(`${entry.file}: expected exactly one occurrence of the ${command === 'apply' ? 'original' : 'mutated'} text for ${marker}, found ${occurrences}`)
}

writeFileSync(path, source.replace(from, to))
console.log(`${command} ${marker} -> ${entry.file}`)
