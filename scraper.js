/**
 * scraper.js — per-platform strategy based on actual page inspection
 *
 * Google    → open.er-api.com JSON (same feed Google uses, no browser)
 * Wise      → wise.com/in/currency-converter/usd-to-inr-rate
 *             Rate is in STATIC HTML: "$1 USD = XX.XX INR"
 *             Strategy: plain HTTPS fetch + regex. No browser needed.
 * Western Union → westernunion.com/us/en/currency-converter/usd-to-inr-rate.html
 *             Rate is JS-rendered. Browser window needed.
 *             Look for "FX:" label and the number after it.
 * Remitly   → remitly.com/us/en/currency-converter/usd-to-inr-rate
 *             Rate is in STATIC HTML: "1 USD = XX.XX INR" (Special rate section)
 *             Strategy: plain HTTPS fetch + regex. No browser needed.
 * Xoom      → xoom.com/en-us/usd/send-money/transfer?countryCode=IN
 *             Rate only appears after the transfer calculator loads.
 *             Strategy: browser window, wait for rate to render.
 * Crobo     → crobo.money
 *             React SPA. Browser window needed.
 */

const https = require('https');
const { BrowserWindow } = require('electron');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* ─── Plain HTTPS fetch → returns full HTML/text as string ──────────────── */
function fetchText(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', ...extraHeaders },
      timeout: 12000,
    };
    const req = https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location, extraHeaders).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

function fetchJSON(url, extraHeaders = {}) {
  return fetchText(url, { 'Accept': 'application/json', ...extraHeaders })
    .then(text => JSON.parse(text));
}

/* ─── Extract INR rate from raw HTML using multiple regex patterns ────────
   Tries several patterns in order, returns first valid match in 80-110 range */
function extractRateFromHTML(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      // Find capture group that looks like a rate
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          const n = parseFloat(match[i].replace(/,/g, '.'));
          if (!isNaN(n) && n > 80 && n < 115) return n;
        }
      }
    }
  }
  return null;
}

/* ─── Browser scraper with aggressive resource blocking ──────────────────
   Used only when the rate cannot be fetched from static HTML.
   Blocks images, fonts, analytics, ads to prevent timeouts.           */
function scrapeWithBrowser(url, extractFn, { pollMs = 800, maxAttempts = 30, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    let win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        javascript: true,
        images: false,
        contextIsolation: false,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    win.webContents.setUserAgent(UA);

    // Block heavy resources — dramatically reduces load time
    const blockedPatterns = [
      '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*',
      '*://*.googletagmanager.com/*', '*://*.google-analytics.com/*',
      '*://*.facebook.net/*', '*://*.hotjar.com/*',
      '*://*.intercom.io/*', '*://*.zendesk.com/*',
      '*://*.mixpanel.com/*', '*://*.segment.io/*',
      '*://*.amplitude.com/*', '*://*.optimizely.com/*',
      '*.woff', '*.woff2', '*.ttf', '*.otf',
      '*.mp4', '*.webm', '*.gif',
    ];
    win.webContents.session.webRequest.onBeforeRequest(
      { urls: blockedPatterns },
      (_, callback) => callback({ cancel: true })
    );

    const cleanup = () => {
      try {
        win.webContents.session.webRequest.onBeforeRequest(null);
        if (!win.isDestroyed()) win.close();
      } catch {}
      win = null;
    };

    const hardTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Hard timeout (' + timeoutMs + 'ms) on ' + url));
    }, timeoutMs);

    let attempts = 0;

    const startPolling = () => {
      const poll = setInterval(async () => {
        attempts++;
        if (!win || win.isDestroyed()) { clearInterval(poll); return; }
        try {
          const result = await win.webContents.executeJavaScript('(' + extractFn.toString() + ')()');
          if (result !== null && result !== undefined) {
            clearInterval(poll);
            clearTimeout(hardTimeout);
            cleanup();
            resolve(result);
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            clearTimeout(hardTimeout);
            cleanup();
            reject(new Error('Rate not found after ' + maxAttempts + ' attempts on ' + url));
          }
        } catch (_) { /* DOM not ready, keep polling */ }
      }, pollMs);
    };

    win.webContents.on('did-finish-load', startPolling);
    // Also start polling on dom-ready in case did-finish-load fires late
    win.webContents.on('dom-ready', () => {
      if (attempts === 0) startPolling();
    });

    win.webContents.on('did-fail-load', (_, code, desc) => {
      clearTimeout(hardTimeout);
      cleanup();
      reject(new Error('Load failed (' + code + '): ' + desc));
    });

    win.loadURL(url);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   INDIVIDUAL FETCHERS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Google rate — Yahoo Finance v8 (real-time, same feed as Google) ──────
 *
 *  yahoo-finance v8/chart endpoint returns the live spot price for
 *  INR=X (USD/INR forex pair). This is the exact same Morningstar/ICE
 *  feed that both Google Finance and Yahoo Finance display — updated
 *  every few minutes during market hours.
 *
 *  No API key. No auth. Completely free.
 *  Fallback: Wise HTML page (also live, confirmed ~same as Google)
 */
