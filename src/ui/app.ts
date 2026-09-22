import { collude } from '../attack/collude'
import { VALID_LIE_FIXTURE } from '../attack/lie'
import { encodeField64, type Field64 } from '../field/field64'
import { SumCircuit } from '../flp/circuit'
import { aggregateOutputShares, unshard } from '../prio3/aggregate'
import { tamperProofShare, type Prio3 } from '../prio3/core'
import { createPrio3Count, createPrio3Sum } from '../prio3/instances'
import { NonceRegistry } from '../prio3/replay'
import type { PreparationTrace, Report } from '../prio3/types'

type Mode = 'sum' | 'count'
type Panel = 'protocol' | 'break' | 'limits'

interface ActiveReport {
  mode: Mode
  measurement: bigint
  report: Report
  trace?: PreparationTrace
  added: boolean
}

interface TallyRecord {
  reported: bigint
  truth: bigint
  trace: PreparationTrace
}

const SUM_MAXIMUM = 16_777_215n
const CONTEXT = new TextEncoder().encode('proof-tally/2026-08-14')
const VERIFY_KEY = Uint8Array.from({ length: 32 }, (_, index) => index)
const VECTOR_CONTEXT = hex('736f6d65206170706c69636174696f6e')
const VECTOR_NONCE = Uint8Array.from({ length: 16 }, (_, index) => index)
const VECTOR_RANDOMNESS = Uint8Array.from({ length: 64 }, (_, index) => index)

const SYNTHETIC_PAYROLL = [
  ['Avery', 84_200n], ['Blair', 91_750n], ['Cameron', 76_300n], ['Devon', 108_400n],
  ['Ellis', 88_750n], ['Frankie', 95_600n], ['Gray', 112_300n], ['Harper', 79_900n],
  ['Indigo', 101_250n], ['Jordan', 93_400n], ['Kai', 86_500n], ['Lane', 119_800n],
] as const

let mode: Mode = 'sum'
let activeReport: ActiveReport | undefined
let records: TallyRecord[] = []

/**
 * An accepted preparation always carries both output shares (src/prio3/core.ts). This
 * is an invariant, not an outcome: it has no verdict, and a violation is a bug that
 * must throw rather than be painted as a result the exhibit computed.
 */
