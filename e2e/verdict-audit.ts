import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

/**
 * Coverage is derived from the rendered page, never from a list an author keeps by hand.
 *
 * Two rules are enforced here:
 *
 *  1. every `[data-verdict]` marker the page actually renders must have a recorded
 *     §4.1c mutation in verdict-mutations.json, and every recorded mutation must
 *     still correspond to a marker the page renders;
 *  2. verdict wording or verdict styling rendered OUTSIDE a marker is a failure — that
 *     is what catches a raw banner added later by someone who never read this file.
 */

export interface RecordedMutation {
  marker: string
  file: string
  find: string
  replace: string
  kills: string
}

export interface StrayVerdict {
  rule: 'styling' | 'wording'
  tag: string
  className: string
  text: string
}

const REGISTRY_PATH = fileURLToPath(new URL('./verdict-mutations.json', import.meta.url))

export function recordedMutations(): RecordedMutation[] {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as RecordedMutation[]
}

/** Markers with no mutation, and mutations whose marker the page never renders. */
export function coverageViolations(rendered: readonly string[], recorded: readonly RecordedMutation[]): {
  uncovered: string[]
  stale: string[]
} {
  const covered = new Set(recorded.map((entry) => entry.marker))
  const seen = new Set(rendered)
  return {
    uncovered: [...seen].filter((marker) => !covered.has(marker)).sort(),
    stale: [...covered].filter((marker) => !seen.has(marker)).sort(),
  }
}

/** Every marker currently in the DOM, and every verdict rendered outside one. */
export async function auditRenderedVerdicts(page: Page): Promise<{ markers: string[]; stray: StrayVerdict[] }> {
  return page.evaluate(() => {
    const WORDS = /\b(VALID|REJECTED|ACCEPTED|ADMITTED|REFUSED|MATCH|MISMATCH|BROKEN|FORGED|PASSED|FAILED|SAFE|UNSAFE|SECURE|INSECURE|OK)\b/
    const STYLING = '.verdict, .verdict-icon, .valid-word, .kat-status, .byte-match'
    const EMPHASIS = new Set(['STRONG', 'B', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
    const CARRIER = /verdict|status|result|banner|word|outcome/i

    const markers: string[] = []
    const stray: { rule: 'styling' | 'wording'; tag: string; className: string; text: string }[] = []

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const marker = element.dataset.verdict
      if (marker !== undefined) markers.push(marker)
      if (element.closest('[data-verdict]')) continue

      const className = typeof element.className === 'string' ? element.className : ''
      if (element.matches(STYLING)) {
        stray.push({ rule: 'styling', tag: element.tagName, className, text: (element.textContent ?? '').trim().slice(0, 120) })
        continue
      }

      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim()
      const emphasised = EMPHASIS.has(element.tagName) || CARRIER.test(className)
      if (ownText !== '' && emphasised && WORDS.test(ownText)) {
        stray.push({ rule: 'wording', tag: element.tagName, className, text: ownText.slice(0, 120) })
      }
    }

    return { markers, stray }
  })
}

/**
 * Clicks through every exhibit that renders a verdict, auditing after each step, and
 * returns the union of the markers seen. No axe scanning here: a11y.spec.ts owns that,
 * and keeping this pass cheap is what makes it usable as its own blocking CI job.
 */
export async function renderEveryVerdict(page: Page): Promise<string[]> {
  const markers = new Set<string>()
  const stray: StrayVerdict[] = []

  const capture = async (label: string): Promise<void> => {
    const audit = await auditRenderedVerdicts(page)
    audit.markers.forEach((marker) => markers.add(marker))
    audit.stray.forEach((item) => stray.push({ ...item, text: `${label}: ${item.text}` }))
  }

  await page.goto('.')
  await capture('arrival')

  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await page.getByRole('button', { name: 'Add accepted report' }).click()
  await expect(page.locator('[data-aggregate]')).toBeVisible()
  await capture('protocol walkthrough')

  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  await expect(page.locator('[data-submitted-count]')).toHaveText('12')
  await capture('payroll')

  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Submit out-of-range report' }).click()
  await page.getByRole('button', { name: 'Flip proof share' }).click()
  await page.getByRole('button', { name: 'Replay a report' }).click()
  await page.getByLabel('Collude the aggregators').check()
  await expect(page.locator('[data-collusion-reconstructed]')).toBeVisible()
  await capture('break it')

  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  await page.getByRole('button', { name: 'Run valid-lie fixture' }).click()
  await page.getByRole('button', { name: 'Run one-report fixture' }).click()
  await expect(page.locator('[data-kat-all-match]')).toBeVisible()
  await capture('limits and vectors')

  expect(stray, `verdict wording or styling rendered outside a [data-verdict] marker:\n${JSON.stringify(stray, null, 2)}`).toEqual([])
  return [...markers].sort()
}
