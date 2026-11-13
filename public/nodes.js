const uid=()=>crypto.randomUUID();
const text=v=>String(v??'');
const safeURL=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const imageURL=value=>/^\/api\/attachments\/[a-f0-9-]{36}\.(png|jpeg|jpg|webp|gif)$/.test(text(value))?text(value):/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(text(value))?value:'';
const allowedFields=new Set(['url','content','caption','penColor','penWidth']);
const bindings=new WeakMap();
const pdfPreviews=new Map();
const attachmentURL=value=>/^\/api\/attachments\/[a-zA-Z0-9._-]+$/.test(text(value))?value:'';
const previewImage=value=>/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(text(value))?value:'';
function cachePreview(id,value){pdfPreviews.delete(id);pdfPreviews.set(id,value);while(pdfPreviews.size>20)pdfPreviews.delete(pdfPreviews.keys().next().value);}


export function createRichNode(type,fields={}){
 const defaults={web:'Web Page',document:'Document',image:'Image',post:'Post',scratchpad:'Scratch Pad'};
 return{id:uid(),type,title:defaults[type]||'Untitled',x:0,y:0,width:type==='scratchpad'?760:600,content:'',...fields};
}

function youtubeId(value){
 try{const u=new URL(value),h=u.hostname.toLowerCase().replace(/^www\./,'');let id='';
  if(h==='youtu.be')id=u.pathname.slice(1).split('/')[0];
  else if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(h))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]||'';
  return /^[a-zA-Z0-9_-]{11}$/.test(id)?id:'';
 }catch{return '';}
}

function field(label,key,value,esc,extra=''){
 return `<label class="rich-label">${label}<input class="rich-field" data-rich-field="${key}" value="${esc(value)}" ${extra}></label>`;
}
function editor(node,esc,label='提取正文，可直接编辑'){
 return `<label class="rich-label">${label}<textarea class="rich-text rich-field" data-rich-field="content" aria-label="${label}" placeholder="内容会在这里显示…">${esc(node.content)}</textarea></label>`;
}
function status(node,esc){return node.richError?`<div class="rich-error" role="status">${esc(node.richError)}</div>`:node.richStatus?`<div class="rich-status" role="status">${esc(node.richStatus)}</div>`:'';}

