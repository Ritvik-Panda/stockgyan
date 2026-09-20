function b64urlEncode(s) {
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(s) {
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  return atob(s);
}
async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  let bin=''; for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return b64urlEncode(bin);
}
function cookieValue(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const found = raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  return found ? decodeURIComponent(found.slice(name.length+1)) : null;
}
export async function createSession(secret) {
  const payload = `${Date.now()}.${crypto.randomUUID()}`;
  return `${b64urlEncode(payload)}.${await sign(secret,payload)}`;
}
export async function validSession(request, secret) {
  if (!secret) return false;
  const token = cookieValue(request,'sg_session');
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  let payload;
  try { payload = b64urlDecode(parts[0]); } catch { return false; }
  const expected = await sign(secret,payload);
  if (expected !== parts[1]) return false;
  const ts = Number(payload.split('.')[0]);
  return Number.isFinite(ts) && Date.now()-ts < 8*60*60*1000;
}
export const json = (data,status=200,extra={}) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
export const cors = {'Access-Control-Allow-Origin':'','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'};
