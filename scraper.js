const { BrowserWindow } = require('electron');

const TIMEOUT_MS = 18000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

function scrapeWithWindow(url, extractFn, pollInterval = 800, maxAttempts = 20) {
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
      },
    });

    win.webContents.setUserAgent(USER_AGENT);

    const cleanup = () => {
      if (win && !win.isDestroyed()) win.close();
      win = null;
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout scraping ${url}`));
    }, TIMEOUT_MS);

    let attempts = 0;

    win.webContents.on('did-finish-load', () => {
      const poll = setInterval(async () => {
        attempts++;
        if (!win || win.isDestroyed()) { clearInterval(poll); return; }
        try {
          const result = await win.webContents.executeJavaScript(`(${extractFn.toString()})()`);
          if (result !== null && result !== undefined && result !== '') {
            clearInterval(poll);
            clearTimeout(timer);
            cleanup();
            resolve(result);
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            clearTimeout(timer);
            cleanup();
            reject(new Error(`Could not extract rate from ${url} after ${maxAttempts} attempts`));
          }
        } catch (e) {}
      }, pollInterval);
    });

    win.webContents.on('did-fail-load', (_, code, desc) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`Failed to load ${url}: ${desc}`));
    });

    win.loadURL(url);
  });
}

/* ─── XE (mid-market) ───────────────────────────────────────────────────── */
async function scrapeXE() {
  const url = 'https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=INR';
  const extract = () => {
    const el = document.querySelector('[class*="converterresult-toAmount"]');
    if (!el) return null;
    const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
    return isNaN(n) || n < 50 ? null : n;
  };
  const rate = await scrapeWithWindow(url, extract);
  return { source: 'XE (mid-market)', rate, url };
}

/* ─── Wise ──────────────────────────────────────────────────────────────── */
async function scrapeWise() {
  const url = 'https://wise.com/gb/currency-converter/usd-to-inr-rate';
  const extract = () => {
    const candidates = [
      document.querySelector('[data-testid="mid-market-rate"] .text-success'),
      document.querySelector('.cc-hero__rate-value'),
      document.querySelector('[class*="rateValue"]'),
      ...[...document.querySelectorAll('strong,b,p,span,h1,h2,h3')].filter(el => {
        const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
        return n > 80 && n < 110 && /^\d{2}\.\d{2,5}$/.test(el.innerText.trim());
      }),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && n > 80 && n < 110) return n;
    }
    return null;
  };
  const rate = await scrapeWithWindow(url, extract, 1000, 22);
  return { source: 'Wise', rate, url };
}

/* ─── Western Union ─────────────────────────────────────────────────────── */
async function scrapeWesternUnion() {
  const url = 'https://www.westernunion.com/us/en/currency-converter/usd-to-inr-rate.html';
  const extract = () => {
    const candidates = [
      document.querySelector('[class*="exchange-rate"] [class*="amount"]'),
      document.querySelector('[class*="exchangeRate"]'),
      document.querySelector('.wu-exchange-rate'),
      ...[...document.querySelectorAll('strong,span,p,div')].filter(el => {
        const t = el.innerText.trim();
        const n = parseFloat(t.replace(/[^0-9.]/g, ''));
        return n > 80 && n < 110 && /^\d{2}\.\d{2,6}$/.test(t);
      }),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && n > 80 && n < 110) return n;
    }
    return null;
  };
  const rate = await scrapeWithWindow(url, extract, 1200, 22);
  return { source: 'Western Union', rate, url };
}

/* ─── Remitly ───────────────────────────────────────────────────────────── */
async function scrapeRemitly() {
  const url = 'https://www.remitly.com/us/en/india';
  const extract = () => {
    const candidates = [
      document.querySelector('[data-testid="exchange-rate-value"]'),
      document.querySelector('[class*="ExchangeRate"]'),
      document.querySelector('[class*="exchange-rate"]'),
      ...[...document.querySelectorAll('strong,span,p,div,h1,h2,h3')].filter(el => {
        const t = el.innerText.trim();
        const n = parseFloat(t.replace(/[^0-9.]/g, ''));
        return n > 80 && n < 110 && /^\d{2}\.\d{2,5}$/.test(t);
      }),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && n > 80 && n < 110) return n;
    }
    return null;
  };
  const rate = await scrapeWithWindow(url, extract, 1000, 22);
  return { source: 'Remitly', rate, url };
}

/* ─── Xoom ──────────────────────────────────────────────────────────────── */
async function scrapeXoom() {
  const url = 'https://www.xoom.com/en-us/send-money/to/india';
  const extract = () => {
    const candidates = [
      document.querySelector('[class*="exchange-rate"]'),
      document.querySelector('[class*="exchangeRate"]'),
      document.querySelector('[data-testid*="rate"]'),
      ...[...document.querySelectorAll('strong,span,p,div,h1,h2,h3')].filter(el => {
        const t = el.innerText.trim();
        const n = parseFloat(t.replace(/[^0-9.]/g, ''));
        return n > 80 && n < 110 && /^\d{2}\.\d{2,5}$/.test(t);
      }),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && n > 80 && n < 110) return n;
    }
    return null;
  };
  const rate = await scrapeWithWindow(url, extract, 1200, 22);
  return { source: 'Xoom', rate, url };
}

/* ─── Crobo ─────────────────────────────────────────────────────────────── */
async function scrapeCrobo() {
  const url = 'https://www.crobo.money/';
  const extract = () => {
    const specific = [
      document.querySelector('[data-testid="exchange-rate"]'),
      document.querySelector('[class*="exchangeRate"]'),
      document.querySelector('[class*="exchange-rate"]'),
      document.querySelector('[class*="rateValue"]'),
      document.querySelector('[class*="rate-value"]'),
    ];
    for (const el of specific) {
      if (!el) continue;
      const n = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
      if (!isNaN(n) && n > 80 && n < 110) return n;
    }
    const all = [...document.querySelectorAll('h1,h2,h3,h4,p,span,strong,b,div')];
    for (const el of all) {
      if (el.children.length > 0) continue;
      const t = el.innerText.trim();
      if (/^\d{2}\.\d{2,5}$/.test(t)) {
        const n = parseFloat(t);
        if (n > 80 && n < 110) return n;
      }
    }
    return null;
  };
  const rate = await scrapeWithWindow(url, extract, 1000, 25);
  return { source: 'Crobo', rate, url };
}

/* ─── Fetch all in parallel ─────────────────────────────────────────────── */
async function scrapeAllRates() {
  const results = await Promise.allSettled([
    scrapeXE(),
    scrapeWise(),
    scrapeWesternUnion(),
    scrapeRemitly(),
    scrapeXoom(),
    scrapeCrobo(),
  ]);

  const labels = ['XE (mid-market)', 'Wise', 'Western Union', 'Remitly', 'Xoom', 'Crobo'];
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`[scraper] ${labels[i]} failed:`, r.reason?.message);
    return { source: labels[i], rate: null, error: r.reason?.message };
  });
}

module.exports = { scrapeAllRates, scrapeXE, scrapeWise, scrapeWesternUnion, scrapeRemitly, scrapeXoom, scrapeCrobo };
