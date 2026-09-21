import { expect, test } from '@playwright/test'
import {
  auditRenderedVerdicts,
  coverageViolations,
  recordedMutations,
  renderEveryVerdict,
} from './verdict-audit'

test('every verdict the page renders has a recorded mutation, and every recorded mutation still renders', async ({ page }) => {
  const rendered = await renderEveryVerdict(page)
  expect(rendered.length, 'the walk rendered no verdict markers at all').toBeGreaterThan(0)

  const { uncovered, stale } = coverageViolations(rendered, recordedMutations())
  expect(uncovered, `markers rendered with no §4.1c mutation in e2e/verdict-mutations.json: ${uncovered.join(', ')}`).toEqual([])
  expect(stale, `mutations recorded for markers the page no longer renders: ${stale.join(', ')}`).toEqual([])
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

test('the coverage check catches a marker with no mutation behind it', async () => {
  const recorded = recordedMutations()
  const invented = coverageViolations([...recorded.map((entry) => entry.marker), 'freshly-invented-verdict'], recorded)
  expect(invented.uncovered).toEqual(['freshly-invented-verdict'])

  const removed = coverageViolations(recorded.slice(1).map((entry) => entry.marker), recorded)
  expect(removed.stale).toEqual([recorded[0].marker])
})
