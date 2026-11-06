'use strict';
const $ = id => document.getElementById(id);
let dataset = null;
let loading=false;
const publicMode=typeof window!=='undefined'&&Boolean(window.PBMX_PUBLIC_RIDER);
const publicProfile=publicMode?new URLSearchParams(location.search).get('profile'):null;
const trackBase=typeof location!=='undefined'?(location.pathname.match(/^\/tracks\/[^/]+/)?.[0]||''):'';
const chipReference=typeof location!=='undefined'?location.pathname.match(/^\/register\/results\/([a-f0-9]{32})$/)?.[1]:null;
function endpoint(path){if(publicMode&&path==='/api/runs')return '/api/track?resource=runs&limit=100&profile='+encodeURIComponent(publicProfile||'');return chipReference&&path==='/api/runs'?'/api/v1/enrollments/'+chipReference+'/results':trackBase+path;}
function freshness(text){let p=document.getElementById('syncFreshness');if(!p){p=node('p','sync-freshness');p.id='syncFreshness';p.setAttribute('role','status');$('count').parentNode.after(p);}p.textContent=text;}

const classes = {FULL_LAP:'Full lap', HALF_TRACK:'Half-track', RHYTHM:'Rhythm', OTHER:'Other'};
const starts = {GATE:'Gate start', ROLLING:'Rolling start', UNKNOWN:'Unknown start', SECTION_ONLY:'Unknown start'};
const metrics=[['START_30FT','Start Hill Elapsed'],['STRAIGHT1_ELAPSED','1st Straight Elapsed'],['FULL_LAP_ELAPSED','Finish'],['RHYTHM_SECTION_SPLIT','Rhythm Section Elapsed']];
const metricLabels=Object.fromEntries(metrics);
function displayLabel(split){return metricLabels[split.id]||split.label;}
function pacificTime(value){
  if(typeof value!=='string'||!value)return {day:null,time:'Time unavailable'};
  const stamp=new Date(value);
  if(!Number.isFinite(stamp.getTime()))return {day:null,time:'Time unavailable'};
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(stamp);
  const get=type=>parts.find(p=>p.type===type).value;
  return {day:`${get('year')}-${get('month')}-${get('day')}`,time:new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(stamp)};
}
function localRun(run){const display=pacificTime(run.occurred_at);return {...run,day:display.day,timeRecorded:display.time};}
function dateLabel(day){return day?`${day.slice(5,7)}/${day.slice(8,10)}/${day.slice(0,4)}`:'Date unavailable';}
function metricGroups(runs,metric){
  const groups=new Map();
  for(const run of runs){
    if(metric==='FULL_LAP_ELAPSED'&&run.classification!=='FULL_LAP')continue;
    const split=run.splits.find(s=>s.id===metric);
    if(!split||split.milliseconds===null)continue;
    const key=JSON.stringify([run.alias_id,run.day,run.start_mode,run.anchor,run.comparison_scope]);
    if(!groups.has(key))groups.set(key,{run,entries:[]});
    groups.get(key).entries.push({run,split});
  }
  return Array.from(groups.values()).map(group=>({...group,minimum:Math.min(...group.entries.map(e=>e.split.milliseconds)),entries:group.entries.sort((a,b)=>new Date(a.run.occurred_at)-new Date(b.run.occurred_at)||a.run.id.localeCompare(b.run.id))}));
}
function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function state(kind, heading, message) {
  const box = $('state'); box.hidden = false; box.className = 'state ' + kind;
  box.replaceChildren();
  if (kind === 'loading') box.append(node('span','loader'));
  box.append(node('h3','',heading),node('p','',message));
}
function options(select, values, selected) {
  select.replaceChildren(...values.map(([value,label])=>{const o = node('option','',label);o.value=value;return o;}));
  select.value = values.some(([value])=>value === selected) ? selected : values[0][0];
}
function splitGroup(run, kind, title) {
  const group = node('div','split-group '+kind);group.append(node('h4','',title));
  for (const split of run.splits.filter(s=>s.kind === kind)) {
    const row = node('div','split-row'); row.dataset.splitId=split.id; const label = node('span','split-label',displayLabel(split));
    row.append(label,node('span','split-value',split.seconds + (split.milliseconds === null ? '' : ' s')));group.append(row);
  }
  return group;
}
function card(run) {
  const article = node('article','run-card'); article.dataset.runId = run.id;
  const content = node('div','card-content'); const top = node('div','card-top');
  const clock = node('time','run-time',run.timeRecorded); clock.dateTime = run.occurred_at;
  top.append(node('span','run-kind',(classes[run.classification] || run.classification).toUpperCase()),clock);
  content.append(top,node('h3','',run.alias_label),node('p','recorded-day','Date: '+dateLabel(run.day)));
  const duration = node('div','duration-block'); const metric = node('div','');
  metric.append(node('p','duration-label',run.duration ? displayLabel(run.duration) : 'Applicable duration unavailable'));
  const value = node('div','duration-value',run.duration ? run.duration.seconds : '—');
  if (run.duration && run.duration.milliseconds !== null) value.append(node('span','unit','seconds'));
  metric.append(value); duration.append(metric,node('span','start-tag',starts[run.start_mode] || 'Unknown start'));
  content.append(duration);
  const meta = node('div','card-meta');
  meta.append(node('span','',run.validity === 'UNASSESSED' ? 'Unassessed' : run.validity),
    node('span','',run.processing_status === 'COMPLETED' ? 'Processing completed' : run.processing_status),node('span','',run.ranking_eligible?'Eligible for ranking':'Not ranked'));
  content.append(meta); article.append(content);
  const details = node('details','splits'); const summary = node('summary','','View splits');
  const body = node('div','split-body');
  body.append(node('p','split-intro','Stored timings in seconds to three decimals. — means unavailable. Values overlap; do not add them.'),
    splitGroup(run,'elapsed','Elapsed times · cumulative from run anchor'), splitGroup(run,'section','Section times · individual sections'));
  const technical = node('details','technical');
  technical.append(node('summary','','Technical details'),
    node('p','','Recorded anchor: '+run.anchor+' · Start mode: '+run.start_mode+' · Revision '+run.revision));
  const codes=node('dl','technical-splits');
  for(const split of run.splits) codes.append(node('dt','',displayLabel(split)),node('dd','canonical',split.id==='START_30FT'?'START_HILL':split.id));
  technical.append(codes);body.append(technical);
  details.append(summary,body);article.append(details);return article;
}
function render() {
  if (!dataset) return;
  const alias = $('rider').value; const day = $('date').value;
  const runs = dataset.runs.filter(r=>(alias === 'all' || r.alias_id === alias) &&
    (day === 'all' || (day === 'undated' ? !r.day : r.day === day)));
  $('count').textContent = `${runs.length} of ${dataset.runs.length} candidates shown`;
  $('runs').replaceChildren(...runs.map(card));
  $('timingBoxes').replaceChildren(...metrics.map(([metric,title])=>{
    const box=node('section','timing-box');box.dataset.metric=metric;box.append(node('h3','',title));
    const headings=node('div','metric-columns');headings.append(node('span','','Time recorded'),node('span','','Elapsed'));box.append(headings);
    const groups=metricGroups(runs,metric);
    if(!groups.length)box.append(node('p','metric-empty','No times recorded.'));
    for(const group of groups){
      const mode=group.run.start_mode==='SECTION_ONLY'?'Section run':(starts[group.run.start_mode]||'Unknown start');
      box.append(node('h4','metric-group-title',`${group.run.alias_label} · ${dateLabel(group.run.day)} · ${mode}`));
      const list=node('ul','metric-list');
      for(const entry of group.entries){
        const fastest=Boolean(entry.run.day&&entry.run.comparison_scope)&&entry.split.milliseconds===group.minimum;
        const row=node('li',fastest?'metric-entry fastest':'metric-entry');row.dataset.runId=entry.run.id;
        const time=node('time','',entry.run.timeRecorded);time.dateTime=entry.run.occurred_at;
        const value=node('strong','',entry.split.seconds+' s');
        row.append(time,value);if(fastest)row.append(node('span','fastest-label','Fastest listed'));
        list.append(row);
      }
      box.append(list);
    }
    return box;
  }));
  if (runs.length) $('state').hidden = true;
  else state('empty',chipReference&&!dataset.runs.length?'No timing results for this chip yet':'No runs in this selection',chipReference&&!dataset.runs.length?'Registration is complete. Published results for this chip will appear here automatically.':'Choose another date or select All dates.');
}
async function load(quiet=false,more=false) {
  if(loading)return;loading=true;
  const expanded=new Map(Array.from(document.querySelectorAll('.run-card')).map(c=>[c.dataset.runId,Array.from(c.querySelectorAll('details')).map(d=>d.open)]));
  const previous = {rider:$('rider').value,date:$('date').value};
  if(!quiet){$('rider').disabled = true; $('date').disabled = true; $('refresh').disabled = true;}
  if(!quiet){$('runs').replaceChildren(); $('timingBoxes').replaceChildren(); $('count').textContent = 'Loading historical runs…';}
  if(!quiet)state('loading','Loading the session book',publicMode?'Connecting to the track…':'Reading the isolated historical receiver…');
  try {
    const response = await fetch(endpoint('/api/runs')+(publicMode&&more?'&offset='+dataset.runs.length:''),{cache:'no-store',headers:chipReference?await window.chipResultsHeaders():{},signal:AbortSignal.timeout(10000)});
    if (!response.ok){if(chipReference&&[401,403,404].includes(response.status)){dataset=null;$('runs').replaceChildren();$('timingBoxes').replaceChildren();$('rider').replaceChildren();$('date').replaceChildren();}throw new Error('Receiver unavailable');}
    const next=await response.json();
    if(publicMode&&more&&dataset){const joined=new Map(dataset.runs.map(r=>[r.id,r]));for(const r of next.runs)joined.set(r.id,r);next.runs=Array.from(joined.values());}
    const sync=next.synchronization;
    const pipeline=next.current_capture_processing;if(pipeline){let note=document.getElementById('captureProcessing');if(!note){note=node('p','sync-freshness');note.id='captureProcessing';$('count').parentNode.after(note);}note.textContent=pipeline.error||('Current capture processing: '+pipeline.stage.replaceAll('_',' ').toLowerCase()+' · Pending deliveries: '+(pipeline.pending??0));}
    freshness('Source checked '+new Date().toLocaleTimeString()+' · Last accepted update: '+(sync?.last_accepted?new Date(sync.last_accepted).toLocaleString():'not recorded')+(publicMode?' · Manual refresh':chipReference?' · Chip timing history · Local test data':' · Historical test data'));
    if(quiet&&dataset&&JSON.stringify(dataset.runs.map(({day,timeRecorded,...r})=>r))===JSON.stringify(next.runs))return;
    if(quiet){previous.rider=$('rider').value;previous.date=$('date').value;}
    dataset = next;
    if(publicMode){document.querySelector('.hero h1').textContent=next.profile.name;const notice=document.querySelector('.notice strong');if(notice)notice.textContent=next.notice;document.querySelector('footer > p').textContent=next.notice;$('scope').textContent=next.dataset_label;const loadMore=$('loadMore');if(loadMore)loadMore.hidden=dataset.runs.length>=dataset.total;}
    if(chipReference){document.querySelector('footer > p').textContent=next.notice;document.querySelector('.hero .eyebrow').textContent='YOUR CHIP TIMING HISTORY';document.querySelector('.hero-count span').textContent='All available dates';const notice=document.querySelector('.notice strong');if(notice)notice.textContent=next.notice;document.querySelector('.historical').textContent='LOCAL TEST / CHIP HISTORY';document.querySelector('.hero h1').textContent='Your chip timing history';document.querySelector('.intro').textContent='All available dates for '+next.chip_identity+'. History follows this chip.';$('scope').textContent=next.dataset_label;document.querySelector('.back-to-riders').textContent='← Back to registration';}

    dataset.runs=dataset.runs.map(localRun);
    dataset.dates=Array.from(new Set(dataset.runs.map(r=>r.day).filter(Boolean))).sort().reverse();
    dataset.default_date=dataset.dates[0]||'undated';
    $('total').textContent = dataset.runs.length;
    const requested=publicMode?publicProfile:new URLSearchParams(window.location.search).get('alias');
    const previousKnown=previous.rider==='all'||dataset.aliases.some(a=>a.id===previous.rider);
    const wanted=previousKnown?previous.rider:(requested||'all');
    const missing=wanted!=='all'&&!dataset.aliases.some(a=>a.id===wanted);
    options($('rider'),[['all','All rider / chip aliases'],...(missing?[[wanted,'Rider not found']]:[]),...dataset.aliases.map(a=>[a.id,a.label])],wanted);
    const ownDates=dataset.runs.filter(r=>wanted==='all'||r.alias_id===wanted).map(r=>r.day).filter(Boolean).sort().reverse();
    if(!previousKnown&&ownDates.length)dataset.default_date=ownDates[0];
    options($('date'),[['all','All dates'],...(dataset.runs.some(r=>!r.day)?[['undated','Date unavailable']]:[]),...dataset.dates.map(d=>[d,dateLabel(d)])],previous.date && previous.date !== 'Loading dates…' ? previous.date : dataset.default_date);
    $('rider').disabled = false; $('date').disabled = false;
    if(quiet)for(const c of document.querySelectorAll('.run-card'))expanded.set(c.dataset.runId,Array.from(c.querySelectorAll('details')).map(d=>d.open));
    render();
    for(const c of document.querySelectorAll('.run-card')){const states=expanded.get(c.dataset.runId);if(states)c.querySelectorAll('details').forEach((d,i)=>d.open=states[i]);}
  } catch (_) {
    freshness(publicMode?'Track results temporarily unavailable · Use Refresh data to retry.':'Synchronization unavailable · Showing last received data; retry while visible.');
    if(quiet&&dataset)return;
    dataset = null; $('total').textContent = '—'; $('count').textContent = publicMode?'Track results unavailable':'Historical receiver unavailable';
    state('error','We couldn’t load the runs',publicMode?'Track results temporarily unavailable. Use Refresh data to retry.':'The local historical receiver is unavailable or could not be read. Your recordings have not been changed. Use Refresh data to try again.');
  } finally { loading=false;$('refresh').disabled = false; }
}
if(typeof module!=='undefined')module.exports={pacificTime,localRun,metricGroups,metrics};
if(typeof document!=='undefined'){
$('rider').addEventListener('change',render);
$('date').addEventListener('change',render);
$('refresh').addEventListener('click',()=>load());
for(const a of document.querySelectorAll('a[href="/"]'))a.href=endpoint('/');
let refreshSeconds=0,refreshTimer=null;
const refreshLabel=node('label','refresh-options','Updates '),refreshSelect=node('select','');refreshSelect.id='refreshMode';refreshSelect.setAttribute('aria-label','Automatic refresh');
for(const [seconds,label] of [[0,'Manual'],[10,'Every 10 seconds'],[30,'Every 30 seconds'],[60,'Every minute']]){const option=node('option','',label);option.value=String(seconds);refreshSelect.append(option);}
refreshLabel.append(refreshSelect);if(!publicMode)$('refresh').parentNode.after(refreshLabel);
function changeRefresh(){refreshSeconds=Number(refreshSelect.value);if(refreshTimer!==null)clearInterval(refreshTimer);if(refreshSeconds>0)refreshTimer=setInterval(()=>{if(!document.hidden)load(true)},refreshSeconds*1000);}
const requestedRefresh=window.PBMX_REFRESH_SECONDS||0;
if(Number.isInteger(requestedRefresh)&&requestedRefresh>=1&&requestedRefresh<=300&&!Array.from(refreshSelect.options).some(o=>o.value===String(requestedRefresh))){const option=node('option','', 'Every '+requestedRefresh+' seconds');option.value=String(requestedRefresh);refreshSelect.append(option);}
refreshSelect.value=String(requestedRefresh);if(!refreshSelect.value)refreshSelect.value='0';refreshSelect.onchange=changeRefresh;changeRefresh();
if(publicMode&&$('loadMore'))$('loadMore').addEventListener('click',()=>load(false,true));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&refreshSeconds>0)load(true)});
load();
}
