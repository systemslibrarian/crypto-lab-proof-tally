import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The rendered-page walk in e2e/verdicts.spec.ts is the real coverage check. This is the
 * static half: a marker written into the source but never reached by that walk would
 * otherwise slip through, and a mutation recipe that no longer matches its file would
 * make a recorded kill unreproducible.
 */

const ROOT = new URL('../../', import.meta.url).pathname
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'e2e/verdict-mutations.json'), 'utf8')) as {
  marker: string
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

describe('verdict marker registry', () => {
  const markersInSource = new Set(
    sourceFiles(join(ROOT, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [
        ...Array.from(source.matchAll(/data-verdict="([a-z-]+)"/g), (match) => match[1]),
        ...Array.from(source.matchAll(/\bverdict\('([a-z-]+)',/g), (match) => match[1]),
      ]
    }),
  )

  it('records a mutation for every marker written into src/', () => {
    const recorded = new Set(REGISTRY.map((entry) => entry.marker))
    expect([...markersInSource].filter((marker) => !recorded.has(marker)).sort()).toEqual([])
  })

  it('records no mutation for a marker src/ no longer writes', () => {
    expect(REGISTRY.map((entry) => entry.marker).filter((marker) => !markersInSource.has(marker)).sort()).toEqual([])
  })

  it('names one marker only once', () => {
    expect(REGISTRY.map((entry) => entry.marker).sort()).toEqual([...new Set(REGISTRY.map((entry) => entry.marker))].sort())
  })

  it.each(REGISTRY)('keeps the recorded mutation for $marker applicable', (entry) => {
    const source = readFileSync(join(ROOT, entry.file), 'utf8')
    expect(source.split(entry.find).length - 1, `${entry.file} must contain the recorded original exactly once`).toBe(1)
    expect(entry.replace).not.toBe(entry.find)
  })
})
