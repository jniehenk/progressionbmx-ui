'use strict';
(async()=>{const box=document.getElementById('chipLookup');if(!box)return;
try{const response=await fetch('/api/track?resource=registration-config',{cache:'no-store'});if(!response.ok)throw Error();const config=await response.json();
if(config.chip_results_available){document.getElementById('lookupChip').disabled=false;document.getElementById('chipLookupSubmit').disabled=false;return;}
}catch{}const note=document.createElement('p');note.setAttribute('role','status');note.textContent='Chip-number lookup is being connected at the track. Existing rider results remain available below.';box.append(note);})();
