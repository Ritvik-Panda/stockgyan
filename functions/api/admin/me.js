import {validSession,json} from './auth.js';
export async function onRequestGet({request,env}){ return json({authenticated:await validSession(request,env.SESSION_SECRET)}); }
