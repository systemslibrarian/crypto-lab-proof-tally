import { expect, test } from '@playwright/test'
import { boot, driveAllStates, NARROW, watchPageErrors } from './gate'

test('zero WCAG 2.1 A/AA findings across every exhibit', async ({ page }) => {
  const errors = watchPageErrors(page)
  await boot(page)
  await driveAllStates(page, 'desktop')
  expect(errors, errors.join('\n')).toEqual([])
})

test('zero WCAG 2.1 A/AA findings at 380px', async ({ page }) => {
  const errors = watchPageErrors(page)
  await page.setViewportSize(NARROW)
  await boot(page)
  await driveAllStates(page, '380px')
  expect(errors, errors.join('\n')).toEqual([])
})