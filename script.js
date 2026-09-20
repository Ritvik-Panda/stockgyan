const menuBtn = document.querySelector('.menu-btn');
const nav = document.querySelector('.nav');
menuBtn?.addEventListener('click', () => nav.classList.toggle('open'));

document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', () => nav.classList.remove('open'));
});


// Load the latest published stock analysis from Cloudflare D1.
async function loadPublishedStockAnalysis() {
  const box = document.getElementById('featured-stock-analysis');
  if (!box) return;
  try {
    const res = await fetch('/api/content?type=stock&limit=1', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('API request failed');
    const items = await res.json();
    if (!items.length) return;
    const item = items[0];
    const summary = item.summary || (item.body || '').replace(/<[^>]*>/g, '').slice(0, 220);
    const tags = (item.tags || 'Fundamentals, Technical, Risk').split(',').map(t => t.trim()).filter(Boolean).slice(0, 4);
    box.innerHTML = `
      <div class="analysis-label">FEATURED STOCK ANALYSIS</div>
      ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" style="width:100%;border-radius:18px;display:block;margin-bottom:18px;object-fit:cover;max-height:260px">` : `<div class="placeholder-chart"><span>StockGyan analysis</span><div class="chart-line"></div></div>`}
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(summary)}</p>
      <div class="tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      <a class="text-link" href="/analysis/${encodeURIComponent(item.slug)}">Read full analysis →</a>`;
  } catch (e) {
    // Keep the designed fallback content if the API is unavailable.
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;',"\"":'&quot;'}[c]));
}

loadPublishedStockAnalysis();
