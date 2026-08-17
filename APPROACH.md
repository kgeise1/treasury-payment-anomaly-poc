# Approach, Tools, and Assumptions

Brief documentation for the Treasury deliverable requirements. This is a
short cover note — full detail lives in the three documents it points to
below, not repeated here.

## Why this problem

Fraud is one of the largest problems in financial crime, and improper
payments are a material, named risk across federal payment operations.
Stopping fraudulent or erroneous disbursements before they go out isn't
just a compliance exercise — it protects real program funds and, in cases
tied to benefit or assistance programs, real people. That's the reasoning
behind picking payment anomaly/fraud triage over the other two ideas
pitched at the start of this project.

## Approach

This was approached from a risk and compliance angle first, not a
software-engineering-first angle: what would actually get flagged, what a
reviewer would need to see to trust a flag, and what controls a real
version would need before touching real payment data, drawing on prior
risk/compliance experience to know what to look for (duplicate payments,
statistical outliers against a vendor's own history, structuring just
under a reporting threshold, and so on) rather than starting from a
generic "build an anomaly detector" spec.

**AI-assisted development, stated plainly:** the code, tests, and the
security/compliance review documents were built with an AI coding agent
(this project moved from Microsoft Copilot to Claude/Cowork partway
through) under direction — setting requirements, choosing what to
prioritize (security hardening, then risk/compliance controls), reviewing
and pushing back on what came back, and making the calls on framing (e.g.
insisting the tool be described accurately as rules-based/statistical
detection rather than oversold as "AI," given the real governance
implications that label carries under OMB M-25-21). The work spanned
several days — time spent deciding on direction and learning the tools and
processes involved (git, GitHub Pages deployment, PowerShell), not just
generating code.

For the detection methodology itself, the deployed tools/architecture, and
the full list of assumptions and known limitations, see
[`README.md`](README.md). For what was found and hardened from a security
standpoint, see [`SECURITY.md`](SECURITY.md). For the risk/compliance
review — relevant federal frameworks, the segregation-of-duties reviewer
workflow, and governance gaps still open for a real deployment — see
[`COMPLIANCE.md`](COMPLIANCE.md).
