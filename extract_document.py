"""Local, non-executing document extraction and bounded PDF page previews."""
import base64, datetime, io, json, os, subprocess, sys, zipfile
from html.parser import HTMLParser
from xml.etree import ElementTree

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_TEXT = 600000
MAX_ARCHIVE_BYTES = 120 * 1024 * 1024
TEXT_EXTENSIONS = {'txt','md','markdown','csv','tsv','json','html','htm','xml','log','js','jsx','ts','tsx','py','yaml','yml','css','sql','sh','toml','ini','srt','vtt'}

class TextHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.skip=0; self.in_title=False; self.title=[]
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript','svg'): self.skip+=1
        if tag=='title': self.in_title=True
        if tag in ('p','div','br','h1','h2','h3','li','article','section','tr'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript','svg'): self.skip=max(0,self.skip-1)
        if tag=='title': self.in_title=False
        if tag in ('p','div','li','article','section','tr'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)
        if self.in_title: self.title.append(data)

def checked_archive(blob):
    archive=zipfile.ZipFile(io.BytesIO(blob))
    entries=archive.infolist()
    if len(entries)>10000 or sum(i.file_size for i in entries)>MAX_ARCHIVE_BYTES:
        archive.close(); raise ValueError('文档解压后过大，请拆分文档。')
    if any(i.flag_bits & 1 for i in entries):
        archive.close(); raise ValueError('文档有密码，请先解除密码后导入。')
    return archive

def check_text(text):
    if len(text)>MAX_TEXT: raise ValueError('提取文字超过60万字符，请拆分文档；本次未截断或遗漏后面的内容。')
    return text

def pdf_reader(blob):
    from pypdf import PdfReader
    reader=PdfReader(io.BytesIO(blob))
    if reader.is_encrypted and not reader.decrypt(''): raise ValueError('此PDF有密码，请先解密后导入。')
    if not len(reader.pages): raise ValueError('这份PDF没有页面。')
    return reader

def preview_pdf(blob, page):
    reader=pdf_reader(blob); count=len(reader.pages)
    try: page=int(page)
    except (ValueError, TypeError): raise ValueError('PDF页码无效。')
    if not 1<=page<=count: raise ValueError('PDF页码超出范围。')
    import pypdfium2 as pdfium
    # Render the selected page only. PDFium does not need a GUI or font-cache setup.
    document=pdfium.PdfDocument(blob)
    selected=document[page-1]
    width,height=selected.get_size()
    bitmap=selected.render(scale=min(2.0,1400/max(width,height)))
    image=bitmap.to_pil()
    output=io.BytesIO(); image.save(output,format='PNG'); rendered_bytes=output.getvalue()
    bitmap.close(); selected.close(); document.close()
    if len(rendered_bytes)>8*1024*1024: raise ValueError('PDF页面预览过大，请打开原PDF查看。')
    return {'previewImage':'data:image/png;base64,'+base64.b64encode(rendered_bytes).decode('ascii'),'page':page,'pageCount':count,'pageText':check_text(reader.pages[page-1].extract_text() or '')}

def extract_xlsx(blob):
    from openpyxl import load_workbook
    with checked_archive(blob): pass
    workbook=load_workbook(io.BytesIO(blob),read_only=True,data_only=False,keep_links=False)
    parts=[]; cell_count=0; formula=False; text_size=0
    try:
        if len(workbook.worksheets)>200: raise ValueError('工作表超过200张，请分成多个文件导入。')
        for sheet in workbook.worksheets:
            heading='## 工作表：'+sheet.title; parts.append(heading); text_size+=len(heading)+1
            if (sheet.max_column or 0)>1000 or (sheet.max_row or 0)>100000:
                raise ValueError('工作表范围过大（超过1000列或10万行），请删除空白格式区域或拆分文件。')
            for row in sheet.iter_rows():
                values=[]
                for cell in row:
                    cell_count+=1
                    if cell_count>1000000: raise ValueError('工作表超过100万个单元格，请拆分文件。')
                    value=cell.value
                    if cell.data_type=='f': formula=True
                    if isinstance(value,(datetime.datetime,datetime.date,datetime.time)): value=value.isoformat()
                    values.append('' if value is None else str(value))
                while values and not values[-1]: values.pop()
                if values:
                    line='\t'.join(values); parts.append(line); text_size+=len(line)+1
                if text_size>MAX_TEXT: raise ValueError('表格文字超过60万字符，请拆分文件。')
        warning='公式保留为公式文本，未执行计算；图片与格式不参与正文提取。' if formula else '已提取各工作表的单元格文本；图片与格式不参与正文提取。'
        return '\n'.join(parts),{'sheetCount':len(workbook.worksheets),'warning':warning}
    finally: workbook.close()

def extract_pptx(blob):
    from pptx import Presentation
    with checked_archive(blob): pass
    deck=Presentation(io.BytesIO(blob)); parts=[]
    if len(deck.slides)>500: raise ValueError('幻灯片超过500页，请拆分文件。')
    for i,slide in enumerate(deck.slides,1):
        parts.append('## 幻灯片 '+str(i))
        def shapes_in(shapes):
            for shape in shapes:
                yield shape
                if hasattr(shape,'shapes'): yield from shapes_in(shape.shapes)
        for shape in shapes_in(slide.shapes):
            if getattr(shape,'has_text_frame',False):
                parts.extend(p.text for p in shape.text_frame.paragraphs if p.text)
            if getattr(shape,'has_table',False):
                parts.extend('\t'.join(c.text for c in row.cells) for row in shape.table.rows)
            if getattr(shape,'has_chart',False):
                try:
                    for series in shape.chart.series:
                        parts.append(str(series.name)+': '+', '.join(str(v) for v in series.values))
                except (ValueError,AttributeError,NotImplementedError): pass
        if slide.has_notes_slide:
            notes=slide.notes_slide.notes_text_frame
            if notes and notes.text.strip(): parts.append('演讲备注：\n'+notes.text)
        check_text('\n'.join(parts))
    return '\n'.join(parts),{'slideCount':len(deck.slides),'warning':'已提取文字、表格、图表缓存数值和演讲备注；嵌入图片尚未OCR。'}

def extract(data):
    if 'html' in data:
        parser=TextHTML(); parser.feed(data['html'])
        text='\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())
        return {'title':''.join(parser.title).strip(), 'content':check_text(text)}
    filename=os.path.basename(data.get('filename','document.txt'))
    blob=base64.b64decode(data.get('base64',''),validate=True)
    if len(blob)>MAX_FILE_BYTES: raise ValueError('文件超过50MB，请拆分后再导入。')
    ext=filename.rsplit('.',1)[-1].lower(); metadata={}
    if data.get('operation')=='preview':
        if ext!='pdf': raise ValueError('目前只有PDF支持逐页预览。')
        return preview_pdf(blob,data.get('page',1))
    if ext=='pdf':
        reader=pdf_reader(blob)
        if len(reader.pages)>500: raise ValueError('PDF超过500页，请拆分文件以完整提取正文。')
        chunks=[]; has_text=False
        for i,page in enumerate(reader.pages,1):
            page_text=page.extract_text() or ''; has_text=has_text or bool(page_text.strip()); chunks.append('## 第'+str(i)+'页\n'+page_text)
            check_text('\n\n'.join(chunks))
        text='\n\n'.join(chunks); metadata['pageCount']=len(reader.pages)
        if not has_text:
            text=''; metadata['warning']='这份PDF没有可提取的文字，可能是扫描件。原PDF仍可逐页预览；当前尚未接入OCR。'
    elif ext=='docx':
        with checked_archive(blob) as archive:
            root=ElementTree.fromstring(archive.read('word/document.xml'))
            ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            text='\n'.join(''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in root.findall('.//w:p',ns))
    elif ext=='xlsx': text,metadata=extract_xlsx(blob)
    elif ext=='pptx': text,metadata=extract_pptx(blob)
    elif ext in ('doc','xls','ppt'):
        raise ValueError('本机没有旧版Office转换器。请先另存为DOCX、XLSX、PPTX或PDF后导入。')
    elif ext in TEXT_EXTENSIONS:
        try: text=blob.decode('utf-8-sig')
        except UnicodeDecodeError:
            try: text=blob.decode('gb18030')
            except UnicodeDecodeError: text=blob.decode('utf-8',errors='replace'); metadata['warning']='部分字符编码无法识别，请检查提取结果。'
        if ext in ('html','htm'): return {'filename':filename,**extract({'html':text})}
    else: raise ValueError('支持文本、Markdown、CSV、文字PDF、DOCX、XLSX和PPTX；请先转换其他格式。')
    return {'title':filename,'filename':filename,'content':check_text(text),**metadata}

if __name__=='__main__':
    try: print(json.dumps(extract(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False)); sys.exit(1)
