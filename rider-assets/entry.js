'use strict';
const collator=new Intl.Collator('en-US',{sensitivity:'base',numeric:true});
function normalized(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en-US').trim().replace(/\s+/g,' ');}
function sortDirectory(riders){return [...riders].sort((a,b)=>collator.compare(a.sort_name||a.last_name||a.name,b.sort_name||b.last_name||b.name)||collator.compare(a.first_name||a.name,b.first_name||b.name)||collator.compare(a.tag||'',b.tag||'')||collator.compare(a.id,b.id));}
function letterFor(rider){const initial=normalized(rider.sort_name||rider.last_name||rider.name).charAt(0).toUpperCase();return /^[A-Z]$/.test(initial)?initial:'#';}
function findRiders(riders,query){const needle=normalized(query);return sortDirectory(riders).filter(r=>!needle||normalized([r.name,r.first_name,r.last_name,r.tag].filter(Boolean).join(' ')).includes(needle));}
if(typeof module!=='undefined')module.exports={normalized,sortDirectory,letterFor,findRiders};
if(typeof document!=='undefined'){
  const publicMode=Boolean(window.PBMX_PUBLIC_RIDER);
  const trackBase=location.pathname.match(/^\/tracks\/[^/]+/)?.[0]||'';
  const get=id=>document.getElementById(id);let riders=[],loading=false,loaded=false;
  const sync=elementSync();
  function elementSync(){const p=document.createElement('p');p.className='sync-freshness';p.setAttribute('role','status');get('directoryCount').parentNode.after(p);return p;}
  const element=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
  function renderDirectory(){
    const found=findRiders(riders,get('riderSearch').value);const groups=new Map();
    for(const rider of found){const letter=letterFor(rider);if(!groups.has(letter))groups.set(letter,[]);groups.get(letter).push(rider);}
    get('alphabet').replaceChildren(...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ','#'].map(letter=>{
      const available=groups.has(letter);const item=element(available?'a':'span',available?'letter-link':'letter-disabled',letter);
      if(available){item.href='#letter-'+(letter==='#'?'other':letter);item.setAttribute('aria-label','Names beginning with '+letter);}else item.setAttribute('aria-disabled','true');
      return item;
    }));
    get('riderDirectory').replaceChildren(...Array.from(groups,([letter,entries])=>{
      const section=element('section','letter-section');section.id='letter-'+(letter==='#'?'other':letter);
      section.append(element('h3','letter-heading',letter==='#'?'Other':letter));const list=element('ul','directory-list');
      for(const rider of entries){const row=element('li','');const link=element('a','rider-link');link.href=(publicMode?'/track-rider.html?profile=':trackBase+'/rider?alias=')+encodeURIComponent(rider.id);link.dataset.riderId=rider.id;
        const text=element('span','');text.append(element('strong','',rider.name),element('small','',rider.tag?'Tag '+rider.tag:'No tag assigned'));
        if(publicMode){text.append(element('small','',rider.is_demo?'Historical test alias':rider.category==='CRUISER'?'Cruiser profile':'Class profile'));if(rider.run_count!==null&&rider.run_count!==undefined)text.append(element('small','',rider.run_count+' stored runs'));if(rider.last_seen)text.append(element('small','', 'Last recorded: '+new Date(rider.last_seen).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'})));}
        const arrow=element('span','rider-arrow','→');arrow.setAttribute('aria-hidden','true');link.append(text,arrow);row.append(link);list.append(row);}
      section.append(list);return section;
    }));
    get('directoryCount').textContent=`${found.length} of ${riders.length} riders`;
    get('directoryState').hidden=found.length>0;
    if(!found.length){get('directoryState').className='state';get('directoryState').replaceChildren(element('h3','','No riders found'),element('p','','Try another name or tag number, or clear the search.'));}
  }
  async function loadDirectory(quiet=false){
    if(loading)return;loading=true;
    if(!quiet){
    get('riderSearch').disabled=true;get('clearSearch').disabled=true;get('retryDirectory').disabled=true;
    get('riderDirectory').replaceChildren();get('alphabet').replaceChildren();get('directoryCount').textContent='Loading riders…';
    get('directoryState').hidden=false;get('directoryState').className='state';get('directoryState').replaceChildren(element('span','loader'),element('h3','','Loading the rider directory'));
    }
    try{const response=await fetch(publicMode?'/api/track?resource=riders&limit=100':trackBase+'/api/riders',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Unavailable');const view=await response.json();if(publicMode)while(view.riders.length<view.total){if(view.riders.length>=1000)throw Error('Directory capacity');const more=await fetch('/api/track?resource=riders&limit=100&offset='+view.riders.length,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!more.ok)throw Error('Unavailable');const page=await more.json();if(!page.riders.length)throw Error('Directory changed');view.riders.push(...page.riders);}sync.textContent='Source checked '+new Date().toLocaleTimeString()+' · Last accepted update: '+(view.synchronization?.last_accepted?new Date(view.synchronization.last_accepted).toLocaleString():'not recorded')+(publicMode?' · Manual refresh':' · Historical test data');if(quiet&&loaded&&JSON.stringify(riders)===JSON.stringify(view.riders))return;riders=view.riders;loaded=true;get('riderSearch').disabled=false;get('clearSearch').disabled=false;renderDirectory();}
    catch(_){sync.textContent=publicMode?'Track results temporarily unavailable · Use Refresh riders to retry.':'Synchronization unavailable · Retaining last received directory; retry while visible.';if(quiet&&loaded)return;get('directoryCount').textContent='Rider directory unavailable';get('directoryState').className='state error';get('directoryState').replaceChildren(element('h3','','We couldn’t load the riders'),element('p','','Use Refresh riders to try again.'));}
    finally{loading=false;get('retryDirectory').disabled=false;}
  }
  get('riderSearch').addEventListener('input',renderDirectory);
  get('clearSearch').addEventListener('click',()=>{get('riderSearch').value='';renderDirectory();get('riderSearch').focus();});
  get('retryDirectory').addEventListener('click',()=>loadDirectory());
  if(!publicMode)get('newRider').addEventListener('click',()=>{const open=get('registrationNotice').hidden;get('registrationNotice').hidden=!open;get('newRider').setAttribute('aria-expanded',String(open));});
  for(const a of document.querySelectorAll('a[href="/"]'))a.href=trackBase+'/';
  let refreshSeconds=0,refreshTimer=null;
  const refreshLabel=element('label','refresh-options','Updates '),refreshSelect=element('select','');refreshSelect.id='refreshMode';refreshSelect.setAttribute('aria-label','Automatic refresh');
  for(const [seconds,label] of [[0,'Manual'],[10,'Every 10 seconds'],[30,'Every 30 seconds'],[60,'Every minute']]){const option=element('option','',label);option.value=String(seconds);refreshSelect.append(option);}
  refreshLabel.append(refreshSelect);if(!publicMode)get('directoryCount').parentNode.after(refreshLabel);
  function changeRefresh(){refreshSeconds=Number(refreshSelect.value);if(refreshTimer!==null)clearInterval(refreshTimer);if(refreshSeconds>0)refreshTimer=setInterval(()=>{if(!document.hidden)loadDirectory(true)},refreshSeconds*1000);}
  const requestedRefresh=window.PBMX_REFRESH_SECONDS||0;
  if(Number.isInteger(requestedRefresh)&&requestedRefresh>=1&&requestedRefresh<=300&&!Array.from(refreshSelect.options).some(o=>o.value===String(requestedRefresh))){const option=element('option','', 'Every '+requestedRefresh+' seconds');option.value=String(requestedRefresh);refreshSelect.append(option);}
  refreshSelect.value=String(requestedRefresh);if(!refreshSelect.value)refreshSelect.value='0';refreshSelect.onchange=changeRefresh;changeRefresh();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&refreshSeconds>0)loadDirectory(true)});
  loadDirectory();
}
