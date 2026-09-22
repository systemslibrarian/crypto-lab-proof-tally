import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectClaim, expectVerdict } from './verdict-audit'

const MODULUS = 18_446_744_069_414_584_321n

/** Stand-ins for the page's own renderers, so the oracle derives what it expects to read. */
function money(value: bigint): string {
  return `$${value.toLocaleString('en-US')}`
}

function fieldHex(value: bigint): string {
  let remaining = value
  let hex = ''
  for (let index = 0; index < 8; index += 1) {
    hex += (remaining & 0xffn).toString(16).padStart(2, '0')
    remaining >>= 8n
  }
  return hex
}

async function claimValue(page: Page, marker: string, nth = 0): Promise<bigint> {
  return BigInt(await page.locator(`[data-claim="${marker}"]`).nth(nth).getAttribute('data-value') ?? '')
}

async function claimValues(page: Page, marker: string): Promise<bigint[]> {
  return (await page.locator(`[data-claim="${marker}"]`).evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.value ?? ''))).map(BigInt)
}

async function attribute(locator: Locator, name: string): Promise<string> {
  return (await locator.getAttribute(name)) ?? ''
}

test.beforeEach(async ({ page }) => {
  await page.goto('.')
})

test('the displayed verifier shares add to the displayed combined verifier', async ({ page }) => {
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  const first = await claimValue(page, 'verifier-a')
  const second = await claimValue(page, 'verifier-b')
  const combined = await claimValue(page, 'combined-verifier')
  expect((first + second) % MODULUS).toBe(combined)

  // Each code is the Field64 encoding of the number the arithmetic above was done on.
  await expectClaim(page, 'verifier-a', { value: first, text: fieldHex(first) })
  await expectClaim(page, 'verifier-b', { value: second, text: fieldHex(second) })
  await expectClaim(page, 'combined-verifier', { value: combined, text: fieldHex(combined) })
})

test('the sharded envelopes render the measurement and both input shares', async ({ page }) => {
  await page.getByLabel('Salary measurement').fill('125000')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await expectClaim(page, 'report-measurement', { value: 125_000n, text: money(125_000n) })

  const leader = Number(await claimValue(page, 'leader-share'))
  const helper = Number(await claimValue(page, 'helper-share'))
  expect(leader, 'both aggregators hold the same number of Field64 elements').toBe(helper)
  expect(leader, 'a share longer than the three elements the code shows').toBeGreaterThan(3)

  // The code shows three encoded elements and says how many it left out; both halves of
  // that sentence have to agree with the length the test just read.
  await expectClaim(page, 'leader-share', { value: leader, text: `+${leader - 3} fields`, exact: false })
  await expectClaim(page, 'helper-share', { value: helper, text: `+${helper - 3} fields`, exact: false })
  const leaderText = await page.locator('[data-claim="leader-share"]').innerText()
  const helperText = await page.locator('[data-claim="helper-share"]').innerText()
  expect(leaderText.match(/\b[0-9a-f]{16}\b/g), 'three encoded elements are shown').toHaveLength(3)
  expect(leaderText, 'the two aggregators do not hold the same share').not.toBe(helperText)
})

test('the tally is independently recomputable from accepted values', async ({ page }) => {
  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  const values = await page.locator('[data-accepted-value]').evaluateAll((nodes) => nodes.map((node) => BigInt((node as HTMLElement).dataset.acceptedValue ?? '0')))
  const recomputed = values.reduce((sum, value) => sum + value, 0n)
  await expectClaim(page, 'protocol-aggregate', { value: recomputed, text: money(recomputed) })
  await expectClaim(page, 'plain-sum', { value: recomputed, text: money(recomputed) })

  const submitted = Number(await claimValue(page, 'submitted-count'))
  const accepted = Number(await claimValue(page, 'accepted-count'))
  const rejected = Number(await claimValue(page, 'rejected-count'))
  expect(accepted + rejected).toBe(submitted)
  expect(accepted).toBe(values.length)
  expect(submitted).toBe(12)
  await expectClaim(page, 'submitted-count', { value: submitted, text: String(submitted) })
  await expectClaim(page, 'accepted-count', { value: accepted, text: String(accepted) })
  await expectClaim(page, 'rejected-count', { value: rejected, text: String(rejected) })
})

