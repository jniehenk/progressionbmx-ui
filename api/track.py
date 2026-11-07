"""Restricted server gateway. No rider bodies, tokens or URLs are logged/stored."""
import json,os,re,uuid
from http.server import BaseHTTPRequestHandler
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit,parse_qs,urlencode
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args):return None
class GatewayError(Exception):
    def __init__(self,status,code):self.status=status;self.code=code

def rejection_category(error):
    """Inspect a bounded error in memory; return fixed categories, never content."""
    try:
        if error.headers.get('cf-mitigated','').lower()=='challenge':return 'EDGE_CHALLENGE_MARKER'
        sample=error.read(32768).lower()
        if b'cloudflare access' in sample:return 'ACCESS_PAGE_MARKER'
        if b'error code: 1010' in sample or b'error code:1010' in sample:return 'EDGE_INTEGRITY_MARKER'
        if b'cf-error-details' in sample or b'attention required!' in sample:return 'EDGE_SECURITY_PAGE_MARKER'
        if b'invalid token' in sample or b'failed to validate' in sample:return 'TOKEN_VALIDATION_MARKER'
    except Exception:pass
    return 'UNCLASSIFIED'

def prepare(method,url,body,headers,env):
    base=env.get('PBMX_TRACK_API_ORIGIN','');u=urlsplit(base)
    required=('PBMX_TRACK_API_SECRET','CF_ACCESS_CLIENT_ID','CF_ACCESS_CLIENT_SECRET')
    if env.get('PBMX_TRACK_PROXY_ENABLED')!='true' or u.scheme!='https' or not u.hostname or u.path not in ('','/') or u.username or u.password or u.query or u.fragment or u.port not in (None,443) or any(not env.get(k) for k in required) or len(env['PBMX_TRACK_API_SECRET'])<32:raise GatewayError(503,'GATEWAY_NOT_CONFIGURED')
    q=parse_qs(urlsplit(url).query,keep_blank_values=True)
    if any(len(v)!=1 for v in q.values()):raise GatewayError(400,'DUPLICATE_QUERY')
    resource=q.pop('resource',['health'])[0];route=q.pop('profile',[''])[0];reference=q.pop('reference',[''])[0];action=q.pop('action',[''])[0]
    allowed={('GET','health'),('GET','profiles'),('GET','board'),('GET','results'),('GET','riders'),('GET','runs'),('GET','registration-config'),('GET','chip-results'),('POST','anon-session'),('GET','anon-config'),('GET','anon-profiles'),('POST','anon-registrations'),('GET','anon-registration'),('POST','anon-registration'),('POST','registrations'),('GET','registration'),('POST','registration')}
    if (method,resource) not in allowed:raise GatewayError(404,'ROUTE_UNAVAILABLE')
    if set(q)-{'q','offset','limit','start','end','letter','chip'}:raise GatewayError(400,'QUERY_FIELDS')
    if 'letter' in q and not re.fullmatch('[A-Z#]',q['letter'][0]):raise GatewayError(400,'LETTER_REQUIRED')
    anonymous=resource.startswith('anon-')
    if resource=='chip-results':
        chip=q.get('chip',[''])[0].strip().upper()
        if not 1<=len(chip)<=128 or any(ord(c)<33 or ord(c)>126 for c in chip):raise GatewayError(400,'CHIP_REQUIRED')
        q['chip']=[chip];resource='chips/results'
    if anonymous:
        mapping={'anon-session':'anonymous/session','anon-config':'anonymous/config','anon-profiles':'anonymous/profiles','anon-registrations':'anonymous/registrations'}
        if resource=='anon-registration':
            if not re.fullmatch('[0-9a-f]{32}',reference) or action not in ('','details','verify','choose','cancel','finalize','tag-only','private-details'):raise GatewayError(400,'REGISTRATION_ROUTE')
            resource='anonymous/registrations/'+reference+('/'+action if action else '')
        else:resource=mapping[resource]
    if resource=='runs':
        if not re.fullmatch('[a-z0-9-]{1,80}',route):raise GatewayError(400,'PROFILE_ROUTE')
        resource='riders/'+route+'/runs'
    if resource=='results':
        if not re.fullmatch('[a-z0-9-]{1,80}',route):raise GatewayError(400,'PROFILE_ROUTE')
        resource='profiles/'+route+'/results'
    elif resource=='registration':
        if not re.fullmatch('[0-9a-f]{32}',reference) or action not in ('','choose','finalize','cancel') or method=='GET' and action:raise GatewayError(400,'REGISTRATION_ROUTE')
        resource='registrations/'+reference+('/'+action if action else '')
    for k in ('offset','limit'):
        if k in q and (not q[k][0].isdigit() or not (0 if k=='offset' else 1)<=int(q[k][0])<=(10000 if k=='offset' else 100)):raise GatewayError(400,'QUERY_LIMIT')
    if len(q.get('q',[''])[0])>80:raise GatewayError(400,'QUERY_LIMIT')
    import datetime
    for k in ('start','end'):
        if k in q:
            try:datetime.date.fromisoformat(q[k][0])
            except ValueError:raise GatewayError(400,'DATE_RANGE')
    correlation=uuid.uuid4().hex
    outbound={'Authorization':'Bearer '+env['PBMX_TRACK_API_SECRET'],'CF-Access-Client-Id':env['CF_ACCESS_CLIENT_ID'],'CF-Access-Client-Secret':env['CF_ACCESS_CLIENT_SECRET'],'X-Request-ID':correlation,'Content-Type':'application/json','Accept':'application/json','User-Agent':'ProgressionBMXGateway/1.0'}
    if anonymous:
        cookie=headers.get('Cookie','')
        if len(cookie)>8192:raise GatewayError(400,'COOKIE_LIMIT')
        # Forward only this registration capability, never unrelated cookies.
        from http.cookies import SimpleCookie
        jar=SimpleCookie();jar.load(cookie)
        if '__Host-pbmx-registration' in jar:outbound['Cookie']='__Host-pbmx-registration='+jar['__Host-pbmx-registration'].value
        csrf=headers.get('X-Registration-CSRF','')
        if len(csrf)>128:raise GatewayError(400,'CSRF_LIMIT')
        outbound['X-Registration-CSRF']=csrf
    data=None
    if resource=='registrations' or resource.startswith('registrations/'):
        identity=headers.get('Authorization','')
        if not identity.startswith('Bearer ') or not 1<=len(identity[7:])<=16384:raise GatewayError(401,'RIDER_LOGIN_REQUIRED')
        outbound['X-Rider-Authorization']=identity
    if method=='POST':
        if not isinstance(body,bytes) or not 0<len(body)<=16384:raise GatewayError(413,'BODY_LIMIT')
        try:value=json.loads(body)
        except (ValueError,UnicodeError):raise GatewayError(400,'JSON_REQUIRED')
        if not isinstance(value,dict):raise GatewayError(400,'OBJECT_REQUIRED')
        fields=({'new'} if 'new' in value else set()) if resource=='anonymous/session' else {'key','details'} if resource=='anonymous/registrations' else {'details','revision'} if anonymous and action=='details' else {'key'} if anonymous and action=='verify' else {'key','details','track_id'} if resource=='registrations' else {'chip'} if action=='choose' else set()
        if set(value)!=fields:raise GatewayError(400,'BODY_FIELDS')
        if resource=='registrations' and (value['track_id']!=env.get('PBMX_TRACK_ID','MLBMX') or not isinstance(value['key'],str) or not 1<=len(value['key'])<=128 or not isinstance(value['details'],dict)):raise GatewayError(400,'REGISTRATION_SCOPE')
        if action=='choose' and (not isinstance(value['chip'],str) or not 1<=len(value['chip'])<=128):raise GatewayError(400,'CHIP_REQUIRED')
        data=json.dumps(value).encode()
    return Request(base.rstrip('/')+'/track-api/v1/'+resource+('?' +urlencode({k:v[0] for k,v in q.items()}) if q else ''),data=data,headers=outbound,method=method),correlation

