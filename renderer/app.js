var midRate = null;
var chartInst = null;
var activeRange = '1D';

var pad = function(n) { return String(n).padStart(2, '0'); };

var SOURCE_MAP = {
  'Google':        { rateId: 'xe-rate',      diffId: 'xe-diff',      tileId: 'tile-xe'      },
  'Wise':          { rateId: 'wise-rate',     diffId: 'wise-diff',    tileId: 'tile-wise'    },
  'Western Union': { rateId: 'wu-rate',       diffId: 'wu-diff',      tileId: 'tile-wu'      },
  'Remitly':       { rateId: 'remitly-rate',  diffId: 'remitly-diff', tileId: 'tile-remitly' },
  'Xoom':          { rateId: 'xoom-rate',     diffId: 'xoom-diff',    tileId: 'tile-xoom'    },
  'Crobo':         { rateId: 'crobo-rate',    diffId: 'crobo-diff',   tileId: 'tile-crobo'   },
};

/* ── Clocks ─────────────────────────────────────────────────────────────── */
function tickClocks() {
  var now = new Date();
  document.getElementById('utc-time').textContent =
    pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());
  var ist = new Date(now.getTime() + 19800000);
  document.getElementById('ist-time').textContent =
    pad(ist.getUTCHours()) + ':' + pad(ist.getUTCMinutes()) + ':' + pad(ist.getUTCSeconds());
}
setInterval(tickClocks, 1000);
tickClocks();

/* ── Chart ──────────────────────────────────────────────────────────────── */
function seedData(range, base) {
  var counts = { '1D': 24, '1W': 7, '1M': 30, '3M': 90, '1Y': 52 };
  var n = counts[range] || 24;
  var labels = [], data = [];
  var r = base - (Math.random() * 0.8 + 0.3);
  for (var i = 0; i < n; i++) {
    r += (Math.random() - 0.48) * 0.2;
    if (r < base - 3) r = base - 3;
    if (r > base + 1.5) r = base + 1.5;
    data.push(parseFloat(r.toFixed(4)));
    labels.push('');
  }
  data[data.length - 1] = base;
  return { labels: labels, data: data };
}

function drawChart(range) {
  if (!midRate) return;
  var d = seedData(range, midRate);
  var up = d.data[d.data.length - 1] >= d.data[0];
  var lineColor = up ? '#34c759' : '#ff453a';
  var canvas = document.getElementById('rateChart');
  var ctx = canvas.getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, 0, 68);
  grad.addColorStop(0, up ? 'rgba(52,199,89,0.18)' : 'rgba(255,69,58,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  if (chartInst) { chartInst.destroy(); chartInst = null; }
  chartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: d.labels,
      datasets: [{
        data: d.data,
        borderColor: lineColor,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        backgroundColor: grad,
        tension: 0.35
      }]
    },
    options: {
      responsive: false,
      animation: { duration: 350 },
      layout: { padding: { left: 2, right: 8, top: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: '#1c1c1e', titleColor: '#666',
          bodyColor: '#fff', borderColor: '#222', borderWidth: 1,
          padding: 8, displayColors: false,
          callbacks: { label: function(c) { return '₹ ' + c.parsed.y.toFixed(4); } }
        }
      },
      scales: {
        x: { display: false },
        y: {
          display: true, position: 'left',
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: {
            color: '#555', font: { size: 9, family: '-apple-system' },
            maxTicksLimit: 3, padding: 4,
            callback: function(v) { return v.toFixed(1); }
          },
          border: { display: false }
        }
      }
    }
  });

  var delta = d.data[d.data.length - 1] - d.data[0];
  var pct = ((delta / d.data[0]) * 100).toFixed(2);
  var badge = document.getElementById('delta-badge');
  badge.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(4) + ' (' + (delta >= 0 ? '+' : '') + pct + '%)';
  badge.className = 'delta-badge' + (delta < 0 ? ' down' : '');
  var rl = { '1D': 'today', '1W': 'this week', '1M': 'this month', '3M': '3 months', '1Y': 'this year' };
  document.getElementById('delta-sub').textContent = rl[range] || range;
}

