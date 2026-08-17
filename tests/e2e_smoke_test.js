const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console.error: ' + msg.text()); });

  await page.goto('http://localhost:8765/index.html');
  await page.click('#load-sample');
  await page.waitForSelector('#results-section:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(300);

  const status = await page.textContent('#status-text');
  const kpiText = await page.textContent('#kpi-row');
  const flaggedRows = await page.$$eval('#flagged-table-body tr', (rows) => rows.length);
  const chartBars = await page.$$eval('.chart-bar', (bars) => bars.length);

  console.log('STATUS:', status);
  console.log('FLAGGED ROWS:', flaggedRows);
  console.log('CHART BARS:', chartBars);
  console.log('KPI SNIPPET:', kpiText.replace(/\s+/g, ' ').slice(0, 200));

  await page.screenshot({ path: path.join(__dirname, '..', 'screenshot_dashboard.png'), fullPage: true });

  // test table-toggle
  await page.click('.table-toggle');
  const tableVisible = await page.$eval('.chart-table-area', (el) => !el.classList.contains('hidden'));
  console.log('TABLE TOGGLE WORKS:', tableVisible);

  // test file upload path using the same sample file
  const fileInput = await page.$('#csv-file');
  await fileInput.setInputFiles(path.join(__dirname, '..', 'data', 'sample_transactions.csv'));
  await page.waitForTimeout(300);
  const status2 = await page.textContent('#status-text');
  console.log('STATUS AFTER UPLOAD:', status2);

  console.log('JS ERRORS:', JSON.stringify(errors));

  await browser.close();
  if (errors.length > 0) process.exit(1);
})();