def forward(method,url,body,headers,env=None,opener=None,response_headers=None):
    correlation=uuid.uuid4().hex
    try:
        request,correlation=prepare(method,url,body,headers,os.environ if env is None else env)
        with (opener or build_opener(ProxyHandler({}),NoRedirect)).open(request,timeout=4) as response:
            if response_headers is not None:
                cookie=response.headers.get('Set-Cookie','')
                if cookie.startswith('__Host-pbmx-registration=') and all(part in cookie for part in ('HttpOnly','SameSite=Strict','Secure','Path=/')):response_headers['Set-Cookie']=cookie
            raw=response.read(1000001)
            if len(raw)>1000000:raise GatewayError(502,'RESPONSE_LIMIT')
            return 200,json.loads(raw),correlation
    except GatewayError as e:return e.status,{'error':e.code},correlation
    except HTTPError as e:
        code=e.code
        if 'resource=anon-' in url:
            try:
                value=json.loads(e.read(16384));error=value.get('error','')
                fields={'name','dob','rider_class','home_track_id','handle','usabmx_number','email','phone','guardian_name','home_track_suggestion','mode','chip','registration_track_id'}
                if isinstance(error,str) and error.startswith('FIELD:') and error.split(':')[1] in fields:
                    e.close();return code,{'error':'FIELD:'+error.split(':')[1]+':Please check this field.'},correlation
                allowed={'CAPTURE_UNAVAILABLE','TAG_ASSIGNMENT_CONFLICT','COMPLETE_PATTERN_REQUIRED','CONFIRM_VERIFIED_CHIP_FIRST','REGISTRATION_SESSION_REQUIRED','REGISTRATION_SESSION_EXPIRED','REGISTRATION_CSRF_REQUIRED','REGISTRATION_UNAVAILABLE','DETAILS_CHANGED_REFRESH','DETAILS_LOCKED_DURING_VERIFICATION','PREVIOUS_VERIFICATION_STILL_ACTIVE','VERIFY_TRANSPONDER_FIRST','REGISTRATION_SAVE_INCOMPLETE','REGISTRATION_ALREADY_SCOPED'}
                if error in allowed:e.close();return code,{'error':error},correlation
            except (ValueError,TypeError,AttributeError):pass
        category=rejection_category(e) if code in (401,403) else 'HTTP_REJECTION'
        e.close()
        print(json.dumps({'event':'TRACK_UPSTREAM_REJECTED','status':code,'category':category,'request_id':correlation}),flush=True)
        return (code if code in (400,401,403,404,409,413,422,429,503,504) else 502),{'error':'TRACK_REQUEST_REJECTED' if code<500 else 'TRACK_UNAVAILABLE'},correlation
    except Exception:return 503,{'error':'TRACK_UNAVAILABLE'},correlation
class handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def respond(self):
        body=None
        if self.command=='POST':
            if parse_qs(urlsplit(self.path).query).get('resource',[''])[0].startswith('anon-') and not self.headers.get('Origin'):return self.reply(403,{'error':'SAME_ORIGIN_REQUIRED'},uuid.uuid4().hex)
            if self.headers.get('Origin') and urlsplit(self.headers['Origin']).netloc!=self.headers.get('Host'):return self.reply(403,{'error':'SAME_ORIGIN_REQUIRED'},uuid.uuid4().hex)
            try:n=int(self.headers.get('Content-Length','0'))
            except ValueError:n=0
            if not 0<n<=16384:return self.reply(413,{'error':'BODY_LIMIT'},uuid.uuid4().hex)
            body=self.rfile.read(n)
        extra={};result=forward(self.command,self.path,body,self.headers,response_headers=extra);self.reply(*result,extra=extra)
    def reply(self,status,data,correlation,extra=None):
        raw=json.dumps(data).encode();self.send_response(status)
        for key,value in (extra or {}).items():self.send_header(key,value)
        for k,v in [('Content-Type','application/json'),('Cache-Control','no-store'),('X-Request-ID',correlation),('X-Content-Type-Options','nosniff'),('Content-Length',str(len(raw)))]:self.send_header(k,v)
        self.end_headers();self.wfile.write(raw)
    def do_GET(self):self.respond()
    def do_POST(self):self.respond()
