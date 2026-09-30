import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { auditContrast, formatContrastFailures } from './contrast'
import { NONTEXT_BASELINE } from './nontext-baseline'
import { auditNonText } from './nontext'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
export const NARROW = { width: 380, height: 800 }

export function watchPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  return errors
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().filter((animation) => animation.playState === 'running').length === 0, undefined, { polling: 'raf' })
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(overflow.width, `no horizontal document overflow in ${label}`).toBeLessThanOrEqual(overflow.viewport + 1)
}

async function scan(page: Page, label: string): Promise<void> {
  await settle(page)
  await expectNoHorizontalOverflow(page, label)
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(axe.violations, `axe violations in ${label}: ${JSON.stringify(axe.violations, null, 2)}`).toEqual([])
  expect(axe.incomplete, `axe incomplete results in ${label}: ${JSON.stringify(axe.incomplete, null, 2)}`).toEqual([])
  const contrast = await auditContrast(page)
  expect(contrast, `computed text contrast in ${label}:\n${formatContrastFailures(contrast)}`).toEqual([])
  const nontext = await auditNonText(page)
  expect(nontext, `computed non-text contrast in ${label}: ${JSON.stringify(nontext, null, 2)}`).toEqual(NONTEXT_BASELINE)
}

export async function boot(page: Page): Promise<void> {
  page.setDefaultTimeout(20_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('.')
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('main')).toHaveCount(1)
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('[role="banner"]')).toHaveCount(1)
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app')
  await expect(page.locator('#mechanism')).toContainText('A report begins')
  await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1)
}

export async function driveAllStates(page: Page, viewportLabel: string): Promise<void> {
  await scan(page, `${viewportLabel}: arrival`)

  await page.getByRole('button', { name: 'Shard report' }).click()
  await expect(page.locator('.envelope')).toHaveCount(2)
  await scan(page, `${viewportLabel}: sharded`)

  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await expect(page.locator('[data-verdict="preparation"]')).toBeVisible()
  await scan(page, `${viewportLabel}: prepared`)

  await page.getByRole('button', { name: 'Add accepted report' }).click()
  await expect(page.locator('[data-claim="protocol-aggregate"]')).toContainText('$125,000')
  await scan(page, `${viewportLabel}: collected`)

  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  await expect(page.locator('[data-claim="submitted-count"]')).toHaveText('12')
  await scan(page, `${viewportLabel}: payroll`)

  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Submit out-of-range report' }).click()
  await page.getByRole('button', { name: 'Flip proof share' }).click()
  await page.getByRole('button', { name: 'Replay a report' }).click()
  await page.getByLabel('Collude the aggregators').check()
  await expect(page.locator('[data-verdict="collusion"]')).toBeVisible()
  await scan(page, `${viewportLabel}: attacks and collusion`)

  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  await page.getByRole('button', { name: 'Run valid-lie fixture' }).click()
  await page.getByRole('button', { name: 'Run one-report fixture' }).click()
  await page.getByText('Protocol scope and extension seams').click()
  await expect(page.locator('[data-verdict="valid-lie"]')).toBeVisible()
  await scan(page, `${viewportLabel}: negative claims and vectors`)
}