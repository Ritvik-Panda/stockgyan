
/* =========================================
   STOCKGYAN HOMEPAGE SCRIPT
   Navigation, stock analysis, enquiries,
   and Market Today quotes
   ========================================= */


/* -----------------------------------------
   1. MOBILE NAVIGATION
   ----------------------------------------- */

const menuBtn = document.querySelector('.menu-btn');
const nav = document.querySelector('.nav');

menuBtn?.addEventListener('click', () => {
  nav?.classList.toggle('open');
});

document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', () => nav?.classList.remove('open'));
});


/* -----------------------------------------
   2. FEATURED STOCK ANALYSIS
   ----------------------------------------- */

async function loadPublishedStockAnalysis() {
  const box = document.getElementById('featured-stock-analysis');
  if (!box) return;

  try {
    const res = await fetch('/api/content?type=stock&limit=1', {
      headers: { Accept: 'application/json' }
    });

    if (!res.ok) throw new Error('API request failed');

    const items = await res.json();
    if (!Array.isArray(items) || !items.length) return;

    const item = items[0];

    const summary = item.summary ||
      (item.body || '').replace(/<[^>]*>/g, '').slice(0, 220);

    const tags = (item.tags || 'Fundamentals, Technical, Risk')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 4);

    box.innerHTML = `
      <div class="analysis-label">FEATURED STOCK ANALYSIS</div>

      ${
        item.image_url
          ? `<img src="${escapeHtml(item.image_url)}"
               alt="${escapeHtml(item.title)}"
               style="width:100%;border-radius:18px;display:block;margin-bottom:18px;object-fit:cover;max-height:260px">`
          : `<div class="placeholder-chart">
               <span>StockGyan analysis</span>
               <div class="chart-line"></div>
             </div>`
      }

      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(summary)}</p>

      <div class="tags">
        ${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}
      </div>

      <a class="text-link"
         href="/analysis/${encodeURIComponent(item.slug)}">
        Read full analysis →
      </a>`;
  } catch (error) {
    console.warn('Stock analysis could not be loaded:', error);
  }
}


/* -----------------------------------------
   3. HTML ESCAPING
   ----------------------------------------- */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}


/* -----------------------------------------
   4. HOMEPAGE ENQUIRY FORM
   Existing API: POST /api/enquiry
   ----------------------------------------- */

const enquiryForm = document.getElementById('enquiryForm');

if (enquiryForm) {
  enquiryForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const messageBox = document.getElementById('enquiryMsg');
    const submitButton = enquiryForm.querySelector('button[type="submit"]');

    if (!messageBox || !submitButton) return;

    const payload = {
      name: document.getElementById('enquiryName')?.value.trim() || '',
      phone: document.getElementById('enquiryPhone')?.value.trim() || '',
      enquiry_type: document.getElementById('enquiryType')?.value || '',
      message: ''
    };

    if (!payload.name || !payload.phone || !payload.enquiry_type) {
      messageBox.textContent = 'Please complete all required fields.';
      messageBox.className = 'form-message is-visible error';
      return;
    }

    messageBox.textContent = 'Submitting your enquiry…';
    messageBox.className = 'form-message is-visible';
    submitButton.disabled = true;

    try {
      const response = await fetch('/api/enquiry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || 'Unable to submit your enquiry.');
      }

      messageBox.textContent =
        'Thank you! Your enquiry has been submitted successfully.';
      messageBox.className = 'form-message is-visible success';
      enquiryForm.reset();

    } catch (error) {
      messageBox.textContent =
        error.message || 'Unable to submit your enquiry. Please try again.';
      messageBox.className = 'form-message is-visible error';

    } finally {
      submitButton.disabled = false;
    }
  });
}


/* -----------------------------------------
   5. MARKET TODAY
   Existing API: /api/market/quote
   ----------------------------------------- */

