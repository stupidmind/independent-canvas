import {cp,readFile,writeFile,mkdir,rename,stat,readdir} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),project=dirname(here),target=join(project,'独立画布.app'),runtime=join(here,'node_modules/electron/dist/Electron.app');
try{await stat(target);throw Error('输出应用已存在，请先另存或移走后再构建，避免覆盖现有应用。');}catch(error){if(error.code!=='ENOENT')throw error;}
await cp(runtime,target,{recursive:true,verbatimSymlinks:true});const contents=join(target,'Contents'),resources=join(contents,'Resources','app');await mkdir(resources,{recursive:true});
for(const file of ['server.mjs','storage.mjs','image-inputs.mjs','web_fetch.mjs','extract_document.py'])await cp(join(project,file),join(resources,file));
for(const directory of ['public','backend','vendor','third-party']){try{await stat(join(project,directory));await cp(join(project,directory),join(resources,directory),{recursive:true,filter:path=>!path.endsWith('.test.mjs')&&!path.includes('__pycache__')});}catch(error){if(error.code!=='ENOENT')throw error;}}
await cp(join(project,'README.md'),join(resources,'README.md'));
for(const file of ['main.cjs','preload.cjs'])await cp(join(here,file),join(resources,file));
await writeFile(join(resources,'package.json'),JSON.stringify({name:'independent-canvas',version:'1.0.0',type:'module',main:'main.cjs'}));await writeFile(join(resources,'desktop-config.json'),JSON.stringify({projectRoot:project}));
let plist=await readFile(join(contents,'Info.plist'),'utf8');plist=plist.replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,'<key>CFBundleDisplayName</key><string>独立画布</string>').replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/,'<key>CFBundleIdentifier</key><string>cloud.greatwonder.independent-canvas</string>').replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,'<key>CFBundleName</key><string>独立画布</string>');
plist=plist.replace(/<\/dict>\s*<\/plist>/,'<key>NSMicrophoneUsageDescription</key><string>在你点击录音后采集音频，用于所选服务的语音转写。</string></dict></plist>');await writeFile(join(contents,'Info.plist'),plist);console.log(target);
