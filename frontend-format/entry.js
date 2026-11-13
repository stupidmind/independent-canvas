import katexAuto from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js/lib/common';
import mermaid from 'mermaid';
mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'neutral',maxTextSize:50000,flowchart:{htmlLabels:false}});
let chart=0;
export async function enhanceFormatting(container){
 for(const body of container.querySelectorAll('.markdown-body')){if(body.dataset.mathRendered)continue;body.dataset.mathRendered='true';try{katexAuto(body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,trust:false,strict:'warn',ignoredTags:['script','noscript','style','textarea','pre','code','option']});}catch{}}
 for(const block of container.querySelectorAll('pre>code')){
  if(block.dataset.richFormatted)continue;block.dataset.richFormatted='true';const lang=block.dataset.language||'';
  if(lang==='mermaid'){
   const source=block.textContent||'';if(source.length>50000||/%%\{|^\s*---|click\s|javascript:|<\s*(script|iframe|foreignObject)/i.test(source)){block.after(document.createTextNode('图表包含不支持的交互配置，已保留源代码。'));continue;}
   try{const {svg}=await mermaid.render('workspace-chart-'+(++chart),source);const doc=new DOMParser().parseFromString(svg,'image/svg+xml');for(const element of doc.querySelectorAll('script,foreignObject,iframe,object,embed'))element.remove();for(const style of doc.querySelectorAll('style'))if(/@import|url\(\s*['"]?(?:https?:|\/\/|data:)/i.test(style.textContent))style.remove();for(const element of doc.querySelectorAll('*'))for(const attr of [...element.attributes])if(attr.name.startsWith('on')||/javascript:|@import|url\(\s*['"]?(?:https?:|\/\/|data:)/i.test(attr.value)||(attr.name==='href'||attr.name==='xlink:href')&&!attr.value.startsWith('#'))element.removeAttribute(attr.name);const preview=document.createElement('div');preview.className='diagram-preview';preview.innerHTML=new XMLSerializer().serializeToString(doc.documentElement);block.closest('pre').before(preview);}catch{const error=document.createElement('small');error.textContent='图表语法无法解析，源代码仍可复制或下载。';block.after(error);}continue;
  }
  if(lang&&hljs.getLanguage(lang)){try{block.innerHTML=hljs.highlight(block.textContent,{language:lang,ignoreIllegals:true}).value;}catch{}}
 }
}