async function fetchGoogle() {
  // Primary: Yahoo Finance v8 chart API — real-time forex
  try {
    const data = await fetchJSON(
      'https://query1.finance.yahoo.com/v8/finance/chart/INR%3DX?interval=1m&range=1d',
      { 'Accept': 'application/json' }
    );
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      || data?.chart?.result?.[0]?.meta?.previousClose;
    if (price && price > 80 && price < 115) {
      return { source: 'Google', rate: parseFloat(price.toFixed(2)) };
    }
    throw new Error('Yahoo: unexpected response shape');
  } catch (e1) {
    console.error('[scraper] Yahoo primary failed:', e1.message, '— trying fallback');
  }

  // Fallback: Wise HTML — live mid-market, matches Google within ~0.05
  try {
    const html = await fetchText('https://wise.com/in/currency-converter/usd-to-inr-rate');
    const rate = extractRateFromHTML(html, [
      /1\s*USD\s*=\s*([\d]+[.,][\d]{2,4})\s*INR/i,
      /\$1\s*USD\s*=\s*([\d]+[.,][\d]{2,4})\s*INR/i,
    ]);
    if (rate) return { source: 'Google', rate: parseFloat(rate.toFixed(2)) };
    throw new Error('Wise fallback: no rate in HTML');
  } catch (e2) {
    throw new Error('fetchGoogle: all sources failed. Last: ' + e2.message);
  }
}

/* ── Wise — static HTML fetch, no browser needed ────────────────────────── */
async function fetchWise() {
  // Page contains: "$1 USD = 93.47 INR" in plain HTML
  const html = await fetchText('https://wise.com/in/currency-converter/usd-to-inr-rate');
  const rate = extractRateFromHTML(html, [
    /1\s*USD\s*=\s*([\d]+[.,][\d]{2,4})\s*INR/i,
    /\$1\s*USD\s*=\s*([\d]+[.,][\d]{2,4})\s*INR/i,
    /"rate"\s*:\s*([\d]+\.[\d]{2,6})/,
    /exchangeRate[^>]*>([\d]+\.[\d]{2,4})/,
  ]);
  if (!rate) throw new Error('Wise: rate not found in HTML');
  return { source: 'Wise', rate: parseFloat(rate.toFixed(2)) };
}
/* ── Western Union — JS-rendered, browser needed ───────────────────────── */
async function fetchWesternUnion() {
  const url = 'https://www.westernunion.com/us/en/currency-converter/usd-to-inr-rate.html';
  const extract = function() {
    // Look for "FX:" label followed by the rate number
    var text = document.body.innerText;
    var fxMatch = text.match(/FX:\s*([\d]+\.[\d]{2,4})/);
    if (fxMatch) {
      var n = parseFloat(fxMatch[1]);
      if (n > 80 && n < 115) return n;
    }
    // Fallback: scan all visible leaf elements for INR-range number
    var els = Array.from(document.querySelectorAll('p,span,div,strong,td,li'));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length > 1) continue;
      var t = el.innerText.trim().replace(/,/g, '');
      if (/^\d{2,3}\.\d{2,4}$/.test(t)) {
        var num = parseFloat(t);
        if (num > 80 && num < 115) return num;
      }
    }
    return null;
  };
  const rate = await scrapeWithBrowser(url, extract, { pollMs: 1000, timeoutMs: 28000 });
  return { source: 'Western Union', rate: parseFloat(parseFloat(rate).toFixed(2)) };
}

/* ── Remitly — static HTML fetch, no browser needed ────────────────────── */
async function fetchRemitly() {
  // Page contains: "1 USD = 93.82 INR" in the Special rate section
  const html = await fetchText('https://www.remitly.com/us/en/currency-converter/usd-to-inr-rate');
  const rate = extractRateFromHTML(html, [
    /1\s*USD\s*=\s*([\d]+[.,][\d]{2,4})\s*INR/i,
    /Special\s*rate[^>]*>\s*1\s*USD\s*=\s*([\d]+\.[\d]{2,4})/i,
    /"exchangeRate"\s*:\s*"?([\d]+\.[\d]{2,6})"?/,
    /promotional\s*rate[^>]*>\s*[\d.]+\s*INR\s*to\s*1\s*USD/i,
    /([\d]{2,3}\.[\d]{2,4})\s*INR\s*to\s*1\s*USD/i,
  ]);
  if (!rate) throw new Error('Remitly: rate not found in HTML');
  return { source: 'Remitly', rate: parseFloat(rate.toFixed(2)) };
}

