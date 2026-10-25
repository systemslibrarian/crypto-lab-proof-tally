import {
  analyzeAbortRetry,
  compare,
  rationalKey,
  type Rational,
  type TranscriptEvent,
} from '../distributed/abortModel'

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

export interface AbortModelUiDependencies {
  claim: ClaimRenderer
  verdict: VerdictRenderer
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (found === null) throw new Error(`Missing required element: ${selector}`)
  return found
}

function renderedFraction(value: Rational): string {
  return value.denominator === 1n
    ? value.numerator.toLocaleString('en-US')
    : `${value.numerator.toLocaleString('en-US')} / ${value.denominator.toLocaleString('en-US')}`
}

function transcriptRows(events: readonly TranscriptEvent[], probability: (value: Rational) => string): string {
  return events.map((event) => `<tr data-abort-transcript-event="${event.label}">
    <th scope="row"><code>${event.label}</code></th>
    <td>${probability(event.d0)}</td>
    <td>${probability(event.d1)}</td>
  </tr>`).join('')
}

export function initializeAbortModelPanel({ claim, verdict }: AbortModelUiDependencies): void {
  const retryCap = element<HTMLSelectElement>('#abort-retry-cap')
  const runButton = element<HTMLButtonElement>('#abort-model-button')
  const status = element<HTMLParagraphElement>('#abort-model-status')
  const root = element<HTMLDivElement>('#abort-model-result')

  const probability = (value: Rational): string => claim('abort-probability',
    rationalKey(value),
    renderedFraction(value),
    'code',
  )
  const ratio = (value: Rational): string => claim('abort-ratio',
    rationalKey(value),
    renderedFraction(value),
  )

  const render = (): void => {
    const analysis = analyzeAbortRetry(Number(retryCap.value))
    const changedByConditioning = compare(
      analysis.conditionedOnPublication.envelope.tightRatio,
      analysis.ordinary.envelope.tightRatio,
    ) > 0
    const viewsSeparated = !analysis.observerBoundary.publicSeesRejectedCandidate
      && analysis.observerBoundary.outcomeAborterSeesCandidateBeforeDecision
      && !analysis.observerBoundary.independentAborterSeesCandidateBeforeDecision
      && analysis.observerBoundary.teacherSeesBothNeighborDistributions

    root.innerHTML = `<section id="abort-public-view" class="abort-view public-view" data-observer-view="public" aria-labelledby="abort-public-title">
      <h4 id="abort-public-title">Public analyst · complete observable transcript</h4>
      <p>The analyst sees a published value or the symbol <code>ABORT</code>, plus the ordered retry count. A rejected candidate is absent from this view.</p>
      <div class="abort-case-grid">
        <article data-abort-case="ordinary"><h5>Ordinary one release</h5><p>No abort decision. The tight neighboring likelihood ratio is ${ratio(analysis.ordinary.envelope.tightRatio)}.</p><small>Baseline: pure ln two differential privacy.</small></article>
        <article data-abort-case="selective"><h5>One selective-abort attempt</h5><p><span>D₀ ABORT</span>${probability(analysis.selectiveOneAttempt.abortProbability.D0)} <span>D₁ ABORT</span>${probability(analysis.selectiveOneAttempt.abortProbability.D1)}</p><p>Including <code>ABORT</code>, the tight ratio remains ${ratio(analysis.selectiveOneAttempt.envelope.tightRatio)}.</p><small>This whole output is postprocessing of one private candidate.</small></article>
        <article data-abort-case="conditioned"><h5>Publish only after success</h5><p><span>D₀ publishes zero</span>${probability(analysis.conditionedOnPublication.zeroProbability.D0)} <span>D₁ publishes zero</span>${probability(analysis.conditionedOnPublication.zeroProbability.D1)}</p><p>The normalized distribution has tight ratio ${ratio(analysis.conditionedOnPublication.envelope.tightRatio)}; at the original ratio, exact δ is ${probability(analysis.conditionedOnPublication.deltaAtOriginalRatio)}.</p><small>This conditions one attempt on publication—equivalently, eventual publication under unbounded fresh retries. It is not the one-attempt claim with visible ABORT.</small></article>
        <article data-abort-case="independent"><h5>Feedback-disabled control</h5><p>Each attempt uses a fresh independent abort coin with probability ${probability(analysis.feedbackDisabledControl.independentAbortProbability)}. Both neighbors reach the cap with probability ${probability(analysis.feedbackDisabledControl.allAbortProbability.D0)} and ${probability(analysis.feedbackDisabledControl.allAbortProbability.D1)}.</p><p>The complete transcript's tight ratio is ${ratio(analysis.feedbackDisabledControl.envelope.tightRatio)}.</p><small>Retries alone do not worsen this control because discarded candidates never drive visible decisions.</small></article>
      </div>
      <section class="abort-transcript" aria-labelledby="abort-transcript-title">
        <h5 id="abort-transcript-title">Outcome-dependent retry transcript · cap ${claim('abort-retry-cap', analysis.retryCap, `${analysis.retryCap} attempts`, 'span')}</h5>
        <p><code>A</code> is a visible abort and <code>P</code> is publication. The rows partition every public transcript; published positive values share one constant likelihood-ratio class.</p>
        <div class="table-wrap" role="region" aria-label="Complete capped selective-abort transcript" tabindex="0"><table>
          <thead><tr><th scope="col">Observed event class</th><th scope="col">Probability on D₀</th><th scope="col">Probability on D₁</th></tr></thead>
          <tbody>${transcriptRows(analysis.cappedSelectiveRetry.events, probability)}</tbody>
        </table></div>
        <p class="abort-bound">The tight full-transcript ratio is ${ratio(analysis.cappedSelectiveRetry.envelope.tightRatio)}. It is witnessed by <code>${analysis.cappedSelectiveRetry.envelope.witness}</code> in direction <code>${analysis.cappedSelectiveRetry.envelope.direction}</code>.</p>
      </section>
      ${verdict('abort-conditioned-bound', changedByConditioning ? 'alarm' : 'pass',
        changedByConditioning ? 'CONDITIONING CHANGES THE PRIVACY CLAIM' : 'CONDITIONING PRESERVES THE PRIVACY CLAIM',
        'Removing visible aborts and reporting only eventual success renormalizes the neighboring distributions; the original pure bound no longer applies.',
      )}
    </section>
    <aside class="abort-view aborter-view" data-observer-view="aborter" aria-labelledby="abort-aborter-title">
      <h4 id="abort-aborter-title">Aborter-only candidate view</h4>
      <p data-aborter-candidate="outcome-only">For the selective policy, this party sees candidate <code>s</code> before deciding whether <code>s ≤ ${claim('abort-threshold', analysis.threshold, analysis.threshold.toString(), 'span')}</code>. That rejected value is not public.</p>
      <p>In the feedback-disabled control, the aborter receives no candidate and flips an independent coin instead.</p>
    </aside>
    <details class="abort-view teacher-view" data-observer-view="teacher">
      <summary>Open omniscient exact ledger</summary>
      <div class="abort-teacher-copy"><h4>Teaching view · not an attacker view</h4><p>This view knows both neighboring truths, <code>f(D₀)=0</code> and <code>f(D₁)=1</code>, and enumerates their distributions. The paper does not grant an attacker both datasets or this ledger.</p><p>The mechanism uses <code>Pr[Z=z]=1/(3·2<sup>|z|</sup>)</code>. All fractions and tight ratios above are reduced with BigInt arithmetic; none is a sampled estimate.</p></div>
    </details>
    ${verdict('abort-view-boundary', viewsSeparated ? 'pass' : 'alarm',
      viewsSeparated ? 'OBSERVER VIEWS SEPARATED' : 'OBSERVER VIEW LEAKED',
      'The public transcript omits rejected candidates, the selective aborter sees one candidate at a time, and the omniscient ledger is labeled as teaching-only.',
    )}`
    status.textContent = 'Fresh exact ledger computed. Changing the retry cap retires it.'
  }

  retryCap.addEventListener('change', () => {
    root.replaceChildren()
    status.textContent = 'Retry cap changed; the prior exact ledger was retired.'
  })
  runButton.addEventListener('click', render)
}
