import { runExactReplacementDisclosure } from '../distributed/exact'
import { type RandomSource } from '../distributed/noise'
import {
  ABSOLUTE_NOISE_CAP_UNITS,
  ACTIVATION_DENOMINATOR,
  ACTIVATION_NUMERATOR,
  ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
  EPSILON_DENOMINATOR,
  EPSILON_NUMERATOR,
  LAPLACE_SCALE_DENOMINATOR,
  LAPLACE_SCALE_NUMERATOR,
  MAX_COMMITTED_COHORT_SIZE,
  MAX_SHIFTED_CONTRIBUTION_UNITS,
  QUANTIZATION_STEP_DOLLARS,
  REPLACE_ONE_SENSITIVITY_UNITS,
  SALARY_CEILING_DOLLARS,
  SALARY_FLOOR_DOLLARS,
  clampAndQuantizeSalary,
  privacyAccounting,
} from '../distributed/parameters'
import {
  createCorruptFixedZeroReport,
  createDistributedContextBinding,
  createHonestParticipantReport,
  type BuiltParticipantReport,
  type ParticipantSalary,
} from '../distributed/report'
import {
  OneReleaseLedger,
  completeDelivery,
  createOmniscientTeachingTrace,
  releaseCommittedBatch,
  type CommittedBatch,
  type ReleaseAbortReason,
  type ReleaseResult,
} from '../distributed/release'

type Scenario =
  | 'all-honest'
  | 'threshold'
  | 'below-threshold'
  | 'precommit-dropout'
  | 'mid-report-dropout'
  | 'all-corrupt'
  | 'cap-overflow'

type ClaimRenderer = (
  marker: string,
  value: bigint | number | string,
  rendered: string,
  tag?: 'strong' | 'code' | 'span',
) => string

type VerdictRenderer = (
  marker: string,
  kind: 'pass' | 'reject' | 'alarm',
  heading: string,
  detail: string,
) => string

export interface DistributedUiDependencies {
  claim: ClaimRenderer
  verdict: VerdictRenderer
  money(value: bigint): string
}

interface ScenarioPlan {
  participantCount: number
  honestCount: number
  partialDelivery: boolean
  forceCapOverflow: boolean
}

interface ActiveAttempt {
  batch: CommittedBatch
  built: readonly BuiltParticipantReport[]
}

const PAYROLL: readonly ParticipantSalary[] = [
  { participantId: 'Avery', salaryDollars: 84_200n },
  { participantId: 'Blair', salaryDollars: 91_750n },
  { participantId: 'Cameron', salaryDollars: 76_300n },
  { participantId: 'Devon', salaryDollars: 108_400n },
  { participantId: 'Ellis', salaryDollars: 88_750n },
  { participantId: 'Frankie', salaryDollars: 95_600n },
  { participantId: 'Gray', salaryDollars: 112_300n },
  { participantId: 'Harper', salaryDollars: 79_900n },
  { participantId: 'Indigo', salaryDollars: 101_250n },
  { participantId: 'Jordan', salaryDollars: 93_400n },
  { participantId: 'Kai', salaryDollars: 86_500n },
  // The visible outlier makes the declared clamp executable rather than decorative.
  { participantId: 'Lane', salaryDollars: 480_000n },
]

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`Missing required element: ${selector}`)
  return found
}

function scenarioPlan(scenario: Scenario): ScenarioPlan {
  switch (scenario) {
    case 'all-honest':
      return { participantCount: 12, honestCount: 12, partialDelivery: false, forceCapOverflow: false }
    case 'threshold':
      return { participantCount: 12, honestCount: 6, partialDelivery: false, forceCapOverflow: false }
    case 'below-threshold':
      return { participantCount: 12, honestCount: 5, partialDelivery: false, forceCapOverflow: false }
    case 'precommit-dropout':
      return { participantCount: 10, honestCount: 6, partialDelivery: false, forceCapOverflow: false }
    case 'mid-report-dropout':
      return { participantCount: 12, honestCount: 6, partialDelivery: true, forceCapOverflow: false }
    case 'all-corrupt':
      return { participantCount: 12, honestCount: 0, partialDelivery: false, forceCapOverflow: false }
    case 'cap-overflow':
      return { participantCount: 12, honestCount: 12, partialDelivery: false, forceCapOverflow: true }
  }
}

