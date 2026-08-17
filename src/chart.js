/**
 * chart.js
 *
 * Small dependency-free horizontal bar chart, hand-rolled in SVG per the
 * house dataviz method: thin bars, rounded data-ends, single hue (this is
 * one series -- flag counts by reason code -- so no categorical cycling
 * is needed), recessive gridlines, direct value labels, hover tooltip,
 * and a table-view twin for accessibility.
 */
const BarChart = (() => {
  function render(container, { title, data, valueLabel }) {
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'chart-card';

    const head = document.createElement('div');
    head.className = 'chart-head';
    head.innerHTML = `<h3>${title}</h3>
      <button type="button" class="table-toggle" aria-pressed="false">View as table</button>`;
    wrap.appendChild(head);

    const chartArea = document.createElement('div');
    chartArea.className = 'chart-area';
    wrap.appendChild(chartArea);

    const tableArea = document.createElement('div');
    tableArea.className = 'chart-table-area hidden';
    wrap.appendChild(tableArea);

    container.appendChild(wrap);

    if (!data || data.length === 0) {
      chartArea.innerHTML = '<p class="empty-state">No flagged transactions to chart yet.</p>';
      return;
    }

    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const barHeight = 22;
    const gap = 14;
    const labelWidth = 190;
    const plotWidth = 420;
    const height = data.length * (barHeight + gap) + gap;
    const width = labelWidth + plotWidth + 60;

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip hidden';
    wrap.appendChild(tooltip);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);

    // baseline
    const baseline = document.createElementNS(svgNS, 'line');
    baseline.setAttribute('x1', labelWidth);
    baseline.setAttribute('x2', labelWidth);
    baseline.setAttribute('y1', 0);
    baseline.setAttribute('y2', height);
    baseline.setAttribute('class', 'chart-baseline');
    svg.appendChild(baseline);

    data.forEach((d, i) => {
      const y = gap + i * (barHeight + gap);
      const w = Math.max(4, (d.value / maxVal) * plotWidth);

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', labelWidth - 10);
      label.setAttribute('y', y + barHeight / 2 + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'chart-label');
      label.textContent = d.label;
      svg.appendChild(label);

      const bar = document.createElementNS(svgNS, 'rect');
      bar.setAttribute('x', labelWidth);
      bar.setAttribute('y', y);
      bar.setAttribute('height', barHeight);
      bar.setAttribute('width', w);
      bar.setAttribute('rx', 4);
      bar.setAttribute('class', 'chart-bar');
      bar.addEventListener('mouseenter', (evt) => showTooltip(evt, d));
      bar.addEventListener('mousemove', (evt) => showTooltip(evt, d));
      bar.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(bar);

      const valueText = document.createElementNS(svgNS, 'text');
      valueText.setAttribute('x', labelWidth + w + 8);
      valueText.setAttribute('y', y + barHeight / 2 + 4);
      valueText.setAttribute('class', 'chart-value');
      valueText.textContent = d.value;
      svg.appendChild(valueText);
    });

    chartArea.appendChild(svg);

    function showTooltip(evt, d) {
      tooltip.textContent = `${d.label}: ${d.value} ${valueLabel || 'flagged transaction(s)'}`;
      tooltip.classList.remove('hidden');
      const rect = wrap.getBoundingClientRect();
      tooltip.style.left = (evt.clientX - rect.left + 12) + 'px';
      tooltip.style.top = (evt.clientY - rect.top - 10) + 'px';
    }
    function hideTooltip() { tooltip.classList.add('hidden'); }

    // table-view twin
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr><th>Reason</th><th>Count</th></tr></thead>
      <tbody>${data.map((d) => `<tr><td>${d.label}</td><td>${d.value}</td></tr>`).join('')}</tbody>`;
    tableArea.appendChild(table);

    head.querySelector('.table-toggle').addEventListener('click', (e) => {
      const pressed = e.target.getAttribute('aria-pressed') === 'true';
      e.target.setAttribute('aria-pressed', String(!pressed));
      e.target.textContent = pressed ? 'View as table' : 'View as chart';
      chartArea.classList.toggle('hidden', !pressed);
      tableArea.classList.toggle('hidden', pressed);
    });
  }

  return { render };
})();
