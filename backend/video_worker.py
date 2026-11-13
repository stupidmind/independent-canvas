"""Public-media extraction only. yt-dlp 2026.10.26, official PyPI wheel (Unlicense)."""
import ipaddress, json, os, socket, sys, time
from pathlib import Path

MAX_AUDIO=25*1024*1024
MAX_SUBTITLE=5*1024*1024

# All I/O is forced through stdlib Urllib below. Validate fresh DNS results and
# connect to the checked numeric IP, including redirects and media/CDN requests.
def globally_routable(address):
    try:
        ip=ipaddress.ip_address(str(address).split('%')[0])
        if getattr(ip,'ipv4_mapped',None): ip=ip.ipv4_mapped
        return ip.is_global and not ip.is_multicast and not ip.is_reserved and not ip.is_unspecified
    except ValueError: return False

original_getaddrinfo=socket.getaddrinfo
original_connect=socket.socket.connect
original_connect_ex=socket.socket.connect_ex

def guarded_getaddrinfo(host,port,*args,**kwargs):
    results=[item for item in original_getaddrinfo(host,port,*args,**kwargs) if globally_routable(item[4][0])]
    if not results:
        raise OSError('Media network policy: private or non-global address denied')
    return results

def checked_address(sock,address):
    if sock.family not in (socket.AF_INET,socket.AF_INET6):
        raise OSError('Media network policy: only public internet sockets allowed')
    host,port=address[0],address[1]
    try: ipaddress.ip_address(host.split('%')[0]); numeric=True
    except ValueError: numeric=False
    if numeric:
        if not globally_routable(host): raise OSError('Media network policy: private address denied')
        return address
    results=guarded_getaddrinfo(host,port,sock.family,sock.type,sock.proto)
    return results[0][4]

def guarded_connect(sock,address): return original_connect(sock,checked_address(sock,address))
def guarded_connect_ex(sock,address): return original_connect_ex(sock,checked_address(sock,address))
socket.getaddrinfo=guarded_getaddrinfo
socket.socket.connect=guarded_connect
socket.socket.connect_ex=guarded_connect_ex

for key in list(os.environ):
    if key.lower().endswith('_proxy') or key.lower()=='all_proxy': os.environ.pop(key,None)

# Prevent loading user plugins. Do not inherit browser cookies, user config,
# JavaScript runtimes, executable challenge solvers, or external downloaders.
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'vendor'/'yt-dlp'))
from yt_dlp import YoutubeDL
from yt_dlp.globals import plugin_dirs, all_plugins_loaded
from yt_dlp.networking._urllib import UrllibRH
from yt_dlp.utils import DownloadError
plugin_dirs.value=[]
all_plugins_loaded.value=True

class PublicYoutubeDL(YoutubeDL):
    def build_request_director(self,handlers,preferences=None):
        return super().build_request_director([UrllibRH],[])

class QuietLogger:
    def debug(self,message): pass
    def info(self,message): pass
    def warning(self,message): pass
    def error(self,message): pass

def metadata(info):
    return {'title':str(info.get('title') or '公开视频'),'duration':info.get('duration'),
            'thumbnail':info.get('thumbnail'),'webpageUrl':info.get('webpage_url'),
            'extractor':info.get('extractor_key'),'id':info.get('id')}

def caption(info,language):
    preferred=[language] if language else []
    for kind in ['subtitles','automatic_captions']:
        tracks=info.get(kind) or {}
        languages=list(tracks)
        def rank(lang):
            if lang in preferred: return 0
            if language and lang.split('-')[0]==language.split('-')[0]: return 1
            if lang.startswith('zh'): return 2
            if lang.startswith('en'): return 3
            return 4
        languages.sort(key=lambda lang:(rank(lang),lang))
        for lang in languages:
            if lang=='live_chat': continue
            formats=[entry for entry in tracks[lang] if entry.get('ext') in ('vtt','srt') and (entry.get('url') or entry.get('data'))]
            formats.sort(key=lambda entry:entry.get('ext')!='vtt')
            if formats: return lang,kind=='automatic_captions',formats[0]
    return None

