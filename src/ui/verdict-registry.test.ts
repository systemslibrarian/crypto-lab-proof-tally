import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The rendered-page walk in e2e/verdicts.spec.ts is the real coverage check. This is the
 * static half: a marker written into the source but never reached by that walk would
 * otherwise slip through, and a mutation recipe that no longer matches its file would
 * make a recorded kill unreproducible.
 *
 * Both marker families are held to it. A [data-claim] measurement is a claim the page
 * makes exactly as much as a [data-verdict] is, and a number is the easier one to ship
 * without noticing.
 */

const ROOT = new URL('../../', import.meta.url).pathname
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'e2e/verdict-mutations.json'), 'utf8')) as {
  marker: string
  kind: 'verdict' | 'claim'
  paints?: string
  file: string
  find: string
  replace: string
  kills: string
}[]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

function markersInSource(kind: 'verdict' | 'claim'): Set<string> {
  const attribute = kind === 'verdict' ? /data-verdict="([a-z-]+)"/g : /data-claim="([a-z-]+)"/g
  const call = kind === 'verdict' ? /(?<![A-Za-z])verdict\('([a-z-]+)',/g : /(?<![A-Za-z])claim\('([a-z-]+)',/g
  return new Set(
    sourceFiles(join(ROOT, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [
        ...Array.from(source.matchAll(attribute), (match) => match[1]),
        ...Array.from(source.matchAll(call), (match) => match[1]),
      ]
    }),
  )
}

describe.each(['verdict', 'claim'] as const)('%s marker registry', (kind) => {
  const inSource = markersInSource(kind)
  const recorded = REGISTRY.filter((entry) => entry.kind === kind)

  it('finds markers of this kind in src/ at all', () => {
    expect(inSource.size, `no ${kind} markers found in src/, so this file is checking nothing`).toBeGreaterThan(0)
  })

  it('records a mutation for every marker written into src/', () => {
    const covered = new Set(recorded.map((entry) => entry.marker))
    expect([...inSource].filter((marker) => !covered.has(marker)).sort()).toEqual([])
  })

  it('records no mutation for a marker src/ no longer writes', () => {
    expect(recorded.map((entry) => entry.marker).filter((marker) => !inSource.has(marker)).sort()).toEqual([])
  })
})

describe('mutation recipes', () => {
  it('names one marker only once, across both families', () => {
    expect(REGISTRY.map((entry) => entry.marker).sort()).toEqual([...new Set(REGISTRY.map((entry) => entry.marker))].sort())
  })

  it('gives every record a known kind', () => {
    expect(REGISTRY.filter((entry) => entry.kind !== 'verdict' && entry.kind !== 'claim')).toEqual([])
  })

  /**
   * `paints` is the state the marker shows on a healthy page, and e2e/verdict-audit.ts
   * compares it to the state the killing test HANDS expectVerdict(). Without it a test can
   * read the state off the page and assert it back, which passes under every mutation. It
   * is required of every verdict and of no measurement: a measurement's expected value is
   * derived per run, and pinning one here would put back the literal the derived oracle
   * exists to remove.
   */
  it('pins the healthy state of every verdict, and of nothing else', () => {
    const states = ['pass', 'reject', 'alarm']
    expect(REGISTRY.filter((entry) => entry.kind === 'verdict' && !states.includes(entry.paints ?? '')).map((entry) => entry.marker)).toEqual([])
    expect(REGISTRY.filter((entry) => entry.kind === 'claim' && entry.paints !== undefined).map((entry) => entry.marker)).toEqual([])
  })

  it.each(REGISTRY)('keeps the recorded mutation for $marker applicable', (entry) => {
    const source = readFileSync(join(ROOT, entry.file), 'utf8')
    expect(source.split(entry.find).length - 1, `${entry.file} must contain the recorded original exactly once`).toBe(1)
    expect(entry.replace).not.toBe(entry.find)
  })
})
