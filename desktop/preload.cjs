const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopCanvas',{isDesktop:true,onNewCanvas:callback=>ipcRenderer.on('canvas:new',()=>callback()),onFit:callback=>ipcRenderer.on('canvas:fit',()=>callback())});