def main(input):
    root=Path(input['directory']).resolve()
    root.mkdir(parents=True,exist_ok=True)
    options={'quiet':True,'no_warnings':True,'logger':QuietLogger(),'noplaylist':True,
             'playlist_items':'1','max_downloads':1,'cachedir':False,'cookiefile':None,
             'cookiesfrombrowser':None,'usenetrc':False,'proxy':'','geo_bypass':False,
             'socket_timeout':15,'retries':1,'extractor_retries':1,'fragment_retries':0,
             'js_runtimes':{},'remote_components':set(),'enable_file_urls':False,
             'allowed_extractors':['youtube.*','tiktok.*','instagram.*','facebook.*','twitter.*','linkedin.*'],
             'outtmpl':str(root/'audio.%(ext)s'),'paths':{'home':str(root),'temp':str(root)},
             'writethumbnail':False,'writeinfojson':False,'overwrites':True,
             'external_downloader':None,'fixup':'never','postprocessors':[],
             'http_headers':{'User-Agent':'Mozilla/5.0 (compatible; LocalCanvas/1.0)'},
             'skip_download':True}
    with PublicYoutubeDL(options) as ydl:
        info=ydl.extract_info(input['url'],download=False)
        if not info or info.get('_type') in ('playlist','multi_video') or info.get('entries') is not None:
            raise ValueError('Only a single public video is supported; playlists are disabled')
        result=metadata(info)
        chosen=caption(info,input.get('language',''))
        if chosen:
            language,automatic,track=chosen
            if track.get('data'): raw=str(track['data'])
            else:
                with ydl.urlopen(track['url']) as response:
                    raw=response.read(MAX_SUBTITLE+1)
                if len(raw)>MAX_SUBTITLE: raise ValueError('Subtitle exceeds 5MB')
                raw=raw.decode('utf-8-sig',errors='replace')
            result.update({'caption':raw,'captionFormat':track.get('ext'),'language':language,'automatic':automatic})
            return result
        if not input.get('downloadAudio'):
            result['noCaptions']=True
            return result
        duration=info.get('duration')
        if not isinstance(duration,(int,float)) or duration<=0 or duration>1200:
            raise ValueError('Audio fallback only supports known video duration up to 20 minutes')
        def progress(data):
            if data.get('downloaded_bytes',0)>MAX_AUDIO or data.get('total_bytes',0)>MAX_AUDIO:
                raise DownloadError('Audio download exceeds 25MB')
        ydl.add_progress_hook(progress)
        ydl.params.update({'skip_download':False,'format':'bestaudio[protocol=https][ext=m4a][filesize<=25M]/bestaudio[protocol=https][ext=webm][filesize<=25M]/bestaudio[protocol=https][ext=m4a][filesize_approx<=25M]/bestaudio[protocol=https][ext=webm][filesize_approx<=25M]',
                           'max_filesize':MAX_AUDIO,'progress_hooks':[progress],
                           'max_downloads':None})
        ydl.process_ie_result(info,download=True)
        files=[p for p in root.glob('audio.*') if p.suffix.lower() in ('.m4a','.webm') and p.is_file()]
        if len(files)!=1: raise ValueError('No bounded direct HTTPS audio format was available')
        audio=files[0]
        if audio.stat().st_size<=0 or audio.stat().st_size>MAX_AUDIO: raise ValueError('Audio file empty or exceeds 25MB')
        result.update({'audioPath':str(audio),'audioFilename':audio.name})
        return result

if __name__=='__main__':
    try:
        payload=json.load(sys.stdin)
        if payload.get('operation')=='policy-check':
            print(json.dumps({'public':globally_routable('8.8.8.8'),'privateDenied':not globally_routable('127.0.0.1'),'mappedDenied':not globally_routable('::ffff:127.0.0.1'),'pluginsDisabled':not plugin_dirs.value,'handler':'Urllib'}))
        else: print(json.dumps(main(payload),ensure_ascii=False))
    except Exception as error:
        message=str(error)
        print(json.dumps({'error':message[:2000]},ensure_ascii=False))
        sys.exit(1)
