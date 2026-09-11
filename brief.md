# Proof Tally — build brief for `crypto-lab-proof-tally`

Save this file as `brief.md` at the root of `crypto-lab-proof-tally`. The binding spec is the copy of `_MASTER-TEMPLATE.md` in this repo (status 2026-08-02); this brief supplies only the demo-specific facts. Where the two touch, the template wins; where the template and the catalog `CLAUDE.md` touch, `CLAUDE.md` wins. If `audits/kickoff.md` is also present in this repo, it may be used instead of the prompt below — it reads `./brief.md` itself.

## Kickoff prompt — paste this, with the template in the repo

```text
Build a new Crypto Lab browser demo (Vite + TypeScript, static site, no backend).

Read _MASTER-TEMPLATE.md (copied into this repo — check audits/ and the repo root) in
full and treat it as the BINDING spec. Build to every standard in it, in this order:

  1. §1 Build — real crypto only (WebCrypto or a named, justified library; hand-roll
     the inspectable teaching parts; NEVER simulate or fake math). Runnable tests that
     actually pass, including spec KATs (state the count). Mount content at id="app";
     define --accent on :root.
  2. §3 Look — add the standard top bar (copy the header from any existing lab and
     adapt it) and the standardized hero (short-name <h1> + spec subtitle + "Why it
     matters" box beside it; title size capped at clamp(1.6rem,3.8vw,2.7rem)); theme
     contract; scripture footer; head/favicon. Do NOT invent a new header design and do
     NOT add a theme toggle — match the fleet's cl-topbar.
  3. §2 Teach — SHOW the one headline mechanism (animate/step it, never assert it in
     prose or raw hex); add a plain-language "what is this / why it matters" intro and a
     break-it-yourself interaction against the real crypto; no decorative/idle animation;
     pitch to a college newcomer while rewarding an expert (progressive disclosure).
  4. §4 Accessibility — wire the WCAG 2.1 AA gate and author to its checklist.
     `npm run build` then `npm run test:a11y` MUST pass with zero violations.
  5. §5 README (the standard sections) and §6 Deploy (Actions-based Pages, a11y-gated).
  6. §6.1 + §6.2 Dependency automation — REQUIRED, not optional. Ship
     .github/dependabot.yml with the grouped config, add the dependabot-auto-merge job
     to whichever workflow runs the gate on pull_request, and have that job dispatch the
     deploy after it merges. Also: the workflow must trigger on pull_request as well as
     push, the deploy job must be gated to `github.event_name != 'pull_request'`, the concurrency
     group must include ${{ github.ref }}, and the deploy workflow must accept
     workflow_dispatch. Omitting any of these is how a lab starts opening one pull request
     per dependency with no CI signal on any of them.

Hard rules: do NOT dumb down the crypto to make a visual simpler; honest scoping in-page
and in the README ("not production", what's real vs simulated, what it does NOT prove).
Do NOT weaken a gate to get a green run — no skipped tests, no lowered coverage threshold,
no disabled lint rule, no re-recorded a11y baseline, no continue-on-error. If a bump or a
change cannot pass honestly, leave it failing and say so.
When done, report a one-line summary with the test count, and confirm all four of
grouping / auto-merge / PR gate / workflow_dispatch are present.

The rest of ./brief.md — the §1 sections, hero copy, claims suite, negative claim,
pre-build verification and citations below the DEMO BRIEF — is part of this brief.
Read it in full before building; run its pre-build checks first and report them.

DEMO BRIEF:
NEW DEMO BRIEF
- Repo name:         crypto-lab-proof-tally
- Short name (H1):   Proof Tally
- Subtitle:          Verifiable aggregation · Prio3 · draft-irtf-cfrg-vdaf
- One-liner:         Runs Prio3Count and Prio3Sum from the CFRG VDAF draft — secret-shared measurements carrying a fully linear proof that two aggregators verify from their shares — so a malformed report is rejected without either aggregator seeing any report.
- Concept to teach:  Secret sharing hides a measurement and happily adds a lie. A fully linear proof lets the aggregators check that each split report is well-formed while still seeing nothing of it: validity and privacy from the same shares.
- Primitives/spec:   draft-irtf-cfrg-vdaf — pin the version number and date at build time and cite the pinned version everywhere; Prio3Count and Prio3Sum; Field64 (modulus 2^32 · 4294967295 + 1, the Goldilocks prime — cross-link Jevil); XofTurboShake128 as the draft's recommended XOF, via @noble/hashes (sha3-addons) or another named library; the FLP gadget and circuit definitions of the pinned version; the pinned version's test vectors (appendix and the reference-implementation repository, cited by commit). Theory: Corrigan-Gibbs & Boneh, "Prio: Private, Robust, and Scalable Computation of Aggregate Statistics", NSDI 2017; Boneh, Boyle, Corrigan-Gibbs, Gilboa, Ishai, "Zero-Knowledge Proofs on Secret-Shared Data via Fully Linear PCPs", CRYPTO 2019.
- Accent (--accent): #7BE495
- Favicon emoji:     🧮
- In scope:          Client sharding (measurement → input shares, proof shares, joint-randomness parts) exactly per the pinned draft; two aggregators' preparation (verifier shares → combined verifier → accept / reject); aggregation; unsharding at a collector. Prio3Count (0/1) and Prio3Sum (bounded integer, bit-decomposed). A payroll scenario: check whether DP Noise's twelve-person payroll is reusable and, if so, reuse the same names and values so the two labs read as one story; otherwise a labelled synthetic payroll. Break-it-yourself: a client reports 4,000,000,000 for a Sum with the configured bit width → rejected at preparation; a flipped bit in a proof share → rejected; a collusion toggle (both aggregators' shares in one place → inputs revealed, marked as the trust assumption). Compute-both-sides: the protocol's aggregate versus the plain sum of the accepted honest inputs, byte equality.
- Non-goals:         DAP transport and HTTP; Poplar1 and IDPF; Prio3SumVec and Prio3Histogram (extension seams); differential privacy on the output (cross-link DP Noise); more than two aggregators; robustness claims beyond what the pinned draft states.
```

