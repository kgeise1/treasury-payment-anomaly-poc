/**
 * narrative.js
 *
 * Turns a scored transaction's reason-flag codes into a plain-English
 * explanation an analyst can read without decoding stats themselves.
 * Deliberately rule-based/templated -- no LLM call, no API key, so the
 * deployed static app has zero external dependencies or secrets.
 */

const NarrativeGenerator = (() => {
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const templates = {
    amount_outlier: (t, d) =>
      `Amount is ${d.ratio}x this vendor's average payment (${money(d.vendorMean)})` +
      (d.zscore ? `, ${d.zscore} standard deviations above the vendor's typical range.` : '.'),
    duplicate_payment: (t, d) =>
      `Matches another payment to the same vendor for the exact same amount within a 3-day window (transaction ${d.matchId}) -- possible duplicate disbursement.`,
    off_hours_timing: (t, d) =>
      d.isWeekend
        ? 'Processed on a weekend, outside normal business processing hours.'
        : `Processed at ${String(d.hour).padStart(2, '0')}:00, outside normal business hours (06:00-21:00).`,
    new_vendor_large_payment: (t, d) =>
      `Vendor has only ${d.vendorStatsCount || d.vendorCount} payment(s) on record and this amount is in the top 10% of all payments -- unusually large first-time disbursement.`,
    threshold_evasion: (t, d) =>
      `Amount (${money(t.amount)}) falls just under the ${money(d.threshold)} reporting threshold, a pattern consistent with structuring.`,
  };

  function explainFlag(txn, flag) {
    const fn = templates[flag.code];
    if (!fn) return `Flagged: ${flag.code}`;
    try {
      return fn(txn, { ...flag.detail, vendorStatsCount: txn.vendorStats ? txn.vendorStats.count : undefined });
    } catch (e) {
      return `Flagged: ${flag.code}`;
    }
  }

  function buildNarrative(txn) {
    if (!txn.reasonFlags || txn.reasonFlags.length === 0) {
      return 'No anomaly indicators triggered for this transaction.';
    }
    const sentences = txn.reasonFlags.map((f) => explainFlag(txn, f));
    const lead = txn.riskScore >= 70 ? 'High-risk: ' : txn.riskScore >= 35 ? 'Review recommended: ' : '';
    return lead + sentences.join(' ');
  }

  const REASON_LABELS = {
    amount_outlier: 'Amount outlier',
    duplicate_payment: 'Possible duplicate',
    off_hours_timing: 'Off-hours timing',
    new_vendor_large_payment: 'New vendor, large payment',
    threshold_evasion: 'Near reporting threshold',
  };

  return { buildNarrative, explainFlag, REASON_LABELS };
})();
