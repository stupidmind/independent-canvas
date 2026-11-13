export function installAgentClient(api){
 const pending=new Map(),live=new Map();
 function chooseMode(n){const d=api.showPanel('聊天模式',`<div class="mode-options"><button data-mode="chat"><strong>聊天</strong><small>根据对话和关联资料回答</small></button><button data-mode="agent"><strong>Agent</strong><small>读取画布、网页和已启用工具，可创建子任务</small></button><button data-mode="orchestrator"><strong>自动编排 · 本地实现</strong><small>调用模型规划，实际创建资料和聊天、连线及修改标题</small></button></div><label><input id="approveAgentTools" type="checkbox" ${n.requireApproval?'checked':''}>读取网页、启动子任务前也让我确认</label><p>工具调用和结果会保留在当前聊天中。自动编排使用你选的模型服务；不是 Slashspace 托管云模型。</p>`);d.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{n.mode=b.dataset.mode;n.requireApproval=d.querySelector('#approveAgentTools').checked;d.close();api.save();api.draw();});}
 function markup(n,esc){const runs=n.toolRuns||[],approval=pending.get(n.id),text=live.get(n.id)||'';return `${runs.length?`<details class="agent-tools" ${api.busy(n.id)?'open':''}><summary>工具记录 · ${runs.length}</summary>${runs.slice(-30).map(r=>`<div class="agent-tool ${r.ok===false?'failed':''}"><strong>${esc(r.name)}</strong><span>${esc(r.summary||'')}</span><small>${r.state==='running'?'执行中':r.ok===false?'失败':'已完成'}</small>${r.result?`<pre>${esc(JSON.stringify(r.result,null,2).slice(0,6000))}</pre>`:''}</div>`).join('')}</details>`:''}${approval?`<div class="tool-approval"><strong>确认工具操作</strong><p>${esc(approval.summary||approval.name)}</p><pre>${esc(JSON.stringify(approval.args,null,2))}</pre><button data-approval="${esc(approval.approvalId)}" data-allow="yes">允许这次</button><button data-approval="${esc(approval.approvalId)}" data-allow="no">拒绝</button></div>`:''}${api.busy(n.id)?`<div class="live-answer">${text?api.rich(text):'<span class="thinking">● '+esc(n.agentStatus||'正在回答…')+'</span>'}</div>`:''}`;}
 function update(n){if(api.current().id!==n._ownerSpaceId&&n._ownerSpaceId)return;for(const card of document.querySelectorAll('[data-id="'+CSS.escape(n.id)+'"]')){const area=card.querySelector('.agent-output');if(area){area.innerHTML=markup(n,api.esc);}}}
 async function request(payload,{n,ownedSpace,signal,onOperation}){
  n._ownerSpaceId=ownedSpace.id;n.toolRuns=(n.toolRuns||[]).slice(-200);live.delete(n.id);pending.delete(n.id);
  const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,stream:true}),signal});
  if(!response.ok){const result=await response.json();throw Error(result.error||'模型请求失败。');}
  if(!response.body)throw Error('当前浏览器不支持流式读取。');
  let buffer='',finalText='',failure=null,done=false;const reader=response.body.getReader(),decoder=new TextDecoder();
  function event(line){if(!line.startsWith('data: '))return;const e=JSON.parse(line.slice(6));
   if(e.type==='text'){live.set(n.id,e.text);update(n);}
   if(e.type==='status'){n.agentStatus=e.text;update(n);}
   if(e.type==='tool_start'){n.toolRuns.push({id:e.id,name:e.name,summary:e.summary,state:'running',turnId:payload.requestId,messageIndex:n.messages.length-1});api.save();update(n);}
   if(e.type==='tool_result'){const run=n.toolRuns.find(r=>r.id===e.id);if(run)Object.assign(run,{state:'done',ok:e.ok,result:JSON.stringify(e.result).length>24000?{preview:JSON.stringify(e.result).slice(0,24000),truncated:true}:e.result});api.save();update(n);}
   if(e.type==='approval'){pending.set(n.id,e);update(n);}
   if(e.type==='operation'){onOperation(e.operation);}
   if(e.type==='subtask_event'){const child=ownedSpace.nodes.find(x=>x.id===e.taskId);if(child&&e.eventType==='status')child.agentStatus=e.text;}
   if(e.type==='error'){failure=Object.assign(Error(e.error||'回答失败。'),{name:e.cancelled?'AbortError':'Error'});}
   if(e.type==='done'){finalText=e.text||'';done=true;}
  }
  try{for(;;){const {value,done:finished}=await reader.read();if(finished)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n'))>=0){event(buffer.slice(0,index));buffer=buffer.slice(index+1);}}buffer+=decoder.decode();if(buffer.trim())event(buffer);if(failure)throw failure;if(!done)throw Error('连接提前结束；已完成的画布修改会保留。');return finalText;}
  finally{live.delete(n.id);pending.delete(n.id);delete n.agentStatus;delete n._ownerSpaceId;for(const child of ownedSpace.nodes)if(child.parentTaskId===n.id&&child.taskStatus==='running'){child.taskStatus=signal?.aborted?'cancelled':'failed';child.mode='chat';}for(const r of n.toolRuns||[])if(r.state==='running')Object.assign(r,{state:'done',ok:false,result:{error:signal?.aborted?'已取消':'连接已结束'}});}
 }
 document.addEventListener('click',async e=>{const button=e.target.closest('[data-approval]');if(!button)return;e.preventDefault();e.stopPropagation();button.disabled=true;try{const r=await fetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:button.dataset.approval,allow:button.dataset.allow==='yes'})}),result=await r.json();if(!r.ok)throw Error(result.error);const card=button.closest('[data-id]'),n=api.node(card?.dataset.id);if(n){pending.delete(n.id);update(n);}}catch(error){api.toast(error.message);button.disabled=false;}},true);
 return{chooseMode,markup,request,label:n=>({chat:'聊天',agent:'Agent',orchestrator:'自动编排'}[n.mode||'chat'])||'聊天'};
}
