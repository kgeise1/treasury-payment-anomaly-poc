# Risk & Compliance Review — Treasury Payment Anomaly & Fraud Triage POC

Reviewed as a proof of concept, not a production system. As with
`SECURITY.md`, this splits **checks added to the POC itself** (cheap,
appropriate to do now, demonstrated rather than just described) from
**governance gaps that are correctly out of scope for a static demo** but
would block real use. Citations below were checked against current sources
rather than assumed from training data, since federal AI/internal-control
guidance has moved fast recently.

## 1. Relevant frameworks

**OMB Circular A-123 (revised 2026)** — the governing federal internal-
control standard. It requires agencies to evaluate fraud risk as a distinct
category during control assessments, to "continuously review all programs
for risk of improper payments," and treats automated analytics/anomaly
detection as an encouraged (not mandated) tool for doing so. This tool sits
squarely inside that use case.

**Improper Payments statutory framework (IPERA/IPERIA)**, implemented via
A-123 Appendix C — the reason payment-integrity anomaly detection is a
named federal priority in the first place, not just a good idea. A real
version of this tool would feed into, and needs to be defensible as part
of, an agency's formal improper-payments review process, which has its own
sampling, documentation, and reporting requirements.

**GAO Green Book (Standards for Internal Control in the Federal
Government)** — the five-component structure (control environment, risk
assessment, control activities, information & communication, monitoring)
used below to organize findings, since it's the standard federal reviewers
already think in.

**OMB M-25-21 (Accelerating Federal Use of AI through Innovation,
Governance, and Public Trust)** — governs federal agency use of AI. Under
its criteria, a tool whose output is a principal basis for decisions
materially affecting "access to government programs" — which flagging a
payment for fraud review plausibly is — would likely be classified
**high-impact AI**, triggering six minimum practices: testing & risk
mitigation, a documented impact assessment, continuous performance
monitoring, human oversight, a remedy/appeal process for people affected,
and public feedback channels. This POC doesn't need to satisfy all six (it
processes no real data and makes no real decisions), but a production
version would, and the gaps below are organized against exactly those six.

## 2. Checks added to the POC this pass

**Reviewer disposition workflow (added).** The results table now has a
disposition control (Pending / Confirmed Issue / False Positive /
Escalated) plus reviewer-name and notes fields per flagged transaction,
and an "Export review log (CSV)" button. This is explicitly **not** an
access-control system — there's no backend, no login, nothing stops
someone typing any name into "Reviewer" or editing another row's
disposition, and a banner on the page says so. What it does demonstrate is
the *shape* a real segregation-of-duties workflow needs: the person/system
that flags a transaction (this tool) is architecturally distinct from the
person who dispositions it (a human, recorded by name), which is distinct
again from whoever has actual authority to act on a payment (this tool
never touches a payment system at all — it only ever displays advisory
output). That last property — advisory-only, no automated action — was
already true architecturally; it's now also stated as an explicit design
requirement here rather than an accidental byproduct, because in a
production system that boundary needs to be a documented control, not just
current behavior nobody promised to keep.

**Audit-trail export hardened against formula injection (added).**
Building the CSV export surfaced a real, concrete risk: reviewer notes are
free text that gets written into a CSV a person will then open in Excel.
An entry starting with `=`, `+`, `-`, or `@` would execute as a live
formula on open (the well-known "CSV/formula injection" class — e.g. a
reviewer note of `=HYPERLINK("http://evil.example","click")` opening as a
clickable link, or worse with `=cmd|...` chains in older Excel versions).
Every exported field is now formula-neutralized (prefixed with `'` when it
starts with a formula-trigger character) and properly CSV-quoted.
`tests/audit_trail_test.js` verifies this against an actual formula
payload rather than trusting it by inspection.

## 3. Gaps mapped to the Green Book's five components — not fixed, correctly out of scope for a demo

**Control environment.** No defined roles exist (analyst / reviewer /
approver are all "whoever has the URL"). A real deployment needs those
roles formally assigned, with the "advisory-only, human-decides" boundary
written into policy, not just left as this tool's current behavior.

**Risk assessment.** No documented impact assessment exists — the M-25-21
artifact a production version needs: intended use, out-of-scope uses,
data used to build/calibrate the model (currently: none, it's synthetic),
and known limitations (thresholds are illustrative, not validated against
real historical improper-payment cases — see README). Worth noting as a
design choice that reduces this risk somewhat: the model scores purely on
transaction-pattern statistics (amount, timing, vendor history) and uses
no demographic or personally-identifying attributes, which narrows the
civil-rights/disparate-impact surface M-25-21 is most concerned about —
but that's a starting point, not a substitute for the assessment itself.

**Control activities.** Detection thresholds directly determine what gets
flagged, and right now anyone editing `detection.js` can change them with
no review. A production version needs threshold/weight changes to go
through a change-control process with sign-off — the model-risk-management
norm (periodic backtesting against confirmed-fraud outcomes, versioned
thresholds, a named model owner) used broadly across regulated statistical
decision tools, not something unique to this one.

**Information & communication.** This is the biggest gap, and it's
structural, not a missing checkbox: nothing persists. There's no log of
who ran an analysis, what was flagged, or how a reviewer dispositioned it
beyond the current browser tab (the disposition feature added this pass
makes that limitation visible and exportable, but doesn't remove it). Any
real disposition decision is a federal record under the Federal Records
Act, subject to a NARA retention schedule — a static demo with no backend
cannot meet that, and shouldn't pretend to.

**Monitoring.** No mechanism exists to check whether the detector is still
performing well over time (drift, changing payment patterns, false-
positive rate creeping up). M-25-21's continuous-monitoring requirement
means a production version needs a recurring review cadence and defined
performance metrics, not a one-time calibration.

## 4. Suggested next step

If this moves past POC, the single highest-leverage compliance action is
treating it as a candidate high-impact AI use case *early* — running the
M-25-21 impact assessment before real data ever touches it, not after —
because that assessment is what forces the human-oversight, remedy/appeal,
and monitoring design decisions to happen deliberately rather than get
retrofitted once the tool is already in someone's daily workflow.

## Sources

- [OMB Circular A-123 (2026)](https://www.whitehouse.gov/wp-content/uploads/2026/03/OMB-Circular-No.-A-123-2026.pdf)
- [OMB M-25-21: Accelerating Federal Use of AI through Innovation, Governance, and Public Trust](https://static.carahsoft.com/concrete/files/9717/4412/5797/Guidance_M-25-21_Accelerating_Federal_Use_of_AI_through_Innovation_Governance_and_Public_Trust.pdf)
- [OMB M-25-21 Requirements and Compliance Deadlines — LegalClarity summary](https://legalclarity.org/omb-ai-memo-m-25-21-requirements-and-compliance-deadlines/)