class ByteQueue implements RandomSource {
  private offset = 0

  constructor(private readonly bytes: readonly number[]) {}

  fill(target: Uint8Array): void {
    if (this.offset + target.length > this.bytes.length) throw new Error('deterministic cap fixture exhausted')
    for (let index = 0; index < target.length; index += 1) target[index] = this.bytes[this.offset++]
  }
}

/** Activation succeeds, then CKS Algorithm 2 returns +4097 and the batch must abort. */
function capOverflowRandomSource(): RandomSource {
  const vDraws = Array.from({ length: 81 }, () => [0, 1]).flat()
  return new ByteQueue([0, 47, 0, 0, 47, ...vDraws, 1, 1])
}

function signedUnits(value: bigint): string {
  return `${value.toLocaleString('en-US')} units`
}

function signedMoney(value: bigint, money: (amount: bigint) => string): string {
  return value < 0n ? `−${money(-value)}` : money(value)
}

function exactFraction(numerator: bigint, denominator: bigint): string {
  return `${numerator}/${denominator}`
}

function renderedFraction(numerator: bigint, denominator: bigint): string {
  return `${numerator.toLocaleString('en-US')} / ${denominator.toLocaleString('en-US')}`
}

function renderAbort(
  reason: ReleaseAbortReason,
  verdict: VerdictRenderer,
): string {
  if (reason === 'already-attempted') {
    return verdict('dp-repeat-refusal', 'reject', 'NO SECOND RELEASE', 'The one-release ledger already consumed this committed batch identifier.')
  }
  if (reason === 'aggregator-collusion') {
    return verdict('dp-collusion-refusal', 'reject', 'NO PRIVACY CLAIM', 'Both aggregators collude, so the aggregate-view premise is false and this teaching policy releases nothing.')
  }
  if (reason === 'insufficient-honest-participants') {
    return verdict('dp-threshold-refusal', 'reject', 'NO ADVERTISED RELEASE', 'The declared honest-noise threshold is not met; this scenario produces no aggregate.')
  }
  if (reason === 'missing-submission' || reason === 'partial-delivery' || reason === 'submission-set-mismatch') {
    return verdict('dp-dropout-refusal', 'reject', 'WHOLE BATCH ABORTED', 'The committed report set was incomplete or inconsistent, so no accepted subset was released.')
  }
  throw new Error(`unexpected generated batch failure: ${reason}`)
}

