/**
 * app.js -- wires the UI together. Everything runs client-side:
 *   CSV in -> AnomalyDetector.analyze -> NarrativeGenerator -> DOM.
 * No network calls except optionally fetching the bundled sample CSV
 * from the same origin (works on GitHub Pages, or any static server).
 */
(function () {
  const els = {
    loadSampleBtn: document.getElementById('load-sample'),
    fileInput: document.getElementById('csv-file'),
    statusText: document.getElementById('status-text'),
    kpiRow: document.getElementById('kpi-row'),
    chartContainer: document.getElementById('chart-container'),
    tableBody: document.getElementById('flagged-table-body'),
    resultsSection: document.getElementById('results-section'),
  };

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
    const flagged = transactions.filter((t) => t.flagged);
    if (flagged.length === 0) {
      els.tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No transactions crossed the risk threshold (${AnomalyDetector.FLAG_THRESHOLD}+).</td></tr>`;
      return;
    }
    els.tableBody.innerHTML = flagged.map((t) => `
      <tr>
        <td>${severityBadge(t.riskScore)}</td>
        <td>${t.transaction_id}</td>
        <td>${t.date}${t.time ? ' ' + t.time : ''}</td>
        <td>${escapeHtml(t.vendor_name || t.vendor_id)}
          <div class="reason-tags">${t.reasonFlags.map((f) => `<span class="reason-tag">${NarrativeGenerator.REASON_LABELS[f.code] || f.code}</span>`).join('')}</div>
        </td>
        <td class="amount">${money(t.amount)}</td>
        <td>${escapeHtml(t.department || '')}</td>
        <td class="narrative">${escapeHtml(NarrativeGenerator.buildNarrative(t))}</td>
      </tr>
    `).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function runAnalysis(rows, sourceLabel) {
    const { transactions, summary } = AnomalyDetector.analyze(rows);
    renderKPIs(summary);
    renderChart(summary);
    renderTable(transactions);
    els.resultsSection.classList.remove('hidden');
    els.statusText.textContent = `Loaded ${rows.length.toLocaleString()} transactions from ${sourceLabel}. ${summary.flaggedCount} flagged (threshold: risk score ≥ ${AnomalyDetector.FLAG_THRESHOLD}).`;
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

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = CSVParser.parse(String(reader.result));
      runAnalysis(rows, file.name);
    };
    reader.readAsText(file);
  });
})();
