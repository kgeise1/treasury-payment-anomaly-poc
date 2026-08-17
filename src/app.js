/**
 * app.js -- wires the UI together. Everything runs client-side:
 *   CSV in -> AnomalyDetector.analyze -> NarrativeGenerator -> DOM.
 * No network calls except optionally fetching the bundled sample CSV
 * from the same origin (works on GitHub Pages, or any static server).
 */

// Best-effort clickjacking mitigation. GitHub Pages can only deliver a CSP
// via <meta>, and frame-ancestors/X-Frame-Options are HTTP-header-only
// directives that a <meta> tag cannot express -- see SECURITY.md. This JS
// fallback breaks out of a framing page if one exists; it's the pre-CSP-era
// technique and a determined attacker can bypass it (e.g. a sandboxed
// iframe without allow-top-navigation), so treat it as a stopgap for this
// static-hosting constraint, not a substitute for real response headers.
if (window.top !== window.self) {
  window.top.location = window.self.location;
}

(function () {
  const els = {
    loadSampleBtn: document.getElementById('load-sample'),
    fileInput: document.getElementById('csv-file'),
    statusText: document.getElementById('status-text'),
    kpiRow: document.getElementById('kpi-row'),
    chartContainer: document.getElementById('chart-container'),
    tableBody: document.getElementById('flagged-table-body'),
    resultsSection: document.getElementById('results-section'),
    exportLogBtn: document.getElementById('export-log'),
  };

  // Illustrative-only reviewer disposition state. In-memory, this browser
  // tab only -- reset on reload or on loading new data. Not an access
  // control mechanism (nothing stops anyone typing any name into
  // "Reviewer"); it exists to demonstrate the *shape* of a segregation-of-
  // duties workflow (flag -> disposition -> record) for the compliance
  // review, not to implement one. See index.html disclaimer + COMPLIANCE.md.
  let currentFlagged = [];
  const dispositions = {}; // transaction_id -> { status, reviewer, note, timestamp }

  const DISPOSITION_OPTIONS = [
    ['pending', 'Pending review'],
    ['confirmed', 'Confirmed issue'],
    ['false_positive', 'False positive'],
    ['escalated', 'Escalated'],
  ];

  function money(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function severityBadge(score) {
    let cls = 'badge-warning', label = 'Warning';
    if (score >= 75) { cls = 'badge-critical'; label = 'Critical'; }
    else if (score >= 50) { cls = 'badge-serious'; label = 'Serious'; }
    return `<span class="badge ${cls}"><span class="dot"></span>${label} · ${score}</span>`;
  }

  function renderKPIs(summary) {
    const pct = summary.totalTransactions ? ((summary.flaggedCount / summary.totalTransactions) * 100).toFixed(1) : '0.0';
    els.kpiRow.innerHTML = `
      <div class="kpi-tile">
        <div class="kpi-label">Transactions analyzed</div>
        <div class="kpi-value">${summary.totalTransactions.toLocaleString()}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Total disbursed</div>
        <div class="kpi-value">${money(summary.totalAmount)}</div>
      </div>
      <div class="kpi-tile accent-critical">
        <div class="kpi-label">Flagged for review</div>
        <div class="kpi-value">${summary.flaggedCount.toLocaleString()} <span style="font-size:14px;font-weight:400;color:var(--text-muted)">(${pct}%)</span></div>
      </div>
      <div class="kpi-tile accent-critical">
        <div class="kpi-label">Flagged $ amount</div>
        <div class="kpi-value">${money(summary.flaggedAmount)}</div>
      </div>`;
  }

  function renderChart(summary) {
    const data = Object.entries(summary.reasonCounts)
      .map(([code, count]) => ({ label: NarrativeGenerator.REASON_LABELS[code] || code, value: count }))
      .sort((a, b) => b.value - a.value);
    BarChart.render(els.chartContainer, {
      title: 'Flagged transactions by reason',
      data,
      valueLabel: 'flagged transaction(s)',
    });
  }

  function renderTable(transactions) {
    currentFlagged = transactions.filter((t) => t.flagged);
    // Fresh dataset -> fresh (empty) disposition state; this is session/demo
    // state, not persisted storage, so there's nothing meaningful to carry
    // across a reload of the underlying data.
    Object.keys(dispositions).forEach((k) => delete dispositions[k]);

    if (currentFlagged.length === 0) {
      els.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state">No transactions crossed the risk threshold (${AnomalyDetector.FLAG_THRESHOLD}+).</td></tr>`;
      return;
    }
    els.tableBody.innerHTML = currentFlagged.map((t) => `
      <tr>
        <td>${severityBadge(t.riskScore)}</td>
        <td>${escapeHtml(t.transaction_id)}</td>
        <td>${escapeHtml(t.date)}${t.time ? ' ' + escapeHtml(t.time) : ''}</td>
        <td>${escapeHtml(t.vendor_name || t.vendor_id)}
          <div class="reason-tags">${t.reasonFlags.map((f) => `<span class="reason-tag">${NarrativeGenerator.REASON_LABELS[f.code] || f.code}</span>`).join('')}</div>
        </td>
        <td class="amount">${money(t.amount)}</td>
        <td>${escapeHtml(t.department || '')}</td>
        <td class="narrative">${escapeHtml(NarrativeGenerator.buildNarrative(t))}</td>
        <td>
          <select class="disposition-select status-pending" data-txn="${escapeHtml(t.transaction_id)}" data-field="status">
            ${DISPOSITION_OPTIONS.map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}
          </select>
        </td>
        <td>
          <input class="disposition-note" type="text" maxlength="120" placeholder="Reviewer name"
                 data-txn="${escapeHtml(t.transaction_id)}" data-field="reviewer" />
          <input class="disposition-note" type="text" maxlength="200" placeholder="Notes"
                 data-txn="${escapeHtml(t.transaction_id)}" data-field="note" />
        </td>
      </tr>
    `).join('');
  }

  // Event delegation: one pair of listeners handles every row's controls,
  // including rows added by future re-renders, without re-binding per row.
  els.tableBody.addEventListener('change', (e) => {
    if (!e.target.matches('[data-txn]')) return;
    recordDisposition(e.target);
  });
  els.tableBody.addEventListener('input', (e) => {
    if (!e.target.matches('[data-txn]')) return;
    recordDisposition(e.target);
  });

  function recordDisposition(el) {
    const txnId = el.dataset.txn;
    const field = el.dataset.field;
    const entry = dispositions[txnId] || { status: 'pending', reviewer: '', note: '' };
    entry[field] = el.value;
    entry.timestamp = new Date().toISOString();
    dispositions[txnId] = entry;
    if (field === 'status') {
      el.classList.remove('status-pending', 'status-confirmed', 'status-false_positive', 'status-escalated');
      el.classList.add('status-' + el.value);
    }
  }

  // Neutralizes spreadsheet formula injection: if a cell's leading character
  // would make Excel/Sheets/LibreOffice interpret it as a formula
  // (=, +, -, @, or a leading tab/CR), prefix with a single quote so it's
  // forced to render as literal text on open. Relevant here specifically
  // because this export exists to be opened in a spreadsheet by a reviewer.
  function csvField(value) {
    let s = String(value === undefined || value === null ? '' : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportReviewLog() {
    const header = ['transaction_id', 'date', 'vendor', 'amount', 'department', 'risk_score', 'reason_codes', 'disposition', 'reviewer', 'notes', 'disposition_timestamp'];
    const lines = [header.map(csvField).join(',')];
    currentFlagged.forEach((t) => {
      const d = dispositions[t.transaction_id] || { status: 'pending', reviewer: '', note: '', timestamp: '' };
      lines.push([
        t.transaction_id,
        t.date,
        t.vendor_name || t.vendor_id,
        t.amount,
        t.department || '',
        t.riskScore,
        t.reasonFlags.map((f) => f.code).join(';'),
        d.status,
        d.reviewer,
        d.note,
        d.timestamp,
      ].map(csvField).join(','));
    });
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  els.exportLogBtn.addEventListener('click', () => {
    if (currentFlagged.length === 0) {
      els.statusText.textContent = 'No flagged transactions to export yet.';
      return;
    }
    exportReviewLog();
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function runAnalysis(rows, sourceLabel) {
    const { transactions, summary } = AnomalyDetector.analyze(rows);
    renderKPIs(summary);
    renderChart(summary);
    renderTable(transactions);
    els.resultsSection.classList.remove('hidden');
    const excluded = (summary.excludedMissingFields || 0) + (summary.excludedOutOfRange || 0);
    const excludedNote = excluded > 0
      ? ` ${excluded.toLocaleString()} row(s) excluded from analysis (${summary.excludedMissingFields} missing required fields, ${summary.excludedOutOfRange} amount out of the $0.01-$100,000,000 sane range).`
      : '';
    els.statusText.textContent = `Loaded ${rows.length.toLocaleString()} transactions from ${sourceLabel}. ${summary.flaggedCount} flagged (threshold: risk score ≥ ${AnomalyDetector.FLAG_THRESHOLD}).${excludedNote}`;
  }

  els.loadSampleBtn.addEventListener('click', async () => {
    els.statusText.textContent = 'Loading sample dataset…';
    try {
      const res = await fetch('data/sample_transactions.csv');
      if (!res.ok) throw new Error('fetch failed: ' + res.status);
      const text = await res.text();
      const rows = CSVParser.parse(text);
      runAnalysis(rows, 'bundled sample dataset');
    } catch (err) {
      els.statusText.textContent = 'Could not load the bundled sample CSV. If you opened this file directly (file://), run it via a local server instead — see README. (' + err.message + ')';
    }
  });

  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — generous for a payment CSV, prevents an accidental
  const MAX_UPLOAD_ROWS = 100000;            // giant file from freezing the tab (client-side only, no server to protect).

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      els.statusText.textContent = 'Please choose a .csv file.';
      e.target.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      els.statusText.textContent = `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit for this prototype.`;
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const rows = CSVParser.parse(String(reader.result));
      if (rows.length > MAX_UPLOAD_ROWS) {
        els.statusText.textContent = `That file has ${rows.length.toLocaleString()} rows, over the ${MAX_UPLOAD_ROWS.toLocaleString()}-row limit for this prototype.`;
        return;
      }
      runAnalysis(rows, file.name);
    };
    reader.onerror = () => { els.statusText.textContent = 'Could not read that file.'; };
    reader.readAsText(file);
  });
})();
