'use strict';
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {openDatabase,transaction}=require('./database.cjs');
const {publicUser,verifyPassword,hashPassword,seedUsers,createSession,getSession}=require('./auth.cjs');
const {HttpError,fail,snapshot,committee,createRequest,mutate}=require('./service.cjs');
const ROOT=path.resolve(__dirname,'..');
const STATIC=new Map([['/','index.html'],['/index.html','index.html'],['/wireframe.html','wireframe.html'],['/js/app.js','js/app.js'],['/js/print.js','js/print.js'],['/css/styles.css','css/styles.css']]);
async function readJson(req) {
  if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Se requiere application/json.');
  let body='';
  for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>100_000)fail(413,'Solicitud demasiado grande.');}
  let data;try{data=JSON.parse(body);}catch{fail(400,'JSON inválido.');}
  if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Objeto JSON inválido.');
  return data;
}
function createApp({filename=process.env.DB_PATH||path.join(__dirname,'data','changeflow.sqlite'),seedPassword=process.env.SEED_PASSWORD,secureCookies=process.env.COOKIE_SECURE==='true'}={}) {
  const db=openDatabase(filename);
  try{seedUsers(db,seedPassword);}catch(e){db.close();throw e;}
  const publicAttempts=new Map();
  const attempts=new Map(),dummyHash=hashPassword('Unused-Dummy-Password');
  const cookie=token=>`changeflow_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?28800:0}${secureCookies?'; Secure':''}`;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      if(!route.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(req.method))fail(405,'Método no permitido.');
        const file=STATIC.get(route);if(!file)fail(404,'Página no encontrada.');
        const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
        res.writeHead(200,{'Content-Type':`${types[path.extname(file)]}; charset=utf-8`,'Cache-Control':'no-cache'});
        res.end(req.method==='HEAD'?undefined:fs.readFileSync(path.join(ROOT,file)));return;
      }
      const mutation=!['GET','HEAD'].includes(req.method);
      if(mutation) {
        const origin=req.headers.origin;
        if(origin && origin!==`${secureCookies?'https':'http'}://${req.headers.host}`)fail(403,'Origen no permitido.');
      }
      if(route==='/api/auth/login'&&req.method==='POST') {
        const data=await readJson(req),ip=req.socket.remoteAddress;
        for(const [key,value] of attempts)if(value.until<Date.now())attempts.delete(key);
        const attempt=attempts.get(ip)||{count:0,until:Date.now()+15*60*1000};
        if(attempt.count>=10)fail(429,'Demasiados intentos. Espera 15 minutos.');
        if(typeof data.email!=='string'||typeof data.password!=='string'||data.email.length>200||data.password.length>512)fail(400,'Credenciales inválidas.');
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(data.email.trim().toLowerCase());
        if(!verifyPassword(data.password,user?.password_hash||dummyHash)||!user?.active){attempt.count++;attempts.set(ip,attempt);fail(401,'Correo o contraseña incorrectos.');}
        attempts.delete(ip);
        const previous=getSession(db,req);if(previous)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.token_hash);
        const session=createSession(db,user.id);res.setHeader('Set-Cookie',cookie(session.token));json(200,{user:publicUser(user),csrf:session.csrf});return;
      }
      if(route==='/api/public/requests'&&req.method==='POST') {
        const now=Date.now(),ip=req.socket.remoteAddress;
        for(const [key,value] of publicAttempts)if(value.until<now)publicAttempts.delete(key);
        const attempt=publicAttempts.get(ip)||{count:0,until:now+60*60*1000};
        if(attempt.count>=20)fail(429,'Has enviado demasiadas solicitudes. Intenta más tarde.');
        attempt.count++;publicAttempts.set(ip,attempt);
        const data=await readJson(req),r=transaction(db,()=>createRequest(db,null,data));
        json(201,{receipt:{id:r.id,trackingCode:r.trackingCode,date:r.date,status:r.status}});return;
      }
      const session=getSession(db,req);if(!session)fail(401,'Inicia sesión para continuar.');
      if(mutation && req.headers['x-csrf-token']!==session.csrf)fail(403,'Sesión de formulario inválida. Actualiza la página.');
      if(route==='/api/auth/me'&&req.method==='GET'){json(200,{user:publicUser(session),csrf:session.csrf});return;}
      if(route==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);res.setHeader('Set-Cookie',cookie(''));json(200,{ok:true});return;}
      if(route==='/api/committee'&&req.method==='GET'){json(200,{users:session.role==='ccc'?committee(db):[]});return;}
      if(route==='/api/requests'&&req.method==='GET'){json(200,snapshot(db,session));return;}
      if(route==='/api/requests'&&req.method==='POST') {
        const data=await readJson(req),r=transaction(db,()=>createRequest(db,session,data));json(201,{request:r,store:snapshot(db,session)});return;
      }
      const match=/^\/api\/requests\/(SCR-\d+)(?:\/(analysis|vote|resolution|clarification))?$/.exec(route);
      if(match && (req.method==='POST'&&match[2] || req.method==='PATCH'&&!match[2] || req.method==='DELETE'&&!match[2])) {
        const data=await readJson(req),action=match[2]||(req.method==='DELETE'?'delete':'edit');
        const r=transaction(db,()=>mutate(db,match[1],action,session,data));json(200,{request:r,store:snapshot(db,session)});return;
      }
      fail(404,'Ruta no encontrada.');
    } catch(error) {
      const status=error instanceof HttpError?error.status:500;
      if(status===500)console.error(error);
      if(!res.headersSent)json(status,{error:status===500?'No se pudo completar la operación.':error.message});else res.end();
    }
  });
  server.on('close',()=>db.close());
  return {server,db};
}
if(require.main===module) {
  try {
    const {server}=createApp();
    const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
    server.on('error',error=>{console.error(`No se pudo iniciar el servidor: ${error.code}. Revisa HOST y PORT en .env.`);process.exitCode=1;server.close();});
    server.listen(port,host,()=>console.log(`ChangeFlow disponible en http://${host}:${port}`));
    const close=()=>server.close(()=>process.exit(0));process.on('SIGINT',close);process.on('SIGTERM',close);
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={createApp};
