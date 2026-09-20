// Public read-only content API for StockGyan.
// Only published content is exposed; drafts remain private to the admin API.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300'
    }
  });
}

const allowed = new Set(['article','stock','mutual_fund','sip','ipo','nfo','strategy','video','pdf']);

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (!env.DB) return json({ error: 'D1 database binding DB is not configured.' }, 500);

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';
  const slug = url.searchParams.get('slug') || '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 12), 1), 50);

  try {
    if (slug) {
      const row = await env.DB.prepare(
        `SELECT id,type,title,slug,summary,body,image_url,tags,status,created_at,updated_at
         FROM content WHERE slug = ? AND status = 'published' LIMIT 1`
      ).bind(slug).first();
      return row ? json(row) : json({ error: 'Content not found.' }, 404);
    }

    if (type && !allowed.has(type)) return json({ error: 'Invalid content type.' }, 400);

    let sql = `SELECT id,type,title,slug,summary,body,image_url,tags,status,created_at,updated_at
               FROM content WHERE status = 'published'`;
    const params = [];
    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const result = await env.DB.prepare(sql).bind(...params).all();
    return json(result.results || []);
  } catch (error) {
    return json({ error: error.message || 'Database error.' }, 500);
  }
}
