/**
 * security_test.js
 *
 * Adversarial test: feeds the app a deliberately malicious CSV and checks
 * that each fix actually holds, rather than trusting the code by
 * inspection alone. Run with the app served at http://localhost:8765
 * (same as tests/e2e_smoke_test.js).
 */
const { chromium } = require('playwright');

const MALICIOUS_CSV = [
  'transaction_id,date,time,vendor_id,vendor_name,department,payment_type,amount,description,__proto__',
  // Established-vendor baseline (V1001, tight ~$5,000 cluster) just to give
  // the detector a normal population to compare against.
  'TXN_BASE1,2026-05-01,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,5000,baseline,x',
  'TXN_BASE2,2026-05-02,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,5050,baseline,x',
  'TXN_BASE3,2026-05-03,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,4950,baseline,x',
  'TXN_BASE4,2026-05-04,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,5020,baseline,x',
  'TXN_BASE5,2026-05-05,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,4980,baseline,x',
  'TXN_BASE6,2026-05-06,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,5010,baseline,x',
  'TXN_OUT_OF_RANGE,2026-05-07,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,99999999999,test,x',
  ',2026-05-08,09:00,V1001,Meridian Facilities Group,Bureau of the Fiscal Service,ACH,5000,missing id,x',
  // Payload row: a brand-new vendor (count<=2) with a payment in the top
  // 10% of amounts reliably trips "new_vendor_large_payment" -> guaranteed
  // flagged=true -> guaranteed to render in the results table, which is
  // what we actually need to hit escaping in renderTable().
  '"<img src=x onerror=window.__xss_fired=true>",2026-05-09,09:00,V9999,Kestrel Advisory Partners,Bureau of the Fiscal Service,Wire,50000,payload row -- must be flagged,polluted',
].join('\n');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', async (d) => { errors.push('UNEXPECTED DIALOG (would indicate exec via alert/confirm): ' + d.message()); await d.dismiss(); });

  await page.goto('http://localhost:8765/index.html');

  const result = await page.evaluate((csvText) => {
    const rows = CSVParser.parse(csvText);
    const { transactions, summary } = AnomalyDetector.analyze(rows);
    return {
      protoPolluted: Object.prototype.polluted !== undefined,
      rowKeys: Object.keys(rows[0]),
      excludedOutOfRange: summary.excludedOutOfRange,
      excludedMissingFields: summary.excludedMissingFields,
      analyzedCount: summary.totalTransactions,
      xssFiredBeforeRender: window.__xss_fired === true,
    };
  }, MALICIOUS_CSV);

  console.log('Prototype pollution check (should be false):', result.protoPolluted);
  console.log('Row keys include "_ __proto__" renamed, not raw __proto__:', result.rowKeys);
  console.log('Excluded (out-of-range amount, expect 1):', result.excludedOutOfRange);
  console.log('Excluded (missing required field, expect 1):', result.excludedMissingFields);
  console.log('Rows actually analyzed (expect 7 of 9):', result.analyzedCount);
  console.log('XSS fired during parse/analyze (should be false):', result.xssFiredBeforeRender);

  // Now actually render it through the real upload path and check the DOM.
  const fileInput = await page.$('#csv-file');
  await fileInput.setInputFiles({ name: 'malicious.csv', mimeType: 'text/csv', buffer: Buffer.from(MALICIOUS_CSV) });
  await page.waitForTimeout(300);

  const xssFiredAfterRender = await page.evaluate(() => window.__xss_fired === true);
  const tableHtmlHasRawImgTag = await page.evaluate(() => document.getElementById('flagged-table-body').innerHTML.includes('<img'));
  const tableTextHasEscapedMarkup = await page.evaluate(() => document.getElementById('flagged-table-body').textContent.includes('<img src=x'));

  console.log('XSS fired after real upload+render (should be false):', xssFiredAfterRender);
  console.log('Table innerHTML contains a live <img> tag (should be false):', tableHtmlHasRawImgTag);
  console.log('Table text contains the literal, inert "<img src=x..." string (should be true):', tableTextHasEscapedMarkup);
  console.log('Console/page errors:', JSON.stringify(errors));

  const pass = !result.protoPolluted
    && result.excludedOutOfRange === 1
    && result.excludedMissingFields === 1
    && result.analyzedCount === 7
    && !result.xssFiredBeforeRender
    && !xssFiredAfterRender
    && !tableHtmlHasRawImgTag
    && tableTextHasEscapedMarkup
    && errors.length === 0;

  console.log(pass ? 'ALL SECURITY CHECKS PASSED' : 'SECURITY CHECK FAILURE');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
