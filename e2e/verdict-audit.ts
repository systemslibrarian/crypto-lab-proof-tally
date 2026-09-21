import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

/**
 * Coverage is derived from the rendered page, never from a list an author keeps by hand.
 *
 * Four rules are enforced here:
 *
 *  1. every `[data-verdict]` marker the page actually renders must have a recorded
 *     §4.1c mutation in verdict-mutations.json, and every recorded mutation must
 *     still correspond to a marker the page renders;
 *  2. every `[data-claim]` measurement marker is in that same loop on the same terms. A
 *     rendered number is a claim like any other: a new measurement that ships with no
 *     mutation behind it fails the build, and a record naming a claim the page no longer
 *     renders fails too;
 *  3. verdict wording, verdict styling, or a MEASUREMENT rendered OUTSIDE a marker is a
 *     failure — that is what catches a raw banner, or a raw number, added later by someone
 *     who never read this file. A number is the easier mistake to make, because a number
 *     does not look like a claim;
 *  4. every recorded mutation's killing test must go through expectVerdict()/expectClaim(),
 *     which assert a marker's rendered text and its machine-readable state in ONE call.
 *     A test that only matched the words would let a mutation flip the sentence while the
 *     pass paint stayed, and be recorded as a kill for a marker that still claims pass in
 *     every way a reader can see except one.
 *
 * The denominator for rules 1-3 is driveEveryState(), which visits every option of every
 * control that changes what renders. A state the walk never reaches is outside every rule
 * above, however carefully the rules themselves are written.
 */

export type VerdictState = 'pass' | 'reject' | 'alarm'

export interface RecordedMutation {
  marker: string
  kind: 'verdict' | 'claim'
  file: string
  find: string
  replace: string
  kills: string
}

export interface StrayVerdict {
  rule: 'styling' | 'wording' | 'measurement'
  tag: string
  className: string
  text: string
}

export interface RenderedMarkers {
  verdicts: string[]
  claims: string[]
}

const REGISTRY_PATH = fileURLToPath(new URL('./verdict-mutations.json', import.meta.url))
const SPEC_DIRECTORY = fileURLToPath(new URL('./', import.meta.url))

/** Class tokens that paint each state. A marker must carry one of its own and none of another's. */
export const STATE_TOKENS: Record<VerdictState, readonly string[]> = {
  pass: ['pass'],
  reject: ['reject', 'fail', 'mismatch'],
  alarm: ['alarm'],
}

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

/** The body of one `test('<title>', …)` block, up to the next top-level test. */
export function testBody(source: string, title: string): string | undefined {
  for (const quote of ["'", '"', '`']) {
    const opening = source.indexOf(`test(${quote}${title}${quote}`)
    if (opening === -1) continue
    const next = source.indexOf('\ntest(', opening + 1)
    return source.slice(opening, next === -1 ? source.length : next)
  }
  return undefined
}

function splitKills(kills: string): [string, string] {
  const separator = kills.indexOf(' - ')
  if (separator === -1) throw new Error(`kills must read "<spec file> - <test title>": ${kills}`)
  return [kills.slice(0, separator).trim(), kills.slice(separator + 3).trim()]
}

export function specSources(): Map<string, string> {
  return new Map(['claims.spec.ts', 'verdicts.spec.ts'].map((name) => [name, readFileSync(`${SPEC_DIRECTORY}${name}`, 'utf8')]))
}

/**
 * A recorded kill is only evidence if the test named in `kills` asserts that marker's text
 * and its state together. This reads the named test's own body: a mention elsewhere in the
 * file is not an assertion, and an assertion in another test is not this mutation's kill.
 */
export function helperViolations(
  recorded: readonly RecordedMutation[],
  sources: ReadonlyMap<string, string> = specSources(),
): string[] {
  const violations: string[] = []
  for (const entry of recorded) {
    const [file, title] = splitKills(entry.kills)
    const source = sources.get(file)
    if (source === undefined) {
      violations.push(`${entry.marker}: kills names ${file}, which is not one of ${[...sources.keys()].join(', ')}`)
      continue
    }
    const body = testBody(source, title)
    if (body === undefined) {
      violations.push(`${entry.marker}: ${file} has no test called ${JSON.stringify(title)}`)
      continue
    }
    const helper = entry.kind === 'verdict' ? 'expectVerdict' : 'expectClaim'
    if (!body.includes(`${helper}(page, '${entry.marker}'`)) {
      violations.push(`${entry.marker}: ${JSON.stringify(title)} never calls ${helper}(page, '${entry.marker}', …), so nothing checked this kill against the marker's state`)
    }
  }
  return violations
}