test('the range rejection is outside the displayed bit width', async ({ page }) => {
  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Submit out-of-range report' }).click()
  const result = page.locator('[data-rejected-value]')
  const value = BigInt(await attribute(result, 'data-rejected-value'))
  const bits = BigInt(await attribute(result, 'data-bit-width'))
  expect(value).toBeGreaterThanOrEqual(2n ** bits)
  await expectVerdict(page, 'range-attack', { text: `REJECTED`, state: 'reject' })
  await expect(result).toContainText(`${value.toLocaleString('en-US')} ≥ 2^${bits}`)
  await expect(result).toContainText('combined verifier nonzero')
})

test('the KAT counter agrees with the rendered matching rows', async ({ page }) => {
  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  const count = Number(await claimValue(page, 'kat-count'))
  await expectClaim(page, 'kat-count', { value: count, text: `${count} official KAT checks` })
  await expect(page.locator('.kat-status.pass')).toHaveCount(count)
  await expect(page.locator('.kat-status.fail')).toHaveCount(0)
  await expectVerdict(page, 'kat-row', { text: Array.from({ length: count }, () => 'MATCH'), state: 'pass' })
})

test('changing an input retires a verdict while a no-op preserves it', async ({ page }) => {
  const input = page.getByLabel('Salary measurement')
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(1)
  await input.fill('125000')
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(1)
  await expect(page.locator('#retirement-status')).not.toContainText('retired')
  await input.fill('125001')
  await expect(page.locator('#mechanism [data-verdict]')).toHaveCount(0)
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

  // The totals are checked against the rows the page rendered, summed — never against one
  // row multiplied by the number of rows.
  const reported = await claimValues(page, 'lie-row-reported')
  const sealed = await claimValues(page, 'lie-row-sealed')
  expect(reported.length).toBe(sealed.length)
  expect(reported.length).toBeGreaterThan(1)
  const aggregate = reported.reduce((sum, value) => sum + value, 0n)
  const truth = sealed.reduce((sum, value) => sum + value, 0n)
  expect(aggregate).not.toBe(truth)

  await expectClaim(page, 'lie-row-reported', { value: reported, text: reported.map((value) => `reported ${money(value)}`) })
  await expectClaim(page, 'lie-row-sealed', { value: sealed, text: sealed.map((value) => `sealed ${money(value)}`) })
  await expectClaim(page, 'lie-aggregate', { value: aggregate, text: money(aggregate) })
  await expectClaim(page, 'lie-truth', { value: truth, text: money(truth) })
  await expectVerdict(page, 'valid-lie-row', { text: reported.map(() => 'VALID'), state: 'pass' })
  await expectVerdict(page, 'valid-lie', { text: 'VALID - AND FALSE', state: 'alarm' })
  await expect(page.locator('[data-negative-lie]')).toContainText('cannot check that a report is true')
})

test('one accepted report exposes itself through the aggregate', async ({ page }) => {
  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  await page.getByRole('button', { name: 'Run one-report fixture' }).click()
  const input = await claimValue(page, 'single-input')
  const aggregate = await claimValue(page, 'single-aggregate')
  expect(aggregate).toBe(input)
  await expectClaim(page, 'single-input', { value: input, text: money(input) })
  await expectClaim(page, 'single-aggregate', { value: aggregate, text: money(aggregate) })
  await expectVerdict(page, 'single-report', { text: 'SHARES PRIVATE - AND THE TOTAL IS THE INPUT', state: 'alarm' })
  await expect(page.locator('[data-negative-single]')).toContainText('does not provide differential privacy')
})

