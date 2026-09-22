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

This is not production crypto. It is browser-based teaching code, is not constant-time, and does not
implement DAP transport or persistence.

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
6. **Pinned evidence** - run three browser-visible checks against the official Count and Sum vectors.

## When to Use It

Use a VDAF when multiple non-colluding aggregators need an aggregate over privately submitted,
well-formed measurements. Prio3 is useful for bounded sums, counters, and related telemetry where a
malformed report must not poison the result.

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
- A replayed report still passes preparation - its proofs are still correct, and the VDAF keeps no
  memory of reports it has seen - so the aggregate would count it twice. Replay is refused outside
  the VDAF; this lab's `NonceRegistry` rejects a 16-byte nonce it has already admitted.
- If both aggregators collude, they can reconstruct each input.
- A well-formed lie remains valid because the proof checks structure, not external truth.
- An aggregate over one report reveals that report unless a separate privacy mechanism is applied.
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
npx playwright install --with-deps chromium
npm run test:a11y
npm run test:verdicts
npm run test:kills     # slow; replays all 35 recorded mutations
```

The correctness suite currently contains 61 Vitest tests. It includes the official
`XofTurboShake128`, `Prio3Count_0`, and `Prio3Sum_0` known-answer fixtures, exact serialized verifier
shares, malformed-input rejection, proof-share tampering, aggregation, Field64 boundaries, the
replay behaviour: that preparation accepts a replayed report a second time, that the unrefused replay
doubles the aggregate, and that the registry admits a nonce exactly once - and the marker
registry described below.

The Playwright gate contains 24 tests. Two drive every reachable exhibit at desktop and 380px with
reduced motion, axe WCAG 2.1 A/AA, independent text-contrast and control-boundary oracles, and reflow
checks. Fifteen claims tests independently recompute the displayed verifier sum, payroll aggregate,
range boundary, KAT count and summary word, retirement behavior, the sharded envelopes, the replayed
tally summed over its rendered contributions, the preparation verdict against the displayed combined
verifier, the tally match word against the two displayed totals, the gadget-consistency refusal, the
colluded reconstruction, and both negative claims. Seven verdict-coverage tests, and one assertion
that runs after all of them, are described below.

## Every Verdict and Every Measurement Is Computed, Marked, and Mutated

Nothing this page prints as an outcome is a fixed string, and nothing it prints as a number is
unchecked. Each rendered verdict branches on a value the page computed and carries a `data-verdict`
marker; each rendered measurement carries a `data-claim` marker and the `data-value` behind the words.

Verdicts (12): `preparation` · `tally-match` · `range-attack` · `tamper-attack` · `replay-vdaf` ·
`replay-intake` · `collusion` · `valid-lie` · `valid-lie-row` · `single-report` · `kat-summary` ·
`kat-row`

Measurements (23): `report-measurement` · `leader-share` · `helper-share` · `verifier-a` ·
`verifier-b` · `combined-verifier` · `submitted-count` · `accepted-count` · `rejected-count` ·
`protocol-aggregate` · `plain-sum` · `collusion-share-a` · `collusion-share-b` · `lie-row-reported` ·
`lie-row-sealed` · `lie-aggregate` · `lie-truth` · `single-input` · `single-aggregate` · `kat-count` ·
`replay-contribution` · `replay-total` · `replay-tally-before`

Coverage is derived by walking the rendered page, not from a list kept by hand. `driveEveryState()`
visits **every option of every control that changes what renders** - both measurement types, the
measurement input unchanged, changed and empty, all three tabs, both fixture buttons, all three
attack buttons, and the collusion switch in both positions - each control on its own rather than the
cross-product. It is not a test; it is the denominator the rules below are applied to, so a state it
never reaches is outside all of them. The tab list's arrow keys and the limits panel's `<details>`
are skipped on purpose: they reach no markup the walk does not already hold.

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
baseline, then applies each of the 35 recorded mutations in turn and requires the test that record
names to go **red**. A survivor means the record is not evidence, whatever the source says and
whatever ran. It is slow — one rebuild and one gate run per record — so it is a command rather than
a CI step; run it after touching any oracle in `e2e/claims.spec.ts`. Last full run: **35 killed, 0
survived**, baseline green in the same session.

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

Each of the thirty-five markers has a §4.1c mutation recorded with the recipe that produces it:

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
paths. It makes no production performance claim.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*