async function loadHomepageMarketToday() {
  const section = document.querySelector('.market-today');
  if (!section) return;

  const tiles = [...section.querySelectorAll('.market-tile')];
  if (!tiles.length) return;

  // Only these four indices are loaded.
  const instruments = [
    { name: 'NIFTY 50', key: 'NSE_INDEX|Nifty 50' },
    { name: 'BANK NIFTY', key: 'NSE_INDEX|Nifty Bank' },
    { name: 'SENSEX', key: 'BSE_INDEX|SENSEX' },
    { name: 'INDIA VIX', key: 'NSE_INDEX|India VIX' }
  ];

  function findTile(name) {
    return tiles.find(tile =>
      tile.querySelector('small')?.textContent.trim().toUpperCase() === name
    );
  }

  function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return null;

    return number.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function extractQuote(responseData, instrumentKey) {
    const data = responseData?.data;

    if (!data || typeof data !== 'object') return null;

    const normalizedKey = instrumentKey.replace('|', ':');

    return data[normalizedKey] ||
      data[instrumentKey] ||
      Object.values(data)[0] ||
      null;
  }

  function setChangeColour(element, change) {
    if (!element) return;

    // Remove previous classes and inline styling.
    element.classList.remove('up', 'down', 'positive', 'negative');

    if (change > 0) {
      element.classList.add('up', 'positive');
      element.style.setProperty('color', '#159447', 'important');
    } else if (change < 0) {
      element.classList.add('down', 'negative');
      element.style.setProperty('color', '#dc2626', 'important');
    } else {
      element.style.setProperty('color', '#64748b', 'important');
    }
  }

  async function loadInstrument(instrument) {
    const tile = findTile(instrument.name);
    if (!tile) return;

    const priceElement = tile.querySelector('strong');
    const detailElement = tile.querySelector('span');

    if (priceElement) {
      priceElement.textContent = 'Loading…';
    }

    if (detailElement) {
      detailElement.textContent = 'Fetching market quote…';
      detailElement.classList.remove('up', 'down', 'positive', 'negative');
      detailElement.style.removeProperty('color');
    }

    try {
      const response = await fetch(
        '/api/market/quote?instrument_key=' +
          encodeURIComponent(instrument.key),
        {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.message || 'Quote request failed');
      }

      const quote = extractQuote(result, instrument.key);
      if (!quote) throw new Error('No quote returned');

      const price = Number(quote.last_price);

      const previousClose = Number(
        quote.prev_close ??
        quote.prev_close_price ??
        quote.ohlc?.close ??
        quote.previous_close
      );

      const suppliedChange = Number(
        quote.change ?? quote.net_change
      );

      const change = Number.isFinite(suppliedChange)
        ? suppliedChange
        : Number.isFinite(price) &&
          Number.isFinite(previousClose) &&
          previousClose > 0
            ? price - previousClose
            : NaN;

      const percentage =
        Number.isFinite(previousClose) &&
        previousClose > 0 &&
        Number.isFinite(change)
          ? (change / previousClose) * 100
          : NaN;

      if (!Number.isFinite(price)) {
        throw new Error('Price is unavailable');
      }

      if (priceElement) {
        priceElement.textContent = '₹' + formatNumber(price);
      }

      if (detailElement) {
        if (Number.isFinite(change)) {
          const pointText =
            `${change > 0 ? '+' : ''}${formatNumber(change)}`;

          const percentText = Number.isFinite(percentage)
            ? ` (${percentage > 0 ? '+' : ''}${percentage.toFixed(2)}%)`
            : '';

          detailElement.textContent = pointText + percentText;

          // Force the colour to match the sign of the change.
          setChangeColour(detailElement, change);

        } else {
          detailElement.textContent = 'Change unavailable';
          detailElement.classList.remove(
            'up', 'down', 'positive', 'negative'
          );
          detailElement.style.removeProperty('color');
        }
      }

      tile.dataset.marketStatus = quote.last_trade_time
        ? 'quote-received'
        : 'latest-available-quote';

    } catch (error) {
      console.warn(
        `Market Today: ${instrument.name} quote failed`,
        error
      );

      if (priceElement) {
        priceElement.textContent = 'Unavailable';
      }

      if (detailElement) {
        detailElement.textContent = 'Quote currently unavailable';
        detailElement.classList.remove(
          'up', 'down', 'positive', 'negative'
        );
        detailElement.style.removeProperty('color');
      }

      tile.dataset.marketStatus = 'unavailable';
    }
  }

  await Promise.all(instruments.map(loadInstrument));

  const heading = section.querySelector('.market-time');

  if (heading) {
    heading.textContent = 'Market quotes · Values may be delayed';
  }
}


/* -----------------------------------------
   6. INITIALIZE HOMEPAGE FEATURES
   ----------------------------------------- */

loadPublishedStockAnalysis();
loadHomepageMarketToday();