export function initializeDistributedPanel({ claim, verdict, money }: DistributedUiDependencies): void {
  const panel = element<HTMLElement>('#panel-distributed')
  const exactButton = element<HTMLButtonElement>('#dp-exact-button')
  const exactRoot = element<HTMLDivElement>('#distributed-exact-result')
  const scenarioSelect = element<HTMLSelectElement>('#dp-scenario')
  const collusion = element<HTMLInputElement>('#dp-collusion')
  const releaseButton = element<HTMLButtonElement>('#dp-release-button')
  const repeatButton = element<HTMLButtonElement>('#dp-repeat-button')
  const status = element<HTMLParagraphElement>('#distributed-status')
  const releaseRoot = element<HTMLDivElement>('#distributed-release-result')
  const ledger = new OneReleaseLedger()
  let batchSequence = 0
  let activeAttempt: ActiveAttempt | undefined

  panel.dataset.clampMin = String(SALARY_FLOOR_DOLLARS)
  panel.dataset.clampMax = String(SALARY_CEILING_DOLLARS)
  panel.dataset.gridDollars = String(QUANTIZATION_STEP_DOLLARS)
  panel.dataset.sensitivityUnits = String(REPLACE_ONE_SENSITIVITY_UNITS)
  panel.dataset.epsilon = String(Number(EPSILON_NUMERATOR) / Number(EPSILON_DENOMINATOR))
  panel.dataset.noiseScale = String(Number(LAPLACE_SCALE_NUMERATOR) / Number(LAPLACE_SCALE_DENOMINATOR))
  panel.dataset.activationNumerator = String(ACTIVATION_NUMERATOR)
  panel.dataset.activationDenominator = String(ACTIVATION_DENOMINATOR)
  panel.dataset.noiseCapUnits = String(ABSOLUTE_NOISE_CAP_UNITS)
  panel.dataset.maxShiftedInput = String(MAX_SHIFTED_CONTRIBUTION_UNITS)
  panel.dataset.minimumHonest = String(ADVERTISED_MINIMUM_HONEST_PARTICIPANTS)

  element<HTMLElement>('#dp-parameter-record-bound').textContent = `${money(SALARY_FLOOR_DOLLARS)} to ${money(SALARY_CEILING_DOLLARS)}`
  element<HTMLElement>('#dp-parameter-record-detail').textContent = `Clamp first, then floor to ${money(QUANTIZATION_STEP_DOLLARS)} units.`
  element<HTMLElement>('#dp-parameter-adjacency-detail').textContent = `One slot may change from 0 through ${REPLACE_ONE_SENSITIVITY_UNITS} units, so sensitivity is ${REPLACE_ONE_SENSITIVITY_UNITS} units.`
  element<HTMLElement>('#dp-parameter-noise').textContent = `Discrete Laplace · ε = ${Number(EPSILON_NUMERATOR) / Number(EPSILON_DENOMINATOR)}`
  element<HTMLElement>('#dp-parameter-noise-detail').textContent = `Each honest client activates a full scale-${Number(LAPLACE_SCALE_NUMERATOR) / Number(LAPLACE_SCALE_DENOMINATOR)} draw with probability ${ACTIVATION_NUMERATOR}/${ACTIVATION_DENOMINATOR}.`
  element<HTMLElement>('#dp-parameter-threshold').textContent = `At least ${ADVERTISED_MINIMUM_HONEST_PARTICIPANTS} honest clients`
  const advertisedAccounting = privacyAccounting(
    ADVERTISED_MINIMUM_HONEST_PARTICIPANTS,
    MAX_COMMITTED_COHORT_SIZE,
  )
  element<HTMLElement>('#dp-parameter-threshold-detail').textContent = `The no-honest-noise event is at most ${renderedFraction(advertisedAccounting.noneActiveDelta.numerator, advertisedAccounting.noneActiveDelta.denominator)}, plus the disclosed output-magnitude-cap coupling term.`

  const retireAttempt = (): void => {
    activeAttempt = undefined
    releaseButton.disabled = false
    repeatButton.disabled = true
    releaseRoot.replaceChildren()
    status.textContent = 'Scenario changed. The prior counterfactual view is retired; the next action starts a separate teaching world. Do not combine their outputs.'
  }

  const renderExactDisclosure = (): void => {
    const result = runExactReplacementDisclosure(PAYROLL, 'Lane')
    const target = PAYROLL.find((participant) => participant.participantId === result.targetParticipantId)!
    const clampedDollars = clampAndQuantizeSalary(target.salaryDollars).clampedDollars
    exactRoot.innerHTML = `${verdict('dp-exact-disclosure', 'alarm',
      'EXACT TOTALS DISCLOSE THE REPLACED SLOT',
      'Equal-size Prio3 aggregates still reveal the bounded target when the releases are subtracted.',
    )}<div class="dp-summary-grid">
      <div><span>FULL QUERY</span>${claim('dp-exact-full', result.fullAggregateUnits, signedUnits(result.fullAggregateUnits))}</div>
      <div><span>ZERO-REPLACED QUERY</span>${claim('dp-exact-neighbor', result.replacementAggregateUnits, signedUnits(result.replacementAggregateUnits))}</div>
      <div><span>DISCLOSED DIFFERENCE</span>${claim('dp-disclosed-contribution', result.revealedTargetUnits, signedUnits(result.revealedTargetUnits))}</div>
      <div><span>LANE SUPPLIED</span>${claim('dp-exact-raw-dollars', target.salaryDollars, money(target.salaryDollars))}</div>
      <div><span>LANE AFTER CLAMP</span>${claim('dp-exact-clipped-dollars', clampedDollars, money(clampedDollars))}</div>
    </div><p class="dp-accounting">The second query replaced the slot with zero; it did not remove a participant. The difference is the clamped, floor-quantized contribution.</p>`
  }

  const renderReleased = (result: Extract<ReleaseResult, { status: 'released' }>, built: readonly BuiltParticipantReport[]): void => {
    const collector = result.collector
    const teaching = createOmniscientTeachingTrace(collector, built.map((item) => item.teachingTrace))
    const honestCount = built.filter((item) => item.teachingTrace.integrity === 'honest').length
    const accounting = privacyAccounting(honestCount, collector.participantCount)
    const activationValue = exactFraction(
      accounting.noneActiveDelta.numerator,
      accounting.noneActiveDelta.denominator,
    )
    const capValue = accounting.capCouplingDeltaApproximation.toExponential(12)
    const totalValue = `${activationValue}+${capValue}`

    releaseRoot.innerHTML = `${verdict('dp-prio-accepted', 'pass',
      'ALL COMMITTED REPORTS VERIFIED',
      `${claim('dp-accepted-count', built.length, String(built.length), 'span')} real Prio3 reports prepared successfully; no accepted subset was selected.`,
    )}${verdict('dp-release', 'pass',
      'ONE NOISY AGGREGATE RELEASED',
      'The collector receives the committed cohort size, public mechanism metadata, and one noisy sum.',
    )}<section class="dp-collector" aria-label="Collector-visible release">
      <h4>Collector-visible release</h4>
      <div class="dp-summary-grid">
        <div><span>COMMITTED REPORTS</span>${claim('dp-participant-count', collector.participantCount, String(collector.participantCount))}</div>
        <div><span>NOISY SUM</span>${claim('dp-protocol-noisy-units', collector.noisyQuantizedUnits, signedUnits(collector.noisyQuantizedUnits))}</div>
        <div><span>NOISY DOLLARS</span>${claim('dp-noisy-release-dollars', collector.noisyDollars, signedMoney(collector.noisyDollars, money))}</div>
      </div>
      <p>No exact total, per-client value, activation bit, or noise decomposition crosses this boundary.</p>
    </section>
    <section class="dp-accounting-panel" aria-label="Scenario privacy accounting">
      <h4>Scenario accounting assumptions</h4>
      <div class="dp-summary-grid">
        <div><span>DECLARED HONEST CLIENTS</span>${claim('dp-honest-count', honestCount, String(honestCount))}</div>
        <div><span>NO-HONEST-ACTIVATION δ</span>${claim('dp-delta-activation', activationValue, renderedFraction(accounting.noneActiveDelta.numerator, accounting.noneActiveDelta.denominator))}</div>
        <div><span>OUTPUT-CAP COUPLING δ (APPROX.)</span>${claim('dp-delta-cap', capValue, accounting.capCouplingDeltaApproximation.toExponential(3))}</div>
        <div><span>ADDITIVE ACCOUNTING TERMS</span>${claim('dp-delta-total', totalValue, `${renderedFraction(accounting.noneActiveDelta.numerator, accounting.noneActiveDelta.denominator)} + ${accounting.capCouplingDeltaApproximation.toExponential(3)}`)}</div>
      </div>
      <p class="dp-accounting">Honesty is an omniscient scenario label, not something a valid Prio3 proof attests. The cap decimal is a binary64 approximation to the analytic bound (1 + e<sup>ε</sup>)n · 2e<sup>−B/50</sup> / (e<sup>1/50</sup> + 1), and it is displayed separately because binary floating point cannot retain it when added to the activation term.</p>
    </section>
    <details class="dp-trace">
      <summary>Open omniscient teaching trace</summary>
      <h4>Not collector-visible</h4>
      <div class="dp-summary-grid">
        <div><span>EXACT QUANTIZED SUM</span>${claim('dp-exact-sum', teaching.exactQuantizedUnits, signedUnits(teaching.exactQuantizedUnits))}</div>
        <div><span>SUM OF CLIENT NOISE</span>${claim('dp-total-noise', teaching.totalNoiseUnits, signedUnits(teaching.totalNoiseUnits))}</div>
      </div>
      <div class="table-wrap" role="region" aria-label="Per-client omniscient teaching trace" tabindex="0"><table>
        <thead><tr><th scope="col">Participant</th><th scope="col">Role</th><th scope="col">Supplied</th><th scope="col">Clipped</th><th scope="col">q</th><th scope="col">Activation</th><th scope="col">Noise</th><th scope="col">Shifted input</th></tr></thead>
        <tbody>${teaching.contributions.map((row) => `<tr data-dp-participant="${row.participantId}" data-dp-integrity="${row.integrity}" data-dp-activation="${row.activation}"><th scope="row">${row.participantId}</th><td>${row.integrity === 'honest' ? 'honest scenario label' : 'corrupt, fixed zero noise'}</td><td>${claim('dp-row-raw-dollars', row.suppliedSalaryDollars, money(row.suppliedSalaryDollars), 'code')}</td><td>${claim('dp-row-clipped-dollars', row.clampedSalaryDollars, money(row.clampedSalaryDollars), 'code')}</td><td>${claim('dp-row-quantized-units', row.quantizedUnits, signedUnits(row.quantizedUnits), 'code')}</td><td>${claim('dp-row-activation', row.activation, row.activation, 'span')}</td><td>${claim('dp-row-noise-units', row.noiseUnits, signedUnits(row.noiseUnits), 'code')}</td><td>${claim('dp-row-shifted-input', row.shiftedContributionUnits, signedUnits(row.shiftedContributionUnits), 'code')}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`
  }

  const runRelease = (): void => {
    releaseButton.disabled = true
    const scenario = scenarioSelect.value as Scenario
    const plan = scenarioPlan(scenario)
    const participants = PAYROLL.slice(0, plan.participantCount)
    const batchId = `proof-tally-s04-batch-${String(++batchSequence).padStart(4, '0')}`
    const binding = createDistributedContextBinding(batchId, participants.map((participant) => participant.participantId))
    const built: BuiltParticipantReport[] = []

    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index]
      if (index < plan.honestCount) {
        const random = plan.forceCapOverflow && index === 0 ? capOverflowRandomSource() : undefined
        const report = createHonestParticipantReport(binding, participant, random)
        if (report.status === 'aborted') {
          activeAttempt = undefined
          repeatButton.disabled = true
          releaseRoot.innerHTML = verdict('dp-cap-refusal', 'reject',
            'WHOLE BATCH ABORTED',
            'An activated draw exceeded the declared output-magnitude cap; this UI did not retry it and no report set was released.',
          )
          status.textContent = 'The output-cap scenario ended without a release.'
          return
        }
        built.push(report.value)
      } else {
        built.push(createCorruptFixedZeroReport(binding, participant))
      }
    }

    const submissions = built.map((item) => completeDelivery(item.submission))
    if (plan.partialDelivery) submissions[submissions.length - 1] = {
      ...submissions[submissions.length - 1],
      delivery: 'leader-only',
    }
    const batch: CommittedBatch = {
      batchId,
      cohort: built.map((item) => ({
        participantId: item.submission.participantId,
        integrity: item.teachingTrace.integrity,
      })),
      submissions,
      aggregatorTrust: collusion.checked ? 'colluding' : 'non-colluding',
    }
    activeAttempt = { batch, built }
    repeatButton.disabled = false
    const result = releaseCommittedBatch(batch, ledger)
    if (result.status === 'released') {
      renderReleased(result, built)
      status.textContent = 'This committed batch has spent its one release attempt.'
    } else {
      releaseRoot.innerHTML = renderAbort(result.reason, verdict)
      status.textContent = 'This committed batch ended without a release and cannot be retried.'
    }
  }

  const runRepeat = (): void => {
    if (activeAttempt === undefined) return
    const result = releaseCommittedBatch(activeAttempt.batch, ledger)
    if (result.status === 'released') throw new Error('one-release ledger allowed the same batch twice')
    releaseRoot.innerHTML = renderAbort(result.reason, verdict)
    status.textContent = 'The one-release ledger refused the repeated batch.'
  }

  exactButton.addEventListener('click', renderExactDisclosure)
  releaseButton.addEventListener('click', runRelease)
  repeatButton.addEventListener('click', runRepeat)
  scenarioSelect.addEventListener('change', retireAttempt)
  collusion.addEventListener('change', retireAttempt)
}
