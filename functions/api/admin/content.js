import {validSession,json} from './auth.js';
const allowed = new Set(['article','stock','mutual_fund','sip','ipo','nfo','strategy','video','pdf']);
function clean(v){ return typeof v==='string' ? v.trim() : ''; }
function slugify(s){ return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120); }
async function guard(request,env){ return await validSession(request,env.SESSION_SECRET); }
export async function onRequest({request,env}) {
  if (request.method === 'OPTIONS') return new Response(null,{status:204});
  if (!await guard(request,env)) return json({error:'Unauthorized.'},401);
  if (!env.DB) return json({error:'D1 database binding DB is not configured.'},500);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const type = url.searchParams.get('type');
    const q = url.searchParams.get('q');
    let sql='SELECT id,type,title,slug,summary,body,image_url,tags,status,created_at,updated_at FROM content';
    const params=[]; const where=[];
    if(type && allowed.has(type)){where.push('type = ?');params.push(type)}
    if(q){where.push('(title LIKE ? OR tags LIKE ?)');params.push(`%${q}%`,`%${q}%`)}
    if(where.length) sql+=' WHERE '+where.join(' AND ');
    sql+=' ORDER BY updated_at DESC LIMIT 200';
    const result=await env.DB.prepare(sql).bind(...params).all();
    return json(result.results||[]);
  }
  const data=await request.json().catch(()=>null);
  if(!data) return json({error:'Invalid JSON.'},400);
  if(request.method==='POST'){
    const type=clean(data.type), title=clean(data.title), slug=clean(data.slug)||slugify(title);
    if(!allowed.has(type)||!title||!slug) return json({error:'Type, title and slug are required.'},400);
    try{
      const r=await env.DB.prepare(`INSERT INTO content (type,title,slug,summary,body,image_url,tags,status) VALUES (?,?,?,?,?,?,?,?)`).bind(type,title,slug,clean(data.summary),clean(data.body),clean(data.image_url),clean(data.tags),data.status==='published'?'published':'draft').run();
      return json({ok:true,id:r.meta.last_row_id});
    }catch(e){ return json({error:e.message},400); }
  }
  if(request.method==='PUT'){
    const id=Number(data.id); if(!Number.isInteger(id)) return json({error:'Valid id required.'},400);
    const type=clean(data.type), title=clean(data.title), slug=clean(data.slug)||slugify(title);
    if(!allowed.has(type)||!title||!slug) return json({error:'Type, title and slug are required.'},400);
    try{
      await env.DB.prepare(`UPDATE content SET type=?,title=?,slug=?,summary=?,body=?,image_url=?,tags=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(type,title,slug,clean(data.summary),clean(data.body),clean(data.image_url),clean(data.tags),data.status==='published'?'published':'draft',id).run();
      return json({ok:true});
    }catch(e){ return json({error:e.message},400); }
  }
  if(request.method==='DELETE'){
    const id=Number(data.id); if(!Number.isInteger(id)) return json({error:'Valid id required.'},400);
    await env.DB.prepare('DELETE FROM content WHERE id=?').bind(id).run();
    return json({ok:true});
  }
  return json({error:'Method not allowed.'},405);
}
