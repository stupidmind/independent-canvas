import {marked} from './marked.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
marked.use({renderer:{html:token=>escape(token.text),image:token=>escape(token.text)}});
const allowed=new Set('P BR STRONG EM DEL CODE PRE BLOCKQUOTE UL OL LI H1 H2 H3 H4 H5 H6 HR TABLE THEAD TBODY TR TH TD A INPUT'.split(' '));
export function renderMarkdown(value){
 const raw=marked.parse(String(value??''),{gfm:true,breaks:true}),doc=new DOMParser().parseFromString(raw,'text/html');
 for(const el of [...doc.body.querySelectorAll('*')]){
  if(!allowed.has(el.tagName)){el.replaceWith(doc.createTextNode(el.textContent||el.getAttribute('alt')||''));continue;}
  const language=el.tagName==='CODE'?(el.getAttribute('class')||'').match(/language-([a-zA-Z0-9_-]+)/)?.[1]:null;
  const href=el.tagName==='A'?el.getAttribute('href'):null,checked=el.tagName==='INPUT'&&el.hasAttribute('checked');
  for(const attr of [...el.attributes])el.removeAttribute(attr.name);
  if(language)el.dataset.language=language;
  if(el.tagName==='A'&&href){try{const u=new URL(href);if(['https:','http:','mailto:'].includes(u.protocol)){el.setAttribute('href',u.href);el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}}catch{}}
  if(el.tagName==='INPUT'){el.type='checkbox';el.disabled=true;if(checked)el.setAttribute('checked','');}
 }
 return '<div class="markdown-body">'+doc.body.innerHTML+'</div>';
}
export function initMarkdown(container){
 for(const pre of container.querySelectorAll('.markdown-body pre')){if(pre.querySelector('.code-tools'))continue;const tools=document.createElement('div');tools.className='code-tools';for(const [label,action] of [['复制代码','copy'],['下载代码','download']]){const b=document.createElement('button');b.textContent=label;b.onclick=async e=>{e.stopPropagation();const text=pre.querySelector('code')?.textContent||'';if(action==='copy'){try{await navigator.clipboard.writeText(text);b.textContent='已复制';}catch{b.textContent='复制未成功';}}else{const url=URL.createObjectURL(new Blob([text],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download='code.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}};tools.append(b);}pre.append(tools);}
 for(const table of container.querySelectorAll('.markdown-body table')){if(table.nextElementSibling?.classList.contains('table-export'))continue;const b=document.createElement('button');b.className='table-export';b.textContent='下载表格 CSV';b.onclick=e=>{e.stopPropagation();const csv=[...table.rows].map(row=>[...row.cells].map(c=>'"'+c.innerText.replaceAll('"','""')+'"').join(',')).join('\n'),url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='table.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};table.after(b);}
}
