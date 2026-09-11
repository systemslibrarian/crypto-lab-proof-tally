import { collude } from '../attack/collude'
import { VALID_LIE_FIXTURE } from '../attack/lie'
import { encodeField64, type Field64 } from '../field/field64'
import { aggregateOutputShares, unshard } from '../prio3/aggregate'
import { tamperProofShare, type Prio3 } from '../prio3/core'
import { createPrio3Count, createPrio3Sum } from '../prio3/instances'
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

function verdict(kind: 'pass' | 'reject' | 'alarm', heading: string, detail: string): string {
  const icon = kind === 'pass' ? 'OK' : kind === 'reject' ? 'NO' : '!'
  return `<div class="verdict ${kind}"><span class="verdict-icon" aria-hidden="true">${icon}</span><div><strong>${heading}</strong><span>${detail}</span></div></div>`
}

function renderMechanism(): void {
  const root = element<HTMLDivElement>('#mechanism')
  const prepareButton = element<HTMLButtonElement>('#prepare-button')
  const aggregateButton = element<HTMLButtonElement>('#aggregate-button')
  if (!activeReport) {
    setRail(0)
    prepareButton.disabled = true
    aggregateButton.disabled = true
    root.innerHTML = `<div class="empty-state"><span class="empty-mark">01</span><p>A report begins as one private measurement. Shard it to make two envelopes.</p></div>`
    return
  }

  const protocol = protocolFor(activeReport.mode)
  const [leader, helper] = protocol.measurementShares(CONTEXT, activeReport.report)
  const typeName = activeReport.mode === 'sum' ? 'Prio3Sum' : 'Prio3Count'
  prepareButton.disabled = Boolean(activeReport.trace)
  aggregateButton.disabled = !activeReport.trace?.accepted || activeReport.added
  setRail(activeReport.added ? 3 : activeReport.trace ? 2 : 1)

  let html = `<div class="report-origin"><span>CLIENT REPORT</span><strong>${activeReport.mode === 'sum' ? money(activeReport.measurement) : activeReport.measurement.toString()}</strong><small>${typeName} · draft-22</small></div>
    <div class="split-line" aria-hidden="true"><span></span><b>split + prove</b><span></span></div>
    <div class="envelopes">
      <article class="envelope leader"><div class="envelope-head"><span>A</span><div><strong>Aggregator A</strong><small>leader input share</small></div></div><code>${compactFields(leader)}</code><p>Measurement share + proof share. No plain salary.</p></article>
      <article class="envelope helper"><div class="envelope-head"><span>B</span><div><strong>Aggregator B</strong><small>helper seed</small></div></div><code>${compactFields(helper)}</code><p>Seed-expanded share + proof share. No plain salary.</p></article>
    </div>`

  if (activeReport.trace) {
    const trace = activeReport.trace
    html += `<div class="verification-bridge">
      <div><span>VERIFIER SHARE A</span><code data-verifier-a="${trace.verifierShares[0].values[0]}">${fieldHex(trace.verifierShares[0].values[0])}</code></div>
      <div class="combine-mark" aria-hidden="true">+</div>
      <div><span>VERIFIER SHARE B</span><code data-verifier-b="${trace.verifierShares[1].values[0]}">${fieldHex(trace.verifierShares[1].values[0])}</code></div>
      <div class="combine-mark" aria-hidden="true">=</div>
      <div><span>COMBINED</span><code data-combined-verifier="${trace.combinedVerifier[0]}">${fieldHex(trace.combinedVerifier[0])}</code></div>
    </div>
    ${trace.accepted
      ? verdict('pass', 'VALID', 'combined verifier is zero; this report may enter the tally')
      : verdict('reject', 'REJECTED', trace.cause)}`
  }
  if (activeReport.added) html += `<p class="added-note">Accepted output shares were added independently. Only the collector combines the two totals.</p>`
  root.innerHTML = html
}

function renderTally(): void {
  const root = element<HTMLDivElement>('#tally-output')
  const accepted = records.filter((record) => record.trace.accepted && record.trace.outputShares)
  const rejected = records.length - accepted.length
  if (accepted.length === 0) {
    root.innerHTML = `<div class="tally-stat"><span>SUBMITTED</span><strong data-submitted-count="${records.length}">${records.length}</strong></div><div class="tally-stat"><span>ACCEPTED</span><strong data-accepted-count="0">0</strong></div><div class="tally-stat"><span>REJECTED</span><strong data-rejected-count="${rejected}">${rejected}</strong></div><div class="tally-empty">Aggregate undefined until one report is accepted.</div>`
    return
  }
  const leaderAggregate = aggregateOutputShares(accepted.map((record) => record.trace.outputShares![0]))
  const helperAggregate = aggregateOutputShares(accepted.map((record) => record.trace.outputShares![1]))
  const aggregate = unshard([leaderAggregate, helperAggregate], accepted.length)
  const plainSum = accepted.reduce((sum, record) => sum + record.reported, 0n)
  root.innerHTML = `<div class="tally-stat"><span>SUBMITTED</span><strong data-submitted-count="${records.length}">${records.length}</strong></div><div class="tally-stat"><span>ACCEPTED</span><strong data-accepted-count="${accepted.length}">${accepted.length}</strong></div><div class="tally-stat"><span>REJECTED</span><strong data-rejected-count="${rejected}">${rejected}</strong></div><div class="sum-comparison"><div><span>PROTOCOL AGGREGATE</span><strong data-aggregate="${aggregate}">${mode === 'sum' ? money(aggregate) : aggregate}</strong></div><span class="equality">=</span><div><span>PLAIN SUM</span><strong data-plain-sum="${plainSum}">${mode === 'sum' ? money(plainSum) : plainSum}</strong></div><p class="byte-match">MATCH: Field64 byte equality</p>${accepted.map((record) => `<i data-accepted-value="${record.reported}" hidden></i>`).join('')}</div>`
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
  records = SYNTHETIC_PAYROLL.map(([, salary]) => ({
    reported: salary,
    truth: salary,
    trace: protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shard(CONTEXT, salary)),
  }))
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
  const maliciousValue = 4_000_000_000n
  const malformed = [maliciousValue, ...Array<Field64>(23).fill(0n)]
  const trace = protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shardEncoded(CONTEXT, malformed))
  element('#range-result').innerHTML = `<div data-rejected-value="${maliciousValue}" data-bit-width="24">${verdict('reject', 'REJECTED', `${maliciousValue.toLocaleString('en-US')} ≥ 2^24; ${trace.cause}`)}</div>`
}

