import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export function publicAddress(address){
 const ip=String(address||'').toLowerCase(),family=isIP(ip);if(!family)return false;
 if(family===6){if(ip.startsWith('::ffff:')){const tail=ip.slice(7);if(isIP(tail)===4)return publicAddress(tail);const match=/^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(tail);if(!match)return false;const high=parseInt(match[1],16),low=parseInt(match[2],16);return publicAddress([high>>8,high&255,low>>8,low&255].join('.'));}const first=parseInt(ip.split(':')[0],16);return first>=0x2000&&first<=0x3fff&&!ip.startsWith('2001:db8:');}
 const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a>=224||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function fetchPublic(url,redirects=0){
 const target=new URL(url);if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.port&&!['80','443'].includes(target.port))throw new Error('请使用标准http或https公开网页地址。');
 const hostname=target.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true});if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new Error('此抓取入口仅支持公开网站。');
 const chosen=addresses[0];return new Promise((resolve,reject)=>{const agent=target.protocol==='https:'?https:http;const req=agent.get(target,{headers:{'User-Agent':'LocalCanvas/1.0','Accept':'text/html,text/plain','Accept-Encoding':'identity'},lookup:(host,options,callback)=>options?.all?callback(null,[chosen]):callback(null,chosen.address,chosen.family)},response=>{
  if([301,302,303,307,308].includes(response.statusCode)&&response.headers.location){response.resume();if(redirects>=4)return reject(new Error('网页重定向次数过多。'));fetchPublic(new URL(response.headers.location,target).href,redirects+1).then(resolve,reject);return;}
  if(response.statusCode<200||response.statusCode>=300){response.resume();return reject(new Error(`网页返回${response.statusCode}，可能需要登录或不允许自动读取。`));}
  const type=response.headers['content-type']||'';if(!/text\/|application\/(xhtml\+xml|json)/i.test(type)){response.resume();return reject(new Error('这个地址不是可读取的文字网页。'));}
  let size=0;const parts=[];response.on('data',chunk=>{size+=chunk.length;if(size>3*1024*1024){response.destroy();reject(new Error('网页超过3MB，请粘贴需要的段落。'));}else parts.push(chunk);});response.on('end',()=>resolve({html:Buffer.concat(parts).toString('utf8'),url:target.href}));response.on('error',reject);
 });req.setTimeout(20000,()=>req.destroy(new Error('读取网页超时，请重试。')));req.on('error',reject);});
}