/** Every marker currently in the DOM, and every verdict or measurement rendered outside one. */
export async function auditRenderedVerdicts(page: Page): Promise<RenderedMarkers & { stray: StrayVerdict[] }> {
  return page.evaluate(() => {
    const WORDS = /\b(VALID|REJECTED|ACCEPTED|ADMITTED|REFUSED|MATCH|MISMATCH|BROKEN|FORGED|PASSED|FAILED|SAFE|UNSAFE|SECURE|INSECURE|OK)\b/
    const STYLING = '.verdict, .verdict-icon, .valid-word, .kat-status, .kat-verdict, .byte-match'
    const EMPHASIS = new Set(['STRONG', 'B', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
    const CARRIER = /verdict|status|result|banner|word|outcome/i

    // A measurement is a claim even though it does not look like one. Inside the regions
    // this page paints results into, a digit-plus-unit run or a bare number must sit inside
    // a marker. Content hidden from assistive technology is exempt: it makes no claim to a
    // reader, and the only such text here is the decorative stage numeral.
    // The digits must not continue a word: "Prio3 checks" is a product name, not 3 checks.
    const UNITS = /(?<![A-Za-z])\d[\d,.]*\s*(?:B|KB|MB|bits?|bytes?|ops?|operations?|fields?|shares?|reports?|checks?|ms|s|×|x)\b/i
    const BARE = /^\$?\d[\d,]*(?:\.\d+)?$/
    const RESULT_REGIONS = '#mechanism, #tally-output, #range-result, #tamper-result, #nonce-result, #collusion-result, #lie-result, #single-result, #kat-panel'

    const verdicts: string[] = []
    const claims: string[] = []
    const stray: { rule: 'styling' | 'wording' | 'measurement'; tag: string; className: string; text: string }[] = []

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const marker = element.dataset.verdict
      if (marker !== undefined) verdicts.push(marker)
      const measurement = element.dataset.claim
      if (measurement !== undefined) claims.push(measurement)
      if (element.closest('[data-verdict], [data-claim]')) continue

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
      if (ownText === '') continue

      const emphasised = EMPHASIS.has(element.tagName) || CARRIER.test(className)
      if (emphasised && WORDS.test(ownText)) {
        stray.push({ rule: 'wording', tag: element.tagName, className, text: ownText.slice(0, 120) })
        continue
      }
      if (!element.closest(RESULT_REGIONS) || element.closest('[aria-hidden="true"]')) continue
      if (BARE.test(ownText) || UNITS.test(ownText)) {
        stray.push({ rule: 'measurement', tag: element.tagName, className, text: ownText.slice(0, 120) })
      }
    }

    return { verdicts, claims, stray }
  })
}

/**
 * Asserts a verdict's text and its state in ONE call. `data-result` is the machine-readable
 * half of the claim and the class token is the painted half, so a mutation has to flip all
 * of it — not just the sentence — before this passes.
 */
export async function expectVerdict(
  page: Page,
  marker: string,
  expected: { text: string | readonly string[]; state: VerdictState },
): Promise<void> {
  const nodes = page.locator(`[data-verdict="${marker}"]`)
  const texts = Array.isArray(expected.text) ? (expected.text as readonly string[]) : undefined
  const count = await nodes.count()
  expect(count, `[data-verdict="${marker}"] is not rendered`).toBeGreaterThan(0)
  if (texts) expect(count, `[data-verdict="${marker}"] elements`).toBe(texts.length)

  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index)
    const where = `${marker}[${index}]`
    await expect(node, `${where} text`).toContainText(texts ? texts[index] : (expected.text as string))
    await expect(node, `${where} data-result`).toHaveAttribute('data-result', expected.state)
    const tokens = ((await node.getAttribute('class')) ?? '').split(/\s+/).filter(Boolean)
    const own = tokens.filter((token) => STATE_TOKENS[expected.state].includes(token))
    expect(own, `${where} must paint ${expected.state}; class="${tokens.join(' ')}"`).not.toEqual([])
    const foreign = (Object.keys(STATE_TOKENS) as VerdictState[])
      .filter((state) => state !== expected.state)
      .flatMap((state) => STATE_TOKENS[state])
      .filter((token) => tokens.includes(token))
    expect(foreign, `${where} says ${expected.state} but still paints ${foreign.join(', ')}`).toEqual([])
  }
}

/**
 * Asserts a measurement's rendered text and its machine-readable `data-value` in ONE call.
 * Tests read attributes; readers read text. Checking only the attribute would let the page
 * print one number and hand the oracle another.
 */
export async function expectClaim(
  page: Page,
  marker: string,
  expected: {
    value: bigint | number | string | readonly (bigint | number | string)[]
    text: string | readonly string[]
    exact?: boolean
  },
): Promise<void> {
  const nodes = page.locator(`[data-claim="${marker}"]`)
  const values = Array.isArray(expected.value) ? (expected.value as readonly (bigint | number | string)[]) : undefined
  const texts = Array.isArray(expected.text) ? (expected.text as readonly string[]) : undefined
  const count = await nodes.count()
  expect(count, `[data-claim="${marker}"] is not rendered`).toBeGreaterThan(0)
  if (values) expect(count, `[data-claim="${marker}"] elements`).toBe(values.length)
  if (texts) expect(count, `[data-claim="${marker}"] elements`).toBe(texts.length)

  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index)
    const where = `${marker}[${index}]`
    const value = String(values ? values[index] : (expected.value as bigint | number | string))
    const text = texts ? texts[index] : (expected.text as string)
    await expect(node, `${where} data-value`).toHaveAttribute('data-value', value)
    if (expected.exact === false) await expect(node, `${where} text`).toContainText(text)
    else await expect(node, `${where} text`).toHaveText(text)
  }
}

