import {createSession,json} from './auth.js';
export async function onRequestPost({request,env}) {
  const {pin} = await request.json().catch(()=>({}));
  if (!env.ADMIN_PIN || !env.SESSION_SECRET) return json({error:'Admin secrets are not configured.'},500);
  if (String(pin || '') !== String(env.ADMIN_PIN)) return json({error:'Incorrect PIN.'},401);
  const token = await createSession(env.SESSION_SECRET);
  return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`sg_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`}});
}
