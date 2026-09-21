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
```

The correctness suite currently contains 32 Vitest tests. It includes the official
`XofTurboShake128`, `Prio3Count_0`, and `Prio3Sum_0` known-answer fixtures, exact serialized verifier
shares, malformed-input rejection, proof-share tampering, aggregation, Field64 boundaries, the
replay behaviour: that preparation accepts a replayed report a second time, that the unrefused replay
doubles the aggregate, and that the registry admits a nonce exactly once - and the verdict marker
registry described below.

The Playwright gate contains 19 tests. Two drive every reachable exhibit at desktop and 380px with
reduced motion, axe WCAG 2.1 A/AA, independent text-contrast and control-boundary oracles, and reflow
checks. Fourteen claims tests independently recompute the displayed verifier sum, payroll aggregate,
range boundary, KAT count and summary word, retirement behavior, the replayed-versus-single
aggregate, the preparation verdict against the displayed combined verifier, the tally match word
against the two displayed totals, the gadget-consistency refusal, the colluded reconstruction, and
both negative claims. Three verdict-coverage tests are described below.

## Every Verdict Is Computed, and Every Verdict Is Mutated

Nothing this page prints as an outcome is a fixed string. Each rendered verdict branches on a value
the page computed, and carries a `data-verdict` marker naming it:

`preparation` · `tally-match` · `range-attack` · `tamper-attack` · `replay-vdaf` · `replay-intake` ·
`collusion` · `valid-lie` · `valid-lie-row` · `single-report` · `kat-summary` · `kat-row`

Coverage is derived by walking the rendered page, not from a list kept by hand. `e2e/verdicts.spec.ts`
drives every exhibit and fails when:

- a rendered marker has no recorded mutation in `e2e/verdict-mutations.json`, or a recorded mutation
  names a marker the page no longer renders;
- verdict wording or verdict styling is rendered **outside** a marker - the shape a raw banner takes
  when someone adds one later. The spec injects exactly that banner, with and without the house
  styling, and fails if the audit does not catch it.

Each of the twelve markers has a §4.1c mutation recorded with the recipe that produces it:

```bash
node tools/verdict-mutation.mjs list
node tools/verdict-mutation.mjs apply <marker>    # forces that one verdict to the wrong answer
CI=1 npx playwright test                          # the named test must fail on its own assertion
node tools/verdict-mutation.mjs restore <marker>
```

`CI=1` matters: it turns off `reuseExistingServer`, so the suite cannot be served an unmutated
checkout by a server left running from an earlier pass.

The `verdict-coverage` job in `.github/workflows/deploy.yml` runs this gate as its own required
check, and `deploy` declares `needs: [build, verdict-coverage]`, so an uncovered verdict cannot
reach the live site even on a direct push to `main`.

## Performance

Prio3Sum proof work grows with the configured bit width. This lab uses a 24-bit payroll bound so each
interaction remains immediate while still exercising the real circuit, polynomial, XOF, and verifier
paths. It makes no production performance claim.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*