/** Reads this page's controls off the rendered page, rather than trusting a list in a spec. */
export async function controlOptions(page: Page): Promise<{ modes: string[]; tabs: string[] }> {
  return {
    modes: await page.locator('[data-mode]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.mode ?? '')),
    tabs: await page.locator('[role="tab"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.panel ?? '')),
  }
}

/**
 * Drives every option of every control that changes what this page renders, auditing after
 * each step, and returns the union of the markers seen. Per control, not the cross-product:
 * what the marker rules need is that no renderable state is unreachable by the walk, which
 * is a different question from interaction coverage.
 *
 * The controls, and every option of each:
 *
 *  - measurement type (`[data-mode]`): Prio3Sum and Prio3Count. The mode changes the label,
 *    the input's range, and whether the tally renders money or a bare count;
 *  - the measurement (`#measurement`): re-entered unchanged (the verdict is preserved),
 *    changed (the verdict is retired), and empty (sharding is refused with a range error);
 *  - shard / combine / add and the payroll button: all four rail stages, and both the empty
 *    and the populated tally;
 *  - the exhibit tabs: all three panels;
 *  - the three attack buttons and both fixture buttons;
 *  - the collusion checkbox: checked and unchecked, since unchecking re-renders.
 *
 * Skipped, with the reason: the tab list's arrow/Home/End keys select the same three panels
 * the clicks already visit, and the `<details>` in the limits panel toggles the visibility
 * of markup that is in the DOM either way — neither reaches a state this walk misses.
 *
 * No axe scanning here: a11y.spec.ts owns that, and keeping this pass cheap is what makes
 * it usable as its own blocking CI job.
 */
export async function driveEveryState(page: Page): Promise<RenderedMarkers> {
  const verdicts = new Set<string>()
  const claims = new Set<string>()
  const stray: StrayVerdict[] = []

  const capture = async (label: string): Promise<void> => {
    const audit = await auditRenderedVerdicts(page)
    audit.verdicts.forEach((marker) => verdicts.add(marker))
    audit.claims.forEach((marker) => claims.add(marker))
    audit.stray.forEach((item) => stray.push({ ...item, text: `${label}: ${item.text}` }))
  }

  await page.goto('.')
  await capture('arrival')

  const controls = await controlOptions(page)
  expect(controls.modes, 'the measurement-type options this walk was written for').toEqual(['sum', 'count'])
  expect(controls.tabs, 'the exhibit tabs this walk was written for').toEqual(['protocol', 'break', 'limits'])

  const measurement = page.getByLabel('Salary measurement')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await page.getByRole('button', { name: 'Add accepted report' }).click()
  await expect(page.locator('[data-claim="protocol-aggregate"]')).toBeVisible()
  await capture('protocol walkthrough')

  // The measurement input: a no-op keeps the verdict, a change retires it, and an empty
  // field is refused before anything is sharded.
  await measurement.fill('125000')
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(1)
  await capture('measurement re-entered unchanged')
  await measurement.fill('125001')
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(0)
  await capture('measurement changed, verdict retired')
  await measurement.fill('')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await expect(page.locator('#retirement-status')).toContainText('Enter an integer')
  await capture('measurement empty')

  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  await expect(page.locator('[data-claim="submitted-count"]')).toHaveText('12')
  await capture('payroll')

  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Submit out-of-range report' }).click()
  await page.getByRole('button', { name: 'Flip proof share' }).click()
  await page.getByRole('button', { name: 'Replay a report' }).click()
  await page.getByLabel('Collude the aggregators').check()
  await expect(page.locator('[data-verdict="collusion"]')).toBeVisible()
  await capture('break it')

  await page.getByLabel('Collude the aggregators').uncheck()
  await expect(page.locator('#collusion-result')).toContainText('separate desks')
  await capture('collusion switched back off')

  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  await page.getByRole('button', { name: 'Run valid-lie fixture' }).click()
  await page.getByRole('button', { name: 'Run one-report fixture' }).click()
  await expect(page.locator('[data-verdict="kat-summary"]')).toBeVisible()
  await capture('limits and vectors')

  // Prio3Count is the other measurement type: it renders a bare count where Prio3Sum
  // renders money, so the tally's numbers come from a branch the walk above never took.
  await page.getByRole('tab', { name: 'Protocol' }).click()
  await page.getByRole('button', { name: 'Prio3Count' }).click()
  await expect(page.getByLabel('Count measurement')).toHaveValue('1')
  await capture('count mode selected')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await page.getByRole('button', { name: 'Add accepted report' }).click()
  await expect(page.locator('[data-claim="protocol-aggregate"]')).toHaveText('1')
  await capture('count mode collected')

  expect(stray, `verdict wording, verdict styling, or a measurement rendered outside a marker:\n${JSON.stringify(stray, null, 2)}`).toEqual([])
  return { verdicts: [...verdicts].sort(), claims: [...claims].sort() }
}
