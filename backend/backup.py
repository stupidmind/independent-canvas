import io,json,os,re,sys,zipfile,base64
from pathlib import Path
root=Path(sys.argv[2]); operation=sys.argv[1]
if operation=='export':
    with zipfile.ZipFile(sys.stdout.buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json',json.dumps({'format':'independent-canvas-backup','version':1}))
        for name in ['state.json','attachments','canvases','backups']:
            target=root/name
            if not target.exists(): continue
            paths=[target] if target.is_file() else target.rglob('*')
            for file in paths:
                if file.is_file() and not file.is_symlink() and '.tmp' not in file.name: archive.write(file,str(file.relative_to(root)))
else:
    data=json.load(sys.stdin); raw=base64.b64decode(data.get('base64',''),validate=True)
    if len(raw)>150*1024*1024: raise ValueError('备份包超过150MB。')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries=archive.infolist()
        if len(entries)>10000 or sum(i.file_size for i in entries)>500*1024*1024: raise ValueError('备份解压后过大。')
        manifest=json.loads(archive.read('manifest.json'))
        if manifest.get('format')!='independent-canvas-backup': raise ValueError('不是独立画布备份。')
        state=json.loads(archive.read('state.json'))
        if not isinstance(state.get('spaces'),list) or len(state['spaces'])>200: raise ValueError('画布格式无效。')
        attachments=[]
        for entry in entries:
            if entry.is_dir():continue
            name=entry.filename
            if name.startswith('attachments/'):
                if not re.fullmatch(r'attachments/[a-f0-9-]{36}\.(pdf|png|jpeg|jpg|webp|gif)',name):raise ValueError('备份含不支持的附件路径。')
                if entry.file_size>50*1024*1024:raise ValueError('备份附件超过50MB。')
                target=root/name; content=archive.read(entry)
                if target.exists() and target.read_bytes()!=content:raise ValueError('附件编号冲突，未覆盖原文件。')
                attachments.append((target,content))
        # Validate all entries first. Do not overwrite conflicting original attachments.
        for target,content in attachments:
            target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists():
                with target.open('xb') as file:file.write(content)
                os.chmod(target,0o600)
        print(json.dumps({'state':state},ensure_ascii=False))