/** Only returns card body. Main app owns title, handles, selection and branching. */
export function renderNodeBody(node,esc){
 const busy=node.richBusy?'disabled':'';
 const count=text(node.content).length;
 if(node.type==='web')return `<div class="rich-node rich-web"><div class="rich-type">WEB PAGE</div><div class="rich-row">${field('网页地址','url',node.url||'',esc,'type="url" placeholder="https://…"')}<button class="rich-primary" data-action="rich-capture" ${busy}>${node.richBusy?'抓取中…':'Go · 抓取'}</button></div>${status(node,esc)}${node.capturedAt?`<div class="rich-meta">已抓取 · ${esc(new Date(node.capturedAt).toLocaleString())} · ${count.toLocaleString()} 字符</div>`:''}${editor(node,esc)}<div class="rich-actions"><button data-action="rich-open" ${safeURL(node.url)?'':'disabled'}>↗ 打开原网页</button><button data-action="rich-export-text">↓ 导出正文</button></div></div>`;
 if(node.type==='document'){
  const source=attachmentURL(node.attachment?.url),pdf=/\.pdf$/i.test(node.filename||''),page=Math.max(1,Number(node.pdfPage)||1),pageCount=Math.max(0,Number(node.pageCount)||0),cached=pdfPreviews.get(node.id),image=cached?.page===page?previewImage(cached.image):'';
  const preview=pdf?`<div class="rich-pdf"><div class="rich-pdf-toolbar"><button data-action="rich-pdf-prev" ${!source||page<=1||node.pdfBusy?'disabled':''} aria-label="PDF上一页">‹</button><span>第 ${page} 页${pageCount?' / '+pageCount:''}</span><button data-action="rich-pdf-next" ${!source||!pageCount||page>=pageCount||node.pdfBusy?'disabled':''} aria-label="PDF下一页">›</button><button data-action="rich-pdf-preview" ${!source||node.pdfBusy?'disabled':''}>${node.pdfBusy?'加载中…':image?'刷新本页':'查看本页'}</button></div>${image?`<img class="rich-pdf-page" src="${esc(image)}" alt="PDF第${page}页">`:`<div class="rich-pdf-placeholder">${node.pdfBusy?'正在生成本机页面预览…':source?'原PDF已保存在本机，点“查看本页”浏览。':'重新选择原PDF，可启用逐页预览。'}</div>`}${node.pdfError?`<div class="rich-error">${esc(node.pdfError)}</div>`:''}</div>`:'';
  return `<div class="rich-node rich-document"><div class="rich-type">DOCUMENT</div><div class="rich-file-name">▤ ${esc(node.filename||node.title||'尚未选择文件')}</div><label class="rich-file-picker">${node.richBusy?'正在提取…':'选择或替换文件'}<input type="file" data-rich-upload accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.pdf,.docx,.xlsx,.pptx,.srt,.vtt,.xml,.js,.ts,.py,.yaml,.yml,.css,.sql,.toml" ${busy}></label>${status(node,esc)}<div class="rich-meta">${pageCount?pageCount+'页 · ':node.sheetCount?node.sheetCount+'张工作表 · ':node.slideCount?node.slideCount+'张幻灯片 · ':''}${count.toLocaleString()} 字符 · 发送关联聊天时把正文交给模型</div>${preview}${editor(node,esc)}<div class="rich-actions"><button data-action="rich-export-text">↓ 导出正文</button>${source?'<button data-action="rich-download-original">↓ 原文件</button><button data-action="rich-open-original">↗ 打开原文件</button>':''}</div></div>`;
 }
 if(node.type==='image'){
  const src=imageURL(node.dataUrl);
  return `<div class="rich-node rich-image"><div class="rich-type">IMAGE</div>${src?`<div class="rich-image-frame"><img src="${esc(src)}" alt="${esc(node.caption||node.title||'本地图片')}" loading="lazy"></div>`:'<div class="rich-media-empty">选择一张本地图片</div>'}<label class="rich-file-picker">选择或替换图片<input type="file" data-rich-upload accept="image/png,image/jpeg,image/webp,image/gif"></label>${status(node,esc)}<label class="rich-label">图片说明<textarea class="rich-text rich-caption rich-field" data-rich-field="caption" placeholder="描述这张图，让聊天了解它的内容…">${esc(node.caption)}</textarea></label><div class="rich-notice">图片保留在本机；发送关联聊天时，会将图片和说明一起交给模型。</div>${src?'<div class="rich-actions"><button data-action="rich-export-image">↓ 保存图片</button><button data-action="rich-edit-image">参考此图生成</button></div>':''}</div>`;
 }
 if(node.type==='post'){
  const id=youtubeId(node.url),url=safeURL(node.url);
  const preview=id&&node.embedEnabled?`<iframe class="rich-video" src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube 视频预览" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`:`<div class="rich-media-empty">${id?'▷ YouTube 视频':'↗ 视频或社交帖子'}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`:''}</div>`;
  return `<div class="rich-node rich-post"><div class="rich-type">POST / VIDEO</div>${field('视频或帖子地址','url',node.url||'',esc,'type="url" placeholder="粘贴 YouTube 或社交链接"')}${preview}<div class="rich-actions"><button data-action="rich-video-captions" ${busy}>获取公开字幕</button><button data-action="rich-video-transcribe" ${busy}>无字幕时转写音频</button>${node.richBusy?'<button data-action="rich-video-cancel">停止读取</button>':''}${id?`<button data-action="rich-embed">${node.embedEnabled?'关闭视频预览':'加载视频预览（连接 YouTube）'}</button>`:''}<button data-action="rich-open" ${url?'':'disabled'}>↗ 打开原链接</button></div>${status(node,esc)}${editor(node,esc,'转录或摘录文本')}<div class="rich-notice">优先读取站点提供的公开字幕；没有字幕时，可选择转写服务处理不超过20分钟的公开音频。需要登录或站点限制的内容可能无法读取。</div></div>`;
 }
 if(node.type==='scratchpad')return `<div class="rich-node rich-scratchpad"><div class="rich-type">SCRATCH PAD</div><div class="rich-drawing-tools">${field('画笔','penColor',node.penColor||'#52525b',esc,'type="color" aria-label="画笔颜色"')}<label class="rich-label">粗细<input class="rich-field" data-rich-field="penWidth" type="range" min="1" max="16" value="${Number(node.penWidth)||3}" aria-label="画笔粗细"></label><button data-action="rich-undo-stroke">↶ 撤回一笔</button><button data-action="rich-clear-strokes">清空</button><button data-action="rich-export-drawing">↓ PNG</button></div><canvas class="rich-drawing" width="960" height="600" aria-label="自由绘画画板" data-rich-canvas></canvas><label class="rich-label">画面说明<textarea class="rich-text rich-caption rich-field" data-rich-field="content" placeholder="写下画面表达的想法，聊天会读取这段说明…">${esc(node.content)}</textarea></label><div class="rich-notice">笔画随画布保存；发送关联聊天时，会将画面和说明一起交给模型。</div></div>`;
 return `<div class="rich-node">${editor(node,esc)}</div>`;
}

async function callJSON(path,body){
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{throw new Error('本机服务没有返回有效结果。');}
 if(!response.ok||data.error)throw new Error(typeof data.error==='string'?data.error:data.error?.message||'处理失败，请重试。');
 return data;
}
function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename.replace(/[\/:*?"<>|]/g,'-');a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function canvasFor(node){return [...document.querySelectorAll('[data-rich-canvas]')].find(c=>c.closest('[data-id]')?.dataset.id===node.id);}

export async function handleNodeAction(action,node,{save,redraw,toast}){
 if(!action?.startsWith('rich-'))return false;
 const persist=()=>{save();redraw();};
 try{
  if(action==='rich-capture'){
   const url=safeURL(node.url);if(!url)throw new Error('请先填入完整的 http 或 https 网页地址。');
   node.richBusy=true;delete node.richError;node.richStatus='正在读取公开网页…';redraw();
   try{const data=await callJSON('/api/web',{url});node.content=text(data.content||data.text);node.title=text(data.title||node.title||new URL(url).hostname);node.url=url;node.capturedAt=new Date().toISOString();node.richStatus=node.content?'网页正文已保存到画布。':'没有提取到正文。可以手动粘贴文本。';}
   catch(error){node.richError=error.message;node.richStatus='';}
   finally{node.richBusy=false;persist();}
  }else if(['rich-pdf-preview','rich-pdf-prev','rich-pdf-next'].includes(action)){
   if(!attachmentURL(node.attachment?.url)||!node.attachment?.id)throw new Error('请重新选择原PDF后预览。');
   if(node.pdfBusy)return true;
   const current=Math.max(1,Number(node.pdfPage)||1),page=action==='rich-pdf-prev'?Math.max(1,current-1):action==='rich-pdf-next'?Math.min(Number(node.pageCount)||current,current+1):current;
   node.pdfBusy=true;delete node.pdfError;redraw();
   try{const result=await callJSON('/api/document/preview',{attachmentId:node.attachment.id,page});if(!previewImage(result.previewImage))throw new Error('PDF页面预览无效。');node.pdfPage=result.page;node.pageCount=result.pageCount;cachePreview(node.id,{page:result.page,image:result.previewImage});}
   catch(error){node.pdfError=error.message;}
   finally{node.pdfBusy=false;save();redraw();}
  }else if(action==='rich-download-original'||action==='rich-open-original'){
   const url=attachmentURL(node.attachment?.url);if(!url)throw new Error('原文件尚未保存在本机，请重新选择文件。');
   if(action==='rich-open-original')window.open(url,'_blank','noopener,noreferrer');
   else{const a=document.createElement('a');a.href=url;a.download=node.filename||'document';a.click();}
  }else if(action==='rich-open'){
   const url=safeURL(node.url);if(!url)throw new Error('请先填入有效链接。');window.open(url,'_blank','noopener,noreferrer');
  }else if(action==='rich-embed'){node.embedEnabled=!node.embedEnabled;persist();}
  else if(action==='rich-export-text'){download(new Blob([text(node.content)],{type:'text/plain;charset=utf-8'}),`${node.title||'document'}.txt`);}
  else if(action==='rich-export-image'){
   if(!imageURL(node.dataUrl))throw new Error('这张图片尚未载入。');
   const response=await fetch(node.dataUrl);download(await response.blob(),node.filename||`${node.title||'image'}.png`);
  }else if(action==='rich-undo-stroke'){
   if(!node.strokes?.length&&node.previousStrokes?.length){node.strokes=node.previousStrokes;delete node.previousStrokes;}
   else node.strokes=(node.strokes||[]).slice(0,-1);
   persist();
  }
  else if(action==='rich-clear-strokes'){
   if(node.strokes?.length){node.previousStrokes=node.strokes;node.strokes=[];persist();toast('画板已清空；点“撤回一笔”可恢复。');}
  }else if(action==='rich-export-drawing'){
   const canvas=canvasFor(node);if(!canvas)throw new Error('请先展开画板。');
   canvas.toBlob(blob=>{if(blob)download(blob,`${node.title||'drawing'}.png`);},'image/png');
  }
 }catch(error){toast(error.message||'操作失败');}
 return true;
}

function readDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(text(r.result));r.onerror=()=>reject(new Error('无法读取这个文件。'));r.readAsDataURL(file);});}
async function fileNode(file){
 const image=/^image\/(png|jpeg|webp|gif)$/.test(file.type),limit=image?15:50;
 if(file.size>limit*1024*1024)throw new Error(`“${file.name}”超过 ${limit} MB，请缩小文件后再试。`);
 if(/^image\/(png|jpeg|webp|gif)$/.test(file.type)){const original=await readDataURL(file),result=await callJSON('/api/attachments',{filename:file.name,base64:original.slice(original.indexOf(',')+1)});return createRichNode('image',{title:file.name,filename:file.name,mimeType:result.attachment.mimeType,dataUrl:result.attachment.url,attachment:result.attachment,caption:''});}
 const allowed=/\.(txt|md|markdown|csv|tsv|json|html?|pdf|docx|xlsx|pptx|xml|log|js|jsx|ts|tsx|py|yaml|yml|css|sql|sh|toml|ini|srt|vtt)$/i.test(file.name);
 if(!allowed)throw new Error(`暂不支持“${file.name}”。可导入文本、PDF、DOCX、XLSX、PPTX 或常见图片；旧版Office请先另存为新格式。`);
 const dataURL=await readDataURL(file),base64=dataURL.slice(dataURL.indexOf(',')+1);
 const node=createRichNode('document',{title:file.name,filename:file.name,mimeType:file.type,content:''});
 try{
  const result=await callJSON('/api/document',{filename:file.name,base64,mimeType:file.type});
  node.content=text(result.content||result.text);node.richStatus=result.warning||`已提取 ${node.content.length.toLocaleString()} 字符。`;
  if(result.attachment&&attachmentURL(result.attachment.url))node.attachment=result.attachment;
  if(Number.isInteger(result.pageCount))node.pageCount=result.pageCount;
  if(Number.isInteger(result.sheetCount))node.sheetCount=result.sheetCount;
  if(Number.isInteger(result.slideCount))node.slideCount=result.slideCount;
  node.pdfPage=1;
 }catch(error){node.richError=error.message;}
 return node;
}

/** Import is local browser reading and local-server text extraction, never a model call. */
export async function importFiles(files){
 const nodes=[];
 for(const file of Array.from(files||[])){
  try{nodes.push(await fileNode(file));}
  catch(error){nodes.push(createRichNode('document',{title:file.name,filename:file.name,content:'',richError:error.message}));}
 }
 return nodes;
}

export function nodeContext(node){
 const title=text(node.title||node.filename||node.type),body=text(node.type==='image'?node.caption:node.content);
 if(node.type==='image')return{title,text:body?`图片“${title}”的用户说明：\n${body}`:`图片“${title}”尚未提供文字说明。发送关联聊天时会附上实际图片。`};
 if(node.type==='scratchpad')return{title,text:body?`画板“${title}”的用户说明：\n${body}`:`画板“${title}”含 ${(node.strokes||[]).length} 条笔画，尚未提供文字说明。`};
 return{title,text:[node.url?`来源：${node.url}`:'',node.filename?`文件：${node.filename}`:'',body].filter(Boolean).join('\n\n')};
}

function paint(canvas,node){
 const ctx=canvas.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.lineCap='round';ctx.lineJoin='round';
 for(const stroke of node.strokes||[]){
  if(!Array.isArray(stroke.points)||!stroke.points.length)continue;
  ctx.strokeStyle=/^#[a-f\d]{6}$/i.test(stroke.color)?stroke.color:'#52525b';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=Math.max(1,Math.min(20,Number(stroke.width)||3));
  ctx.beginPath();stroke.points.forEach((p,i)=>{const x=p.x*canvas.width,y=p.y*canvas.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  if(stroke.points.length===1){const p=stroke.points[0];ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
 }
}

/** Re-call after render; delegated listeners are bound once, canvas listeners once per element. */
export function initNodeInteractions(container,options){
 let binding=bindings.get(container);if(!binding){binding={options};bindings.set(container,binding);
  const get=(event)=>{const id=event.target.closest('[data-id]')?.dataset.id;return id?binding.options.getNode(id):null;};
  container.addEventListener('input',event=>{const key=event.target.dataset.richField;if(!allowedFields.has(key))return;const node=get(event);if(!node)return;node[key]=key==='penWidth'?Math.max(1,Math.min(16,Number(event.target.value)||3)):event.target.value;binding.options.save();});
  container.addEventListener('change',async event=>{
   if(!event.target.matches('[data-rich-upload]'))return;const node=get(event),file=event.target.files?.[0];if(!node||!file)return;
   const opts=binding.options;node.richBusy=true;delete node.richError;opts.redraw();
   try{const imported=await fileNode(file);const keep={id:node.id,x:node.x,y:node.y,width:node.width,groupId:node.groupId,color:node.color};pdfPreviews.delete(node.id);for(const key of ['attachment','pageCount','sheetCount','slideCount','pdfPage','pdfError'])delete node[key];Object.assign(node,imported,keep);}
   catch(error){node.richError=error.message;}
   finally{node.richBusy=false;opts.save();opts.redraw();}
  });
  container.addEventListener('paste',async event=>{
   if(event.target.matches('input,textarea,[contenteditable=true]'))return;
   const images=Array.from(event.clipboardData?.files||[]).filter(f=>/^image\//.test(f.type));if(!images.length)return;event.preventDefault();
   const nodes=await importFiles(images);if(binding.options.addNodes)binding.options.addNodes(nodes);else container.dispatchEvent(new CustomEvent('rich-nodes-imported',{bubbles:true,detail:{nodes}}));
  });
 }else binding.options=options;
 container.querySelectorAll('[data-rich-canvas]').forEach(canvas=>{
  const id=canvas.closest('[data-id]')?.dataset.id,node=options.getNode(id);if(!node)return;paint(canvas,node);if(canvas.dataset.bound)return;canvas.dataset.bound='true';
  let drawing=null;
  const point=event=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};};
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const current=binding.options.getNode(id);if(!current)return;current.strokes??=[];drawing={color:current.penColor||'#52525b',width:Number(current.penWidth)||3,points:[point(event)]};current.strokes.push(drawing);canvas.setPointerCapture(event.pointerId);paint(canvas,current);});
  canvas.addEventListener('pointermove',event=>{if(!drawing)return;event.preventDefault();event.stopPropagation();const p=point(event),last=drawing.points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)<.001)return;drawing.points.push(p);paint(canvas,binding.options.getNode(id));});
  const finish=event=>{if(!drawing)return;event.stopPropagation();drawing=null;binding.options.save();};canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
 });
}

export async function imageAttachment(node){
 let canvas;
 if(node.type==='image'&&imageURL(node.dataUrl)){
  const img=new Image();img.src=node.dataUrl;await img.decode();const ratio=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
 }else if(node.type==='scratchpad'&&node.strokes?.length){canvas=document.createElement('canvas');canvas.width=960;canvas.height=600;paint(canvas,node);}
 if(!canvas)return null;return{title:node.title,dataUrl:canvas.toDataURL('image/png')};
}
