import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export async function prepareImages(images=[]){
 if(!Array.isArray(images)||images.length>8)throw Error('一次最多发送8张图片。');
 if(!images.length)return{paths:[],cleanup:async()=>{}};
 const directory=await mkdtemp(join(tmpdir(),'slashspace-images-')),paths=[];
 const cleanup=()=>rm(directory,{recursive:true,force:true});
 try{for(let i=0;i<images.length;i++){
  const match=/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(images[i]?.dataUrl||'');
  if(!match||match[2].length>8*1024*1024)throw Error('图片格式无效或超过6MB。');
  const bytes=Buffer.from(match[2],'base64'),kind=match[1];
  if(kind==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||kind==='jpeg'&&!(bytes[0]===255&&bytes[1]===216)||kind==='webp'&&!(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'))throw Error('图片内容与格式不匹配。');
  const path=join(directory,`${i}.${kind}`);await writeFile(path,bytes,{mode:0o600});paths.push(path);
 }return{paths,cleanup};}catch(error){await cleanup();throw error;}
}
