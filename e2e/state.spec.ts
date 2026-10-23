import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('.')
})

test('empty or invalid input retires an actionable report', async ({ page }) => {
  const input = page.getByLabel('Salary measurement')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await expect(page.locator('#mechanism [data-verdict="preparation"]')).toBeVisible()

  await input.fill('')
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Combine verifier shares' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add accepted report' })).toBeDisabled()
  await expect(page.locator('#retirement-status')).toContainText('empty or invalid')

  await input.fill('125000')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await input.fill('-1')
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Combine verifier shares' })).toBeDisabled()
})

test('the displayed last payroll report is the report actually included in the tally', async ({ page }) => {
  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  const accepted = page.locator('[data-accepted-nonce]')
  await expect(accepted).toHaveCount(12)
  const displayedNonce = await page.locator('.report-origin').getAttribute('data-report-nonce')
  const talliedNonce = await accepted.last().getAttribute('data-accepted-nonce')
  expect(displayedNonce).toBeTruthy()
  expect(displayedNonce).toBe(talliedNonce)
})
