import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const MAX_FETCH=4*1024*1024,MAX_DOCUMENT=12*1024*1024,MAX_TEXT=180000;
export function isPublicIP(address){
 if(net.isIP(address)===4){const b=address.split('.').map(Number);return !(b[0]===0||b[0]===10||b[0]===127||b[0]>=224||b[0]===169&&b[1]===254||b[0]===172&&b[1]>=16&&b[1]<=31||b[0]===192&&(b[1]===168||b[1]===0&&b[2]===0||b[1]===0&&b[2]===2)||b[0]===100&&b[1]>=64&&b[1]<=127||b[0]===198&&(b[1]===18||b[1]===19||b[1]===51&&b[2]===100)||b[0]===203&&b[1]===0&&b[2]===113);}
 if(net.isIP(address)===6){const normalized=address.toLowerCase();if(normalized.startsWith('::ffff:')){const end=normalized.slice(7);if(net.isIP(end)===4)return isPublicIP(end);return false;}const first=parseInt(normalized.split(':')[0],16);return first>=0x2000&&first<=0x3fff&&!normalized.startsWith('2001:db8:');}
 return false;
}
export async function resolvePublicURL(input,lookup=dns.lookup){let url;try{url=new URL(input);}catch{throw new Error('请输入完整的 http 或 https 网页地址。');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw new Error('网页抓取仅支持公开的 http/https 地址和标准端口。');const host=url.hostname.replace(/^\[|\]$/g,'');if(host.toLowerCase()==='localhost'||host.toLowerCase().endsWith('.localhost')||host.toLowerCase().endsWith('.local'))throw new Error('不能抓取本机或内网地址。');const answers=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true,verbatim:true});if(!answers.length||answers.some(a=>!isPublicIP(a.address)))throw new Error('不能抓取本机、内网或保留网络地址。');return{url,answers};}
export async function fetchPublic(input,{redirects=0,lookup=dns.lookup}={}){
 const {url,answers}=await resolvePublicURL(input,lookup);if(redirects>4)throw new Error('网页跳转过多。');
 const result=await new Promise((resolve,reject)=>{const transport=url.protocol==='https:'?https:http;const request=transport.request(url,{method:'GET',headers:{'User-Agent':'LocalCanvasReader/1.0','Accept':'text/html,text/plain,application/xhtml+xml','Accept-Encoding':'identity'},lookup:(hostname,options,callback)=>{if(options?.all)callback(null,answers);else callback(null,answers[0].address,answers[0].family);}},response=>{if(response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.resume();resolve({redirect:new URL(response.headers.location,url).href});return;}if(response.statusCode<200||response.statusCode>=300){response.resume();reject(new Error(`网页返回 ${response.statusCode}，无法读取。`));return;}const type=String(response.headers['content-type']||'');if(!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)){response.resume();reject(new Error('这个地址不是可读取的文字网页。'));return;}if(Number(response.headers['content-length'])>MAX_FETCH){response.resume();reject(new Error('网页内容过大，请改用较短页面。'));return;}let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>MAX_FETCH)request.destroy(new Error('网页内容超过 4 MB。'));else chunks.push(chunk);});response.on('end',()=>resolve({body:Buffer.concat(chunks).toString('utf8'),type,url:url.href}));response.on('error',reject);});request.setTimeout(15000,()=>request.destroy(new Error('网页读取超时，请稍后再试。')));request.on('error',reject);request.end();});
 if(result.redirect)return fetchPublic(result.redirect,{redirects:redirects+1,lookup});return result;
}
export function decodeEntities(text){return text.replace(/&#(x[\da-f]+|\d+);/gi,(_,s)=>{const n=s[0].toLowerCase()==='x'?parseInt(s.slice(1),16):Number(s);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,(_,s)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[s.toLowerCase()]);}
export function htmlText(html){return decodeEntities(html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')).replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
export async function readWeb(url){const response=await fetchPublic(url);const title=decodeEntities(response.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()||new URL(response.url).hostname);const source=/text\/plain/.test(response.type)?response.body:(response.body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||response.body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||response.body);const text=/text\/plain/.test(response.type)?source.trim():htmlText(source);if(!text)throw new Error('网页没有提取到文字，可能需要登录或依赖动态加载。');return{title:htmlText(title).slice(0,300),content:text.slice(0,MAX_TEXT),url:response.url,truncated:text.length>MAX_TEXT};}

function run(command,args,{timeout=20000,maxOutput=2*1024*1024}={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});let out='',err='',size=0;const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('文档解析超时。'));},timeout);child.stdout.on('data',c=>{size+=c.length;if(size>maxOutput){child.kill('SIGTERM');reject(new Error('文档文字太多，请拆分文件。'));}else out+=c;});child.stderr.on('data',c=>err=(err+c).slice(-1500));child.on('error',()=>{clearTimeout(timer);reject(new Error('当前电脑缺少文档解析工具。'));});child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(out);else reject(new Error(/encrypted|password/i.test(err)?'文档有密码，请先解锁文件。':'无法解析此文档，请确认文件没有损坏。'));});});}
const PYTHON_PARSE=String.raw`import sys,zipfile,xml.etree.ElementTree as ET
p=sys.argv[1];kind=sys.argv[2]
if kind=='docx':
 with zipfile.ZipFile(p) as z:
  info=z.getinfo('word/document.xml')
  if info.file_size>20*1024*1024: raise ValueError('document too large')
  root=ET.fromstring(z.read(info))
  for para in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
   print(''.join(t.text or '' for t in para.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')))
else:
 from pypdf import PdfReader
 reader=PdfReader(p)
 if len(reader.pages)>500: raise ValueError('too many pages')
 for page in reader.pages: print(page.extract_text() or '')
`;
async function documentPython(){const candidates=[process.env.CANVAS_PYTHON,join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'),'/usr/bin/python3'].filter(Boolean);for(const p of candidates){try{await access(p);return p;}catch{}}return '/usr/bin/python3';}
export async function readDocument({filename,base64,mimeType}){if(typeof filename!=='string'||typeof base64!=='string'||base64.length>Math.ceil(MAX_DOCUMENT*4/3)+20||!/^[a-zA-Z0-9+/]*={0,2}$/.test(base64))throw new Error('文件无效或超过 12 MB。');const data=Buffer.from(base64,'base64');if(data.length>MAX_DOCUMENT||data.length===0)throw new Error('文件为空或超过 12 MB。');const ext=filename.toLowerCase().split('.').pop();let text;
 if(['txt','md','markdown','csv','tsv','json','log','html','htm','xml','yaml','yml'].includes(ext)){text=data.toString('utf8').replace(/^\uFEFF/,'');if(text.includes('\0'))throw new Error('文件不是可读取的文字编码，请转换为 UTF-8。');if(['html','htm'].includes(ext))text=htmlText(text);}
 else if(['pdf','docx'].includes(ext)){const directory=await mkdtemp(join(tmpdir(),'canvas-document-'));try{const p=join(directory,`upload.${ext}`);await writeFile(p,data,{mode:0o600});text=await run(await documentPython(),['-c',PYTHON_PARSE,p,ext]);}finally{await rm(directory,{recursive:true,force:true});}}
 else throw new Error('暂不支持此格式。可添加 PDF、DOCX、TXT、Markdown、CSV 或 HTML。');
 if(!text.trim())throw new Error(ext==='pdf'?'这个 PDF 没有可提取的文字，可能是扫描件；当前版本尚不支持 OCR。':'没有从文件中提取到文字。');return{title:filename.slice(0,300),filename:filename.slice(0,300),mimeType:String(mimeType||'application/octet-stream').slice(0,150),content:text.trim().slice(0,MAX_TEXT),truncated:text.trim().length>MAX_TEXT};}