/* ── Tiles ──────────────────────────────────────────────────────────────── */
function diffLabel(rate, base) {
  var d = rate - base;
  return (d >= 0 ? '+' : '') + ((d / base) * 100).toFixed(2) + '%';
}

function setTile(rateId, diffId, tileId, rate, base) {
  var re = document.getElementById(rateId);
  var de = document.getElementById(diffId);
  if (!re || !de) return;
  if (rate === null || rate === undefined) {
    re.textContent = 'N/A'; de.textContent = '—'; return;
  }
  re.textContent = rate.toFixed(2);
  de.textContent = (base !== null) ? diffLabel(rate, base) : 'benchmark';
}

function renderTiles(rates) {
  var googleRate = null;
  for (var i = 0; i < rates.length; i++) {
    if (rates[i].source === 'Google' && rates[i].rate) {
      googleRate = rates[i].rate; break;
    }
  }
  if (googleRate) {
    midRate = googleRate;
    document.getElementById('rate-number').textContent = googleRate.toFixed(2);
  }
  for (var j = 0; j < rates.length; j++) {
    var r = rates[j];
    var map = SOURCE_MAP[r.source];
    if (!map) continue;
    setTile(map.rateId, map.diffId, map.tileId, r.rate, r.source === 'Google' ? null : googleRate);
  }
  var now = new Date();
  document.getElementById('tiles-status').textContent =
    'scraped at ' + pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ' UTC';
  updateCalc();
  drawChart(activeRange);
}

/* ── Calculator (inline panel) ──────────────────────────────────────────── */
function updateCalc() {
  if (!midRate) return;
  var usd = parseFloat(document.getElementById('calc-usd').value);
  if (isNaN(usd)) usd = 0;
  document.getElementById('inr-result').textContent =
    (usd * midRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var inr = parseFloat(document.getElementById('calc-inr').value);
  document.getElementById('usd-result').textContent =
    (!isNaN(inr) && inr > 0) ? (inr / midRate).toFixed(4) : '—';
}

/* ── Fetch ──────────────────────────────────────────────────────────────── */
function fetchAll() {
  document.getElementById('rate-number').textContent = '…';
  document.getElementById('tiles-status').textContent = 'scraping live rates…';
  window.electronAPI.fetchRates()
    .then(function(result) {
      if (result.ok) renderTiles(result.rates);
      else {
        document.getElementById('rate-number').textContent = 'ERR';
        document.getElementById('tiles-status').textContent = 'scrape failed — tap refresh';
      }
    })
    .catch(function(err) {
      document.getElementById('rate-number').textContent = 'ERR';
      document.getElementById('tiles-status').textContent = 'error — tap refresh';
      console.error('[app] fetchAll error:', err);
    });
}

/* ── Events ─────────────────────────────────────────────────────────────── */
document.getElementById('rate-section').addEventListener('click', function() {
  var p = document.getElementById('calc-panel');
  if (p.classList.contains('open')) p.classList.remove('open');
  else { p.classList.add('open'); updateCalc(); }
});

document.getElementById('calc-close').addEventListener('click', function() {
  document.getElementById('calc-panel').classList.remove('open');
});

document.getElementById('calc-usd').addEventListener('input', updateCalc);
document.getElementById('calc-inr').addEventListener('input', updateCalc);
document.getElementById('refresh-btn').addEventListener('click', fetchAll);

document.querySelectorAll('.tab').forEach(function(t) {
  t.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
    t.classList.add('active');
    activeRange = t.getAttribute('data-range');
    drawChart(activeRange);
  });
});

/* ── Boot ───────────────────────────────────────────────────────────────── */
fetchAll();
setInterval(fetchAll, 15 * 60 * 1000);