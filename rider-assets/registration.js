'use strict';
async function registrationAvailability(){
 const box=document.getElementById('registrationState');box.replaceChildren();
 const title=document.createElement('h2'),message=document.createElement('p');box.append(title,message);
 title.textContent='Checking registration availability…';
 try{const response=await fetch('/api/track?resource=registration-config',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const config=await response.json();
 // Never bootstrap the local shared test account or collect a form without real login.
 title.textContent=config.available?'Secure sign-in integration required':'Online registration needs secure rider sign-in';
 message.textContent='The local track registration flow is available to the track operator. Website sign-in has not been connected yet. No registration details are collected on this page.';
 }catch{title.textContent='Track registration temporarily unavailable';message.textContent='The track service could not be reached. Use Check again to retry.';}
}
document.getElementById('retryRegistration').onclick=registrationAvailability;registrationAvailability();