## Rules this brief follows — keep them while building

This brief asserts no counts about the catalog. Every "the catalog has / lacks X" sentence is written as a grep to run, because the author could not run it. Run each pre-build check and report the result before writing code. If a grep shows the headline mechanism is already taught by a live card, stop and report; do not build a duplicate.

In addition to this lab's own sections below:

1. Port: `grep -rhoE "localhost:[0-9]+" ../crypto-lab-*/playwright.config.ts | sort -u`, pick an unused port in 4600–4700, commit it (template §4.1). Never the Vite default 4173.
2. Accessibility gate: copy `e2e/gate.ts`, `contrast.ts`, `nontext.ts`, `nontext-baseline.ts`, `a11y.spec.ts` from `crypto-lab-schnorr-forge` and rewrite every lab-specific passage (§4.1). Do not copy the gate from any other lab.
3. Claims suite in `e2e/claims.spec.ts` (§4.1b), mutation discipline (§4.1c), and the negative claim with its evidence fixture (§4.1d). The twin-verdict wording in this brief is a shape, not a string to hard-code.
4. README per §5; deploy per §6 with `.github/dependabot.yml`, the auto-merge job, the deploy dispatch, `timeout-minutes` on the job, `LICENSE`, `.gitignore`.
5. After the lab is live: the catalog card, then the five checkers run from the catalog repo (`readme-sync`, `corpus-sync`, `concept-sync`, `theme-sync`, `fleet-sync`). That step is done in `crypto-lab/`, not here; do not edit shared catalog files from this repo.
6. Category placement below is a proposal. Check the live chip list and section list before adding a chip; if a proposed chip does not exist, report the resulting chip-bar split rather than creating it silently. If the catalog keeps a concept-coverage document, the new concept boundary is added there in the same commit as the card.
7. Each non-goal in the SCOPE list gets its one-line "what this isn't" note in the UI (§1).
8. No emoji anywhere in content; the favicon data-URI is the only sanctioned use.
9. Every hard citation below was checked against its primary source on 2026-09-10 except where marked "verify" — resolve those before the README cites them. Do not cite anything the README cannot link.

**Accent.** This lab's `--accent` is ``#7BE495``, assigned centrally for the seven-lab batch of 2026-09-10. The other six batch accents are reserved — do not use them:

| Lab | Repo | `--accent` |
|---|---|---|
| Hidden Bit | crypto-lab-hidden-bit | ``#E4572E`` |
| Privacy Pass | crypto-lab-privacy-pass | ``#F2C14E`` |
| Order Leak | crypto-lab-order-leak | ``#A06CD5`` |
| Split Point | crypto-lab-split-point | ``#4CC9F0`` |
| PQXDH Wire | crypto-lab-pqxdh-wire | ``#FF7EB6`` |
| Fold Gate | crypto-lab-fold-gate | ``#5E7CE2`` |

If `theme-sync` reports an adjacent-card collision after the card is placed, change this lab's accent, never the neighbour's, and record the change in the batch document.

## Hero

- Title: `Proof Tally`
- Subtitle: `Verifiable aggregation · Prio3 · VDAF`
- Description: Split a salary into two shares, each carrying half a proof, watch two aggregators hold their halves up to the light and accept the total without either reading a number — then submit a four-billion-dollar salary and watch it bounce.
- Why it matters: Private telemetry is only useful if one liar cannot poison the total. Every earlier "the servers never see your data" design let a single malformed report do exactly that; this one rejects it while still seeing nothing.

## §1 sections

