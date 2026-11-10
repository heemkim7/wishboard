#!/usr/bin/env python3
"""마실채플 studio-qa release (restored). STUDIO-QA ONLY. Never production 'studio', never Vercel.
Steps (no API token on box; Cloudflare calls go through the user-Cloudflare MCP `execute` tool):
  1) python3 cf_release.py manifest <build_dir> <tag>   -> writes out/<tag>/manifest.json + session.js
     run session.js via execute (code="$file:...") -> save JSON result to out/<tag>/session.json
  2) python3 cf_release.py upload <tag>                 -> uploads needed buckets with session JWT, writes completion jwt
  3) python3 cf_release.py publish <tag>                -> writes publish.js; run via execute -> version id
"""
import mimetypes,sys,os,json,base64,blake3,requests,pathlib,re,shutil
ACC='f4f53df4dc8b7ce92af0bca33bc1e29d'; SCRIPT='studio-qa'
assert SCRIPT=='studio-qa'
HERE=pathlib.Path(__file__).resolve().parent; OUT=HERE/'out'
SKIP={'.git','.vercelignore','.gitignore','test','node_modules'}
HDR="""# rel2
/assets/*
  Cache-Control: public, max-age=0, must-revalidate
/js/*
  Cache-Control: no-cache
/css/*
  Cache-Control: no-cache
/
  Cache-Control: no-cache
/*.html
  Cache-Control: no-cache
"""
def h(b,ext): return blake3.blake3((base64.b64encode(b).decode()+ext).encode()).hexdigest()[:32]
SW_REG = re.compile(r"navigator\.serviceWorker\.register\('/sw\.js(?:\?v=[0-9a-fA-F]{8,64})?'\)")
def asset_rev(pairs):
  lines = [p + ' ' + k for p, k in sorted(pairs) if p.startswith('/assets/')]
  return blake3.blake3(('\n'.join(lines) or 'no-assets').encode()).hexdigest()[:32]
def refuse_legacy_sw(root):
  p = pathlib.Path(root) / 'sw.js'
  if not p.is_file(): return
  t = p.read_text(encoding='utf-8', errors='replace')
  for bad in ('sprite-manifest', 'char_manifest', 'sprites.json', '7759'):
    if bad in t: raise SystemExit('REFUSE legacy sprite manifest in sw.js')
def stamp_index(text, rev):
  nt, n = SW_REG.subn("navigator.serviceWorker.register('/sw.js?v=%s')" % rev, text, count=1)
  return nt if n == 1 else None
def files(root):
  root=pathlib.Path(root)
  for p in sorted(root.rglob('*')):
    rel=p.relative_to(root)
    if p.is_dir() or any(x in SKIP for x in rel.parts): continue
    n=rel.name
    if n.startswith('.env') or n.endswith(('.pem','.key')) or 'secret' in n.lower(): raise SystemExit('REFUSE secret-like file '+str(rel))
    if rel.parts[0]=='.' or n.startswith('.'): continue
    yield '/'+rel.as_posix(),p.read_bytes()
def manifest(root,tag):
  refuse_legacy_sw(root)
  d=OUT/tag; d.mkdir(parents=True,exist_ok=True); m={}; idx={}
  raw=list(files(root))
  pre=[]
  for path,b in raw:
    ext=path.rsplit('.',1)[-1] if '.' in path.rsplit('/',1)[-1] else ''
    pre.append((path,h(b,ext)))
  rev=asset_rev(pre)
  ov=d/'overrides'
  if ov.exists(): shutil.rmtree(ov)
  fs=[]
  for path,b in raw:
    if path=='/index.html':
      stamped=stamp_index(b.decode('utf-8'), rev)
      if stamped is None: print('warn: index.html has no /sw.js register call')
      else:
        b=stamped.encode('utf-8'); ov.mkdir(parents=True,exist_ok=True); (ov/'index.html').write_bytes(b); print('asset rev', rev)
    fs.append((path,b))
  fs.append(('/_headers',HDR.encode()))
  for path,b in fs:
    ext=path.rsplit('.',1)[-1] if '.' in path.rsplit('/',1)[-1] else ''
    k=h(b,ext); m[path]={'hash':k,'size':len(b)}; idx[k]=path
  json.dump(m,open(d/'manifest.json','w')); json.dump({'root':str(pathlib.Path(root).resolve()),'idx':idx},open(d/'idx.json','w'))
  open(d/'session.js','w').write("async () => cloudflare.request({method:'POST',path:`/accounts/%s/workers/scripts/%s/assets-upload-session`,body:{manifest:%s}})"%(ACC,SCRIPT,json.dumps(m)))
  print(len(m),'files; run',d/'session.js','via execute; save result to',d/'session.json')
