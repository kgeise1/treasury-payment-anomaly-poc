/**
 * audit_trail_test.js
 *
 * Verifies the reviewer-disposition / audit-trail-export feature added for
 * the risk & compliance review: recording a disposition works, the export
 * button produces a CSV, and -- the actual security-relevant check --
 * spreadsheet formula-injection payloads typed into the reviewer/notes
 * fields are neutralized in the exported file rather than shipped as live
 * formulas for whoever opens the CSV in Excel/Sheets.
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('http://localhost:8765/index.html');
  await page.click('#load-sample');
  await page.waitForSelector('#results-section:not(.hidden)', { timeout: 5000 });

  const firstRow = await page.$('#flagged-table-body tr');
  const select = await firstRow.$('select.disposition-select');
  const reviewerInput = await firstRow.$('input[data-field="reviewer"]');
  const noteInput = await firstRow.$('input[data-field="note"]');

  await select.selectOption('confirmed');
  // Formula-injection payload + a value containing a comma+quote to check
  // normal CSV quoting still works alongside the formula-neutralization.
  await reviewerInput.fill('=HYPERLINK("http://evil.example","click")');
  await noteInput.fill('needs follow-up, "urgent"');

  const statusClass = await select.getAttribute('class');
  console.log('Select gained status-confirmed class:', statusClass.includes('status-confirmed'));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-log'),
  ]);
  const streamPath = await download.path();
  const fs = require('fs');
  const csvContent = fs.readFileSync(streamPath, 'utf-8');

  const firstDataLine = csvContent.split('\r\n')[1] || '';
  console.log('First exported data row:', firstDataLine);

  const reviewerFieldNeutralized = firstDataLine.includes("'=HYPERLINK");
  const reviewerFieldRawFormula = /(^|,)=HYPERLINK/.test(firstDataLine); // true only if NOT prefixed
  const noteFieldProperlyQuoted = firstDataLine.includes('"needs follow-up, ""urgent"""');

  console.log('Formula payload neutralized with leading quote (should be true):', reviewerFieldNeutralized);
  console.log('Formula payload appears as a raw live formula (should be false):', reviewerFieldRawFormula);
  console.log('Comma/quote value properly CSV-quoted (should be true):', noteFieldProperlyQuoted);
  console.log('Errors during flow:', JSON.stringify(errors));

  const pass = statusClass.includes('status-confirmed')
    && reviewerFieldNeutralized
    && !reviewerFieldRawFormula
    && noteFieldProperlyQuoted
    && errors.length === 0;

  console.log(pass ? 'ALL AUDIT-TRAIL CHECKS PASSED' : 'AUDIT-TRAIL CHECK FAILURE');
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
