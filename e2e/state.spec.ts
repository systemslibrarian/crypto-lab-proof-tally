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

test('the four exhibit tabs retain keyboard selection semantics', async ({ page }) => {
  const protocol = page.getByRole('tab', { name: 'Protocol' })
  await protocol.focus()
  await protocol.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Distributed DP' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#panel-distributed')).toBeVisible()

  await page.getByRole('tab', { name: 'Distributed DP' }).press('End')
  await expect(page.getByRole('tab', { name: 'Limits & vectors' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Limits & vectors' }).press('Home')
  await expect(protocol).toHaveAttribute('aria-selected', 'true')
  await protocol.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Limits & vectors' })).toHaveAttribute('aria-selected', 'true')
})

test('changing a distributed scenario retires the prior batch and collector view', async ({ page }) => {
  await page.getByRole('tab', { name: 'Distributed DP' }).click()
  await page.getByRole('button', { name: 'Commit and release once' }).click()
  await expect(page.locator('.dp-collector')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request this batch again' })).toBeEnabled()

  await page.getByLabel('Participant scenario').selectOption('threshold')
  await expect(page.locator('#distributed-release-result')).toBeEmpty()
  await expect(page.locator('.dp-collector')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Request this batch again' })).toBeDisabled()
  await expect(page.locator('#distributed-status')).toContainText('separate teaching world')
  await expect(page.locator('#panel-distributed .scope-warning')).toContainText('outputs must not be combined')
})

test('changing the abort retry cap retires the exact ledger before recomputation', async ({ page }) => {
  await page.getByRole('tab', { name: 'Distributed DP' }).click()
  await page.getByRole('button', { name: 'Compute exact transcript' }).click()
  await expect(page.locator('#abort-model-result [data-claim="abort-retry-cap"]')).toHaveText('3 attempts')

  await page.getByLabel('Visible attempt cap').selectOption('2')
  await expect(page.locator('#abort-model-result')).toBeEmpty()
  await expect(page.locator('#abort-model-status')).toContainText('retired')

  await page.getByRole('button', { name: 'Compute exact transcript' }).click()
  await expect(page.locator('#abort-model-result [data-claim="abort-retry-cap"]')).toHaveText('2 attempts')
  await expect(page.locator('[data-abort-transcript-event]')).toHaveCount(5)
})