function requireOutputShares(trace: PreparationTrace, label: string): [Field64[], Field64[]] {
  if (!trace.outputShares) throw new Error(`${label}: an accepted preparation produced no output shares`)
  return trace.outputShares
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing required element: ${selector}`)
  return found
}

function protocolFor(selectedMode: Mode): Prio3 {
  return selectedMode === 'sum' ? createPrio3Sum(SUM_MAXIMUM) : createPrio3Count()
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fieldHex(value: Field64): string {
  return toHex(encodeField64(value))
}

function compactFields(values: readonly Field64[]): string {
  const shown = values.slice(0, 3).map(fieldHex).join(' ')
  return values.length > 3 ? `${shown} +${values.length - 3} fields` : shown
}

function money(value: bigint): string {
  return `$${value.toLocaleString('en-US')}`
}

function setRail(stage: number): void {
  document.querySelectorAll<HTMLElement>('[data-rail]').forEach((item) => {
    item.classList.toggle('active', Number(item.dataset.rail) <= stage)
  })
}

/**
 * Renders one outcome. `marker` is the verdict's identity in the DOM: e2e/verdicts.spec.ts
 * walks the rendered page, requires every marker it finds to have a recorded §4.1c mutation
 * in e2e/verdict-mutations.json, and fails on verdict wording or verdict styling rendered
 * outside a marker. Never call this with a heading that does not depend on a computed value.
 */
function verdict(marker: string, kind: 'pass' | 'reject' | 'alarm', heading: string, detail: string): string {
  const icon = kind === 'pass' ? 'OK' : kind === 'reject' ? 'NO' : '!'
  return `<div class="verdict ${kind}" data-verdict="${marker}" data-result="${kind}"><span class="verdict-icon" aria-hidden="true">${icon}</span><div><strong>${heading}</strong><span>${detail}</span></div></div>`
}

/**
 * Renders one measurement. `marker` is the claim's identity in the DOM and `value` is the
 * machine-readable number behind the words. e2e/verdicts.spec.ts holds [data-claim] to the
 * same coverage terms as [data-verdict] — a rendered measurement with no recorded mutation
 * fails the build — and expectClaim() asserts the rendered text and `data-value` are the
 * same number before any test is allowed to read the attribute.
 */
function claim(marker: string, value: bigint | number, rendered: string, tag: 'strong' | 'code' | 'span' = 'strong'): string {
  return `<${tag} data-claim="${marker}" data-value="${value}">${rendered}</${tag}>`
}

function renderMechanism(): void {
  const root = element<HTMLDivElement>('#mechanism')
  const prepareButton = element<HTMLButtonElement>('#prepare-button')
  const aggregateButton = element<HTMLButtonElement>('#aggregate-button')
  if (!activeReport) {
    setRail(0)
    prepareButton.disabled = true
    aggregateButton.disabled = true
    root.innerHTML = `<div class="empty-state"><span class="empty-mark" aria-hidden="true">01</span><p>A report begins as one private measurement. Shard it to make two envelopes.</p></div>`
    return
  }

  const protocol = protocolFor(activeReport.mode)
  const [leader, helper] = protocol.measurementShares(CONTEXT, activeReport.report)
  const typeName = activeReport.mode === 'sum' ? 'Prio3Sum' : 'Prio3Count'
  prepareButton.disabled = Boolean(activeReport.trace)
  aggregateButton.disabled = !activeReport.trace?.accepted || activeReport.added
  setRail(activeReport.added ? 3 : activeReport.trace ? 2 : 1)

  let html = `<div class="report-origin"><span>CLIENT REPORT</span>${claim('report-measurement', activeReport.measurement, activeReport.mode === 'sum' ? money(activeReport.measurement) : activeReport.measurement.toString())}<small>${typeName} · draft-22</small></div>
    <div class="split-line" aria-hidden="true"><span></span><b>split + prove</b><span></span></div>
    <div class="envelopes">
      <article class="envelope leader"><div class="envelope-head"><span>A</span><div><strong>Aggregator A</strong><small>leader input share</small></div></div>${claim('leader-share', leader.length, compactFields(leader), 'code')}<p>Measurement share + proof share. No plain salary.</p></article>
      <article class="envelope helper"><div class="envelope-head"><span>B</span><div><strong>Aggregator B</strong><small>helper seed</small></div></div>${claim('helper-share', helper.length, compactFields(helper), 'code')}<p>Seed-expanded share + proof share. No plain salary.</p></article>
    </div>`

  if (activeReport.trace) {
    const trace = activeReport.trace
    html += `<div class="verification-bridge">
      <div><span>VERIFIER SHARE A</span>${claim('verifier-a', trace.verifierShares[0].values[0], fieldHex(trace.verifierShares[0].values[0]), 'code')}</div>
      <div class="combine-mark" aria-hidden="true">+</div>
      <div><span>VERIFIER SHARE B</span>${claim('verifier-b', trace.verifierShares[1].values[0], fieldHex(trace.verifierShares[1].values[0]), 'code')}</div>
      <div class="combine-mark" aria-hidden="true">=</div>
      <div><span>COMBINED</span>${claim('combined-verifier', trace.combinedVerifier[0], fieldHex(trace.combinedVerifier[0]), 'code')}</div>
    </div>
    ${trace.accepted
      ? verdict('preparation', 'pass', 'VALID', 'combined verifier is zero; this report may enter the tally')
      : verdict('preparation', 'reject', 'REJECTED', trace.cause)}`
  }
  if (activeReport.added) html += `<p class="added-note">Accepted output shares were added independently. Only the collector combines the two totals.</p>`
  root.innerHTML = html
}

function renderTally(): void {
  const root = element<HTMLDivElement>('#tally-output')
  const accepted = records.filter((record) => record.trace.accepted && record.trace.outputShares)
  const rejected = records.length - accepted.length
  if (accepted.length === 0) {
    root.innerHTML = `<div class="tally-stat"><span>SUBMITTED</span>${claim('submitted-count', records.length, String(records.length))}</div><div class="tally-stat"><span>ACCEPTED</span>${claim('accepted-count', 0, '0')}</div><div class="tally-stat"><span>REJECTED</span>${claim('rejected-count', rejected, String(rejected))}</div><div class="tally-empty">Aggregate undefined until one report is accepted.</div>`
    return
  }
  const leaderAggregate = aggregateOutputShares(accepted.map((record) => record.trace.outputShares![0]))
  const helperAggregate = aggregateOutputShares(accepted.map((record) => record.trace.outputShares![1]))
  const aggregate = unshard([leaderAggregate, helperAggregate], accepted.length)
  const plainSum = accepted.reduce((sum, record) => sum + record.reported, 0n)
  const agrees = aggregate === plainSum
  root.innerHTML = `<div class="tally-stat"><span>SUBMITTED</span>${claim('submitted-count', records.length, String(records.length))}</div><div class="tally-stat"><span>ACCEPTED</span>${claim('accepted-count', accepted.length, String(accepted.length))}</div><div class="tally-stat"><span>REJECTED</span>${claim('rejected-count', rejected, String(rejected))}</div><div class="sum-comparison"><div><span>PROTOCOL AGGREGATE</span>${claim('protocol-aggregate', aggregate, mode === 'sum' ? money(aggregate) : String(aggregate))}</div><span class="equality ${agrees ? 'pass' : 'mismatch'}" data-verdict="tally-match" data-result="${agrees ? 'pass' : 'reject'}" aria-hidden="true">${agrees ? '=' : '!='}</span><div><span>PLAIN SUM</span>${claim('plain-sum', plainSum, mode === 'sum' ? money(plainSum) : String(plainSum))}</div><p class="byte-match ${agrees ? 'pass' : 'mismatch'}" data-verdict="tally-match" data-result="${agrees ? 'pass' : 'reject'}">${agrees ? 'MATCH: Field64 byte equality' : 'MISMATCH: the protocol aggregate is not the plain sum'}</p>${accepted.map((record) => `<i data-accepted-value="${record.reported}" hidden></i>`).join('')}</div>`
}

function retireIfChanged(nextValue: bigint): void {
  if (!activeReport || activeReport.measurement === nextValue) return
  activeReport = undefined
  element('#retirement-status').textContent = 'Previous result retired because the measurement changed.'
  renderMechanism()
}

function readMeasurement(): bigint {
  const input = element<HTMLInputElement>('#measurement')
  if (!input.validity.valid || input.value.trim() === '') throw new RangeError('Enter an integer inside the configured range.')
  return BigInt(input.value)
}

function shardCurrent(): void {
  const status = element('#retirement-status')
  try {
    const measurement = readMeasurement()
    activeReport = { mode, measurement, report: protocolFor(mode).shard(CONTEXT, measurement), added: false }
    status.textContent = 'Fresh report created. Each aggregator now has only its own envelope.'
    renderMechanism()
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Unable to shard this measurement.'
  }
}

function prepareCurrent(): void {
  if (!activeReport) return
  activeReport.trace = protocolFor(activeReport.mode).prepare(VERIFY_KEY, CONTEXT, activeReport.report)
  element('#retirement-status').textContent = activeReport.trace.accepted
    ? 'Preparation accepted the report.'
    : `Preparation rejected the report: ${activeReport.trace.cause}.`
  renderMechanism()
}

function addCurrent(): void {
  if (!activeReport?.trace?.accepted || activeReport.added) return
  activeReport.added = true
  records.push({ reported: activeReport.measurement, truth: activeReport.measurement, trace: activeReport.trace })
  element('#retirement-status').textContent = 'Accepted output shares added to the two aggregator tallies.'
  renderMechanism()
  renderTally()
}

function loadPayroll(): void {
  mode = 'sum'
  updateModeControls()
  const protocol = protocolFor('sum')
  records = SYNTHETIC_PAYROLL.map(([, salary]) => {
    const trace = protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shard(CONTEXT, salary))
    return { reported: salary, truth: salary, trace }
  })
  const [name, salary] = SYNTHETIC_PAYROLL.at(-1)!
  const report = protocol.shard(CONTEXT, salary)
  activeReport = { mode: 'sum', measurement: salary, report, trace: protocol.prepare(VERIFY_KEY, CONTEXT, report), added: true }
  element('#retirement-status').textContent = `Loaded a labeled synthetic payroll. Last accepted report: ${name}.`
  renderMechanism()
  renderTally()
}

function updateModeControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    const selected = button.dataset.mode === mode
    button.classList.toggle('active', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  const input = element<HTMLInputElement>('#measurement')
  const label = document.querySelector<HTMLLabelElement>('label[for="measurement"]')!
  if (mode === 'sum') {
    input.max = SUM_MAXIMUM.toString()
    input.value = '125000'
    label.textContent = 'Salary measurement'
  } else {
    input.max = '1'
    input.value = '1'
    label.textContent = 'Count measurement'
  }
  activeReport = undefined
  records = []
  element('#retirement-status').textContent = 'Protocol mode changed; previous result retired.'
  renderMechanism()
  renderTally()
}

function runRangeAttack(): void {
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const circuit = protocol.options.circuit as SumCircuit
  const maliciousValue = 4_000_000_000n
  const malformed = [maliciousValue, ...Array<Field64>(circuit.measurementLength - 1).fill(0n)]
  const trace = protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shardEncoded(CONTEXT, malformed))
  const refused = !trace.accepted
  element('#range-result').innerHTML = `<div data-rejected-value="${maliciousValue}" data-bit-width="${circuit.bits}" data-range-refused="${refused}">${refused
    ? verdict('range-attack', 'reject', 'REJECTED', `${maliciousValue.toLocaleString('en-US')} ≥ 2^${circuit.bits}; ${trace.cause}`)
    : verdict('range-attack', 'alarm', 'ADMITTED BY THE CIRCUIT', `${maliciousValue.toLocaleString('en-US')} ≥ 2^${circuit.bits} and preparation still returned ${trace.cause}`)}</div>`
}

function runTamperAttack(): void {
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const report = protocol.shard(CONTEXT, 125_000n)
  const trace = protocol.prepare(VERIFY_KEY, CONTEXT, tamperProofShare(report))
  const refused = !trace.accepted
  element('#tamper-result').innerHTML = `<div data-tamper-refused="${refused}" data-tamper-cause="${trace.cause}">${refused
    ? verdict('tamper-attack', 'reject', 'REJECTED', trace.cause)
    : verdict('tamper-attack', 'alarm', 'ADMITTED WITH A FLIPPED PROOF SHARE', `preparation returned ${trace.cause} for a report whose proof share was changed`)}</div>`
}

function runNonceAttack(): void {
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const registry = new NonceRegistry()
  const report = protocol.shard(CONTEXT, 125_000n)
  const nonceKey = toHex(report.nonce)

  // First submission: intake records the nonce, preparation runs, the report is accepted.
  const firstAdmitted = registry.admit(report)
  const firstTrace = protocol.prepare(VERIFY_KEY, CONTEXT, report)

  // Replay: the identical report, byte for byte. Preparation is run anyway, to show
  // what the VDAF alone would say about it.
  const replayAdmitted = registry.admit(report)
  const replayTrace = protocol.prepare(VERIFY_KEY, CONTEXT, report)

  /**
   * The tally is summed over the submissions preparation accepted — one contribution per
   * accepted submission, each of them rendered. e2e/claims.spec.ts adds the rendered
   * contributions up and compares that sum to the rendered total.
   *
   * Be exact about what that oracle buys, because the sentence beside the number used to
   * claim more than it. This exhibit submits ONE report twice, so its two contributions are
   * equal by construction, and summing two equal terms is arithmetically identical to
   * doubling one. No test written against this page can separate the two. The summed oracle
   * buys three real things — no literal 2 survives in the spec, every contribution is
   * rendered and counted, and a page that aggregates only the first submission is killed —
   * and it does NOT buy the sum-versus-product distinction. The count comes from the array
   * that was aggregated, never from a literal 2; keep it that way, and keep the rendered
   * sentence off any word this page cannot show.
   */
  const acceptedTraces = [firstTrace, replayTrace].filter((trace) => trace.accepted)
  const shares = acceptedTraces.map((trace, index) => requireOutputShares(trace, `submission ${index + 1}`))
  const contributions = shares.map(([leader, helper]) => unshard([leader, helper], 1))
  const total = unshard(
    [aggregateOutputShares(shares.map(([leader]) => leader)), aggregateOutputShares(shares.map(([, helper]) => helper))],
    shares.length,
  )
  const single = contributions[0]

  const vdafOutcome = replayTrace.accepted
    ? verdict('replay-vdaf', 'alarm', 'PREPARATION ACCEPTED IT AGAIN', `the proofs in a replayed report are still correct, so the VDAF returns accepted a second time; the tally would move from ${money(single)} to ${money(total)} on one measurement`)
    : verdict('replay-vdaf', 'pass', 'PREPARATION REFUSED THE REPLAY', `the VDAF turned the duplicate away on its own: ${replayTrace.cause}`)

  element('#nonce-result').innerHTML = `<div data-replay="true" data-first-admitted="${firstAdmitted}" data-guard-admitted="${replayAdmitted}" data-vdaf-replay-accepted="${replayTrace.accepted}">
    ${vdafOutcome}
    <ul class="replay-ledger">${contributions.map((value, index) => `<li><span>Submission ${index + 1}</span>${claim('replay-contribution', value, money(value))}</li>`).join('')}</ul>
    <p class="replay-tally">Across the submissions preparation accepted, the tally holds ${claim('replay-total', total, money(total))}.</p>
    ${replayAdmitted
      ? verdict('replay-intake', 'alarm', 'ADMITTED BY INTAKE', `nonce ${nonceKey.slice(0, 16)}… had already been recorded and the registry let it through anyway`)
      : verdict('replay-intake', 'reject', 'REJECTED BY INTAKE', `nonce ${nonceKey.slice(0, 16)}… was already seen; this lab's registry refuses the duplicate before preparation`)}
    <p>Replay is not something the proof can catch. It is refused outside the VDAF, by the layer that remembers nonces.</p>
  </div>`
}

function toggleCollusion(checked: boolean): void {
  const root = element('#collusion-result')
  if (!checked) {
    root.innerHTML = '<p class="muted">The two shares remain on separate desks.</p>'
    return
  }
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const input = 125_000n
  const report = protocol.shard(CONTEXT, input)
  const result = collude(protocol, CONTEXT, report)
  const revealed = result.reconstructed === input
  root.innerHTML = `<div class="collusion-reveal" data-collusion-input="${input}" data-collusion-reconstructed="${result.reconstructed}">${revealed
    ? verdict('collusion', 'alarm', 'BROKEN: INPUT REVEALED', `both shares reconstruct ${money(result.reconstructed)}`)
    : verdict('collusion', 'pass', 'INPUT NOT RECONSTRUCTED', `adding both shares gave ${money(result.reconstructed)}, which is not the ${money(input)} that was sharded`)}<div class="share-pair">${claim('collusion-share-a', result.shares[0].length, `A: ${compactFields(result.shares[0])}`, 'code')}${claim('collusion-share-b', result.shares[1].length, `B: ${compactFields(result.shares[1])}`, 'code')}</div><p>What this is not: security against both aggregators colluding.</p></div>`
}

function runValidLieFixture(): void {
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const fixture = VALID_LIE_FIXTURE.map((person) => ({
    ...person,
    trace: protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shard(CONTEXT, person.reported)),
  }))
  const leader = aggregateOutputShares(fixture.map((item) => requireOutputShares(item.trace, item.name)[0]))
  const helper = aggregateOutputShares(fixture.map((item) => requireOutputShares(item.trace, item.name)[1]))
  const reportedTotal = unshard([leader, helper], fixture.length)
  const truthTotal = fixture.reduce((sum, item) => sum + item.sealedTruth, 0n)
  const allValid = fixture.every((item) => item.trace.accepted)
  const lieStands = allValid && reportedTotal !== truthTotal
  element('#lie-result').innerHTML = `<div class="fixture-result" data-negative-lie="true">${lieStands
    ? verdict('valid-lie', 'alarm', 'VALID - AND FALSE', 'every Prio3 check passes; the reported total does not match sealed truth')
    : verdict('valid-lie', 'pass', 'THE FIXTURE DID NOT CARRY A LIE', allValid ? 'every check passed and the reported total equals the sealed truth' : 'at least one fixture report was refused, so no valid lie entered the total')}<div class="fixture-ledger">${fixture.map((item) => `<div><span>${item.name}</span><b class="valid-word ${item.trace.accepted ? 'pass' : 'fail'}" data-verdict="valid-lie-row" data-result="${item.trace.accepted ? 'pass' : 'reject'}">${item.trace.accepted ? 'VALID' : 'REJECTED'}</b>${claim('lie-row-reported', item.reported, `reported ${money(item.reported)}`, 'code')}${claim('lie-row-sealed', item.sealedTruth, `sealed ${money(item.sealedTruth)}`, 'code')}</div>`).join('')}</div><p>Protocol aggregate ${claim('lie-aggregate', reportedTotal, money(reportedTotal))}; sealed plain sum ${claim('lie-truth', truthTotal, money(truthTotal))}.</p><p data-all-valid="${allValid}">Prio3 checks that a report is well-formed, in range, and correctly shared. It cannot check that a report is true; a valid-looking lie passes every check and moves the total.</p></div>`
}

function runSingleFixture(): void {
  const value = 119_800n
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const trace = protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shard(CONTEXT, value))
  const [leader, helper] = requireOutputShares(trace, 'one-report fixture')
  const total = unshard([leader, helper], 1)
  const exposes = total === value
  element('#single-result').innerHTML = `<div class="fixture-result" data-negative-single="true">${exposes
    ? verdict('single-report', 'alarm', 'SHARES PRIVATE - AND THE TOTAL IS THE INPUT', `one valid report produces ${money(total)}`)
    : verdict('single-report', 'pass', 'THE TOTAL IS NOT THE INPUT', `one report of ${money(value)} produced an aggregate of ${money(total)}`)}<p>One report of ${claim('single-input', value, money(value))} produced an aggregate of ${claim('single-aggregate', total, money(total))}. Prio3 does not provide differential privacy; with one report, the aggregate is the report.</p></div>`
}

function runRuntimeKats(): void {
  const count = createPrio3Count()
  const countReport = count.shard(VECTOR_CONTEXT, 1n, VECTOR_NONCE, VECTOR_RANDOMNESS)
  const countInputMatches = toHex(count.encodeInputShare(countReport.inputShares[0])) === '355e16daa732744c34dc71fa4c85d209f9af2ecf751609386ed9e2714ecc9e6bb2277498ac41e75c01d81b4cb8485926'
  const countTrace = count.prepare(VERIFY_KEY, VECTOR_CONTEXT, countReport)
  const countVerifierMatches = countTrace.accepted && toHex(count.encodeVerifierShare(countTrace.verifierShares[0])) === 'cd7905720f16e5d9ef7657a336307ae8f3fe96d36cc09019257268349e7a7d72'
  const sum = createPrio3Sum(255n)
  const sumReport = sum.shard(VECTOR_CONTEXT, 100n, VECTOR_NONCE, VECTOR_RANDOMNESS)
  const sumTrace = sum.prepare(VERIFY_KEY, VECTOR_CONTEXT, sumReport)
  const sumVerifierMatches = sumTrace.accepted && toHex(sum.encodeVerifierShare(sumTrace.verifierShares[0])) === '8ae6c9427194bcbd4f7ec37b2d71efde7103dba5d9ce9b82'
  const rows = [
    ['Prio3Count_0 input shares', countInputMatches],
    ['Prio3Count_0 verifier shares', countVerifierMatches],
    ['Prio3Sum_0 verifier shares', sumVerifierMatches],
  ] as const
  const allMatch = rows.every(([, passed]) => passed)
  element('#kat-panel').innerHTML = `<div class="kat-summary">${claim('kat-count', rows.length, `${rows.length} official KAT checks`, 'span')}<strong class="kat-verdict ${allMatch ? 'pass' : 'fail'}" data-verdict="kat-summary" data-result="${allMatch ? 'pass' : 'reject'}" data-kat-all-match="${allMatch}">${allMatch ? 'ALL MATCH' : 'MISMATCH'}</strong></div><div class="table-wrap" role="region" aria-label="Known-answer test results" tabindex="0"><table><thead><tr><th scope="col">Pinned fixture</th><th scope="col">Source</th><th scope="col">Result</th></tr></thead><tbody>${rows.map(([name, passed]) => `<tr><td>${name}</td><td>draft-22 reference vectors</td><td><span class="kat-status ${passed ? 'pass' : 'fail'}" data-verdict="kat-row" data-result="${passed ? 'pass' : 'reject'}">${passed ? 'MATCH' : 'MISMATCH'}</span></td></tr>`).join('')}</tbody></table></div><p class="vector-meta">draft-irtf-cfrg-vdaf-22 · 14 August 2026 · Field64 · TurboSHAKE128(D=1) · one proof per report</p>`
}

function wireTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const select = (panel: Panel): void => {
    tabs.forEach((tab) => {
      const active = tab.dataset.panel === panel
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      element<HTMLElement>(`#panel-${tab.dataset.panel}`).hidden = !active
    })
    if (panel === 'limits') runRuntimeKats()
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.panel as Panel))
    tab.addEventListener('keydown', (event) => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length
      if (offset !== 0 || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        tabs[target].focus()
        select(tabs[target].dataset.panel as Panel)
      }
    })
  })
}

export function initializeApp(): void {
  wireTabs()
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.mode as Mode
      if (nextMode !== mode) {
        mode = nextMode
        updateModeControls()
      }
    })
  })
  element<HTMLInputElement>('#measurement').addEventListener('input', (event) => {
    const value = (event.currentTarget as HTMLInputElement).value
    if (/^\d+$/.test(value)) retireIfChanged(BigInt(value))
  })
  element('#shard-button').addEventListener('click', shardCurrent)
  element('#prepare-button').addEventListener('click', prepareCurrent)
  element('#aggregate-button').addEventListener('click', addCurrent)
  element('#payroll-button').addEventListener('click', loadPayroll)
  element('#range-attack').addEventListener('click', runRangeAttack)
  element('#tamper-attack').addEventListener('click', runTamperAttack)
  element('#nonce-attack').addEventListener('click', runNonceAttack)
  element<HTMLInputElement>('#collusion-toggle').addEventListener('change', (event) => toggleCollusion((event.currentTarget as HTMLInputElement).checked))
  element('#lie-fixture').addEventListener('click', runValidLieFixture)
  element('#single-fixture').addEventListener('click', runSingleFixture)
  renderMechanism()
  renderTally()
  toggleCollusion(false)
}