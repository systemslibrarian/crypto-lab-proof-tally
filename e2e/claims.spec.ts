import { expect, test } from '@playwright/test'

const MODULUS = 18_446_744_069_414_584_321n

test.beforeEach(async ({ page }) => {
  await page.goto('.')
})

test('the displayed verifier shares add to the displayed combined verifier', async ({ page }) => {
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  const first = BigInt(await page.locator('[data-verifier-a]').getAttribute('data-verifier-a') ?? '')
  const second = BigInt(await page.locator('[data-verifier-b]').getAttribute('data-verifier-b') ?? '')
  const combined = BigInt(await page.locator('[data-combined-verifier]').getAttribute('data-combined-verifier') ?? '')
  expect((first + second) % MODULUS).toBe(combined)
})

test('the tally is independently recomputable from accepted values', async ({ page }) => {
  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  const values = await page.locator('[data-accepted-value]').evaluateAll((nodes) => nodes.map((node) => BigInt((node as HTMLElement).dataset.acceptedValue ?? '0')))
  const recomputed = values.reduce((sum, value) => sum + value, 0n)
  const aggregate = BigInt(await page.locator('[data-aggregate]').getAttribute('data-aggregate') ?? '')
  const submitted = Number(await page.locator('[data-submitted-count]').getAttribute('data-submitted-count'))
  const accepted = Number(await page.locator('[data-accepted-count]').getAttribute('data-accepted-count'))
  const rejected = Number(await page.locator('[data-rejected-count]').getAttribute('data-rejected-count'))
  expect(recomputed).toBe(aggregate)
  expect(accepted + rejected).toBe(submitted)
  expect(submitted).toBe(12)
})

test('the range rejection is outside the displayed bit width', async ({ page }) => {
  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Submit out-of-range report' }).click()
  const result = page.locator('[data-rejected-value]')
  const value = BigInt(await result.getAttribute('data-rejected-value') ?? '')
  const bits = BigInt(await result.getAttribute('data-bit-width') ?? '')
  expect(value).toBeGreaterThanOrEqual(2n ** bits)
  await expect(result).toContainText('REJECTED')
  await expect(result).toContainText('combined verifier nonzero')
})

test('the KAT counter agrees with the rendered matching rows', async ({ page }) => {
  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  const count = Number(await page.locator('[data-kat-count]').getAttribute('data-kat-count'))
  await expect(page.locator('.kat-status.pass')).toHaveCount(count)
  await expect(page.locator('.kat-status.fail')).toHaveCount(0)
})

test('changing an input retires a verdict while a no-op preserves it', async ({ page }) => {
  const input = page.getByLabel('Salary measurement')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await expect(page.locator('#mechanism .verdict')).toContainText('VALID')
  await input.fill('125000')
  await expect(page.locator('#mechanism .verdict')).toContainText('VALID')
  await expect(page.locator('#retirement-status')).not.toContainText('retired')
  await input.fill('125001')
  await expect(page.locator('#mechanism .verdict')).toHaveCount(0)
  await expect(page.locator('#retirement-status')).toContainText('retired')
})

test('hidden panels remain unpainted until their real tabs are selected', async ({ page }) => {
  await expect(page.locator('#panel-break')).toBeHidden()
  await expect(page.locator('#panel-limits')).toBeHidden()
  await page.getByRole('tab', { name: 'Break it' }).click()
  await expect(page.locator('#panel-break')).toBeVisible()
  await expect(page.locator('#panel-protocol')).toBeHidden()
})

test('a well-formed lie passes every check and still changes the truth', async ({ page }) => {
  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  await page.getByRole('button', { name: 'Run valid-lie fixture' }).click()
  const fixture = page.locator('[data-negative-lie]')
  await expect(fixture.locator('.valid-word')).toHaveCount(3)
  await expect(fixture.locator('.valid-word')).toHaveText(['VALID', 'VALID', 'VALID'])
  const aggregate = BigInt(await fixture.locator('[data-lie-aggregate]').getAttribute('data-lie-aggregate') ?? '')
  const truth = BigInt(await fixture.locator('[data-lie-truth]').getAttribute('data-lie-truth') ?? '')
  expect(aggregate).not.toBe(truth)
  await expect(fixture).toContainText('cannot check that a report is true')
  await expect(fixture).toContainText('VALID - AND FALSE')
})

test('one accepted report exposes itself through the aggregate', async ({ page }) => {
  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  await page.getByRole('button', { name: 'Run one-report fixture' }).click()
  const fixture = page.locator('[data-negative-single]')
  const input = BigInt(await fixture.locator('[data-single-input]').getAttribute('data-single-input') ?? '')
  const aggregate = BigInt(await fixture.locator('[data-single-aggregate]').getAttribute('data-single-aggregate') ?? '')
  expect(aggregate).toBe(input)
  await expect(fixture).toContainText('does not provide differential privacy')
  await expect(fixture).toContainText('SHARES PRIVATE - AND THE TOTAL IS THE INPUT')
})

test('a replayed report re-verifies and only the intake registry stops it', async ({ page }) => {
  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Replay a report' }).click()
  const result = page.locator('[data-replay]')
  await expect(result).toHaveAttribute('data-first-admitted', 'true')
  await expect(result).toHaveAttribute('data-vdaf-replay-accepted', 'true')
  await expect(result).toHaveAttribute('data-guard-admitted', 'false')
  const single = BigInt(await result.getAttribute('data-single-aggregate') ?? '')
  const doubled = BigInt(await result.getAttribute('data-replayed-aggregate') ?? '')
  expect(doubled).toBe(single * 2n)
  await expect(result).toContainText('PREPARATION ACCEPTED IT AGAIN')
  await expect(result).toContainText('REJECTED BY INTAKE')
})
