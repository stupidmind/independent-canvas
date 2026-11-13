import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {prepareImages} from './image-inputs.mjs';
import {loadState,saveState,history,restore,readReplay} from './storage.mjs';
import {fetchPublic} from './web_fetch.mjs';
import {completeCodex} from './backend/codex.mjs';
import {runCanvasAgent} from './backend/agent-engine.mjs';
import {routeConnectors,getEnabledTools,callConnectorTool,closeConnectors} from './backend/connectors.mjs';
import {routeVideo,closeVideo} from './backend/video.mjs';
import {routeBackup} from './backend/backup.mjs';
import {routeMedia,closeMedia} from './backend/media.mjs';
import {routeSkills,readSelectedSkills} from './backend/skills.mjs';
import {routeProviders,completeWithProvider} from './backend/providers.mjs';
import {saveAttachment,readAttachment,serveAttachment,saveImageAttachment} from './backend/attachments.mjs';
const root=fileURLToPath(new URL('./public/',import.meta.url)),requestedPort=Number(process.env.PORT||4317);
const python=process.env.PYTHON_BIN||'python3';
const jobs=new Map(),approvals=new Map();let active=0;
function json(res,status,data){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,limit=32*1024*1024){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('内容过大，请缩小或拆分后重试。');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
function extract(data){return new Promise((resolve,reject)=>{const child=spawn(python,[fileURLToPath(new URL('./extract_document.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('文档处理超时，请拆成较小文件。'));},45000);child.stdout.on('data',x=>{output+=x;if(output.length>12*1024*1024)child.kill('SIGKILL');});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('本机文档处理环境不可用。'));});child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(output);if(code||result.error)reject(Error(result.error||'文档处理失败。'));else resolve(result);}catch{reject(Error('文档无法读取，请检查文件格式。'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(data));});}
function requireApproval(event,signal,emit,requestId){return new Promise(resolve=>{const id=crypto.randomUUID(),timer=setTimeout(()=>settle(false),120000);function settle(value){clearTimeout(timer);signal.removeEventListener('abort',cancel);approvals.delete(id);resolve(value);}function cancel(){settle(false);}signal.addEventListener('abort',cancel,{once:true});approvals.set(id,{requestId,settle});emit({type:'approval',approvalId:id,...event});});}
async function chat(req,res,input){
 if(active>=4)return json(res,429,{error:'已有四个任务进行中，请稍后再试。'});
 const {messages,notes='',model='',reasoning='',system='',images=[],providerId='codex',mode='chat'}=input;
 if(!Array.isArray(messages)||messages.length>1000||messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'))return json(res,400,{error:'对话格式不正确。'});
 if(String(notes).length>1000000)return json(res,400,{error:'关联资料过长，请拆分到不同聊天。'});
 if(!['chat','agent','orchestrator'].includes(mode))return json(res,400,{error:'未知聊天模式。'});
 const requestId=input.requestId||crypto.randomUUID();if(typeof requestId!=='string'||requestId.length>100||jobs.has(requestId))return json(res,400,{error:'请求编号无效或任务已在运行。'});
 if(mode!=='chat'&&(!input.canvas||!Array.isArray(input.canvas.nodes)||input.canvas.nodes.length>1000||!Array.isArray(input.canvas.edges)))return json(res,400,{error:'自动任务缺少有效画布。'});
 const controller=new AbortController(),signal=controller.signal;active++;jobs.set(requestId,{cancel:()=>controller.abort()});const timer=setTimeout(()=>controller.abort(),mode==='chat'?180000:600000);
 let attachments;const stream=!!input.stream;
 if(stream)res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
 const emit=event=>{if(stream&&!res.destroyed&&!res.writableEnded)res.write('data: '+JSON.stringify(event)+'\n\n');};
 const heartbeat=stream?setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': ping\n\n');},15000):null;
 res.on('close',()=>{if(!res.writableEnded)controller.abort();});
 try{
  attachments=await prepareImages(images);
  const complete=async args=>{
   const selectedSkills=await readSelectedSkills(input.skillIds||[]);
   const skillsPrompt=selectedSkills.length?'\n用户明确选择的本地技能正文：\n'+selectedSkills.map(s=>'# '+s.name+'\n'+s.text).join('\n\n'):'';
   const common={messages:args.messages,notes:args.notes??notes,system:(args.system??system)+skillsPrompt,model,reasoning,signal:args.signal||signal,imagePaths:attachments.paths,structured:args.structured};
   if(providerId==='codex')return completeCodex({...common,onText:args.onText,onEvent:event=>{if(event.type==='transport_fallback')emit({type:'status',text:'当前CLI使用兼容通道，完成后显示回答。'});}});
   let text='';return completeWithProvider({providerId,model,messages:common.notes?[{role:'user',content:'参考资料（引用数据）：\n'+common.notes},...common.messages]:common.messages,images,system:common.system,signal:common.signal,onText:delta=>{text+=delta;args.onText?.(text);}});
  };
  let result;
  if(mode==='chat')result=await complete({messages,onText:text=>emit({type:'text',text})});
  else {const externalTools=await getEnabledTools(Array.isArray(input.connectorIds)?input.connectorIds:[],{signal});result=await runCanvasAgent({externalTools,callExternal:(tool,args,signal)=>callConnectorTool({connectorId:tool.connectorId,name:tool.originalName,args,signal}),canvas:input.canvas,nodeId:input.nodeId,messages,notes,system,mode,signal,emit,complete,readWeb:async url=>{const page=await fetchPublic(url);return{...await extract({html:page.html}),url:page.url};},approval:(input.requireApproval||externalTools.length)?(event=>{if(!input.requireApproval&&!externalTools.some(t=>t.name===event.name))return Promise.resolve(true);return requireApproval(event,signal,emit,requestId);}):undefined});}
  if(signal.aborted)throw Object.assign(Error('已停止回答。'),{cancelled:true});
  if(stream){emit({type:'done',text:result.text,requestId});res.end();}else json(res,200,{text:result.text,requestId});
 }catch(error){const cancelled=signal.aborted||error.cancelled;const result={error:cancelled?'已停止回答。':error.message,cancelled,requestId};if(stream){emit({type:'error',...result});res.end();}else json(res,cancelled?409:500,result);}
 finally{clearTimeout(timer);clearInterval(heartbeat);jobs.delete(requestId);for(const approval of [...approvals.values()])if(approval.requestId===requestId)approval.settle(false);active--;await attachments?.cleanup();}
}
const server=http.createServer(async(req,res)=>{
 try{
 const port=server.address()?.port;
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,403,{error:'仅供本机使用'});
 if(['POST','PUT','DELETE'].includes(req.method)&&![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))return json(res,403,{error:'来源不匹配'});
 const path=req.url.split('?')[0];
 if(await routeProviders(req,res,req.url,body,json))return;
 if(await routeConnectors(req,res,req.url,body,json))return;
 if(await routeSkills(req,res,path,body,json))return;
 if(await routeMedia(req,res,path,body,json))return;
 if(await routeBackup(req,res,path,body,json))return;
 if(await routeVideo(req,res,path,body,json))return;
 if(path==='/api/health')return json(res,200,{ok:true,version:3,active});
 if(path==='/api/state'&&req.method==='GET')return json(res,200,{state:await loadState()});
 if(path==='/api/state'&&req.method==='PUT'){const input=await body(req);return json(res,200,await saveState(input.state||input));}
 if(path==='/api/replay'&&req.method==='POST')return json(res,200,{events:await readReplay((await body(req,10000)).spaceId)});
 if(path==='/api/history'&&req.method==='GET')return json(res,200,{versions:await history()});
 if(path==='/api/history/restore'&&req.method==='POST')return json(res,200,{state:await restore((await body(req)).id)});
 if(path==='/api/cancel'&&req.method==='POST'){const job=jobs.get((await body(req,10000)).requestId);job?.cancel();return json(res,200,{cancelled:!!job});}
 if(path==='/api/approve'&&req.method==='POST'){const {id,allow}=await body(req,10000),approval=approvals.get(id);if(!approval)return json(res,404,{error:'此工具请求已结束。'});approval.settle(allow===true);return json(res,200,{accepted:true});}
 if(path==='/api/attachments'&&req.method==='POST')return json(res,200,{attachment:await saveImageAttachment(await body(req,23*1024*1024))});
 if(path.startsWith('/api/attachments/')&&req.method==='GET')return serveAttachment(req,res,path);
 if(path==='/api/document/preview'&&req.method==='POST'){const {attachmentId,page}=await body(req,10000),attachment=await readAttachment(attachmentId);if(attachment.mimeType!=='application/pdf')throw Error('此附件不是PDF。');return json(res,200,await extract({filename:'document.pdf',base64:attachment.bytes.toString('base64'),operation:'preview',page:Math.max(1,Math.min(500,Number(page)||1))}));}
 if(path==='/api/document'&&req.method==='POST'){if(active>=4)return json(res,429,{error:'正在处理其他任务，请稍后重试。'});const input=await body(req,72*1024*1024);active++;try{const result=await extract(input),attachment=await saveAttachment(input);return json(res,200,{...result,...(attachment?{attachment}:{})});}finally{active--;}}
 if(path==='/api/web'&&req.method==='POST'){const {url}=await body(req,10000),page=await fetchPublic(String(url||''));return json(res,200,{...await extract({html:page.html}),url:page.url});}
 if(path==='/api/chat'&&req.method==='POST')return await chat(req,res,await body(req,40*1024*1024));
 if(req.method!=='GET')return json(res,405,{error:'不支持的操作。'});
 const file=path==='/'?'index.html':path.slice(1);if(!/^[a-zA-Z0-9_-]+\.(html|js|css|woff2)$/.test(file))return json(res,404,{error:'没有这个页面。'});
 try{const data=await readFile(join(root,file));res.writeHead(200,{'Content-Type':file.endsWith('.woff2')?'font/woff2':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(data);}catch{return json(res,404,{error:'页面文件不存在。'});}
 }catch(error){json(res,400,{error:error.message||'操作失败，请重试。'});}
});
export const applicationReady=new Promise((resolve,reject)=>{
 server.once('error',reject);
 server.listen(requestedPort,'127.0.0.1',()=>{
  server.removeListener('error',reject);
  const url=`http://127.0.0.1:${server.address().port}`;
  console.log(`Local: ${url}`);
  resolve(url);
 });
});
if(!process.versions.electron)await applicationReady;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const job of jobs.values())job.cancel();closeMedia();closeVideo();closeConnectors().finally(()=>server.close(()=>process.exit()));});

export async function closeApplication(){for(const job of jobs.values())job.cancel();closeMedia();closeVideo();await closeConnectors();return new Promise(resolve=>server.close(resolve));}
