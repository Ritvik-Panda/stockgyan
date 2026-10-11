
const menuBtn = document.querySelector('.menu-btn');
const nav = document.querySelector('.nav');

menuBtn?.addEventListener('click', () => {
  nav?.classList.toggle('open');
});

document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', () => nav?.classList.remove('open'));
});


// Load the latest published stock analysis from Cloudflare D1.
async function loadPublishedStockAnalysis() {
  const box = document.getElementById('featured-stock-analysis');
  if (!box) return;

  try {
    const res = await fetch('/api/content?type=stock&limit=1', {
      headers: { 'Accept': 'application/json' }
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
      ${item.image_url
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
      <a class="text-link" href="/analysis/${encodeURIComponent(item.slug)}">
        Read full analysis →
      </a>`;
  } catch (e) {
    // Keep the designed fallback content if the API is unavailable.
  }
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}


// Submit homepage enquiries to the existing Cloudflare API.
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
          'Accept': 'application/json'
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


// Initialize homepage stock analysis.
loadPublishedStockAnalysis();
