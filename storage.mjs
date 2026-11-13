import {mkdir,readFile,writeFile,rename,readdir,unlink,stat,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {markdownExport} from './public/workspace-model.js';
const directory=process.env.PLAYGROUND_DATA_DIR||new URL('./data/',import.meta.url).pathname;
let queue=Promise.resolve();
export function validateState(state){
 const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
 const finite=(value,name)=>{if(value!==undefined&&!Number.isFinite(value))throw Error(name+'必须是有效数字。');};
 if(!state||!Array.isArray(state.spaces)||!state.spaces.length||state.spaces.length>200||!id(state.current))throw Error('画布数据格式不正确。');
 const spaceIds=new Set();for(const s of state.spaces){
  if(!id(s.id)||spaceIds.has(s.id)||!Array.isArray(s.nodes)||!Array.isArray(s.edges)||s.nodes.length>1000||s.edges.length>5000)throw Error('画布内容过大或编号无效。');spaceIds.add(s.id);
  if(s.name===undefined)s.name='Untitled';if(typeof s.name!=='string')throw Error('画布名称格式不正确。');
  const ids=new Set();for(const n of s.nodes){if(!id(n.id)||ids.has(n.id)||!['chat','note','web','document','image','post','scratchpad'].includes(n.type))throw Error('卡片类型或编号无效。');ids.add(n.id);if(n.title===undefined)n.title='Untitled';if(typeof n.title!=='string')throw Error('卡片标题格式不正确。');for(const key of ['x','y','width'])finite(n[key],'卡片位置和宽度');n.x??=0;n.y??=0;n.width??=600;if(n.width<100||n.width>10000)throw Error('卡片宽度超出范围。');if(n.groupId!==undefined&&!id(n.groupId))throw Error('分组编号无效。');if(n.type==='chat'){n.messages??=[];if(!Array.isArray(n.messages)||n.messages.length>5000||n.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('聊天消息格式无效。');}if(n.strokes!==undefined&&(!Array.isArray(n.strokes)||n.strokes.some(stroke=>!stroke||!Array.isArray(stroke.points)||stroke.points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))))throw Error('画笔数据格式无效。');}
  if(s.groups!==undefined&&!Array.isArray(s.groups))throw Error('分组数据格式无效。');for(const g of s.groups||[]){if(!id(g.id)||ids.has(g.id))throw Error('分组编号无效或重复。');ids.add(g.id);for(const key of ['x','y','width'])finite(g[key],'分组位置');if(g.memberPositions!==undefined&&(!Array.isArray(g.memberPositions)||g.memberPositions.some(p=>!p||!id(p.id)||!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw Error('叠卡位置无效。');}
  for(const e of s.edges){e.id??=crypto.randomUUID();if(!id(e.id)||!id(e.source)||!id(e.target))throw Error('连线编号无效。');}
  if(s.view){for(const key of ['x','y','z'])finite(s.view[key],'画布视口');if(!(s.view.z>0&&s.view.z<=10))throw Error('画布缩放无效。');}
 }
 if(!spaceIds.has(state.current))throw Error('当前画布不存在。');return state;
}
export async function loadState(){try{return JSON.parse(await readFile(join(directory,'state.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new Error('磁盘画布无法读取，请从历史备份恢复。');}}
export function saveState(state){validateState(state);const serialized=JSON.stringify(state);if(Buffer.byteLength(serialized)>30*1024*1024)throw new Error('画布超过30MB，请导出并拆分。');const task=queue.then(async()=>{
 await mkdir(join(directory,'backups'),{recursive:true});const old=await loadState();
 if(old&&JSON.stringify(old)!==serialized){await writeFile(join(directory,'backups',`${Date.now()}-${crypto.randomUUID().slice(0,6)}.json`),JSON.stringify(old),{mode:0o600});}
 const previousCanvases=new Map((old?.spaces||[]).map(s=>[s.id,s]));
 const previous=new Map((old?.spaces||[]).map(s=>[s.id,JSON.stringify(s)]));
 for(const canvas of state.spaces){const serializedCanvas=JSON.stringify(canvas);const folder=join(directory,'canvases',createHash('sha256').update(canvas.id).digest('hex').slice(0,24));if(previous.get(canvas.id)===serializedCanvas){try{await stat(join(folder,'canvas.json'));continue;}catch{}}await mkdir(folder,{recursive:true});const {view:ignoredView,...replayCanvas}=canvas;const oldCanvas=previousCanvases.get(canvas.id);const {view:oldView,...oldReplay}=oldCanvas||{};if(JSON.stringify(replayCanvas)!==JSON.stringify(oldReplay)){const log=join(folder,'.canvas-history.jsonl');await appendFile(log,JSON.stringify({time:new Date().toISOString(),canvas:replayCanvas})+'\n',{mode:0o600});const info=await stat(log);if(info.size>20*1024*1024){const records=(await readFile(log,'utf8')).trim().split('\n').slice(-200);while(records.length>1&&Buffer.byteLength(records.join('\n'))>20*1024*1024)records.shift();await writeFile(log,records.join('\n')+'\n',{mode:0o600});}}for(const [name,contents] of [['canvas.json',serializedCanvas],['Context.md',markdownExport(canvas)]]){const tempFile=join(folder,`${name}.${crypto.randomUUID()}.tmp`);await writeFile(tempFile,contents,{mode:0o600});await rename(tempFile,join(folder,name));}}
 const temp=join(directory,`state-${crypto.randomUUID()}.tmp`);await writeFile(temp,serialized,{mode:0o600});await rename(temp,join(directory,'state.json'));
 const files=(await readdir(join(directory,'backups'))).filter(f=>/^\d+-[\w-]+\.json$/.test(f)).sort().reverse();await Promise.all(files.slice(30).map(f=>unlink(join(directory,'backups',f))));return{saved:true,updatedAt:new Date().toISOString()};
 });queue=task.catch(()=>{});return task;
}
export async function history(){await mkdir(join(directory,'backups'),{recursive:true});return Promise.all((await readdir(join(directory,'backups'))).filter(f=>/^\d+-[\w-]+\.json$/.test(f)).sort().reverse().map(async f=>({id:f,createdAt:new Date(Number(f.split('-')[0])).toISOString(),bytes:(await stat(join(directory,'backups',f))).size})));}
export async function restore(id){if(!/^\d+-[\w-]+\.json$/.test(id))throw new Error('备份编号不正确。');const state=validateState(JSON.parse(await readFile(join(directory,'backups',id),'utf8')));await saveState(state);return state;}

export async function readReplay(spaceId){if(typeof spaceId!=='string'||spaceId.length>200)throw Error('画布编号无效。');const folder=join(directory,'canvases',createHash('sha256').update(spaceId).digest('hex').slice(0,24));try{return(await readFile(join(folder,'.canvas-history.jsonl'),'utf8')).trim().split('\n').filter(Boolean).slice(-200).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return[];throw Error('历史记录无法读取。');}}