**SCOPE** — as in the brief.

**SECURITY / CORRECTNESS INVARIANTS**
1. The pinned draft's test vectors for Prio3Count and Prio3Sum pass; state the count and the draft version and date beside it.
2. Each aggregator module receives exactly its input share, its proof share and the public share; a test asserts an aggregator's inputs never include the measurement.
3. A report that fails preparation is excluded from the aggregate and the page names the failing check (combined verifier nonzero / range).
4. Field64 arithmetic is hand-rolled (BigInt or two-limb) and tested against a BigInt reference; the XOF comes from the named library and its domain-separation bytes are checked against the draft's usage.
5. Joint randomness is derived from the parts exactly per the draft; a mismatch fails closed.
6. Collusion never defaults; marked BROKEN with its "what this isn't" line.

**ARCHITECTURE** — `src/field/field64.ts`, `src/xof/turboshake.ts` (wrapper), `src/flp/{gadget,circuit,prove,query,decide}.ts`, `src/prio3/{shard,prep,aggregate,unshard}.ts`, `src/attack/{lie,tamper,collude}.ts`, `src/ui/`.

**UI** — Central metaphor: one report, two envelopes. A measurement splits into two envelopes, each carrying half a proof; the two aggregators hold theirs up to the light (verifier shares) and only the combined verifier says valid or invalid. Steps: enter a measurement → shard → prepare (verifier shares animate → combined verifier → verdict) → aggregate → unshard. Then the lie: enter 4,000,000,000 → rejected at preparation, cause named; tamper → rejected; collusion → inputs on screen.

**VISUAL SEMANTICS** — An accepted honest report renders "VALID" at the combined verifier only, never on a single envelope. A rejected report renders green "REJECTED" with its cause — the system worked; colour tracks integrity. Collusion reveal is ALARM. The negative-claim fixture renders "VALID — AND FALSE". Icon + text + colour.

**EDGE CASES** — out-of-range Sum input (the malicious client deliberately bypasses client-side validation; the page explains why local validation is not the defence); nonce reuse across reports; mismatched share counts; field overflow; zero reports (aggregate undefined; refuse); one report (the aggregate is the input — the second negative claim).

**EXTENSION SEAMS** — Prio3SumVec and Prio3Histogram; a DP step on the aggregate (link DP Noise); Poplar1.

## Claims suite and negative claims

`e2e/claims.spec.ts`: parse the accepted honest inputs and the displayed aggregate and recompute the sum; assert accepted + rejected = submitted; parse the two verifier shares and assert their field sum (recomputed mod p in the test with BigInt) equals the displayed combined verifier; parse the configured bit width and assert the rejected value is ≥ 2^bits; KAT counter cross-checked against the KAT panel; retirement; no-op guard; `[hidden]` probe.

**Negative claim 1 (§4.1d, required):** "Prio3 checks that a report is well-formed — in range and correctly shared. It cannot check that a report is true; a valid-looking lie passes every check and moves the total." **Fixture:** one client reports a salary of 0 with a valid proof while the sealed truth panel shows its real value; every report VALID; the aggregate differs from the sealed plain sum → "VALID — AND FALSE".

**Negative claim 2 (recommended):** "The aggregate is not differentially private; with one report, the aggregate is the report." **Fixture:** a single report; VALID; aggregate equals the input → "SHARES PRIVATE — AND THE TOTAL IS THE INPUT", cross-linked to DP Noise.

## Pre-build verification

- Grep card copy for `VDAF`, `Prio`, `verifiable aggregation`, `fully linear proof`. Read Silent Tally and DP Noise for vocabulary and the payroll dataset.
- Pin draft-irtf-cfrg-vdaf: record version, date and the reference-implementation commit the vectors came from. The XOF has changed across versions (cSHAKE128 → SHAKE128 → TurboSHAKE128); read the pinned version, do not assume.
- Confirm the named library exports TurboSHAKE128 with a settable domain-separation byte; confirm the multi-proof parameter of the pinned version and set it as the draft's Prio3Count / Prio3Sum instantiations do.
- TurboSHAKE citation: cite the CFRG KangarooTwelve / TurboSHAKE RFC if one has been published by build time, otherwise the draft; verify.
- Proposed section: Privacy & Advanced. Proposed chip: MPC & THRESHOLD (PRIVACY is the alternative). Verify.

## Citations (checked unless marked verify)

draft-irtf-cfrg-vdaf (XofTurboShake128 recommended; Prio3 test vectors in the draft and its reference implementation — confirmed 2026-09-10; version number to pin at build). Corrigan-Gibbs & Boneh, NSDI 2017. Boneh, Boyle, Corrigan-Gibbs, Gilboa, Ishai, CRYPTO 2019. draft-ietf-ppm-dap (mention only, as the transport this lab omits). TurboSHAKE — verify RFC status.

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*