def upload(tag):
  d=OUT/tag; s=json.load(open(d/'session.json')); r=s.get('result',s); I=json.load(open(d/'idx.json'))
  root=pathlib.Path(I['root']); jwt=r['jwt']; done=jwt
  for bucket in r.get('buckets') or []:
    fl={}
    for k in bucket:
      p=I['idx'][k]; alt=d/'overrides'/p.lstrip('/'); b=alt.read_bytes() if alt.is_file() else (HDR.encode() if p=='/_headers' else (root/p[1:]).read_bytes())
      fl[k]=(k,base64.b64encode(b).decode(),'text/plain' if p=='/_headers' else (mimetypes.guess_type(p)[0] or 'application/octet-stream'))
    x=requests.post(f'https://api.cloudflare.com/client/v4/accounts/{ACC}/workers/assets/upload?base64=true',headers={'Authorization':'Bearer '+jwt},files=fl,timeout=300)
    x.raise_for_status(); j=x.json(); done=(j.get('result') or {}).get('jwt') or done; print('bucket',len(bucket),x.status_code)
  open(d/'completion.jwt','w').write(done); print('ok; now: cf_release.py publish',tag)
def publish(tag):
  d=OUT/tag; jwt=open(d/'completion.jwt').read().strip(); src=HERE/'worker.js'
  if not src.is_file(): raise SystemExit('REFUSE missing worker.js')
  code=src.read_text(encoding='utf-8')
  if 'hasFlushKey' not in code or 'hasGuestKey' not in code: raise SystemExit('REFUSE worker.js has no /rt/health key flags')
  if 'YOUR_FLUSH_SECRET' in code: raise SystemExit('REFUSE secret placeholder in worker.js')
  meta={'main_module':'worker.js','compatibility_date':'2026-04-07','assets':{'jwt':jwt,'config':{'html_handling':'auto-trailing-slash','not_found_handling':'none'}},
        'keep_bindings':['secret_text','durable_object_namespace'],'bindings':[{'type':'assets','name':'ASSETS'},
        {'type':'durable_object_namespace','name':'METER','class_name':'Meter'},{'type':'durable_object_namespace','name':'ROOM','class_name':'Room'}],
        'observability':{'enabled':True},'annotations':{'workers/message':'release '+tag,'workers/tag':tag}}
  js="""async () => { const f=new FormData(); f.append('metadata', new Blob([JSON.stringify(%s)],{type:'application/json'}));
f.append('worker.js', new Blob([%s],{type:'application/javascript+module'}),'worker.js');
const r=await cloudflare.request({method:'PUT',path:`/accounts/%s/workers/scripts/%s`,body:f}); return {id:r.result&&r.result.id, etag:r.result&&r.result.etag, ver:r.result&&r.result.deployment_id}; }"""%(json.dumps(meta),json.dumps(code),ACC,SCRIPT)
  open(d/'publish.js','w').write(js); print('run',d/'publish.js','via execute')
if __name__=='__main__':
  c=sys.argv[1]; {'manifest':lambda:manifest(sys.argv[2],sys.argv[3]),'upload':lambda:upload(sys.argv[2]),'publish':lambda:publish(sys.argv[2])}[c]()
