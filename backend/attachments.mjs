import {mkdir,writeFile,readFile,stat,readdir} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=join(process.env.PLAYGROUND_DATA_DIR||new URL('../data/',import.meta.url).pathname,'attachments');
export async function saveAttachment(input){
 const filename=basename(String(input.filename||'document.pdf'));if(!/\.pdf$/i.test(filename))return null;
 const encoded=String(input.base64||'');if(encoded.length>70*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded))throw Error('附件格式无效或超过50MB。');
 const bytes=Buffer.from(encoded,'base64');if(bytes.length>50*1024*1024||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('不是有效的PDF附件。');
 const id=randomUUID()+'.pdf';await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,id),bytes,{mode:0o600});return{id,url:'/api/attachments/'+id,filename,size:bytes.length,mimeType:'application/pdf'};
}
export async function readAttachment(id){if(!/^[a-f0-9-]{36}\.(pdf|png|jpeg|jpg|webp|gif)$/.test(id))throw Error('附件编号无效。');const path=join(directory,id);return{bytes:await readFile(path),mimeType:id.endsWith('.pdf')?'application/pdf':id.endsWith('.gif')?'image/gif':id.endsWith('.png')?'image/png':id.endsWith('.webp')?'image/webp':'image/jpeg'};}
export async function serveAttachment(req,res,path){const id=path.slice('/api/attachments/'.length);try{const {bytes,mimeType}=await readAttachment(id);res.writeHead(200,{'Content-Type':mimeType,'Content-Length':bytes.length,'Content-Disposition':'inline; filename="'+id+'"','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600'});res.end(bytes);}catch{res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'找不到这个附件。'}));}}
export async function saveImageAttachment({filename='image',base64=''}){
 if(typeof base64!=='string'||base64.length>21*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('图片无效或超过15MB。');
 const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>15*1024*1024)throw Error('图片为空或超过15MB。');
 let extension,mimeType;if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){extension='png';mimeType='image/png';}else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){extension='jpeg';mimeType='image/jpeg';}else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){extension='webp';mimeType='image/webp';}else if(/^GIF8[79]a$/.test(bytes.toString('ascii',0,6))){extension='gif';mimeType='image/gif';}else throw Error('只支持PNG、JPEG、WebP或GIF图片。');
 const id=randomUUID()+'.'+extension;await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,id),bytes,{mode:0o600});return{id,url:'/api/attachments/'+id,filename:basename(filename),size:bytes.length,mimeType};
}
