# Proof Tally

## What It Is

Proof Tally is an interactive implementation of `Prio3Count` and `Prio3Sum` from
[`draft-irtf-cfrg-vdaf-22`](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-vdaf-22),
published 14 August 2026. A client splits each measurement and its fully linear proof between two
aggregators. Neither aggregator receives the measurement, but together their verifier shares reject
a malformed report before it enters the aggregate.

The teaching implementation uses the draft's Field64 arithmetic and TurboSHAKE128 XOF with domain
byte `D=1`. Its deterministic tests are pinned to CFRG reference commit
[`e1d1e1c3854a34589c0c2d9b899a48533cac9004`](https://github.com/cfrg/draft-irtf-cfrg-vdaf/tree/e1d1e1c3854a34589c0c2d9b899a48533cac9004),
tagged `draft-irtf-cfrg-vdaf-22`.

A separate distributed differential-privacy lesson composes real `Prio3Sum` reports with bounded,
participant-contributed discrete-Laplace noise. It clamps and quantizes every record before
aggregation, fixes replace-one adjacency and sensitivity, samples with the exact integer-only
Canonne-Kamath-Steinke algorithms, and releases at most once from an all-or-nothing committed
cohort. This is a Shi-inspired teaching composition, not an implementation of Shi et al.'s private
stream aggregation system, DAP, or shuffle DP.

A second, separately labeled lesson studies abort observability using the outcome-leakage model in
Meisingseth's *On Aborts in Differential Privacy*. It does not modify or attack the Prio3 route. An
exact sensitivity-one additive mechanism on two neighboring datasets uses
`Pr[Z=z] = 1/(3*2^|z|)`, then compares a public `ABORT`, success-conditioned publication, a visibly
capped retry transcript, and an abort coin independent of the candidate. Every probability and
likelihood ratio is reduced with `BigInt` rational arithmetic; this path performs no sampling.

This is not production crypto. It is browser-based teaching code, is not constant-time, and does not
implement DAP transport or persistence. All three roles share one browser process, where the fixed
demonstration verification key is visible to client code; this does not reproduce the draft's
verification-key secrecy or secure-channel assumptions.

## Exhibits

1. **One report, two envelopes** - enter a Count or bounded Sum measurement, shard it, inspect each
	aggregator's separate inputs, combine verifier shares, and add the accepted output shares.
2. **Synthetic payroll** - run twelve reports and compare the protocol aggregate with an independently
	computed plain sum.
3. **Break it yourself** - inject a four-billion-unit value into a 24-bit circuit, flip a proof-share
	field element, replay a report, or collude both aggregators. The replay submits one report twice:
	preparation runs on the duplicate and accepts it again, and the nonce registry outside the VDAF is
	what refuses it.
4. **Valid and false** - submit a correctly proven salary of zero when the sealed truth is nonzero.
	Every Prio3 check passes and the aggregate is still false.
5. **One-report disclosure** - demonstrate that private input shares do not make a one-person aggregate
	differentially private.
6. **Exact-release differencing** - run two real, equal-size twelve-slot `Prio3Sum` queries with one
	bounded slot replaced by zero, and recover that slot by subtracting the exact totals.
7. **Distributed-noise release** - clamp salaries to `$0..$250,000`, floor them to `$5,000` units,
	contribute independently activated exact discrete-Laplace noise inside the reports, and expose only
	the one noisy aggregate to the collector.
8. **Abort and retry observer model** - compare one ordinary release, one outcome-dependent abort
	with `ABORT` in the full output, publication conditioned on success, a complete capped-three retry
	transcript, and a feedback-disabled independent-abort control.
9. **Pinned evidence** - run three browser-visible checks against the official Count and Sum vectors.

## When to Use It

Use a VDAF when multiple non-colluding aggregators need an aggregate over privately submitted,
well-formed measurements. Prio3 is useful for bounded sums, counters, and related telemetry where a
malformed report must not poison the result.

Use the distributed lesson to study how output privacy needs an independently specified adjacency,
sensitivity, sampler, honest-contributor threshold, dropout rule, privacy ledger, and collector
view in addition to secure aggregation. Its deliberately small cohort and large visible error make
the privacy-utility tradeoff inspectable rather than deployment-ready.

Use the abort model to study why the complete observable transcript and the identity of the party
that sees a candidate must be specified before assigning a privacy claim. It is a bounded exact
example, not a claim that every abort is unsafe or that it reproduces an abort attack on Prio3.

Do not use this lab as a deployment library. Do not use Prio3 alone when the output also needs
differential privacy, when both aggregators may collude, or when authenticity and truthfulness of the
underlying measurement are required.

## Live Demo

[Open Proof Tally on GitHub Pages](https://systemslibrarian.github.io/crypto-lab-proof-tally/).

The page runs entirely in the browser. It creates fresh report randomness, prepares real verifier
shares, and combines accepted output shares without a backend.

## What Can Go Wrong

- An out-of-range or malformed report is rejected when the combined verifier is nonzero.
- A changed proof share fails the gadget-consistency check.
- A real deployment must keep the verification key secret from clients and commit to it before
  processing reports. This single-process lab deliberately does neither.
- A replayed report still passes preparation - its proofs are still correct, and the VDAF keeps no
  memory of reports it has seen - so the aggregate would count it twice. Replay is refused outside
  the VDAF; this lab's `NonceRegistry` rejects a 16-byte nonce it has already admitted.
- If both aggregators collude, they can reconstruct each input.
- A well-formed lie remains valid because the proof checks structure, not external truth.
- An aggregate over one report reveals that report unless a separate privacy mechanism is applied.
- Exact full-cohort and fixed-size replacement totals disclose the replaced bounded contribution by
  subtraction; input-share secrecy does not change that output fact.
- The exact-disclosure control and distributed-noise control are alternative teaching worlds. Once
  an exact overlapping total has been released, adding noise to a later answer cannot restore the
  privacy that the exact releases already lost.
- Each selectable participant scenario is likewise a separate counterfactual teaching world. The
  page retires the prior view when a control changes; its outputs must not be combined as repeated
  answers about the fixed synthetic payroll. A real deployment must compose every answer over
  overlapping records.
- The distributed lesson clamps each salary to `$0..$250,000`, floors it to `$5,000` units, and uses
  fixed-size replace-one sensitivity `50`. Changing the record unit or adjacency changes the
  calibration.
- Each honest included client activates a full `Lap_Z(50)` draw with probability `9/10`. Exactly six
  honest clients make the no-activation event `10^-6`; at least six make it at most `10^-6`, five
  make it `10^-5`, and zero make the bound vacuous. Accepted reports do not prove which clients are
  honest.
- A sampled magnitude of `4096` is allowed. A magnitude above `4096`, an incomplete cohort, a
  duplicate, or a rejected report aborts the batch without releasing a total. The UI abandons the
  batch after a cap failure and never resamples that draw; the low-level report builder itself is not
  a durable attempt ledger. The output-magnitude cap adds the analytic total-variation coupling
  bound `(1 + exp(epsilon)) * eta` to delta, where
  `eta = n * 2*exp(-B/50)/(exp(1/50)+1)`. The separately displayed decimal is explicitly a
  binary64 approximation to that expression; the exact rejection
  sampler itself has unbounded but almost-surely terminating runtime and no hidden attempt ceiling.
- The shift by `4096` lets `Prio3Sum(8242)` prove only the combined input is in range. It does not
  prove a truthful salary, correct clipping, a valid value/noise decomposition, an activation coin,
  or independent random sampling. Corrupt clients can submit valid false values or fixed noise and
  destroy utility.
- The common Prio3 context binds the batch identifier, full ordered roster, and fixed mechanism, but
  a report carries no authenticated sender-to-slot credential. `participantId` and `integrity` are
  wrapper metadata in this counterfactual harness; the latter is explicitly omniscient and neither
  is attested by Prio3. Production intake must authenticate one sender to one committed roster slot
  before invoking the release policy.
- Corrupt submissions must be fixed before the adversary can learn the honest clients' hidden
  activation bits or noise. An adversary allowed to observe that noise and then choose a canceling
  valid input is outside this privacy argument; a real protocol must enforce the required commit and
  message ordering.
- Both aggregators colluding reconstruct each shifted client contribution. Aggregate-view privacy
  requires at least one honest aggregator that does not collude, enforcement of the common committed
  cohort and one-release ledger, and no later disclosure of the honest noise. Fewer than six honest
  noise contributors invalidate the advertised activation-failure term `delta <= 10^-6`, though an
  `h`-specific weaker term may remain; the displayed total also adds the cap-coupling term.
- A committed batch has one release. Releasing it again, changing subsets, or answering overlapping
  exact queries needs explicit composition accounting; a nonce registry alone does not stop
  differencing. The browser ledger is volatile teaching state: a reload resets it, and the lab does
  not implement durable, atomic, multi-worker enforcement.
- In the separate abort model, `f(D0)=0`, `f(D1)=1`, and the ordinary additive mechanism is tight
  pure `ln(2)`-DP. If an outcome-only aborter suppresses candidates at or below `-1`, one attempt
  remains tight at ratio `2` when public `ABORT` is part of the output. That entire output is
  postprocessing of one private candidate, so the existence of an abort does not itself break DP.
- Conditioning one attempt on publication—equivalently, reporting eventual success under unbounded
  fresh retries—produces a different distribution. Its tight ratio is
  `5/2`; if the original ratio `2` is retained, the exact necessary additive term is `delta=1/10`.
  The complete capped-three public transcript records every visible abort and retry and is tight at
  ratio `8`, consistent with ordinary three-fold sequential composition. These are direct exact
  calculations for this bounded-retry teaching model, not a claim of the paper's general bounds.
  The noise itself has infinite integer support; the complete table groups that support into event
  classes on which the likelihood ratio is constant.
- The feedback-disabled control uses a fresh independent abort coin on every attempt, independent of
  the hidden candidate. Its
  complete capped transcript remains tight at ratio `2`, because visible retry count is independent
  of the dataset and only one published candidate carries dataset-dependent information. The public
  analyst never receives rejected candidate values; the outcome aborter sees one before deciding;
  the two-neighbor ledger is an explicitly omniscient teaching view.
- Zero accepted reports have no defined aggregate and are refused.

## Real-World Usage

Prio introduced private, robust aggregate statistics at scale. VDAFs generalize that construction for
systems such as Distributed Aggregation Protocol deployments. Proof Tally deliberately omits DAP's
HTTP transport and task orchestration so the report, proof, verifier, and aggregation mechanics stay
inspectable.

Primary references:

- [Verifiable Distributed Aggregation Functions, draft-22](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-vdaf-22)
- [KangarooTwelve and TurboSHAKE, RFC 9861](https://www.rfc-editor.org/rfc/rfc9861.html)
- [Prio: Private, Robust, and Scalable Computation of Aggregate Statistics](https://www.usenix.org/conference/nsdi17/technical-sessions/presentation/corrigan-gibbs)
- [Zero-Knowledge Proofs on Secret-Shared Data via Fully Linear PCPs](https://eprint.iacr.org/2019/188)
- [Distributed Aggregation Protocol](https://datatracker.ietf.org/doc/html/draft-ietf-ppm-dap)
- [Privacy-Preserving Aggregation of Time-Series Data](https://www.ndss-symposium.org/wp-content/uploads/2017/09/shi.pdf)
- [The Discrete Gaussian for Differential Privacy](https://arxiv.org/abs/2004.00010) - its Algorithms
  1 and 2 provide the exact Bernoulli and discrete-Laplace sampler used here
- [NIST SP 800-226, Guidelines for Evaluating Differential Privacy Guarantees](https://doi.org/10.6028/NIST.SP.800-226)
- [On Aborts in Differential Privacy, ePrint 2026/2059](https://eprint.iacr.org/2026/2059), received
  16 September and approved 18 September 2026. This lesson uses the aborting-mechanism and leakage
  definitions in §3
  (Definitions 5–7, PDF pp. 10–11), the single-aborter accounting in §3.1 (Lemma 1 and Theorem 1,
  pp. 11–12), and the success-conditioned conversion in §4.3 (Theorem 5, pp. 17–18). The paper's
  attacker model is abstract; it does not analyze this lab's Prio3 construction. The capped retry
  transcript and independent-feedback control here are explicit finite adaptations, derived and
  tested directly rather than presented as reproductions of a paper theorem.

## How to Run Locally

Requires Node.js 22 or later.

```bash
npm ci
npm run dev
```

For the production build:

```bash
npm run build
npm run preview -- --port 4686
```

## Related Demos

- [Silent Tally](https://systemslibrarian.github.io/crypto-lab-silent-tally/) - private aggregation vocabulary
- [DP Noise](https://systemslibrarian.github.io/crypto-lab-dp-noise/) - privacy for released aggregates
- [Jevil](https://systemslibrarian.github.io/crypto-lab-jevil/) - Goldilocks field arithmetic

## Build & Verify

```bash
npm test
npm run build
npx playwright install chromium
npm run test:a11y
npm run test:verdicts
npm run test:kills     # slow; replays all 70 recorded mutations
```

The suite currently contains 170 Vitest tests. It includes the official
`XofTurboShake128`, `Prio3Count_0`, and `Prio3Sum_0` known-answer fixtures, exact serialized verifier
shares, malformed-input rejection, proof-share tampering, aggregation, Field64 boundaries, the
replay behaviour: that preparation accepts a replayed report a second time, that the unrefused replay
doubles the aggregate, and that the registry admits a nonce exactly once - and the marker
registry described below, plus strict 16-byte report-nonce handling and input snapshotting. Sixty
focused S04 tests cover exact integer sampling, both cap endpoints, cap abort without retry,
clamp/quantization and wrap bounds, exact differencing, real `Prio3Sum(8242)` preparation, signed
post-unshard decoding, all-or-nothing delivery, corrupt/honest thresholds, one-release state, and
canonical binding of the batch, ordered cohort and every fixed mechanism parameter.

Thirteen focused abort-model tests cover reduced rational arithmetic, the exact two-sided geometric
PMF and tails, both neighboring shifts, transcript normalization, a deliberately incomplete
distribution, one-attempt postprocessing, success conditioning, all capped-three event classes,
the independent-feedback control, observer boundaries, smaller caps, and rejected cap inputs.

The Playwright gate contains 35 tests. Two drive every reachable exhibit at desktop and 380px with
reduced motion, axe WCAG 2.1 A/AA, independent text-contrast and control-boundary oracles, and reflow
checks. Five state-integrity tests also cover keyboard navigation across all four tabs, retirement
of a distributed collector view when its scenario changes, and retirement of the exact abort ledger
when its attempt cap changes. Twenty-one claims tests independently
recompute the displayed verifier sum, payroll aggregate,
range boundary, KAT count and summary word, retirement behavior, the sharded envelopes, the replayed
tally summed over its rendered contributions, the preparation verdict against the displayed combined
verifier, the tally match word against the two displayed totals, the gadget-consistency refusal, the
colluded reconstruction, both negative claims, exact-release differencing, every distributed input
transformation, the noisy aggregate, and both additive delta terms. They also prove that corruption,
dropout, collusion, cap overflow and a repeated batch release produce no aggregate. The abort-model
claim test independently rebuilds all displayed rational probabilities and tight ratios, sums both
capped transcript distributions to one, checks the attempt count and threshold, and proves that
rejected candidates do not enter the public analyst view. Seven
verdict-coverage tests, and one assertion that runs after all of them, are described below.

## Every Verdict and Every Measurement Is Computed, Marked, and Mutated

Nothing this page prints as an outcome is a fixed string, and nothing it prints as a number is
unchecked. Each rendered verdict branches on a value the page computed and carries a `data-verdict`
marker; each rendered measurement carries a `data-claim` marker and the `data-value` behind the words.

Verdicts (22): `preparation` · `tally-match` · `range-attack` · `tamper-attack` · `replay-vdaf` ·
`replay-intake` · `collusion` · `valid-lie` · `valid-lie-row` · `single-report` · `kat-summary` ·
`kat-row` · `dp-exact-disclosure` · `dp-prio-accepted` · `dp-release` · `dp-threshold-refusal` ·
`dp-dropout-refusal` · `dp-repeat-refusal` · `dp-collusion-refusal` · `dp-cap-refusal` ·
`abort-conditioned-bound` · `abort-view-boundary`

Measurements (48): `report-measurement` · `leader-share` · `helper-share` · `verifier-a` ·
`verifier-b` · `combined-verifier` · `submitted-count` · `accepted-count` · `rejected-count` ·
`protocol-aggregate` · `plain-sum` · `collusion-share-a` · `collusion-share-b` · `lie-row-reported` ·
`lie-row-sealed` · `lie-aggregate` · `lie-truth` · `single-input` · `single-aggregate` · `kat-count` ·
`replay-contribution` · `replay-total` · `replay-tally-before` · `dp-exact-full` ·
`dp-exact-neighbor` · `dp-disclosed-contribution` · `dp-exact-raw-dollars` ·
`dp-exact-clipped-dollars` · `dp-row-raw-dollars` · `dp-row-clipped-dollars` ·
`dp-row-quantized-units` · `dp-row-activation` · `dp-row-noise-units` · `dp-row-shifted-input` ·
`dp-accepted-count` ·
`dp-participant-count` · `dp-honest-count` · `dp-protocol-noisy-units` ·
`dp-noisy-release-dollars` · `dp-exact-sum` · `dp-total-noise` · `dp-delta-activation` ·
`dp-delta-cap` · `dp-delta-total` · `abort-threshold` · `abort-retry-cap` ·
`abort-probability` · `abort-ratio`

Coverage is derived by walking the rendered page, not from a list kept by hand. `driveEveryState()`
visits **every option of every control that changes what renders** - both measurement types, the
measurement input unchanged, changed and empty, all four tabs, both fixture buttons, all three
attack buttons, all seven distributed scenarios, exact differencing, successful and repeated
release, all three abort-model retry caps, and both collusion switches in both positions - each control on its own rather than the
cross-product. It is not a test; it is the denominator the rules below are applied to, so a state it
never reaches is outside all of them. The tab list's arrow keys and the limits/trace `<details>`
controls are skipped on purpose: they change visibility but introduce no new rendered markup.

`e2e/verdicts.spec.ts` drives that walk, and it and the teardown that runs after every test
fail when:

- a rendered marker of **either** family has no recorded mutation in `e2e/verdict-mutations.json`, or
  a recorded mutation names a marker the page no longer renders;
- verdict wording or verdict styling is rendered **outside** a marker - the shape a raw banner takes
  when someone adds one later. The spec injects exactly that banner, with and without the house
  styling, and fails if the audit does not catch it;
- a **measurement** is rendered outside a marker in any result region: digit-plus-unit text, or a
  bare number. A number carries none of the signals the banner rules look for, and is the easier
  mistake to make. The spec injects one of those too;
- a recorded mutation's killing assertion **did not run**. `expectVerdict()` / `expectClaim()`
  assert a marker's text **and** its state (`data-result` plus the class that paints it) in one
  call, so a mutation that flips the sentence while the pass styling stays cannot be recorded as a
  kill. `valid-lie-row`'s recorded mutation is exactly that shape: it flips only the paint, leaves
  the word `VALID` standing, and is killed on the class.

  **That last rule used to be a substring scan over the spec's source, and a scan enforces a
  mention, not an execution.** With the call commented out, `expectVerdict(page, 'tamper-attack'`
  still appeared in `claims.spec.ts`, the rule stayed green, and the page shipped
  `ADMITTED WITH A FLIPPED PROOF SHARE`, painted alarm, for a report whose proof share had been
  changed — with the recorded kill and the coverage test that polices it both green. A call in dead
  code and a call in a neighbouring test read the same way to a scan.

  So the helpers now write down the `(spec file, test title, marker)` triple they are entered with,
  into a run-scoped sink under `.verdict-run/` that `globalSetup` empties and stamps first, and
  `globalTeardown` requires every recorded mutation's triple to be in it. Playwright runs spec files
  in separate worker processes, so nothing inside a test could see this; the teardown is where the
  whole run's record exists, it is guaranteed to run last, and a throw there fails the run.

A verdict record also pins the state its marker paints on a healthy page, and the check compares
that pin to the state the killing test **handed** the helper. That catches the other half of the
same defect: a call that runs but was fed values read off the page in the same test. Such a call
asserts whatever the page says and therefore passes under every mutation — but its expectation moves
with the page, and a moving expectation no longer matches the pin.

**What that still does not reach, and what closes it.** A measurement has no state to pin. Its
expected value is derived per run, and writing one into the registry would put back exactly the
literal a derived oracle exists to remove. On an unmutated page a tautological `expectClaim()` is
observationally identical to a correct one, so no rule read on a green run can separate them. Only a
differential can, and that is `npm run test:kills` (`tools/verdict-kill.mjs`): it re-establishes the
baseline, then applies each of the 70 recorded mutations in turn and requires the test that record
names to go **red**. A survivor means the record is not evidence, whatever the source says and
whatever ran. It is slow — one rebuild and one gate run per record — so it is a command rather than
a routine CI step. S04 delivery ran it once through a temporary PR-only workflow, which was removed
after its evidence was recorded. [Hosted run 40123033025](https://github.com/systemslibrarian/crypto-lab-proof-tally/actions/runs/40123033025)
reported `baseline green, 27 specs` and then `64/64 killed, 0 survived, 0 neither` for the reviewed
tree. PR-06 replayed its six new abort/retry records through the same isolated runner before its
temporary workflow was removed. [Hosted run 40203649860](https://github.com/systemslibrarian/crypto-lab-proof-tally/actions/runs/40203649860)
reported `baseline green, 28 specs` and then `6/6 killed, 0 survived, 0 neither`. Run it locally
after touching any oracle in `e2e/claims.spec.ts`. Delivery requires a green
unmutated baseline and every one of the 70 mutations killed in the same replay session.

Where a total is summed over a list, the oracle sums the rendered list rather than multiplying one
entry by a count - the payroll tally, the valid-lie ledger, and the replay tally all derive their
expected total that way.

**A number rendered inside a verdict is still a measurement.** The replay verdict's own sentence
quotes two money figures, and they escaped all three rules at once: the stray-number scan skips them
because they are already inside a marker, they carried no marker of their own, and the verdict's
assertion reads its heading and its state rather than its detail. Corrupting both by `+999` left the
whole gate green. They are now marked — `replay-tally-before` for the figure the tally moves from,
and `replay-total` reused for the figure it moves to, since that is the same claim the ledger states
— and `expectClaim()` holds both `replay-total` nodes to the one derived total.

Each of the seventy markers has a §4.1c mutation recorded with the recipe that produces it:

```bash
node tools/verdict-mutation.mjs list
node tools/verdict-mutation.mjs apply <marker>    # forces that one verdict to the wrong answer
CI=1 npx playwright test                          # the named test must fail on its own assertion
node tools/verdict-mutation.mjs restore <marker>

node tools/verdict-kill.mjs verify                # or all of them, checked automatically
node tools/verdict-kill.mjs verify <marker>…
```

`CI=1` matters: it turns off `reuseExistingServer`, so the suite cannot be served an unmutated
checkout by a server left running from an earlier pass.

The `verdict-coverage` job in `.github/workflows/deploy.yml` runs this gate as its own required
check, and `deploy` declares `needs: [build, verdict-coverage]`, so an uncovered verdict or
measurement cannot reach the live site even on a direct push to `main`.

**One thing this gate cannot decide, and what the page says because of it.** The replay exhibit
submits the same report twice, so its two contributions are equal by construction and summing them
is observationally identical to doubling one. A page rewritten to multiply the first contribution by
the contribution count passes every test here, and was run to confirm it. What the summed oracle
does buy is that no literal `2` remains in the spec, the per-submission contributions are rendered
and counted, and a page that aggregates only the first submission is killed (`replay-total`).

So the sentence beside that number claims scope and not arithmetic. It reads *Across the submissions
preparation accepted, the tally holds …*; it used to read *Summed over …*, and that word was the one
thing in it no test here could back. The rule it is an instance of: **if the page cannot show the
difference, it cannot claim it.** Making the claim provable means rendering a case where the sum and
the product differ — unequal contributions, or a third submission — which changes what the exhibit
teaches and is a deliberate design decision rather than a harness fix.

## Performance

Prio3Sum proof work grows with the configured bit width. This lab uses a 24-bit payroll bound so each
interaction remains immediate while still exercising the real circuit, polynomial, XOF, and verifier
paths. The distributed lesson's stronger six-honest activation bound deliberately adds noise whose
scale is large relative to a twelve-person payroll; the page reports the observed error and makes no
production utility or performance claim.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
