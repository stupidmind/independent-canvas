const copy=value=>JSON.parse(JSON.stringify(value));
const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
export const isStack=group=>group?.kind==='stack';
export function stackMembers(space,stackId){return space.nodes.filter(n=>n.groupId===stackId).sort((a,b)=>number(b.updatedAt)-number(a.updatedAt)||a.y-b.y||a.x-b.x);}
export function createStack(space,ids,{id=crypto.randomUUID(),name='新叠卡'}={}){
 const chosen=new Set(ids),nodes=space.nodes.filter(n=>chosen.has(n.id));
 if(nodes.length<2)throw Error('请选择至少两张卡片。');
 if(nodes.some(n=>n.groupId))throw Error('请先将所选卡片移出已有分组或叠卡。');
 const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));
 const stack={id,name,kind:'stack',expanded:false,x,y,width:Math.max(460,Math.min(720,...nodes.map(n=>number(n.width,600)))),memberPositions:nodes.map(n=>({id:n.id,x:n.x,y:n.y}))};
 (space.groups??=[]).push(stack);nodes.forEach(n=>{n.groupId=id;});return stack;
}
export function layoutStack(space,stackId,{expanded=true,heightFor=()=>420}={}){
 const stack=(space.groups||[]).find(g=>g.id===stackId&&isStack(g));if(!stack)throw Error('没有找到这组叠卡。');
 stack.expanded=expanded;if(!expanded)return stack;
 const nodes=stackMembers(space,stackId),columns=Math.max(1,Math.min(3,Math.ceil(Math.sqrt(nodes.length)))),columnWidth=Math.max(stack.width||600,...nodes.map(n=>number(n.width,600)))+65;
 const rowHeights=[];nodes.forEach((n,i)=>{const row=Math.floor(i/columns);rowHeights[row]=Math.max(rowHeights[row]||0,number(heightFor(n),420)+90);});
 let rowY=number(stack.y)+80;for(let row=0;row<rowHeights.length;row++){nodes.slice(row*columns,(row+1)*columns).forEach((n,col)=>{n.x=number(stack.x)+col*columnWidth;n.y=rowY;});rowY+=rowHeights[row];}
 return stack;
}
export function unstack(space,stackId,{restorePositions=false,heightFor}={}){
 const stack=(space.groups||[]).find(g=>g.id===stackId&&isStack(g));if(!stack)return[];
 const members=stackMembers(space,stackId);
 if(restorePositions){const positions=new Map((stack.memberPositions||[]).map(p=>[p.id,p]));members.forEach(n=>{const old=positions.get(n.id);if(old){n.x=old.x;n.y=old.y;}});}else if(!stack.expanded)layoutStack(space,stackId,{expanded:true,heightFor});
 members.forEach(n=>delete n.groupId);space.groups=space.groups.filter(g=>g.id!==stackId);
 // A container edge becomes member edges so unstacking does not silently discard context.
 const affected=space.edges.filter(e=>e.source===stackId);space.edges=space.edges.filter(e=>e.source!==stackId&&e.target!==stackId);
 for(const edge of affected)for(const n of members)if(n.id!==edge.target&&!space.edges.some(e=>e.source===n.id&&e.target===edge.target))space.edges.push({id:crypto.randomUUID(),source:n.id,target:edge.target});
 return members;
}
export function containerRect(space,group,heightFor=()=>420){
 const nodes=space.nodes.filter(n=>n.groupId===group.id);if(!nodes.length)return null;
 if(isStack(group)&&!group.expanded)return{x:number(group.x,Math.min(...nodes.map(n=>n.x))),y:number(group.y,Math.min(...nodes.map(n=>n.y)))-55,width:number(group.width,600),height:240};
 const x=Math.min(...nodes.map(n=>n.x))-30,y=Math.min(...nodes.map(n=>n.y))-80;
 return{x,y,width:Math.max(...nodes.map(n=>n.x+number(n.width,600)))+30-x,height:Math.max(...nodes.map(n=>n.y+number(heightFor(n),420)))+30-y};
}
export function hiddenNodeIds(space){const collapsed=new Set((space.groups||[]).filter(g=>isStack(g)&&!g.expanded).map(g=>g.id));return new Set(space.nodes.filter(n=>collapsed.has(n.groupId)).map(n=>n.id));}
export function visibleItems(space,heightFor=()=>420){const hidden=hiddenNodeIds(space);return[...space.nodes.filter(n=>!hidden.has(n.id)).map(n=>({id:n.id,x:n.x,y:n.y,width:number(n.width,600),height:number(heightFor(n),420)})),...(space.groups||[]).filter(g=>isStack(g)&&!g.expanded).map(g=>({id:g.id,...containerRect(space,g,heightFor)})).filter(item=>item.width)];}
export function visualEndpoint(space,id,heightFor){const n=space.nodes.find(n=>n.id===id);const container=(space.groups||[]).find(g=>g.id===(n?.groupId||id));if(container&&isStack(container)&&!container.expanded){const rect=containerRect(space,container,heightFor);return rect?{...rect,id:container.id}:null;}if(n)return n;if(container){const rect=containerRect(space,container,heightFor);return rect?{...rect,id:container.id}:null;}return null;}
export function deleteContainer(space,id){const group=(space.groups||[]).find(g=>g.id===id);if(!group)return null;const members=space.nodes.filter(n=>n.groupId===id),ids=new Set(members.map(n=>n.id));ids.add(id);const removed={group:copy(group),nodes:copy(members),edges:copy(space.edges.filter(e=>ids.has(e.source)||ids.has(e.target)))};space.nodes=space.nodes.filter(n=>!ids.has(n.id));space.edges=space.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target));space.groups=space.groups.filter(g=>g.id!==id);return removed;}
export function restoreContainer(space,removed){if(!removed||space.groups?.some(g=>g.id===removed.group.id))return false;(space.groups??=[]).push(copy(removed.group));const nodeIds=new Set(space.nodes.map(n=>n.id)),edgeIds=new Set(space.edges.map(e=>e.id));space.nodes.push(...copy(removed.nodes).filter(n=>!nodeIds.has(n.id)));space.edges.push(...copy(removed.edges).filter(e=>!edgeIds.has(e.id)));return true;}
export function assignDroppedNode(space,id,point,rectangles){const n=space.nodes.find(n=>n.id===id);if(!n)return null;const hit=rectangles.filter(r=>!r.collapsed&&point.x>=r.x&&point.x<=r.x+r.width&&point.y>=r.y&&point.y<=r.y+r.height).sort((a,b)=>a.width*a.height-b.width*b.height)[0];if(hit)n.groupId=hit.id;else delete n.groupId;return n.groupId||null;}
export function moveContainer(space,id,dx,dy){const g=(space.groups||[]).find(g=>g.id===id);if(!g)return;space.nodes.filter(n=>n.groupId===id).forEach(n=>{n.x+=dx;n.y+=dy;});if(isStack(g)){g.x=number(g.x)+dx;g.y=number(g.y)+dy;for(const p of g.memberPositions||[]){p.x+=dx;p.y+=dy;}}}
export function retargetEdge(space,id,target){const edge=space.edges.find(e=>e.id===id),node=space.nodes.find(n=>n.id===target);if(!edge||node?.type!=='chat')throw Error('连接目标必须是一张聊天卡片。');if(edge.source===target)throw Error('不能连接到自身。');if(space.edges.some(e=>e.id!==id&&e.source===edge.source&&e.target===target))throw Error('该连接已经存在。');edge.target=target;return edge;}
export function preserveContainerFields(group,idMap){const result={...copy(group),id:idMap.get(group.id)||group.id};if(Array.isArray(group.memberPositions))result.memberPositions=group.memberPositions.filter(p=>idMap.has(p.id)).map(p=>({...p,id:idMap.get(p.id)}));return result;}
