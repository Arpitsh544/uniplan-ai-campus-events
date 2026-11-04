const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'shared-data');
const STATE_FILE = path.join(DATA, 'state.json');
const PORT = Number(process.env.UNIPLAN_PORT || 8787);
fs.mkdirSync(DATA, { recursive: true });
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
const allowedKeys = new Set(['uniplan-events', 'uniplan-users']);
function persist() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); }
function send(res, status, body, type='application/json; charset=utf-8') { res.writeHead(status, {'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control':'no-store'}); res.end(body); }
function readBody(req, limit=5*1024*1024) { return new Promise((resolve, reject) => { const chunks=[]; let size=0; req.on('data', chunk=>{size+=chunk.length;if(size>limit){reject(new Error('too large'));req.destroy();return}chunks.push(chunk)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject); }); }
function docPath(id) { if (!/^\d{8,20}$/.test(id)) return null; return path.join(DATA, 'docs', id + '.pdf'); }
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end(); }
  if (url.pathname === '/api/state' && req.method === 'GET') return send(res,200,JSON.stringify(state));
  if (url.pathname.startsWith('/api/state/') && ['POST','DELETE'].includes(req.method)) {
    const key=decodeURIComponent(url.pathname.slice('/api/state/'.length)); if(!allowedKeys.has(key)) return send(res,400,JSON.stringify({error:'invalid key'}));
    if(req.method==='DELETE'){delete state[key];persist();return send(res,200,JSON.stringify({ok:true}));}
    try { const data=JSON.parse((await readBody(req,2*1024*1024)).toString('utf8'));if(typeof data.value!=='string')return send(res,400,JSON.stringify({error:'value must be text'}));state[key]=data.value;persist();return send(res,200,JSON.stringify({ok:true})); }
    catch(e){return send(res,e.message==='too large'?413:400,JSON.stringify({error:'invalid request'}));}
  }
  if (url.pathname.startsWith('/api/docs/')) {
    const id=decodeURIComponent(url.pathname.slice('/api/docs/'.length)),file=docPath(id);if(!file)return send(res,400,JSON.stringify({error:'invalid document id'}));
    if(req.method==='GET'){if(!fs.existsSync(file))return send(res,404,JSON.stringify({error:'not found'}));res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'});return fs.createReadStream(file).pipe(res);}
    if(req.method==='POST'){try{const bytes=await readBody(req,4*1024*1024);if(bytes.length<5||bytes.subarray(0,5).toString()!=='%PDF-')return send(res,415,JSON.stringify({error:'PDF required'}));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return send(res,200,JSON.stringify({ok:true}));}catch(e){return send(res,e.message==='too large'?413:400,JSON.stringify({error:'upload failed'}));}}
    return send(res,405,JSON.stringify({error:'method not allowed'}));
  }
  if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){
    try{let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');const payload=JSON.stringify(state).replace(/</g,'\\u003c');html=html.replace('<script>','<script>window.__UNIPLAN_SHARED__='+payload+';</script><script>');return send(res,200,html,'text/html; charset=utf-8');}catch{return send(res,500,'App file missing','text/plain; charset=utf-8');}
  }
  return send(res,404,'Not found','text/plain; charset=utf-8');
});
server.listen(PORT,'0.0.0.0',()=>{
 const addresses=Object.values(os.networkInterfaces()).flat().filter(n=>n&&n.family==='IPv4'&&!n.internal).map(n=>n.address);
 console.log(`UniPlan shared demo running on port ${PORT}`);
 console.log(`Local: http://localhost:${PORT}`);
 for(const ip of addresses)console.log(`LAN: http://${ip}:${PORT}`);
});
