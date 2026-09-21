import { expect, test } from '@playwright/test'
import {
  auditRenderedVerdicts,
  coverageViolations,
  driveEveryState,
  helperViolations,
  recordedMutations,
  testBody,
} from './verdict-audit'

test('every verdict and measurement the page renders has a recorded mutation, and every recorded mutation still renders', async ({ page }) => {
  const rendered = await driveEveryState(page)
  expect(rendered.verdicts.length, 'the walk rendered no verdict markers at all').toBeGreaterThan(0)
  expect(rendered.claims.length, 'the walk rendered no measurement markers at all').toBeGreaterThan(0)

  const recorded = recordedMutations()
  const verdicts = coverageViolations(rendered.verdicts, recorded.filter((entry) => entry.kind === 'verdict'))
  expect(verdicts.uncovered, `verdicts rendered with no §4.1c mutation in e2e/verdict-mutations.json: ${verdicts.uncovered.join(', ')}`).toEqual([])
  expect(verdicts.stale, `mutations recorded for verdicts the page no longer renders: ${verdicts.stale.join(', ')}`).toEqual([])

  const claims = coverageViolations(rendered.claims, recorded.filter((entry) => entry.kind === 'claim'))
  expect(claims.uncovered, `measurements rendered with no §4.1c mutation in e2e/verdict-mutations.json: ${claims.uncovered.join(', ')}`).toEqual([])
  expect(claims.stale, `mutations recorded for measurements the page no longer renders: ${claims.stale.join(', ')}`).toEqual([])
})

test('every recorded kill was checked against the marker state, not only its words', () => {
  const violations = helperViolations(recordedMutations())
  expect(violations, `recorded kills that assert text alone:\n${violations.join('\n')}`).toEqual([])
})

test('the coverage check catches a raw banner added outside a marker', async ({ page }) => {
  await page.goto('.')
  await expect(page.locator('#mechanism')).toContainText('A report begins')

  // Exactly what a careless builder adds later: verdict styling, verdict wording, no marker.
  await page.locator('#mechanism').evaluate((root) => {
    root.insertAdjacentHTML(
      'beforeend',
      '<div class="verdict pass"><span class="verdict-icon">OK</span><div><strong>VALID</strong><span>everything checks out</span></div></div>',
    )
  })
  const styled = await auditRenderedVerdicts(page)
  expect(styled.stray.some((item) => item.rule === 'styling')).toBe(true)
  expect(styled.stray.some((item) => item.rule === 'wording' && item.text.includes('VALID'))).toBe(true)

  // And the same banner with the house styling stripped off, which rule 1 alone would miss.
  await page.reload()
  await page.locator('#mechanism').evaluate((root) => {
    root.insertAdjacentHTML('beforeend', '<div><strong>ACCEPTED</strong></div>')
  })
  const bare = await auditRenderedVerdicts(page)
  expect(bare.stray.map((item) => item.rule)).toEqual(['wording'])
  expect(bare.stray[0].text).toContain('ACCEPTED')
})

test('the coverage check catches a raw measurement added outside a marker', async ({ page }) => {
  await page.goto('.')

  // A number carries none of the signals the banner rules look for: no verdict class and no
  // ALL-CAPS verdict word. It is the easier mistake to make, and it was invisible until now.
  await page.locator('#mechanism').evaluate((root) => {
    root.insertAdjacentHTML('beforeend', '<p><span>1,632 B</span></p><div class="tally-stat"><em>42</em></div>')
  })
  const raw = await auditRenderedVerdicts(page)
  expect(raw.stray.map((item) => item.rule)).toEqual(['measurement', 'measurement'])
  expect(raw.stray.map((item) => item.text)).toEqual(['1,632 B', '42'])

  // The same numbers inside a marker are claims, not strays.
  await page.reload()
  await page.locator('#mechanism').evaluate((root) => {
    root.insertAdjacentHTML('beforeend', '<p><span data-claim="demo-bytes" data-value="1632">1,632 B</span></p>')
  })
  const marked = await auditRenderedVerdicts(page)
  expect(marked.stray).toEqual([])
  expect(marked.claims).toContain('demo-bytes')
})

test('the coverage check catches a marker with no mutation behind it', () => {
  const recorded = recordedMutations()
  const verdicts = recorded.filter((entry) => entry.kind === 'verdict')
  const claims = recorded.filter((entry) => entry.kind === 'claim')

  const inventedVerdict = coverageViolations([...verdicts.map((entry) => entry.marker), 'freshly-invented-verdict'], verdicts)
  expect(inventedVerdict.uncovered).toEqual(['freshly-invented-verdict'])
  const inventedClaim = coverageViolations([...claims.map((entry) => entry.marker), 'freshly-invented-measurement'], claims)
  expect(inventedClaim.uncovered).toEqual(['freshly-invented-measurement'])

  const removed = coverageViolations(verdicts.slice(1).map((entry) => entry.marker), verdicts)
  expect(removed.stale).toEqual([verdicts[0].marker])
})

test('the coverage check catches a kill that only matched the words', () => {
  const recorded = recordedMutations()
  const preparation = { ...recorded[0], kind: 'verdict' as const, marker: 'preparation' }
  const textOnly = `
test('a text-only kill', async ({ page }) => {
  await expect(page.locator('[data-verdict="preparation"]')).toContainText('VALID')
})
`
  const sources = new Map([['claims.spec.ts', textOnly], ['verdicts.spec.ts', '']])
  expect(helperViolations([{ ...preparation, kills: 'claims.spec.ts - a text-only kill' }], sources))
    .toEqual([`preparation: "a text-only kill" never calls expectVerdict(page, 'preparation', …), so nothing checked this kill against the marker's state`])

  // A helper call in a DIFFERENT test is not this mutation's kill.
  const elsewhere = `
test('a text-only kill', async ({ page }) => {
  await expect(page.locator('[data-verdict="preparation"]')).toContainText('VALID')
})
test('somewhere else', async ({ page }) => {
  await expectVerdict(page, 'preparation', { text: 'VALID', state: 'pass' })
})
`
  expect(testBody(elsewhere, 'a text-only kill')).not.toContain('expectVerdict')
  expect(helperViolations(
    [{ ...preparation, kills: 'claims.spec.ts - a text-only kill' }],
    new Map([['claims.spec.ts', elsewhere], ['verdicts.spec.ts', '']]),
  )).toHaveLength(1)

  // And a mutation naming a test that no longer exists is a violation, not a pass.
  expect(helperViolations([{ ...preparation, kills: 'claims.spec.ts - a test that was renamed' }], sources))
    .toEqual(['preparation: claims.spec.ts has no test called "a test that was renamed"'])
})