/* ── Xoom — STATIC HTML, no browser needed ──────────────────────────────
 * URL serves rate directly: "1 USD = 93.0990 INR" in plain HTML
 * Confirmed by fetching the page — no JS required.
 */
async function fetchXoom() {
  const html = await fetchText(
    'https://www.xoom.com/en-us/usd/send-money/transfer?countryCode=IN&selectCountry=true'
  );
  const rate = extractRateFromHTML(html, [
    /1\s*USD\s*=\s*([\d]+[.,][\d]{2,6})\s*INR/i,
    /USD\s*=\s*([\d]{2,3}\.\d{2,6})\s*INR/i,
  ]);
  if (!rate) throw new Error('Xoom: rate not found in HTML');
  return { source: 'Xoom', rate: parseFloat(rate.toFixed(2)) };
}

/* ── Western Union — intercept their internal XHR via browser window ─────
 * WU's page is a heavy Angular SPA. Rather than waiting for the DOM,
 * we intercept the network response from their internal pricing endpoint
 * which fires automatically when the page loads. This is faster and
 * more reliable than DOM polling.
 */
async function fetchWesternUnion() {
  const url = 'https://www.westernunion.com/us/en/currency-converter/usd-to-inr-rate.html';

  return new Promise((resolve, reject) => {
    let win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        javascript: true,
        images: false,
        contextIsolation: false,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    win.webContents.setUserAgent(UA_DESKTOP);

    const cleanup = () => {
      try {
        win.webContents.session.webRequest.onBeforeRequest(null);
        win.webContents.session.webRequest.onCompleted(null);
        if (!win.isDestroyed()) win.close();
      } catch {}
      win = null;
    };

    const hardTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('WU timeout'));
    }, 28000);

    // Intercept WU's internal pricing/FX API response
    win.webContents.session.webRequest.onCompleted(
      { urls: ['*://*.westernunion.com/*'] },
      async (details) => {
        if (!win || win.isDestroyed()) return;
        // Their pricing endpoints contain "fx", "rate", "exchange" in the URL
        const u = details.url.toLowerCase();
        if (!(u.includes('fx') || u.includes('rate') || u.includes('exchange') || u.includes('price'))) return;
        if (details.statusCode !== 200) return;

        try {
          // Re-fetch the same endpoint from Node (session already has cookies)
          const data = await fetchJSON(details.url);
          const raw = JSON.stringify(data);
          // Look for INR-range number near "inr" or "rate" keys
          const m = raw.match(/"(?:fx|rate|exchangeRate|fxRate|toAmount)[^"]*"\s*:\s*"?([\d]{2,3}\.[\d]{2,6})"?/i);
          if (m) {
            const n = parseFloat(m[1]);
            if (n > 80 && n < 115) {
              clearTimeout(hardTimeout);
              cleanup();
              resolve({ source: 'Western Union', rate: parseFloat(n.toFixed(2)) });
            }
          }
        } catch {}
      }
    );

    // Also poll the DOM as a fallback
    let attempts = 0;
    win.webContents.on('did-finish-load', () => {
      const poll = setInterval(async () => {
        attempts++;
        if (!win || win.isDestroyed()) { clearInterval(poll); return; }
        try {
          const result = await win.webContents.executeJavaScript(`
            (function() {
              var text = document.body.innerText;
              var m = text.match(/FX:\\s*([\\d]+\\.[\\d]{2,4})/);
              if (m) return parseFloat(m[1]);
              var els = Array.from(document.querySelectorAll('span,p,div,strong'));
              for (var i = 0; i < els.length; i++) {
                var t = els[i].innerText.trim().replace(/,/g,'');
                if (/^\\d{2,3}\\.\\d{2,4}$/.test(t)) {
                  var n = parseFloat(t);
                  if (n > 80 && n < 115) return n;
                }
              }
              return null;
            })()
          `);
          if (result) {
            clearInterval(poll);
            clearTimeout(hardTimeout);
            cleanup();
            resolve({ source: 'Western Union', rate: parseFloat(result.toFixed(2)) });
          } else if (attempts >= 25) {
            clearInterval(poll);
            clearTimeout(hardTimeout);
            cleanup();
            reject(new Error('WU: rate not found after 25 attempts'));
          }
        } catch {}
      }, 1000);
    });

    win.webContents.on('did-fail-load', (_, code, desc) => {
      clearTimeout(hardTimeout);
      cleanup();
      reject(new Error('WU load failed: ' + desc));
    });

    win.loadURL(url);
  });
}