function runTamperAttack(): void {
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const report = protocol.shard(CONTEXT, 125_000n)
  const trace = protocol.prepare(VERIFY_KEY, CONTEXT, tamperProofShare(report))
  element('#tamper-result').innerHTML = verdict('reject', 'REJECTED', trace.cause)
}

function runNonceAttack(): void {
  const nonce = crypto.getRandomValues(new Uint8Array(16))
  const nonceKey = toHex(nonce)
  const seen = new Set<string>([nonceKey])
  const duplicateAccepted = !seen.has(nonceKey)
  element('#nonce-result').innerHTML = duplicateAccepted
    ? verdict('alarm', 'ALARM', 'duplicate nonce was not detected')
    : verdict('reject', 'REJECTED BY ORCHESTRATION', 'duplicate 16-byte nonce; VDAF preparation was not started')
}

function toggleCollusion(checked: boolean): void {
  const root = element('#collusion-result')
  if (!checked) {
    root.innerHTML = '<p class="muted">The two shares remain on separate desks.</p>'
    return
  }
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const report = protocol.shard(CONTEXT, 125_000n)
  const result = collude(protocol, CONTEXT, report)
  root.innerHTML = `<div class="collusion-reveal">${verdict('alarm', 'BROKEN: INPUT REVEALED', `both shares reconstruct ${money(result.reconstructed)}`)}<div class="share-pair"><code>A: ${compactFields(result.shares[0])}</code><code>B: ${compactFields(result.shares[1])}</code></div><p>What this is not: security against both aggregators colluding.</p></div>`
}

function runValidLieFixture(): void {
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const fixture = VALID_LIE_FIXTURE.map((person) => ({
    ...person,
    trace: protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shard(CONTEXT, person.reported)),
  }))
  const leader = aggregateOutputShares(fixture.map((item) => item.trace.outputShares![0]))
  const helper = aggregateOutputShares(fixture.map((item) => item.trace.outputShares![1]))
  const reportedTotal = unshard([leader, helper], fixture.length)
  const truthTotal = fixture.reduce((sum, item) => sum + item.sealedTruth, 0n)
  const allValid = fixture.every((item) => item.trace.accepted)
  element('#lie-result').innerHTML = `<div class="fixture-result" data-negative-lie="true">${verdict('alarm', 'VALID - AND FALSE', 'every Prio3 check passes; the reported total does not match sealed truth')}<div class="fixture-ledger">${fixture.map((item) => `<div><span>${item.name}</span><b class="valid-word">${item.trace.accepted ? 'VALID' : 'REJECTED'}</b><code>reported ${money(item.reported)}</code><code>sealed ${money(item.sealedTruth)}</code></div>`).join('')}</div><p>Protocol aggregate <strong data-lie-aggregate="${reportedTotal}">${money(reportedTotal)}</strong>; sealed plain sum <strong data-lie-truth="${truthTotal}">${money(truthTotal)}</strong>.</p><p data-all-valid="${allValid}">Prio3 checks that a report is well-formed, in range, and correctly shared. It cannot check that a report is true; a valid-looking lie passes every check and moves the total.</p></div>`
}

function runSingleFixture(): void {
  const value = 119_800n
  const protocol = createPrio3Sum(SUM_MAXIMUM)
  const trace = protocol.prepare(VERIFY_KEY, CONTEXT, protocol.shard(CONTEXT, value))
  const total = unshard([trace.outputShares![0], trace.outputShares![1]], 1)
  element('#single-result').innerHTML = `<div class="fixture-result" data-negative-single="true">${verdict('alarm', 'SHARES PRIVATE - AND THE TOTAL IS THE INPUT', `one valid report produces ${money(total)}`)}<p data-single-input="${value}" data-single-aggregate="${total}">Prio3 does not provide differential privacy; with one report, the aggregate is the report.</p></div>`
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
  element('#kat-panel').innerHTML = `<div class="kat-summary"><span data-kat-count="${rows.length}">${rows.length} official KAT checks</span><strong>${rows.every(([, passed]) => passed) ? 'ALL MATCH' : 'MISMATCH'}</strong></div><div class="table-wrap" role="region" aria-label="Known-answer test results" tabindex="0"><table><thead><tr><th scope="col">Pinned fixture</th><th scope="col">Source</th><th scope="col">Result</th></tr></thead><tbody>${rows.map(([name, passed]) => `<tr><td>${name}</td><td>draft-22 reference vectors</td><td><span class="kat-status ${passed ? 'pass' : 'fail'}">${passed ? 'MATCH' : 'MISMATCH'}</span></td></tr>`).join('')}</tbody></table></div><p class="vector-meta">draft-irtf-cfrg-vdaf-22 · 14 August 2026 · Field64 · TurboSHAKE128(D=1) · one proof per report</p>`
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