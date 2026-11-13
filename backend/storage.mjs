import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export class LocalStore {
 constructor(directory){this.directory=directory;this.queue=Promise.resolve();this.lastSnapshot=0;}
 async read(name,fallback=null){try{return JSON.parse(await readFile(join(this.directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error('本地保存文件无法读取，请从历史版本恢复。');}}
 serial(action){const work=this.queue.then(action);this.queue=work.catch(()=>{});return work;}
 async atomic(name,value){await mkdir(this.directory,{recursive:true,mode:0o700});const target=join(this.directory,name),tmp=target+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,target);}finally{await unlink(tmp).catch(()=>{});}}
 async history(){await mkdir(join(this.directory,'history'),{recursive:true,mode:0o700});const names=(await readdir(join(this.directory,'history'))).filter(n=>/^\d{13}-[a-f0-9-]+\.json$/.test(n));return (await Promise.all(names.map(async id=>{const s=await stat(join(this.directory,'history',id));return{id,createdAt:new Date(Number(id.slice(0,13))).toISOString(),bytes:s.size};}))).sort((a,b)=>b.id.localeCompare(a.id));}
 async snapshot(state){if(!state)return;await mkdir(join(this.directory,'history'),{recursive:true,mode:0o700});await writeFile(join(this.directory,'history',`${Date.now()}-${randomUUID()}.json`),JSON.stringify(state),{mode:0o600});this.lastSnapshot=Date.now();const versions=await this.history();for(const v of versions.slice(40))await unlink(join(this.directory,'history',v.id));}
 saveState(state,{forceSnapshot=false}={}){validateState(state);const stable=JSON.parse(JSON.stringify(state));return this.serial(async()=>{const previous=await this.read('state.json');if(previous&&(forceSnapshot||Date.now()-this.lastSnapshot>=30000))await this.snapshot(previous);await this.atomic('state.json',stable);return{saved:true,updatedAt:new Date().toISOString()};});}
 restore(id){if(!/^\d{13}-[a-f0-9-]+\.json$/.test(id||''))throw new Error('历史版本标识无效。');return this.serial(async()=>{const state=JSON.parse(await readFile(join(this.directory,'history',id),'utf8'));validateState(state);await this.snapshot(await this.read('state.json'));await this.atomic('state.json',state);return state;});}
}
export function validateState(state){if(!state||typeof state!=='object'||!Array.isArray(state.spaces)||state.spaces.length>300)throw new Error('画布保存格式无效。');for(const space of state.spaces){if(typeof space.id!=='string'||!Array.isArray(space.nodes)||!Array.isArray(space.edges)||space.nodes.length>3000||space.edges.length>15000)throw new Error('画布数据无效或超过本地保存上限。');}if(Buffer.byteLength(JSON.stringify(state))>24*1024*1024)throw new Error('画布过大，请拆分画布或减少内嵌图片。');}