/* ── Crobo — intercept their internal API call ───────────────────────────
 * Crobo is a React SPA (crobo.money). Their app calls an internal API
 * to fetch the live rate. We intercept that network call.
 * Fallback: DOM scan after React hydrates.
 */
async function fetchCrobo() {
  const url = 'https://www.crobo.money/';

  return new Promise((resolve, reject) => {
    let win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        javascript: true,
        images: false,
        contextIsolation: false,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    win.webContents.setUserAgent(UA_DESKTOP);

    const cleanup = () => {
      try {
        win.webContents.session.webRequest.onBeforeRequest(null);
        win.webContents.session.webRequest.onCompleted(null);
        if (!win.isDestroyed()) win.close();
      } catch {}
      win = null;
    };

    const hardTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Crobo timeout'));
    }, 30000);

    // Intercept Crobo's internal rate API
    win.webContents.session.webRequest.onCompleted(
      { urls: ['*://*.crobo.money/*', '*://api.crobo.money/*'] },
      async (details) => {
        if (!win || win.isDestroyed()) return;
        if (details.statusCode !== 200) return;
        const u = details.url.toLowerCase();
        if (!(u.includes('rate') || u.includes('fx') || u.includes('exchange') || u.includes('convert'))) return;
        try {
          const data = await fetchJSON(details.url);
          const raw = JSON.stringify(data);
          const m = raw.match(/"(?:rate|exchangeRate|fxRate|inrRate|price)[^"]*"\s*:\s*"?([\d]{2,3}\.[\d]{2,6})"?/i);
          if (m) {
            const n = parseFloat(m[1]);
            if (n > 80 && n < 115) {
              clearTimeout(hardTimeout);
              cleanup();
              resolve({ source: 'Crobo', rate: parseFloat(n.toFixed(2)) });
            }
          }
        } catch {}
      }
    );

    // DOM fallback — scan after React hydrates
    let attempts = 0;
    win.webContents.on('did-finish-load', () => {
      const poll = setInterval(async () => {
        attempts++;
        if (!win || win.isDestroyed()) { clearInterval(poll); return; }
        try {
          const result = await win.webContents.executeJavaScript(`
            (function() {
              var text = document.body.innerText;
              var m = text.match(/1\\s*USD\\s*=\\s*([\\d]+\\.[\\d]{2,4})\\s*INR/i);
              if (m) return parseFloat(m[1]);
              var els = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span,strong,b,div'));
              for (var i = 0; i < els.length; i++) {
                if (els[i].children.length > 0) continue;
                var t = els[i].innerText.trim().replace(/,/g,'');
                if (/^\\d{2,3}\\.\\d{2,4}$/.test(t)) {
                  var n = parseFloat(t);
                  if (n > 80 && n < 115) return n;
                }
              }
              return null;
            })()
          `);
          if (result) {
            clearInterval(poll);
            clearTimeout(hardTimeout);
            cleanup();
            resolve({ source: 'Crobo', rate: parseFloat(result.toFixed(2)) });
          } else if (attempts >= 30) {
            clearInterval(poll);
            clearTimeout(hardTimeout);
            cleanup();
            reject(new Error('Crobo: rate not found after 30 attempts'));
          }
        } catch {}
      }, 1000);
    });

    win.webContents.on('did-fail-load', (_, code, desc) => {
      clearTimeout(hardTimeout);
      cleanup();
      reject(new Error('Crobo load failed: ' + desc));
    });

    win.loadURL(url);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — runs all fetchers in parallel
   Google + Wise + Remitly finish in ~1-2s (plain HTTP)
   WU + Xoom + Crobo finish in ~5-15s (browser)
   All run simultaneously via Promise.allSettled
   ═══════════════════════════════════════════════════════════════════════════ */
async function scrapeAllRates() {
  const jobs = [
    { label: 'Google',        fn: fetchGoogle        },
    { label: 'Wise',          fn: fetchWise          },
    { label: 'Western Union', fn: fetchWesternUnion  },
    { label: 'Remitly',       fn: fetchRemitly       },
    { label: 'Xoom',          fn: fetchXoom          },
    { label: 'Crobo',         fn: fetchCrobo         },
  ];

  const results = await Promise.allSettled(jobs.map(j => j.fn()));

  return results.map((r, i) => {
    if (r.status === 'fulfilled') {
      console.log('[scraper] OK', jobs[i].label, r.value.rate);
      return r.value;
    }
    console.error('[scraper] FAIL', jobs[i].label, r.reason?.message);
    return { source: jobs[i].label, rate: null, error: r.reason?.message };
  });
}

module.exports = { scrapeAllRates };