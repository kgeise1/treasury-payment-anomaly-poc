/**
 * detection.js
 *
 * Client-side statistical anomaly detection for vendor payment transactions.
 * No network calls, no external services, no API keys -- everything here
 * runs in the browser against whatever transaction array it's given.
 *
 * Expected transaction shape (extra fields are ignored, missing optional
 * fields degrade gracefully):
 *   {
 *     transaction_id, date ("YYYY-MM-DD"), time ("HH:MM", optional),
 *     vendor_id, vendor_name, department, payment_type, amount, description
 *   }
 *
 * Methodology (documented here + in README "Approach"):
 *   1. Per-vendor baseline: mean & standard deviation of payment amount.
 *   2. Amount outliers: z-score vs. the vendor's own baseline (>3 sigma),
 *      with a fallback ratio test (>4x vendor mean) for vendors that have
 *      too few payments for a stable standard deviation.
 *   3. Duplicate payments: same vendor + same amount (to the cent) within
 *      a 3-day window.
 *   4. Off-hours timing: weekend, or before 06:00 / after 21:00 local time
 *      on the recorded timestamp.
 *   5. New-vendor risk: vendors with <=2 total payments in the dataset
 *      whose payment is above the 90th percentile of all payments.
 *   6. Threshold-evasion pattern: amount between $9,500 and $9,999.99,
 *      i.e. just under the common $10,000 reporting threshold.
 *
 * Each signal contributes points to a 0-100 risk score; a transaction is
 * "flagged" once its score crosses FLAG_THRESHOLD. This is intentionally
 * simple and transparent (vs. a black-box model) because for a Treasury
 * audience, an examiner needs to see *why* something was flagged.
 */

const AnomalyDetector = (() => {
  const FLAG_THRESHOLD = 35;

  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  }

  function stddev(arr, m) {
    if (arr.length < 2) return 0;
    const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
    return sortedArr[idx];
  }

  function parseDateTime(row) {
    const timePart = row.time && /^\d{1,2}:\d{2}$/.test(row.time) ? row.time : '12:00';
    const dt = new Date(`${row.date}T${timePart}:00`);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function daysBetween(a, b) {
    return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
  }

  function analyze(rawTransactions) {
    const txns = rawTransactions
      .map((r, i) => ({
        ...r,
        amount: typeof r.amount === 'number' ? r.amount : parseFloat(String(r.amount).replace(/[^0-9.-]/g, '')),
        _idx: i,
        _dt: null,
      }))
      .filter((r) => r.transaction_id && !isNaN(r.amount));

    txns.forEach((t) => { t._dt = parseDateTime(t); });

    // --- Per-vendor baselines ---
    const byVendor = {};
    txns.forEach((t) => {
      if (!byVendor[t.vendor_id]) byVendor[t.vendor_id] = [];
      byVendor[t.vendor_id].push(t);
    });
    const vendorStats = {};
    Object.entries(byVendor).forEach(([vid, list]) => {
      const amounts = list.map((t) => t.amount);
      const m = mean(amounts);
      vendorStats[vid] = { mean: m, std: stddev(amounts, m), count: list.length };
    });

    const allAmountsSorted = txns.map((t) => t.amount).sort((a, b) => a - b);
    const p90 = percentile(allAmountsSorted, 90);

    // --- Duplicate detection: same vendor + same amount within 3 days ---
    const dupGroups = {};
    Object.entries(byVendor).forEach(([vid, list]) => {
      const byAmount = {};
      list.forEach((t) => {
        const key = t.amount.toFixed(2);
        (byAmount[key] = byAmount[key] || []).push(t);
      });
      Object.values(byAmount).forEach((group) => {
        if (group.length < 2) return;
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            if (group[i]._dt && group[j]._dt && daysBetween(group[i]._dt, group[j]._dt) <= 3) {
              dupGroups[group[i].transaction_id] = group[j].transaction_id;
              dupGroups[group[j].transaction_id] = group[i].transaction_id;
            }
          }
        }
      });
    });

    // --- Score each transaction ---
    const scored = txns.map((t) => {
      const stats = vendorStats[t.vendor_id] || { mean: t.amount, std: 0, count: 1 };
      const zscore = stats.std > 0 ? (t.amount - stats.mean) / stats.std : 0;
      const ratio = stats.mean > 0 ? t.amount / stats.mean : 1;

      const flags = [];
      let score = 0;

      // 1. Amount outlier
      const isOutlier = (stats.std > 0 && zscore > 3) || (stats.count >= 3 && stats.std === 0 && ratio > 4) || (stats.count < 3 && ratio > 4);
      if (isOutlier) {
        flags.push({
          code: 'amount_outlier',
          detail: { zscore: Number(zscore.toFixed(2)), ratio: Number(ratio.toFixed(2)), vendorMean: stats.mean },
        });
        score += 40;
      }

      // 2. Duplicate payment
      if (dupGroups[t.transaction_id]) {
        flags.push({ code: 'duplicate_payment', detail: { matchId: dupGroups[t.transaction_id] } });
        score += 40;
      }

      // 3. Off-hours timing
      if (t._dt) {
        const day = t._dt.getDay(); // 0 = Sun, 6 = Sat
        const hour = t._dt.getHours();
        const isWeekend = day === 0 || day === 6;
        const isLateNight = hour < 6 || hour >= 21;
        if (isWeekend || isLateNight) {
          flags.push({ code: 'off_hours_timing', detail: { isWeekend, hour } });
          score += 15;
        }
      }

      // 4. New vendor, large first payment
      if (stats.count <= 2 && t.amount >= p90) {
        flags.push({ code: 'new_vendor_large_payment', detail: { vendorCount: stats.count, p90 } });
        score += 35;
      }

      // 5. Just-under-threshold structuring pattern
      if (t.amount >= 9500 && t.amount < 10000) {
        flags.push({ code: 'threshold_evasion', detail: { threshold: 10000 } });
        score += 35;
      }

      score = Math.min(100, score);

      return {
        ...t,
        riskScore: score,
        flagged: score >= FLAG_THRESHOLD,
        reasonFlags: flags,
        vendorStats: stats,
      };
    });

    scored.sort((a, b) => b.riskScore - a.riskScore);

    const flaggedTxns = scored.filter((t) => t.flagged);
    const summary = {
      totalTransactions: scored.length,
      totalAmount: scored.reduce((s, t) => s + t.amount, 0),
      flaggedCount: flaggedTxns.length,
      flaggedAmount: flaggedTxns.reduce((s, t) => s + t.amount, 0),
      vendorCount: Object.keys(byVendor).length,
      reasonCounts: flaggedTxns.reduce((acc, t) => {
        t.reasonFlags.forEach((f) => { acc[f.code] = (acc[f.code] || 0) + 1; });
        return acc;
      }, {}),
    };

    return { transactions: scored, summary, flagThreshold: FLAG_THRESHOLD };
  }

  return { analyze, FLAG_THRESHOLD };
})();