test('a replayed report re-verifies and only the intake registry stops it', async ({ page }) => {
  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Replay a report' }).click()
  const result = page.locator('[data-replay]')
  await expect(result).toHaveAttribute('data-first-admitted', 'true')
  await expect(result).toHaveAttribute('data-vdaf-replay-accepted', 'true')
  await expect(result).toHaveAttribute('data-guard-admitted', 'false')

  // The tally must be the sum of the contributions the page rendered, with the number of
  // terms taken from what was rendered rather than from a literal 2.
  //
  // What that does NOT establish: the exhibit submits one report twice, so its two
  // contributions are equal, and summing two equal terms is identical to doubling one. This
  // oracle cannot tell those apart and neither can any other written against this page. It
  // kills a page that aggregates only the first submission, and it keeps the literal out of
  // the spec. The rendered sentence is worded to claim only that much.
  const contributions = await claimValues(page, 'replay-contribution')
  expect(contributions, 'one contribution per submission preparation accepted').toHaveLength(2)
  const total = await claimValue(page, 'replay-total')
  expect(total).toBe(contributions.reduce((sum, value) => sum + value, 0n))
  await expectClaim(page, 'replay-contribution', { value: contributions, text: contributions.map(money) })
  await expectClaim(page, 'replay-total', { value: total, text: money(total) })

  await expectVerdict(page, 'replay-vdaf', { text: 'PREPARATION ACCEPTED IT AGAIN', state: 'alarm' })
  await expectVerdict(page, 'replay-intake', { text: 'REJECTED BY INTAKE', state: 'reject' })
})

test('the preparation verdict follows the displayed combined verifier', async ({ page }) => {
  await page.getByRole('button', { name: 'Shard report' }).click()
  await page.getByRole('button', { name: 'Combine verifier shares' }).click()
  const combined = await claimValue(page, 'combined-verifier')
  await expectVerdict(page, 'preparation', combined === 0n
    ? { text: 'VALID', state: 'pass' }
    : { text: 'REJECTED', state: 'reject' })
})

test('the tally match word follows the two displayed totals', async ({ page }) => {
  await page.getByRole('button', { name: 'Load 12-person payroll' }).click()
  const aggregate = await claimValue(page, 'protocol-aggregate')
  const plainSum = await claimValue(page, 'plain-sum')
  await expectVerdict(page, 'tally-match', aggregate === plainSum
    ? { text: ['=', 'MATCH: Field64 byte equality'], state: 'pass' }
    : { text: ['!=', 'MISMATCH'], state: 'reject' })
})

test('a flipped proof share fails the gadget-consistency check', async ({ page }) => {
  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByRole('button', { name: 'Flip proof share' }).click()
  const result = page.locator('[data-tamper-cause]')
  await expect(result).toHaveAttribute('data-tamper-cause', 'gadget consistency failed')
  await expectVerdict(page, 'tamper-attack', { text: 'REJECTED', state: 'reject' })
})

test('colluding aggregators reconstruct the input that was sharded', async ({ page }) => {
  await page.getByRole('tab', { name: 'Break it' }).click()
  await page.getByLabel('Collude the aggregators').check()
  const reveal = page.locator('[data-collusion-input]')
  const input = BigInt(await attribute(reveal, 'data-collusion-input'))
  const reconstructed = BigInt(await attribute(reveal, 'data-collusion-reconstructed'))
  expect(reconstructed).toBe(input)
  await expectVerdict(page, 'collusion', { text: 'BROKEN: INPUT REVEALED', state: 'alarm' })

  const shareA = Number(await claimValue(page, 'collusion-share-a'))
  const shareB = Number(await claimValue(page, 'collusion-share-b'))
  expect(shareA, 'the two desks hold equally long shares').toBe(shareB)
  await expectClaim(page, 'collusion-share-a', { value: shareA, text: `A: `, exact: false })
  await expectClaim(page, 'collusion-share-a', { value: shareA, text: `+${shareA - 3} fields`, exact: false })
  await expectClaim(page, 'collusion-share-b', { value: shareB, text: `+${shareB - 3} fields`, exact: false })
})

test('the KAT summary word follows the rendered rows', async ({ page }) => {
  await page.getByRole('tab', { name: 'Limits & vectors' }).click()
  const rows = await page.locator('[data-verdict="kat-row"]').allInnerTexts()
  expect(rows.length).toBeGreaterThan(0)
  const everyRowMatched = rows.every((row) => row.trim() === 'MATCH')
  await expectVerdict(page, 'kat-summary', everyRowMatched
    ? { text: 'ALL MATCH', state: 'pass' }
    : { text: 'MISMATCH', state: 'reject' })
})
