"use strict";(()=>{var Lt=class extends Error{constructor(){super("no reply"),this.name="NoReply"}},rt=class extends Error{status;body;constructor(e,t){super(t.message),this.name="Refused",this.status=e,this.body=t}};async function gs(i,e,t={}){let n;try{n=await fetch(e,{method:i,headers:{...t.body===void 0?{}:{"Content-Type":"application/json"},...t.headers??{}},body:t.body===void 0?void 0:JSON.stringify(t.body),credentials:"same-origin"})}catch{throw new Lt}return kl(n)}async function kl(i){if(i.status===204)return;let e=await i.text(),t=null;try{t=e.length>0?JSON.parse(e):null}catch{t=null}if(!i.ok)throw t===null?new Lt:new rt(i.status,t);return t}var Ee={get:i=>gs("GET",i),post:(i,e,t)=>gs("POST",i,{body:e??{},headers:t}),put:(i,e,t)=>gs("PUT",i,{body:e,headers:t}),patch:(i,e,t)=>gs("PATCH",i,{body:e,headers:t}),delete:(i,e)=>gs("DELETE",i,{headers:e}),postForm:async(i,e)=>{let t;try{t=await fetch(i,{method:"POST",body:e,credentials:"same-origin"})}catch{throw new Lt}return kl(t)}};function la(){return crypto.randomUUID()}var ri=class{key=la();signature="";keyFor(e){let t=JSON.stringify(e??null);return t!==this.signature&&(this.signature=t,this.key=la()),this.key}reopen(){this.signature="",this.key=la()}};var Bl="open-bonnet-view:";function Vs(i,e){try{localStorage.setItem(Bl+i,JSON.stringify(e))}catch{}}function zl(i){try{let e=localStorage.getItem(Bl+i);return e?JSON.parse(e):null}catch{return null}}function p(i,e={},t=[]){let n=document.createElement(i);Zh(n,e);for(let s of t)s!=null&&n.append(typeof s=="string"?document.createTextNode(s):s);return n}function Zh(i,e){for(let[t,n]of Object.entries(e)){if(n==null||n===!1){i.removeAttribute(t);continue}t==="class"?i.className=String(n):i.setAttribute(t,n===!0?"":String(n))}}function wt(i){let e=document.createElement("div");return e.innerHTML=i.trim(),e.firstElementChild}function Ze(i,e){i&&i.textContent!==e&&(i.textContent=e)}function vs(i,e,t){i&&i.getAttribute(e)!==t&&i.setAttribute(e,t)}function we(i,e){return i.querySelector(e)}function cn(i,e){return[...i.querySelectorAll(e)]}function oe(i,e,t,n){i.addEventListener(e,t,n)}function Dt(i,e,t,n,s){let r=new Map;for(let o of[...i.children]){let l=o.getAttribute("data-key");l!==null&&r.set(l,o)}let a=null;for(let o of e){let l=t(o),c=r.get(l);c?(r.delete(l),s(c,o)):(c=n(o),c.setAttribute("data-key",l),s(c,o));let h=a?a.nextElementSibling:i.firstElementChild;h!==c&&i.insertBefore(c,h),a=c}for(let o of r.values())o.remove()}function ca(i,e){for(let t of[...i.children])e.includes(t)||t.remove();e.forEach((t,n)=>{let s=i.children[n]??null;s!==t&&i.insertBefore(t,s)})}function Pi(){return window.matchMedia("(prefers-reduced-motion: reduce)").matches}function Bn(){return window.matchMedia("(max-width: 767px)").matches}var zn={draft:"Draft",rendering:"Rendering",live:"Live",under_offer:"Under offer",sold:"Sold",withdrawn:"Withdrawn"},Li={open:"Open",needs_reread:"Needs re-read",accepted:"Accepted",declined:"Declined",lapsed:"Lapsed",closed_by_acceptance:"Closed by another acceptance"},Vl={active:"Active",revoked:"Revoked",expired:"Expired"},Hs={waiting:"Waiting",delivered:"Delivered",failed:"Failed"},Gs={unit_change:"Unit changed, not a drop",drop:"Mileage drop",no_odometer:"No odometer reading",unreadable:"Odometer unreadable"},Hl={no_findings:"Add at least one finding",no_record_pull:"Pull the test record",record_stale:"The test record is too old. Pull it again.",advisories_unanswered:"Answer every advisory from the latest pull",advisory_recurred:"Change the stance on each advisory seen again at a later test"},Gl="Seen again at a later test",Ws=[{heading:"Panels and readings",fragment:"panels"},{heading:"Findings",fragment:"findings"},{heading:"Evidence",fragment:"evidence"},{heading:"Test record",fragment:"record"},{heading:"Publish",fragment:"publish"},{heading:"People",fragment:"people"},{heading:"Viewings",fragment:"viewings"},{heading:"Offers",fragment:"offers"},{heading:"Alerts",fragment:"alerts"}],se={microns:"Enter whole microns from 1 to 2000",plastic:"Plastic panels cannot be gauged",slotMissing:"That time does not exist in London on that date",slotPast:"Choose a time in the future",passphraseWrong:"That passphrase is not right",staleFinding:"This finding has changed. Reload it before saving.",storageDown:"Photo storage is not answering. Nothing was saved. Try again shortly.",recordNotFound:"No test record was found for this registration.",recordDown:"The roadworthiness record service is not answering. Your last pull is still shown.",renderFailed:"The report could not be rendered, so nothing was published.",storeFailed:"The report could not be stored, so nothing was published.",handoverFailed:"The handover record could not be made, so the sale is not complete.",alertFailed:"Phone alert failed. It stays in your alert list.",captureOffline:"No signal. Items stay queued on this device.",photosDown:"Photos are unavailable right now. The written findings are still here.",seenFailed:"That could not be saved. Try again.",sendFailed:"That could not be sent. Try again.",linkEndedHeading:"This link has ended",linkEndedBody:"Ask the owner for a new link.",linkUnknown:"We could not find that link",carUnknown:"We could not find that car file",replayEnded:"This link has ended, so these items were not saved.",changedCard:"Changed. Read it again.",offerNeedsReread:"Your offer needs a re-read",lapsedHeading:"This offer has lapsed",lapsedBody:"You can make a new offer while the car is still live.",rereadHeading:"The owner has changed this car's file",nothingBlocking:"Nothing is blocking publish",sessionEnded:"Your session has ended. Sign in to carry on.",noFindings:"No findings yet",noViewings:"No viewings offered yet",noOffers:"No offers yet",noAlerts:"No alerts yet",nothingQueued:"Nothing queued",maskRequired:"Mark the plate or tick No plate in this photo",materialUnseen:"Read every material finding before making an offer",offerExists:"You already have an offer on this car",listingClosed:"This car is not taking viewings or offers right now",slotTaken:"That slot has just gone",alreadyHolding:"You already hold a viewing. Release it first.",offerAlreadyAccepted:"Another offer has already been accepted",offerLapsed:"This offer has lapsed",offerNeedsRereadRefusal:"This offer is waiting for the buyer to re-read the changes",offerNotOpen:"This offer is no longer open",alertInProgress:"This alert is already being sent"},Wl={queued:"Queued",sending:"Sending",synced:"Synced",rejected:"Rejected",conflict:"Conflict"};function Xl(i){let e=i/25.4;return(Math.round(e*10+1e-9)/10).toFixed(1)}function hn(i){let t=Math.trunc(Math.abs(i)).toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");return`\xA3${i<0?"-":""}${t}`}function ai(i){let e=Math.max(0,Math.floor(i)),t=Math.floor(e/3600),n=Math.floor(e%3600/60),s=e%60;return`${t}h ${n}m ${s}s left`}var Kh=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:!1});function oi(i){let e={};for(let n of Kh.formatToParts(new Date(i)))n.type!=="literal"&&(e[n.type]=n.value);let t=e.hour==="24"?"00":e.hour;return`${e.day} ${e.month} ${e.year}, ${t}:${e.minute}`}var Xs=class{seconds=0;from=0;reset(e){this.seconds=Math.max(0,Math.floor(e)),this.from=performance.now()}left(){return Math.max(0,this.seconds-Math.floor((performance.now()-this.from)/1e3))}text(){return ai(this.left())}};function Vn(i){return`band-word band-${i.toLowerCase().replace(/\s+/g,"-")}`}var Jh=[{head:"The car file",links:[{label:"Walkround",href:"#walkround"},{label:"Test record",href:"#record"},{label:"Gauge readings",href:"#gauge"},{label:"Viewings",href:"#viewings"}]},{head:"Selling honestly",links:[{label:"Every finding listed",href:"#walkround"},{label:"Readings beside each panel",href:"#gauge"},{label:"Advisories answered",href:"#record"},{label:"A dated record of what you saw",href:"#walkround"}]},{head:"Viewing the car",links:[{label:"Claim a viewing slot",href:"#viewings"},{label:"Make an offer",href:"#offer"},{label:"Bring an inspector",href:"#record"}]},{head:"Ostler Lane",links:[{label:"One owner, one car at a time",href:"#story"},{label:"No fees, no premium",href:"#offer"},{label:"Private sale, plainly put",href:"#story"}]}];function Xt(){let i=Jh.map(e=>{let t=p("ul",{class:"footer-links"},e.links.map(r=>p("li",{},[p("a",{href:r.href},[r.label])]))),n=p("button",{type:"button",class:"footer-head","aria-expanded":"false"},[p("span",{},[e.head]),p("span",{class:"footer-plus","aria-hidden":"true"},["+"])]),s=p("div",{class:"footer-column"},[n,t]);return oe(n,"click",()=>{let r=n.getAttribute("aria-expanded")==="true";n.setAttribute("aria-expanded",r?"false":"true"),s.classList.toggle("is-open",!r)}),s});return p("footer",{class:"car-file-footer"},[p("div",{class:"footer-grid"},i),p("div",{class:"footer-legal"},[p("p",{},["Open Bonnet \u2014 one car, every finding, in the open."]),p("p",{},["A private sale. The car is sold as described, not as a trade warranty."])])])}var $l="open-bonnet-units",ql=new Set;function $s(){return localStorage.getItem($l)==="mils"?"mils":"microns"}function jh(i){localStorage.setItem($l,i);for(let e of ql)e()}function ys(i){ql.add(i)}function gn(i){return i===null?"":$s()==="microns"?`${i} microns`:`${Xl(i)} mils`}function _s(){let i=p("button",{type:"button",class:"units-toggle"}),e=()=>{i.textContent=$s(),i.setAttribute("aria-label",`Units: ${$s()}`)};return e(),oe(i,"click",()=>{jh($s()==="microns"?"mils":"microns")}),ys(e),i}function un(){return p("div",{class:"units-bar"},[p("span",{class:"units-label"},["Units"]),_s()])}var Yl=[0,.75,0],xs=Math.PI/180;function Fi(i){return[i<1200?-.16:0,i<768?.26:.3]}var Qh=2.85,eu=2.9;function qs(i){return Math.max(Qh,eu/i)/Math.tan(38/2*xs)}function tu(i,e,t,n=Yl,s=qs(t)){let r=i*xs,a=e*xs;return[n[0]+s*Math.sin(r)*Math.cos(a),n[1]+s*Math.sin(a),n[2]-s*Math.cos(r)*Math.cos(a)]}function Zl(i,e){let t=Math.cos(i),n=Math.sin(i),s=Math.cos(e),r=Math.sin(e);return{right:[t,0,-n],up:[r*n,s,r*t],forward:[-s*n,r,-s*t]}}function Di(i,e){return i[0]*e[0]+i[1]*e[1]+i[2]*e[2]}function nu(i,e,t,n){let s=e[0]-i[0],r=e[1]-i[1],a=e[2]-i[2],o=Math.hypot(s,r,a)||1,l=[s/o,r/o,a/o],c=Math.tan(38/2*xs),h=Math.atan(t[0]*n*c),u=Math.atan(t[1]*c),d=Math.atan2(-l[0],-l[2]),m=Math.asin(Math.max(-1,Math.min(1,l[1])));for(let v=0;v<24;v+=1){let _=Zl(d,m),g=Di(l,_.forward);if(g<=1e-6)break;let f=Math.atan(Di(l,_.right)/g),T=Math.atan(Di(l,_.up)/g),E=h-f,x=T-u;if(d+=E,m+=x,Math.abs(E)<1e-12&&Math.abs(x)<1e-12)break}return{yaw:d,pitch:m}}function iu(i){let e=1/Math.tan(19*xs),t=1/(.1-120);return[e/i,0,0,0,0,e,0,0,0,0,(120+.1)*t,-1,0,0,2*120*.1*t,0]}function su(i,e,t){let{right:n,up:s,forward:r}=Zl(e,t),a=[-r[0],-r[1],-r[2]];return[n[0],s[0],a[0],0,n[1],s[1],a[1],0,n[2],s[2],a[2],0,-Di(n,i),-Di(s,i),-Di(a,i),1]}function ru(i,e){let t=new Array(16).fill(0);for(let n=0;n<4;n+=1)for(let s=0;s<4;s+=1){let r=0;for(let a=0;a<4;a+=1)r+=i[a*4+s]*e[n*4+a];t[n*4+s]=r}return t}function Ys(i,e,t){let n=Math.max(.05,e/Math.max(1,t)),s=tu(i.angle,i.elevation,n,i.centre??Yl,i.distance??qs(n)),{yaw:r,pitch:a}=nu(s,i.anchor,i.ndc,n),o=iu(n),l=su(s,r,a);return{eye:s,angle:i.angle,yaw:r,pitch:a,projection:o,view:l,viewProjection:ru(o,l)}}function li(i,e,t,n){let s=i,r=s[0]*e[0]+s[4]*e[1]+s[8]*e[2]+s[12],a=s[1]*e[0]+s[5]*e[1]+s[9]*e[2]+s[13],o=s[3]*e[0]+s[7]*e[1]+s[11]*e[2]+s[15];return{x:(r/o+1)/2*t,y:(1-a/o)/2*n,w:o}}function Kl(i){return i.map(e=>e.toFixed(6)).join(",")}function Jl(i){return i.map(e=>e.toFixed(3)).join(",")}var vt=[{id:"bonnet",label:"Bonnet",substrate:"aluminium",origin:[-.75,.85,-2],u:[1.5,0,0],v:[0,.1,1.2],azimuth:0,elevation:28},{id:"os-front-wing",label:"Offside front wing",substrate:"steel",origin:[.85,.45,-2],u:[0,0,1],v:[0,.4,0],azimuth:55,elevation:22},{id:"os-door",label:"Offside door",substrate:"steel",origin:[.85,.4,-1],u:[0,0,1.2],v:[0,.5,0],azimuth:90,elevation:20},{id:"os-sill",label:"Offside sill",substrate:"steel",origin:[.85,.2,-1],u:[0,0,2],v:[0,.2,0],azimuth:96,elevation:18},{id:"os-rear-quarter",label:"Offside rear quarter",substrate:"steel",origin:[.85,.4,.2],u:[0,0,1.8],v:[0,.5,0],azimuth:125,elevation:22},{id:"boot-lid",label:"Boot lid",substrate:"aluminium",origin:[.7,.9,1.4],u:[-1.4,0,0],v:[0,-.1,.6],azimuth:180,elevation:28},{id:"rear-bumper",label:"Rear bumper",substrate:"plastic",origin:[.85,.3,2.1],u:[-1.7,0,0],v:[0,.3,0],azimuth:186,elevation:18},{id:"ns-rear-quarter",label:"Nearside rear quarter",substrate:"steel",origin:[-.85,.4,2],u:[0,0,-1.8],v:[0,.5,0],azimuth:235,elevation:22},{id:"ns-sill",label:"Nearside sill",substrate:"steel",origin:[-.85,.2,1],u:[0,0,-2],v:[0,.2,0],azimuth:264,elevation:18},{id:"ns-door",label:"Nearside door",substrate:"steel",origin:[-.85,.4,.2],u:[0,0,-1.2],v:[0,.5,0],azimuth:270,elevation:20},{id:"ns-front-wing",label:"Nearside front wing",substrate:"steel",origin:[-.85,.45,-1],u:[0,0,-1],v:[0,.4,0],azimuth:305,elevation:22},{id:"front-bumper",label:"Front bumper",substrate:"plastic",origin:[-.85,.3,-2.1],u:[1.7,0,0],v:[0,.3,0],azimuth:354,elevation:18},{id:"roof",label:"Roof",substrate:"steel",origin:[-.6,1.3,-.5],u:[1.2,0,0],v:[0,0,1.4],azimuth:40,elevation:42}],Zs=new Map(vt.map(i=>[i.id,i]));function jl(i){return Zs.get(i)}function ha(i){let e=Zs.get(i);if(!e)throw new Error(`unknown panel: ${i}`);return e}function Ks(i){let e=Zs.get(i);return!!e&&e.substrate!=="plastic"}function Qt(i,e,t){let n=Zs.get(i);return n?[n.origin[0]+e*n.u[0]+t*n.v[0],n.origin[1]+e*n.u[1]+t*n.v[1],n.origin[2]+e*n.u[2]+t*n.v[2]]:[0,0,0]}function Js(i){let e=(...t)=>[t.reduce((n,s)=>n+s[0],0),t.reduce((n,s)=>n+s[1],0),t.reduce((n,s)=>n+s[2],0)];return[i.origin,e(i.origin,i.u),e(i.origin,i.u,i.v),e(i.origin,i.v)]}var il="170";var au=0,Ql=1,ou=2;var jc=1,lu=2,Mn=3,Jn=0,Nt=1,Vt=2,Zn=0,Ji=1,Rs=2,ec=3,tc=4,cu=5,gi=100,hu=101,uu=102,du=103,fu=104,pu=200,mu=201,gu=202,vu=203,Va=204,Ha=205,yu=206,_u=207,xu=208,bu=209,Mu=210,wu=211,Su=212,Eu=213,Tu=214,Ga=0,Wa=1,Xa=2,ts=3,$a=4,qa=5,Ya=6,Za=7,Qc=0,Au=1,Cu=2,Kn=0,Ru=1,Iu=2,Pu=3,Lu=4,Du=5,Fu=6,Uu=7;var eh=300,ns=301,is=302,Ka=303,Ja=304,Hr=306,ja=1e3,_i=1001,Qa=1002,rn=1003,Nu=1004;var js=1005;var fn=1006,ua=1007;var xi=1008;var Cn=1009,th=1010,nh=1011,Is=1012,sl=1013,bi=1014,Sn=1015,Ds=1016,rl=1017,al=1018,ss=1020,ih=35902,sh=1021,rh=1022,sn=1023,ah=1024,oh=1025,ji=1026,rs=1027,lh=1028,ol=1029,ch=1030,ll=1031;var cl=1033,xr=33776,br=33777,Mr=33778,wr=33779,eo=35840,to=35841,no=35842,io=35843,so=36196,ro=37492,ao=37496,oo=37808,lo=37809,co=37810,ho=37811,uo=37812,fo=37813,po=37814,mo=37815,go=37816,vo=37817,yo=37818,_o=37819,xo=37820,bo=37821,Sr=36492,Mo=36494,wo=36495,hh=36283,So=36284,Eo=36285,To=36286;var Er=2300,Ao=2301,da=2302,nc=2400,ic=2401,sc=2402;var Ou=3200,ku=3201;var Bu=0,zu=1,Yn="",qt="srgb",ti="srgb-linear",Gr="linear",tt="srgb";var Ui=7680;var rc=519,Vu=512,Hu=513,Gu=514,uh=515,Wu=516,Xu=517,$u=518,qu=519,ac=35044;var oc="300 es",En=2e3,Tr=2001,jn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;let n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;let s=this._listeners[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;let n=this._listeners[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}},Et=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var fa=Math.PI/180,Co=180/Math.PI;function Fs(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Et[i&255]+Et[i>>8&255]+Et[i>>16&255]+Et[i>>24&255]+"-"+Et[e&255]+Et[e>>8&255]+"-"+Et[e>>16&15|64]+Et[e>>24&255]+"-"+Et[t&63|128]+Et[t>>8&255]+"-"+Et[t>>16&255]+Et[t>>24&255]+Et[n&255]+Et[n>>8&255]+Et[n>>16&255]+Et[n>>24&255]).toLowerCase()}function Ut(i,e,t){return Math.max(e,Math.min(t,i))}function Yu(i,e){return(i%e+e)%e}function pa(i,e,t){return(1-t)*i+t*e}function bs(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Ft(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}var nt=class i{constructor(e=0,t=0){i.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Ut(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*s+e.x,this.y=r*s+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Oe=class i{constructor(e,t,n,s,r,a,o,l,c){i.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c)}set(e,t,n,s,r,a,o,l,c){let h=this.elements;return h[0]=e,h[1]=s,h[2]=o,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],u=n[7],d=n[2],m=n[5],v=n[8],_=s[0],g=s[3],f=s[6],T=s[1],E=s[4],x=s[7],U=s[2],A=s[5],C=s[8];return r[0]=a*_+o*T+l*U,r[3]=a*g+o*E+l*A,r[6]=a*f+o*x+l*C,r[1]=c*_+h*T+u*U,r[4]=c*g+h*E+u*A,r[7]=c*f+h*x+u*C,r[2]=d*_+m*T+v*U,r[5]=d*g+m*E+v*A,r[8]=d*f+m*x+v*C,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8];return t*a*h-t*o*c-n*r*h+n*o*l+s*r*c-s*a*l}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=h*a-o*c,d=o*l-h*r,m=c*r-a*l,v=t*u+n*d+s*m;if(v===0)return this.set(0,0,0,0,0,0,0,0,0);let _=1/v;return e[0]=u*_,e[1]=(s*c-h*n)*_,e[2]=(o*n-s*a)*_,e[3]=d*_,e[4]=(h*t-s*l)*_,e[5]=(s*r-o*t)*_,e[6]=m*_,e[7]=(n*l-c*t)*_,e[8]=(a*t-n*r)*_,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,a,o){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-s*c,s*l,-s*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(ma.makeScale(e,t)),this}rotate(e){return this.premultiply(ma.makeRotation(-e)),this}translate(e,t){return this.premultiply(ma.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},ma=new Oe;function dh(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Ar(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Zu(){let i=Ar("canvas");return i.style.display="block",i}var lc={};function Ts(i){i in lc||(lc[i]=!0,console.warn(i))}function Ku(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}function Ju(i){let e=i.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function ju(i){let e=i.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}var $e={enabled:!0,workingColorSpace:ti,spaces:{},convert:function(i,e,t){return this.enabled===!1||e===t||!e||!t||(this.spaces[e].transfer===tt&&(i.r=Tn(i.r),i.g=Tn(i.g),i.b=Tn(i.b)),this.spaces[e].primaries!==this.spaces[t].primaries&&(i.applyMatrix3(this.spaces[e].toXYZ),i.applyMatrix3(this.spaces[t].fromXYZ)),this.spaces[t].transfer===tt&&(i.r=Qi(i.r),i.g=Qi(i.g),i.b=Qi(i.b))),i},fromWorkingColorSpace:function(i,e){return this.convert(i,this.workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===Yn?Gr:this.spaces[i].transfer},getLuminanceCoefficients:function(i,e=this.workingColorSpace){return i.fromArray(this.spaces[e].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,e,t){return i.copy(this.spaces[e].toXYZ).multiply(this.spaces[t].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace}};function Tn(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Qi(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var cc=[.64,.33,.3,.6,.15,.06],hc=[.2126,.7152,.0722],uc=[.3127,.329],dc=new Oe().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),fc=new Oe().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);$e.define({[ti]:{primaries:cc,whitePoint:uc,transfer:Gr,toXYZ:dc,fromXYZ:fc,luminanceCoefficients:hc,workingColorSpaceConfig:{unpackColorSpace:qt},outputColorSpaceConfig:{drawingBufferColorSpace:qt}},[qt]:{primaries:cc,whitePoint:uc,transfer:tt,toXYZ:dc,fromXYZ:fc,luminanceCoefficients:hc,outputColorSpaceConfig:{drawingBufferColorSpace:qt}}});var Ni,Ro=class{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{Ni===void 0&&(Ni=Ar("canvas")),Ni.width=e.width,Ni.height=e.height;let n=Ni.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=Ni}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=Ar("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=Tn(r[a]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Tn(t[n]/255)*255):t[n]=Tn(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},Qu=0,Cr=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Qu++}),this.uuid=Fs(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push(ga(s[a].image)):r.push(ga(s[a]))}else r=ga(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function ga(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?Ro.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var ed=0,Yt=class i extends jn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=_i,s=_i,r=fn,a=xi,o=sn,l=Cn,c=i.DEFAULT_ANISOTROPY,h=Yn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:ed++}),this.uuid=Fs(),this.name="",this.source=new Cr(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new nt(0,0),this.repeat=new nt(1,1),this.center=new nt(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Oe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==eh)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ja:e.x=e.x-Math.floor(e.x);break;case _i:e.x=e.x<0?0:1;break;case Qa:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ja:e.y=e.y-Math.floor(e.y);break;case _i:e.y=e.y<0?0:1;break;case Qa:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Yt.DEFAULT_IMAGE=null;Yt.DEFAULT_MAPPING=eh;Yt.DEFAULT_ANISOTROPY=1;var ft=class i{constructor(e=0,t=0,n=0,s=1){i.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*s+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*s+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*s+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*s+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,l=e.elements,c=l[0],h=l[4],u=l[8],d=l[1],m=l[5],v=l[9],_=l[2],g=l[6],f=l[10];if(Math.abs(h-d)<.01&&Math.abs(u-_)<.01&&Math.abs(v-g)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+_)<.1&&Math.abs(v+g)<.1&&Math.abs(c+m+f-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let E=(c+1)/2,x=(m+1)/2,U=(f+1)/2,A=(h+d)/4,C=(u+_)/4,N=(v+g)/4;return E>x&&E>U?E<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(E),s=A/n,r=C/n):x>U?x<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(x),n=A/s,r=N/s):U<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(U),n=C/r,s=N/r),this.set(n,s,r,t),this}let T=Math.sqrt((g-v)*(g-v)+(u-_)*(u-_)+(d-h)*(d-h));return Math.abs(T)<.001&&(T=1),this.x=(g-v)/T,this.y=(u-_)/T,this.z=(d-h)/T,this.w=Math.acos((c+m+f-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Io=class extends jn{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new ft(0,0,e,t),this.scissorTest=!1,this.viewport=new ft(0,0,e,t);let s={width:e,height:t,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:fn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);let r=new Yt(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];let a=n.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,s=e.textures.length;n<s;n++)this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;let t=Object.assign({},e.texture.image);return this.texture.source=new Cr(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},Rn=class extends Io{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Rr=class extends Yt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=rn,this.minFilter=rn,this.wrapR=_i,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Po=class extends Yt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=rn,this.minFilter=rn,this.wrapR=_i,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Qn=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,a,o){let l=n[s+0],c=n[s+1],h=n[s+2],u=n[s+3],d=r[a+0],m=r[a+1],v=r[a+2],_=r[a+3];if(o===0){e[t+0]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u;return}if(o===1){e[t+0]=d,e[t+1]=m,e[t+2]=v,e[t+3]=_;return}if(u!==_||l!==d||c!==m||h!==v){let g=1-o,f=l*d+c*m+h*v+u*_,T=f>=0?1:-1,E=1-f*f;if(E>Number.EPSILON){let U=Math.sqrt(E),A=Math.atan2(U,f*T);g=Math.sin(g*A)/U,o=Math.sin(o*A)/U}let x=o*T;if(l=l*g+d*x,c=c*g+m*x,h=h*g+v*x,u=u*g+_*x,g===1-o){let U=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=U,c*=U,h*=U,u*=U}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,s,r,a){let o=n[s],l=n[s+1],c=n[s+2],h=n[s+3],u=r[a],d=r[a+1],m=r[a+2],v=r[a+3];return e[t]=o*v+h*u+l*m-c*d,e[t+1]=l*v+h*d+c*u-o*m,e[t+2]=c*v+h*m+o*d-l*u,e[t+3]=h*v-o*u-l*d-c*m,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(s/2),u=o(r/2),d=l(n/2),m=l(s/2),v=l(r/2);switch(a){case"XYZ":this._x=d*h*u+c*m*v,this._y=c*m*u-d*h*v,this._z=c*h*v+d*m*u,this._w=c*h*u-d*m*v;break;case"YXZ":this._x=d*h*u+c*m*v,this._y=c*m*u-d*h*v,this._z=c*h*v-d*m*u,this._w=c*h*u+d*m*v;break;case"ZXY":this._x=d*h*u-c*m*v,this._y=c*m*u+d*h*v,this._z=c*h*v+d*m*u,this._w=c*h*u-d*m*v;break;case"ZYX":this._x=d*h*u-c*m*v,this._y=c*m*u+d*h*v,this._z=c*h*v-d*m*u,this._w=c*h*u+d*m*v;break;case"YZX":this._x=d*h*u+c*m*v,this._y=c*m*u+d*h*v,this._z=c*h*v-d*m*u,this._w=c*h*u-d*m*v;break;case"XZY":this._x=d*h*u-c*m*v,this._y=c*m*u-d*h*v,this._z=c*h*v+d*m*u,this._w=c*h*u+d*m*v;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],a=t[1],o=t[5],l=t[9],c=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){let m=.5/Math.sqrt(d+1);this._w=.25/m,this._x=(h-l)*m,this._y=(r-c)*m,this._z=(a-s)*m}else if(n>o&&n>u){let m=2*Math.sqrt(1+n-o-u);this._w=(h-l)/m,this._x=.25*m,this._y=(s+a)/m,this._z=(r+c)/m}else if(o>u){let m=2*Math.sqrt(1+o-n-u);this._w=(r-c)/m,this._x=(s+a)/m,this._y=.25*m,this._z=(l+h)/m}else{let m=2*Math.sqrt(1+u-n-o);this._w=(a-s)/m,this._x=(r+c)/m,this._y=(l+h)/m,this._z=.25*m}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ut(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+a*o+s*c-r*l,this._y=s*h+a*l+r*o-n*c,this._z=r*h+a*c+n*l-s*o,this._w=a*h-n*o-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,s=this._y,r=this._z,a=this._w,o=a*e._w+n*e._x+s*e._y+r*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=a,this._x=n,this._y=s,this._z=r,this;let l=1-o*o;if(l<=Number.EPSILON){let m=1-t;return this._w=m*a+t*this._w,this._x=m*n+t*this._x,this._y=m*s+t*this._y,this._z=m*r+t*this._z,this.normalize(),this}let c=Math.sqrt(l),h=Math.atan2(c,o),u=Math.sin((1-t)*h)/c,d=Math.sin(t*h)/c;return this._w=a*u+this._w*d,this._x=n*u+this._x*d,this._y=s*u+this._y*d,this._z=r*u+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},H=class i{constructor(e=0,t=0,n=0){i.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(pc.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(pc.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*s-o*n),h=2*(o*t-r*s),u=2*(r*n-a*t);return this.x=t+l*c+a*u-o*h,this.y=n+l*h+o*c-r*u,this.z=s+l*u+r*h-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,a=t.x,o=t.y,l=t.z;return this.x=s*l-r*o,this.y=r*a-n*l,this.z=n*o-s*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return va.copy(this).projectOnVector(e),this.sub(va)}reflect(e){return this.sub(va.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Ut(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},va=new H,pc=new Qn,Mi=class{constructor(e=new H(1/0,1/0,1/0),t=new H(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(en.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(en.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=en.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,en):en.fromBufferAttribute(r,a),en.applyMatrix4(e.matrixWorld),this.expandByPoint(en);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Qs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Qs.copy(n.boundingBox)),Qs.applyMatrix4(e.matrixWorld),this.union(Qs)}let s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,en),en.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ms),er.subVectors(this.max,Ms),Oi.subVectors(e.a,Ms),ki.subVectors(e.b,Ms),Bi.subVectors(e.c,Ms),Hn.subVectors(ki,Oi),Gn.subVectors(Bi,ki),ci.subVectors(Oi,Bi);let t=[0,-Hn.z,Hn.y,0,-Gn.z,Gn.y,0,-ci.z,ci.y,Hn.z,0,-Hn.x,Gn.z,0,-Gn.x,ci.z,0,-ci.x,-Hn.y,Hn.x,0,-Gn.y,Gn.x,0,-ci.y,ci.x,0];return!ya(t,Oi,ki,Bi,er)||(t=[1,0,0,0,1,0,0,0,1],!ya(t,Oi,ki,Bi,er))?!1:(tr.crossVectors(Hn,Gn),t=[tr.x,tr.y,tr.z],ya(t,Oi,ki,Bi,er))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,en).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(en).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(vn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),vn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),vn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),vn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),vn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),vn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),vn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),vn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(vn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}},vn=[new H,new H,new H,new H,new H,new H,new H,new H],en=new H,Qs=new Mi,Oi=new H,ki=new H,Bi=new H,Hn=new H,Gn=new H,ci=new H,Ms=new H,er=new H,tr=new H,hi=new H;function ya(i,e,t,n,s){for(let r=0,a=i.length-3;r<=a;r+=3){hi.fromArray(i,r);let o=s.x*Math.abs(hi.x)+s.y*Math.abs(hi.y)+s.z*Math.abs(hi.z),l=e.dot(hi),c=t.dot(hi),h=n.dot(hi);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}var td=new Mi,ws=new H,_a=new H,Ps=class{constructor(e=new H,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):td.setFromPoints(e).getCenter(n);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;ws.subVectors(e,this.center);let t=ws.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(ws,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(_a.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(ws.copy(e.center).add(_a)),this.expandByPoint(ws.copy(e.center).sub(_a))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}},yn=new H,xa=new H,nr=new H,Wn=new H,ba=new H,ir=new H,Ma=new H,Lo=class{constructor(e=new H,t=new H(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,yn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=yn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(yn.copy(this.origin).addScaledVector(this.direction,t),yn.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){xa.copy(e).add(t).multiplyScalar(.5),nr.copy(t).sub(e).normalize(),Wn.copy(this.origin).sub(xa);let r=e.distanceTo(t)*.5,a=-this.direction.dot(nr),o=Wn.dot(this.direction),l=-Wn.dot(nr),c=Wn.lengthSq(),h=Math.abs(1-a*a),u,d,m,v;if(h>0)if(u=a*l-o,d=a*o-l,v=r*h,u>=0)if(d>=-v)if(d<=v){let _=1/h;u*=_,d*=_,m=u*(u+a*d+2*o)+d*(a*u+d+2*l)+c}else d=r,u=Math.max(0,-(a*d+o)),m=-u*u+d*(d+2*l)+c;else d=-r,u=Math.max(0,-(a*d+o)),m=-u*u+d*(d+2*l)+c;else d<=-v?(u=Math.max(0,-(-a*r+o)),d=u>0?-r:Math.min(Math.max(-r,-l),r),m=-u*u+d*(d+2*l)+c):d<=v?(u=0,d=Math.min(Math.max(-r,-l),r),m=d*(d+2*l)+c):(u=Math.max(0,-(a*r+o)),d=u>0?r:Math.min(Math.max(-r,-l),r),m=-u*u+d*(d+2*l)+c);else d=a>0?-r:r,u=Math.max(0,-(a*d+o)),m=-u*u+d*(d+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),s&&s.copy(xa).addScaledVector(nr,d),m}intersectSphere(e,t){yn.subVectors(e.center,this.origin);let n=yn.dot(this.direction),s=yn.dot(yn)-n*n,r=e.radius*e.radius;if(s>r)return null;let a=Math.sqrt(r-s),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,a,o,l,c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,s=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,s=(e.min.x-d.x)*c),h>=0?(r=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(r=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||r>s||((r>n||isNaN(n))&&(n=r),(a<s||isNaN(s))&&(s=a),u>=0?(o=(e.min.z-d.z)*u,l=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,l=(e.min.z-d.z)*u),n>l||o>s)||((o>n||n!==n)&&(n=o),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,yn)!==null}intersectTriangle(e,t,n,s,r){ba.subVectors(t,e),ir.subVectors(n,e),Ma.crossVectors(ba,ir);let a=this.direction.dot(Ma),o;if(a>0){if(s)return null;o=1}else if(a<0)o=-1,a=-a;else return null;Wn.subVectors(this.origin,e);let l=o*this.direction.dot(ir.crossVectors(Wn,ir));if(l<0)return null;let c=o*this.direction.dot(ba.cross(Wn));if(c<0||l+c>a)return null;let h=-o*Wn.dot(Ma);return h<0?null:this.at(h/a,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},yt=class i{constructor(e,t,n,s,r,a,o,l,c,h,u,d,m,v,_,g){i.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c,h,u,d,m,v,_,g)}set(e,t,n,s,r,a,o,l,c,h,u,d,m,v,_,g){let f=this.elements;return f[0]=e,f[4]=t,f[8]=n,f[12]=s,f[1]=r,f[5]=a,f[9]=o,f[13]=l,f[2]=c,f[6]=h,f[10]=u,f[14]=d,f[3]=m,f[7]=v,f[11]=_,f[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,s=1/zi.setFromMatrixColumn(e,0).length(),r=1/zi.setFromMatrixColumn(e,1).length(),a=1/zi.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),u=Math.sin(r);if(e.order==="XYZ"){let d=a*h,m=a*u,v=o*h,_=o*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=m+v*c,t[5]=d-_*c,t[9]=-o*l,t[2]=_-d*c,t[6]=v+m*c,t[10]=a*l}else if(e.order==="YXZ"){let d=l*h,m=l*u,v=c*h,_=c*u;t[0]=d+_*o,t[4]=v*o-m,t[8]=a*c,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=m*o-v,t[6]=_+d*o,t[10]=a*l}else if(e.order==="ZXY"){let d=l*h,m=l*u,v=c*h,_=c*u;t[0]=d-_*o,t[4]=-a*u,t[8]=v+m*o,t[1]=m+v*o,t[5]=a*h,t[9]=_-d*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){let d=a*h,m=a*u,v=o*h,_=o*u;t[0]=l*h,t[4]=v*c-m,t[8]=d*c+_,t[1]=l*u,t[5]=_*c+d,t[9]=m*c-v,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){let d=a*l,m=a*c,v=o*l,_=o*c;t[0]=l*h,t[4]=_-d*u,t[8]=v*u+m,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-c*h,t[6]=m*u+v,t[10]=d-_*u}else if(e.order==="XZY"){let d=a*l,m=a*c,v=o*l,_=o*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=d*u+_,t[5]=a*h,t[9]=m*u-v,t[2]=v*u-m,t[6]=o*h,t[10]=_*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(nd,e,id)}lookAt(e,t,n){let s=this.elements;return Bt.subVectors(e,t),Bt.lengthSq()===0&&(Bt.z=1),Bt.normalize(),Xn.crossVectors(n,Bt),Xn.lengthSq()===0&&(Math.abs(n.z)===1?Bt.x+=1e-4:Bt.z+=1e-4,Bt.normalize(),Xn.crossVectors(n,Bt)),Xn.normalize(),sr.crossVectors(Bt,Xn),s[0]=Xn.x,s[4]=sr.x,s[8]=Bt.x,s[1]=Xn.y,s[5]=sr.y,s[9]=Bt.y,s[2]=Xn.z,s[6]=sr.z,s[10]=Bt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],u=n[5],d=n[9],m=n[13],v=n[2],_=n[6],g=n[10],f=n[14],T=n[3],E=n[7],x=n[11],U=n[15],A=s[0],C=s[4],N=s[8],w=s[12],M=s[1],R=s[5],q=s[9],B=s[13],$=s[2],G=s[6],P=s[10],W=s[14],O=s[3],Z=s[7],ie=s[11],fe=s[15];return r[0]=a*A+o*M+l*$+c*O,r[4]=a*C+o*R+l*G+c*Z,r[8]=a*N+o*q+l*P+c*ie,r[12]=a*w+o*B+l*W+c*fe,r[1]=h*A+u*M+d*$+m*O,r[5]=h*C+u*R+d*G+m*Z,r[9]=h*N+u*q+d*P+m*ie,r[13]=h*w+u*B+d*W+m*fe,r[2]=v*A+_*M+g*$+f*O,r[6]=v*C+_*R+g*G+f*Z,r[10]=v*N+_*q+g*P+f*ie,r[14]=v*w+_*B+g*W+f*fe,r[3]=T*A+E*M+x*$+U*O,r[7]=T*C+E*R+x*G+U*Z,r[11]=T*N+E*q+x*P+U*ie,r[15]=T*w+E*B+x*W+U*fe,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],a=e[1],o=e[5],l=e[9],c=e[13],h=e[2],u=e[6],d=e[10],m=e[14],v=e[3],_=e[7],g=e[11],f=e[15];return v*(+r*l*u-s*c*u-r*o*d+n*c*d+s*o*m-n*l*m)+_*(+t*l*m-t*c*d+r*a*d-s*a*m+s*c*h-r*l*h)+g*(+t*c*u-t*o*m-r*a*u+n*a*m+r*o*h-n*c*h)+f*(-s*o*h-t*l*u+t*o*d+s*a*u-n*a*d+n*l*h)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=e[9],d=e[10],m=e[11],v=e[12],_=e[13],g=e[14],f=e[15],T=u*g*c-_*d*c+_*l*m-o*g*m-u*l*f+o*d*f,E=v*d*c-h*g*c-v*l*m+a*g*m+h*l*f-a*d*f,x=h*_*c-v*u*c+v*o*m-a*_*m-h*o*f+a*u*f,U=v*u*l-h*_*l-v*o*d+a*_*d+h*o*g-a*u*g,A=t*T+n*E+s*x+r*U;if(A===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let C=1/A;return e[0]=T*C,e[1]=(_*d*r-u*g*r-_*s*m+n*g*m+u*s*f-n*d*f)*C,e[2]=(o*g*r-_*l*r+_*s*c-n*g*c-o*s*f+n*l*f)*C,e[3]=(u*l*r-o*d*r-u*s*c+n*d*c+o*s*m-n*l*m)*C,e[4]=E*C,e[5]=(h*g*r-v*d*r+v*s*m-t*g*m-h*s*f+t*d*f)*C,e[6]=(v*l*r-a*g*r-v*s*c+t*g*c+a*s*f-t*l*f)*C,e[7]=(a*d*r-h*l*r+h*s*c-t*d*c-a*s*m+t*l*m)*C,e[8]=x*C,e[9]=(v*u*r-h*_*r-v*n*m+t*_*m+h*n*f-t*u*f)*C,e[10]=(a*_*r-v*o*r+v*n*c-t*_*c-a*n*f+t*o*f)*C,e[11]=(h*o*r-a*u*r-h*n*c+t*u*c+a*n*m-t*o*m)*C,e[12]=U*C,e[13]=(h*_*s-v*u*s+v*n*d-t*_*d-h*n*g+t*u*g)*C,e[14]=(v*o*s-a*_*s-v*n*l+t*_*l+a*n*g-t*o*g)*C,e[15]=(a*u*s-h*o*s+h*n*l-t*u*l-a*n*d+t*o*d)*C,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,a=e.x,o=e.y,l=e.z,c=r*a,h=r*o;return this.set(c*a+n,c*o-s*l,c*l+s*o,0,c*o+s*l,h*o+n,h*l-s*a,0,c*l-s*o,h*l+s*a,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,a){return this.set(1,n,r,0,e,1,a,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,a=t._y,o=t._z,l=t._w,c=r+r,h=a+a,u=o+o,d=r*c,m=r*h,v=r*u,_=a*h,g=a*u,f=o*u,T=l*c,E=l*h,x=l*u,U=n.x,A=n.y,C=n.z;return s[0]=(1-(_+f))*U,s[1]=(m+x)*U,s[2]=(v-E)*U,s[3]=0,s[4]=(m-x)*A,s[5]=(1-(d+f))*A,s[6]=(g+T)*A,s[7]=0,s[8]=(v+E)*C,s[9]=(g-T)*C,s[10]=(1-(d+_))*C,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements,r=zi.set(s[0],s[1],s[2]).length(),a=zi.set(s[4],s[5],s[6]).length(),o=zi.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],tn.copy(this);let c=1/r,h=1/a,u=1/o;return tn.elements[0]*=c,tn.elements[1]*=c,tn.elements[2]*=c,tn.elements[4]*=h,tn.elements[5]*=h,tn.elements[6]*=h,tn.elements[8]*=u,tn.elements[9]*=u,tn.elements[10]*=u,t.setFromRotationMatrix(tn),n.x=r,n.y=a,n.z=o,this}makePerspective(e,t,n,s,r,a,o=En){let l=this.elements,c=2*r/(t-e),h=2*r/(n-s),u=(t+e)/(t-e),d=(n+s)/(n-s),m,v;if(o===En)m=-(a+r)/(a-r),v=-2*a*r/(a-r);else if(o===Tr)m=-a/(a-r),v=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return l[0]=c,l[4]=0,l[8]=u,l[12]=0,l[1]=0,l[5]=h,l[9]=d,l[13]=0,l[2]=0,l[6]=0,l[10]=m,l[14]=v,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,a,o=En){let l=this.elements,c=1/(t-e),h=1/(n-s),u=1/(a-r),d=(t+e)*c,m=(n+s)*h,v,_;if(o===En)v=(a+r)*u,_=-2*u;else if(o===Tr)v=r*u,_=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-d,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-m,l[2]=0,l[6]=0,l[10]=_,l[14]=-v,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},zi=new H,tn=new yt,nd=new H(0,0,0),id=new H(1,1,1),Xn=new H,sr=new H,Bt=new H,mc=new yt,gc=new Qn,In=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],a=s[4],o=s[8],l=s[1],c=s[5],h=s[9],u=s[2],d=s[6],m=s[10];switch(t){case"XYZ":this._y=Math.asin(Ut(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,m),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(d,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ut(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,m),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(Ut(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,m),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Ut(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,m),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Ut(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(o,m));break;case"XZY":this._z=Math.asin(-Ut(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,m),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return mc.makeRotationFromQuaternion(e),this.setFromRotationMatrix(mc,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return gc.setFromEuler(this),this.setFromQuaternion(gc,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};In.DEFAULT_ORDER="XYZ";var Ir=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},sd=0,vc=new H,Vi=new Qn,_n=new yt,rr=new H,Ss=new H,rd=new H,ad=new Qn,yc=new H(1,0,0),_c=new H(0,1,0),xc=new H(0,0,1),bc={type:"added"},od={type:"removed"},Hi={type:"childadded",child:null},wa={type:"childremoved",child:null},an=class i extends jn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:sd++}),this.uuid=Fs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new H,t=new In,n=new Qn,s=new H(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new yt},normalMatrix:{value:new Oe}}),this.matrix=new yt,this.matrixWorld=new yt,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ir,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Vi.setFromAxisAngle(e,t),this.quaternion.multiply(Vi),this}rotateOnWorldAxis(e,t){return Vi.setFromAxisAngle(e,t),this.quaternion.premultiply(Vi),this}rotateX(e){return this.rotateOnAxis(yc,e)}rotateY(e){return this.rotateOnAxis(_c,e)}rotateZ(e){return this.rotateOnAxis(xc,e)}translateOnAxis(e,t){return vc.copy(e).applyQuaternion(this.quaternion),this.position.add(vc.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(yc,e)}translateY(e){return this.translateOnAxis(_c,e)}translateZ(e){return this.translateOnAxis(xc,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(_n.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?rr.copy(e):rr.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),Ss.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?_n.lookAt(Ss,rr,this.up):_n.lookAt(rr,Ss,this.up),this.quaternion.setFromRotationMatrix(_n),s&&(_n.extractRotation(s.matrixWorld),Vi.setFromRotationMatrix(_n),this.quaternion.premultiply(Vi.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(bc),Hi.child=e,this.dispatchEvent(Hi),Hi.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(od),wa.child=e,this.dispatchEvent(wa),wa.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),_n.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),_n.multiply(e.parent.matrixWorld)),e.applyMatrix4(_n),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(bc),Hi.child=e,this.dispatchEvent(Hi),Hi.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ss,e,rd),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ss,ad,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(o=>({boxInitialized:o.boxInitialized,boxMin:o.box.min.toArray(),boxMax:o.box.max.toArray(),sphereInitialized:o.sphereInitialized,sphereRadius:o.sphere.radius,sphereCenter:o.sphere.center.toArray()})),s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let u=l[c];r(e.shapes,u)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(e.materials,this.material[l]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];s.animations.push(r(e.animations,l))}}if(t){let o=a(e.geometries),l=a(e.materials),c=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),m=a(e.animations),v=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),m.length>0&&(n.animations=m),v.length>0&&(n.nodes=v)}return n.object=s,n;function a(o){let l=[];for(let c in o){let h=o[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};an.DEFAULT_UP=new H(0,1,0);an.DEFAULT_MATRIX_AUTO_UPDATE=!0;an.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var nn=new H,xn=new H,Sa=new H,bn=new H,Gi=new H,Wi=new H,Mc=new H,Ea=new H,Ta=new H,Aa=new H,Ca=new ft,Ra=new ft,Ia=new ft,vi=class i{constructor(e=new H,t=new H,n=new H){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),nn.subVectors(e,t),s.cross(nn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){nn.subVectors(s,t),xn.subVectors(n,t),Sa.subVectors(e,t);let a=nn.dot(nn),o=nn.dot(xn),l=nn.dot(Sa),c=xn.dot(xn),h=xn.dot(Sa),u=a*c-o*o;if(u===0)return r.set(0,0,0),null;let d=1/u,m=(c*l-o*h)*d,v=(a*h-o*l)*d;return r.set(1-m-v,v,m)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,bn)===null?!1:bn.x>=0&&bn.y>=0&&bn.x+bn.y<=1}static getInterpolation(e,t,n,s,r,a,o,l){return this.getBarycoord(e,t,n,s,bn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,bn.x),l.addScaledVector(a,bn.y),l.addScaledVector(o,bn.z),l)}static getInterpolatedAttribute(e,t,n,s,r,a){return Ca.setScalar(0),Ra.setScalar(0),Ia.setScalar(0),Ca.fromBufferAttribute(e,t),Ra.fromBufferAttribute(e,n),Ia.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(Ca,r.x),a.addScaledVector(Ra,r.y),a.addScaledVector(Ia,r.z),a}static isFrontFacing(e,t,n,s){return nn.subVectors(n,t),xn.subVectors(e,t),nn.cross(xn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return nn.subVectors(this.c,this.b),xn.subVectors(this.a,this.b),nn.cross(xn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,a,o;Gi.subVectors(s,n),Wi.subVectors(r,n),Ea.subVectors(e,n);let l=Gi.dot(Ea),c=Wi.dot(Ea);if(l<=0&&c<=0)return t.copy(n);Ta.subVectors(e,s);let h=Gi.dot(Ta),u=Wi.dot(Ta);if(h>=0&&u<=h)return t.copy(s);let d=l*u-h*c;if(d<=0&&l>=0&&h<=0)return a=l/(l-h),t.copy(n).addScaledVector(Gi,a);Aa.subVectors(e,r);let m=Gi.dot(Aa),v=Wi.dot(Aa);if(v>=0&&m<=v)return t.copy(r);let _=m*c-l*v;if(_<=0&&c>=0&&v<=0)return o=c/(c-v),t.copy(n).addScaledVector(Wi,o);let g=h*v-m*u;if(g<=0&&u-h>=0&&m-v>=0)return Mc.subVectors(r,s),o=(u-h)/(u-h+(m-v)),t.copy(s).addScaledVector(Mc,o);let f=1/(g+_+d);return a=_*f,o=d*f,t.copy(n).addScaledVector(Gi,a).addScaledVector(Wi,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},fh={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},$n={h:0,s:0,l:0},ar={h:0,s:0,l:0};function Pa(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var Ye=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=qt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,$e.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=$e.workingColorSpace){return this.r=e,this.g=t,this.b=n,$e.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=$e.workingColorSpace){if(e=Yu(e,1),t=Ut(t,0,1),n=Ut(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=Pa(a,r,e+1/3),this.g=Pa(a,r,e),this.b=Pa(a,r,e-1/3)}return $e.toWorkingColorSpace(this,s),this}setStyle(e,t=qt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=qt){let n=fh[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Tn(e.r),this.g=Tn(e.g),this.b=Tn(e.b),this}copyLinearToSRGB(e){return this.r=Qi(e.r),this.g=Qi(e.g),this.b=Qi(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=qt){return $e.fromWorkingColorSpace(Tt.copy(this),e),Math.round(Ut(Tt.r*255,0,255))*65536+Math.round(Ut(Tt.g*255,0,255))*256+Math.round(Ut(Tt.b*255,0,255))}getHexString(e=qt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=$e.workingColorSpace){$e.fromWorkingColorSpace(Tt.copy(this),t);let n=Tt.r,s=Tt.g,r=Tt.b,a=Math.max(n,s,r),o=Math.min(n,s,r),l,c,h=(o+a)/2;if(o===a)l=0,c=0;else{let u=a-o;switch(c=h<=.5?u/(a+o):u/(2-a-o),a){case n:l=(s-r)/u+(s<r?6:0);break;case s:l=(r-n)/u+2;break;case r:l=(n-s)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=$e.workingColorSpace){return $e.fromWorkingColorSpace(Tt.copy(this),t),e.r=Tt.r,e.g=Tt.g,e.b=Tt.b,e}getStyle(e=qt){$e.fromWorkingColorSpace(Tt.copy(this),e);let t=Tt.r,n=Tt.g,s=Tt.b;return e!==qt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL($n),this.setHSL($n.h+e,$n.s+t,$n.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL($n),e.getHSL(ar);let n=pa($n.h,ar.h,t),s=pa($n.s,ar.s,t),r=pa($n.l,ar.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Tt=new Ye;Ye.NAMES=fh;var ld=0,as=class extends jn{static get type(){return"Material"}get type(){return this.constructor.type}set type(e){}constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:ld++}),this.uuid=Fs(),this.name="",this.blending=Ji,this.side=Jn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Va,this.blendDst=Ha,this.blendEquation=gi,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ye(0,0,0),this.blendAlpha=0,this.depthFunc=ts,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=rc,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Ui,this.stencilZFail=Ui,this.stencilZPass=Ui,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Ji&&(n.blending=this.blending),this.side!==Jn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Va&&(n.blendSrc=this.blendSrc),this.blendDst!==Ha&&(n.blendDst=this.blendDst),this.blendEquation!==gi&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==ts&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==rc&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Ui&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Ui&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Ui&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let a=[];for(let o in r){let l=r[o];delete l.metadata,a.push(l)}return a}if(t){let r=s(e.textures),a=s(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}},ei=class extends as{static get type(){return"MeshBasicMaterial"}constructor(e){super(),this.isMeshBasicMaterial=!0,this.color=new Ye(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new In,this.combine=Qc,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var pt=new H,or=new nt,gt=class{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=ac,this.updateRanges=[],this.gpuType=Sn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)or.fromBufferAttribute(this,t),or.applyMatrix3(e),this.setXY(t,or.x,or.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)pt.fromBufferAttribute(this,t),pt.applyMatrix3(e),this.setXYZ(t,pt.x,pt.y,pt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)pt.fromBufferAttribute(this,t),pt.applyMatrix4(e),this.setXYZ(t,pt.x,pt.y,pt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)pt.fromBufferAttribute(this,t),pt.applyNormalMatrix(e),this.setXYZ(t,pt.x,pt.y,pt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)pt.fromBufferAttribute(this,t),pt.transformDirection(e),this.setXYZ(t,pt.x,pt.y,pt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=bs(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Ft(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=bs(t,this.array)),t}setX(e,t){return this.normalized&&(t=Ft(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=bs(t,this.array)),t}setY(e,t){return this.normalized&&(t=Ft(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=bs(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Ft(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=bs(t,this.array)),t}setW(e,t){return this.normalized&&(t=Ft(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Ft(t,this.array),n=Ft(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Ft(t,this.array),n=Ft(n,this.array),s=Ft(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Ft(t,this.array),n=Ft(n,this.array),s=Ft(s,this.array),r=Ft(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==ac&&(e.usage=this.usage),e}};var Pr=class extends gt{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var Lr=class extends gt{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var An=class extends gt{constructor(e,t,n){super(new Float32Array(e),t,n)}},cd=0,$t=new yt,La=new an,Xi=new H,zt=new Mi,Es=new Mi,bt=new H,Zt=class i extends jn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:cd++}),this.uuid=Fs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(dh(e)?Lr:Pr)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new Oe().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return $t.makeRotationFromQuaternion(e),this.applyMatrix4($t),this}rotateX(e){return $t.makeRotationX(e),this.applyMatrix4($t),this}rotateY(e){return $t.makeRotationY(e),this.applyMatrix4($t),this}rotateZ(e){return $t.makeRotationZ(e),this.applyMatrix4($t),this}translate(e,t,n){return $t.makeTranslation(e,t,n),this.applyMatrix4($t),this}scale(e,t,n){return $t.makeScale(e,t,n),this.applyMatrix4($t),this}lookAt(e){return La.lookAt(e),La.updateMatrix(),this.applyMatrix4(La.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Xi).negate(),this.translate(Xi.x,Xi.y,Xi.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let a=e[s];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new An(n,3))}else{for(let n=0,s=t.count;n<s;n++){let r=e[n];t.setXYZ(n,r.x,r.y,r.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Mi);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new H(-1/0,-1/0,-1/0),new H(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];zt.setFromBufferAttribute(r),this.morphTargetsRelative?(bt.addVectors(this.boundingBox.min,zt.min),this.boundingBox.expandByPoint(bt),bt.addVectors(this.boundingBox.max,zt.max),this.boundingBox.expandByPoint(bt)):(this.boundingBox.expandByPoint(zt.min),this.boundingBox.expandByPoint(zt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ps);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new H,1/0);return}if(e){let n=this.boundingSphere.center;if(zt.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){let o=t[r];Es.setFromBufferAttribute(o),this.morphTargetsRelative?(bt.addVectors(zt.min,Es.min),zt.expandByPoint(bt),bt.addVectors(zt.max,Es.max),zt.expandByPoint(bt)):(zt.expandByPoint(Es.min),zt.expandByPoint(Es.max))}zt.getCenter(n);let s=0;for(let r=0,a=e.count;r<a;r++)bt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(bt));if(t)for(let r=0,a=t.length;r<a;r++){let o=t[r],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)bt.fromBufferAttribute(o,c),l&&(Xi.fromBufferAttribute(e,c),bt.add(Xi)),s=Math.max(s,n.distanceToSquared(bt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new gt(new Float32Array(4*n.count),4));let a=this.getAttribute("tangent"),o=[],l=[];for(let N=0;N<n.count;N++)o[N]=new H,l[N]=new H;let c=new H,h=new H,u=new H,d=new nt,m=new nt,v=new nt,_=new H,g=new H;function f(N,w,M){c.fromBufferAttribute(n,N),h.fromBufferAttribute(n,w),u.fromBufferAttribute(n,M),d.fromBufferAttribute(r,N),m.fromBufferAttribute(r,w),v.fromBufferAttribute(r,M),h.sub(c),u.sub(c),m.sub(d),v.sub(d);let R=1/(m.x*v.y-v.x*m.y);isFinite(R)&&(_.copy(h).multiplyScalar(v.y).addScaledVector(u,-m.y).multiplyScalar(R),g.copy(u).multiplyScalar(m.x).addScaledVector(h,-v.x).multiplyScalar(R),o[N].add(_),o[w].add(_),o[M].add(_),l[N].add(g),l[w].add(g),l[M].add(g))}let T=this.groups;T.length===0&&(T=[{start:0,count:e.count}]);for(let N=0,w=T.length;N<w;++N){let M=T[N],R=M.start,q=M.count;for(let B=R,$=R+q;B<$;B+=3)f(e.getX(B+0),e.getX(B+1),e.getX(B+2))}let E=new H,x=new H,U=new H,A=new H;function C(N){U.fromBufferAttribute(s,N),A.copy(U);let w=o[N];E.copy(w),E.sub(U.multiplyScalar(U.dot(w))).normalize(),x.crossVectors(A,w);let R=x.dot(l[N])<0?-1:1;a.setXYZW(N,E.x,E.y,E.z,R)}for(let N=0,w=T.length;N<w;++N){let M=T[N],R=M.start,q=M.count;for(let B=R,$=R+q;B<$;B+=3)C(e.getX(B+0)),C(e.getX(B+1)),C(e.getX(B+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new gt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,m=n.count;d<m;d++)n.setXYZ(d,0,0,0);let s=new H,r=new H,a=new H,o=new H,l=new H,c=new H,h=new H,u=new H;if(e)for(let d=0,m=e.count;d<m;d+=3){let v=e.getX(d+0),_=e.getX(d+1),g=e.getX(d+2);s.fromBufferAttribute(t,v),r.fromBufferAttribute(t,_),a.fromBufferAttribute(t,g),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),o.fromBufferAttribute(n,v),l.fromBufferAttribute(n,_),c.fromBufferAttribute(n,g),o.add(h),l.add(h),c.add(h),n.setXYZ(v,o.x,o.y,o.z),n.setXYZ(_,l.x,l.y,l.z),n.setXYZ(g,c.x,c.y,c.z)}else for(let d=0,m=t.count;d<m;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,r),u.subVectors(s,r),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)bt.fromBufferAttribute(e,t),bt.normalize(),e.setXYZ(t,bt.x,bt.y,bt.z)}toNonIndexed(){function e(o,l){let c=o.array,h=o.itemSize,u=o.normalized,d=new c.constructor(l.length*h),m=0,v=0;for(let _=0,g=l.length;_<g;_++){o.isInterleavedBufferAttribute?m=l[_]*o.data.stride+o.offset:m=l[_]*h;for(let f=0;f<h;f++)d[v++]=c[m++]}return new gt(d,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let o in s){let l=s[o],c=e(l,n);t.setAttribute(o,c)}let r=this.morphAttributes;for(let o in r){let l=[],c=r[o];for(let h=0,u=c.length;h<u;h++){let d=c[h],m=e(d,n);l.push(m)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let u=0,d=c.length;u<d;u++){let m=c[u];h.push(m.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere={center:o.center.toArray(),radius:o.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone(t));let s=e.attributes;for(let c in s){let h=s[c];this.setAttribute(c,h.clone(t))}let r=e.morphAttributes;for(let c in r){let h=[],u=r[c];for(let d=0,m=u.length;d<m;d++)h.push(u[d].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let c=0,h=a.length;c<h;c++){let u=a[c];this.addGroup(u.start,u.count,u.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},wc=new yt,ui=new Lo,lr=new Ps,Sc=new H,cr=new H,hr=new H,ur=new H,Da=new H,dr=new H,Ec=new H,fr=new H,mt=class extends an{constructor(e=new Zt,t=new ei){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let o=this.morphTargetInfluences;if(r&&o){dr.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let h=o[l],u=r[l];h!==0&&(Da.fromBufferAttribute(u,e),a?dr.addScaledVector(Da,h):dr.addScaledVector(Da.sub(t),h))}t.add(dr)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),lr.copy(n.boundingSphere),lr.applyMatrix4(r),ui.copy(e.ray).recast(e.near),!(lr.containsPoint(ui.origin)===!1&&(ui.intersectSphere(lr,Sc)===null||ui.origin.distanceToSquared(Sc)>(e.far-e.near)**2))&&(wc.copy(r).invert(),ui.copy(e.ray).applyMatrix4(wc),!(n.boundingBox!==null&&ui.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,ui)))}_computeIntersections(e,t,n){let s,r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,d=r.groups,m=r.drawRange;if(o!==null)if(Array.isArray(a))for(let v=0,_=d.length;v<_;v++){let g=d[v],f=a[g.materialIndex],T=Math.max(g.start,m.start),E=Math.min(o.count,Math.min(g.start+g.count,m.start+m.count));for(let x=T,U=E;x<U;x+=3){let A=o.getX(x),C=o.getX(x+1),N=o.getX(x+2);s=pr(this,f,e,n,c,h,u,A,C,N),s&&(s.faceIndex=Math.floor(x/3),s.face.materialIndex=g.materialIndex,t.push(s))}}else{let v=Math.max(0,m.start),_=Math.min(o.count,m.start+m.count);for(let g=v,f=_;g<f;g+=3){let T=o.getX(g),E=o.getX(g+1),x=o.getX(g+2);s=pr(this,a,e,n,c,h,u,T,E,x),s&&(s.faceIndex=Math.floor(g/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(a))for(let v=0,_=d.length;v<_;v++){let g=d[v],f=a[g.materialIndex],T=Math.max(g.start,m.start),E=Math.min(l.count,Math.min(g.start+g.count,m.start+m.count));for(let x=T,U=E;x<U;x+=3){let A=x,C=x+1,N=x+2;s=pr(this,f,e,n,c,h,u,A,C,N),s&&(s.faceIndex=Math.floor(x/3),s.face.materialIndex=g.materialIndex,t.push(s))}}else{let v=Math.max(0,m.start),_=Math.min(l.count,m.start+m.count);for(let g=v,f=_;g<f;g+=3){let T=g,E=g+1,x=g+2;s=pr(this,a,e,n,c,h,u,T,E,x),s&&(s.faceIndex=Math.floor(g/3),t.push(s))}}}};function hd(i,e,t,n,s,r,a,o){let l;if(e.side===Nt?l=n.intersectTriangle(a,r,s,!0,o):l=n.intersectTriangle(s,r,a,e.side===Jn,o),l===null)return null;fr.copy(o),fr.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(fr);return c<t.near||c>t.far?null:{distance:c,point:fr.clone(),object:i}}function pr(i,e,t,n,s,r,a,o,l,c){i.getVertexPosition(o,cr),i.getVertexPosition(l,hr),i.getVertexPosition(c,ur);let h=hd(i,e,t,n,cr,hr,ur,Ec);if(h){let u=new H;vi.getBarycoord(Ec,cr,hr,ur,u),s&&(h.uv=vi.getInterpolatedAttribute(s,o,l,c,u,new nt)),r&&(h.uv1=vi.getInterpolatedAttribute(r,o,l,c,u,new nt)),a&&(h.normal=vi.getInterpolatedAttribute(a,o,l,c,u,new H),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let d={a:o,b:l,c,normal:new H,materialIndex:0};vi.getNormal(cr,hr,ur,d.normal),h.face=d,h.barycoord=u}return h}var Ls=class i extends Zt{constructor(e=1,t=1,n=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:a};let o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);let l=[],c=[],h=[],u=[],d=0,m=0;v("z","y","x",-1,-1,n,t,e,a,r,0),v("z","y","x",1,-1,n,t,-e,a,r,1),v("x","z","y",1,1,e,n,t,s,a,2),v("x","z","y",1,-1,e,n,-t,s,a,3),v("x","y","z",1,-1,e,t,n,s,r,4),v("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new An(c,3)),this.setAttribute("normal",new An(h,3)),this.setAttribute("uv",new An(u,2));function v(_,g,f,T,E,x,U,A,C,N,w){let M=x/C,R=U/N,q=x/2,B=U/2,$=A/2,G=C+1,P=N+1,W=0,O=0,Z=new H;for(let ie=0;ie<P;ie++){let fe=ie*R-B;for(let Ce=0;Ce<G;Ce++){let Fe=Ce*M-q;Z[_]=Fe*T,Z[g]=fe*E,Z[f]=$,c.push(Z.x,Z.y,Z.z),Z[_]=0,Z[g]=0,Z[f]=A>0?1:-1,h.push(Z.x,Z.y,Z.z),u.push(Ce/C),u.push(1-ie/N),W+=1}}for(let ie=0;ie<N;ie++)for(let fe=0;fe<C;fe++){let Ce=d+fe+G*ie,Fe=d+fe+G*(ie+1),Y=d+(fe+1)+G*(ie+1),ne=d+(fe+1)+G*ie;l.push(Ce,Fe,ne),l.push(Fe,Y,ne),O+=6}o.addGroup(m,O,w),m+=O,d+=W}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function os(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function Rt(i){let e={};for(let t=0;t<i.length;t++){let n=os(i[t]);for(let s in n)e[s]=n[s]}return e}function ud(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function ph(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:$e.workingColorSpace}var dd={clone:os,merge:Rt},fd=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,pd=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,At=class extends as{static get type(){return"ShaderMaterial"}constructor(e){super(),this.isShaderMaterial=!0,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=fd,this.fragmentShader=pd,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=os(e.uniforms),this.uniformsGroups=ud(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let a=this.uniforms[s].value;a&&a.isTexture?t.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[s]={type:"m4",value:a.toArray()}:t.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},Dr=class extends an{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new yt,this.projectionMatrix=new yt,this.projectionMatrixInverse=new yt,this.coordinateSystem=En}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},qn=new H,Tc=new nt,Ac=new nt,It=class extends Dr{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Co*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(fa*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Co*2*Math.atan(Math.tan(fa*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){qn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(qn.x,qn.y).multiplyScalar(-e/qn.z),qn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(qn.x,qn.y).multiplyScalar(-e/qn.z)}getViewSize(e,t){return this.getViewBounds(e,Tc,Ac),t.subVectors(Ac,Tc)}setViewOffset(e,t,n,s,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(fa*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*s/l,t-=a.offsetY*n/c,s*=a.width/l,n*=a.height/c}let o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},$i=-90,qi=1,Do=class extends an{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new It($i,qi,e,t);s.layers=this.layers,this.add(s);let r=new It($i,qi,e,t);r.layers=this.layers,this.add(r);let a=new It($i,qi,e,t);a.layers=this.layers,this.add(a);let o=new It($i,qi,e,t);o.layers=this.layers,this.add(o);let l=new It($i,qi,e,t);l.layers=this.layers,this.add(l);let c=new It($i,qi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,a,o,l]=t;for(let c of t)this.remove(c);if(e===En)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Tr)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,o,l,c,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),m=e.getActiveMipmapLevel(),v=e.xr.enabled;e.xr.enabled=!1;let _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,a),e.setRenderTarget(n,2,s),e.render(t,o),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,s),e.render(t,h),e.setRenderTarget(u,d,m),e.xr.enabled=v,n.texture.needsPMREMUpdate=!0}},Fr=class extends Yt{constructor(e,t,n,s,r,a,o,l,c,h){e=e!==void 0?e:[],t=t!==void 0?t:ns,super(e,t,n,s,r,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Fo=class extends Rn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new Fr(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:fn}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new Ls(5,5,5),r=new At({name:"CubemapFromEquirect",uniforms:os(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Nt,blending:Zn});r.uniforms.tEquirect.value=t;let a=new mt(s,r),o=t.minFilter;return t.minFilter===xi&&(t.minFilter=fn),new Do(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t,n,s){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,s);e.setRenderTarget(r)}},Fa=new H,md=new H,gd=new Oe,wn=class{constructor(e=new H(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=Fa.subVectors(n,t).cross(md.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta(Fa),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||gd.getNormalMatrix(e),s=this.coplanarPoint(Fa).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},di=new Ps,mr=new H,Ur=class{constructor(e=new wn,t=new wn,n=new wn,s=new wn,r=new wn,a=new wn){this.planes=[e,t,n,s,r,a]}set(e,t,n,s,r,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=En){let n=this.planes,s=e.elements,r=s[0],a=s[1],o=s[2],l=s[3],c=s[4],h=s[5],u=s[6],d=s[7],m=s[8],v=s[9],_=s[10],g=s[11],f=s[12],T=s[13],E=s[14],x=s[15];if(n[0].setComponents(l-r,d-c,g-m,x-f).normalize(),n[1].setComponents(l+r,d+c,g+m,x+f).normalize(),n[2].setComponents(l+a,d+h,g+v,x+T).normalize(),n[3].setComponents(l-a,d-h,g-v,x-T).normalize(),n[4].setComponents(l-o,d-u,g-_,x-E).normalize(),t===En)n[5].setComponents(l+o,d+u,g+_,x+E).normalize();else if(t===Tr)n[5].setComponents(o,u,_,E).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),di.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),di.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(di)}intersectsSprite(e){return di.center.set(0,0,0),di.radius=.7071067811865476,di.applyMatrix4(e.matrixWorld),this.intersectsSphere(di)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(mr.x=s.normal.x>0?e.max.x:e.min.x,mr.y=s.normal.y>0?e.max.y:e.min.y,mr.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(mr)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};function mh(){let i=null,e=!1,t=null,n=null;function s(r,a){t(r,a),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function vd(i){let e=new WeakMap;function t(o,l){let c=o.array,h=o.usage,u=c.byteLength,d=i.createBuffer();i.bindBuffer(l,d),i.bufferData(l,c,h),o.onUploadCallback();let m;if(c instanceof Float32Array)m=i.FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?m=i.HALF_FLOAT:m=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)m=i.SHORT;else if(c instanceof Uint32Array)m=i.UNSIGNED_INT;else if(c instanceof Int32Array)m=i.INT;else if(c instanceof Int8Array)m=i.BYTE;else if(c instanceof Uint8Array)m=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)m=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:d,type:m,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,l,c){let h=l.array,u=l.updateRanges;if(i.bindBuffer(c,o),u.length===0)i.bufferSubData(c,0,h);else{u.sort((m,v)=>m.start-v.start);let d=0;for(let m=1;m<u.length;m++){let v=u[d],_=u[m];_.start<=v.start+v.count+1?v.count=Math.max(v.count,_.start+_.count-v.start):(++d,u[d]=_)}u.length=d+1;for(let m=0,v=u.length;m<v;m++){let _=u[m];i.bufferSubData(c,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=e.get(o);l&&(i.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:s,remove:r,update:a}}var Nr=class i extends Zt{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,a=t/2,o=Math.floor(n),l=Math.floor(s),c=o+1,h=l+1,u=e/o,d=t/l,m=[],v=[],_=[],g=[];for(let f=0;f<h;f++){let T=f*d-a;for(let E=0;E<c;E++){let x=E*u-r;v.push(x,-T,0),_.push(0,0,1),g.push(E/o),g.push(1-f/l)}}for(let f=0;f<l;f++)for(let T=0;T<o;T++){let E=T+c*f,x=T+c*(f+1),U=T+1+c*(f+1),A=T+1+c*f;m.push(E,x,A),m.push(x,U,A)}this.setIndex(m),this.setAttribute("position",new An(v,3)),this.setAttribute("normal",new An(_,3)),this.setAttribute("uv",new An(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}},yd=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,_d=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,xd=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,bd=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Md=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,wd=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Sd=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Ed=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Td=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Ad=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Cd=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Rd=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Id=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Pd=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Ld=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Dd=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Fd=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Ud=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Nd=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Od=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,kd=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Bd=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,zd=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Vd=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Hd=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Gd=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Wd=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Xd=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,$d=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,qd=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Yd="gl_FragColor = linearToOutputTexel( gl_FragColor );",Zd=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Kd=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Jd=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,jd=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Qd=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,ef=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,tf=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,nf=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,sf=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,rf=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,af=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,of=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lf=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,cf=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,hf=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,uf=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,df=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,ff=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,pf=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,mf=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,gf=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,vf=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,yf=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,_f=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,xf=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,bf=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Mf=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,wf=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Sf=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Ef=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Tf=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Af=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Cf=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Rf=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,If=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Pf=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Lf=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Df=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Ff=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Uf=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Nf=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Of=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,kf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Bf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,zf=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Vf=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Hf=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Gf=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Wf=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Xf=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,$f=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,qf=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,Yf=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Zf=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Kf=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Jf=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,jf=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Qf=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,ep=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,tp=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,np=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,ip=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,sp=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,rp=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,ap=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,op=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,lp=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,cp=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,hp=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,up=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,dp=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,fp=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,pp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,mp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,gp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,vp=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,yp=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,_p=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,xp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,bp=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Mp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,wp=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Sp=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Ep=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Tp=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Ap=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Cp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Rp=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Ip=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Pp=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Lp=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Dp=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Fp=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Up=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Np=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Op=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,kp=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Bp=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,zp=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Vp=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Hp=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Gp=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Wp=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Xp=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,$p=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,qp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Yp=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Zp=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Kp=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Jp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Be={alphahash_fragment:yd,alphahash_pars_fragment:_d,alphamap_fragment:xd,alphamap_pars_fragment:bd,alphatest_fragment:Md,alphatest_pars_fragment:wd,aomap_fragment:Sd,aomap_pars_fragment:Ed,batching_pars_vertex:Td,batching_vertex:Ad,begin_vertex:Cd,beginnormal_vertex:Rd,bsdfs:Id,iridescence_fragment:Pd,bumpmap_pars_fragment:Ld,clipping_planes_fragment:Dd,clipping_planes_pars_fragment:Fd,clipping_planes_pars_vertex:Ud,clipping_planes_vertex:Nd,color_fragment:Od,color_pars_fragment:kd,color_pars_vertex:Bd,color_vertex:zd,common:Vd,cube_uv_reflection_fragment:Hd,defaultnormal_vertex:Gd,displacementmap_pars_vertex:Wd,displacementmap_vertex:Xd,emissivemap_fragment:$d,emissivemap_pars_fragment:qd,colorspace_fragment:Yd,colorspace_pars_fragment:Zd,envmap_fragment:Kd,envmap_common_pars_fragment:Jd,envmap_pars_fragment:jd,envmap_pars_vertex:Qd,envmap_physical_pars_fragment:uf,envmap_vertex:ef,fog_vertex:tf,fog_pars_vertex:nf,fog_fragment:sf,fog_pars_fragment:rf,gradientmap_pars_fragment:af,lightmap_pars_fragment:of,lights_lambert_fragment:lf,lights_lambert_pars_fragment:cf,lights_pars_begin:hf,lights_toon_fragment:df,lights_toon_pars_fragment:ff,lights_phong_fragment:pf,lights_phong_pars_fragment:mf,lights_physical_fragment:gf,lights_physical_pars_fragment:vf,lights_fragment_begin:yf,lights_fragment_maps:_f,lights_fragment_end:xf,logdepthbuf_fragment:bf,logdepthbuf_pars_fragment:Mf,logdepthbuf_pars_vertex:wf,logdepthbuf_vertex:Sf,map_fragment:Ef,map_pars_fragment:Tf,map_particle_fragment:Af,map_particle_pars_fragment:Cf,metalnessmap_fragment:Rf,metalnessmap_pars_fragment:If,morphinstance_vertex:Pf,morphcolor_vertex:Lf,morphnormal_vertex:Df,morphtarget_pars_vertex:Ff,morphtarget_vertex:Uf,normal_fragment_begin:Nf,normal_fragment_maps:Of,normal_pars_fragment:kf,normal_pars_vertex:Bf,normal_vertex:zf,normalmap_pars_fragment:Vf,clearcoat_normal_fragment_begin:Hf,clearcoat_normal_fragment_maps:Gf,clearcoat_pars_fragment:Wf,iridescence_pars_fragment:Xf,opaque_fragment:$f,packing:qf,premultiplied_alpha_fragment:Yf,project_vertex:Zf,dithering_fragment:Kf,dithering_pars_fragment:Jf,roughnessmap_fragment:jf,roughnessmap_pars_fragment:Qf,shadowmap_pars_fragment:ep,shadowmap_pars_vertex:tp,shadowmap_vertex:np,shadowmask_pars_fragment:ip,skinbase_vertex:sp,skinning_pars_vertex:rp,skinning_vertex:ap,skinnormal_vertex:op,specularmap_fragment:lp,specularmap_pars_fragment:cp,tonemapping_fragment:hp,tonemapping_pars_fragment:up,transmission_fragment:dp,transmission_pars_fragment:fp,uv_pars_fragment:pp,uv_pars_vertex:mp,uv_vertex:gp,worldpos_vertex:vp,background_vert:yp,background_frag:_p,backgroundCube_vert:xp,backgroundCube_frag:bp,cube_vert:Mp,cube_frag:wp,depth_vert:Sp,depth_frag:Ep,distanceRGBA_vert:Tp,distanceRGBA_frag:Ap,equirect_vert:Cp,equirect_frag:Rp,linedashed_vert:Ip,linedashed_frag:Pp,meshbasic_vert:Lp,meshbasic_frag:Dp,meshlambert_vert:Fp,meshlambert_frag:Up,meshmatcap_vert:Np,meshmatcap_frag:Op,meshnormal_vert:kp,meshnormal_frag:Bp,meshphong_vert:zp,meshphong_frag:Vp,meshphysical_vert:Hp,meshphysical_frag:Gp,meshtoon_vert:Wp,meshtoon_frag:Xp,points_vert:$p,points_frag:qp,shadow_vert:Yp,shadow_frag:Zp,sprite_vert:Kp,sprite_frag:Jp},re={common:{diffuse:{value:new Ye(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Oe},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Oe}},envmap:{envMap:{value:null},envMapRotation:{value:new Oe},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Oe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Oe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Oe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Oe},normalScale:{value:new nt(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Oe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Oe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Oe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Oe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ye(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ye(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0},uvTransform:{value:new Oe}},sprite:{diffuse:{value:new Ye(16777215)},opacity:{value:1},center:{value:new nt(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Oe},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0}}},dn={basic:{uniforms:Rt([re.common,re.specularmap,re.envmap,re.aomap,re.lightmap,re.fog]),vertexShader:Be.meshbasic_vert,fragmentShader:Be.meshbasic_frag},lambert:{uniforms:Rt([re.common,re.specularmap,re.envmap,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.fog,re.lights,{emissive:{value:new Ye(0)}}]),vertexShader:Be.meshlambert_vert,fragmentShader:Be.meshlambert_frag},phong:{uniforms:Rt([re.common,re.specularmap,re.envmap,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.fog,re.lights,{emissive:{value:new Ye(0)},specular:{value:new Ye(1118481)},shininess:{value:30}}]),vertexShader:Be.meshphong_vert,fragmentShader:Be.meshphong_frag},standard:{uniforms:Rt([re.common,re.envmap,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.roughnessmap,re.metalnessmap,re.fog,re.lights,{emissive:{value:new Ye(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Be.meshphysical_vert,fragmentShader:Be.meshphysical_frag},toon:{uniforms:Rt([re.common,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.gradientmap,re.fog,re.lights,{emissive:{value:new Ye(0)}}]),vertexShader:Be.meshtoon_vert,fragmentShader:Be.meshtoon_frag},matcap:{uniforms:Rt([re.common,re.bumpmap,re.normalmap,re.displacementmap,re.fog,{matcap:{value:null}}]),vertexShader:Be.meshmatcap_vert,fragmentShader:Be.meshmatcap_frag},points:{uniforms:Rt([re.points,re.fog]),vertexShader:Be.points_vert,fragmentShader:Be.points_frag},dashed:{uniforms:Rt([re.common,re.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Be.linedashed_vert,fragmentShader:Be.linedashed_frag},depth:{uniforms:Rt([re.common,re.displacementmap]),vertexShader:Be.depth_vert,fragmentShader:Be.depth_frag},normal:{uniforms:Rt([re.common,re.bumpmap,re.normalmap,re.displacementmap,{opacity:{value:1}}]),vertexShader:Be.meshnormal_vert,fragmentShader:Be.meshnormal_frag},sprite:{uniforms:Rt([re.sprite,re.fog]),vertexShader:Be.sprite_vert,fragmentShader:Be.sprite_frag},background:{uniforms:{uvTransform:{value:new Oe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Be.background_vert,fragmentShader:Be.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Oe}},vertexShader:Be.backgroundCube_vert,fragmentShader:Be.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Be.cube_vert,fragmentShader:Be.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Be.equirect_vert,fragmentShader:Be.equirect_frag},distanceRGBA:{uniforms:Rt([re.common,re.displacementmap,{referencePosition:{value:new H},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Be.distanceRGBA_vert,fragmentShader:Be.distanceRGBA_frag},shadow:{uniforms:Rt([re.lights,re.fog,{color:{value:new Ye(0)},opacity:{value:1}}]),vertexShader:Be.shadow_vert,fragmentShader:Be.shadow_frag}};dn.physical={uniforms:Rt([dn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Oe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Oe},clearcoatNormalScale:{value:new nt(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Oe},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Oe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Oe},sheen:{value:0},sheenColor:{value:new Ye(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Oe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Oe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Oe},transmissionSamplerSize:{value:new nt},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Oe},attenuationDistance:{value:0},attenuationColor:{value:new Ye(0)},specularColor:{value:new Ye(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Oe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Oe},anisotropyVector:{value:new nt},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Oe}}]),vertexShader:Be.meshphysical_vert,fragmentShader:Be.meshphysical_frag};var gr={r:0,b:0,g:0},fi=new In,jp=new yt;function Qp(i,e,t,n,s,r,a){let o=new Ye(0),l=r===!0?0:1,c,h,u=null,d=0,m=null;function v(T){let E=T.isScene===!0?T.background:null;return E&&E.isTexture&&(E=(T.backgroundBlurriness>0?t:e).get(E)),E}function _(T){let E=!1,x=v(T);x===null?f(o,l):x&&x.isColor&&(f(x,1),E=!0);let U=i.xr.getEnvironmentBlendMode();U==="additive"?n.buffers.color.setClear(0,0,0,1,a):U==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,a),(i.autoClear||E)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function g(T,E){let x=v(E);x&&(x.isCubeTexture||x.mapping===Hr)?(h===void 0&&(h=new mt(new Ls(1,1,1),new At({name:"BackgroundCubeMaterial",uniforms:os(dn.backgroundCube.uniforms),vertexShader:dn.backgroundCube.vertexShader,fragmentShader:dn.backgroundCube.fragmentShader,side:Nt,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(U,A,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),fi.copy(E.backgroundRotation),fi.x*=-1,fi.y*=-1,fi.z*=-1,x.isCubeTexture&&x.isRenderTargetTexture===!1&&(fi.y*=-1,fi.z*=-1),h.material.uniforms.envMap.value=x,h.material.uniforms.flipEnvMap.value=x.isCubeTexture&&x.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=E.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(jp.makeRotationFromEuler(fi)),h.material.toneMapped=$e.getTransfer(x.colorSpace)!==tt,(u!==x||d!==x.version||m!==i.toneMapping)&&(h.material.needsUpdate=!0,u=x,d=x.version,m=i.toneMapping),h.layers.enableAll(),T.unshift(h,h.geometry,h.material,0,0,null)):x&&x.isTexture&&(c===void 0&&(c=new mt(new Nr(2,2),new At({name:"BackgroundMaterial",uniforms:os(dn.background.uniforms),vertexShader:dn.background.vertexShader,fragmentShader:dn.background.fragmentShader,side:Jn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=x,c.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,c.material.toneMapped=$e.getTransfer(x.colorSpace)!==tt,x.matrixAutoUpdate===!0&&x.updateMatrix(),c.material.uniforms.uvTransform.value.copy(x.matrix),(u!==x||d!==x.version||m!==i.toneMapping)&&(c.material.needsUpdate=!0,u=x,d=x.version,m=i.toneMapping),c.layers.enableAll(),T.unshift(c,c.geometry,c.material,0,0,null))}function f(T,E){T.getRGB(gr,ph(i)),n.buffers.color.setClear(gr.r,gr.g,gr.b,E,a)}return{getClearColor:function(){return o},setClearColor:function(T,E=1){o.set(T),l=E,f(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(T){l=T,f(o,l)},render:_,addToRenderList:g}}function em(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=d(null),r=s,a=!1;function o(M,R,q,B,$){let G=!1,P=u(B,q,R);r!==P&&(r=P,c(r.object)),G=m(M,B,q,$),G&&v(M,B,q,$),$!==null&&e.update($,i.ELEMENT_ARRAY_BUFFER),(G||a)&&(a=!1,x(M,R,q,B),$!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get($).buffer))}function l(){return i.createVertexArray()}function c(M){return i.bindVertexArray(M)}function h(M){return i.deleteVertexArray(M)}function u(M,R,q){let B=q.wireframe===!0,$=n[M.id];$===void 0&&($={},n[M.id]=$);let G=$[R.id];G===void 0&&(G={},$[R.id]=G);let P=G[B];return P===void 0&&(P=d(l()),G[B]=P),P}function d(M){let R=[],q=[],B=[];for(let $=0;$<t;$++)R[$]=0,q[$]=0,B[$]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:R,enabledAttributes:q,attributeDivisors:B,object:M,attributes:{},index:null}}function m(M,R,q,B){let $=r.attributes,G=R.attributes,P=0,W=q.getAttributes();for(let O in W)if(W[O].location>=0){let ie=$[O],fe=G[O];if(fe===void 0&&(O==="instanceMatrix"&&M.instanceMatrix&&(fe=M.instanceMatrix),O==="instanceColor"&&M.instanceColor&&(fe=M.instanceColor)),ie===void 0||ie.attribute!==fe||fe&&ie.data!==fe.data)return!0;P++}return r.attributesNum!==P||r.index!==B}function v(M,R,q,B){let $={},G=R.attributes,P=0,W=q.getAttributes();for(let O in W)if(W[O].location>=0){let ie=G[O];ie===void 0&&(O==="instanceMatrix"&&M.instanceMatrix&&(ie=M.instanceMatrix),O==="instanceColor"&&M.instanceColor&&(ie=M.instanceColor));let fe={};fe.attribute=ie,ie&&ie.data&&(fe.data=ie.data),$[O]=fe,P++}r.attributes=$,r.attributesNum=P,r.index=B}function _(){let M=r.newAttributes;for(let R=0,q=M.length;R<q;R++)M[R]=0}function g(M){f(M,0)}function f(M,R){let q=r.newAttributes,B=r.enabledAttributes,$=r.attributeDivisors;q[M]=1,B[M]===0&&(i.enableVertexAttribArray(M),B[M]=1),$[M]!==R&&(i.vertexAttribDivisor(M,R),$[M]=R)}function T(){let M=r.newAttributes,R=r.enabledAttributes;for(let q=0,B=R.length;q<B;q++)R[q]!==M[q]&&(i.disableVertexAttribArray(q),R[q]=0)}function E(M,R,q,B,$,G,P){P===!0?i.vertexAttribIPointer(M,R,q,$,G):i.vertexAttribPointer(M,R,q,B,$,G)}function x(M,R,q,B){_();let $=B.attributes,G=q.getAttributes(),P=R.defaultAttributeValues;for(let W in G){let O=G[W];if(O.location>=0){let Z=$[W];if(Z===void 0&&(W==="instanceMatrix"&&M.instanceMatrix&&(Z=M.instanceMatrix),W==="instanceColor"&&M.instanceColor&&(Z=M.instanceColor)),Z!==void 0){let ie=Z.normalized,fe=Z.itemSize,Ce=e.get(Z);if(Ce===void 0)continue;let Fe=Ce.buffer,Y=Ce.type,ne=Ce.bytesPerElement,xe=Y===i.INT||Y===i.UNSIGNED_INT||Z.gpuType===sl;if(Z.isInterleavedBufferAttribute){let le=Z.data,Ie=le.stride,De=Z.offset;if(le.isInstancedInterleavedBuffer){for(let ze=0;ze<O.locationSize;ze++)f(O.location+ze,le.meshPerAttribute);M.isInstancedMesh!==!0&&B._maxInstanceCount===void 0&&(B._maxInstanceCount=le.meshPerAttribute*le.count)}else for(let ze=0;ze<O.locationSize;ze++)g(O.location+ze);i.bindBuffer(i.ARRAY_BUFFER,Fe);for(let ze=0;ze<O.locationSize;ze++)E(O.location+ze,fe/O.locationSize,Y,ie,Ie*ne,(De+fe/O.locationSize*ze)*ne,xe)}else{if(Z.isInstancedBufferAttribute){for(let le=0;le<O.locationSize;le++)f(O.location+le,Z.meshPerAttribute);M.isInstancedMesh!==!0&&B._maxInstanceCount===void 0&&(B._maxInstanceCount=Z.meshPerAttribute*Z.count)}else for(let le=0;le<O.locationSize;le++)g(O.location+le);i.bindBuffer(i.ARRAY_BUFFER,Fe);for(let le=0;le<O.locationSize;le++)E(O.location+le,fe/O.locationSize,Y,ie,fe*ne,fe/O.locationSize*le*ne,xe)}}else if(P!==void 0){let ie=P[W];if(ie!==void 0)switch(ie.length){case 2:i.vertexAttrib2fv(O.location,ie);break;case 3:i.vertexAttrib3fv(O.location,ie);break;case 4:i.vertexAttrib4fv(O.location,ie);break;default:i.vertexAttrib1fv(O.location,ie)}}}}T()}function U(){N();for(let M in n){let R=n[M];for(let q in R){let B=R[q];for(let $ in B)h(B[$].object),delete B[$];delete R[q]}delete n[M]}}function A(M){if(n[M.id]===void 0)return;let R=n[M.id];for(let q in R){let B=R[q];for(let $ in B)h(B[$].object),delete B[$];delete R[q]}delete n[M.id]}function C(M){for(let R in n){let q=n[R];if(q[M.id]===void 0)continue;let B=q[M.id];for(let $ in B)h(B[$].object),delete B[$];delete q[M.id]}}function N(){w(),a=!0,r!==s&&(r=s,c(r.object))}function w(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:N,resetDefaultState:w,dispose:U,releaseStatesOfGeometry:A,releaseStatesOfProgram:C,initAttributes:_,enableAttribute:g,disableUnusedAttributes:T}}function tm(i,e,t){let n;function s(c){n=c}function r(c,h){i.drawArrays(n,c,h),t.update(h,n,1)}function a(c,h,u){u!==0&&(i.drawArraysInstanced(n,c,h,u),t.update(h,n,u))}function o(c,h,u){if(u===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,u);let m=0;for(let v=0;v<u;v++)m+=h[v];t.update(m,n,1)}function l(c,h,u,d){if(u===0)return;let m=e.get("WEBGL_multi_draw");if(m===null)for(let v=0;v<c.length;v++)a(c[v],h[v],d[v]);else{m.multiDrawArraysInstancedWEBGL(n,c,0,h,0,d,0,u);let v=0;for(let _=0;_<u;_++)v+=h[_]*d[_];t.update(v,n,1)}}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function nm(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(C){return!(C!==sn&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(C){let N=C===Ds&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==Cn&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==Sn&&!N)}function l(C){if(C==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp",h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let u=t.logarithmicDepthBuffer===!0,d=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control"),m=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),v=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=i.getParameter(i.MAX_TEXTURE_SIZE),g=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),f=i.getParameter(i.MAX_VERTEX_ATTRIBS),T=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),E=i.getParameter(i.MAX_VARYING_VECTORS),x=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),U=v>0,A=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:u,reverseDepthBuffer:d,maxTextures:m,maxVertexTextures:v,maxTextureSize:_,maxCubemapSize:g,maxAttributes:f,maxVertexUniforms:T,maxVaryings:E,maxFragmentUniforms:x,vertexTextures:U,maxSamples:A}}function im(i){let e=this,t=null,n=0,s=!1,r=!1,a=new wn,o=new Oe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){let m=u.length!==0||d||n!==0||s;return s=d,n=u.length,m},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,m){let v=u.clippingPlanes,_=u.clipIntersection,g=u.clipShadows,f=i.get(u);if(!s||v===null||v.length===0||r&&!g)r?h(null):c();else{let T=r?0:n,E=T*4,x=f.clippingState||null;l.value=x,x=h(v,d,E,m);for(let U=0;U!==E;++U)x[U]=t[U];f.clippingState=x,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=T}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,m,v){let _=u!==null?u.length:0,g=null;if(_!==0){if(g=l.value,v!==!0||g===null){let f=m+_*4,T=d.matrixWorldInverse;o.getNormalMatrix(T),(g===null||g.length<f)&&(g=new Float32Array(f));for(let E=0,x=m;E!==_;++E,x+=4)a.copy(u[E]).applyMatrix4(T,o),a.normal.toArray(g,x),g[x+3]=a.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,g}}function sm(i){let e=new WeakMap;function t(a,o){return o===Ka?a.mapping=ns:o===Ja&&(a.mapping=is),a}function n(a){if(a&&a.isTexture){let o=a.mapping;if(o===Ka||o===Ja)if(e.has(a)){let l=e.get(a).texture;return t(l,a.mapping)}else{let l=a.image;if(l&&l.height>0){let c=new Fo(l.height);return c.fromEquirectangularTexture(i,a),e.set(a,c),a.addEventListener("dispose",s),t(c.texture,a.mapping)}else return null}}return a}function s(a){let o=a.target;o.removeEventListener("dispose",s);let l=e.get(o);l!==void 0&&(e.delete(o),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}var Uo=class extends Dr{constructor(e=-1,t=1,n=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,a=n+e,o=s+t,l=s-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Zi=4,Cc=[.125,.215,.35,.446,.526,.582],yi=20,Ua=new Uo,Rc=new Ye,Na=null,Oa=0,ka=0,Ba=!1,mi=(1+Math.sqrt(5))/2,Yi=1/mi,Ic=[new H(-mi,Yi,0),new H(mi,Yi,0),new H(-Yi,0,mi),new H(Yi,0,mi),new H(0,mi,-Yi),new H(0,mi,Yi),new H(-1,1,-1),new H(1,1,-1),new H(-1,1,1),new H(1,1,1)],Or=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){Na=this._renderer.getRenderTarget(),Oa=this._renderer.getActiveCubeFace(),ka=this._renderer.getActiveMipmapLevel(),Ba=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);let r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Dc(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Lc(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Na,Oa,ka),this._renderer.xr.enabled=Ba,e.scissorTest=!1,vr(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===ns||e.mapping===is?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Na=this._renderer.getRenderTarget(),Oa=this._renderer.getActiveCubeFace(),ka=this._renderer.getActiveMipmapLevel(),Ba=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:fn,minFilter:fn,generateMipmaps:!1,type:Ds,format:sn,colorSpace:ti,depthBuffer:!1},s=Pc(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Pc(e,t,n);let{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=rm(r)),this._blurMaterial=am(r,e,t)}return s}_compileMaterial(e){let t=new mt(this._lodPlanes[0],e);this._renderer.compile(t,Ua)}_sceneToCubeUV(e,t,n,s){let o=new It(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,u=h.autoClear,d=h.toneMapping;h.getClearColor(Rc),h.toneMapping=Kn,h.autoClear=!1;let m=new ei({name:"PMREM.Background",side:Nt,depthWrite:!1,depthTest:!1}),v=new mt(new Ls,m),_=!1,g=e.background;g?g.isColor&&(m.color.copy(g),e.background=null,_=!0):(m.color.copy(Rc),_=!0);for(let f=0;f<6;f++){let T=f%3;T===0?(o.up.set(0,l[f],0),o.lookAt(c[f],0,0)):T===1?(o.up.set(0,0,l[f]),o.lookAt(0,c[f],0)):(o.up.set(0,l[f],0),o.lookAt(0,0,c[f]));let E=this._cubeSize;vr(s,T*E,f>2?E:0,E,E),h.setRenderTarget(s),_&&h.render(v,o),h.render(e,o)}v.geometry.dispose(),v.material.dispose(),h.toneMapping=d,h.autoClear=u,e.background=g}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===ns||e.mapping===is;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Dc()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Lc());let r=s?this._cubemapMaterial:this._equirectMaterial,a=new mt(this._lodPlanes[0],r),o=r.uniforms;o.envMap.value=e;let l=this._cubeSize;vr(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(a,Ua)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let s=this._lodPlanes.length;for(let r=1;r<s;r++){let a=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),o=Ic[(s-r-1)%Ic.length];this._blur(e,r-1,r,a,o)}t.autoClear=n}_blur(e,t,n,s,r){let a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,s,"latitudinal",r),this._halfBlur(a,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,a,o){let l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let h=3,u=new mt(this._lodPlanes[s],c),d=c.uniforms,m=this._sizeLods[n]-1,v=isFinite(r)?Math.PI/(2*m):2*Math.PI/(2*yi-1),_=r/v,g=isFinite(r)?1+Math.floor(h*_):yi;g>yi&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${yi}`);let f=[],T=0;for(let C=0;C<yi;++C){let N=C/_,w=Math.exp(-N*N/2);f.push(w),C===0?T+=w:C<g&&(T+=2*w)}for(let C=0;C<f.length;C++)f[C]=f[C]/T;d.envMap.value=e.texture,d.samples.value=g,d.weights.value=f,d.latitudinal.value=a==="latitudinal",o&&(d.poleAxis.value=o);let{_lodMax:E}=this;d.dTheta.value=v,d.mipInt.value=E-n;let x=this._sizeLods[s],U=3*x*(s>E-Zi?s-E+Zi:0),A=4*(this._cubeSize-x);vr(t,U,A,3*x,2*x),l.setRenderTarget(t),l.render(u,Ua)}};function rm(i){let e=[],t=[],n=[],s=i,r=i-Zi+1+Cc.length;for(let a=0;a<r;a++){let o=Math.pow(2,s);t.push(o);let l=1/o;a>i-Zi?l=Cc[a-i+Zi-1]:a===0&&(l=0),n.push(l);let c=1/(o-2),h=-c,u=1+c,d=[h,h,u,h,u,u,h,h,u,u,h,u],m=6,v=6,_=3,g=2,f=1,T=new Float32Array(_*v*m),E=new Float32Array(g*v*m),x=new Float32Array(f*v*m);for(let A=0;A<m;A++){let C=A%3*2/3-1,N=A>2?0:-1,w=[C,N,0,C+2/3,N,0,C+2/3,N+1,0,C,N,0,C+2/3,N+1,0,C,N+1,0];T.set(w,_*v*A),E.set(d,g*v*A);let M=[A,A,A,A,A,A];x.set(M,f*v*A)}let U=new Zt;U.setAttribute("position",new gt(T,_)),U.setAttribute("uv",new gt(E,g)),U.setAttribute("faceIndex",new gt(x,f)),e.push(U),s>Zi&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Pc(i,e,t){let n=new Rn(i,e,t);return n.texture.mapping=Hr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function vr(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function am(i,e,t){let n=new Float32Array(yi),s=new H(0,1,0);return new At({name:"SphericalGaussianBlur",defines:{n:yi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:hl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Lc(){return new At({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:hl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Dc(){return new At({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:hl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function hl(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function om(i){let e=new WeakMap,t=null;function n(o){if(o&&o.isTexture){let l=o.mapping,c=l===Ka||l===Ja,h=l===ns||l===is;if(c||h){let u=e.get(o),d=u!==void 0?u.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==d)return t===null&&(t=new Or(i)),u=c?t.fromEquirectangular(o,u):t.fromCubemap(o,u),u.texture.pmremVersion=o.pmremVersion,e.set(o,u),u.texture;if(u!==void 0)return u.texture;{let m=o.image;return c&&m&&m.height>0||h&&m&&s(m)?(t===null&&(t=new Or(i)),u=c?t.fromEquirectangular(o):t.fromCubemap(o),u.texture.pmremVersion=o.pmremVersion,e.set(o,u),o.addEventListener("dispose",r),u.texture):null}}}return o}function s(o){let l=0,c=6;for(let h=0;h<c;h++)o[h]!==void 0&&l++;return l===c}function r(o){let l=o.target;l.removeEventListener("dispose",r);let c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function a(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:a}}function lm(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&Ts("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function cm(i,e,t,n){let s={},r=new WeakMap;function a(u){let d=u.target;d.index!==null&&e.remove(d.index);for(let v in d.attributes)e.remove(d.attributes[v]);for(let v in d.morphAttributes){let _=d.morphAttributes[v];for(let g=0,f=_.length;g<f;g++)e.remove(_[g])}d.removeEventListener("dispose",a),delete s[d.id];let m=r.get(d);m&&(e.remove(m),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function o(u,d){return s[d.id]===!0||(d.addEventListener("dispose",a),s[d.id]=!0,t.memory.geometries++),d}function l(u){let d=u.attributes;for(let v in d)e.update(d[v],i.ARRAY_BUFFER);let m=u.morphAttributes;for(let v in m){let _=m[v];for(let g=0,f=_.length;g<f;g++)e.update(_[g],i.ARRAY_BUFFER)}}function c(u){let d=[],m=u.index,v=u.attributes.position,_=0;if(m!==null){let T=m.array;_=m.version;for(let E=0,x=T.length;E<x;E+=3){let U=T[E+0],A=T[E+1],C=T[E+2];d.push(U,A,A,C,C,U)}}else if(v!==void 0){let T=v.array;_=v.version;for(let E=0,x=T.length/3-1;E<x;E+=3){let U=E+0,A=E+1,C=E+2;d.push(U,A,A,C,C,U)}}else return;let g=new(dh(d)?Lr:Pr)(d,1);g.version=_;let f=r.get(u);f&&e.remove(f),r.set(u,g)}function h(u){let d=r.get(u);if(d){let m=u.index;m!==null&&d.version<m.version&&c(u)}else c(u);return r.get(u)}return{get:o,update:l,getWireframeAttribute:h}}function hm(i,e,t){let n;function s(d){n=d}let r,a;function o(d){r=d.type,a=d.bytesPerElement}function l(d,m){i.drawElements(n,m,r,d*a),t.update(m,n,1)}function c(d,m,v){v!==0&&(i.drawElementsInstanced(n,m,r,d*a,v),t.update(m,n,v))}function h(d,m,v){if(v===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,m,0,r,d,0,v);let g=0;for(let f=0;f<v;f++)g+=m[f];t.update(g,n,1)}function u(d,m,v,_){if(v===0)return;let g=e.get("WEBGL_multi_draw");if(g===null)for(let f=0;f<d.length;f++)c(d[f]/a,m[f],_[f]);else{g.multiDrawElementsInstancedWEBGL(n,m,0,r,d,0,_,0,v);let f=0;for(let T=0;T<v;T++)f+=m[T]*_[T];t.update(f,n,1)}}this.setMode=s,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=u}function um(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(r/3);break;case i.LINES:t.lines+=o*(r/2);break;case i.LINE_STRIP:t.lines+=o*(r-1);break;case i.LINE_LOOP:t.lines+=o*r;break;case i.POINTS:t.points+=o*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function dm(i,e,t){let n=new WeakMap,s=new ft;function r(a,o,l){let c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0,d=n.get(o);if(d===void 0||d.count!==u){let w=function(){C.dispose(),n.delete(o),o.removeEventListener("dispose",w)};d!==void 0&&d.texture.dispose();let m=o.morphAttributes.position!==void 0,v=o.morphAttributes.normal!==void 0,_=o.morphAttributes.color!==void 0,g=o.morphAttributes.position||[],f=o.morphAttributes.normal||[],T=o.morphAttributes.color||[],E=0;m===!0&&(E=1),v===!0&&(E=2),_===!0&&(E=3);let x=o.attributes.position.count*E,U=1;x>e.maxTextureSize&&(U=Math.ceil(x/e.maxTextureSize),x=e.maxTextureSize);let A=new Float32Array(x*U*4*u),C=new Rr(A,x,U,u);C.type=Sn,C.needsUpdate=!0;let N=E*4;for(let M=0;M<u;M++){let R=g[M],q=f[M],B=T[M],$=x*U*4*M;for(let G=0;G<R.count;G++){let P=G*N;m===!0&&(s.fromBufferAttribute(R,G),A[$+P+0]=s.x,A[$+P+1]=s.y,A[$+P+2]=s.z,A[$+P+3]=0),v===!0&&(s.fromBufferAttribute(q,G),A[$+P+4]=s.x,A[$+P+5]=s.y,A[$+P+6]=s.z,A[$+P+7]=0),_===!0&&(s.fromBufferAttribute(B,G),A[$+P+8]=s.x,A[$+P+9]=s.y,A[$+P+10]=s.z,A[$+P+11]=B.itemSize===4?s.w:1)}}d={count:u,texture:C,size:new nt(x,U)},n.set(o,d),o.addEventListener("dispose",w)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let m=0;for(let _=0;_<c.length;_++)m+=c[_];let v=o.morphTargetsRelative?1:1-m;l.getUniforms().setValue(i,"morphTargetBaseInfluence",v),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:r}}function fm(i,e,t,n){let s=new WeakMap;function r(l){let c=n.render.frame,h=l.geometry,u=e.get(l,h);if(s.get(u)!==c&&(e.update(u),s.set(u,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){let d=l.skeleton;s.get(d)!==c&&(d.update(),s.set(d,c))}return u}function a(){s=new WeakMap}function o(l){let c=l.target;c.removeEventListener("dispose",o),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:a}}var kr=class extends Yt{constructor(e,t,n,s,r,a,o,l,c,h=ji){if(h!==ji&&h!==rs)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===ji&&(n=bi),n===void 0&&h===rs&&(n=ss),super(null,s,r,a,o,l,h,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=o!==void 0?o:rn,this.minFilter=l!==void 0?l:rn,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},gh=new Yt,Fc=new kr(1,1),vh=new Rr,yh=new Po,_h=new Fr,Uc=[],Nc=[],Oc=new Float32Array(16),kc=new Float32Array(9),Bc=new Float32Array(4);function cs(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Uc[s];if(r===void 0&&(r=new Float32Array(s),Uc[s]=r),e!==0){n.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(r,o)}return r}function _t(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function xt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Wr(i,e){let t=Nc[e];t===void 0&&(t=new Int32Array(e),Nc[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function pm(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function mm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(_t(t,e))return;i.uniform2fv(this.addr,e),xt(t,e)}}function gm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(_t(t,e))return;i.uniform3fv(this.addr,e),xt(t,e)}}function vm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(_t(t,e))return;i.uniform4fv(this.addr,e),xt(t,e)}}function ym(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(_t(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),xt(t,e)}else{if(_t(t,n))return;Bc.set(n),i.uniformMatrix2fv(this.addr,!1,Bc),xt(t,n)}}function _m(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(_t(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),xt(t,e)}else{if(_t(t,n))return;kc.set(n),i.uniformMatrix3fv(this.addr,!1,kc),xt(t,n)}}function xm(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(_t(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),xt(t,e)}else{if(_t(t,n))return;Oc.set(n),i.uniformMatrix4fv(this.addr,!1,Oc),xt(t,n)}}function bm(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Mm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(_t(t,e))return;i.uniform2iv(this.addr,e),xt(t,e)}}function wm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(_t(t,e))return;i.uniform3iv(this.addr,e),xt(t,e)}}function Sm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(_t(t,e))return;i.uniform4iv(this.addr,e),xt(t,e)}}function Em(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function Tm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(_t(t,e))return;i.uniform2uiv(this.addr,e),xt(t,e)}}function Am(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(_t(t,e))return;i.uniform3uiv(this.addr,e),xt(t,e)}}function Cm(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(_t(t,e))return;i.uniform4uiv(this.addr,e),xt(t,e)}}function Rm(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(Fc.compareFunction=uh,r=Fc):r=gh,t.setTexture2D(e||r,s)}function Im(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||yh,s)}function Pm(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||_h,s)}function Lm(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||vh,s)}function Dm(i){switch(i){case 5126:return pm;case 35664:return mm;case 35665:return gm;case 35666:return vm;case 35674:return ym;case 35675:return _m;case 35676:return xm;case 5124:case 35670:return bm;case 35667:case 35671:return Mm;case 35668:case 35672:return wm;case 35669:case 35673:return Sm;case 5125:return Em;case 36294:return Tm;case 36295:return Am;case 36296:return Cm;case 35678:case 36198:case 36298:case 36306:case 35682:return Rm;case 35679:case 36299:case 36307:return Im;case 35680:case 36300:case 36308:case 36293:return Pm;case 36289:case 36303:case 36311:case 36292:return Lm}}function Fm(i,e){i.uniform1fv(this.addr,e)}function Um(i,e){let t=cs(e,this.size,2);i.uniform2fv(this.addr,t)}function Nm(i,e){let t=cs(e,this.size,3);i.uniform3fv(this.addr,t)}function Om(i,e){let t=cs(e,this.size,4);i.uniform4fv(this.addr,t)}function km(i,e){let t=cs(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function Bm(i,e){let t=cs(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function zm(i,e){let t=cs(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Vm(i,e){i.uniform1iv(this.addr,e)}function Hm(i,e){i.uniform2iv(this.addr,e)}function Gm(i,e){i.uniform3iv(this.addr,e)}function Wm(i,e){i.uniform4iv(this.addr,e)}function Xm(i,e){i.uniform1uiv(this.addr,e)}function $m(i,e){i.uniform2uiv(this.addr,e)}function qm(i,e){i.uniform3uiv(this.addr,e)}function Ym(i,e){i.uniform4uiv(this.addr,e)}function Zm(i,e,t){let n=this.cache,s=e.length,r=Wr(t,s);_t(n,r)||(i.uniform1iv(this.addr,r),xt(n,r));for(let a=0;a!==s;++a)t.setTexture2D(e[a]||gh,r[a])}function Km(i,e,t){let n=this.cache,s=e.length,r=Wr(t,s);_t(n,r)||(i.uniform1iv(this.addr,r),xt(n,r));for(let a=0;a!==s;++a)t.setTexture3D(e[a]||yh,r[a])}function Jm(i,e,t){let n=this.cache,s=e.length,r=Wr(t,s);_t(n,r)||(i.uniform1iv(this.addr,r),xt(n,r));for(let a=0;a!==s;++a)t.setTextureCube(e[a]||_h,r[a])}function jm(i,e,t){let n=this.cache,s=e.length,r=Wr(t,s);_t(n,r)||(i.uniform1iv(this.addr,r),xt(n,r));for(let a=0;a!==s;++a)t.setTexture2DArray(e[a]||vh,r[a])}function Qm(i){switch(i){case 5126:return Fm;case 35664:return Um;case 35665:return Nm;case 35666:return Om;case 35674:return km;case 35675:return Bm;case 35676:return zm;case 5124:case 35670:return Vm;case 35667:case 35671:return Hm;case 35668:case 35672:return Gm;case 35669:case 35673:return Wm;case 5125:return Xm;case 36294:return $m;case 36295:return qm;case 36296:return Ym;case 35678:case 36198:case 36298:case 36306:case 35682:return Zm;case 35679:case 36299:case 36307:return Km;case 35680:case 36300:case 36308:case 36293:return Jm;case 36289:case 36303:case 36311:case 36292:return jm}}var No=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Dm(t.type)}},Oo=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Qm(t.type)}},ko=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,a=s.length;r!==a;++r){let o=s[r];o.setValue(e,t[o.id],n)}}},za=/(\w+)(\])?(\[|\.)?/g;function zc(i,e){i.seq.push(e),i.map[e.id]=e}function eg(i,e,t){let n=i.name,s=n.length;for(za.lastIndex=0;;){let r=za.exec(n),a=za.lastIndex,o=r[1],l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===s){zc(t,c===void 0?new No(o,i,e):new Oo(o,i,e));break}else{let u=t.map[o];u===void 0&&(u=new ko(o),zc(t,u)),t=u}}}var es=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){let r=e.getActiveUniform(t,s),a=e.getUniformLocation(t,r.name);eg(r,a,this)}}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,a=t.length;r!==a;++r){let o=t[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let a=e[s];a.id in t&&n.push(a)}return n}};function Vc(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var tg=37297,ng=0;function ig(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=s;a<r;a++){let o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}var Hc=new Oe;function sg(i){$e._getMatrix(Hc,$e.workingColorSpace,i);let e=`mat3( ${Hc.elements.map(t=>t.toFixed(4))} )`;switch($e.getTransfer(i)){case Gr:return[e,"LinearTransferOETF"];case tt:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function Gc(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";let r=/ERROR: 0:(\d+)/.exec(s);if(r){let a=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+ig(i.getShaderSource(e),a)}else return s}function rg(i,e){let t=sg(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function ag(i,e){let t;switch(e){case Ru:t="Linear";break;case Iu:t="Reinhard";break;case Pu:t="Cineon";break;case Lu:t="ACESFilmic";break;case Fu:t="AgX";break;case Uu:t="Neutral";break;case Du:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var yr=new H;function og(){$e.getLuminanceCoefficients(yr);let i=yr.x.toFixed(4),e=yr.y.toFixed(4),t=yr.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function lg(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(As).join(`
`)}function cg(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function hg(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),a=r.name,o=1;r.type===i.FLOAT_MAT2&&(o=2),r.type===i.FLOAT_MAT3&&(o=3),r.type===i.FLOAT_MAT4&&(o=4),t[a]={type:r.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function As(i){return i!==""}function Wc(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Xc(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var ug=/^[ \t]*#include +<([\w\d./]+)>/gm;function Bo(i){return i.replace(ug,fg)}var dg=new Map;function fg(i,e){let t=Be[e];if(t===void 0){let n=dg.get(e);if(n!==void 0)t=Be[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Bo(t)}var pg=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function $c(i){return i.replace(pg,mg)}function mg(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function qc(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function gg(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===jc?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===lu?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===Mn&&(e="SHADOWMAP_TYPE_VSM"),e}function vg(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case ns:case is:e="ENVMAP_TYPE_CUBE";break;case Hr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function yg(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case is:e="ENVMAP_MODE_REFRACTION";break}return e}function _g(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case Qc:e="ENVMAP_BLENDING_MULTIPLY";break;case Au:e="ENVMAP_BLENDING_MIX";break;case Cu:e="ENVMAP_BLENDING_ADD";break}return e}function xg(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function bg(i,e,t,n){let s=i.getContext(),r=t.defines,a=t.vertexShader,o=t.fragmentShader,l=gg(t),c=vg(t),h=yg(t),u=_g(t),d=xg(t),m=lg(t),v=cg(r),_=s.createProgram(),g,f,T=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(g=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,v].filter(As).join(`
`),g.length>0&&(g+=`
`),f=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,v].filter(As).join(`
`),f.length>0&&(f+=`
`)):(g=[qc(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,v,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(As).join(`
`),f=[qc(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,v,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Kn?"#define TONE_MAPPING":"",t.toneMapping!==Kn?Be.tonemapping_pars_fragment:"",t.toneMapping!==Kn?ag("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Be.colorspace_pars_fragment,rg("linearToOutputTexel",t.outputColorSpace),og(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(As).join(`
`)),a=Bo(a),a=Wc(a,t),a=Xc(a,t),o=Bo(o),o=Wc(o,t),o=Xc(o,t),a=$c(a),o=$c(o),t.isRawShaderMaterial!==!0&&(T=`#version 300 es
`,g=[m,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,f=["#define varying in",t.glslVersion===oc?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===oc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+f);let E=T+g+a,x=T+f+o,U=Vc(s,s.VERTEX_SHADER,E),A=Vc(s,s.FRAGMENT_SHADER,x);s.attachShader(_,U),s.attachShader(_,A),t.index0AttributeName!==void 0?s.bindAttribLocation(_,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(_,0,"position"),s.linkProgram(_);function C(R){if(i.debug.checkShaderErrors){let q=s.getProgramInfoLog(_).trim(),B=s.getShaderInfoLog(U).trim(),$=s.getShaderInfoLog(A).trim(),G=!0,P=!0;if(s.getProgramParameter(_,s.LINK_STATUS)===!1)if(G=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,_,U,A);else{let W=Gc(s,U,"vertex"),O=Gc(s,A,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(_,s.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+q+`
`+W+`
`+O)}else q!==""?console.warn("THREE.WebGLProgram: Program Info Log:",q):(B===""||$==="")&&(P=!1);P&&(R.diagnostics={runnable:G,programLog:q,vertexShader:{log:B,prefix:g},fragmentShader:{log:$,prefix:f}})}s.deleteShader(U),s.deleteShader(A),N=new es(s,_),w=hg(s,_)}let N;this.getUniforms=function(){return N===void 0&&C(this),N};let w;this.getAttributes=function(){return w===void 0&&C(this),w};let M=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=s.getProgramParameter(_,tg)),M},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(_),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=ng++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=U,this.fragmentShader=A,this}var Mg=0,zo=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(s)===!1&&(a.add(s),s.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Vo(e),t.set(e,n)),n}},Vo=class{constructor(e){this.id=Mg++,this.code=e,this.usedTimes=0}};function wg(i,e,t,n,s,r,a){let o=new Ir,l=new zo,c=new Set,h=[],u=s.logarithmicDepthBuffer,d=s.vertexTextures,m=s.precision,v={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(w){return c.add(w),w===0?"uv":`uv${w}`}function g(w,M,R,q,B){let $=q.fog,G=B.geometry,P=w.isMeshStandardMaterial?q.environment:null,W=(w.isMeshStandardMaterial?t:e).get(w.envMap||P),O=W&&W.mapping===Hr?W.image.height:null,Z=v[w.type];w.precision!==null&&(m=s.getMaxPrecision(w.precision),m!==w.precision&&console.warn("THREE.WebGLProgram.getParameters:",w.precision,"not supported, using",m,"instead."));let ie=G.morphAttributes.position||G.morphAttributes.normal||G.morphAttributes.color,fe=ie!==void 0?ie.length:0,Ce=0;G.morphAttributes.position!==void 0&&(Ce=1),G.morphAttributes.normal!==void 0&&(Ce=2),G.morphAttributes.color!==void 0&&(Ce=3);let Fe,Y,ne,xe;if(Z){let et=dn[Z];Fe=et.vertexShader,Y=et.fragmentShader}else Fe=w.vertexShader,Y=w.fragmentShader,l.update(w),ne=l.getVertexShaderID(w),xe=l.getFragmentShaderID(w);let le=i.getRenderTarget(),Ie=i.state.buffers.depth.getReversed(),De=B.isInstancedMesh===!0,ze=B.isBatchedMesh===!0,ht=!!w.map,We=!!w.matcap,dt=!!W,F=!!w.aoMap,Gt=!!w.lightMap,Ve=!!w.bumpMap,He=!!w.normalMap,Te=!!w.displacementMap,at=!!w.emissiveMap,Se=!!w.metalnessMap,S=!!w.roughnessMap,y=w.anisotropy>0,k=w.clearcoat>0,J=w.dispersion>0,Q=w.iridescence>0,K=w.sheen>0,be=w.transmission>0,ce=y&&!!w.anisotropyMap,pe=k&&!!w.clearcoatMap,Xe=k&&!!w.clearcoatNormalMap,ee=k&&!!w.clearcoatRoughnessMap,me=Q&&!!w.iridescenceMap,Re=Q&&!!w.iridescenceThicknessMap,Pe=K&&!!w.sheenColorMap,ge=K&&!!w.sheenRoughnessMap,Ge=!!w.specularMap,ke=!!w.specularColorMap,it=!!w.specularIntensityMap,I=be&&!!w.transmissionMap,ae=be&&!!w.thicknessMap,X=!!w.gradientMap,j=!!w.alphaMap,de=w.alphaTest>0,he=!!w.alphaHash,Ue=!!w.extensions,ut=Kn;w.toneMapped&&(le===null||le.isXRRenderTarget===!0)&&(ut=i.toneMapping);let St={shaderID:Z,shaderType:w.type,shaderName:w.name,vertexShader:Fe,fragmentShader:Y,defines:w.defines,customVertexShaderID:ne,customFragmentShaderID:xe,isRawShaderMaterial:w.isRawShaderMaterial===!0,glslVersion:w.glslVersion,precision:m,batching:ze,batchingColor:ze&&B._colorsTexture!==null,instancing:De,instancingColor:De&&B.instanceColor!==null,instancingMorph:De&&B.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:le===null?i.outputColorSpace:le.isXRRenderTarget===!0?le.texture.colorSpace:ti,alphaToCoverage:!!w.alphaToCoverage,map:ht,matcap:We,envMap:dt,envMapMode:dt&&W.mapping,envMapCubeUVHeight:O,aoMap:F,lightMap:Gt,bumpMap:Ve,normalMap:He,displacementMap:d&&Te,emissiveMap:at,normalMapObjectSpace:He&&w.normalMapType===zu,normalMapTangentSpace:He&&w.normalMapType===Bu,metalnessMap:Se,roughnessMap:S,anisotropy:y,anisotropyMap:ce,clearcoat:k,clearcoatMap:pe,clearcoatNormalMap:Xe,clearcoatRoughnessMap:ee,dispersion:J,iridescence:Q,iridescenceMap:me,iridescenceThicknessMap:Re,sheen:K,sheenColorMap:Pe,sheenRoughnessMap:ge,specularMap:Ge,specularColorMap:ke,specularIntensityMap:it,transmission:be,transmissionMap:I,thicknessMap:ae,gradientMap:X,opaque:w.transparent===!1&&w.blending===Ji&&w.alphaToCoverage===!1,alphaMap:j,alphaTest:de,alphaHash:he,combine:w.combine,mapUv:ht&&_(w.map.channel),aoMapUv:F&&_(w.aoMap.channel),lightMapUv:Gt&&_(w.lightMap.channel),bumpMapUv:Ve&&_(w.bumpMap.channel),normalMapUv:He&&_(w.normalMap.channel),displacementMapUv:Te&&_(w.displacementMap.channel),emissiveMapUv:at&&_(w.emissiveMap.channel),metalnessMapUv:Se&&_(w.metalnessMap.channel),roughnessMapUv:S&&_(w.roughnessMap.channel),anisotropyMapUv:ce&&_(w.anisotropyMap.channel),clearcoatMapUv:pe&&_(w.clearcoatMap.channel),clearcoatNormalMapUv:Xe&&_(w.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ee&&_(w.clearcoatRoughnessMap.channel),iridescenceMapUv:me&&_(w.iridescenceMap.channel),iridescenceThicknessMapUv:Re&&_(w.iridescenceThicknessMap.channel),sheenColorMapUv:Pe&&_(w.sheenColorMap.channel),sheenRoughnessMapUv:ge&&_(w.sheenRoughnessMap.channel),specularMapUv:Ge&&_(w.specularMap.channel),specularColorMapUv:ke&&_(w.specularColorMap.channel),specularIntensityMapUv:it&&_(w.specularIntensityMap.channel),transmissionMapUv:I&&_(w.transmissionMap.channel),thicknessMapUv:ae&&_(w.thicknessMap.channel),alphaMapUv:j&&_(w.alphaMap.channel),vertexTangents:!!G.attributes.tangent&&(He||y),vertexColors:w.vertexColors,vertexAlphas:w.vertexColors===!0&&!!G.attributes.color&&G.attributes.color.itemSize===4,pointsUvs:B.isPoints===!0&&!!G.attributes.uv&&(ht||j),fog:!!$,useFog:w.fog===!0,fogExp2:!!$&&$.isFogExp2,flatShading:w.flatShading===!0,sizeAttenuation:w.sizeAttenuation===!0,logarithmicDepthBuffer:u,reverseDepthBuffer:Ie,skinning:B.isSkinnedMesh===!0,morphTargets:G.morphAttributes.position!==void 0,morphNormals:G.morphAttributes.normal!==void 0,morphColors:G.morphAttributes.color!==void 0,morphTargetsCount:fe,morphTextureStride:Ce,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:w.dithering,shadowMapEnabled:i.shadowMap.enabled&&R.length>0,shadowMapType:i.shadowMap.type,toneMapping:ut,decodeVideoTexture:ht&&w.map.isVideoTexture===!0&&$e.getTransfer(w.map.colorSpace)===tt,decodeVideoTextureEmissive:at&&w.emissiveMap.isVideoTexture===!0&&$e.getTransfer(w.emissiveMap.colorSpace)===tt,premultipliedAlpha:w.premultipliedAlpha,doubleSided:w.side===Vt,flipSided:w.side===Nt,useDepthPacking:w.depthPacking>=0,depthPacking:w.depthPacking||0,index0AttributeName:w.index0AttributeName,extensionClipCullDistance:Ue&&w.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ue&&w.extensions.multiDraw===!0||ze)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:w.customProgramCacheKey()};return St.vertexUv1s=c.has(1),St.vertexUv2s=c.has(2),St.vertexUv3s=c.has(3),c.clear(),St}function f(w){let M=[];if(w.shaderID?M.push(w.shaderID):(M.push(w.customVertexShaderID),M.push(w.customFragmentShaderID)),w.defines!==void 0)for(let R in w.defines)M.push(R),M.push(w.defines[R]);return w.isRawShaderMaterial===!1&&(T(M,w),E(M,w),M.push(i.outputColorSpace)),M.push(w.customProgramCacheKey),M.join()}function T(w,M){w.push(M.precision),w.push(M.outputColorSpace),w.push(M.envMapMode),w.push(M.envMapCubeUVHeight),w.push(M.mapUv),w.push(M.alphaMapUv),w.push(M.lightMapUv),w.push(M.aoMapUv),w.push(M.bumpMapUv),w.push(M.normalMapUv),w.push(M.displacementMapUv),w.push(M.emissiveMapUv),w.push(M.metalnessMapUv),w.push(M.roughnessMapUv),w.push(M.anisotropyMapUv),w.push(M.clearcoatMapUv),w.push(M.clearcoatNormalMapUv),w.push(M.clearcoatRoughnessMapUv),w.push(M.iridescenceMapUv),w.push(M.iridescenceThicknessMapUv),w.push(M.sheenColorMapUv),w.push(M.sheenRoughnessMapUv),w.push(M.specularMapUv),w.push(M.specularColorMapUv),w.push(M.specularIntensityMapUv),w.push(M.transmissionMapUv),w.push(M.thicknessMapUv),w.push(M.combine),w.push(M.fogExp2),w.push(M.sizeAttenuation),w.push(M.morphTargetsCount),w.push(M.morphAttributeCount),w.push(M.numDirLights),w.push(M.numPointLights),w.push(M.numSpotLights),w.push(M.numSpotLightMaps),w.push(M.numHemiLights),w.push(M.numRectAreaLights),w.push(M.numDirLightShadows),w.push(M.numPointLightShadows),w.push(M.numSpotLightShadows),w.push(M.numSpotLightShadowsWithMaps),w.push(M.numLightProbes),w.push(M.shadowMapType),w.push(M.toneMapping),w.push(M.numClippingPlanes),w.push(M.numClipIntersection),w.push(M.depthPacking)}function E(w,M){o.disableAll(),M.supportsVertexTextures&&o.enable(0),M.instancing&&o.enable(1),M.instancingColor&&o.enable(2),M.instancingMorph&&o.enable(3),M.matcap&&o.enable(4),M.envMap&&o.enable(5),M.normalMapObjectSpace&&o.enable(6),M.normalMapTangentSpace&&o.enable(7),M.clearcoat&&o.enable(8),M.iridescence&&o.enable(9),M.alphaTest&&o.enable(10),M.vertexColors&&o.enable(11),M.vertexAlphas&&o.enable(12),M.vertexUv1s&&o.enable(13),M.vertexUv2s&&o.enable(14),M.vertexUv3s&&o.enable(15),M.vertexTangents&&o.enable(16),M.anisotropy&&o.enable(17),M.alphaHash&&o.enable(18),M.batching&&o.enable(19),M.dispersion&&o.enable(20),M.batchingColor&&o.enable(21),w.push(o.mask),o.disableAll(),M.fog&&o.enable(0),M.useFog&&o.enable(1),M.flatShading&&o.enable(2),M.logarithmicDepthBuffer&&o.enable(3),M.reverseDepthBuffer&&o.enable(4),M.skinning&&o.enable(5),M.morphTargets&&o.enable(6),M.morphNormals&&o.enable(7),M.morphColors&&o.enable(8),M.premultipliedAlpha&&o.enable(9),M.shadowMapEnabled&&o.enable(10),M.doubleSided&&o.enable(11),M.flipSided&&o.enable(12),M.useDepthPacking&&o.enable(13),M.dithering&&o.enable(14),M.transmission&&o.enable(15),M.sheen&&o.enable(16),M.opaque&&o.enable(17),M.pointsUvs&&o.enable(18),M.decodeVideoTexture&&o.enable(19),M.decodeVideoTextureEmissive&&o.enable(20),M.alphaToCoverage&&o.enable(21),w.push(o.mask)}function x(w){let M=v[w.type],R;if(M){let q=dn[M];R=dd.clone(q.uniforms)}else R=w.uniforms;return R}function U(w,M){let R;for(let q=0,B=h.length;q<B;q++){let $=h[q];if($.cacheKey===M){R=$,++R.usedTimes;break}}return R===void 0&&(R=new bg(i,M,w,r),h.push(R)),R}function A(w){if(--w.usedTimes===0){let M=h.indexOf(w);h[M]=h[h.length-1],h.pop(),w.destroy()}}function C(w){l.remove(w)}function N(){l.dispose()}return{getParameters:g,getProgramCacheKey:f,getUniforms:x,acquireProgram:U,releaseProgram:A,releaseShaderCache:C,programs:h,dispose:N}}function Sg(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function s(a,o,l){i.get(a)[o]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function Eg(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function Yc(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function Zc(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function a(u,d,m,v,_,g){let f=i[e];return f===void 0?(f={id:u.id,object:u,geometry:d,material:m,groupOrder:v,renderOrder:u.renderOrder,z:_,group:g},i[e]=f):(f.id=u.id,f.object=u,f.geometry=d,f.material=m,f.groupOrder=v,f.renderOrder=u.renderOrder,f.z=_,f.group=g),e++,f}function o(u,d,m,v,_,g){let f=a(u,d,m,v,_,g);m.transmission>0?n.push(f):m.transparent===!0?s.push(f):t.push(f)}function l(u,d,m,v,_,g){let f=a(u,d,m,v,_,g);m.transmission>0?n.unshift(f):m.transparent===!0?s.unshift(f):t.unshift(f)}function c(u,d){t.length>1&&t.sort(u||Eg),n.length>1&&n.sort(d||Yc),s.length>1&&s.sort(d||Yc)}function h(){for(let u=e,d=i.length;u<d;u++){let m=i[u];if(m.id===null)break;m.id=null,m.object=null,m.geometry=null,m.material=null,m.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:o,unshift:l,finish:h,sort:c}}function Tg(){let i=new WeakMap;function e(n,s){let r=i.get(n),a;return r===void 0?(a=new Zc,i.set(n,[a])):s>=r.length?(a=new Zc,r.push(a)):a=r[s],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function Ag(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new H,color:new Ye};break;case"SpotLight":t={position:new H,direction:new H,color:new Ye,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new H,color:new Ye,distance:0,decay:0};break;case"HemisphereLight":t={direction:new H,skyColor:new Ye,groundColor:new Ye};break;case"RectAreaLight":t={color:new Ye,position:new H,halfWidth:new H,halfHeight:new H};break}return i[e.id]=t,t}}}function Cg(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new nt};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new nt};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new nt,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var Rg=0;function Ig(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function Pg(i){let e=new Ag,t=Cg(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new H);let s=new H,r=new yt,a=new yt;function o(c){let h=0,u=0,d=0;for(let w=0;w<9;w++)n.probe[w].set(0,0,0);let m=0,v=0,_=0,g=0,f=0,T=0,E=0,x=0,U=0,A=0,C=0;c.sort(Ig);for(let w=0,M=c.length;w<M;w++){let R=c[w],q=R.color,B=R.intensity,$=R.distance,G=R.shadow&&R.shadow.map?R.shadow.map.texture:null;if(R.isAmbientLight)h+=q.r*B,u+=q.g*B,d+=q.b*B;else if(R.isLightProbe){for(let P=0;P<9;P++)n.probe[P].addScaledVector(R.sh.coefficients[P],B);C++}else if(R.isDirectionalLight){let P=e.get(R);if(P.color.copy(R.color).multiplyScalar(R.intensity),R.castShadow){let W=R.shadow,O=t.get(R);O.shadowIntensity=W.intensity,O.shadowBias=W.bias,O.shadowNormalBias=W.normalBias,O.shadowRadius=W.radius,O.shadowMapSize=W.mapSize,n.directionalShadow[m]=O,n.directionalShadowMap[m]=G,n.directionalShadowMatrix[m]=R.shadow.matrix,T++}n.directional[m]=P,m++}else if(R.isSpotLight){let P=e.get(R);P.position.setFromMatrixPosition(R.matrixWorld),P.color.copy(q).multiplyScalar(B),P.distance=$,P.coneCos=Math.cos(R.angle),P.penumbraCos=Math.cos(R.angle*(1-R.penumbra)),P.decay=R.decay,n.spot[_]=P;let W=R.shadow;if(R.map&&(n.spotLightMap[U]=R.map,U++,W.updateMatrices(R),R.castShadow&&A++),n.spotLightMatrix[_]=W.matrix,R.castShadow){let O=t.get(R);O.shadowIntensity=W.intensity,O.shadowBias=W.bias,O.shadowNormalBias=W.normalBias,O.shadowRadius=W.radius,O.shadowMapSize=W.mapSize,n.spotShadow[_]=O,n.spotShadowMap[_]=G,x++}_++}else if(R.isRectAreaLight){let P=e.get(R);P.color.copy(q).multiplyScalar(B),P.halfWidth.set(R.width*.5,0,0),P.halfHeight.set(0,R.height*.5,0),n.rectArea[g]=P,g++}else if(R.isPointLight){let P=e.get(R);if(P.color.copy(R.color).multiplyScalar(R.intensity),P.distance=R.distance,P.decay=R.decay,R.castShadow){let W=R.shadow,O=t.get(R);O.shadowIntensity=W.intensity,O.shadowBias=W.bias,O.shadowNormalBias=W.normalBias,O.shadowRadius=W.radius,O.shadowMapSize=W.mapSize,O.shadowCameraNear=W.camera.near,O.shadowCameraFar=W.camera.far,n.pointShadow[v]=O,n.pointShadowMap[v]=G,n.pointShadowMatrix[v]=R.shadow.matrix,E++}n.point[v]=P,v++}else if(R.isHemisphereLight){let P=e.get(R);P.skyColor.copy(R.color).multiplyScalar(B),P.groundColor.copy(R.groundColor).multiplyScalar(B),n.hemi[f]=P,f++}}g>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=re.LTC_FLOAT_1,n.rectAreaLTC2=re.LTC_FLOAT_2):(n.rectAreaLTC1=re.LTC_HALF_1,n.rectAreaLTC2=re.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;let N=n.hash;(N.directionalLength!==m||N.pointLength!==v||N.spotLength!==_||N.rectAreaLength!==g||N.hemiLength!==f||N.numDirectionalShadows!==T||N.numPointShadows!==E||N.numSpotShadows!==x||N.numSpotMaps!==U||N.numLightProbes!==C)&&(n.directional.length=m,n.spot.length=_,n.rectArea.length=g,n.point.length=v,n.hemi.length=f,n.directionalShadow.length=T,n.directionalShadowMap.length=T,n.pointShadow.length=E,n.pointShadowMap.length=E,n.spotShadow.length=x,n.spotShadowMap.length=x,n.directionalShadowMatrix.length=T,n.pointShadowMatrix.length=E,n.spotLightMatrix.length=x+U-A,n.spotLightMap.length=U,n.numSpotLightShadowsWithMaps=A,n.numLightProbes=C,N.directionalLength=m,N.pointLength=v,N.spotLength=_,N.rectAreaLength=g,N.hemiLength=f,N.numDirectionalShadows=T,N.numPointShadows=E,N.numSpotShadows=x,N.numSpotMaps=U,N.numLightProbes=C,n.version=Rg++)}function l(c,h){let u=0,d=0,m=0,v=0,_=0,g=h.matrixWorldInverse;for(let f=0,T=c.length;f<T;f++){let E=c[f];if(E.isDirectionalLight){let x=n.directional[u];x.direction.setFromMatrixPosition(E.matrixWorld),s.setFromMatrixPosition(E.target.matrixWorld),x.direction.sub(s),x.direction.transformDirection(g),u++}else if(E.isSpotLight){let x=n.spot[m];x.position.setFromMatrixPosition(E.matrixWorld),x.position.applyMatrix4(g),x.direction.setFromMatrixPosition(E.matrixWorld),s.setFromMatrixPosition(E.target.matrixWorld),x.direction.sub(s),x.direction.transformDirection(g),m++}else if(E.isRectAreaLight){let x=n.rectArea[v];x.position.setFromMatrixPosition(E.matrixWorld),x.position.applyMatrix4(g),a.identity(),r.copy(E.matrixWorld),r.premultiply(g),a.extractRotation(r),x.halfWidth.set(E.width*.5,0,0),x.halfHeight.set(0,E.height*.5,0),x.halfWidth.applyMatrix4(a),x.halfHeight.applyMatrix4(a),v++}else if(E.isPointLight){let x=n.point[d];x.position.setFromMatrixPosition(E.matrixWorld),x.position.applyMatrix4(g),d++}else if(E.isHemisphereLight){let x=n.hemi[_];x.direction.setFromMatrixPosition(E.matrixWorld),x.direction.transformDirection(g),_++}}}return{setup:o,setupView:l,state:n}}function Kc(i){let e=new Pg(i),t=[],n=[];function s(h){c.camera=h,t.length=0,n.length=0}function r(h){t.push(h)}function a(h){n.push(h)}function o(){e.setup(t)}function l(h){e.setupView(t,h)}let c={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:o,setupLightsView:l,pushLight:r,pushShadow:a}}function Lg(i){let e=new WeakMap;function t(s,r=0){let a=e.get(s),o;return a===void 0?(o=new Kc(i),e.set(s,[o])):r>=a.length?(o=new Kc(i),a.push(o)):o=a[r],o}function n(){e=new WeakMap}return{get:t,dispose:n}}var Ho=class extends as{static get type(){return"MeshDepthMaterial"}constructor(e){super(),this.isMeshDepthMaterial=!0,this.depthPacking=Ou,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Go=class extends as{static get type(){return"MeshDistanceMaterial"}constructor(e){super(),this.isMeshDistanceMaterial=!0,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}},Dg=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Fg=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function Ug(i,e,t){let n=new Ur,s=new nt,r=new nt,a=new ft,o=new Ho({depthPacking:ku}),l=new Go,c={},h=t.maxTextureSize,u={[Jn]:Nt,[Nt]:Jn,[Vt]:Vt},d=new At({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new nt},radius:{value:4}},vertexShader:Dg,fragmentShader:Fg}),m=d.clone();m.defines.HORIZONTAL_PASS=1;let v=new Zt;v.setAttribute("position",new gt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let _=new mt(v,d),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=jc;let f=this.type;this.render=function(A,C,N){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||A.length===0)return;let w=i.getRenderTarget(),M=i.getActiveCubeFace(),R=i.getActiveMipmapLevel(),q=i.state;q.setBlending(Zn),q.buffers.color.setClear(1,1,1,1),q.buffers.depth.setTest(!0),q.setScissorTest(!1);let B=f!==Mn&&this.type===Mn,$=f===Mn&&this.type!==Mn;for(let G=0,P=A.length;G<P;G++){let W=A[G],O=W.shadow;if(O===void 0){console.warn("THREE.WebGLShadowMap:",W,"has no shadow.");continue}if(O.autoUpdate===!1&&O.needsUpdate===!1)continue;s.copy(O.mapSize);let Z=O.getFrameExtents();if(s.multiply(Z),r.copy(O.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/Z.x),s.x=r.x*Z.x,O.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/Z.y),s.y=r.y*Z.y,O.mapSize.y=r.y)),O.map===null||B===!0||$===!0){let fe=this.type!==Mn?{minFilter:rn,magFilter:rn}:{};O.map!==null&&O.map.dispose(),O.map=new Rn(s.x,s.y,fe),O.map.texture.name=W.name+".shadowMap",O.camera.updateProjectionMatrix()}i.setRenderTarget(O.map),i.clear();let ie=O.getViewportCount();for(let fe=0;fe<ie;fe++){let Ce=O.getViewport(fe);a.set(r.x*Ce.x,r.y*Ce.y,r.x*Ce.z,r.y*Ce.w),q.viewport(a),O.updateMatrices(W,fe),n=O.getFrustum(),x(C,N,O.camera,W,this.type)}O.isPointLightShadow!==!0&&this.type===Mn&&T(O,N),O.needsUpdate=!1}f=this.type,g.needsUpdate=!1,i.setRenderTarget(w,M,R)};function T(A,C){let N=e.update(_);d.defines.VSM_SAMPLES!==A.blurSamples&&(d.defines.VSM_SAMPLES=A.blurSamples,m.defines.VSM_SAMPLES=A.blurSamples,d.needsUpdate=!0,m.needsUpdate=!0),A.mapPass===null&&(A.mapPass=new Rn(s.x,s.y)),d.uniforms.shadow_pass.value=A.map.texture,d.uniforms.resolution.value=A.mapSize,d.uniforms.radius.value=A.radius,i.setRenderTarget(A.mapPass),i.clear(),i.renderBufferDirect(C,null,N,d,_,null),m.uniforms.shadow_pass.value=A.mapPass.texture,m.uniforms.resolution.value=A.mapSize,m.uniforms.radius.value=A.radius,i.setRenderTarget(A.map),i.clear(),i.renderBufferDirect(C,null,N,m,_,null)}function E(A,C,N,w){let M=null,R=N.isPointLight===!0?A.customDistanceMaterial:A.customDepthMaterial;if(R!==void 0)M=R;else if(M=N.isPointLight===!0?l:o,i.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0){let q=M.uuid,B=C.uuid,$=c[q];$===void 0&&($={},c[q]=$);let G=$[B];G===void 0&&(G=M.clone(),$[B]=G,C.addEventListener("dispose",U)),M=G}if(M.visible=C.visible,M.wireframe=C.wireframe,w===Mn?M.side=C.shadowSide!==null?C.shadowSide:C.side:M.side=C.shadowSide!==null?C.shadowSide:u[C.side],M.alphaMap=C.alphaMap,M.alphaTest=C.alphaTest,M.map=C.map,M.clipShadows=C.clipShadows,M.clippingPlanes=C.clippingPlanes,M.clipIntersection=C.clipIntersection,M.displacementMap=C.displacementMap,M.displacementScale=C.displacementScale,M.displacementBias=C.displacementBias,M.wireframeLinewidth=C.wireframeLinewidth,M.linewidth=C.linewidth,N.isPointLight===!0&&M.isMeshDistanceMaterial===!0){let q=i.properties.get(M);q.light=N}return M}function x(A,C,N,w,M){if(A.visible===!1)return;if(A.layers.test(C.layers)&&(A.isMesh||A.isLine||A.isPoints)&&(A.castShadow||A.receiveShadow&&M===Mn)&&(!A.frustumCulled||n.intersectsObject(A))){A.modelViewMatrix.multiplyMatrices(N.matrixWorldInverse,A.matrixWorld);let B=e.update(A),$=A.material;if(Array.isArray($)){let G=B.groups;for(let P=0,W=G.length;P<W;P++){let O=G[P],Z=$[O.materialIndex];if(Z&&Z.visible){let ie=E(A,Z,w,M);A.onBeforeShadow(i,A,C,N,B,ie,O),i.renderBufferDirect(N,null,B,ie,A,O),A.onAfterShadow(i,A,C,N,B,ie,O)}}}else if($.visible){let G=E(A,$,w,M);A.onBeforeShadow(i,A,C,N,B,G,null),i.renderBufferDirect(N,null,B,G,A,null),A.onAfterShadow(i,A,C,N,B,G,null)}}let q=A.children;for(let B=0,$=q.length;B<$;B++)x(q[B],C,N,w,M)}function U(A){A.target.removeEventListener("dispose",U);for(let N in c){let w=c[N],M=A.target.uuid;M in w&&(w[M].dispose(),delete w[M])}}}var Ng={[Ga]:Wa,[Xa]:Ya,[$a]:Za,[ts]:qa,[Wa]:Ga,[Ya]:Xa,[Za]:$a,[qa]:ts};function Og(i,e){function t(){let I=!1,ae=new ft,X=null,j=new ft(0,0,0,0);return{setMask:function(de){X!==de&&!I&&(i.colorMask(de,de,de,de),X=de)},setLocked:function(de){I=de},setClear:function(de,he,Ue,ut,St){St===!0&&(de*=ut,he*=ut,Ue*=ut),ae.set(de,he,Ue,ut),j.equals(ae)===!1&&(i.clearColor(de,he,Ue,ut),j.copy(ae))},reset:function(){I=!1,X=null,j.set(-1,0,0,0)}}}function n(){let I=!1,ae=!1,X=null,j=null,de=null;return{setReversed:function(he){if(ae!==he){let Ue=e.get("EXT_clip_control");ae?Ue.clipControlEXT(Ue.LOWER_LEFT_EXT,Ue.ZERO_TO_ONE_EXT):Ue.clipControlEXT(Ue.LOWER_LEFT_EXT,Ue.NEGATIVE_ONE_TO_ONE_EXT);let ut=de;de=null,this.setClear(ut)}ae=he},getReversed:function(){return ae},setTest:function(he){he?le(i.DEPTH_TEST):Ie(i.DEPTH_TEST)},setMask:function(he){X!==he&&!I&&(i.depthMask(he),X=he)},setFunc:function(he){if(ae&&(he=Ng[he]),j!==he){switch(he){case Ga:i.depthFunc(i.NEVER);break;case Wa:i.depthFunc(i.ALWAYS);break;case Xa:i.depthFunc(i.LESS);break;case ts:i.depthFunc(i.LEQUAL);break;case $a:i.depthFunc(i.EQUAL);break;case qa:i.depthFunc(i.GEQUAL);break;case Ya:i.depthFunc(i.GREATER);break;case Za:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}j=he}},setLocked:function(he){I=he},setClear:function(he){de!==he&&(ae&&(he=1-he),i.clearDepth(he),de=he)},reset:function(){I=!1,X=null,j=null,de=null,ae=!1}}}function s(){let I=!1,ae=null,X=null,j=null,de=null,he=null,Ue=null,ut=null,St=null;return{setTest:function(et){I||(et?le(i.STENCIL_TEST):Ie(i.STENCIL_TEST))},setMask:function(et){ae!==et&&!I&&(i.stencilMask(et),ae=et)},setFunc:function(et,Jt,pn){(X!==et||j!==Jt||de!==pn)&&(i.stencilFunc(et,Jt,pn),X=et,j=Jt,de=pn)},setOp:function(et,Jt,pn){(he!==et||Ue!==Jt||ut!==pn)&&(i.stencilOp(et,Jt,pn),he=et,Ue=Jt,ut=pn)},setLocked:function(et){I=et},setClear:function(et){St!==et&&(i.clearStencil(et),St=et)},reset:function(){I=!1,ae=null,X=null,j=null,de=null,he=null,Ue=null,ut=null,St=null}}}let r=new t,a=new n,o=new s,l=new WeakMap,c=new WeakMap,h={},u={},d=new WeakMap,m=[],v=null,_=!1,g=null,f=null,T=null,E=null,x=null,U=null,A=null,C=new Ye(0,0,0),N=0,w=!1,M=null,R=null,q=null,B=null,$=null,G=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),P=!1,W=0,O=i.getParameter(i.VERSION);O.indexOf("WebGL")!==-1?(W=parseFloat(/^WebGL (\d)/.exec(O)[1]),P=W>=1):O.indexOf("OpenGL ES")!==-1&&(W=parseFloat(/^OpenGL ES (\d)/.exec(O)[1]),P=W>=2);let Z=null,ie={},fe=i.getParameter(i.SCISSOR_BOX),Ce=i.getParameter(i.VIEWPORT),Fe=new ft().fromArray(fe),Y=new ft().fromArray(Ce);function ne(I,ae,X,j){let de=new Uint8Array(4),he=i.createTexture();i.bindTexture(I,he),i.texParameteri(I,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(I,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ue=0;Ue<X;Ue++)I===i.TEXTURE_3D||I===i.TEXTURE_2D_ARRAY?i.texImage3D(ae,0,i.RGBA,1,1,j,0,i.RGBA,i.UNSIGNED_BYTE,de):i.texImage2D(ae+Ue,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,de);return he}let xe={};xe[i.TEXTURE_2D]=ne(i.TEXTURE_2D,i.TEXTURE_2D,1),xe[i.TEXTURE_CUBE_MAP]=ne(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),xe[i.TEXTURE_2D_ARRAY]=ne(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),xe[i.TEXTURE_3D]=ne(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),le(i.DEPTH_TEST),a.setFunc(ts),Ve(!1),He(Ql),le(i.CULL_FACE),F(Zn);function le(I){h[I]!==!0&&(i.enable(I),h[I]=!0)}function Ie(I){h[I]!==!1&&(i.disable(I),h[I]=!1)}function De(I,ae){return u[I]!==ae?(i.bindFramebuffer(I,ae),u[I]=ae,I===i.DRAW_FRAMEBUFFER&&(u[i.FRAMEBUFFER]=ae),I===i.FRAMEBUFFER&&(u[i.DRAW_FRAMEBUFFER]=ae),!0):!1}function ze(I,ae){let X=m,j=!1;if(I){X=d.get(ae),X===void 0&&(X=[],d.set(ae,X));let de=I.textures;if(X.length!==de.length||X[0]!==i.COLOR_ATTACHMENT0){for(let he=0,Ue=de.length;he<Ue;he++)X[he]=i.COLOR_ATTACHMENT0+he;X.length=de.length,j=!0}}else X[0]!==i.BACK&&(X[0]=i.BACK,j=!0);j&&i.drawBuffers(X)}function ht(I){return v!==I?(i.useProgram(I),v=I,!0):!1}let We={[gi]:i.FUNC_ADD,[hu]:i.FUNC_SUBTRACT,[uu]:i.FUNC_REVERSE_SUBTRACT};We[du]=i.MIN,We[fu]=i.MAX;let dt={[pu]:i.ZERO,[mu]:i.ONE,[gu]:i.SRC_COLOR,[Va]:i.SRC_ALPHA,[Mu]:i.SRC_ALPHA_SATURATE,[xu]:i.DST_COLOR,[yu]:i.DST_ALPHA,[vu]:i.ONE_MINUS_SRC_COLOR,[Ha]:i.ONE_MINUS_SRC_ALPHA,[bu]:i.ONE_MINUS_DST_COLOR,[_u]:i.ONE_MINUS_DST_ALPHA,[wu]:i.CONSTANT_COLOR,[Su]:i.ONE_MINUS_CONSTANT_COLOR,[Eu]:i.CONSTANT_ALPHA,[Tu]:i.ONE_MINUS_CONSTANT_ALPHA};function F(I,ae,X,j,de,he,Ue,ut,St,et){if(I===Zn){_===!0&&(Ie(i.BLEND),_=!1);return}if(_===!1&&(le(i.BLEND),_=!0),I!==cu){if(I!==g||et!==w){if((f!==gi||x!==gi)&&(i.blendEquation(i.FUNC_ADD),f=gi,x=gi),et)switch(I){case Ji:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Rs:i.blendFunc(i.ONE,i.ONE);break;case ec:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case tc:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",I);break}else switch(I){case Ji:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Rs:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case ec:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case tc:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",I);break}T=null,E=null,U=null,A=null,C.set(0,0,0),N=0,g=I,w=et}return}de=de||ae,he=he||X,Ue=Ue||j,(ae!==f||de!==x)&&(i.blendEquationSeparate(We[ae],We[de]),f=ae,x=de),(X!==T||j!==E||he!==U||Ue!==A)&&(i.blendFuncSeparate(dt[X],dt[j],dt[he],dt[Ue]),T=X,E=j,U=he,A=Ue),(ut.equals(C)===!1||St!==N)&&(i.blendColor(ut.r,ut.g,ut.b,St),C.copy(ut),N=St),g=I,w=!1}function Gt(I,ae){I.side===Vt?Ie(i.CULL_FACE):le(i.CULL_FACE);let X=I.side===Nt;ae&&(X=!X),Ve(X),I.blending===Ji&&I.transparent===!1?F(Zn):F(I.blending,I.blendEquation,I.blendSrc,I.blendDst,I.blendEquationAlpha,I.blendSrcAlpha,I.blendDstAlpha,I.blendColor,I.blendAlpha,I.premultipliedAlpha),a.setFunc(I.depthFunc),a.setTest(I.depthTest),a.setMask(I.depthWrite),r.setMask(I.colorWrite);let j=I.stencilWrite;o.setTest(j),j&&(o.setMask(I.stencilWriteMask),o.setFunc(I.stencilFunc,I.stencilRef,I.stencilFuncMask),o.setOp(I.stencilFail,I.stencilZFail,I.stencilZPass)),at(I.polygonOffset,I.polygonOffsetFactor,I.polygonOffsetUnits),I.alphaToCoverage===!0?le(i.SAMPLE_ALPHA_TO_COVERAGE):Ie(i.SAMPLE_ALPHA_TO_COVERAGE)}function Ve(I){M!==I&&(I?i.frontFace(i.CW):i.frontFace(i.CCW),M=I)}function He(I){I!==au?(le(i.CULL_FACE),I!==R&&(I===Ql?i.cullFace(i.BACK):I===ou?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Ie(i.CULL_FACE),R=I}function Te(I){I!==q&&(P&&i.lineWidth(I),q=I)}function at(I,ae,X){I?(le(i.POLYGON_OFFSET_FILL),(B!==ae||$!==X)&&(i.polygonOffset(ae,X),B=ae,$=X)):Ie(i.POLYGON_OFFSET_FILL)}function Se(I){I?le(i.SCISSOR_TEST):Ie(i.SCISSOR_TEST)}function S(I){I===void 0&&(I=i.TEXTURE0+G-1),Z!==I&&(i.activeTexture(I),Z=I)}function y(I,ae,X){X===void 0&&(Z===null?X=i.TEXTURE0+G-1:X=Z);let j=ie[X];j===void 0&&(j={type:void 0,texture:void 0},ie[X]=j),(j.type!==I||j.texture!==ae)&&(Z!==X&&(i.activeTexture(X),Z=X),i.bindTexture(I,ae||xe[I]),j.type=I,j.texture=ae)}function k(){let I=ie[Z];I!==void 0&&I.type!==void 0&&(i.bindTexture(I.type,null),I.type=void 0,I.texture=void 0)}function J(){try{i.compressedTexImage2D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function Q(){try{i.compressedTexImage3D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function K(){try{i.texSubImage2D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function be(){try{i.texSubImage3D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function ce(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function pe(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function Xe(){try{i.texStorage2D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function ee(){try{i.texStorage3D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function me(){try{i.texImage2D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function Re(){try{i.texImage3D.apply(i,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function Pe(I){Fe.equals(I)===!1&&(i.scissor(I.x,I.y,I.z,I.w),Fe.copy(I))}function ge(I){Y.equals(I)===!1&&(i.viewport(I.x,I.y,I.z,I.w),Y.copy(I))}function Ge(I,ae){let X=c.get(ae);X===void 0&&(X=new WeakMap,c.set(ae,X));let j=X.get(I);j===void 0&&(j=i.getUniformBlockIndex(ae,I.name),X.set(I,j))}function ke(I,ae){let j=c.get(ae).get(I);l.get(ae)!==j&&(i.uniformBlockBinding(ae,j,I.__bindingPointIndex),l.set(ae,j))}function it(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),h={},Z=null,ie={},u={},d=new WeakMap,m=[],v=null,_=!1,g=null,f=null,T=null,E=null,x=null,U=null,A=null,C=new Ye(0,0,0),N=0,w=!1,M=null,R=null,q=null,B=null,$=null,Fe.set(0,0,i.canvas.width,i.canvas.height),Y.set(0,0,i.canvas.width,i.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:le,disable:Ie,bindFramebuffer:De,drawBuffers:ze,useProgram:ht,setBlending:F,setMaterial:Gt,setFlipSided:Ve,setCullFace:He,setLineWidth:Te,setPolygonOffset:at,setScissorTest:Se,activeTexture:S,bindTexture:y,unbindTexture:k,compressedTexImage2D:J,compressedTexImage3D:Q,texImage2D:me,texImage3D:Re,updateUBOMapping:Ge,uniformBlockBinding:ke,texStorage2D:Xe,texStorage3D:ee,texSubImage2D:K,texSubImage3D:be,compressedTexSubImage2D:ce,compressedTexSubImage3D:pe,scissor:Pe,viewport:ge,reset:it}}function Jc(i,e,t,n){let s=kg(n);switch(t){case sh:return i*e;case ah:return i*e;case oh:return i*e*2;case lh:return i*e/s.components*s.byteLength;case ol:return i*e/s.components*s.byteLength;case ch:return i*e*2/s.components*s.byteLength;case ll:return i*e*2/s.components*s.byteLength;case rh:return i*e*3/s.components*s.byteLength;case sn:return i*e*4/s.components*s.byteLength;case cl:return i*e*4/s.components*s.byteLength;case xr:case br:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Mr:case wr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case to:case io:return Math.max(i,16)*Math.max(e,8)/4;case eo:case no:return Math.max(i,8)*Math.max(e,8)/2;case so:case ro:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case ao:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case oo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case lo:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case co:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case ho:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case uo:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case fo:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case po:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case mo:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case go:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case vo:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case yo:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case _o:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case xo:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case bo:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Sr:case Mo:case wo:return Math.ceil(i/4)*Math.ceil(e/4)*16;case hh:case So:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Eo:case To:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function kg(i){switch(i){case Cn:case th:return{byteLength:1,components:1};case Is:case nh:case Ds:return{byteLength:2,components:1};case rl:case al:return{byteLength:2,components:4};case bi:case sl:case Sn:return{byteLength:4,components:1};case ih:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}function Bg(i,e,t,n,s,r,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new nt,h=new WeakMap,u,d=new WeakMap,m=!1;try{m=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function v(S,y){return m?new OffscreenCanvas(S,y):Ar("canvas")}function _(S,y,k){let J=1,Q=Se(S);if((Q.width>k||Q.height>k)&&(J=k/Math.max(Q.width,Q.height)),J<1)if(typeof HTMLImageElement<"u"&&S instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&S instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&S instanceof ImageBitmap||typeof VideoFrame<"u"&&S instanceof VideoFrame){let K=Math.floor(J*Q.width),be=Math.floor(J*Q.height);u===void 0&&(u=v(K,be));let ce=y?v(K,be):u;return ce.width=K,ce.height=be,ce.getContext("2d").drawImage(S,0,0,K,be),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Q.width+"x"+Q.height+") to ("+K+"x"+be+")."),ce}else return"data"in S&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Q.width+"x"+Q.height+")."),S;return S}function g(S){return S.generateMipmaps}function f(S){i.generateMipmap(S)}function T(S){return S.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:S.isWebGL3DRenderTarget?i.TEXTURE_3D:S.isWebGLArrayRenderTarget||S.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function E(S,y,k,J,Q=!1){if(S!==null){if(i[S]!==void 0)return i[S];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+S+"'")}let K=y;if(y===i.RED&&(k===i.FLOAT&&(K=i.R32F),k===i.HALF_FLOAT&&(K=i.R16F),k===i.UNSIGNED_BYTE&&(K=i.R8)),y===i.RED_INTEGER&&(k===i.UNSIGNED_BYTE&&(K=i.R8UI),k===i.UNSIGNED_SHORT&&(K=i.R16UI),k===i.UNSIGNED_INT&&(K=i.R32UI),k===i.BYTE&&(K=i.R8I),k===i.SHORT&&(K=i.R16I),k===i.INT&&(K=i.R32I)),y===i.RG&&(k===i.FLOAT&&(K=i.RG32F),k===i.HALF_FLOAT&&(K=i.RG16F),k===i.UNSIGNED_BYTE&&(K=i.RG8)),y===i.RG_INTEGER&&(k===i.UNSIGNED_BYTE&&(K=i.RG8UI),k===i.UNSIGNED_SHORT&&(K=i.RG16UI),k===i.UNSIGNED_INT&&(K=i.RG32UI),k===i.BYTE&&(K=i.RG8I),k===i.SHORT&&(K=i.RG16I),k===i.INT&&(K=i.RG32I)),y===i.RGB_INTEGER&&(k===i.UNSIGNED_BYTE&&(K=i.RGB8UI),k===i.UNSIGNED_SHORT&&(K=i.RGB16UI),k===i.UNSIGNED_INT&&(K=i.RGB32UI),k===i.BYTE&&(K=i.RGB8I),k===i.SHORT&&(K=i.RGB16I),k===i.INT&&(K=i.RGB32I)),y===i.RGBA_INTEGER&&(k===i.UNSIGNED_BYTE&&(K=i.RGBA8UI),k===i.UNSIGNED_SHORT&&(K=i.RGBA16UI),k===i.UNSIGNED_INT&&(K=i.RGBA32UI),k===i.BYTE&&(K=i.RGBA8I),k===i.SHORT&&(K=i.RGBA16I),k===i.INT&&(K=i.RGBA32I)),y===i.RGB&&k===i.UNSIGNED_INT_5_9_9_9_REV&&(K=i.RGB9_E5),y===i.RGBA){let be=Q?Gr:$e.getTransfer(J);k===i.FLOAT&&(K=i.RGBA32F),k===i.HALF_FLOAT&&(K=i.RGBA16F),k===i.UNSIGNED_BYTE&&(K=be===tt?i.SRGB8_ALPHA8:i.RGBA8),k===i.UNSIGNED_SHORT_4_4_4_4&&(K=i.RGBA4),k===i.UNSIGNED_SHORT_5_5_5_1&&(K=i.RGB5_A1)}return(K===i.R16F||K===i.R32F||K===i.RG16F||K===i.RG32F||K===i.RGBA16F||K===i.RGBA32F)&&e.get("EXT_color_buffer_float"),K}function x(S,y){let k;return S?y===null||y===bi||y===ss?k=i.DEPTH24_STENCIL8:y===Sn?k=i.DEPTH32F_STENCIL8:y===Is&&(k=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===bi||y===ss?k=i.DEPTH_COMPONENT24:y===Sn?k=i.DEPTH_COMPONENT32F:y===Is&&(k=i.DEPTH_COMPONENT16),k}function U(S,y){return g(S)===!0||S.isFramebufferTexture&&S.minFilter!==rn&&S.minFilter!==fn?Math.log2(Math.max(y.width,y.height))+1:S.mipmaps!==void 0&&S.mipmaps.length>0?S.mipmaps.length:S.isCompressedTexture&&Array.isArray(S.image)?y.mipmaps.length:1}function A(S){let y=S.target;y.removeEventListener("dispose",A),N(y),y.isVideoTexture&&h.delete(y)}function C(S){let y=S.target;y.removeEventListener("dispose",C),M(y)}function N(S){let y=n.get(S);if(y.__webglInit===void 0)return;let k=S.source,J=d.get(k);if(J){let Q=J[y.__cacheKey];Q.usedTimes--,Q.usedTimes===0&&w(S),Object.keys(J).length===0&&d.delete(k)}n.remove(S)}function w(S){let y=n.get(S);i.deleteTexture(y.__webglTexture);let k=S.source,J=d.get(k);delete J[y.__cacheKey],a.memory.textures--}function M(S){let y=n.get(S);if(S.depthTexture&&(S.depthTexture.dispose(),n.remove(S.depthTexture)),S.isWebGLCubeRenderTarget)for(let J=0;J<6;J++){if(Array.isArray(y.__webglFramebuffer[J]))for(let Q=0;Q<y.__webglFramebuffer[J].length;Q++)i.deleteFramebuffer(y.__webglFramebuffer[J][Q]);else i.deleteFramebuffer(y.__webglFramebuffer[J]);y.__webglDepthbuffer&&i.deleteRenderbuffer(y.__webglDepthbuffer[J])}else{if(Array.isArray(y.__webglFramebuffer))for(let J=0;J<y.__webglFramebuffer.length;J++)i.deleteFramebuffer(y.__webglFramebuffer[J]);else i.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&i.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&i.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let J=0;J<y.__webglColorRenderbuffer.length;J++)y.__webglColorRenderbuffer[J]&&i.deleteRenderbuffer(y.__webglColorRenderbuffer[J]);y.__webglDepthRenderbuffer&&i.deleteRenderbuffer(y.__webglDepthRenderbuffer)}let k=S.textures;for(let J=0,Q=k.length;J<Q;J++){let K=n.get(k[J]);K.__webglTexture&&(i.deleteTexture(K.__webglTexture),a.memory.textures--),n.remove(k[J])}n.remove(S)}let R=0;function q(){R=0}function B(){let S=R;return S>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+S+" texture units while this GPU supports only "+s.maxTextures),R+=1,S}function $(S){let y=[];return y.push(S.wrapS),y.push(S.wrapT),y.push(S.wrapR||0),y.push(S.magFilter),y.push(S.minFilter),y.push(S.anisotropy),y.push(S.internalFormat),y.push(S.format),y.push(S.type),y.push(S.generateMipmaps),y.push(S.premultiplyAlpha),y.push(S.flipY),y.push(S.unpackAlignment),y.push(S.colorSpace),y.join()}function G(S,y){let k=n.get(S);if(S.isVideoTexture&&Te(S),S.isRenderTargetTexture===!1&&S.version>0&&k.__version!==S.version){let J=S.image;if(J===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(J.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{Y(k,S,y);return}}t.bindTexture(i.TEXTURE_2D,k.__webglTexture,i.TEXTURE0+y)}function P(S,y){let k=n.get(S);if(S.version>0&&k.__version!==S.version){Y(k,S,y);return}t.bindTexture(i.TEXTURE_2D_ARRAY,k.__webglTexture,i.TEXTURE0+y)}function W(S,y){let k=n.get(S);if(S.version>0&&k.__version!==S.version){Y(k,S,y);return}t.bindTexture(i.TEXTURE_3D,k.__webglTexture,i.TEXTURE0+y)}function O(S,y){let k=n.get(S);if(S.version>0&&k.__version!==S.version){ne(k,S,y);return}t.bindTexture(i.TEXTURE_CUBE_MAP,k.__webglTexture,i.TEXTURE0+y)}let Z={[ja]:i.REPEAT,[_i]:i.CLAMP_TO_EDGE,[Qa]:i.MIRRORED_REPEAT},ie={[rn]:i.NEAREST,[Nu]:i.NEAREST_MIPMAP_NEAREST,[js]:i.NEAREST_MIPMAP_LINEAR,[fn]:i.LINEAR,[ua]:i.LINEAR_MIPMAP_NEAREST,[xi]:i.LINEAR_MIPMAP_LINEAR},fe={[Vu]:i.NEVER,[qu]:i.ALWAYS,[Hu]:i.LESS,[uh]:i.LEQUAL,[Gu]:i.EQUAL,[$u]:i.GEQUAL,[Wu]:i.GREATER,[Xu]:i.NOTEQUAL};function Ce(S,y){if(y.type===Sn&&e.has("OES_texture_float_linear")===!1&&(y.magFilter===fn||y.magFilter===ua||y.magFilter===js||y.magFilter===xi||y.minFilter===fn||y.minFilter===ua||y.minFilter===js||y.minFilter===xi)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(S,i.TEXTURE_WRAP_S,Z[y.wrapS]),i.texParameteri(S,i.TEXTURE_WRAP_T,Z[y.wrapT]),(S===i.TEXTURE_3D||S===i.TEXTURE_2D_ARRAY)&&i.texParameteri(S,i.TEXTURE_WRAP_R,Z[y.wrapR]),i.texParameteri(S,i.TEXTURE_MAG_FILTER,ie[y.magFilter]),i.texParameteri(S,i.TEXTURE_MIN_FILTER,ie[y.minFilter]),y.compareFunction&&(i.texParameteri(S,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(S,i.TEXTURE_COMPARE_FUNC,fe[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===rn||y.minFilter!==js&&y.minFilter!==xi||y.type===Sn&&e.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||n.get(y).__currentAnisotropy){let k=e.get("EXT_texture_filter_anisotropic");i.texParameterf(S,k.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,s.getMaxAnisotropy())),n.get(y).__currentAnisotropy=y.anisotropy}}}function Fe(S,y){let k=!1;S.__webglInit===void 0&&(S.__webglInit=!0,y.addEventListener("dispose",A));let J=y.source,Q=d.get(J);Q===void 0&&(Q={},d.set(J,Q));let K=$(y);if(K!==S.__cacheKey){Q[K]===void 0&&(Q[K]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,k=!0),Q[K].usedTimes++;let be=Q[S.__cacheKey];be!==void 0&&(Q[S.__cacheKey].usedTimes--,be.usedTimes===0&&w(y)),S.__cacheKey=K,S.__webglTexture=Q[K].texture}return k}function Y(S,y,k){let J=i.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(J=i.TEXTURE_2D_ARRAY),y.isData3DTexture&&(J=i.TEXTURE_3D);let Q=Fe(S,y),K=y.source;t.bindTexture(J,S.__webglTexture,i.TEXTURE0+k);let be=n.get(K);if(K.version!==be.__version||Q===!0){t.activeTexture(i.TEXTURE0+k);let ce=$e.getPrimaries($e.workingColorSpace),pe=y.colorSpace===Yn?null:$e.getPrimaries(y.colorSpace),Xe=y.colorSpace===Yn||ce===pe?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,y.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,y.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Xe);let ee=_(y.image,!1,s.maxTextureSize);ee=at(y,ee);let me=r.convert(y.format,y.colorSpace),Re=r.convert(y.type),Pe=E(y.internalFormat,me,Re,y.colorSpace,y.isVideoTexture);Ce(J,y);let ge,Ge=y.mipmaps,ke=y.isVideoTexture!==!0,it=be.__version===void 0||Q===!0,I=K.dataReady,ae=U(y,ee);if(y.isDepthTexture)Pe=x(y.format===rs,y.type),it&&(ke?t.texStorage2D(i.TEXTURE_2D,1,Pe,ee.width,ee.height):t.texImage2D(i.TEXTURE_2D,0,Pe,ee.width,ee.height,0,me,Re,null));else if(y.isDataTexture)if(Ge.length>0){ke&&it&&t.texStorage2D(i.TEXTURE_2D,ae,Pe,Ge[0].width,Ge[0].height);for(let X=0,j=Ge.length;X<j;X++)ge=Ge[X],ke?I&&t.texSubImage2D(i.TEXTURE_2D,X,0,0,ge.width,ge.height,me,Re,ge.data):t.texImage2D(i.TEXTURE_2D,X,Pe,ge.width,ge.height,0,me,Re,ge.data);y.generateMipmaps=!1}else ke?(it&&t.texStorage2D(i.TEXTURE_2D,ae,Pe,ee.width,ee.height),I&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,ee.width,ee.height,me,Re,ee.data)):t.texImage2D(i.TEXTURE_2D,0,Pe,ee.width,ee.height,0,me,Re,ee.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){ke&&it&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ae,Pe,Ge[0].width,Ge[0].height,ee.depth);for(let X=0,j=Ge.length;X<j;X++)if(ge=Ge[X],y.format!==sn)if(me!==null)if(ke){if(I)if(y.layerUpdates.size>0){let de=Jc(ge.width,ge.height,y.format,y.type);for(let he of y.layerUpdates){let Ue=ge.data.subarray(he*de/ge.data.BYTES_PER_ELEMENT,(he+1)*de/ge.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,X,0,0,he,ge.width,ge.height,1,me,Ue)}y.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,X,0,0,0,ge.width,ge.height,ee.depth,me,ge.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,X,Pe,ge.width,ge.height,ee.depth,0,ge.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ke?I&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,X,0,0,0,ge.width,ge.height,ee.depth,me,Re,ge.data):t.texImage3D(i.TEXTURE_2D_ARRAY,X,Pe,ge.width,ge.height,ee.depth,0,me,Re,ge.data)}else{ke&&it&&t.texStorage2D(i.TEXTURE_2D,ae,Pe,Ge[0].width,Ge[0].height);for(let X=0,j=Ge.length;X<j;X++)ge=Ge[X],y.format!==sn?me!==null?ke?I&&t.compressedTexSubImage2D(i.TEXTURE_2D,X,0,0,ge.width,ge.height,me,ge.data):t.compressedTexImage2D(i.TEXTURE_2D,X,Pe,ge.width,ge.height,0,ge.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ke?I&&t.texSubImage2D(i.TEXTURE_2D,X,0,0,ge.width,ge.height,me,Re,ge.data):t.texImage2D(i.TEXTURE_2D,X,Pe,ge.width,ge.height,0,me,Re,ge.data)}else if(y.isDataArrayTexture)if(ke){if(it&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ae,Pe,ee.width,ee.height,ee.depth),I)if(y.layerUpdates.size>0){let X=Jc(ee.width,ee.height,y.format,y.type);for(let j of y.layerUpdates){let de=ee.data.subarray(j*X/ee.data.BYTES_PER_ELEMENT,(j+1)*X/ee.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,j,ee.width,ee.height,1,me,Re,de)}y.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,ee.width,ee.height,ee.depth,me,Re,ee.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,Pe,ee.width,ee.height,ee.depth,0,me,Re,ee.data);else if(y.isData3DTexture)ke?(it&&t.texStorage3D(i.TEXTURE_3D,ae,Pe,ee.width,ee.height,ee.depth),I&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,ee.width,ee.height,ee.depth,me,Re,ee.data)):t.texImage3D(i.TEXTURE_3D,0,Pe,ee.width,ee.height,ee.depth,0,me,Re,ee.data);else if(y.isFramebufferTexture){if(it)if(ke)t.texStorage2D(i.TEXTURE_2D,ae,Pe,ee.width,ee.height);else{let X=ee.width,j=ee.height;for(let de=0;de<ae;de++)t.texImage2D(i.TEXTURE_2D,de,Pe,X,j,0,me,Re,null),X>>=1,j>>=1}}else if(Ge.length>0){if(ke&&it){let X=Se(Ge[0]);t.texStorage2D(i.TEXTURE_2D,ae,Pe,X.width,X.height)}for(let X=0,j=Ge.length;X<j;X++)ge=Ge[X],ke?I&&t.texSubImage2D(i.TEXTURE_2D,X,0,0,me,Re,ge):t.texImage2D(i.TEXTURE_2D,X,Pe,me,Re,ge);y.generateMipmaps=!1}else if(ke){if(it){let X=Se(ee);t.texStorage2D(i.TEXTURE_2D,ae,Pe,X.width,X.height)}I&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,me,Re,ee)}else t.texImage2D(i.TEXTURE_2D,0,Pe,me,Re,ee);g(y)&&f(J),be.__version=K.version,y.onUpdate&&y.onUpdate(y)}S.__version=y.version}function ne(S,y,k){if(y.image.length!==6)return;let J=Fe(S,y),Q=y.source;t.bindTexture(i.TEXTURE_CUBE_MAP,S.__webglTexture,i.TEXTURE0+k);let K=n.get(Q);if(Q.version!==K.__version||J===!0){t.activeTexture(i.TEXTURE0+k);let be=$e.getPrimaries($e.workingColorSpace),ce=y.colorSpace===Yn?null:$e.getPrimaries(y.colorSpace),pe=y.colorSpace===Yn||be===ce?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,y.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,y.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,pe);let Xe=y.isCompressedTexture||y.image[0].isCompressedTexture,ee=y.image[0]&&y.image[0].isDataTexture,me=[];for(let j=0;j<6;j++)!Xe&&!ee?me[j]=_(y.image[j],!0,s.maxCubemapSize):me[j]=ee?y.image[j].image:y.image[j],me[j]=at(y,me[j]);let Re=me[0],Pe=r.convert(y.format,y.colorSpace),ge=r.convert(y.type),Ge=E(y.internalFormat,Pe,ge,y.colorSpace),ke=y.isVideoTexture!==!0,it=K.__version===void 0||J===!0,I=Q.dataReady,ae=U(y,Re);Ce(i.TEXTURE_CUBE_MAP,y);let X;if(Xe){ke&&it&&t.texStorage2D(i.TEXTURE_CUBE_MAP,ae,Ge,Re.width,Re.height);for(let j=0;j<6;j++){X=me[j].mipmaps;for(let de=0;de<X.length;de++){let he=X[de];y.format!==sn?Pe!==null?ke?I&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de,0,0,he.width,he.height,Pe,he.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de,Ge,he.width,he.height,0,he.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):ke?I&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de,0,0,he.width,he.height,Pe,ge,he.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de,Ge,he.width,he.height,0,Pe,ge,he.data)}}}else{if(X=y.mipmaps,ke&&it){X.length>0&&ae++;let j=Se(me[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,ae,Ge,j.width,j.height)}for(let j=0;j<6;j++)if(ee){ke?I&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,me[j].width,me[j].height,Pe,ge,me[j].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Ge,me[j].width,me[j].height,0,Pe,ge,me[j].data);for(let de=0;de<X.length;de++){let Ue=X[de].image[j].image;ke?I&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de+1,0,0,Ue.width,Ue.height,Pe,ge,Ue.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de+1,Ge,Ue.width,Ue.height,0,Pe,ge,Ue.data)}}else{ke?I&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,Pe,ge,me[j]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Ge,Pe,ge,me[j]);for(let de=0;de<X.length;de++){let he=X[de];ke?I&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de+1,0,0,Pe,ge,he.image[j]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+j,de+1,Ge,Pe,ge,he.image[j])}}}g(y)&&f(i.TEXTURE_CUBE_MAP),K.__version=Q.version,y.onUpdate&&y.onUpdate(y)}S.__version=y.version}function xe(S,y,k,J,Q,K){let be=r.convert(k.format,k.colorSpace),ce=r.convert(k.type),pe=E(k.internalFormat,be,ce,k.colorSpace),Xe=n.get(y),ee=n.get(k);if(ee.__renderTarget=y,!Xe.__hasExternalTextures){let me=Math.max(1,y.width>>K),Re=Math.max(1,y.height>>K);Q===i.TEXTURE_3D||Q===i.TEXTURE_2D_ARRAY?t.texImage3D(Q,K,pe,me,Re,y.depth,0,be,ce,null):t.texImage2D(Q,K,pe,me,Re,0,be,ce,null)}t.bindFramebuffer(i.FRAMEBUFFER,S),He(y)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,J,Q,ee.__webglTexture,0,Ve(y)):(Q===i.TEXTURE_2D||Q>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&Q<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,J,Q,ee.__webglTexture,K),t.bindFramebuffer(i.FRAMEBUFFER,null)}function le(S,y,k){if(i.bindRenderbuffer(i.RENDERBUFFER,S),y.depthBuffer){let J=y.depthTexture,Q=J&&J.isDepthTexture?J.type:null,K=x(y.stencilBuffer,Q),be=y.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ce=Ve(y);He(y)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ce,K,y.width,y.height):k?i.renderbufferStorageMultisample(i.RENDERBUFFER,ce,K,y.width,y.height):i.renderbufferStorage(i.RENDERBUFFER,K,y.width,y.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,be,i.RENDERBUFFER,S)}else{let J=y.textures;for(let Q=0;Q<J.length;Q++){let K=J[Q],be=r.convert(K.format,K.colorSpace),ce=r.convert(K.type),pe=E(K.internalFormat,be,ce,K.colorSpace),Xe=Ve(y);k&&He(y)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Xe,pe,y.width,y.height):He(y)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Xe,pe,y.width,y.height):i.renderbufferStorage(i.RENDERBUFFER,pe,y.width,y.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ie(S,y){if(y&&y.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,S),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let J=n.get(y.depthTexture);J.__renderTarget=y,(!J.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),G(y.depthTexture,0);let Q=J.__webglTexture,K=Ve(y);if(y.depthTexture.format===ji)He(y)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Q,0,K):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Q,0);else if(y.depthTexture.format===rs)He(y)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Q,0,K):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Q,0);else throw new Error("Unknown depthTexture format")}function De(S){let y=n.get(S),k=S.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==S.depthTexture){let J=S.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),J){let Q=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,J.removeEventListener("dispose",Q)};J.addEventListener("dispose",Q),y.__depthDisposeCallback=Q}y.__boundDepthTexture=J}if(S.depthTexture&&!y.__autoAllocateDepthBuffer){if(k)throw new Error("target.depthTexture not supported in Cube render targets");Ie(y.__webglFramebuffer,S)}else if(k){y.__webglDepthbuffer=[];for(let J=0;J<6;J++)if(t.bindFramebuffer(i.FRAMEBUFFER,y.__webglFramebuffer[J]),y.__webglDepthbuffer[J]===void 0)y.__webglDepthbuffer[J]=i.createRenderbuffer(),le(y.__webglDepthbuffer[J],S,!1);else{let Q=S.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,K=y.__webglDepthbuffer[J];i.bindRenderbuffer(i.RENDERBUFFER,K),i.framebufferRenderbuffer(i.FRAMEBUFFER,Q,i.RENDERBUFFER,K)}}else if(t.bindFramebuffer(i.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=i.createRenderbuffer(),le(y.__webglDepthbuffer,S,!1);else{let J=S.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,Q=y.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,Q),i.framebufferRenderbuffer(i.FRAMEBUFFER,J,i.RENDERBUFFER,Q)}t.bindFramebuffer(i.FRAMEBUFFER,null)}function ze(S,y,k){let J=n.get(S);y!==void 0&&xe(J.__webglFramebuffer,S,S.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),k!==void 0&&De(S)}function ht(S){let y=S.texture,k=n.get(S),J=n.get(y);S.addEventListener("dispose",C);let Q=S.textures,K=S.isWebGLCubeRenderTarget===!0,be=Q.length>1;if(be||(J.__webglTexture===void 0&&(J.__webglTexture=i.createTexture()),J.__version=y.version,a.memory.textures++),K){k.__webglFramebuffer=[];for(let ce=0;ce<6;ce++)if(y.mipmaps&&y.mipmaps.length>0){k.__webglFramebuffer[ce]=[];for(let pe=0;pe<y.mipmaps.length;pe++)k.__webglFramebuffer[ce][pe]=i.createFramebuffer()}else k.__webglFramebuffer[ce]=i.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){k.__webglFramebuffer=[];for(let ce=0;ce<y.mipmaps.length;ce++)k.__webglFramebuffer[ce]=i.createFramebuffer()}else k.__webglFramebuffer=i.createFramebuffer();if(be)for(let ce=0,pe=Q.length;ce<pe;ce++){let Xe=n.get(Q[ce]);Xe.__webglTexture===void 0&&(Xe.__webglTexture=i.createTexture(),a.memory.textures++)}if(S.samples>0&&He(S)===!1){k.__webglMultisampledFramebuffer=i.createFramebuffer(),k.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,k.__webglMultisampledFramebuffer);for(let ce=0;ce<Q.length;ce++){let pe=Q[ce];k.__webglColorRenderbuffer[ce]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,k.__webglColorRenderbuffer[ce]);let Xe=r.convert(pe.format,pe.colorSpace),ee=r.convert(pe.type),me=E(pe.internalFormat,Xe,ee,pe.colorSpace,S.isXRRenderTarget===!0),Re=Ve(S);i.renderbufferStorageMultisample(i.RENDERBUFFER,Re,me,S.width,S.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ce,i.RENDERBUFFER,k.__webglColorRenderbuffer[ce])}i.bindRenderbuffer(i.RENDERBUFFER,null),S.depthBuffer&&(k.__webglDepthRenderbuffer=i.createRenderbuffer(),le(k.__webglDepthRenderbuffer,S,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(K){t.bindTexture(i.TEXTURE_CUBE_MAP,J.__webglTexture),Ce(i.TEXTURE_CUBE_MAP,y);for(let ce=0;ce<6;ce++)if(y.mipmaps&&y.mipmaps.length>0)for(let pe=0;pe<y.mipmaps.length;pe++)xe(k.__webglFramebuffer[ce][pe],S,y,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,pe);else xe(k.__webglFramebuffer[ce],S,y,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0);g(y)&&f(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(be){for(let ce=0,pe=Q.length;ce<pe;ce++){let Xe=Q[ce],ee=n.get(Xe);t.bindTexture(i.TEXTURE_2D,ee.__webglTexture),Ce(i.TEXTURE_2D,Xe),xe(k.__webglFramebuffer,S,Xe,i.COLOR_ATTACHMENT0+ce,i.TEXTURE_2D,0),g(Xe)&&f(i.TEXTURE_2D)}t.unbindTexture()}else{let ce=i.TEXTURE_2D;if((S.isWebGL3DRenderTarget||S.isWebGLArrayRenderTarget)&&(ce=S.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(ce,J.__webglTexture),Ce(ce,y),y.mipmaps&&y.mipmaps.length>0)for(let pe=0;pe<y.mipmaps.length;pe++)xe(k.__webglFramebuffer[pe],S,y,i.COLOR_ATTACHMENT0,ce,pe);else xe(k.__webglFramebuffer,S,y,i.COLOR_ATTACHMENT0,ce,0);g(y)&&f(ce),t.unbindTexture()}S.depthBuffer&&De(S)}function We(S){let y=S.textures;for(let k=0,J=y.length;k<J;k++){let Q=y[k];if(g(Q)){let K=T(S),be=n.get(Q).__webglTexture;t.bindTexture(K,be),f(K),t.unbindTexture()}}}let dt=[],F=[];function Gt(S){if(S.samples>0){if(He(S)===!1){let y=S.textures,k=S.width,J=S.height,Q=i.COLOR_BUFFER_BIT,K=S.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,be=n.get(S),ce=y.length>1;if(ce)for(let pe=0;pe<y.length;pe++)t.bindFramebuffer(i.FRAMEBUFFER,be.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,be.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,be.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,be.__webglFramebuffer);for(let pe=0;pe<y.length;pe++){if(S.resolveDepthBuffer&&(S.depthBuffer&&(Q|=i.DEPTH_BUFFER_BIT),S.stencilBuffer&&S.resolveStencilBuffer&&(Q|=i.STENCIL_BUFFER_BIT)),ce){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,be.__webglColorRenderbuffer[pe]);let Xe=n.get(y[pe]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,Xe,0)}i.blitFramebuffer(0,0,k,J,0,0,k,J,Q,i.NEAREST),l===!0&&(dt.length=0,F.length=0,dt.push(i.COLOR_ATTACHMENT0+pe),S.depthBuffer&&S.resolveDepthBuffer===!1&&(dt.push(K),F.push(K),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,F)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,dt))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),ce)for(let pe=0;pe<y.length;pe++){t.bindFramebuffer(i.FRAMEBUFFER,be.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.RENDERBUFFER,be.__webglColorRenderbuffer[pe]);let Xe=n.get(y[pe]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,be.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+pe,i.TEXTURE_2D,Xe,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,be.__webglMultisampledFramebuffer)}else if(S.depthBuffer&&S.resolveDepthBuffer===!1&&l){let y=S.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[y])}}}function Ve(S){return Math.min(s.maxSamples,S.samples)}function He(S){let y=n.get(S);return S.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function Te(S){let y=a.render.frame;h.get(S)!==y&&(h.set(S,y),S.update())}function at(S,y){let k=S.colorSpace,J=S.format,Q=S.type;return S.isCompressedTexture===!0||S.isVideoTexture===!0||k!==ti&&k!==Yn&&($e.getTransfer(k)===tt?(J!==sn||Q!==Cn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",k)),y}function Se(S){return typeof HTMLImageElement<"u"&&S instanceof HTMLImageElement?(c.width=S.naturalWidth||S.width,c.height=S.naturalHeight||S.height):typeof VideoFrame<"u"&&S instanceof VideoFrame?(c.width=S.displayWidth,c.height=S.displayHeight):(c.width=S.width,c.height=S.height),c}this.allocateTextureUnit=B,this.resetTextureUnits=q,this.setTexture2D=G,this.setTexture2DArray=P,this.setTexture3D=W,this.setTextureCube=O,this.rebindTextures=ze,this.setupRenderTarget=ht,this.updateRenderTargetMipmap=We,this.updateMultisampleRenderTarget=Gt,this.setupDepthRenderbuffer=De,this.setupFrameBufferTexture=xe,this.useMultisampledRTT=He}function zg(i,e){function t(n,s=Yn){let r,a=$e.getTransfer(s);if(n===Cn)return i.UNSIGNED_BYTE;if(n===rl)return i.UNSIGNED_SHORT_4_4_4_4;if(n===al)return i.UNSIGNED_SHORT_5_5_5_1;if(n===ih)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===th)return i.BYTE;if(n===nh)return i.SHORT;if(n===Is)return i.UNSIGNED_SHORT;if(n===sl)return i.INT;if(n===bi)return i.UNSIGNED_INT;if(n===Sn)return i.FLOAT;if(n===Ds)return i.HALF_FLOAT;if(n===sh)return i.ALPHA;if(n===rh)return i.RGB;if(n===sn)return i.RGBA;if(n===ah)return i.LUMINANCE;if(n===oh)return i.LUMINANCE_ALPHA;if(n===ji)return i.DEPTH_COMPONENT;if(n===rs)return i.DEPTH_STENCIL;if(n===lh)return i.RED;if(n===ol)return i.RED_INTEGER;if(n===ch)return i.RG;if(n===ll)return i.RG_INTEGER;if(n===cl)return i.RGBA_INTEGER;if(n===xr||n===br||n===Mr||n===wr)if(a===tt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===xr)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===br)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Mr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===wr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===xr)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===br)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Mr)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===wr)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===eo||n===to||n===no||n===io)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===eo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===to)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===no)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===io)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===so||n===ro||n===ao)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===so||n===ro)return a===tt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===ao)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===oo||n===lo||n===co||n===ho||n===uo||n===fo||n===po||n===mo||n===go||n===vo||n===yo||n===_o||n===xo||n===bo)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===oo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===lo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===co)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===ho)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===uo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===fo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===po)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===mo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===go)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===vo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===yo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===_o)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===xo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===bo)return a===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Sr||n===Mo||n===wo)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Sr)return a===tt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Mo)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===wo)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===hh||n===So||n===Eo||n===To)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===Sr)return r.COMPRESSED_RED_RGTC1_EXT;if(n===So)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Eo)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===To)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===ss?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}var Wo=class extends It{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}},Ki=class extends an{constructor(){super(),this.isGroup=!0,this.type="Group"}},Vg={type:"move"},Cs=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ki,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ki,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new H,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new H),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ki,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new H,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new H),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(let _ of e.hand.values()){let g=t.getJointPose(_,n),f=this._getHandJoint(c,_);g!==null&&(f.matrix.fromArray(g.transform.matrix),f.matrix.decompose(f.position,f.rotation,f.scale),f.matrixWorldNeedsUpdate=!0,f.jointRadius=g.radius),f.visible=g!==null}let h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],d=h.position.distanceTo(u.position),m=.02,v=.005;c.inputState.pinching&&d>m+v?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&d<=m-v&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));o!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(Vg)))}return o!==null&&(o.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new Ki;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},Hg=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Gg=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Xo=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){let s=new Yt,r=e.properties.get(s);r.__webglTexture=t.texture,(t.depthNear!=n.depthNear||t.depthFar!=n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=s}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new At({vertexShader:Hg,fragmentShader:Gg,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new mt(new Nr(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},$o=class extends jn{constructor(e,t){super();let n=this,s=null,r=1,a=null,o="local-floor",l=1,c=null,h=null,u=null,d=null,m=null,v=null,_=new Xo,g=t.getContextAttributes(),f=null,T=null,E=[],x=[],U=new nt,A=null,C=new It;C.viewport=new ft;let N=new It;N.viewport=new ft;let w=[C,N],M=new Wo,R=null,q=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Y){let ne=E[Y];return ne===void 0&&(ne=new Cs,E[Y]=ne),ne.getTargetRaySpace()},this.getControllerGrip=function(Y){let ne=E[Y];return ne===void 0&&(ne=new Cs,E[Y]=ne),ne.getGripSpace()},this.getHand=function(Y){let ne=E[Y];return ne===void 0&&(ne=new Cs,E[Y]=ne),ne.getHandSpace()};function B(Y){let ne=x.indexOf(Y.inputSource);if(ne===-1)return;let xe=E[ne];xe!==void 0&&(xe.update(Y.inputSource,Y.frame,c||a),xe.dispatchEvent({type:Y.type,data:Y.inputSource}))}function $(){s.removeEventListener("select",B),s.removeEventListener("selectstart",B),s.removeEventListener("selectend",B),s.removeEventListener("squeeze",B),s.removeEventListener("squeezestart",B),s.removeEventListener("squeezeend",B),s.removeEventListener("end",$),s.removeEventListener("inputsourceschange",G);for(let Y=0;Y<E.length;Y++){let ne=x[Y];ne!==null&&(x[Y]=null,E[Y].disconnect(ne))}R=null,q=null,_.reset(),e.setRenderTarget(f),m=null,d=null,u=null,s=null,T=null,Fe.stop(),n.isPresenting=!1,e.setPixelRatio(A),e.setSize(U.width,U.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Y){r=Y,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Y){o=Y,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(Y){c=Y},this.getBaseLayer=function(){return d!==null?d:m},this.getBinding=function(){return u},this.getFrame=function(){return v},this.getSession=function(){return s},this.setSession=async function(Y){if(s=Y,s!==null){if(f=e.getRenderTarget(),s.addEventListener("select",B),s.addEventListener("selectstart",B),s.addEventListener("selectend",B),s.addEventListener("squeeze",B),s.addEventListener("squeezestart",B),s.addEventListener("squeezeend",B),s.addEventListener("end",$),s.addEventListener("inputsourceschange",G),g.xrCompatible!==!0&&await t.makeXRCompatible(),A=e.getPixelRatio(),e.getSize(U),s.renderState.layers===void 0){let ne={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:r};m=new XRWebGLLayer(s,t,ne),s.updateRenderState({baseLayer:m}),e.setPixelRatio(1),e.setSize(m.framebufferWidth,m.framebufferHeight,!1),T=new Rn(m.framebufferWidth,m.framebufferHeight,{format:sn,type:Cn,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil})}else{let ne=null,xe=null,le=null;g.depth&&(le=g.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ne=g.stencil?rs:ji,xe=g.stencil?ss:bi);let Ie={colorFormat:t.RGBA8,depthFormat:le,scaleFactor:r};u=new XRWebGLBinding(s,t),d=u.createProjectionLayer(Ie),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),T=new Rn(d.textureWidth,d.textureHeight,{format:sn,type:Cn,depthTexture:new kr(d.textureWidth,d.textureHeight,xe,void 0,void 0,void 0,void 0,void 0,void 0,ne),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1})}T.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await s.requestReferenceSpace(o),Fe.setContext(s),Fe.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function G(Y){for(let ne=0;ne<Y.removed.length;ne++){let xe=Y.removed[ne],le=x.indexOf(xe);le>=0&&(x[le]=null,E[le].disconnect(xe))}for(let ne=0;ne<Y.added.length;ne++){let xe=Y.added[ne],le=x.indexOf(xe);if(le===-1){for(let De=0;De<E.length;De++)if(De>=x.length){x.push(xe),le=De;break}else if(x[De]===null){x[De]=xe,le=De;break}if(le===-1)break}let Ie=E[le];Ie&&Ie.connect(xe)}}let P=new H,W=new H;function O(Y,ne,xe){P.setFromMatrixPosition(ne.matrixWorld),W.setFromMatrixPosition(xe.matrixWorld);let le=P.distanceTo(W),Ie=ne.projectionMatrix.elements,De=xe.projectionMatrix.elements,ze=Ie[14]/(Ie[10]-1),ht=Ie[14]/(Ie[10]+1),We=(Ie[9]+1)/Ie[5],dt=(Ie[9]-1)/Ie[5],F=(Ie[8]-1)/Ie[0],Gt=(De[8]+1)/De[0],Ve=ze*F,He=ze*Gt,Te=le/(-F+Gt),at=Te*-F;if(ne.matrixWorld.decompose(Y.position,Y.quaternion,Y.scale),Y.translateX(at),Y.translateZ(Te),Y.matrixWorld.compose(Y.position,Y.quaternion,Y.scale),Y.matrixWorldInverse.copy(Y.matrixWorld).invert(),Ie[10]===-1)Y.projectionMatrix.copy(ne.projectionMatrix),Y.projectionMatrixInverse.copy(ne.projectionMatrixInverse);else{let Se=ze+Te,S=ht+Te,y=Ve-at,k=He+(le-at),J=We*ht/S*Se,Q=dt*ht/S*Se;Y.projectionMatrix.makePerspective(y,k,J,Q,Se,S),Y.projectionMatrixInverse.copy(Y.projectionMatrix).invert()}}function Z(Y,ne){ne===null?Y.matrixWorld.copy(Y.matrix):Y.matrixWorld.multiplyMatrices(ne.matrixWorld,Y.matrix),Y.matrixWorldInverse.copy(Y.matrixWorld).invert()}this.updateCamera=function(Y){if(s===null)return;let ne=Y.near,xe=Y.far;_.texture!==null&&(_.depthNear>0&&(ne=_.depthNear),_.depthFar>0&&(xe=_.depthFar)),M.near=N.near=C.near=ne,M.far=N.far=C.far=xe,(R!==M.near||q!==M.far)&&(s.updateRenderState({depthNear:M.near,depthFar:M.far}),R=M.near,q=M.far),C.layers.mask=Y.layers.mask|2,N.layers.mask=Y.layers.mask|4,M.layers.mask=C.layers.mask|N.layers.mask;let le=Y.parent,Ie=M.cameras;Z(M,le);for(let De=0;De<Ie.length;De++)Z(Ie[De],le);Ie.length===2?O(M,C,N):M.projectionMatrix.copy(C.projectionMatrix),ie(Y,M,le)};function ie(Y,ne,xe){xe===null?Y.matrix.copy(ne.matrixWorld):(Y.matrix.copy(xe.matrixWorld),Y.matrix.invert(),Y.matrix.multiply(ne.matrixWorld)),Y.matrix.decompose(Y.position,Y.quaternion,Y.scale),Y.updateMatrixWorld(!0),Y.projectionMatrix.copy(ne.projectionMatrix),Y.projectionMatrixInverse.copy(ne.projectionMatrixInverse),Y.isPerspectiveCamera&&(Y.fov=Co*2*Math.atan(1/Y.projectionMatrix.elements[5]),Y.zoom=1)}this.getCamera=function(){return M},this.getFoveation=function(){if(!(d===null&&m===null))return l},this.setFoveation=function(Y){l=Y,d!==null&&(d.fixedFoveation=Y),m!==null&&m.fixedFoveation!==void 0&&(m.fixedFoveation=Y)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(M)};let fe=null;function Ce(Y,ne){if(h=ne.getViewerPose(c||a),v=ne,h!==null){let xe=h.views;m!==null&&(e.setRenderTargetFramebuffer(T,m.framebuffer),e.setRenderTarget(T));let le=!1;xe.length!==M.cameras.length&&(M.cameras.length=0,le=!0);for(let De=0;De<xe.length;De++){let ze=xe[De],ht=null;if(m!==null)ht=m.getViewport(ze);else{let dt=u.getViewSubImage(d,ze);ht=dt.viewport,De===0&&(e.setRenderTargetTextures(T,dt.colorTexture,d.ignoreDepthValues?void 0:dt.depthStencilTexture),e.setRenderTarget(T))}let We=w[De];We===void 0&&(We=new It,We.layers.enable(De),We.viewport=new ft,w[De]=We),We.matrix.fromArray(ze.transform.matrix),We.matrix.decompose(We.position,We.quaternion,We.scale),We.projectionMatrix.fromArray(ze.projectionMatrix),We.projectionMatrixInverse.copy(We.projectionMatrix).invert(),We.viewport.set(ht.x,ht.y,ht.width,ht.height),De===0&&(M.matrix.copy(We.matrix),M.matrix.decompose(M.position,M.quaternion,M.scale)),le===!0&&M.cameras.push(We)}let Ie=s.enabledFeatures;if(Ie&&Ie.includes("depth-sensing")){let De=u.getDepthInformation(xe[0]);De&&De.isValid&&De.texture&&_.init(e,De,s.renderState)}}for(let xe=0;xe<E.length;xe++){let le=x[xe],Ie=E[xe];le!==null&&Ie!==void 0&&Ie.update(le,ne,c||a)}fe&&fe(Y,ne),ne.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ne}),v=null}let Fe=new mh;Fe.setAnimationLoop(Ce),this.setAnimationLoop=function(Y){fe=Y},this.dispose=function(){}}},pi=new In,Wg=new yt;function Xg(i,e){function t(g,f){g.matrixAutoUpdate===!0&&g.updateMatrix(),f.value.copy(g.matrix)}function n(g,f){f.color.getRGB(g.fogColor.value,ph(i)),f.isFog?(g.fogNear.value=f.near,g.fogFar.value=f.far):f.isFogExp2&&(g.fogDensity.value=f.density)}function s(g,f,T,E,x){f.isMeshBasicMaterial||f.isMeshLambertMaterial?r(g,f):f.isMeshToonMaterial?(r(g,f),u(g,f)):f.isMeshPhongMaterial?(r(g,f),h(g,f)):f.isMeshStandardMaterial?(r(g,f),d(g,f),f.isMeshPhysicalMaterial&&m(g,f,x)):f.isMeshMatcapMaterial?(r(g,f),v(g,f)):f.isMeshDepthMaterial?r(g,f):f.isMeshDistanceMaterial?(r(g,f),_(g,f)):f.isMeshNormalMaterial?r(g,f):f.isLineBasicMaterial?(a(g,f),f.isLineDashedMaterial&&o(g,f)):f.isPointsMaterial?l(g,f,T,E):f.isSpriteMaterial?c(g,f):f.isShadowMaterial?(g.color.value.copy(f.color),g.opacity.value=f.opacity):f.isShaderMaterial&&(f.uniformsNeedUpdate=!1)}function r(g,f){g.opacity.value=f.opacity,f.color&&g.diffuse.value.copy(f.color),f.emissive&&g.emissive.value.copy(f.emissive).multiplyScalar(f.emissiveIntensity),f.map&&(g.map.value=f.map,t(f.map,g.mapTransform)),f.alphaMap&&(g.alphaMap.value=f.alphaMap,t(f.alphaMap,g.alphaMapTransform)),f.bumpMap&&(g.bumpMap.value=f.bumpMap,t(f.bumpMap,g.bumpMapTransform),g.bumpScale.value=f.bumpScale,f.side===Nt&&(g.bumpScale.value*=-1)),f.normalMap&&(g.normalMap.value=f.normalMap,t(f.normalMap,g.normalMapTransform),g.normalScale.value.copy(f.normalScale),f.side===Nt&&g.normalScale.value.negate()),f.displacementMap&&(g.displacementMap.value=f.displacementMap,t(f.displacementMap,g.displacementMapTransform),g.displacementScale.value=f.displacementScale,g.displacementBias.value=f.displacementBias),f.emissiveMap&&(g.emissiveMap.value=f.emissiveMap,t(f.emissiveMap,g.emissiveMapTransform)),f.specularMap&&(g.specularMap.value=f.specularMap,t(f.specularMap,g.specularMapTransform)),f.alphaTest>0&&(g.alphaTest.value=f.alphaTest);let T=e.get(f),E=T.envMap,x=T.envMapRotation;E&&(g.envMap.value=E,pi.copy(x),pi.x*=-1,pi.y*=-1,pi.z*=-1,E.isCubeTexture&&E.isRenderTargetTexture===!1&&(pi.y*=-1,pi.z*=-1),g.envMapRotation.value.setFromMatrix4(Wg.makeRotationFromEuler(pi)),g.flipEnvMap.value=E.isCubeTexture&&E.isRenderTargetTexture===!1?-1:1,g.reflectivity.value=f.reflectivity,g.ior.value=f.ior,g.refractionRatio.value=f.refractionRatio),f.lightMap&&(g.lightMap.value=f.lightMap,g.lightMapIntensity.value=f.lightMapIntensity,t(f.lightMap,g.lightMapTransform)),f.aoMap&&(g.aoMap.value=f.aoMap,g.aoMapIntensity.value=f.aoMapIntensity,t(f.aoMap,g.aoMapTransform))}function a(g,f){g.diffuse.value.copy(f.color),g.opacity.value=f.opacity,f.map&&(g.map.value=f.map,t(f.map,g.mapTransform))}function o(g,f){g.dashSize.value=f.dashSize,g.totalSize.value=f.dashSize+f.gapSize,g.scale.value=f.scale}function l(g,f,T,E){g.diffuse.value.copy(f.color),g.opacity.value=f.opacity,g.size.value=f.size*T,g.scale.value=E*.5,f.map&&(g.map.value=f.map,t(f.map,g.uvTransform)),f.alphaMap&&(g.alphaMap.value=f.alphaMap,t(f.alphaMap,g.alphaMapTransform)),f.alphaTest>0&&(g.alphaTest.value=f.alphaTest)}function c(g,f){g.diffuse.value.copy(f.color),g.opacity.value=f.opacity,g.rotation.value=f.rotation,f.map&&(g.map.value=f.map,t(f.map,g.mapTransform)),f.alphaMap&&(g.alphaMap.value=f.alphaMap,t(f.alphaMap,g.alphaMapTransform)),f.alphaTest>0&&(g.alphaTest.value=f.alphaTest)}function h(g,f){g.specular.value.copy(f.specular),g.shininess.value=Math.max(f.shininess,1e-4)}function u(g,f){f.gradientMap&&(g.gradientMap.value=f.gradientMap)}function d(g,f){g.metalness.value=f.metalness,f.metalnessMap&&(g.metalnessMap.value=f.metalnessMap,t(f.metalnessMap,g.metalnessMapTransform)),g.roughness.value=f.roughness,f.roughnessMap&&(g.roughnessMap.value=f.roughnessMap,t(f.roughnessMap,g.roughnessMapTransform)),f.envMap&&(g.envMapIntensity.value=f.envMapIntensity)}function m(g,f,T){g.ior.value=f.ior,f.sheen>0&&(g.sheenColor.value.copy(f.sheenColor).multiplyScalar(f.sheen),g.sheenRoughness.value=f.sheenRoughness,f.sheenColorMap&&(g.sheenColorMap.value=f.sheenColorMap,t(f.sheenColorMap,g.sheenColorMapTransform)),f.sheenRoughnessMap&&(g.sheenRoughnessMap.value=f.sheenRoughnessMap,t(f.sheenRoughnessMap,g.sheenRoughnessMapTransform))),f.clearcoat>0&&(g.clearcoat.value=f.clearcoat,g.clearcoatRoughness.value=f.clearcoatRoughness,f.clearcoatMap&&(g.clearcoatMap.value=f.clearcoatMap,t(f.clearcoatMap,g.clearcoatMapTransform)),f.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=f.clearcoatRoughnessMap,t(f.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),f.clearcoatNormalMap&&(g.clearcoatNormalMap.value=f.clearcoatNormalMap,t(f.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(f.clearcoatNormalScale),f.side===Nt&&g.clearcoatNormalScale.value.negate())),f.dispersion>0&&(g.dispersion.value=f.dispersion),f.iridescence>0&&(g.iridescence.value=f.iridescence,g.iridescenceIOR.value=f.iridescenceIOR,g.iridescenceThicknessMinimum.value=f.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=f.iridescenceThicknessRange[1],f.iridescenceMap&&(g.iridescenceMap.value=f.iridescenceMap,t(f.iridescenceMap,g.iridescenceMapTransform)),f.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=f.iridescenceThicknessMap,t(f.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),f.transmission>0&&(g.transmission.value=f.transmission,g.transmissionSamplerMap.value=T.texture,g.transmissionSamplerSize.value.set(T.width,T.height),f.transmissionMap&&(g.transmissionMap.value=f.transmissionMap,t(f.transmissionMap,g.transmissionMapTransform)),g.thickness.value=f.thickness,f.thicknessMap&&(g.thicknessMap.value=f.thicknessMap,t(f.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=f.attenuationDistance,g.attenuationColor.value.copy(f.attenuationColor)),f.anisotropy>0&&(g.anisotropyVector.value.set(f.anisotropy*Math.cos(f.anisotropyRotation),f.anisotropy*Math.sin(f.anisotropyRotation)),f.anisotropyMap&&(g.anisotropyMap.value=f.anisotropyMap,t(f.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=f.specularIntensity,g.specularColor.value.copy(f.specularColor),f.specularColorMap&&(g.specularColorMap.value=f.specularColorMap,t(f.specularColorMap,g.specularColorMapTransform)),f.specularIntensityMap&&(g.specularIntensityMap.value=f.specularIntensityMap,t(f.specularIntensityMap,g.specularIntensityMapTransform))}function v(g,f){f.matcap&&(g.matcap.value=f.matcap)}function _(g,f){let T=e.get(f).light;g.referencePosition.value.setFromMatrixPosition(T.matrixWorld),g.nearDistance.value=T.shadow.camera.near,g.farDistance.value=T.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function $g(i,e,t,n){let s={},r={},a=[],o=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(T,E){let x=E.program;n.uniformBlockBinding(T,x)}function c(T,E){let x=s[T.id];x===void 0&&(v(T),x=h(T),s[T.id]=x,T.addEventListener("dispose",g));let U=E.program;n.updateUBOMapping(T,U);let A=e.render.frame;r[T.id]!==A&&(d(T),r[T.id]=A)}function h(T){let E=u();T.__bindingPointIndex=E;let x=i.createBuffer(),U=T.__size,A=T.usage;return i.bindBuffer(i.UNIFORM_BUFFER,x),i.bufferData(i.UNIFORM_BUFFER,U,A),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,E,x),x}function u(){for(let T=0;T<o;T++)if(a.indexOf(T)===-1)return a.push(T),T;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(T){let E=s[T.id],x=T.uniforms,U=T.__cache;i.bindBuffer(i.UNIFORM_BUFFER,E);for(let A=0,C=x.length;A<C;A++){let N=Array.isArray(x[A])?x[A]:[x[A]];for(let w=0,M=N.length;w<M;w++){let R=N[w];if(m(R,A,w,U)===!0){let q=R.__offset,B=Array.isArray(R.value)?R.value:[R.value],$=0;for(let G=0;G<B.length;G++){let P=B[G],W=_(P);typeof P=="number"||typeof P=="boolean"?(R.__data[0]=P,i.bufferSubData(i.UNIFORM_BUFFER,q+$,R.__data)):P.isMatrix3?(R.__data[0]=P.elements[0],R.__data[1]=P.elements[1],R.__data[2]=P.elements[2],R.__data[3]=0,R.__data[4]=P.elements[3],R.__data[5]=P.elements[4],R.__data[6]=P.elements[5],R.__data[7]=0,R.__data[8]=P.elements[6],R.__data[9]=P.elements[7],R.__data[10]=P.elements[8],R.__data[11]=0):(P.toArray(R.__data,$),$+=W.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,q,R.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function m(T,E,x,U){let A=T.value,C=E+"_"+x;if(U[C]===void 0)return typeof A=="number"||typeof A=="boolean"?U[C]=A:U[C]=A.clone(),!0;{let N=U[C];if(typeof A=="number"||typeof A=="boolean"){if(N!==A)return U[C]=A,!0}else if(N.equals(A)===!1)return N.copy(A),!0}return!1}function v(T){let E=T.uniforms,x=0,U=16;for(let C=0,N=E.length;C<N;C++){let w=Array.isArray(E[C])?E[C]:[E[C]];for(let M=0,R=w.length;M<R;M++){let q=w[M],B=Array.isArray(q.value)?q.value:[q.value];for(let $=0,G=B.length;$<G;$++){let P=B[$],W=_(P),O=x%U,Z=O%W.boundary,ie=O+Z;x+=Z,ie!==0&&U-ie<W.storage&&(x+=U-ie),q.__data=new Float32Array(W.storage/Float32Array.BYTES_PER_ELEMENT),q.__offset=x,x+=W.storage}}}let A=x%U;return A>0&&(x+=U-A),T.__size=x,T.__cache={},this}function _(T){let E={boundary:0,storage:0};return typeof T=="number"||typeof T=="boolean"?(E.boundary=4,E.storage=4):T.isVector2?(E.boundary=8,E.storage=8):T.isVector3||T.isColor?(E.boundary=16,E.storage=12):T.isVector4?(E.boundary=16,E.storage=16):T.isMatrix3?(E.boundary=48,E.storage=48):T.isMatrix4?(E.boundary=64,E.storage=64):T.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",T),E}function g(T){let E=T.target;E.removeEventListener("dispose",g);let x=a.indexOf(E.__bindingPointIndex);a.splice(x,1),i.deleteBuffer(s[E.id]),delete s[E.id],delete r[E.id]}function f(){for(let T in s)i.deleteBuffer(s[T]);a=[],s={},r={}}return{bind:l,update:c,dispose:f}}var Br=class{constructor(e={}){let{canvas:t=Zu(),context:n=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reverseDepthBuffer:d=!1}=e;this.isWebGLRenderer=!0;let m;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");m=n.getContextAttributes().alpha}else m=a;let v=new Uint32Array(4),_=new Int32Array(4),g=null,f=null,T=[],E=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=qt,this.toneMapping=Kn,this.toneMappingExposure=1;let x=this,U=!1,A=0,C=0,N=null,w=-1,M=null,R=new ft,q=new ft,B=null,$=new Ye(0),G=0,P=t.width,W=t.height,O=1,Z=null,ie=null,fe=new ft(0,0,P,W),Ce=new ft(0,0,P,W),Fe=!1,Y=new Ur,ne=!1,xe=!1,le=new yt,Ie=new yt,De=new H,ze=new ft,ht={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},We=!1;function dt(){return N===null?O:1}let F=n;function Gt(b,L){return t.getContext(b,L)}try{let b={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${il}`),t.addEventListener("webglcontextlost",j,!1),t.addEventListener("webglcontextrestored",de,!1),t.addEventListener("webglcontextcreationerror",he,!1),F===null){let L="webgl2";if(F=Gt(L,b),F===null)throw Gt(L)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(b){throw console.error("THREE.WebGLRenderer: "+b.message),b}let Ve,He,Te,at,Se,S,y,k,J,Q,K,be,ce,pe,Xe,ee,me,Re,Pe,ge,Ge,ke,it,I;function ae(){Ve=new lm(F),Ve.init(),ke=new zg(F,Ve),He=new nm(F,Ve,e,ke),Te=new Og(F,Ve),He.reverseDepthBuffer&&d&&Te.buffers.depth.setReversed(!0),at=new um(F),Se=new Sg,S=new Bg(F,Ve,Te,Se,He,ke,at),y=new sm(x),k=new om(x),J=new vd(F),it=new em(F,J),Q=new cm(F,J,at,it),K=new fm(F,Q,J,at),Pe=new dm(F,He,S),ee=new im(Se),be=new wg(x,y,k,Ve,He,it,ee),ce=new Xg(x,Se),pe=new Tg,Xe=new Lg(Ve),Re=new Qp(x,y,k,Te,K,m,l),me=new Ug(x,K,He),I=new $g(F,at,He,Te),ge=new tm(F,Ve,at),Ge=new hm(F,Ve,at),at.programs=be.programs,x.capabilities=He,x.extensions=Ve,x.properties=Se,x.renderLists=pe,x.shadowMap=me,x.state=Te,x.info=at}ae();let X=new $o(x,F);this.xr=X,this.getContext=function(){return F},this.getContextAttributes=function(){return F.getContextAttributes()},this.forceContextLoss=function(){let b=Ve.get("WEBGL_lose_context");b&&b.loseContext()},this.forceContextRestore=function(){let b=Ve.get("WEBGL_lose_context");b&&b.restoreContext()},this.getPixelRatio=function(){return O},this.setPixelRatio=function(b){b!==void 0&&(O=b,this.setSize(P,W,!1))},this.getSize=function(b){return b.set(P,W)},this.setSize=function(b,L,z=!0){if(X.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}P=b,W=L,t.width=Math.floor(b*O),t.height=Math.floor(L*O),z===!0&&(t.style.width=b+"px",t.style.height=L+"px"),this.setViewport(0,0,b,L)},this.getDrawingBufferSize=function(b){return b.set(P*O,W*O).floor()},this.setDrawingBufferSize=function(b,L,z){P=b,W=L,O=z,t.width=Math.floor(b*z),t.height=Math.floor(L*z),this.setViewport(0,0,b,L)},this.getCurrentViewport=function(b){return b.copy(R)},this.getViewport=function(b){return b.copy(fe)},this.setViewport=function(b,L,z,V){b.isVector4?fe.set(b.x,b.y,b.z,b.w):fe.set(b,L,z,V),Te.viewport(R.copy(fe).multiplyScalar(O).round())},this.getScissor=function(b){return b.copy(Ce)},this.setScissor=function(b,L,z,V){b.isVector4?Ce.set(b.x,b.y,b.z,b.w):Ce.set(b,L,z,V),Te.scissor(q.copy(Ce).multiplyScalar(O).round())},this.getScissorTest=function(){return Fe},this.setScissorTest=function(b){Te.setScissorTest(Fe=b)},this.setOpaqueSort=function(b){Z=b},this.setTransparentSort=function(b){ie=b},this.getClearColor=function(b){return b.copy(Re.getClearColor())},this.setClearColor=function(){Re.setClearColor.apply(Re,arguments)},this.getClearAlpha=function(){return Re.getClearAlpha()},this.setClearAlpha=function(){Re.setClearAlpha.apply(Re,arguments)},this.clear=function(b=!0,L=!0,z=!0){let V=0;if(b){let D=!1;if(N!==null){let te=N.texture.format;D=te===cl||te===ll||te===ol}if(D){let te=N.texture.type,ue=te===Cn||te===bi||te===Is||te===ss||te===rl||te===al,ve=Re.getClearColor(),ye=Re.getClearAlpha(),Le=ve.r,Ne=ve.g,_e=ve.b;ue?(v[0]=Le,v[1]=Ne,v[2]=_e,v[3]=ye,F.clearBufferuiv(F.COLOR,0,v)):(_[0]=Le,_[1]=Ne,_[2]=_e,_[3]=ye,F.clearBufferiv(F.COLOR,0,_))}else V|=F.COLOR_BUFFER_BIT}L&&(V|=F.DEPTH_BUFFER_BIT),z&&(V|=F.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),F.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",j,!1),t.removeEventListener("webglcontextrestored",de,!1),t.removeEventListener("webglcontextcreationerror",he,!1),pe.dispose(),Xe.dispose(),Se.dispose(),y.dispose(),k.dispose(),K.dispose(),it.dispose(),I.dispose(),be.dispose(),X.dispose(),X.removeEventListener("sessionstart",Il),X.removeEventListener("sessionend",Pl),si.stop()};function j(b){b.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),U=!0}function de(){console.log("THREE.WebGLRenderer: Context Restored."),U=!1;let b=at.autoReset,L=me.enabled,z=me.autoUpdate,V=me.needsUpdate,D=me.type;ae(),at.autoReset=b,me.enabled=L,me.autoUpdate=z,me.needsUpdate=V,me.type=D}function he(b){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",b.statusMessage)}function Ue(b){let L=b.target;L.removeEventListener("dispose",Ue),ut(L)}function ut(b){St(b),Se.remove(b)}function St(b){let L=Se.get(b).programs;L!==void 0&&(L.forEach(function(z){be.releaseProgram(z)}),b.isShaderMaterial&&be.releaseShaderCache(b))}this.renderBufferDirect=function(b,L,z,V,D,te){L===null&&(L=ht);let ue=D.isMesh&&D.matrixWorld.determinant()<0,ve=$h(b,L,z,V,D);Te.setMaterial(V,ue);let ye=z.index,Le=1;if(V.wireframe===!0){if(ye=Q.getWireframeAttribute(z),ye===void 0)return;Le=2}let Ne=z.drawRange,_e=z.attributes.position,qe=Ne.start*Le,st=(Ne.start+Ne.count)*Le;te!==null&&(qe=Math.max(qe,te.start*Le),st=Math.min(st,(te.start+te.count)*Le)),ye!==null?(qe=Math.max(qe,0),st=Math.min(st,ye.count)):_e!=null&&(qe=Math.max(qe,0),st=Math.min(st,_e.count));let ot=st-qe;if(ot<0||ot===1/0)return;it.setup(D,V,ve,z,ye);let Pt,je=ge;if(ye!==null&&(Pt=J.get(ye),je=Ge,je.setIndex(Pt)),D.isMesh)V.wireframe===!0?(Te.setLineWidth(V.wireframeLinewidth*dt()),je.setMode(F.LINES)):je.setMode(F.TRIANGLES);else if(D.isLine){let Me=V.linewidth;Me===void 0&&(Me=1),Te.setLineWidth(Me*dt()),D.isLineSegments?je.setMode(F.LINES):D.isLineLoop?je.setMode(F.LINE_LOOP):je.setMode(F.LINE_STRIP)}else D.isPoints?je.setMode(F.POINTS):D.isSprite&&je.setMode(F.TRIANGLES);if(D.isBatchedMesh)if(D._multiDrawInstances!==null)je.renderMultiDrawInstances(D._multiDrawStarts,D._multiDrawCounts,D._multiDrawCount,D._multiDrawInstances);else if(Ve.get("WEBGL_multi_draw"))je.renderMultiDraw(D._multiDrawStarts,D._multiDrawCounts,D._multiDrawCount);else{let Me=D._multiDrawStarts,mn=D._multiDrawCounts,Qe=D._multiDrawCount,jt=ye?J.get(ye).bytesPerElement:1,Ii=Se.get(V).currentProgram.getUniforms();for(let kt=0;kt<Qe;kt++)Ii.setValue(F,"_gl_DrawID",kt),je.render(Me[kt]/jt,mn[kt])}else if(D.isInstancedMesh)je.renderInstances(qe,ot,D.count);else if(z.isInstancedBufferGeometry){let Me=z._maxInstanceCount!==void 0?z._maxInstanceCount:1/0,mn=Math.min(z.instanceCount,Me);je.renderInstances(qe,ot,mn)}else je.render(qe,ot)};function et(b,L,z){b.transparent===!0&&b.side===Vt&&b.forceSinglePass===!1?(b.side=Nt,b.needsUpdate=!0,zs(b,L,z),b.side=Jn,b.needsUpdate=!0,zs(b,L,z),b.side=Vt):zs(b,L,z)}this.compile=function(b,L,z=null){z===null&&(z=b),f=Xe.get(z),f.init(L),E.push(f),z.traverseVisible(function(D){D.isLight&&D.layers.test(L.layers)&&(f.pushLight(D),D.castShadow&&f.pushShadow(D))}),b!==z&&b.traverseVisible(function(D){D.isLight&&D.layers.test(L.layers)&&(f.pushLight(D),D.castShadow&&f.pushShadow(D))}),f.setupLights();let V=new Set;return b.traverse(function(D){if(!(D.isMesh||D.isPoints||D.isLine||D.isSprite))return;let te=D.material;if(te)if(Array.isArray(te))for(let ue=0;ue<te.length;ue++){let ve=te[ue];et(ve,z,D),V.add(ve)}else et(te,z,D),V.add(te)}),E.pop(),f=null,V},this.compileAsync=function(b,L,z=null){let V=this.compile(b,L,z);return new Promise(D=>{function te(){if(V.forEach(function(ue){Se.get(ue).currentProgram.isReady()&&V.delete(ue)}),V.size===0){D(b);return}setTimeout(te,10)}Ve.get("KHR_parallel_shader_compile")!==null?te():setTimeout(te,10)})};let Jt=null;function pn(b){Jt&&Jt(b)}function Il(){si.stop()}function Pl(){si.start()}let si=new mh;si.setAnimationLoop(pn),typeof self<"u"&&si.setContext(self),this.setAnimationLoop=function(b){Jt=b,X.setAnimationLoop(b),b===null?si.stop():si.start()},X.addEventListener("sessionstart",Il),X.addEventListener("sessionend",Pl),this.render=function(b,L){if(L!==void 0&&L.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(U===!0)return;if(b.matrixWorldAutoUpdate===!0&&b.updateMatrixWorld(),L.parent===null&&L.matrixWorldAutoUpdate===!0&&L.updateMatrixWorld(),X.enabled===!0&&X.isPresenting===!0&&(X.cameraAutoUpdate===!0&&X.updateCamera(L),L=X.getCamera()),b.isScene===!0&&b.onBeforeRender(x,b,L,N),f=Xe.get(b,E.length),f.init(L),E.push(f),Ie.multiplyMatrices(L.projectionMatrix,L.matrixWorldInverse),Y.setFromProjectionMatrix(Ie),xe=this.localClippingEnabled,ne=ee.init(this.clippingPlanes,xe),g=pe.get(b,T.length),g.init(),T.push(g),X.enabled===!0&&X.isPresenting===!0){let te=x.xr.getDepthSensingMesh();te!==null&&oa(te,L,-1/0,x.sortObjects)}oa(b,L,0,x.sortObjects),g.finish(),x.sortObjects===!0&&g.sort(Z,ie),We=X.enabled===!1||X.isPresenting===!1||X.hasDepthSensing()===!1,We&&Re.addToRenderList(g,b),this.info.render.frame++,ne===!0&&ee.beginShadows();let z=f.state.shadowsArray;me.render(z,b,L),ne===!0&&ee.endShadows(),this.info.autoReset===!0&&this.info.reset();let V=g.opaque,D=g.transmissive;if(f.setupLights(),L.isArrayCamera){let te=L.cameras;if(D.length>0)for(let ue=0,ve=te.length;ue<ve;ue++){let ye=te[ue];Dl(V,D,b,ye)}We&&Re.render(b);for(let ue=0,ve=te.length;ue<ve;ue++){let ye=te[ue];Ll(g,b,ye,ye.viewport)}}else D.length>0&&Dl(V,D,b,L),We&&Re.render(b),Ll(g,b,L);N!==null&&(S.updateMultisampleRenderTarget(N),S.updateRenderTargetMipmap(N)),b.isScene===!0&&b.onAfterRender(x,b,L),it.resetDefaultState(),w=-1,M=null,E.pop(),E.length>0?(f=E[E.length-1],ne===!0&&ee.setGlobalState(x.clippingPlanes,f.state.camera)):f=null,T.pop(),T.length>0?g=T[T.length-1]:g=null};function oa(b,L,z,V){if(b.visible===!1)return;if(b.layers.test(L.layers)){if(b.isGroup)z=b.renderOrder;else if(b.isLOD)b.autoUpdate===!0&&b.update(L);else if(b.isLight)f.pushLight(b),b.castShadow&&f.pushShadow(b);else if(b.isSprite){if(!b.frustumCulled||Y.intersectsSprite(b)){V&&ze.setFromMatrixPosition(b.matrixWorld).applyMatrix4(Ie);let ue=K.update(b),ve=b.material;ve.visible&&g.push(b,ue,ve,z,ze.z,null)}}else if((b.isMesh||b.isLine||b.isPoints)&&(!b.frustumCulled||Y.intersectsObject(b))){let ue=K.update(b),ve=b.material;if(V&&(b.boundingSphere!==void 0?(b.boundingSphere===null&&b.computeBoundingSphere(),ze.copy(b.boundingSphere.center)):(ue.boundingSphere===null&&ue.computeBoundingSphere(),ze.copy(ue.boundingSphere.center)),ze.applyMatrix4(b.matrixWorld).applyMatrix4(Ie)),Array.isArray(ve)){let ye=ue.groups;for(let Le=0,Ne=ye.length;Le<Ne;Le++){let _e=ye[Le],qe=ve[_e.materialIndex];qe&&qe.visible&&g.push(b,ue,qe,z,ze.z,_e)}}else ve.visible&&g.push(b,ue,ve,z,ze.z,null)}}let te=b.children;for(let ue=0,ve=te.length;ue<ve;ue++)oa(te[ue],L,z,V)}function Ll(b,L,z,V){let D=b.opaque,te=b.transmissive,ue=b.transparent;f.setupLightsView(z),ne===!0&&ee.setGlobalState(x.clippingPlanes,z),V&&Te.viewport(R.copy(V)),D.length>0&&Bs(D,L,z),te.length>0&&Bs(te,L,z),ue.length>0&&Bs(ue,L,z),Te.buffers.depth.setTest(!0),Te.buffers.depth.setMask(!0),Te.buffers.color.setMask(!0),Te.setPolygonOffset(!1)}function Dl(b,L,z,V){if((z.isScene===!0?z.overrideMaterial:null)!==null)return;f.state.transmissionRenderTarget[V.id]===void 0&&(f.state.transmissionRenderTarget[V.id]=new Rn(1,1,{generateMipmaps:!0,type:Ve.has("EXT_color_buffer_half_float")||Ve.has("EXT_color_buffer_float")?Ds:Cn,minFilter:xi,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:$e.workingColorSpace}));let te=f.state.transmissionRenderTarget[V.id],ue=V.viewport||R;te.setSize(ue.z,ue.w);let ve=x.getRenderTarget();x.setRenderTarget(te),x.getClearColor($),G=x.getClearAlpha(),G<1&&x.setClearColor(16777215,.5),x.clear(),We&&Re.render(z);let ye=x.toneMapping;x.toneMapping=Kn;let Le=V.viewport;if(V.viewport!==void 0&&(V.viewport=void 0),f.setupLightsView(V),ne===!0&&ee.setGlobalState(x.clippingPlanes,V),Bs(b,z,V),S.updateMultisampleRenderTarget(te),S.updateRenderTargetMipmap(te),Ve.has("WEBGL_multisampled_render_to_texture")===!1){let Ne=!1;for(let _e=0,qe=L.length;_e<qe;_e++){let st=L[_e],ot=st.object,Pt=st.geometry,je=st.material,Me=st.group;if(je.side===Vt&&ot.layers.test(V.layers)){let mn=je.side;je.side=Nt,je.needsUpdate=!0,Fl(ot,z,V,Pt,je,Me),je.side=mn,je.needsUpdate=!0,Ne=!0}}Ne===!0&&(S.updateMultisampleRenderTarget(te),S.updateRenderTargetMipmap(te))}x.setRenderTarget(ve),x.setClearColor($,G),Le!==void 0&&(V.viewport=Le),x.toneMapping=ye}function Bs(b,L,z){let V=L.isScene===!0?L.overrideMaterial:null;for(let D=0,te=b.length;D<te;D++){let ue=b[D],ve=ue.object,ye=ue.geometry,Le=V===null?ue.material:V,Ne=ue.group;ve.layers.test(z.layers)&&Fl(ve,L,z,ye,Le,Ne)}}function Fl(b,L,z,V,D,te){b.onBeforeRender(x,L,z,V,D,te),b.modelViewMatrix.multiplyMatrices(z.matrixWorldInverse,b.matrixWorld),b.normalMatrix.getNormalMatrix(b.modelViewMatrix),D.onBeforeRender(x,L,z,V,b,te),D.transparent===!0&&D.side===Vt&&D.forceSinglePass===!1?(D.side=Nt,D.needsUpdate=!0,x.renderBufferDirect(z,L,V,D,b,te),D.side=Jn,D.needsUpdate=!0,x.renderBufferDirect(z,L,V,D,b,te),D.side=Vt):x.renderBufferDirect(z,L,V,D,b,te),b.onAfterRender(x,L,z,V,D,te)}function zs(b,L,z){L.isScene!==!0&&(L=ht);let V=Se.get(b),D=f.state.lights,te=f.state.shadowsArray,ue=D.state.version,ve=be.getParameters(b,D.state,te,L,z),ye=be.getProgramCacheKey(ve),Le=V.programs;V.environment=b.isMeshStandardMaterial?L.environment:null,V.fog=L.fog,V.envMap=(b.isMeshStandardMaterial?k:y).get(b.envMap||V.environment),V.envMapRotation=V.environment!==null&&b.envMap===null?L.environmentRotation:b.envMapRotation,Le===void 0&&(b.addEventListener("dispose",Ue),Le=new Map,V.programs=Le);let Ne=Le.get(ye);if(Ne!==void 0){if(V.currentProgram===Ne&&V.lightsStateVersion===ue)return Nl(b,ve),Ne}else ve.uniforms=be.getUniforms(b),b.onBeforeCompile(ve,x),Ne=be.acquireProgram(ve,ye),Le.set(ye,Ne),V.uniforms=ve.uniforms;let _e=V.uniforms;return(!b.isShaderMaterial&&!b.isRawShaderMaterial||b.clipping===!0)&&(_e.clippingPlanes=ee.uniform),Nl(b,ve),V.needsLights=Yh(b),V.lightsStateVersion=ue,V.needsLights&&(_e.ambientLightColor.value=D.state.ambient,_e.lightProbe.value=D.state.probe,_e.directionalLights.value=D.state.directional,_e.directionalLightShadows.value=D.state.directionalShadow,_e.spotLights.value=D.state.spot,_e.spotLightShadows.value=D.state.spotShadow,_e.rectAreaLights.value=D.state.rectArea,_e.ltc_1.value=D.state.rectAreaLTC1,_e.ltc_2.value=D.state.rectAreaLTC2,_e.pointLights.value=D.state.point,_e.pointLightShadows.value=D.state.pointShadow,_e.hemisphereLights.value=D.state.hemi,_e.directionalShadowMap.value=D.state.directionalShadowMap,_e.directionalShadowMatrix.value=D.state.directionalShadowMatrix,_e.spotShadowMap.value=D.state.spotShadowMap,_e.spotLightMatrix.value=D.state.spotLightMatrix,_e.spotLightMap.value=D.state.spotLightMap,_e.pointShadowMap.value=D.state.pointShadowMap,_e.pointShadowMatrix.value=D.state.pointShadowMatrix),V.currentProgram=Ne,V.uniformsList=null,Ne}function Ul(b){if(b.uniformsList===null){let L=b.currentProgram.getUniforms();b.uniformsList=es.seqWithValue(L.seq,b.uniforms)}return b.uniformsList}function Nl(b,L){let z=Se.get(b);z.outputColorSpace=L.outputColorSpace,z.batching=L.batching,z.batchingColor=L.batchingColor,z.instancing=L.instancing,z.instancingColor=L.instancingColor,z.instancingMorph=L.instancingMorph,z.skinning=L.skinning,z.morphTargets=L.morphTargets,z.morphNormals=L.morphNormals,z.morphColors=L.morphColors,z.morphTargetsCount=L.morphTargetsCount,z.numClippingPlanes=L.numClippingPlanes,z.numIntersection=L.numClipIntersection,z.vertexAlphas=L.vertexAlphas,z.vertexTangents=L.vertexTangents,z.toneMapping=L.toneMapping}function $h(b,L,z,V,D){L.isScene!==!0&&(L=ht),S.resetTextureUnits();let te=L.fog,ue=V.isMeshStandardMaterial?L.environment:null,ve=N===null?x.outputColorSpace:N.isXRRenderTarget===!0?N.texture.colorSpace:ti,ye=(V.isMeshStandardMaterial?k:y).get(V.envMap||ue),Le=V.vertexColors===!0&&!!z.attributes.color&&z.attributes.color.itemSize===4,Ne=!!z.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),_e=!!z.morphAttributes.position,qe=!!z.morphAttributes.normal,st=!!z.morphAttributes.color,ot=Kn;V.toneMapped&&(N===null||N.isXRRenderTarget===!0)&&(ot=x.toneMapping);let Pt=z.morphAttributes.position||z.morphAttributes.normal||z.morphAttributes.color,je=Pt!==void 0?Pt.length:0,Me=Se.get(V),mn=f.state.lights;if(ne===!0&&(xe===!0||b!==M)){let Wt=b===M&&V.id===w;ee.setState(V,b,Wt)}let Qe=!1;V.version===Me.__version?(Me.needsLights&&Me.lightsStateVersion!==mn.state.version||Me.outputColorSpace!==ve||D.isBatchedMesh&&Me.batching===!1||!D.isBatchedMesh&&Me.batching===!0||D.isBatchedMesh&&Me.batchingColor===!0&&D.colorTexture===null||D.isBatchedMesh&&Me.batchingColor===!1&&D.colorTexture!==null||D.isInstancedMesh&&Me.instancing===!1||!D.isInstancedMesh&&Me.instancing===!0||D.isSkinnedMesh&&Me.skinning===!1||!D.isSkinnedMesh&&Me.skinning===!0||D.isInstancedMesh&&Me.instancingColor===!0&&D.instanceColor===null||D.isInstancedMesh&&Me.instancingColor===!1&&D.instanceColor!==null||D.isInstancedMesh&&Me.instancingMorph===!0&&D.morphTexture===null||D.isInstancedMesh&&Me.instancingMorph===!1&&D.morphTexture!==null||Me.envMap!==ye||V.fog===!0&&Me.fog!==te||Me.numClippingPlanes!==void 0&&(Me.numClippingPlanes!==ee.numPlanes||Me.numIntersection!==ee.numIntersection)||Me.vertexAlphas!==Le||Me.vertexTangents!==Ne||Me.morphTargets!==_e||Me.morphNormals!==qe||Me.morphColors!==st||Me.toneMapping!==ot||Me.morphTargetsCount!==je)&&(Qe=!0):(Qe=!0,Me.__version=V.version);let jt=Me.currentProgram;Qe===!0&&(jt=zs(V,L,D));let Ii=!1,kt=!1,ps=!1,lt=jt.getUniforms(),ln=Me.uniforms;if(Te.useProgram(jt.program)&&(Ii=!0,kt=!0,ps=!0),V.id!==w&&(w=V.id,kt=!0),Ii||M!==b){Te.buffers.depth.getReversed()?(le.copy(b.projectionMatrix),Ju(le),ju(le),lt.setValue(F,"projectionMatrix",le)):lt.setValue(F,"projectionMatrix",b.projectionMatrix),lt.setValue(F,"viewMatrix",b.matrixWorldInverse);let On=lt.map.cameraPosition;On!==void 0&&On.setValue(F,De.setFromMatrixPosition(b.matrixWorld)),He.logarithmicDepthBuffer&&lt.setValue(F,"logDepthBufFC",2/(Math.log(b.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&lt.setValue(F,"isOrthographic",b.isOrthographicCamera===!0),M!==b&&(M=b,kt=!0,ps=!0)}if(D.isSkinnedMesh){lt.setOptional(F,D,"bindMatrix"),lt.setOptional(F,D,"bindMatrixInverse");let Wt=D.skeleton;Wt&&(Wt.boneTexture===null&&Wt.computeBoneTexture(),lt.setValue(F,"boneTexture",Wt.boneTexture,S))}D.isBatchedMesh&&(lt.setOptional(F,D,"batchingTexture"),lt.setValue(F,"batchingTexture",D._matricesTexture,S),lt.setOptional(F,D,"batchingIdTexture"),lt.setValue(F,"batchingIdTexture",D._indirectTexture,S),lt.setOptional(F,D,"batchingColorTexture"),D._colorsTexture!==null&&lt.setValue(F,"batchingColorTexture",D._colorsTexture,S));let ms=z.morphAttributes;if((ms.position!==void 0||ms.normal!==void 0||ms.color!==void 0)&&Pe.update(D,z,jt),(kt||Me.receiveShadow!==D.receiveShadow)&&(Me.receiveShadow=D.receiveShadow,lt.setValue(F,"receiveShadow",D.receiveShadow)),V.isMeshGouraudMaterial&&V.envMap!==null&&(ln.envMap.value=ye,ln.flipEnvMap.value=ye.isCubeTexture&&ye.isRenderTargetTexture===!1?-1:1),V.isMeshStandardMaterial&&V.envMap===null&&L.environment!==null&&(ln.envMapIntensity.value=L.environmentIntensity),kt&&(lt.setValue(F,"toneMappingExposure",x.toneMappingExposure),Me.needsLights&&qh(ln,ps),te&&V.fog===!0&&ce.refreshFogUniforms(ln,te),ce.refreshMaterialUniforms(ln,V,O,W,f.state.transmissionRenderTarget[b.id]),es.upload(F,Ul(Me),ln,S)),V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(es.upload(F,Ul(Me),ln,S),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&lt.setValue(F,"center",D.center),lt.setValue(F,"modelViewMatrix",D.modelViewMatrix),lt.setValue(F,"normalMatrix",D.normalMatrix),lt.setValue(F,"modelMatrix",D.matrixWorld),V.isShaderMaterial||V.isRawShaderMaterial){let Wt=V.uniformsGroups;for(let On=0,kn=Wt.length;On<kn;On++){let Ol=Wt[On];I.update(Ol,jt),I.bind(Ol,jt)}}return jt}function qh(b,L){b.ambientLightColor.needsUpdate=L,b.lightProbe.needsUpdate=L,b.directionalLights.needsUpdate=L,b.directionalLightShadows.needsUpdate=L,b.pointLights.needsUpdate=L,b.pointLightShadows.needsUpdate=L,b.spotLights.needsUpdate=L,b.spotLightShadows.needsUpdate=L,b.rectAreaLights.needsUpdate=L,b.hemisphereLights.needsUpdate=L}function Yh(b){return b.isMeshLambertMaterial||b.isMeshToonMaterial||b.isMeshPhongMaterial||b.isMeshStandardMaterial||b.isShadowMaterial||b.isShaderMaterial&&b.lights===!0}this.getActiveCubeFace=function(){return A},this.getActiveMipmapLevel=function(){return C},this.getRenderTarget=function(){return N},this.setRenderTargetTextures=function(b,L,z){Se.get(b.texture).__webglTexture=L,Se.get(b.depthTexture).__webglTexture=z;let V=Se.get(b);V.__hasExternalTextures=!0,V.__autoAllocateDepthBuffer=z===void 0,V.__autoAllocateDepthBuffer||Ve.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),V.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(b,L){let z=Se.get(b);z.__webglFramebuffer=L,z.__useDefaultFramebuffer=L===void 0},this.setRenderTarget=function(b,L=0,z=0){N=b,A=L,C=z;let V=!0,D=null,te=!1,ue=!1;if(b){let ye=Se.get(b);if(ye.__useDefaultFramebuffer!==void 0)Te.bindFramebuffer(F.FRAMEBUFFER,null),V=!1;else if(ye.__webglFramebuffer===void 0)S.setupRenderTarget(b);else if(ye.__hasExternalTextures)S.rebindTextures(b,Se.get(b.texture).__webglTexture,Se.get(b.depthTexture).__webglTexture);else if(b.depthBuffer){let _e=b.depthTexture;if(ye.__boundDepthTexture!==_e){if(_e!==null&&Se.has(_e)&&(b.width!==_e.image.width||b.height!==_e.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");S.setupDepthRenderbuffer(b)}}let Le=b.texture;(Le.isData3DTexture||Le.isDataArrayTexture||Le.isCompressedArrayTexture)&&(ue=!0);let Ne=Se.get(b).__webglFramebuffer;b.isWebGLCubeRenderTarget?(Array.isArray(Ne[L])?D=Ne[L][z]:D=Ne[L],te=!0):b.samples>0&&S.useMultisampledRTT(b)===!1?D=Se.get(b).__webglMultisampledFramebuffer:Array.isArray(Ne)?D=Ne[z]:D=Ne,R.copy(b.viewport),q.copy(b.scissor),B=b.scissorTest}else R.copy(fe).multiplyScalar(O).floor(),q.copy(Ce).multiplyScalar(O).floor(),B=Fe;if(Te.bindFramebuffer(F.FRAMEBUFFER,D)&&V&&Te.drawBuffers(b,D),Te.viewport(R),Te.scissor(q),Te.setScissorTest(B),te){let ye=Se.get(b.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_CUBE_MAP_POSITIVE_X+L,ye.__webglTexture,z)}else if(ue){let ye=Se.get(b.texture),Le=L||0;F.framebufferTextureLayer(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,ye.__webglTexture,z||0,Le)}w=-1},this.readRenderTargetPixels=function(b,L,z,V,D,te,ue){if(!(b&&b.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let ve=Se.get(b).__webglFramebuffer;if(b.isWebGLCubeRenderTarget&&ue!==void 0&&(ve=ve[ue]),ve){Te.bindFramebuffer(F.FRAMEBUFFER,ve);try{let ye=b.texture,Le=ye.format,Ne=ye.type;if(!He.textureFormatReadable(Le)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!He.textureTypeReadable(Ne)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}L>=0&&L<=b.width-V&&z>=0&&z<=b.height-D&&F.readPixels(L,z,V,D,ke.convert(Le),ke.convert(Ne),te)}finally{let ye=N!==null?Se.get(N).__webglFramebuffer:null;Te.bindFramebuffer(F.FRAMEBUFFER,ye)}}},this.readRenderTargetPixelsAsync=async function(b,L,z,V,D,te,ue){if(!(b&&b.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let ve=Se.get(b).__webglFramebuffer;if(b.isWebGLCubeRenderTarget&&ue!==void 0&&(ve=ve[ue]),ve){let ye=b.texture,Le=ye.format,Ne=ye.type;if(!He.textureFormatReadable(Le))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!He.textureTypeReadable(Ne))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(L>=0&&L<=b.width-V&&z>=0&&z<=b.height-D){Te.bindFramebuffer(F.FRAMEBUFFER,ve);let _e=F.createBuffer();F.bindBuffer(F.PIXEL_PACK_BUFFER,_e),F.bufferData(F.PIXEL_PACK_BUFFER,te.byteLength,F.STREAM_READ),F.readPixels(L,z,V,D,ke.convert(Le),ke.convert(Ne),0);let qe=N!==null?Se.get(N).__webglFramebuffer:null;Te.bindFramebuffer(F.FRAMEBUFFER,qe);let st=F.fenceSync(F.SYNC_GPU_COMMANDS_COMPLETE,0);return F.flush(),await Ku(F,st,4),F.bindBuffer(F.PIXEL_PACK_BUFFER,_e),F.getBufferSubData(F.PIXEL_PACK_BUFFER,0,te),F.deleteBuffer(_e),F.deleteSync(st),te}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(b,L=null,z=0){b.isTexture!==!0&&(Ts("WebGLRenderer: copyFramebufferToTexture function signature has changed."),L=arguments[0]||null,b=arguments[1]);let V=Math.pow(2,-z),D=Math.floor(b.image.width*V),te=Math.floor(b.image.height*V),ue=L!==null?L.x:0,ve=L!==null?L.y:0;S.setTexture2D(b,0),F.copyTexSubImage2D(F.TEXTURE_2D,z,0,0,ue,ve,D,te),Te.unbindTexture()},this.copyTextureToTexture=function(b,L,z=null,V=null,D=0){b.isTexture!==!0&&(Ts("WebGLRenderer: copyTextureToTexture function signature has changed."),V=arguments[0]||null,b=arguments[1],L=arguments[2],D=arguments[3]||0,z=null);let te,ue,ve,ye,Le,Ne,_e,qe,st,ot=b.isCompressedTexture?b.mipmaps[D]:b.image;z!==null?(te=z.max.x-z.min.x,ue=z.max.y-z.min.y,ve=z.isBox3?z.max.z-z.min.z:1,ye=z.min.x,Le=z.min.y,Ne=z.isBox3?z.min.z:0):(te=ot.width,ue=ot.height,ve=ot.depth||1,ye=0,Le=0,Ne=0),V!==null?(_e=V.x,qe=V.y,st=V.z):(_e=0,qe=0,st=0);let Pt=ke.convert(L.format),je=ke.convert(L.type),Me;L.isData3DTexture?(S.setTexture3D(L,0),Me=F.TEXTURE_3D):L.isDataArrayTexture||L.isCompressedArrayTexture?(S.setTexture2DArray(L,0),Me=F.TEXTURE_2D_ARRAY):(S.setTexture2D(L,0),Me=F.TEXTURE_2D),F.pixelStorei(F.UNPACK_FLIP_Y_WEBGL,L.flipY),F.pixelStorei(F.UNPACK_PREMULTIPLY_ALPHA_WEBGL,L.premultiplyAlpha),F.pixelStorei(F.UNPACK_ALIGNMENT,L.unpackAlignment);let mn=F.getParameter(F.UNPACK_ROW_LENGTH),Qe=F.getParameter(F.UNPACK_IMAGE_HEIGHT),jt=F.getParameter(F.UNPACK_SKIP_PIXELS),Ii=F.getParameter(F.UNPACK_SKIP_ROWS),kt=F.getParameter(F.UNPACK_SKIP_IMAGES);F.pixelStorei(F.UNPACK_ROW_LENGTH,ot.width),F.pixelStorei(F.UNPACK_IMAGE_HEIGHT,ot.height),F.pixelStorei(F.UNPACK_SKIP_PIXELS,ye),F.pixelStorei(F.UNPACK_SKIP_ROWS,Le),F.pixelStorei(F.UNPACK_SKIP_IMAGES,Ne);let ps=b.isDataArrayTexture||b.isData3DTexture,lt=L.isDataArrayTexture||L.isData3DTexture;if(b.isRenderTargetTexture||b.isDepthTexture){let ln=Se.get(b),ms=Se.get(L),Wt=Se.get(ln.__renderTarget),On=Se.get(ms.__renderTarget);Te.bindFramebuffer(F.READ_FRAMEBUFFER,Wt.__webglFramebuffer),Te.bindFramebuffer(F.DRAW_FRAMEBUFFER,On.__webglFramebuffer);for(let kn=0;kn<ve;kn++)ps&&F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,Se.get(b).__webglTexture,D,Ne+kn),b.isDepthTexture?(lt&&F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,Se.get(L).__webglTexture,D,st+kn),F.blitFramebuffer(ye,Le,te,ue,_e,qe,te,ue,F.DEPTH_BUFFER_BIT,F.NEAREST)):lt?F.copyTexSubImage3D(Me,D,_e,qe,st+kn,ye,Le,te,ue):F.copyTexSubImage2D(Me,D,_e,qe,st+kn,ye,Le,te,ue);Te.bindFramebuffer(F.READ_FRAMEBUFFER,null),Te.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else lt?b.isDataTexture||b.isData3DTexture?F.texSubImage3D(Me,D,_e,qe,st,te,ue,ve,Pt,je,ot.data):L.isCompressedArrayTexture?F.compressedTexSubImage3D(Me,D,_e,qe,st,te,ue,ve,Pt,ot.data):F.texSubImage3D(Me,D,_e,qe,st,te,ue,ve,Pt,je,ot):b.isDataTexture?F.texSubImage2D(F.TEXTURE_2D,D,_e,qe,te,ue,Pt,je,ot.data):b.isCompressedTexture?F.compressedTexSubImage2D(F.TEXTURE_2D,D,_e,qe,ot.width,ot.height,Pt,ot.data):F.texSubImage2D(F.TEXTURE_2D,D,_e,qe,te,ue,Pt,je,ot);F.pixelStorei(F.UNPACK_ROW_LENGTH,mn),F.pixelStorei(F.UNPACK_IMAGE_HEIGHT,Qe),F.pixelStorei(F.UNPACK_SKIP_PIXELS,jt),F.pixelStorei(F.UNPACK_SKIP_ROWS,Ii),F.pixelStorei(F.UNPACK_SKIP_IMAGES,kt),D===0&&L.generateMipmaps&&F.generateMipmap(Me),Te.unbindTexture()},this.copyTextureToTexture3D=function(b,L,z=null,V=null,D=0){return b.isTexture!==!0&&(Ts("WebGLRenderer: copyTextureToTexture3D function signature has changed."),z=arguments[0]||null,V=arguments[1]||null,b=arguments[2],L=arguments[3],D=arguments[4]||0),Ts('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(b,L,z,V,D)},this.initRenderTarget=function(b){Se.get(b).__webglFramebuffer===void 0&&S.setupRenderTarget(b)},this.initTexture=function(b){b.isCubeTexture?S.setTextureCube(b,0):b.isData3DTexture?S.setTexture3D(b,0):b.isDataArrayTexture||b.isCompressedArrayTexture?S.setTexture2DArray(b,0):S.setTexture2D(b,0),Te.unbindTexture()},this.resetState=function(){A=0,C=0,N=null,Te.reset(),it.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return En}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorspace=$e._getDrawingBufferColorSpace(e),t.unpackColorSpace=$e._getUnpackColorSpace()}};var zr=class extends an{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new In,this.environmentIntensity=1,this.environmentRotation=new In,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}};function _r(i,e,t){return!i||!t&&i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function qg(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}var ls=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];n:{e:{let a;t:{i:if(!(e<s)){for(let o=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(r=s,s=t[++n],e<s)break e}a=t.length;break t}if(!(e>=r)){let o=t[1];e<o&&(n=2,r=o);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(s=r,r=t[--n-1],e>=r)break e}a=n,n=0;break t}break n}for(;n<a;){let o=n+a>>>1;e<t[o]?a=o:n=o+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let a=0;a!==s;++a)t[a]=n[r+a];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},qo=class extends ls{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:nc,endingEnd:nc}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,a=e+1,o=s[r],l=s[a];if(o===void 0)switch(this.getSettings_().endingStart){case ic:r=e,o=2*t-n;break;case sc:r=s.length-2,o=t+s[r]-s[r+1];break;default:r=e,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case ic:a=e,l=2*n-t;break;case sc:a=1,l=n+s[1]-s[0];break;default:a=e-1,l=t}let c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(l-n),this._offsetPrev=r*h,this._offsetNext=a*h}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,m=this._weightNext,v=(n-t)/(s-t),_=v*v,g=_*v,f=-d*g+2*d*_-d*v,T=(1+d)*g+(-1.5-2*d)*_+(-.5+d)*v+1,E=(-1-m)*g+(1.5+m)*_+.5*v,x=m*g-m*_;for(let U=0;U!==o;++U)r[U]=f*a[h+U]+T*a[c+U]+E*a[l+U]+x*a[u+U];return r}},Yo=class extends ls{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=(n-t)/(s-t),u=1-h;for(let d=0;d!==o;++d)r[d]=a[c+d]*u+a[l+d]*h;return r}},Zo=class extends ls{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},on=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=_r(t,this.TimeBufferType),this.values=_r(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:_r(e.times,Array),values:_r(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Zo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Yo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new qo(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Er:t=this.InterpolantFactoryMethodDiscrete;break;case Ao:t=this.InterpolantFactoryMethodLinear;break;case da:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Er;case this.InterpolantFactoryMethodLinear:return Ao;case this.InterpolantFactoryMethodSmooth:return da}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,a=s-1;for(;r!==s&&n[r]<e;)++r;for(;a!==-1&&n[a]>t;)--a;if(++a,r!==0||a!==s){r>=a&&(a=Math.max(a,1),r=a-1);let o=this.getValueSize();this.times=n.slice(r,a),this.values=this.values.slice(r*o,a*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==r;o++){let l=n[o];if(typeof l=="number"&&isNaN(l)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){console.error("THREE.KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(s!==void 0&&qg(s))for(let o=0,l=s.length;o!==l;++o){let c=s[o];if(isNaN(c)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===da,r=e.length-1,a=1;for(let o=1;o<r;++o){let l=!1,c=e[o],h=e[o+1];if(c!==h&&(o!==1||c!==e[0]))if(s)l=!0;else{let u=o*n,d=u-n,m=u+n;for(let v=0;v!==n;++v){let _=t[u+v];if(_!==t[d+v]||_!==t[m+v]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];let u=o*n,d=a*n;for(let m=0;m!==n;++m)t[d+m]=t[u+m]}++a}}if(r>0){e[a]=e[r];for(let o=r*n,l=a*n,c=0;c!==n;++c)t[l+c]=t[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};on.prototype.TimeBufferType=Float32Array;on.prototype.ValueBufferType=Float32Array;on.prototype.DefaultInterpolation=Ao;var wi=class extends on{constructor(e,t,n){super(e,t,n)}};wi.prototype.ValueTypeName="bool";wi.prototype.ValueBufferType=Array;wi.prototype.DefaultInterpolation=Er;wi.prototype.InterpolantFactoryMethodLinear=void 0;wi.prototype.InterpolantFactoryMethodSmooth=void 0;var Ko=class extends on{};Ko.prototype.ValueTypeName="color";var Jo=class extends on{};Jo.prototype.ValueTypeName="number";var jo=class extends ls{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-t)/(s-t),c=e*o;for(let h=c+o;c!==h;c+=4)Qn.slerpFlat(r,0,a,c-o,a,c,l);return r}},Vr=class extends on{InterpolantFactoryMethodLinear(e){return new jo(this.times,this.values,this.getValueSize(),e)}};Vr.prototype.ValueTypeName="quaternion";Vr.prototype.InterpolantFactoryMethodSmooth=void 0;var Si=class extends on{constructor(e,t,n){super(e,t,n)}};Si.prototype.ValueTypeName="string";Si.prototype.ValueBufferType=Array;Si.prototype.DefaultInterpolation=Er;Si.prototype.InterpolantFactoryMethodLinear=void 0;Si.prototype.InterpolantFactoryMethodSmooth=void 0;var Qo=class extends on{};Qo.prototype.ValueTypeName="vector";var el=class{constructor(e,t,n){let s=this,r=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){o++,r===!1&&s.onStart!==void 0&&s.onStart(h,a,o),r=!0},this.itemEnd=function(h){a++,s.onProgress!==void 0&&s.onProgress(h,a,o),a===o&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(h){s.onError!==void 0&&s.onError(h)},this.resolveURL=function(h){return l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){let u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=c.length;u<d;u+=2){let m=c[u],v=c[u+1];if(m.global&&(m.lastIndex=0),m.test(h))return v}return null}}},Yg=new el,tl=class{constructor(e){this.manager=e!==void 0?e:Yg,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}};tl.DEFAULT_MATERIAL_NAME="__DEFAULT";var ul="\\[\\]\\.:\\/",Zg=new RegExp("["+ul+"]","g"),dl="[^"+ul+"]",Kg="[^"+ul.replace("\\.","")+"]",Jg=/((?:WC+[\/:])*)/.source.replace("WC",dl),jg=/(WCOD+)?/.source.replace("WCOD",Kg),Qg=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",dl),e0=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",dl),t0=new RegExp("^"+Jg+jg+Qg+e0+"$"),n0=["material","materials","bones","map"],nl=class{constructor(e,t,n){let s=n||ct.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},ct=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Zg,"")}static parseTrackName(e){let t=t0.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);n0.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let a=0;a<r.length;a++){let o=r[a];if(o.name===t||o.uuid===t)return o;let l=n(o.children);if(l)return l}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let a=e[s];if(a===void 0){let c=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.needsUpdate!==void 0?o=this.Versioning.NeedsUpdate:e.matrixWorldNeedsUpdate!==void 0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};ct.Composite=nl;ct.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};ct.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};ct.prototype.GetterByBindingType=[ct.prototype._getValue_direct,ct.prototype._getValue_array,ct.prototype._getValue_arrayElement,ct.prototype._getValue_toArray];ct.prototype.SetterByBindingTypeAndVersioning=[[ct.prototype._setValue_direct,ct.prototype._setValue_direct_setNeedsUpdate,ct.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[ct.prototype._setValue_array,ct.prototype._setValue_array_setNeedsUpdate,ct.prototype._setValue_array_setMatrixWorldNeedsUpdate],[ct.prototype._setValue_arrayElement,ct.prototype._setValue_arrayElement_setNeedsUpdate,ct.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[ct.prototype._setValue_fromArray,ct.prototype._setValue_fromArray_setNeedsUpdate,ct.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Mv=new Float32Array(1);typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:il}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=il);var fl=us([-.42,.76,-.5]),i0=0;function Xr(i,e){return[i[0]-e[0],i[1]-e[1],i[2]-e[2]]}function pl(i,e){return[i[1]*e[2]-i[2]*e[1],i[2]*e[0]-i[0]*e[2],i[0]*e[1]-i[1]*e[0]]}function us(i){let e=Math.hypot(i[0],i[1],i[2])||1;return[i[0]/e,i[1]/e,i[2]/e]}function Ti(i){let e=i.reduce((t,n)=>[t[0]+n[0],t[1]+n[1],t[2]+n[2]],[0,0,0]);return[e[0]/i.length,e[1]/i.length,e[2]/i.length]}function ml(i){return us(pl(Xr(i[1],i[0]),Xr(i[2],i[0])))}function $r(i){let e=ml(i),t=Ti(i);return e[0]*t[0]+e[1]*(t[1]-.6)+e[2]*t[2]<0?[-e[0],-e[1],-e[2]]:e}function Ht(i,e,t){let n=Math.max(0,Math.min(1,t));return[i[0]+(e[0]-i[0])*n,i[1]+(e[1]-i[1])*n,i[2]+(e[2]-i[2])*n]}function s0(i,e){return[i[0]*e,i[1]*e,i[2]*e]}var ni=[.561,.651,.961],ii=[.169,.133,.447],r0=[.541,.247,.522],a0=[.102,.184,.753],o0=[.055,.012,.224],gl=[.035,.012,.13];function l0(i,e){let t=Ti(i),n=$r(i),s=Math.max(0,n[0]*fl[0]+n[1]*fl[1]+n[2]*fl[2]),r=Math.max(0,n[1]),a=Ht(ii,ni,.1+.62*r+.42*s);a=Ht(a,a0,Math.max(0,n[0])*.62),a=Ht(a,r0,Math.max(0,-n[0])*.46);let o=.95+.07*Math.cos((t[2]+.4)*1.5),l=.4+.6*Math.max(0,Math.min(1,(t[1]-.12)/.5));return Ht(o0,s0(a,e*o),l)}function Ei(i,e={}){let t=l0(i,e.tint??1);return e.panelId?{points:i,colour:t,panelId:e.panelId,layer:1}:{points:i,colour:t}}function xh(i){let e=$r(i);return{points:i,colour:Ht([.05,.035,.2],[.27,.32,.68],Math.max(0,e[1])*.8)}}function Ot(i,e,t){return t?{points:i,colour:e,layer:2,paintAt:t}:{points:i,colour:e,layer:2}}var hs=[{z:-2.1,side:.85,roof:.72,low:.24,mid:.62,top:.74},{z:-2,side:.85,roof:.76,low:.2,mid:.82,top:.85},{z:-1.4,side:.85,roof:.79,low:.17,mid:.87,top:.9},{z:-.8,side:.85,roof:.8,low:.15,mid:.92,top:.95},{z:-.5,side:.85,roof:.6,low:.15,mid:.92,top:1.3},{z:.2,side:.85,roof:.6,low:.15,mid:.92,top:1.3},{z:.9,side:.85,roof:.6,low:.15,mid:.92,top:1.3},{z:1.4,side:.85,roof:.74,low:.16,mid:.88,top:.9},{z:2,side:.85,roof:.74,low:.2,mid:.76,top:.8},{z:2.1,side:.85,roof:.7,low:.24,mid:.6,top:.72}];function bh(i,e){let s=h=>i*(.85+h),r=(h,u,d)=>[s(d),.34+u*Math.sin(h),e+u*Math.cos(h)],a=h=>h/18*Math.PI*2,o=h=>.5+.5*Math.sin(h+.5),l=[i*.85,.34,e],c=[];c.push(Ot(Array.from({length:18},(h,u)=>{let d=r(a(u),.41,.002);return[d[0],Math.max(.16,d[1]),d[2]]}),gl,l));for(let h=0;h<18;h+=1){let u=a(h),d=a(h+1);c.push(Ot([r(u,.21,.004),r(u,.35,.004),r(d,.35,.004),r(d,.21,.004)],Ht([.02,.012,.075],[.15,.13,.33],o((u+d)/2)),l)),c.push(Ot([r(u,.06,.006),r(u,.21,.006),r(d,.21,.006),r(d,.06,.006)],h%3===0?[.04,.025,.13]:Ht(ii,ni,.25+.65*o((u+d)/2)),l))}return c.push(Ot(Array.from({length:18},(h,u)=>r(a(u),.06,.008)),Ht(ii,ni,.8),l)),c}function Mh(i,e,t,n){let s=(r,a)=>[r[0]+t[0]*a,r[1]+t[1]*a,r[2]+t[2]*a];return[s(i,-n),s(e,-n),s(e,n),s(i,n)]}function c0(i){let e=Js(i),t=ml(e);return e.map((n,s)=>{let r=e[(s+1)%4],a=us(pl(t,us(Xr(r,n))));return Ot(Mh(n,r,a,.009),gl)})}function h0(){let i=[],e=Ht(ii,ni,.72),t=[.08,.05,.27];for(let n of[1,-1])i.push(Ot(Mh([n*.85,.665,-2],[n*.85,.665,2],[0,1,0],.012),e)),i.push(Ot([[n*.85,.74,-.2],[n*.85,.74,-.02],[n*.85,.785,-.02],[n*.85,.785,-.2]],Ht(ii,ni,.92))),i.push(Ot([[n*.8105,.98,.14],[n*.8105,.98,.22],[n*.6197,1.27,.22],[n*.6197,1.27,.14]],t)),i.push(Ot([[n*.6,1.3,-.5],[n*.6,1.3,.9],[n*.6395,1.24,.9],[n*.6395,1.24,-.5]],Ht(ii,ni,.5))),i.push(Ot([[n*.42,.64,-2.1],[n*.8,.64,-2.1],[n*.78,.72,-2.1],[n*.44,.72,-2.1]],[.74,.74,.8])),i.push(Ot([[n*.78,.62,2.1],[n*.36,.62,2.1],[n*.36,.7,2.1],[n*.76,.7,2.1]],[.52,.12,.26]));return i.push(Ot([[-.38,.64,-2.1],[.38,.64,-2.1],[.38,.72,-2.1],[-.38,.72,-2.1]],gl)),i.push(Ot([[-.56,1.1,-.67],[.2,1.1,-.67],[.34,1.26,-.53],[-.28,1.26,-.53]],Ht(ii,ni,.4))),i.push(Ot([[-.2,1.08,1.17],[.5,1.08,1.17],[.42,1.26,.96],[-.1,1.26,.96]],Ht(ii,ni,.3))),i}function qr(){let i=[];for(let n=0;n+1<hs.length;n+=1){let s=hs[n],r=hs[n+1],a=(s.z+r.z)/2,o=a>-.8&&a<1.4,l=a>-.5&&a<.9;for(let h of[1,-1]){i.push(Ei([[h*s.side,s.low,s.z],[h*r.side,r.low,r.z],[h*r.side,.42,r.z],[h*s.side,.42,s.z]],{tint:.72})),i.push(Ei([[h*s.side,.42,s.z],[h*r.side,.42,r.z],[h*r.side,r.mid,r.z],[h*s.side,s.mid,s.z]]));let u=[[h*s.side,s.mid,s.z],[h*r.side,r.mid,r.z],[h*r.roof,r.top,r.z],[h*s.roof,s.top,s.z]];i.push(o?xh(u):Ei(u))}let c=[[-s.roof,s.top,s.z],[s.roof,s.top,s.z],[r.roof,r.top,r.z],[-r.roof,r.top,r.z]];i.push(o&&!l?xh(c):Ei(c))}let e=hs[0],t=hs[hs.length-1];i.push(Ei([[-e.side,e.low,e.z],[e.side,e.low,e.z],[e.roof,e.top,e.z],[-e.roof,e.top,e.z]],{tint:.8})),i.push(Ei([[t.side,t.low,t.z],[-t.side,t.low,t.z],[-t.roof,t.top,t.z],[t.roof,t.top,t.z]],{tint:.8}));for(let n of vt)i.push(Ei(Js(n),{panelId:n.id})),i.push(...c0(n));i.push(...h0());for(let n of[1,-1])i.push(...bh(n,-1.42)),i.push(...bh(n,1.42));return i}function Yr(){let i=[.012,.004,.05];return Array.from({length:16},(e,t)=>.36-t*.022).map(e=>{let t=.85+e,n=2.1+e,s=.25+e*.6,r=[];for(let[a,o,l]of[[1,1,0],[-1,1,1],[-1,-1,2],[1,-1,3]])for(let c=0;c<=4;c+=1){let h=(l+c/4)*(Math.PI/2);r.push([a*(t-s)+Math.cos(h)*s,i0,o*(n-s)+Math.sin(h)*s])}return{points:r,colour:i,opacity:.09}})}var u0=[1,.95,.86],d0=[{from:-.5,to:.5,glow:1},...[.62,.4,.22,.09].flatMap((i,e)=>[{from:.5+e*.25,to:.75+e*.25,glow:i},{from:-.75-e*.25,to:-.5-e*.25,glow:i}])];function Zr(i,e=.08){let t=Js(i),n=ml(t),s=[n[0]*.03,n[1]*.03,n[2]*.03],r=[];for(let a=0;a<4;a+=1){let o=t[a],l=t[(a+1)%4],c=us(Xr(l,o)),h=us(pl(n,c)),u=(d,m)=>[d[0]+h[0]*m*e+s[0],d[1]+h[1]*m*e+s[1],d[2]+h[2]*m*e+s[2]];for(let d of d0)r.push({points:[u(o,d.from),u(l,d.from),u(l,d.to),u(o,d.to)],colour:u0,glow:d.glow,panelId:i.id})}return r}var f0=12,p0=5;function vl(i){let e=[],t=[];for(let s of i){let[r,...a]=s.points,o=s.glow??1,l=s.opacity??1,c=Ti(s.points)[1];for(let h=0;h+1<a.length;h+=1)for(let u of[r,a[h],a[h+1]]){e.push(u[0],u[1],u[2]);let d=s.glow===void 0?1+(u[1]-c)*.7:1;t.push(s.colour[0]*o*d,s.colour[1]*o*d,s.colour[2]*o*d,l)}}let n=new Zt;return n.setAttribute("position",new gt(new Float32Array(e),3)),n.setAttribute("color",new gt(new Float32Array(t),4)),n}var yl=`
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`,m0=`
  precision highp float;
  varying vec2 vNdc;
  uniform vec2 uHero;
  uniform float uAspect;
  uniform float uLevel;

  const vec3 PERIWINKLE = vec3(0.561, 0.651, 0.961);
  const vec3 INDIGO = vec3(0.169, 0.133, 0.447);
  const vec3 MAGENTA = vec3(0.541, 0.247, 0.522);
  const vec3 FAR_BLUE = vec3(0.102, 0.184, 0.753);
  const vec3 BASE = vec3(0.055, 0.012, 0.224);

  // The creases where the planes meet at the vertex: left and a little up, up and right, down and right.
  const float LEFT = 2.99;
  const float UP = 0.96;
  const float DOWN = -1.13;

  float across(vec2 p, float angle) {
    return abs(-p.x * sin(angle) + p.y * cos(angle));
  }

  void main() {
    // Measured from the vertex, in stage heights, so the planes keep their shape on any frame.
    vec2 p = vec2((vNdc.x - uHero.x) * uAspect, vNdc.y - uHero.y) * 0.5;
    float angle = atan(p.y, p.x);
    float near = exp(-length(p) / 0.5);
    float wide = clamp(abs(vNdc.x - uHero.x) * 0.72, 0.0, 1.0);
    vec3 colour;
    if (angle > UP && angle < LEFT) {
      // The upper plane: violet at the vertex, the magenta bloom over the nearside.
      colour = mix(INDIGO * 0.62, vec3(0.3, 0.2, 0.78), near * 0.95);
      colour = mix(colour, FAR_BLUE, wide * smoothstep(0.2, -0.02, p.y) * 0.8);
      vec2 bloom = p - vec2(-0.3, 0.22) * vec2(min(1.0, uAspect), 1.0);
      colour = mix(colour, MAGENTA, 0.92 * exp(-dot(bloom, bloom) / 0.04));
    } else if (angle <= UP && angle > DOWN) {
      // The right plane: an azure edge at the vertex, plum in the middle, saturated blue far out.
      colour = mix(vec3(0.14, 0.075, 0.29), FAR_BLUE * 1.15, smoothstep(0.08, 0.72, wide));
      colour += MAGENTA * 0.36 * exp(-dot(p - vec2(0.2, 0.16), p - vec2(0.2, 0.16)) / 0.04);
      colour += vec3(0.1, 0.32, 0.62) * exp(-across(p, DOWN) / 0.1) * exp(-length(p) / 0.34);
    } else {
      // The left plane: periwinkle under the crease at the far side, falling through the indigo.
      float under = across(p, LEFT);
      vec3 lit = mix(vec3(0.2, 0.3, 0.8), PERIWINKLE, wide * wide);
      colour = mix(lit, INDIGO, smoothstep(0.0, 0.2, under));
      colour = mix(colour, FAR_BLUE * 0.8, near * 0.45);
    }
    // The planes dissolve into the indigo base by about two-thirds of the way down.
    colour = mix(colour, BASE, smoothstep(0.2, -0.32, vNdc.y));
    // Inside a beat they step back, so the brightest thing there is the panel under discussion.
    gl_FragColor = vec4(mix(BASE, colour, uLevel), 1.0);
  }
`,g0=`
  precision highp float;
  uniform vec2 uHero;
  uniform float uBloom;
  uniform vec2 uViewport;
  uniform float uDpr;
  const vec3 RIM = vec3(1.0, 0.949, 0.859);

  float edge(vec2 px, float angle, float width, float reach) {
    vec2 direction = vec2(cos(angle), sin(angle));
    float along = dot(px, direction);
    if (along < 0.0) return 0.0;
    float across = abs(px.x * -direction.y + px.y * direction.x);
    return exp(-(across * across) / (width * width)) * exp(-along / reach);
  }

  void main() {
    vec2 here = gl_FragCoord.xy / uDpr;
    vec2 heroPx = vec2((uHero.x + 1.0) * 0.5 * uViewport.x, (uHero.y + 1.0) * 0.5 * uViewport.y);
    vec2 px = here - heroPx;
    float away = dot(px, px);
    float rays = edge(px, 2.99, 2.6, 300.0) + edge(px, 0.96, 2.4, 130.0) + edge(px, -1.13, 2.6, 130.0);
    float glint = 1.4 * exp(-away / 760.0) + 0.3 * exp(-away / 4600.0);
    gl_FragColor = vec4(RIM * (rays * 0.42 + glint) * uBloom, 1.0);
  }
`,v0=`
  precision highp float;
  uniform float uDpr;
  uniform float uOpen;
  void main() {
    vec2 px = gl_FragCoord.xy / uDpr;
    float fromBottom = px.y;
    if (fromBottom > 24.0) discard;
    vec3 colour = vec3(0.027, 0.008, 0.102);
    for (int k = 1; k <= 12; k += 1) {
      if (float(k) > uOpen) break;
      float cx = 16.0 * float(k);
      if (abs(px.x - cx) <= 5.0 && abs(fromBottom - 12.0) <= 5.0) colour = vec3(1.0, 0.949, 0.859);
    }
    gl_FragColor = vec4(colour, 1.0);
  }
`,y0=`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`,_0=`
  attribute vec2 corner;
  attribute float filled;
  uniform vec2 uViewport;
  uniform float uRadius;
  varying vec2 vCorner;
  varying float vFilled;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    clip.xy += corner * (uRadius * 2.0 / uViewport) * clip.w;
    gl_Position = clip;
    vCorner = corner;
    vFilled = filled;
  }
`,x0=`
  precision highp float;
  uniform float uRadius;
  uniform float uCore;
  varying vec2 vCorner;
  varying float vFilled;
  void main() {
    float d = length(vCorner) * uRadius;
    if (d > uRadius) discard;
    vec3 bright = vec3(1.0, 0.949, 0.859);
    vec3 dark = vec3(0.04, 0.01, 0.16);
    vec3 colour = (vFilled > 0.5 || d > uCore) ? bright : dark;
    float alpha = 1.0 - smoothstep(uRadius - 1.25, uRadius, d);
    gl_FragColor = vec4(colour, alpha);
  }
`,Kr=class{canvas;renderer;scene=new zr;camera=new It;backdrop;glow;bodyMaterials=[];rims=new Map;markerMaterial;tickMaterial;dimMaterial;dimLayer;ticks;markers=null;constructor(e,t){this.canvas=e,this.renderer=new Br({canvas:e,context:t,antialias:!0,preserveDrawingBuffer:!0}),this.renderer.outputColorSpace=ti,this.renderer.setClearColor(new Ye(.055,.012,.224),1),this.camera.matrixAutoUpdate=!1,this.backdrop=new At({vertexShader:yl,fragmentShader:m0,depthTest:!1,depthWrite:!1,uniforms:{uHero:{value:[0,0]},uAspect:{value:1.6},uLevel:{value:1}}});let n=new Zt;n.setAttribute("position",new gt(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));let s=new mt(n,this.backdrop);s.frustumCulled=!1,s.renderOrder=-10,this.scene.add(s),this.glow=new At({vertexShader:yl,fragmentShader:g0,depthTest:!1,depthWrite:!1,blending:Rs,transparent:!0,uniforms:{uHero:{value:[0,0]},uBloom:{value:1},uViewport:{value:[1280,800]},uDpr:{value:1}}});let r=new mt(n,this.glow);r.frustumCulled=!1,r.renderOrder=5,this.scene.add(r);let a=new mt(vl(Yr()),new ei({vertexColors:!0,transparent:!0,depthWrite:!1,side:Vt}));a.frustumCulled=!1,a.renderOrder=-5,this.scene.add(a);let o=qr();for(let h of[0,1,2]){let u=new ei({vertexColors:!0,side:Vt,polygonOffset:h>0,polygonOffsetFactor:-h,polygonOffsetUnits:-4*h}),d=new mt(vl(o.filter(m=>(m.layer??0)===h)),u);d.frustumCulled=!1,d.renderOrder=h,this.bodyMaterials.push(u),this.scene.add(d)}for(let h of vt){let u=new ei({vertexColors:!0,transparent:!0,opacity:0,blending:Rs,depthTest:!1,depthWrite:!1,side:Vt}),d=new mt(vl(Zr(h)),u);d.frustumCulled=!1,d.visible=!1,d.renderOrder=2,this.rims.set(h.id,d),this.scene.add(d)}this.tickMaterial=new At({vertexShader:y0,fragmentShader:v0,depthTest:!1,depthWrite:!1,uniforms:{uViewport:{value:[1280,800]},uDpr:{value:1},uOpen:{value:0}}});let l=new Zt;l.setAttribute("position",new gt(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),this.ticks=new mt(l,this.tickMaterial),this.ticks.frustumCulled=!1,this.ticks.renderOrder=20,this.ticks.visible=!1,this.scene.add(this.ticks),this.dimMaterial=new At({vertexShader:yl,fragmentShader:`
        precision highp float;
        uniform float uAmount;
        void main() { gl_FragColor = vec4(0.02, 0.004, 0.06, uAmount); }
      `,transparent:!0,depthTest:!1,depthWrite:!1,uniforms:{uAmount:{value:0}}});let c=new mt(n,this.dimMaterial);c.frustumCulled=!1,c.renderOrder=30,c.visible=!1,this.dimLayer=c,this.scene.add(c),this.markerMaterial=new At({vertexShader:_0,fragmentShader:x0,transparent:!0,depthTest:!1,depthWrite:!1,uniforms:{uViewport:{value:[1280,800]},uRadius:{value:f0},uCore:{value:p0}}})}get context(){return this.renderer.getContext()}setMarkers(e){if(this.markers&&(this.scene.remove(this.markers),this.markers.geometry.dispose(),this.markers=null),e.length===0)return;let t=[],n=[],s=[],r=[];e.forEach((l,c)=>{let h=c*4;for(let u of[[-1,-1],[1,-1],[1,1],[-1,1]])t.push(l.point[0],l.point[1],l.point[2]),n.push(u[0],u[1]),s.push(l.seen?1:0);r.push(h,h+1,h+2,h,h+2,h+3)});let a=new Zt;a.setAttribute("position",new gt(new Float32Array(t),3)),a.setAttribute("corner",new gt(new Float32Array(n),2)),a.setAttribute("filled",new gt(new Float32Array(s),1)),a.setIndex(r);let o=new mt(a,this.markerMaterial);o.frustumCulled=!1,o.renderOrder=10,this.markers=o,this.scene.add(o)}draw(e){let{frame:t,width:n,height:s}=e;this.renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),this.renderer.setSize(n,s,!1),this.camera.position.set(t.eye[0],t.eye[1],t.eye[2]),this.camera.rotation.set(t.pitch,t.yaw,0,"YXZ"),this.camera.updateMatrix(),this.camera.updateMatrixWorld(!0),this.camera.projectionMatrix.fromArray(t.projection),this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert(),this.backdrop.uniforms.uHero.value=[e.heroNdc[0],e.heroNdc[1]],this.backdrop.uniforms.uAspect.value=Math.max(.2,n/Math.max(1,s)),this.backdrop.uniforms.uLevel.value=.5+.5*e.bloom;for(let r of this.bodyMaterials)r.color.setScalar(.6+.4*e.bloom);this.glow.uniforms.uHero.value=[e.heroNdc[0],e.heroNdc[1]],this.glow.uniforms.uBloom.value=e.bloom,this.glow.uniforms.uViewport.value=[n,s],this.glow.uniforms.uDpr.value=this.renderer.getPixelRatio();for(let[r,a]of this.rims){let o=r===e.rimPanelId&&e.rimGlow>0;a.visible=o,a.material.opacity=o?e.rimGlow:0}this.markerMaterial.uniforms.uViewport.value=[n,s],this.dimLayer.visible=e.dim<1,this.dimMaterial.uniforms.uAmount.value=1-e.dim,this.ticks.visible=e.ticks>=0,this.tickMaterial.uniforms.uDpr.value=this.renderer.getPixelRatio(),this.tickMaterial.uniforms.uOpen.value=Math.max(0,e.ticks),this.renderer.render(this.scene,this.camera)}dispose(){this.renderer.dispose()}};var wh=[{id:"front-bumper",x:70,y:20,width:160,height:34},{id:"bonnet",x:78,y:58,width:144,height:96},{id:"os-front-wing",x:228,y:58,width:30,height:96},{id:"ns-front-wing",x:42,y:58,width:30,height:96},{id:"os-door",x:228,y:158,width:30,height:120},{id:"ns-door",x:42,y:158,width:30,height:120},{id:"os-sill",x:262,y:158,width:24,height:190},{id:"ns-sill",x:14,y:158,width:24,height:190},{id:"roof",x:90,y:190,width:120,height:130},{id:"os-rear-quarter",x:228,y:282,width:30,height:110},{id:"ns-rear-quarter",x:42,y:282,width:30,height:110},{id:"boot-lid",x:78,y:396,width:144,height:90},{id:"rear-bumper",x:70,y:490,width:160,height:34}];function Us(i){return wh.find(e=>e.id===i)}function Qr(i,e,t){let n=Us(i);return n?{x:n.x+e*n.width,y:n.y+t*n.height}:null}function Jr(i,e){return`<rect x="${i}" y="${e}" width="22" height="62" rx="8" fill="#140A3A" opacity="0.86"/>`}function jr(i,e,t){return`<rect x="${i}" y="${e}" width="34" height="11" rx="5" fill="${t}" opacity="0.62"/>`}function Ns(i={}){let e=i.pins??[],t=`
    <defs>
      <linearGradient id="ob-plan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8FA6F5"/>
        <stop offset="0.55" stop-color="#5A5FD0"/>
        <stop offset="1" stop-color="#2B2272"/>
      </linearGradient>
      <linearGradient id="ob-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#C9D6FF"/>
        <stop offset="1" stop-color="#8FA6F5"/>
      </linearGradient>
    </defs>
    <ellipse cx="150" cy="276" rx="136" ry="256" fill="#1A0B54" opacity="0.12"/>
    ${Jr(38,96)}${Jr(240,96)}${Jr(38,388)}${Jr(240,388)}
    <path d="M104 16 H196 C226 16 240 40 243 76 L248 170 L248 356 L243 450
             C240 492 224 524 194 524 H106 C76 524 60 492 57 450 L52 356 L52 170 L57 76
             C60 40 74 16 104 16 Z"
          fill="url(#ob-plan)" stroke="#1A0B54" stroke-width="2"/>
    ${jr(72,24,"#FFF2DB")}${jr(194,24,"#FFF2DB")}
    ${jr(72,502,"#8A3F85")}${jr(194,502,"#8A3F85")}
    <path d="M96 160 L204 160 L214 186 L86 186 Z" fill="url(#ob-glass)" opacity="0.85"/>
    <path d="M86 322 L214 322 L204 350 L96 350 Z" fill="url(#ob-glass)" opacity="0.7"/>
    <rect x="90" y="186" width="120" height="136" rx="10" fill="#6E79E0" opacity="0.55"/>
    <path d="M52 176 l-13 7 l13 7 z" fill="#1A0B54" opacity="0.65"/>
    <path d="M248 176 l13 7 l-13 7 z" fill="#1A0B54" opacity="0.65"/>
    <path d="M78 58 L222 58 L222 154 L78 154 Z" fill="none" stroke="#FFFFFF" stroke-opacity="0.26"/>
    <path d="M78 396 L222 396 L222 486 L78 486 Z" fill="none" stroke="#FFFFFF" stroke-opacity="0.26"/>
    <path d="M70 54 L230 54 M70 490 L230 490" stroke="#FFFFFF" stroke-opacity="0.26"/>`,n=wh.map(r=>`<rect data-panel-id="${r.id}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="4" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.34" stroke-width="1"${i.interactive?' class="diagram-panel"':""}/>`).join(""),s=e.map(r=>`<g class="diagram-pin"><circle cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="9" fill="${r.strong?"#FFF2DB":"none"}" stroke="#FFF2DB" stroke-width="3"/><circle cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="3" fill="#0E0339"/><title>${Ai(r.label)}</title></g>`).join("");return`<svg viewBox="0 0 300 540" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${Ai(i.title??"Panel diagram")}">${t}${n}${s}</svg>`}function Ai(i){return i.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function b0(i,e,t){if(t<0)return"";let n=[];for(let s=1;s<=Math.min(12,t);s+=1)n.push(`<rect x="${16*s-5}" y="${e-17}" width="10" height="10" fill="#FFF2DB"/>`);return`<rect x="0" y="${e-24}" width="${i}" height="24" fill="#07021A"/>${n.join("")}`}function M0(i){let e=t=>Math.max(0,Math.min(255,Math.round(t*255)));return`rgb(${e(i.colour[0])},${e(i.colour[1])},${e(i.colour[2])})`}function w0(i,e){let t=i.paintAt??Ti(i.points);return li(e.frame.viewProjection,t,e.width,e.height).w-(i.layer??0)*.4}function S0(i,e){let t=Ti(i.points),n=$r(i.points);return n[0]*(e[0]-t[0])+n[1]*(e[1]-t[1])+n[2]*(e[2]-t[2])>0}function E0(i){let e=i.glow??i.opacity;return e===void 0?"":` fill-opacity="${e.toFixed(2)}"`}function Sh(i,e){let t=[];for(let n of i.points){let s=li(e.frame.viewProjection,n,e.width,e.height);if(s.w<=.01)return null;t.push(`${s.x.toFixed(1)},${s.y.toFixed(1)}`)}return`<polygon points="${t.join(" ")}" fill="${M0(i)}"${E0(i)}/>`}function Os(i){let{width:e,height:t}=i,n=i.heroPoint?li(i.frame.viewProjection,i.heroPoint,e,t):null,s=n&&n.w>0?n.x:e/2,r=n&&n.w>0?n.y:t*.35,a=qr().filter(f=>S0(f,i.frame.eye)),o=i.rimPanelId===void 0?void 0:jl(i.rimPanelId);o&&(i.rimGlow??0)>0&&a.push(...Zr(o));let l=a.map(f=>({facet:f,depth:w0(f,i)})).filter(f=>f.depth>.01).sort((f,T)=>T.depth-f.depth).map(f=>Sh(f.facet,i)).filter(f=>f!==null).join(""),c=Yr().map(f=>Sh(f,i)??"").join(""),h=Math.max(e,t),u=[{angle:.96},{angle:-1.13},{angle:2.99}],d=u.map((f,T)=>{let E=u[(T+1)%u.length],x=`${(s+Math.cos(f.angle)*h*2).toFixed(1)},${(r-Math.sin(f.angle)*h*2).toFixed(1)}`,U=`${(s+Math.cos(E.angle)*h*2).toFixed(1)},${(r-Math.sin(E.angle)*h*2).toFixed(1)}`;return`<polygon points="${s.toFixed(1)},${r.toFixed(1)} ${x} ${U}" fill="url(#ob-plane-${T})"/>`}).join(""),m=u.map(f=>`<line x1="${s.toFixed(1)}" y1="${r.toFixed(1)}" x2="${(s+Math.cos(f.angle)*h).toFixed(1)}" y2="${(r-Math.sin(f.angle)*h).toFixed(1)}" stroke="url(#ob-ray)" stroke-width="2"/>`).join(""),v=i.pins.map(f=>{let T=li(i.frame.viewProjection,f.point,e,t);if(T.w<=0)return`<g data-finding-id="${Ai(f.id)}" data-seen="${f.seen}" opacity="0"><circle cx="-50" cy="-50" r="12" fill="none"/></g>`;let E=f.seen?`<circle cx="${T.x.toFixed(2)}" cy="${T.y.toFixed(2)}" r="11.5" fill="#FFF2DB"/>`:`<circle cx="${T.x.toFixed(2)}" cy="${T.y.toFixed(2)}" r="8.5" fill="none" stroke="#FFF2DB" stroke-width="7"/><circle cx="${T.x.toFixed(2)}" cy="${T.y.toFixed(2)}" r="4.6" fill="#0A0320"/>`;return`<g data-finding-id="${Ai(f.id)}" data-seen="${f.seen}" class="still-pin">${E}<title>${Ai(f.title)}</title></g>`}).join(""),_=Math.max(16,Math.min(58,Math.min(e,t)*.22)),g=[{x1:s,y1:r,x2:e,y2:r,from:"#24134A",to:"#1A2FC0"},{x1:0,y1:r-t*.12,x2:t*.06,y2:r+t*.16,from:"#8FA6F5",to:"#241C66"},{x1:s,y1:r,x2:0,y2:0,from:"#4A33C4",to:"#1A1456"}];return`<svg xmlns="http://www.w3.org/2000/svg" width="${e}" height="${t}" viewBox="0 0 ${e} ${t}" preserveAspectRatio="none" role="img" aria-label="${Ai(i.label)}" class="still">
    <defs>
      ${g.map((f,T)=>`<linearGradient id="ob-plane-${T}" gradientUnits="userSpaceOnUse"
        x1="${f.x1.toFixed(1)}" y1="${f.y1.toFixed(1)}" x2="${f.x2.toFixed(1)}" y2="${f.y2.toFixed(1)}">
        <stop offset="0" stop-color="${f.from}"/><stop offset="1" stop-color="${f.to}"/>
      </linearGradient>`).join("")}
      <radialGradient id="ob-magenta">
        <stop offset="0" stop-color="#8A3F85" stop-opacity="0.85"/>
        <stop offset="1" stop-color="#8A3F85" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="ob-bloom">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="1"/>
        <stop offset="0.3" stop-color="#FFF6E4" stop-opacity="0.92"/>
        <stop offset="0.62" stop-color="#9FB4F8" stop-opacity="0.34"/>
        <stop offset="1" stop-color="#8FA6F5" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ob-ray" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#FFF2DB" stop-opacity="0.8"/>
        <stop offset="0.22" stop-color="#FFF2DB" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#FFF2DB" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="ob-base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0E0339" stop-opacity="0"/>
        <stop offset="1" stop-color="#0E0339"/>
      </linearGradient>
    </defs>
    <rect width="${e}" height="${t}" fill="#0E0339"/>
    ${d}
    <ellipse cx="${(s-t*.3).toFixed(1)}" cy="${(r-t*.22).toFixed(1)}"
      rx="${(t*.42).toFixed(1)}" ry="${(t*.3).toFixed(1)}" fill="url(#ob-magenta)"/>
    ${m}
    <rect y="${(t*.4).toFixed(0)}" width="${e}" height="${(t*.26).toFixed(0)}" fill="url(#ob-base)"/>
    <rect y="${(t*.66).toFixed(0)}" width="${e}" height="${Math.ceil(t*.34)}" fill="#0E0339"/>
    ${c}
    ${l}
    <circle cx="${s.toFixed(1)}" cy="${r.toFixed(1)}" r="${_.toFixed(1)}" fill="url(#ob-bloom)"/>
    ${v}
    ${i.dim<1?`<rect width="${e}" height="${t}" fill="#05010F" opacity="${(1-i.dim).toFixed(2)}"/>`:""}
    ${b0(e,t,i.ticks??-1)}
  </svg>`}var Ln=720,_l=.4,T0=.35,A0=.4,ta=.6;function Th(i){return Ln*(i+1)}function C0(i){return Ln*i+Ln*ta}var Pn={panelId:"os-door",u:.5,v:.5};function Ah(i){return ha(i).azimuth}function Ch(i){return ha(i).elevation}function Rh(){return{beat:0,progress:0,rim:0,travel:0,panelId:"",u:0,v:0,angle:Ah(Pn.panelId),elevation:Ch(Pn.panelId),aim:Qt(Pn.panelId,Pn.u,Pn.v),bloom:1,centring:0,finding:null}}function R0(i){let e=[];for(let[t,n]of i.entries()){let s=Ah(n);if(t===0){e.push(s);continue}let r=e[t-1],a=((s-r)%360+360)%360;e.push(r+(a===0?360:a))}return e}function Ci(i,e,t){return i+(e-i)*t}function ea(i){let e=Math.max(0,Math.min(1,i));return 1-(1-e)*(1-e)}function I0(i,e,t){return[Ci(i[0],e[0],t),Ci(i[1],e[1],t),Ci(i[2],e[2],t)]}function Ri(i,e){let t=i.find(r=>r.id===e)??i[0]??null,s=[t?t.panelId:Pn.panelId,...i.map(r=>r.panelId)];return{findings:i,hero:t,angles:R0(s),elevations:s.map(r=>Ch(r)),aims:[t?Qt(t.panelId,t.u,t.v):Qt(Pn.panelId,Pn.u,Pn.v),...i.map(r=>Qt(r.panelId,r.u,r.v))]}}function xl(i){let e=i.hero;return{beat:0,progress:0,rim:0,travel:0,panelId:e?e.panelId:"",u:e?e.u:0,v:e?e.v:0,angle:i.angles[0]??0,elevation:i.elevations[0]??18,aim:i.aims[0],bloom:1,centring:0,finding:null}}function Ih(i,e){let t=i.findings.length;if(t===0||e<Ln)return xl(i);let n=Math.min(t,Math.floor(e/Ln)),s=Math.max(0,Math.min(1,(e-Ln*n)/Ln)),r=i.findings[n-1],a=Math.min(1,s/A0),o=s<=ta?0:(s-ta)/(1-ta);return{beat:n,progress:s,rim:a,travel:o,panelId:r.panelId,u:r.u,v:r.v,angle:Ci(i.angles[n-1],i.angles[n],ea(s/_l)),elevation:Ci(i.elevations[n-1],i.elevations[n],ea(s/_l)),aim:I0(i.aims[n-1],i.aims[n],ea(s/T0)),bloom:Math.max(.15,1-a),centring:n===1?ea(s/_l):1,finding:r}}var Eh=[0,.12];function P0(i){return i>=.6&&i<1.2?.35:0}function L0(i,e){return[Ci(i[0],Eh[0],e),Ci(i[1],Eh[1],e)]}function bl(i,e,t,n={}){return Ys({angle:i.angle,elevation:i.elevation,anchor:i.aim,ndc:n.closeUp?[0,0]:L0(Fi(e),i.centring),...n.closeUp?{centre:i.aim,distance:3.6}:{distance:qs(e/Math.max(1,t))*(1+P0(e/Math.max(1,t))*i.centring)}},e,t)}function Ph(i,e,t){return t<=e?[]:i.findings.filter(n=>{let s=C0(n.position);return s>e&&s<=t})}var D0=1200,ds=class{element;carName;preview;canvas=null;renderer=null;stillHolder;frames=0;signature="";track=null;pins=[];markers=[];openAdvisories=-1;trackKey="";markerKey="";onPick=null;onStill=null;lastDraw=null;lastFrame=null;constructor(e){this.carName=e.carName,this.preview=e.preview??!1,this.stillHolder=p("div",{class:"stage-still"}),this.element=p("div",{role:"region","aria-label":e.label,class:this.preview?"stage-preview":"stage-surface","data-frame-count":"0"},[this.stillHolder]),this.element.addEventListener("click",t=>{let n=t;this.pickAt(n.clientX,n.clientY)}),this.useWebgl()}useWebgl(){let e=p("canvas",{class:"stage-canvas"}),t={antialias:!0,preserveDrawingBuffer:!0,alpha:!1},n=e.getContext("webgl2",t)??e.getContext("webgl",t),s=null;if(n)try{s=new Kr(e,n)}catch{s=null}if(!s){this.setAttribute("data-renderer","svg");return}e.addEventListener("webglcontextlost",r=>{r.preventDefault(),window.setTimeout(()=>this.dropToStill(),D0)}),this.canvas=e,this.renderer=s,this.element.prepend(e),this.setAttribute("data-renderer","webgl")}dropToStill(){this.canvas&&(this.canvas.remove(),this.canvas=null,this.renderer?.dispose(),this.renderer=null,this.setAttribute("data-renderer","svg"),this.signature="",this.onStill?.(),this.lastDraw&&this.draw({...this.lastDraw,mode:"still",state:this.stateFor(0,"still")}))}onStillDrop(e){this.onStill=e}get usesWebgl(){return this.canvas!==null}setAttribute(e,t){vs(this.element,e,t)}setTrack(e){let t=JSON.stringify([e.angles,e.elevations,e.aims]);t!==this.trackKey&&(this.trackKey=t,this.signature=""),this.track=e}setMarkers(e){let t=e.map(n=>`${n.id}:${n.seen?1:0}:${n.u},${n.v}`).join("|");t!==this.markerKey&&(this.markerKey=t,this.markers=e.map(n=>({point:Qt(n.panelId,n.u,n.v),seen:n.seen})),this.pins=e.map(n=>({id:n.id,point:Qt(n.panelId,n.u,n.v),seen:n.seen,title:`Finding ${n.position}: ${n.title}`})),this.renderer?.setMarkers(this.markers),this.signature="")}setOpenAdvisories(e){this.openAdvisories!==e&&(this.openAdvisories=e,this.setAttribute("data-open-advisories",String(Math.max(0,e))),this.signature="")}onMarkerPick(e){this.onPick=e}size(){let e=this.element.getBoundingClientRect();return{width:Math.max(1,Math.round(e.width)),height:Math.max(1,Math.round(e.height))}}pickAt(e,t,n=22){if(!this.track||!this.lastFrame)return null;let s=this.element.getBoundingClientRect(),r=e-s.left,a=t-s.top,o=null;for(let l of this.track.findings){let c=li(this.lastFrame.viewProjection,Qt(l.panelId,l.u,l.v),s.width,s.height);if(c.w<=0||c.x<0||c.y<0||c.x>s.width||c.y>s.height)continue;let h=Math.hypot(c.x-r,c.y-a);h<=n&&(!o||h<o.distance)&&(o={finding:l,distance:h})}return o&&this.onPick&&this.onPick(o.finding),o?o.finding:null}stateFor(e,t){return this.track?t==="still"?xl(this.track):Ih(this.track,e):Rh()}draw(e){if(!this.track)return;let{width:t,height:n}=this.size(),s=e.state,r=bl(s,t,n,{closeUp:this.preview});this.lastFrame=r,this.lastDraw=e;let a=this.track.aims[0],o=Fi(t),l=Kl(r.viewProjection);this.preview||(this.setAttribute("data-mode",e.mode),this.setAttribute("data-beat",String(s.beat)),this.setAttribute("data-beat-progress",s.progress.toFixed(2)),this.setAttribute("data-rim-glow",s.rim.toFixed(3)),this.setAttribute("data-card-travel",s.travel.toFixed(3)),this.setAttribute("data-camera-angle",s.angle.toFixed(3)),this.setAttribute("data-listing",e.listing)),this.setAttribute("data-panel",s.panelId),this.setAttribute("data-anchor",s.panelId===""?"":`${s.u.toFixed(3)},${s.v.toFixed(3)}`),this.setAttribute("data-camera-position",Jl(r.eye)),this.setAttribute("data-view-projection",l);let c=[l,t,n,e.mode,e.dim,s.rim.toFixed(3),s.panelId,s.bloom.toFixed(3),this.openAdvisories,this.markers.map(h=>h.seen?1:0).join(""),this.canvas?"gl":"svg"].join("|");c!==this.signature&&(this.signature=c,this.canvas&&this.renderer?(this.canvas.hidden=!1,this.stillHolder.replaceChildren(),this.renderer.draw({frame:r,width:t,height:n,heroNdc:o,bloom:s.bloom,dim:e.dim,rimPanelId:s.panelId,rimGlow:s.rim,ticks:this.preview?this.openAdvisories:-1})):this.stillHolder.replaceChildren(wt(Os({frame:r,width:t,height:n,heroPoint:a,pins:this.preview?[]:this.pins,dim:e.dim,label:this.preview?"Stage preview still":`Facet still of ${this.carName()}`,ticks:this.preview?this.openAdvisories:-1}))),this.frames+=1,this.setAttribute("data-frame-count",String(this.frames)))}showEmpty(e){this.canvas&&(this.canvas.hidden=!0),this.setAttribute("data-panel",""),this.setAttribute("data-anchor",""),this.signature="",this.stillHolder.replaceChildren(wt(Os({frame:bl(this.stateFor(0,"still"),320,240,{closeUp:!0}),width:320,height:240,heroPoint:null,pins:[],dim:.5,label:"Stage preview still",ticks:-1})),p("p",{class:"stage-empty"},[e]))}};function Mt(i,e=""){return p("p",{role:"status","aria-live":"polite","aria-label":i,class:`status ${e}`.trim()})}function na(i="Service notice"){return p("p",{role:"alert","aria-label":i,class:"notice-panel",hidden:!0})}function Ae(i,e){i&&(i.replaceChildren(document.createTextNode(e)),i.hidden=!1)}async function Ke(i,e){for(let t of e)Ae(i,t),await Promise.resolve(),await Promise.resolve()}var fs=class{constructor(e,t){this.region=e;this.order=t}baseline=new Map;waiting=new Set;held=!1;started=!1;start(e){for(let[t,n]of e)this.baseline.set(t,n);this.started=!0}own(e,t){for(let n of t)e.has(n)&&this.baseline.set(n,e.get(n)),this.waiting.delete(n)}setHeld(e,t){let n=this.held;this.held=e,n&&!e&&this.release(t)}isHeld(){return this.held}found(e){if(!this.started){this.start(e);return}let t=[];for(let n of this.order){if(!e.has(n))continue;let s=e.get(n);if(this.baseline.get(n)!==s){if(this.held){this.waiting.add(n);continue}this.baseline.set(n,s),t.push(s)}}t.length>0&&Ke(this.region(),t)}async release(e){let t=[];for(let n of this.order){if(!this.waiting.has(n))continue;this.waiting.delete(n);let s=e.get(n);s===void 0||this.baseline.get(n)===s||(this.baseline.set(n,s),t.push(s))}t.length>0&&await Ke(this.region(),t)}};var ia=null;function F0(){return ia||(ia=new IntersectionObserver(i=>{for(let e of i)e.isIntersecting&&(ia?.unobserve(e.target),e.target.classList.add("is-in"))},{rootMargin:"0px 0px -8% 0px"})),ia}function Ct(i){return Pi()?(i.classList.add("is-in"),i):(i.classList.add("enters"),F0().observe(i),i)}var U0=333,Kt=class{box;scrim;holder;opener=null;exiting=null;open=!1;options;constructor(e,t){this.options=e,this.box=p("div",{role:"dialog","aria-modal":"true","aria-label":e.name,class:`overlay-box${e.sheet?" overlay-sheet":""}`}),this.box.append(...t(()=>this.close())),this.scrim=p("div",{class:"overlay-scrim"}),this.holder=p("div",{class:"overlay"},[this.scrim,this.box]),oe(this.scrim,"pointerdown",s=>{s.preventDefault(),e.scrimCloses&&!this.locked()&&this.close()}),oe(this.holder,"keydown",s=>this.onKeyDown(s)),oe(document,"keydown",s=>{this.open&&s.key==="Escape"&&!this.holder.contains(document.activeElement)&&this.onKeyDown(s)});let n=s=>{this.open&&s.preventDefault()};oe(this.holder,"wheel",n,{passive:!1}),oe(this.holder,"touchmove",n,{passive:!1})}locked(){return this.options.locked?.()??!1}onKeyDown(e){if(e.key==="Escape"){e.preventDefault(),this.locked()||this.close();return}if(e.key!=="Tab")return;let t=this.focusable();if(t.length===0)return;let n=t[0],s=t[t.length-1],r=document.activeElement;e.shiftKey&&(r===n||!this.box.contains(r))?(e.preventDefault(),s.focus({preventScroll:!0})):!e.shiftKey&&(r===s||!this.box.contains(r))&&(e.preventDefault(),n.focus({preventScroll:!0}))}focusable(){return[...this.box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(e=>e.offsetParent!==null||e===document.activeElement)}isOpen(){return this.open}show(e){this.exiting!==null&&(window.clearTimeout(this.exiting),this.exiting=null),this.holder.isConnected||document.body.append(this.holder),this.holder.removeAttribute("inert"),this.holder.removeAttribute("aria-hidden"),this.holder.classList.remove("is-leaving"),this.open=!0,e&&(this.opener=e);let t=this.focusable()[0];t&&t.focus({preventScroll:!0})}close(){if(!this.open)return;this.open=!1,this.holder.setAttribute("inert",""),this.holder.setAttribute("aria-hidden","true");let e=this.options.focusHome?.()??this.opener;e&&e.isConnected&&e.focus(),this.options.onClose?.();let t=()=>{this.exiting=null,this.open||this.holder.remove()};if(Pi()){t();return}this.holder.classList.add("is-leaving"),this.exiting=window.setTimeout(t,U0)}destroy(){this.open=!1,this.exiting!==null&&window.clearTimeout(this.exiting),this.exiting=null,this.holder.remove()}};function N0(i){return i.getAttribute("aria-disabled")==="true"}function Je(i,e){oe(i,"click",t=>{if(N0(i)){t.preventDefault(),t.stopPropagation();return}i.setAttribute("aria-disabled","true"),Promise.resolve(e()).finally(()=>{i.isConnected&&i.removeAttribute("aria-disabled")})})}function O0(i){let e=(s,r)=>{let a=Math.sin(s*127.1+r*311.7+i)*43758.5453;return a-Math.floor(a)},t=s=>s*s*s*(s*(s*6-15)+10),n=(s,r)=>{let a=Math.floor(s),o=Math.floor(r),l=t(s-a),c=t(r-o),h=e(a,o)*(1-l)+e(a+1,o)*l,u=e(a,o+1)*(1-l)+e(a+1,o+1)*l;return h*(1-c)+u*c};return(s,r)=>n(s,r)*.62+n(s*2.1+9,r*2.1+4)*.27+n(s*4.3+3,r*4.3+7)*.11}var Dn=9;function k0(i,e){let t=Math.ceil(i/Dn)+3,n=Math.ceil(e/Dn)+3,s=new Float32Array(t*n),r=new Float32Array(t*n),a=new Float32Array(t*n),o=(l,c,h)=>{let u=Math.sin(l*12.9898+c*78.233+h)*24634.6345;return u-Math.floor(u)};for(let l=0;l<n;l+=1)for(let c=0;c<t;c+=1){let h=l*t+c;s[h]=(c-1+o(c,l,1.7))*Dn,r[h]=(l-1+o(c,l,8.3))*Dn,a[h]=o(c,l,21.1)}return{columns:t,x:s,y:r,tone:a}}function B0(i){let e=i.getBoundingClientRect(),t=Math.max(320,Math.round(e.width)),n=Math.max(160,Math.round(e.height));i.width=t,i.height=n;let s=i.getContext("2d");if(!s){i.style.background="linear-gradient(180deg, #2B2272, #0E0339)";return}let r=O0(17.37),a=(d,m)=>r(d/210,m/150),o=k0(t,n),l=s.createImageData(t,n),c=d=>n*.74-Math.sin(d/t*Math.PI)*n*.2+Math.sin(d/150)*n*.035;for(let d=0;d<n;d+=1)for(let m=0;m<t;m+=1){let v=a(m+7,d+7)-a(m-7,d-7),_=Math.max(.36,Math.min(1.6,.94-v*11)),g=a(m,d),f=Math.floor(m/Dn)+1,T=Math.floor(d/Dn)+1,E=1/0,x=0,U=0,A=0;for(let Z=T-1;Z<=T+1;Z+=1)for(let ie=f-1;ie<=f+1;ie+=1){let fe=Z*o.columns+ie,Ce=m-o.x[fe],Fe=d-o.y[fe],Y=Ce*Ce+Fe*Fe;Y<E&&(E=Y,x=Ce,U=Fe,A=o.tone[fe])}let C=r(m/26+40,d/22+11),N=Dn*Dn*(.45+A*.75),w=Math.max(0,1-E/N),M=.34+w*.5+Math.max(-.16,(-x-U)/(Dn*2.4))*w,R=Math.max(0,Math.min(1,A*.32+g*.5+(C-.5)*1.5)),q=(20+R*66)*M,B=(50+R*74)*M,$=(46+R*12)*M,G=d-c(m),P=Math.abs(G),W=15+g*9;if(P<W){let Z=1-Math.max(0,(P-7)/(W-7));q+=(84-q)*Z,B+=(90-B)*Z,$+=(58-$)*Z}else if(G<0&&P<W+14){let Z=.62+.38*((P-W)/14);q*=Z,B*=Z,$*=Z}if(P<5){let Z=Math.abs(P-2.5)<1?1.14:1;q=122*Z,B=110*Z,$=104*Z}let O=(d*t+m)*4;l.data[O]=Math.min(255,q*_),l.data[O+1]=Math.min(255,B*_),l.data[O+2]=Math.min(255,$*_),l.data[O+3]=255}s.putImageData(l,0,0);let h=s.createLinearGradient(0,0,0,n);h.addColorStop(0,"rgba(14, 3, 57, 0.42)"),h.addColorStop(.45,"rgba(14, 3, 57, 0.1)"),h.addColorStop(1,"rgba(14, 3, 57, 0)"),s.fillStyle=h,s.fillRect(0,0,t,n);let u=s.createRadialGradient(t/2,n/2,0,t/2,n/2,Math.max(t,n)*.22);u.addColorStop(0,"rgba(6, 3, 30, 0.72)"),u.addColorStop(.5,"rgba(6, 3, 30, 0.42)"),u.addColorStop(1,"rgba(6, 3, 30, 0)"),s.fillStyle=u,s.fillRect(0,0,t,n)}function Lh(i){let e=p("canvas",{class:"terrain-canvas",role:"img","aria-label":"Road terrain"}),t=!1,n=()=>{t||(t=!0,B0(e))},s=new IntersectionObserver(r=>{for(let a of r)a.isIntersecting&&(s.disconnect(),n())},{rootMargin:"400px"});return s.observe(e),p("section",{class:"terrain-band"},[e,p("p",{class:"terrain-label"},[i])])}function z0(){let t=(s,r)=>{let a=m=>[420-166*m,600+28*m,8*(1-m)+.6],[o,l,c]=a(s),[h,u,d]=a(r);return`<path d="M${(l-c).toFixed(1)} ${o.toFixed(1)}L${(l+c).toFixed(1)} ${o.toFixed(1)}L${(u+d).toFixed(1)} ${h.toFixed(1)}L${(u-d).toFixed(1)} ${h.toFixed(1)}Z" fill="url(#ob-paint)"/>`},n=[[0,.11],[.2,.29],[.37,.45],[.52,.59],[.65,.71],[.77,.82],[.87,.91]].map(([s,r])=>t(s,r)).join("");return wt(`<svg viewBox="0 0 1100 420" class="story-art" role="presentation" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="ob-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2B2272"/><stop offset="0.52" stop-color="#6C7BD8"/>
        <stop offset="0.84" stop-color="#C9A9C4"/><stop offset="1" stop-color="#FFE2C4"/>
      </linearGradient>
      <radialGradient id="ob-sun-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#FFF2DB" stop-opacity="0.62"/>
        <stop offset="0.45" stop-color="#FFD9A8" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#FFD9A8" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ob-far-hill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6A6AB4"/><stop offset="1" stop-color="#4A4790"/>
      </linearGradient>
      <linearGradient id="ob-near-hill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2A2A66"/><stop offset="1" stop-color="#140B36"/>
      </linearGradient>
      <linearGradient id="ob-tarmac" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17103F"/><stop offset="0.55" stop-color="#3A3570"/>
        <stop offset="1" stop-color="#8E93C8"/>
      </linearGradient>
      <linearGradient id="ob-verge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1B1444"/><stop offset="1" stop-color="#4C4A86"/>
      </linearGradient>
      <linearGradient id="ob-paint" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF2DB" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#FFF2DB" stop-opacity="0.85"/>
      </linearGradient>
    </defs>
    <rect width="1100" height="420" fill="url(#ob-sky)"/>
    <circle cx="766" cy="232" r="168" fill="url(#ob-sun-glow)"/>
    <circle cx="766" cy="232" r="27" fill="#FFF3DF" opacity="0.92"/>
    <path d="M0 248 C120 230 198 243 286 236 C372 229 438 214 534 220
             C636 226 712 240 806 234 C902 228 1006 238 1100 230 L1100 262 L0 262 Z"
          fill="url(#ob-far-hill)" opacity="0.72"/>
    <path d="M0 262 C150 246 252 262 352 256 C470 249 548 236 636 244
             C742 253 846 266 946 258 C1014 253 1060 256 1100 252 L1100 420 L0 420 Z"
          fill="url(#ob-near-hill)"/>
    <path d="M232 420 L602 254 L654 254 L968 420 Z" fill="url(#ob-verge)"/>
    <path d="M300 420 L613 254 L643 254 L900 420 Z" fill="url(#ob-tarmac)"/>
    ${n}
    <path d="M0 262 C150 246 252 262 352 256 C470 249 548 236 636 244
             C742 253 846 266 946 258 C1014 253 1060 256 1100 252 L1100 276 L0 286 Z"
          fill="#FFE2C4" opacity="0.14"/>
  </svg>`)}function V0(i){let e=i.indexOf(". ");return e===-1?i:i.slice(0,e+1)}function Dh(i,e,t){let n=p("a",{href:"#offer",class:"pill pill-outline"},["Go to the offer"]);return oe(n,"click",s=>{s.preventDefault(),t("#offer")}),p("section",{role:"region","aria-label":"Owner story",class:"story-panel",id:"story"},[z0(),Ct(p("div",{class:"story-copy"},[p("p",{class:"story-eyebrow"},[`Kept ${e.toLowerCase()}`]),p("p",{class:"story-statement"},[V0(i)]),n]))])}var H0={certificate:`<svg viewBox="0 0 120 70" class="plate-mark" role="presentation">
    <rect x="12" y="10" width="96" height="50" rx="6" fill="none" stroke="#1A0B54" stroke-width="3"/>
    <path d="M24 26 H84 M24 36 H72 M24 46 H60" stroke="#307FE2" stroke-width="4" stroke-linecap="round"/>
    <circle cx="94" cy="46" r="10" fill="#307FE2" opacity="0.25"/>
    <path d="M89 46 l4 5 l8 -11" fill="none" stroke="#1A0B54" stroke-width="3" stroke-linecap="round"/>
  </svg>`,gauge:`<svg viewBox="0 0 120 70" class="plate-mark" role="presentation">
    <path d="M18 54 A42 42 0 0 1 102 54" fill="none" stroke="#1A0B54" stroke-width="4"/>
    <path d="M18 54 A42 42 0 0 1 46 15" fill="none" stroke="#307FE2" stroke-width="7"/>
    <circle cx="60" cy="54" r="5" fill="#1A0B54"/>
    <path d="M60 54 L82 28" stroke="#1A0B54" stroke-width="4" stroke-linecap="round"/>
  </svg>`};function Ml(i){let e=p("a",{class:"text-link plate-link",href:i.href},[i.linkLabel]);return i.href.startsWith("#")&&oe(e,"click",t=>{t.preventDefault(),i.onJump(i.href)}),Ct(p("article",{role:"region","aria-label":i.title,class:"plate-card",id:i.id},[p("div",{class:"plate"},[wt(H0[i.mark])]),p("h3",{class:"plate-title",tabindex:"-1"},[i.title]),p("p",{class:"plate-body"},[i.body]),e]))}function sa(i,e){let t=Qt("os-door",.5,.5),n=e<240,s=Ys(n?{angle:96,elevation:14,anchor:[0,.65,0],ndc:[0,0],distance:5.4}:{angle:96,elevation:14,anchor:t,ndc:Fi(i)},i,e),r=i<480?.74:.66;return wt(Os({frame:s,width:i,height:e,heroPoint:t,pins:[],dim:r,label:"A car under the stage light",ticks:-1}))}function Fn(i){return p("div",{class:"empty-state"},[p("div",{class:"empty-still","aria-hidden":"true"},[sa(320,140)]),p("p",{},[i])])}function Un(i,e,t){let n=Math.max(320,Math.min(1280,window.innerWidth)),s=Math.max(320,window.innerHeight);i.replaceChildren(p("div",{class:"ended-page"},[p("div",{class:"ended-still"},[sa(n,s)]),un(),p("main",{id:"main",class:"ended-main"},[p("div",{class:"notice-panel ended-notice"},[p("h1",{},[e]),...t?[p("p",{},[t])]:[]])]),Xt()]))}function ks(i,e){i.firstChild||i.append(p("span",{class:"meta-panel"})," \xB7 ",p("span",{class:"meta-band"})," \xB7 ",p("span",{class:"meta-severity"}));let[t,n,s]=[...i.children];Ze(t,e.panelLabel),Ze(n,e.band),n.className=`meta-band ${Vn(e.band)}`,Ze(s,e.severity),s.className="meta-severity"}var Fh="\u2014",Uh=280,G0=200,W0=40,X0=15e3;function Oh(i,e,t){new wl(i,e,t).mount()}var wl=class{view;token;root;stage;status=Mt("Walkround status","visually-hidden");notice=na();seenCount=Mt("Seen count","seen-count");offerStatus=Mt("Offer status","offer-status");dockLine=p("p",{class:"dock-line"});dockLines=p("div",{class:"dock-lines"},[this.dockLine]);dockButton=p("button",{type:"button",class:"pill pill-outline dock-button"});cards=p("ul",{class:"staircase",role:"list","aria-label":"Your walkround record"});slotList=p("ul",{class:"slot-list",role:"list","aria-label":"Viewing slots"});offerBand=p("section",{role:"region","aria-label":"Offer",class:"offer-band",id:"offer"});offerHeading=p("h2",{tabindex:"-1"},["Your offer"]);offerLapsed=p("div",{class:"notice-panel"},[p("h3",{},[se.lapsedHeading]),p("p",{},[se.lapsedBody])]);offerReread=p("p",{class:"offer-reread"},[se.offerNeedsReread]);offerAmount=p("p",{class:"offer-amount figures"});makeOffer=p("button",{type:"button",class:"pill pill-outline make-offer"},["Make an offer"]);handoverLink=p("a",{class:"text-link"},["Download handover record"]);offerInner=p("div",{class:"offer-inner"},[this.offerHeading]);rereadHolder=p("div",{class:"reread-holder"});rereadLine=p("p");rereadLink=p("a",{href:"#",class:"text-link"},["See the version you read"]);rereadPrompt=p("div",{role:"region","aria-label":"Re-read prompt",class:"notice-panel reread"},[p("h3",{},[se.rereadHeading]),this.rereadLine,this.rereadLink]);rereadVersion=0;dock=p("div",{role:"region","aria-label":"Walkround dock",class:"dock"});askingName=p("p",{class:"asking-name"});askingCount=p("p",{class:"asking-count"});askingPrice=p("p",{class:"asking-price"});askingStatus=p("p",{class:"asking-status"});asking=p("div",{role:"region","aria-label":"Asking summary",class:"asking-card"},[this.askingName,this.askingCount,this.askingPrice]);stageOverlay=p("div",{class:"stage-overlay"},[p("div",{class:"statements"},[p("p",{class:"statement-small"},["THEN MAKE YOUR OFFER"]),p("h1",{class:"statement-big"},["WALK ROUND IT FIRST"])]),this.asking]);handoff=p("div",{class:"handoff","aria-hidden":"true"},[p("div",{class:"handoff-photo-slot"}),p("div",{class:"handoff-body"},[p("p",{class:"handoff-title"}),p("p",{class:"handoff-meta"}),p("p",{class:"handoff-wording"})])]);handoffKey="";gaugeBody=p("tbody");tapeHolder=p("div",{class:"tape"});advisoryHolder=p("div",{class:"advisory-list"});countdown=new Xs;announcer;track=Ri([],null);lastScroll=0;jumping=!1;jumpToken=0;writing=new Set;failedWrites=[];offerDialog=null;claimDialog=null;menu=null;versionDialog=null;offerAttempt=new ri;claimAttempt=new ri;readsAsked=0;readApplied=0;ownReads=0;ended=!1;stageTrackEl=p("div",{class:"stage-track"});constructor(e,t,n){this.root=e,this.token=t,this.view=n,this.handoverLink.setAttribute("href",`/api/link/${t}/handover`),this.stage=new ds({label:"Walkround stage",carName:()=>this.view.car.name}),this.announcer=new fs(()=>this.status,["version","listing","offer","slots"])}findings(){return this.view.findings??[]}stageFindings(){return this.findings().map(e=>({id:e.id,position:e.position,panelId:e.panelId,u:e.u,v:e.v,seen:e.seen,title:e.title}))}mode(){return Pi()||!this.stage.usesWebgl?"still":"scroll"}dim(){return["under_offer","sold","withdrawn"].includes(this.view.car.listingStatus)?.42:1}mount(){this.root.replaceChildren(this.build()),this.track=Ri(this.stageFindings(),this.view.heroFindingId??null),this.stage.setTrack(this.track),this.stage.setMarkers(this.stageFindings()),this.stage.onMarkerPick(t=>this.goToFinding(t.position,!0)),this.paint(),this.layout(),this.watchTrail(),window.scrollTo({top:0,behavior:"instant"}),this.lastScroll=0,this.render(),oe(window,"scroll",()=>this.render(),{passive:!0});let e=()=>{this.root.isConnected&&(window.requestAnimationFrame(e),window.scrollY!==this.lastScroll&&this.settleScroll())};window.requestAnimationFrame(e),oe(window,"resize",()=>{this.layout(),this.render()}),this.stage.onStillDrop(()=>this.layout()),oe(document,"focusin",t=>{let n=t.target;n.closest&&n.closest(".overlay")||(this.markJump(),this.keepClear(t.target),this.catchUp())}),ys(()=>this.paintUnits()),this.announcer.start(this.lines()),window.setInterval(()=>void this.poll(),X0),oe(window,"focus",()=>void this.poll()),oe(window,"hashchange",()=>{window.history.replaceState(null,"",window.location.pathname+window.location.search),this.markJump(),window.scrollTo({top:0,behavior:"instant"}),this.catchUp()})}build(){let e=p("div",{class:"buyer-page"}),t=this.buildHeader(),n=this.stage.element;n.classList.add("stage-sticky"),n.append(this.stageOverlay,this.handoff),this.stageTrackEl.append(n);let s=p("section",{class:"band band-pale chapter",id:"walkround"},[Ct(p("h2",{class:"chapter-heading",tabindex:"-1"},["Every mark on the car, in the order you would walk round it"])),Ct(p("p",{class:"lead"},["The owner placed each finding on the panel it belongs to. Read them all and your record of this car fills in as you go."]))]),r=(u,d)=>p("div",{class:"record-fold"},[Ct(p("h3",{tabindex:"-1"},[u])),d]),a=p("section",{class:"record-block"},[p("div",{class:"plate-cards"},[Ml({id:"record",title:"Test record",body:"Every roadworthiness test on file, with the odometer tape and the advisories the owner has answered.",linkLabel:"Download condition report",href:`/api/link/${this.token}/report`,mark:"certificate",onJump:u=>this.goToSection(u)}),Ml({id:"gauge",title:"Gauge readings",body:"Paint depth on every gaugeable panel, banded against this car\u2019s own median on the same substrate.",linkLabel:"Read the panel readings",href:"#gauge-readings",mark:"gauge",onJump:u=>this.goToSection(u)})]),p("div",{class:"record-detail",id:"gauge-readings"},[r("Gauge readings",p("table",{"aria-label":"Gauge readings",class:"readings-table"},[p("thead",{},[p("tr",{},[p("th",{scope:"col"},["Panel"]),p("th",{scope:"col",class:"figure-head"},["Owner"]),p("th",{scope:"col"},["Band"]),p("th",{scope:"col",class:"figure-head"},["Inspector"])])]),this.gaugeBody])),r("Odometer tape",p("div",{role:"region","aria-label":"Odometer tape"},[this.tapeHolder])),r("Advisories",p("div",{role:"region","aria-label":"Advisories"},[this.advisoryHolder]))])]),o=p("section",{class:"viewings",id:"viewings"},[Ct(p("h2",{tabindex:"-1"},["Viewings"])),p("p",{class:"lead"},["Pick a slot and the owner will keep the car ready for you."]),this.slotList]),l=Dh(this.view.car.story,this.view.car.viewingArea,u=>this.goToSection(u)),c=Lh(this.view.car.viewingArea),h=p("main",{id:"main"},[this.stageTrackEl,s,p("section",{class:"band band-pale walkround-body"},[this.rereadHolder,this.cards,p("div",{class:"lower-stack"},[a,o])]),this.offerBand,l,c]);return oe(this.makeOffer,"click",()=>this.openOffer(this.makeOffer)),this.offerBand.append(this.offerInner),oe(this.rereadLink,"click",u=>{u.preventDefault(),this.openVersion(this.rereadVersion,this.rereadLink)}),oe(this.dockButton,"click",()=>this.pressDock()),this.dock.append(this.dockLines,this.dockButton),e.append(un(),t,this.notice,h,Xt(),this.dock,this.status),e}buildHeader(){let e=p("nav",{"aria-label":"Car file",class:"header-nav"},[p("a",{href:"#walkround"},["Walkround"]),p("a",{href:"#record"},["Record"]),p("a",{href:"#viewings"},["Viewings"]),p("a",{href:"#offer"},["Offer"])]);for(let n of cn(e,"a"))oe(n,"click",s=>{s.preventDefault(),this.goToSection(n.getAttribute("href")??"#walkround")});let t=p("button",{type:"button",class:"menu-button"},[p("span",{class:"menu-bar","aria-hidden":"true"}),p("span",{class:"menu-bar","aria-hidden":"true"}),p("span",{class:"visually-hidden"},["Menu"])]);return t.setAttribute("aria-label","Menu"),oe(t,"click",()=>this.openMenu(t)),p("header",{class:"overlay-header"},[p("div",{class:"header-row"},[p("span",{class:"wordmark"},["Ostler Lane"]),e,$0(),t])])}openMenu(e){let t=()=>this.menu?.close();this.menu=new Kt({name:"Menu",scrimCloses:!0,sheet:!0},()=>[p("div",{class:"overlay-head"},[p("h2",{},["Menu"]),Nh(t)]),p("nav",{"aria-label":"Car file",class:"menu-nav"},[...["#walkround","#record","#viewings","#offer"].map((n,s)=>{let r=["Walkround","Record","Viewings","Offer"][s],a=p("a",{href:n},[r]);return oe(a,"click",o=>{o.preventDefault(),t(),this.goToSection(n)}),a})]),p("div",{class:"menu-units"},[p("span",{},["Units"]),_s()])]),this.menu.show(e)}paint(){this.paintStageOverlay(),this.paintCards(),this.paintRecord(),this.paintSlots(),this.paintOffer(),this.paintDock(),this.paintUnits()}paintStageOverlay(){let e=this.view.car.listingStatus!=="live";Ze(this.askingName,this.view.car.name),Ze(this.askingCount,`${this.findings().length} findings`),Ze(this.askingPrice,hn(this.view.car.askingPounds)),Ze(this.askingStatus,e?zn[this.view.car.listingStatus]??"":""),ca(this.asking,[this.askingName,this.askingCount,this.askingPrice,...e?[this.askingStatus]:[]]),this.placeSeenCount()}paintCards(){let e=[...this.findings().map(t=>({kind:"finding",key:t.id,finding:t})),...(this.view.removedFindings??[]).map(t=>({kind:"removed",key:`removed:${t.id}`,title:t.title,version:t.removedInVersion}))];Dt(this.cards,e,t=>t.key,()=>Ct(p("li",{class:"card-item"})),(t,n)=>{if(n.kind==="removed"){t.firstElementChild?.getAttribute("data-removed")!==n.key&&t.replaceChildren(p("article",{"aria-label":n.title,class:"finding-card is-removed","data-removed":n.key},[p("h3",{},[n.title]),p("p",{},[`Removed by the owner in version ${n.version}`])]));return}this.fillCard(t,n.finding)}),this.paintReread(),Ze(this.seenCount,`${this.view.progress?.seen??0} of ${this.view.progress?.total??0} seen`)}fillCard(e,t){let n=we(e,"article");n||(n=p("article",{class:"finding-card","data-finding":t.id},[p("div",{class:"card-photo-slot"}),p("div",{class:"card-body"},[p("h3",{class:"card-title"}),p("p",{class:"card-meta"}),p("p",{class:"card-wording"}),p("p",{class:"card-changed",hidden:!0},[se.changedCard]),p("div",{class:"card-seen-slot"})])]),e.replaceChildren(n)),vs(n,"aria-label",`Finding ${t.position}: ${t.title}`),vs(n,"data-seen",t.seen?"true":"false"),n.classList.toggle("is-seen",t.seen),n.classList.toggle("is-changed",t.changedSinceSeen),Ze(we(n,".card-title"),t.title),ks(we(n,".card-meta"),t),Ze(we(n,".card-wording"),t.wording);let s=we(n,".card-changed");s&&(s.hidden=!t.changedSinceSeen);let r=we(n,".card-photo-slot"),a=t.photoId??"none";r&&r.dataset.photo!==a&&(r.dataset.photo=a,r.replaceChildren(this.cardPhoto(t)));let o=we(n,".card-seen-slot"),l=t.seen?`seen:${t.seenAt??""}`:"pill";o&&o.dataset.state!==l&&(o.dataset.state=l,o.replaceChildren(t.seen&&t.seenAt?p("p",{class:"card-seen"},[`Seen ${oi(t.seenAt)}`]):this.readPill(t)))}cardPhoto(e){if(!e.photoId)return p("div",{class:"card-photo card-photo-drawn","aria-hidden":"true"},[wt(q0())]);let t=p("img",{class:"card-photo",src:`/api/link/${this.token}/photos/${e.photoId}`,alt:e.title,loading:"lazy"});return oe(t,"error",()=>Ae(this.notice,se.photosDown)),t}readPill(e){let t=p("button",{type:"button",class:"pill pill-read"},["I've read this"]);return Je(t,async()=>{Ae(this.status,"Saving"),await this.writeSeen(e.id,!0)&&this.focusNextPill(e.position)}),t}focusNextPill(e){let t=this.findings().find(s=>!s.seen&&s.position>e)??this.findings().find(s=>!s.seen);if(t){let s=we(this.cards,`[data-finding="${t.id}"] .pill-read`);if(s){s.focus();return}}let n=we(this.offerBand,".make-offer");n?n.focus():we(this.offerBand,"h2")?.focus()}paintReread(){let e=this.view.version?.number??1,t=(this.view.versionsRead??[]).filter(s=>s<e);if(t.length===0){this.rereadPrompt.remove();return}this.rereadVersion=Math.max(...t);let n=this.findings().filter(s=>s.changedSinceSeen).length;Ze(this.rereadLine,`Findings changed since you read them: ${n}`),this.rereadPrompt.isConnected||this.rereadHolder.append(this.rereadPrompt)}async openVersion(e,t){try{let n=await Ee.get(`/api/link/${this.token}/versions/${e}`),s=()=>this.versionDialog?.close();this.versionDialog=new Kt({name:`Version ${e}`},()=>[p("div",{class:"overlay-head"},[p("h2",{},[`Version ${e}`]),Nh(s)]),p("div",{class:"version-body"},n.findings.map(r=>p("div",{class:"version-finding"},[p("h3",{},[`${r.position}. ${r.title}`]),p("p",{},[r.wording])])))]),this.versionDialog.show(t)}catch{Ae(this.status,se.sendFailed)}}paintRecord(){let e=this.view.record;this.gaugeBody.replaceChildren(...this.view.panels.map(t=>p("tr",{},[p("th",{scope:"row"},[t.label]),p("td",{class:"figures owner-figure"},[t.owner?.microns==null?Fh:gn(t.owner.microns)]),p("td",{},[p("span",{class:Vn(t.owner?.band??"")},[t.owner?.band??""])]),p("td",{class:"figures inspector-figure"},[t.inspector.map(n=>gn(n.microns)).join(", ")||Fh])]))),e&&(this.tapeHolder.replaceChildren(...e.tape.map(t=>p("div",{class:"tape-step"},[p("p",{class:"tape-date"},[oi(t.completedDate)]),p("p",{class:"tape-reading figures"},[t.odometerValue===null?"\u2014":`${Number(t.odometerValue).toLocaleString("en-GB")} ${t.odometerUnit??""}`]),p("p",{class:t.flag?"tape-flag":`tape-flag tape-result-${t.testResult.toLowerCase()}`},[t.flag?Gs[t.flag]:t.testResult])]))),this.advisoryHolder.replaceChildren(p("p",{class:"advisory-tally"},[`Open advisories: ${e.openAdvisories}`]),...e.advisories.map(t=>p("div",{class:"advisory-step"},[p("p",{class:"advisory-text"},[t.text]),p("p",{class:"advisory-stance"},[t.stance??"Not answered"]),...t.note?[p("p",{class:"advisory-note"},[t.note])]:[]]))))}paintUnits(){this.paintRecord()}paintSlots(){let e=this.view.slots??[];if(e.length===0){this.slotList.replaceChildren(p("li",{},[Fn(se.noViewings)]));return}Dt(this.slotList,e,t=>t.id,()=>p("li",{class:"slot-row"},[p("span",{class:"slot-label"}),p("span",{class:"slot-length"}),p("span",{class:"slot-action"})]),(t,n)=>{Ze(we(t,".slot-label"),n.label),Ze(we(t,".slot-length"),`${n.durationMinutes} minutes`);let s=we(t,".slot-action");if(!s)return;let r=n.heldByYou?"mine":n.held?"held":this.view.car.listingStatus;if(s.dataset.state!==r)if(s.dataset.state=r,n.heldByYou){let a=p("button",{type:"button",class:"pill"},[`Release ${n.label}`]);Je(a,()=>this.releaseSlot(n)),s.replaceChildren(a)}else if(n.held)s.replaceChildren(p("span",{class:"slot-held"},["Held"]));else if(this.view.car.listingStatus==="live"){let a=p("button",{type:"button",class:"pill"},[`Claim ${n.label}`]);oe(a,"click",()=>this.openClaim(n,a)),s.replaceChildren(a)}else s.replaceChildren()})}paintOffer(){let e=this.view.offer??null,t=e&&(e.status==="open"||e.status==="needs_reread"),n=document.activeElement===this.makeOffer;e&&Ze(this.offerAmount,`You offered ${hn(e.amountPounds)}`),ca(this.offerInner,[this.offerHeading,...e?.status==="lapsed"?[this.offerLapsed]:[],...e?.status==="needs_reread"?[this.offerReread]:[],...e?[this.offerAmount]:[],...this.view.car.listingStatus==="live"&&!t?[this.makeOffer]:[],...this.view.car.listingStatus==="sold"?[this.handoverLink]:[],...this.offerStatus.parentElement===this.offerInner?[this.offerStatus]:[]]),n&&!this.makeOffer.isConnected&&this.offerHeading.focus(),e&&(this.countdown.reset(e.secondsRemaining),this.paintOfferStatus()),this.placeOfferStatus()}paintOfferStatus(){let e=this.view.offer??null;if(!e)return;let t=Li[e.status]??e.status,n=e.status==="open"||e.status==="needs_reread";Ze(this.offerStatus,n?`${t} ${ai(this.countdown.left())}`:t)}placeSeenCount(){let e=Bn()?this.dockLines:this.stageOverlay;this.seenCount.parentElement!==e&&e.prepend(this.seenCount)}placeOfferStatus(){if(!(this.view.offer??null)){this.offerStatus.remove();return}let t=Bn()?this.dockLines:this.offerInner;this.offerStatus.parentElement!==t&&t.append(this.offerStatus)}paintDock(){Ze(this.dockButton,this.findings().some(t=>!t.seen)?"Next unread":"To the offer");let e=(this.view.slots??[]).find(t=>t.heldByYou);Ze(this.dockLine,!this.view.offer&&e?`Viewing ${e.label}`:""),this.placeSeenCount(),this.placeOfferStatus()}pressDock(){let e=this.findings().find(t=>!t.seen);if(e){this.goToFinding(e.position,!0);return}this.goToSection("#offer"),we(this.offerBand,".make-offer")?.focus({preventScroll:!0})}watchTrail(){let e=we(this.root,".lower-stack"),t=new ResizeObserver(()=>this.measureTrail());t.observe(this.cards),e&&t.observe(e)}layout(){this.dock.hidden=!Bn(),this.placeSeenCount(),this.placeOfferStatus(),this.measureTrail(),this.stageTrackEl.style.height=this.mode()==="scroll"?`${Th(this.findings().length)+window.innerHeight}px`:"",this.stageTrackEl.classList.toggle("is-still",this.mode()==="still")}measureTrail(){let t=[...this.cards.children].filter((c,h)=>h<6?h%3===2:!0);for(let c of t)c.style.removeProperty("--top");let n=we(this.root,".lower-stack");if(!n||window.innerWidth<1200||t.length===0)return;let s=this.cards.getBoundingClientRect().top,r=t.map(c=>c.offsetHeight),a=t.length-1,o=n.getBoundingClientRect().bottom-s-r[a]+G0,l=-1/0;t.forEach((c,h)=>{let u=a===0?o:Uh+(o-Uh)*h/a,d=Math.max(u,l);l=d+r[h]+W0,c.style.setProperty("--top",`${Math.round(d)}px`)})}render(){let e=this.mode(),t=this.stage.stateFor(window.scrollY,e);this.stageOverlay.classList.toggle("is-handed-off",t.beat>0),this.paintHandoff(t),this.stage.draw({state:t,mode:e,listing:this.view.car.listingStatus,dim:this.dim()})}paintHandoff(e){let t=e.travel>0&&e.finding!==null;if(this.handoff.classList.toggle("is-travelling",t),!t||!e.finding){this.handoffKey="";return}let n=this.findings().find(r=>r.id===e.finding?.id);if(!n)return;let s=`${n.id}:${n.photoId??"none"}:${n.band}:${n.wording}`;s!==this.handoffKey&&(this.handoffKey=s,Ze(we(this.handoff,".handoff-title"),n.title),ks(we(this.handoff,".handoff-meta"),n),Ze(we(this.handoff,".handoff-wording"),n.wording),we(this.handoff,".handoff-photo-slot")?.replaceChildren(this.cardPhoto(n))),this.handoff.style.setProperty("--travel",e.travel.toFixed(3))}settleScroll(){if(this.jumping)return;let e=window.scrollY;if(this.mode()==="scroll")for(let t of Ph(this.track,this.lastScroll,e))this.findings().find(n=>n.id===t.id)?.seen||this.writeSeen(t.id,!1);this.lastScroll=e,this.render()}markJump(){this.jumping=!0,this.jumpToken+=1;let e=this.jumpToken,{port1:t,port2:n}=new MessageChannel;t.onmessage=()=>{t.close(),!(this.jumpToken!==e||!this.jumping)&&(this.jumping=!1,this.lastScroll=window.scrollY,this.render())},n.postMessage(null)}jumpTo(e){this.markJump(),window.scrollTo({top:e,behavior:"instant"}),this.catchUp()}catchUp(){this.lastScroll=window.scrollY,this.render()}goToFinding(e,t){let n=this.findings().find(a=>a.position===e);if(!n)return;if(t&&Ae(this.status,`Finding ${e} of ${this.findings().length}`),this.mode()==="scroll"){this.jumpTo(Ln*e);return}let s=we(this.cards,`[data-finding="${n.id}"]`);if(!s)return;this.markJump(),s.scrollIntoView({block:"center",behavior:"instant"}),this.catchUp();let r=we(s,".pill-read");r?r.focus():s.focus()}goToSection(e){let n={"#walkround":()=>we(this.root,".chapter-heading"),"#record":()=>we(this.root,"#record .plate-title"),"#viewings":()=>we(this.root,".viewings h2"),"#offer":()=>we(this.offerBand,"h2"),"#gauge-readings":()=>we(this.root,"#gauge-readings .record-fold h3")}[e]?.()??null;n&&(this.markJump(),n.scrollIntoView({block:"start",behavior:"instant"}),this.catchUp(),n.focus({preventScroll:!0}),this.keepClear(n))}keepClear(e){if(!e||!Bn()||this.dock.hidden||e.closest(".overlay, .dock, .overlay-header"))return;let t=e.getBoundingClientRect(),n=this.dock.getBoundingClientRect(),s=we(this.root,".overlay-header")?.getBoundingClientRect(),r=0;t.bottom>n.top?r=t.bottom-n.top+12:s&&t.top<s.bottom&&(r=t.top-s.bottom-12),r!==0&&(this.markJump(),window.scrollBy({top:r,behavior:"instant"}),this.catchUp())}async writeSeen(e,t){if(this.writing.has(e))return!1;this.writing.add(e),this.failedWrites=this.failedWrites.filter(n=>n!==e);try{return await Ee.post(`/api/link/${this.token}/seen`,{findingId:e}),await this.refresh(["version"]),!0}catch(n){return n instanceof rt&&(n.status===404||n.status===410)?(await this.refresh([]),!1):(Ae(this.status,se.seenFailed),t||this.failedWrites.push(e),!1)}finally{this.writing.delete(e)}}openClaim(e,t){this.claimAttempt.reopen();let n=!1,s=!1,r=Mt("Dialog status"),a=p("button",{type:"button",class:"pill pill-solid"},["Confirm viewing"]),o=p("button",{type:"button",class:"pill"},["Cancel"]),l=new Kt({name:"Claim viewing",locked:()=>a.isConnected&&a.getAttribute("aria-disabled")==="true",focusHome:()=>{let c=we(this.root,".viewings h2");return n?c:cn(this.slotList,"button").find(u=>u.textContent===`Claim ${e.label}`)??c},onClose:()=>{this.claimDialog=null,s||this.announcer.setHeld(!1,this.lines())}},()=>[p("div",{class:"overlay-head"},[p("h2",{},["Claim viewing"])]),p("p",{},[`Hold ${e.label} for ${e.durationMinutes} minutes.`]),r,p("div",{class:"overlay-actions"},[a,o])]);oe(o,"click",()=>l.close()),Je(a,async()=>{Ae(r,"Claiming viewing");let c=this.claimAttempt.keyFor({slot:e.id});try{await Ee.post(`/api/link/${this.token}/slots/${e.id}/claim`,{},{"Idempotency-Key":c}),s=!0,l.close(),await this.refresh(["slots"]),Ae(this.status,`Viewing held for ${e.label}`),cn(this.slotList,"button").find(u=>u.textContent===`Release ${e.label}`)?.focus(),this.announcer.setHeld(!1,this.lines())}catch(h){if(h instanceof Lt||h instanceof rt&&h.status>=500){Ae(r,se.sendFailed);return}let u=h,d={slot_taken:se.slotTaken,slot_past:se.slotTaken,already_holding_slot:se.alreadyHolding,listing_closed:se.listingClosed};n=u.body.error==="slot_taken"||u.body.error==="slot_past",Ae(r,d[u.body.error]??u.body.message),a.remove(),o.focus(),await this.refresh([])}}),this.announcer.setHeld(!0,this.lines()),l.show(t),this.claimDialog=l}async releaseSlot(e){Ae(this.status,"Releasing viewing");try{await Ee.post(`/api/link/${this.token}/slots/${e.id}/release`,{}),await this.refresh(["slots"]),Ae(this.status,"Viewing released"),cn(this.slotList,"button").find(n=>n.textContent===`Claim ${e.label}`)?.focus()}catch(t){Ae(this.status,t instanceof rt?t.body.message:se.sendFailed)}}openOffer(e){this.offerAttempt.reopen();let t=!1,n=Mt("Dialog status"),s=p("input",{type:"number",min:"1",max:"10000000",step:"1","aria-label":"Offer in pounds",class:"field-input figures"}),r=p("button",{type:"button",class:"pill pill-solid"},["Send offer"]),a=p("button",{type:"button",class:"pill"},["Cancel"]),o=new Kt({name:"Make an offer",locked:()=>r.isConnected&&r.getAttribute("aria-disabled")==="true",focusHome:()=>we(this.offerBand,".make-offer")??we(this.offerBand,"h2"),onClose:()=>{this.offerDialog=null,t||this.announcer.setHeld(!1,this.lines())}},()=>[p("div",{class:"overlay-head"},[p("h2",{},["Make an offer"])]),p("p",{},[`The owner is asking ${hn(this.view.car.askingPounds)}.`]),p("label",{class:"field"},[p("span",{},["Offer in pounds"]),s]),n,p("div",{class:"overlay-actions"},[r,a])]);oe(a,"click",()=>o.close()),oe(s,"keydown",l=>{l.key==="Enter"&&(l.preventDefault(),r.click())}),Je(r,async()=>{let l=Number(s.value);Ae(n,"Sending offer");let c=this.offerAttempt.keyFor({amountPounds:l});try{await Ee.post(`/api/link/${this.token}/offers`,{amountPounds:l},{"Idempotency-Key":c}),t=!0,o.close(),await this.refresh(["offer"]),Ae(this.status,"Offer sent"),we(this.offerBand,"h2")?.focus(),this.announcer.setHeld(!1,this.lines())}catch(h){if(h instanceof Lt||h instanceof rt&&h.status>=500){Ae(n,se.sendFailed);return}let u=h,d={material_findings_unseen:se.materialUnseen,offer_exists:se.offerExists,listing_closed:se.listingClosed},m=u.body.errors?.amountPounds;Ae(n,m??d[u.body.error]??u.body.message)}}),this.announcer.setHeld(!0,this.lines()),o.show(e),this.offerDialog=o}lines(){let e=(this.view.slots??[]).filter(n=>!n.held).length,t=new Map;return t.set("version",`The owner has published version ${this.view.version?.number??1}`),t.set("listing",`This car is now ${zn[this.view.car.listingStatus]??""}`),t.set("offer",this.view.offer?`Your offer is now ${Li[this.view.offer.status]??""}`:"Your offer is now none"),t.set("slots",`Viewing slots free: ${e}`),t}async refresh(e){this.readsAsked+=1;let t=this.readsAsked;this.ownReads+=1;let n;try{n=await Ee.get(`/api/link/${this.token}`)}finally{this.ownReads-=1}t>this.readApplied&&(this.readApplied=t,this.apply(n)),this.announcer.own(this.lines(),["version","listing","offer","slots"].filter(s=>e.includes(s)||s==="version"))}async poll(){if(this.ended)return;this.readsAsked+=1;let e=this.readsAsked,t;try{t=await Ee.get(`/api/link/${this.token}`)}catch(n){if(n instanceof rt&&(n.status===404||n.status===410)){this.endPage();return}await this.retryFailedWrites();return}e===this.readsAsked&&this.ownReads===0&&(this.readApplied=e,this.apply(t),this.announcer.found(this.lines())),await this.retryFailedWrites()}async retryFailedWrites(){let e=[...this.failedWrites];this.failedWrites=[];for(let t of e)await this.writeSeen(t,!1)}endPage(){this.ended=!0,this.offerDialog?.destroy(),this.claimDialog?.destroy(),this.menu?.destroy(),this.versionDialog?.destroy(),Un(this.root,se.linkEndedHeading,se.linkEndedBody)}apply(e){let t=this.findings().length;this.view=e,this.track=Ri(this.stageFindings(),e.heroFindingId??null),this.stage.setTrack(this.track),this.stage.setMarkers(this.stageFindings()),this.paintStageOverlay(),this.paintCards(),this.paintRecord(),this.paintSlots(),this.paintOffer(),this.paintDock(),t!==this.findings().length?(this.layout(),this.lastScroll=window.scrollY):(this.placeSeenCount(),this.placeOfferStatus()),this.render()}};function Nh(i){let e=p("button",{type:"button",class:"pill pill-quiet"},["Close"]);return oe(e,"click",i),e}function $0(){return wt(`<svg viewBox="0 0 48 32" width="48" height="32" aria-hidden="true" class="brand-mark">
    <path d="M4 24 C12 10 24 6 44 8" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M8 26 L40 26" stroke="#8FB8F0" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M26 6 L34 2" stroke="#8FB8F0" stroke-width="2" stroke-linecap="round"/>
  </svg>`)}function q0(){return`<svg viewBox="0 0 320 180" role="presentation" class="card-still">
    <defs><linearGradient id="ob-card" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#4A52C8"/><stop offset="1" stop-color="#140A3F"/>
    </linearGradient></defs>
    <rect width="320" height="180" fill="url(#ob-card)"/>
    <path d="M0 120 L320 86 L320 180 L0 180 Z" fill="#0E0339" opacity="0.85"/>
    <path d="M40 104 L300 70" stroke="#FFF2DB" stroke-width="2" opacity="0.5"/>
  </svg>`}var ra=class{key;leaseKey;listeners=new Set;mine=Math.random().toString(36).slice(2);constructor(e){this.key=`open-bonnet-capture:${e}`,this.leaseKey=`open-bonnet-capture-lease:${e}`,window.addEventListener("storage",t=>{t.key===this.key&&this.tell()})}onChange(e){this.listeners.add(e)}tell(){for(let e of this.listeners)e()}items(){try{let e=localStorage.getItem(this.key),t=e?JSON.parse(e):[];return Array.isArray(t)?t:[]}catch{return[]}}save(e){localStorage.setItem(this.key,JSON.stringify(e)),this.tell()}settleOnLoad(){let e=this.items(),t=!1;for(let n of e)n.state==="sending"&&(n.state="queued",t=!0);t&&this.save(e)}add(e){let t=this.items();t.push(e),this.save(t)}waiting(){return this.items().filter(e=>e.state==="queued")}leaseHeld(){let e=localStorage.getItem(this.leaseKey);if(!e)return!1;let[t,n]=e.split(":");return t===this.mine?!1:Date.now()-Number(n)<2e4}takeLease(){return this.leaseHeld()?!1:(localStorage.setItem(this.leaseKey,`${this.mine}:${Date.now()}`),!0)}releaseLease(){let e=localStorage.getItem(this.leaseKey);e&&e.startsWith(`${this.mine}:`)&&localStorage.removeItem(this.leaseKey)}async alone(e){let t=navigator.locks;if(t){await t.request(this.leaseKey,{ifAvailable:!0},async n=>{n&&await e()});return}if(this.takeLease())try{await e()}finally{this.releaseLease()}}mark(e,t,n){let s=this.items();for(let r of s)e.includes(r.clientId)&&(r.state=t,n!==void 0&&(r.reason=n));this.save(s)}applyResults(e){let t=this.items();for(let n of e){let s=t.find(r=>r.clientId===n.clientId);s&&(n.state==="applied"||n.state==="duplicate"?s.state="synced":n.state==="conflict"?s.state="conflict":(s.state="rejected",s.reason=Object.values(n.errors??{}).join(" ")))}this.save(t)}};function Al(i,e,t){new Sl(i,e,t).mount()}var Sl=class{view;token;root;queue;status=Mt("Capture status");notice=p("p",{role:"alert","aria-label":"Service notice",class:"notice-panel",hidden:!0});panelList=p("ul",{role:"list","aria-label":"Capture panels",class:"panel-list"});queueList=p("ul",{role:"list","aria-label":"Capture queue",class:"queue-list"});diagram=p("div",{class:"diagram-holder"});panelId=vt[0].id;pin={u:.5,v:.5};sending=!1;constructor(e,t,n){this.root=e,this.token=t,this.view=n,this.queue=new ra(t)}mount(){this.queue.settleOnLoad(),this.root.replaceChildren(this.build()),this.paintPanels(),this.paintQueue(),this.paintDiagram(),this.queue.onChange(()=>this.paintQueue()),ys(()=>this.paintPanels()),oe(window,"online",()=>void this.send(!1)),"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(()=>{})}build(){let e=p("select",{"aria-label":"Panel",class:"field-input"},vt.map(l=>p("option",{value:l.id},[l.label])));oe(e,"change",()=>{this.panelId=e.value,this.pin={u:.5,v:.5},this.paintDiagram()});let t=p("input",{type:"number",min:"1",max:"2000",step:"1","aria-label":"Microns",class:"field-input figures"}),n=p("button",{type:"button",class:"pill pill-solid"},["Queue reading"]);oe(n,"click",()=>{let l=Number(t.value);if(!Number.isInteger(l)||l<1||l>2e3){Ae(this.status,se.microns);return}if(!Ks(this.panelId)){Ae(this.status,se.plastic);return}this.queue.add({clientId:crypto.randomUUID(),kind:"reading",panelId:this.panelId,panelLabel:vt.find(c=>c.id===this.panelId)?.label??this.panelId,microns:l,capturedAt:new Date().toISOString(),state:"queued"}),t.value="",this.paintQueue()});let s=p("input",{type:"text","aria-label":"Finding note",class:"field-input"}),r=p("button",{type:"button",class:"pill pill-solid"},["Queue finding"]);oe(r,"click",()=>{if(s.value.trim().length===0){Ae(this.status,"Write a note for the finding");return}this.queue.add({clientId:crypto.randomUUID(),kind:"finding",panelId:this.panelId,panelLabel:vt.find(l=>l.id===this.panelId)?.label??this.panelId,u:this.pin.u,v:this.pin.v,wording:s.value.trim(),capturedAt:new Date().toISOString(),state:"queued"}),s.value="",this.paintQueue()});let a=p("button",{type:"button",class:"pill pill-solid"},["Send now"]);Je(a,()=>this.send(!0));let o=p("button",{type:"button",class:"pin-button"},["Finding pin"]);return oe(o,"keydown",l=>this.movePin(l)),p("div",{class:"inspector-page"},[un(),p("header",{class:"work-header"},[p("span",{class:"wordmark"},["Ostler Lane"]),p("p",{class:"work-car"},[p("span",{},[this.view.car.name]),p("span",{class:"figures"},[this.view.car.maskedRegistration])])]),this.notice,p("main",{id:"main",class:"inspector-main"},[p("section",{class:"card panel-column"},[p("h2",{},["Panels and readings"]),p("div",{class:"phone-units"},[p("span",{},["Units"]),_s()]),this.panelList]),p("section",{class:"card capture-column"},[p("h2",{},["Record a reading"]),p("label",{class:"field"},[p("span",{},["Panel"]),e]),p("label",{class:"field"},[p("span",{},["Microns"]),t]),n,p("h2",{},["Pin a finding"]),this.diagram,o,p("label",{class:"field"},[p("span",{},["Finding note"]),s]),r,p("h2",{},["Capture queue"]),this.queueList,a,this.status])]),Xt()])}movePin(e){let n={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!n)return;e.preventDefault();let s=e.shiftKey?.05:.01;this.pin={u:Math.min(1,Math.max(0,Math.round((this.pin.u+n[0]*s)*1e3)/1e3)),v:Math.min(1,Math.max(0,Math.round((this.pin.v+n[1]*s)*1e3)/1e3))},this.paintDiagram(),Ae(this.status,`Pin at ${Math.round(this.pin.u*100)}% across, ${Math.round(this.pin.v*100)}% down`)}paintDiagram(){let e=Qr(this.panelId,this.pin.u,this.pin.v),t=Ns({interactive:!0,pins:e?[{x:e.x,y:e.y,label:"Finding pin",strong:!0}]:[]}),n=wt(t);this.diagram.replaceChildren(n),oe(n,"pointerdown",s=>{let r=s,a=n.getBoundingClientRect(),o=(r.clientX-a.left)/a.width*300,l=(r.clientY-a.top)/a.height*540,c=[...vt].map(u=>Us(u.id)).find(u=>u&&o>=u.x&&o<=u.x+u.width&&l>=u.y&&l<=u.y+u.height);if(!c)return;s.preventDefault(),this.panelId=c.id;let h=we(this.root,'select[aria-label="Panel"]');h&&(h.value=c.id),this.pin={u:Math.round((o-c.x)/c.width*1e3)/1e3,v:Math.round((l-c.y)/c.height*1e3)/1e3},this.paintDiagram()})}paintPanels(){this.panelList.replaceChildren(...this.view.panels.map(e=>p("li",{class:"panel-row"},[p("span",{class:"panel-name"},[e.label]),p("span",{class:"figures panel-figure"},[e.owner?.microns==null?"\u2014":gn(e.owner.microns)]),p("span",{class:`panel-band ${Vn(e.owner?.band??"")}`},[e.owner?.band??""]),p("span",{class:"figures panel-mine"},[e.inspector.map(t=>gn(t.microns)).join(", ")])])))}paintQueue(){let e=this.queue.items();if(e.length===0){this.queueList.replaceChildren(p("li",{},[Fn(se.nothingQueued)]));return}this.queueList.replaceChildren(...e.map(t=>p("li",{class:"queue-row"},[p("span",{},[t.panelLabel]),p("span",{class:"figures"},[t.kind==="reading"?gn(t.microns??null):t.wording??""]),p("span",{class:`queue-state state-${t.state}`},[Wl[t.state]]),...t.reason?[p("span",{class:"queue-reason"},[t.reason])]:[]])))}async send(e){if(!this.sending){this.sending=!0;try{await this.queue.alone(async()=>{let t=this.queue.waiting();if(t.length===0)return;let n=t.map(s=>s.clientId);this.queue.mark(n,"sending"),this.paintQueue(),Ae(this.status,"Sending queued items");try{let s=await Ee.post(`/api/link/${this.token}/capture`,{batchId:crypto.randomUUID(),items:t.map(Y0)});this.queue.applyResults(s.results),this.paintQueue(),await this.refreshPanels(),Ae(this.status,"All items synced"),this.notice.hidden=!0}catch(s){if(s instanceof rt&&(s.status===404||s.status===410)){this.queue.mark(n,"rejected",se.replayEnded),this.paintQueue(),Ae(this.status,se.replayEnded);return}this.queue.mark(n,"queued"),this.paintQueue(),s instanceof Lt||!navigator.onLine?(this.notice.hidden=!1,this.notice.textContent=se.captureOffline,Ae(this.status,se.captureOffline)):Ae(this.status,s.body.message)}})}finally{this.sending=!1}}}async refreshPanels(){try{let e=await Ee.get(`/api/link/${this.token}`);this.view=e,Vs(this.token,e),this.paintPanels()}catch(e){e instanceof rt&&(e.status===404||e.status===410)&&Un(this.root,se.linkEndedHeading,se.linkEndedBody)}}};function Y0(i){return i.kind==="reading"?{clientId:i.clientId,kind:"reading",panelId:i.panelId,microns:i.microns,capturedAt:i.capturedAt}:{clientId:i.clientId,kind:"finding",panelId:i.panelId,u:i.u,v:i.v,wording:i.wording,capturedAt:i.capturedAt}}function kh(i,e){let t=Mt("Owner status"),n=p("input",{type:"password","aria-label":"Passphrase",class:"field-input",autocomplete:"current-password"}),s=p("p",{class:"field-error",hidden:!0}),r=p("button",{type:"button",class:"pill pill-solid"},["Sign in"]);Je(r,async()=>{Ae(t,"Checking passphrase");try{await Ee.post("/api/owner/session",{passphrase:n.value}),window.location.assign(e)}catch(o){let l=o instanceof rt&&o.status===401?se.passphraseWrong:se.sendFailed;s.hidden=!1,s.textContent=l,Ae(t,l)}}),oe(n,"keydown",o=>{o.key==="Enter"&&(o.preventDefault(),r.click())}),i.replaceChildren(p("div",{class:"owner-page signin-page"},[un(),p("header",{class:"work-header"},[p("span",{class:"wordmark"},["Ostler Lane"]),p("p",{},["Open Bonnet"])]),p("main",{id:"main",class:"signin-main"},[p("div",{class:"signin-art","aria-hidden":"true"},[sa(560,320)]),p("div",{class:"card signin-card"},[p("h1",{},["Sign in to your car files"]),p("p",{class:"lead"},["One owner, one passphrase. Buyers and inspectors arrive by their own named link."]),p("label",{class:"field"},[p("span",{},["Passphrase"]),n,s]),r,t])]),Xt()])),n.focus()}function aa(i){let e=p("button",{type:"button",class:"pill pill-outline"},["Sign out"]);return oe(e,"click",()=>{Ee.delete("/api/owner/session").finally(()=>window.location.assign("/owner"))}),{bar:un(),header:p("header",{class:"work-header"},[p("div",{},[p("span",{class:"wordmark"},["Ostler Lane"]),p("p",{class:"work-subtitle"},[i])]),e]),status:Mt("Owner status"),notice:na()}}var Bh=[{name:"name",label:"Car name",kind:"text"},{name:"registration",label:"Registration",kind:"text"},{name:"askingPounds",label:"Asking price in pounds",kind:"number"},{name:"viewingArea",label:"Viewing area",kind:"text"},{name:"homeAddress",label:"Home address",kind:"text"},{name:"story",label:"Owner story",kind:"text"}];function zh(i,e){let t=aa("Your car files"),n=new Map,s=new Map,r=p("div",{class:"card new-car"},[Ct(p("h2",{},["Start a new car file"])),...Bh.map(l=>{let c=p("input",{type:l.kind==="number"?"number":"text","aria-label":l.label,class:`field-input${l.kind==="number"?" figures":""}`,...l.kind==="number"?{min:"1",max:"10000000",step:"1"}:{}}),h=p("p",{class:"field-error",hidden:!0});return n.set(l.name,c),s.set(l.name,h),p("label",{class:"field"},[p("span",{},[l.label]),c,h])})]),a=p("button",{type:"button",class:"pill pill-solid"},["Create car file"]);Je(a,async()=>{for(let c of s.values())c.hidden=!0,c.textContent="";Ae(t.status,"Creating car file");let l={};for(let c of Bh){let h=n.get(c.name)?.value??"";l[c.name]=c.kind==="number"?Number(h):h}try{let c=await Ee.post("/api/owner/cars",l);window.location.assign(`/owner/cars/${c.id}#panels`)}catch(c){if(c instanceof rt&&c.body.errors){for(let[h,u]of Object.entries(c.body.errors)){let d=s.get(h);d&&(d.hidden=!1,d.textContent=u)}Ae(t.status,"Check the car file details");return}Ae(t.status,"That could not be sent. Try again.")}}),r.append(a);let o=p("ul",{role:"list","aria-label":"Garage",class:"garage-list"},e.map(l=>Ct(p("li",{class:"card garage-row"},[p("a",{href:`/owner/cars/${l.id}`,class:"garage-link"},[l.name]),p("p",{class:"garage-meta"},[`${zn[l.listingStatus]} \xB7 ${l.currentVersion===null?"No version yet":`Version ${l.currentVersion}`}`]),p("p",{class:"garage-meta figures"},[`${hn(l.askingPounds)} \xB7 Open advisories: ${l.workingOpenAdvisories}`])]))));i.replaceChildren(p("div",{class:"owner-page garage-page"},[t.bar,t.header,t.notice,p("main",{id:"main",class:"garage-main"},[Ct(p("h1",{},["Your garage"])),o,r,t.status]),Xt()]));for(let l of o.querySelectorAll("a"))oe(l,"click",c=>{c.preventDefault(),window.location.assign(l.getAttribute("href")??"/owner/cars")})}function Z0(i){let e=p("p",{class:"finding-meta"});return ks(e,i),e}function Nn(i,e,t){return p("section",{id:i,class:"car-section"},[Ct(p("h2",{tabindex:"-1"},[e])),...t.filter(n=>n!==null)])}function Wh(i){let e=[],t={},n=(G,P,W)=>{t[G]=P,e.push(W)},s=p("tbody"),r=new Map,a=new Map,o=p("button",{type:"button",class:"pill pill-solid"},["Save readings"]);Je(o,async()=>{let G=[];for(let[P,W]of a)W.value.trim()!==""&&W.dataset.saved!==W.value&&G.push({panelId:P,microns:Number(W.value)});if(G.length!==0){for(let P of r.values())P.hidden=!0,P.textContent="";await i.act({pending:"Saving readings",success:"Readings saved",ownKeys:["panels","publish"],run:()=>Ee.put(`/api/owner/cars/${i.carId}/readings`,{readings:G}),onRefused:P=>{if(!P.body.errors)return!1;for(let[W,O]of Object.entries(P.body.errors)){let Z=r.get(W);Z&&(Z.hidden=!1,Z.textContent=O)}return Ke(i.status(),[Object.values(P.body.errors)[0]]),!0}})}});let l=p("div",{class:"diagram-holder"},[wt(Ns({}))]);n("panels",Nn("panels","Panels and readings",[p("div",{class:"panels-layout"},[l,p("div",{class:"card"},[p("table",{"aria-label":"Panel readings",class:"readings-table"},[p("thead",{},[p("tr",{},[p("th",{scope:"col"},["Panel"]),p("th",{scope:"col"},["Microns"]),p("th",{scope:"col"},["Band"]),p("th",{scope:"col"},["Inspector"])])]),s]),o])])]),G=>{Dt(s,G.panels,P=>P.id,P=>{let W=p("p",{class:"field-error",hidden:!0});r.set(P.id,W);let O=p("td",{});if(Ks(P.id)){let Z=p("input",{type:"number",min:"1",max:"2000",step:"1","aria-label":`Microns for ${P.label}`,class:"field-input figures"});a.set(P.id,Z),O.append(Z,W)}else O.append(p("span",{},["Not gauged"]),W);return p("tr",{},[p("th",{scope:"row"},[P.label]),O,p("td",{class:"band-cell"},[p("span",{})]),p("td",{class:"figures inspector-figure inspector-cell"},[""])])},(P,W)=>{let O=a.get(W.id),Z=W.owner?.microns??null;if(O&&document.activeElement!==O){let fe=Z===null?"":String(Z);O.dataset.saved!==fe&&(O.value=fe,O.dataset.saved=fe)}else O&&(O.dataset.saved=Z===null?"":String(Z));let ie=we(P,".band-cell span");Ze(ie,W.owner?.band??""),ie.className=Vn(W.owner?.band??""),Ze(we(P,".inspector-cell"),W.inspector.map(fe=>gn(fe.microns)).join(", ")||"\u2014")})});let c=p("ul",{role:"listbox","aria-label":"Panels",tabindex:"0",class:"panel-listbox"},vt.map(G=>p("li",{role:"option","aria-selected":"false","data-panel":G.id},[G.label]))),h=p("button",{type:"button",class:"pin-button"},["Finding pin"]),u=p("div",{class:"diagram-holder"}),d=p("input",{type:"text","aria-label":"Finding title",class:"field-input"}),m=p("input",{type:"text","aria-label":"Finding wording",class:"field-input"}),v=p("select",{"aria-label":"Severity",class:"field-input"},["cosmetic","moderate","serious"].map(G=>p("option",{value:G},[G]))),_=p("select",{"aria-label":"Finding photo",class:"field-input"}),g=p("button",{type:"button",class:"pill pill-solid"},["Save finding"]),f=p("ul",{role:"list","aria-label":"Findings",class:"finding-list"}),T=p("div",{class:"preview-holder"},[i.preview.element]),E=null,x={u:.5,v:.5},U=null,A=()=>{let G=E?Qr(E,x.u,x.v):null;u.replaceChildren(wt(Ns({interactive:!0,pins:G?[{x:G.x,y:G.y,label:"Finding pin",strong:!0}]:[]})));let P=u.firstElementChild;P&&oe(P,"pointerdown",W=>{let O=W,Z=P.getBoundingClientRect(),ie=(O.clientX-Z.left)/Z.width*300,fe=(O.clientY-Z.top)/Z.height*540,Ce=vt.map(Fe=>Us(Fe.id)).find(Fe=>Fe&&ie>=Fe.x&&ie<=Fe.x+Fe.width&&fe>=Fe.y&&fe<=Fe.y+Fe.height);Ce&&(W.preventDefault(),C(Ce.id,{u:Math.round((ie-Ce.x)/Ce.width*1e3)/1e3,v:Math.round((fe-Ce.y)/Ce.height*1e3)/1e3}))}),E&&i.setPreviewPin({panelId:E,u:x.u,v:x.v})},C=(G,P={u:.5,v:.5})=>{E=G,x=P;for(let W of cn(c,'[role="option"]'))W.setAttribute("aria-selected",W.getAttribute("data-panel")===G?"true":"false");A()};A(),oe(c,"keydown",G=>{let P=G.key;if(P!=="ArrowDown"&&P!=="ArrowUp")return;G.preventDefault();let W=vt.findIndex(Z=>Z.id===E),O=P==="ArrowDown"?Math.min(vt.length-1,W+1):Math.max(0,W<=0?0:W-1);C(vt[O].id),Ke(i.status(),[`Panel ${vt[O].label}`])});for(let G of cn(c,'[role="option"]'))oe(G,"click",()=>C(G.getAttribute("data-panel")??vt[0].id));oe(h,"keydown",G=>{let P=G,O={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[P.key];if(!O||!E)return;P.preventDefault();let Z=P.shiftKey?.05:.01;x={u:Math.min(1,Math.max(0,Math.round((x.u+O[0]*Z)*1e3)/1e3)),v:Math.min(1,Math.max(0,Math.round((x.v+O[1]*Z)*1e3)/1e3))},A(),Ke(i.status(),[`Pin at ${Math.round(x.u*100)}% across, ${Math.round(x.v*100)}% down`])}),Je(g,async()=>{if(!E){await Ke(i.status(),["Choose a panel for the finding"]);return}let G={panelId:E,u:x.u,v:x.v,title:d.value,wording:m.value,severity:v.value,photoId:_.value===""?null:_.value},P=U;await i.act({pending:"Saving finding",success:"Finding saved",ownKeys:["findings","publish"],run:()=>P?Ee.patch(`/api/owner/cars/${i.carId}/findings/${P.id}`,G,{"If-Match":`"${P.revision}"`}):Ee.post(`/api/owner/cars/${i.carId}/findings`,G),onRefused:O=>O.status===412?(Ke(i.status(),[se.staleFinding]),!0):!1})&&(U=null,d.value="",m.value="",E=null,i.setPreviewPin(null),A())}),n("findings",Nn("findings","Findings",[p("div",{class:"card preview-card"},[T]),p("div",{class:"card finding-form"},[p("div",{class:"finding-grid"},[p("div",{},[p("p",{class:"field-label"},["Panel"]),c]),p("div",{},[u,h])]),p("label",{class:"field"},[p("span",{},["Finding title"]),d]),p("label",{class:"field"},[p("span",{},["Finding wording"]),m]),p("label",{class:"field"},[p("span",{},["Severity"]),v]),p("label",{class:"field"},[p("span",{},["Finding photo"]),_]),g]),f]),G=>{if(Dt(_,[{id:"",fileName:"No photo"},...G.uploads.filter(P=>P.kind==="photo")],P=>P.id||"none",P=>p("option",{value:P.id},[P.fileName]),()=>{}),G.findings.length===0){f.replaceChildren(p("li",{},[Fn(se.noFindings)]));return}Dt(f,G.findings,P=>P.id,()=>p("li",{class:"finding-row"}),(P,W)=>{let O=p("button",{type:"button",class:"pill pill-quiet"},[`Edit ${W.title}`]);oe(O,"click",()=>{U=W,C(W.panelId,{u:W.u,v:W.v}),d.value=W.title,m.value=W.wording,v.value=W.severity,_.value=W.photoId??""});let Z=p("button",{type:"button",class:"pill pill-quiet"},[`Remove ${W.title}`]);Je(Z,()=>i.act({pending:"Removing finding",success:"Finding removed",ownKeys:["findings","publish"],run:()=>Ee.delete(`/api/owner/cars/${i.carId}/findings/${W.id}`,{"If-Match":`"${W.revision}"`}),onRefused:ie=>ie.status!==412?!1:(Ke(i.status(),[se.staleFinding]),!0)}).then(()=>{})),P.replaceChildren(p("p",{class:"finding-title"},[`${W.position}. ${W.title}`]),Z0(W),p("p",{},[W.wording]),p("div",{class:"row-actions"},[O,Z]))})});let N=K0(i);n("evidence",N.node,N.paint);let w=j0(i);n("record",w.node,w.paint);let M=Q0(i);n("publish",M.node,M.paint);let R=ev(i);n("people",R.node,R.paint);let q=tv(i);n("viewings",q.node,q.paint);let B=nv(i);n("offers",B.node,B.paint);let $=iv(i);return n("alerts",$.node,$.paint),{byFragment:t,paint:G=>{for(let P of e)P(G)}}}function K0(i){let e=p("input",{type:"file",accept:"image/jpeg,image/png",hidden:!0}),t=p("input",{type:"file",accept:"image/jpeg,image/png,application/pdf",hidden:!0}),n=p("button",{type:"button",class:"pill pill-solid"},["Add photo"]),s=p("button",{type:"button",class:"pill pill-solid"},["Store photo"]),r=p("canvas",{role:"img","aria-label":"Photo preview",class:"photo-preview"}),a=p("div",{class:"preview-slot"}),o=new Map,l=p("input",{type:"checkbox","aria-label":"No plate in this photo"}),c=p("p",{class:"field-error",hidden:!0}),h=p("ul",{role:"list","aria-label":"Evidence",class:"evidence-list"}),u=p("input",{type:"text","aria-label":"Invoice label",class:"field-input"}),d=p("button",{type:"button",class:"pill pill-quiet"},["Add invoice"]),m=null,v=0,_=p("fieldset",{class:"mask-group","aria-label":"Plate mask"},[...["Mask left","Mask top","Mask width","Mask height"].map(x=>{let U=p("input",{type:"number",min:"0",max:"100",step:"0.1","aria-label":x,class:"field-input figures"});return o.set(x,U),p("label",{class:"field field-inline"},[p("span",{},[x]),U])}),p("label",{class:"field field-inline"},[p("span",{},["No plate in this photo"]),l]),c]),g=()=>{for(let x of o.values())x.value="";l.checked=!1,c.hidden=!0};oe(n,"click",()=>e.click()),oe(e,"change",()=>{let x=e.files?.[0]??null;if(!x)return;m=x,g();let U=++v;J0(x,r,a,()=>U===v)}),oe(d,"click",()=>t.click()),oe(t,"change",()=>{let x=t.files?.[0]??null;x&&i.act({pending:"Storing file",ownKeys:["evidence"],run:()=>Hh(i.carId,x,{kind:"invoice",label:u.value}),success:"File stored",onRefused:U=>(Ke(i.status(),[Vh(U)]),!0)})});let f={on:!1,startX:0,startY:0};oe(r,"pointerdown",x=>{let U=x;x.preventDefault();let A=r.getBoundingClientRect();f.on=!0,f.startX=(U.clientX-A.left)/A.width,f.startY=(U.clientY-A.top)/A.height,r.setPointerCapture(U.pointerId)});let T=x=>{if(!f.on)return;let U=x;x.preventDefault();let A=r.getBoundingClientRect(),C=Math.min(1,Math.max(0,(U.clientX-A.left)/A.width)),N=Math.min(1,Math.max(0,(U.clientY-A.top)/A.height)),w=Math.min(f.startX,C),M=Math.min(f.startY,N),R=Math.abs(C-f.startX),q=Math.abs(N-f.startY),B=($,G)=>{let P=o.get($);P&&(P.value=(G*100).toFixed(1))};B("Mask left",w),B("Mask top",M),B("Mask width",R),B("Mask height",q)};return oe(r,"pointermove",T),oe(r,"pointerup",x=>{T(x),f.on=!1}),oe(r,"touchmove",x=>x.preventDefault(),{passive:!1}),Je(s,async()=>{if(!m)return;let x=["Mask left","Mask top","Mask width","Mask height"].map(w=>Number(o.get(w)?.value??"")),A=x.every(w=>Number.isFinite(w))&&x[2]>0&&x[3]>0?{x:x[0]/100,y:x[1]/100,w:x[2]/100,h:x[3]/100}:null;if(!A&&!l.checked){c.hidden=!1,c.textContent=se.maskRequired,Ke(i.status(),[se.maskRequired]);return}c.hidden=!0;let C=m,N=await i.act({pending:"Storing file",ownKeys:["evidence"],run:()=>Hh(i.carId,C,{kind:"photo",mask:A}),onRefused:w=>{let M=Vh(w);return c.hidden=!1,c.textContent=M,Ke(i.status(),[M]),!0}});N&&(await Ke(i.status(),["File stored"]),N.locationRemoved&&await Ke(i.status(),["Location removed from the buyer copy"]),m=null,e.value="",g(),a.replaceChildren(),n.focus())}),{node:Nn("evidence","Evidence",[p("div",{class:"card"},[p("div",{class:"row-actions"},[n,e,s]),a,_]),p("div",{class:"card"},[p("label",{class:"field"},[p("span",{},["Invoice label"]),u]),p("div",{class:"row-actions"},[d,t])]),h]),paint:x=>{if(x.uploads.length===0){h.replaceChildren(p("li",{},["No files yet"]));return}Dt(h,x.uploads,U=>U.id,()=>p("li",{class:"evidence-row"}),(U,A)=>{U.replaceChildren(p("span",{},[A.label??A.fileName]),p("span",{class:"evidence-name"},[A.fileName]),p("a",{class:"text-link",href:`/api/owner/uploads/${A.id}/original`},["Download original"]))})}}}async function J0(i,e,t,n){try{let s=await createImageBitmap(i,{imageOrientation:"from-image"});if(!n())return;e.width=s.width,e.height=s.height,e.getContext("2d")?.drawImage(s,0,0),t.replaceChildren(e)}catch{n()&&t.replaceChildren()}}function Vh(i){return i.status===415?"This file type is not accepted":i.status===413?"This file is over the size limit":i.status===503?se.storageDown:i.body.errors?.file?"That file name is not allowed":i.body.message}async function Hh(i,e,t){let n=new FormData;return n.append("kind",t.kind),t.kind==="photo"&&n.append("plateMask",JSON.stringify(t.mask??null)),t.kind==="invoice"&&n.append("label",t.label??""),n.append("file",e,e.name),Ee.postForm(`/api/owner/cars/${i}/uploads`,n)}function j0(i){let e=p("button",{type:"button",class:"pill pill-solid"},["Pull test record"]),t=p("div",{role:"region","aria-label":"Odometer tape",class:"tape card"}),n=p("div",{role:"region","aria-label":"Advisories",class:"advisory-list card"}),s=p("p",{class:"advisory-tally"},["Open advisories: 0"]),r=p("div",{class:"advisory-rows"});return n.append(s,r),Je(e,()=>i.act({pending:"Pulling the test record",success:"Test record pulled",ownKeys:["record","publish"],run:()=>Ee.post(`/api/owner/cars/${i.carId}/record/pull`),onRefused:o=>{let l={record_not_found:se.recordNotFound,record_throttled:`The record service is busy. Try again in ${String(o.body.retryAfterSeconds??60)} seconds.`};if(o.body.error==="record_unreachable")return Ae(i.notice(),se.recordDown),!0;let c=l[o.body.error];return c?(Ke(i.status(),[c]),!0):!1},focusHome:()=>e.focus()}).then(()=>{e.focus()})),{node:Nn("record","Test record",[p("div",{class:"row-actions"},[e]),t,n]),paint:o=>{let l=o.record;if(Ze(s,`Open advisories: ${o.car.workingOpenAdvisories}`),!l){t.replaceChildren(p("h3",{},["Odometer tape"]),p("p",{},["Pull the test record to see the tape."])),r.replaceChildren(p("p",{},["No advisories yet"]));return}let c=l.tape.map(h=>p("div",{class:"tape-step"},[p("p",{class:"tape-date"},[oi(h.completedDate)]),p("p",{class:"tape-reading figures"},[h.odometerValue===null?"\u2014":`${Number(h.odometerValue).toLocaleString("en-GB")} ${h.odometerUnit??""}`]),p("p",{class:h.flag?"tape-flag":`tape-flag tape-result-${h.testResult.toLowerCase()}`},[h.flag?Gs[h.flag]:h.testResult])]));c.forEach((h,u)=>h.style.setProperty("--step",String(u))),t.replaceChildren(p("h3",{},["Odometer tape"]),...c),Dt(r,l.advisories,h=>h.id,h=>{let u=p("select",{"aria-label":`Response to ${h.text}`,class:"field-input"},[p("option",{value:""},["Not answered"]),...["repaired","monitoring","not_repaired"].map(_=>p("option",{value:_},[_]))]),d=p("input",{type:"text","aria-label":`Note on ${h.text}`,class:"field-input"}),m=p("button",{type:"button",class:"pill pill-quiet"},["Save response"]),v=p("p",{class:"field-error",hidden:!0});return Je(m,()=>i.act({pending:"Saving response",success:"Response saved",ownKeys:["record","publish"],run:()=>Ee.put(`/api/owner/cars/${i.carId}/advisories/${h.id}`,{stance:u.value,note:d.value}),onRefused:_=>{let g=_.body.errors?Object.values(_.body.errors)[0]:_.body.message;return v.hidden=!1,v.textContent=g,Ke(i.status(),[g]),!0}}).then(()=>{})),p("div",{class:"advisory-row"},[p("p",{class:"advisory-text"},[h.text]),p("p",{class:"advisory-flag",hidden:!0},[Gl]),p("label",{class:"field"},[p("span",{},["Response"]),u]),p("label",{class:"field"},[p("span",{},["Note"]),d]),m,v])},(h,u)=>{h.style.setProperty("--step",String(l.advisories.indexOf(u)));let d=we(h,".advisory-flag");d&&(d.hidden=!u.recurred);let m=we(h,"select"),v=we(h,"input");m&&document.activeElement!==m&&m.dataset.saved!==(u.stance??"")&&(m.dataset.touched||(m.value=u.stance??""),m.dataset.saved=u.stance??""),v&&document.activeElement!==v&&v.dataset.saved!==(u.note??"")&&(v.dataset.touched||(v.value=u.note??""),v.dataset.saved=u.note??""),m&&!m.dataset.bound&&(m.dataset.bound="yes",oe(m,"input",()=>{m.dataset.touched="yes"})),v&&!v.dataset.bound&&(v.dataset.bound="yes",oe(v,"input",()=>{v.dataset.touched="yes"}))})}}}function Q0(i){let e=p("button",{type:"button",class:"pill pill-solid"},["Publish"]),t=p("button",{type:"button",class:"pill pill-quiet"},["Withdraw listing"]),n=p("ul",{role:"list","aria-label":"Publish blockers",class:"blocker-list"}),s=p("p",{class:"blocker-clear",hidden:!0},[se.nothingBlocking]);return Je(e,()=>i.act({pending:"Rendering the report",success:a=>`Published as version ${a.version}`,ownKeys:["publish","record","findings","panels"],run:()=>Ee.post(`/api/owner/cars/${i.carId}/publish`),onRefused:a=>a.body.error==="report_render_failed"?(Ae(i.notice(),se.renderFailed),!0):a.body.error==="report_store_failed"?(Ae(i.notice(),se.storeFailed),!0):!1}).then(()=>{})),Je(t,()=>i.act({pending:"Withdrawing listing",success:"Listing withdrawn",ownKeys:["publish"],run:()=>Ee.post(`/api/owner/cars/${i.carId}/withdraw`)}).then(()=>{})),{node:Nn("publish","Publish",[p("div",{class:"card"},[p("div",{class:"blocker-row"},[n,s]),p("div",{class:"row-actions"},[e,t])])]),paint:a=>{Dt(n,a.car.publishBlockers,o=>o,()=>p("li",{}),(o,l)=>Ze(o,Hl[l]??l)),s.hidden=a.car.publishBlockers.length>0,e.hidden=!["draft","live"].includes(a.car.listingStatus),t.hidden=!["draft","live","under_offer"].includes(a.car.listingStatus)}}}function ev(i){let e=p("input",{type:"text","aria-label":"Person's name",class:"field-input"}),t=p("input",{type:"radio",name:"link-role",value:"buyer","aria-label":"Buyer",checked:!0}),n=p("input",{type:"radio",name:"link-role",value:"inspector","aria-label":"Inspector"}),s=p("button",{type:"button",class:"pill pill-solid"},["Create link"]),r=p("div",{role:"region","aria-label":"New link",class:"new-link",hidden:!0}),a=p("tbody"),o=(c,h)=>{let u=`${window.location.origin}${c}`,d=p("a",{href:u,class:"text-link new-link-address"},[u]),m=p("button",{type:"button",class:"pill pill-quiet"},["Copy link"]);Je(m,async()=>{try{await navigator.clipboard.writeText(u)}catch{}await Ke(i.status(),["Link copied"])}),r.hidden=!1,r.replaceChildren(p("p",{},[`Link ready for ${h}`]),d,m),m.focus()};return Je(s,async()=>{r.hidden=!0;let c=e.value,h=await i.act({pending:"Creating link",ownKeys:["people"],run:()=>Ee.post(`/api/owner/cars/${i.carId}/links`,{role:n.checked?"inspector":"buyer",name:c})});h&&(o(h.path??"",h.name),await Ke(i.status(),[`Link ready for ${h.name}`]))}),{node:Nn("people","People",[p("div",{class:"card"},[p("label",{class:"field"},[p("span",{},["Person's name"]),e]),p("div",{role:"radiogroup","aria-label":"Link type",class:"radio-row"},[p("label",{class:"field-inline"},[t,p("span",{},["Buyer"])]),p("label",{class:"field-inline"},[n,p("span",{},["Inspector"])])]),s,r]),p("div",{class:"card table-card"},[p("table",{"aria-label":"People",class:"people-table"},[p("thead",{},[p("tr",{},[p("th",{scope:"col"},["Person"]),p("th",{scope:"col"},["Status"]),p("th",{scope:"col"},["Progress"]),p("th",{scope:"col"},["Offer"]),p("th",{scope:"col"},["Actions"])])]),a])])]),paint:c=>{Dt(a,c.links,h=>h.id,()=>p("tr",{class:"people-row"}),(h,u)=>{let d=(m,v,_,g)=>{let f=p("button",{type:"button",class:"pill pill-quiet"},[m]);return Je(f,async()=>{r.hidden=!0;let T=await i.act({pending:"Updating link",success:_,ownKeys:["people","viewings"],run:()=>Ee.post(`/api/owner/links/${u.id}/${v}`)});T&&g&&T.path&&o(T.path,T.name)}),f};h.replaceChildren(p("th",{scope:"row"},[u.name,p("span",{class:"row-note"},[` ${u.role}`])]),p("td",{},[Vl[u.status]??u.status,p("span",{class:"figures row-note"},[u.status==="active"?` ${ai(u.secondsRemaining)}`:""])]),p("td",{class:"figures"},[`${u.seen} of ${u.total}`,p("span",{class:"row-note"},[u.lastSeenAt?` ${oi(u.lastSeenAt)}`:""])]),p("td",{},[u.offerStatus?Li[u.offerStatus]??"":"\u2014"]),p("td",{class:"row-actions"},[d("Revoke","revoke","Link revoked",!1),d("Renew","renew","Link renewed",!1),d("Replace","replace","Link replaced",!0)]))})}}}function tv(i){let e=p("input",{type:"text","aria-label":"Viewing date and time",class:"field-input",placeholder:"YYYY-MM-DDTHH:mm"}),t=p("input",{type:"number",min:"15",max:"240",step:"1","aria-label":"Viewing length in minutes",class:"field-input figures",value:"45"}),n=p("button",{type:"button",class:"pill pill-solid"},["Add viewing slot"]),s=p("p",{class:"field-error",hidden:!0}),r=p("p",{class:"field-error",hidden:!0}),a=p("ul",{role:"list","aria-label":"Owner viewing slots",class:"slot-list"});return Je(n,async()=>{s.hidden=!0,r.hidden=!0,await i.act({pending:"Adding viewing slot",success:"Viewing slot added",ownKeys:["viewings"],run:()=>Ee.post(`/api/owner/cars/${i.carId}/slots`,{localStart:e.value,durationMinutes:Number(t.value)}),onRefused:l=>l.body.errors?(l.body.errors.localStart&&(s.hidden=!1,s.textContent=l.body.errors.localStart),l.body.errors.durationMinutes&&(r.hidden=!1,r.textContent=l.body.errors.durationMinutes),Ke(i.status(),[Object.values(l.body.errors)[0]]),!0):!1})}),{node:Nn("viewings","Viewings",[p("div",{class:"card"},[p("label",{class:"field"},[p("span",{},["Viewing date and time"]),e,s]),p("label",{class:"field"},[p("span",{},["Viewing length in minutes"]),t,r]),n]),a]),paint:l=>{if(l.slots.length===0){a.replaceChildren(p("li",{},[Fn(se.noViewings)]));return}Dt(a,l.slots,c=>c.id,()=>p("li",{class:"slot-row"}),(c,h)=>{c.replaceChildren(p("span",{class:"slot-label"},[h.label]),p("span",{class:"figures"},[`${h.durationMinutes} minutes`]),p("span",{},[h.holderName?`Held by ${h.holderName}`:"Free"]))})}}}function nv(i){let e=p("tbody"),t=p("button",{type:"button",class:"pill pill-solid"},["Complete sale"]),n=p("a",{class:"text-link",href:`/api/owner/cars/${i.carId}/handover`},["Download handover record"]),s=new ri,r=null,a=null,o=null;Je(t,()=>i.act({pending:"Rendering the handover record",success:"Sale complete",ownKeys:["offers","publish"],run:()=>Ee.post(`/api/owner/cars/${i.carId}/complete`),onRefused:h=>h.status===503?(Ae(i.notice(),se.handoverFailed),t.focus(),!0):!1,focusHome:()=>t.focus()}).then(()=>{}));let l=(h,u)=>{s.reopen();let d=!1;o=h.id;let m=Mt("Dialog status"),v=p("button",{type:"button",class:"pill pill-solid"},["Confirm acceptance"]),_=p("button",{type:"button",class:"pill pill-quiet"},["Cancel"]),g=i.data().offers.filter(T=>T.id!==h.id&&["open","needs_reread"].includes(T.status)).length;a=p("p",{class:"accept-count"},[`Other open offers closed: ${g}`]);let f=new Kt({name:"Accept offer",locked:()=>v.isConnected&&v.getAttribute("aria-disabled")==="true",focusHome:()=>we(document,"#offers h2"),onClose:()=>{o=null,a=null,d||i.release()}},()=>[p("div",{class:"overlay-head"},[p("h2",{},["Accept offer"])]),p("p",{},[`Accept ${hn(h.amountPounds)} from ${h.buyerName}?`]),a,m,p("div",{class:"overlay-actions"},[v,_])]);oe(_,"click",()=>f.close()),Je(v,async()=>{Ae(m,"Accepting offer");let T=s.keyFor({offer:h.id});try{await Ee.post(`/api/owner/offers/${h.id}/accept`,{},{"Idempotency-Key":T}),d=!0,f.close(),await i.refresh(["offers","publish"]),await Ke(i.status(),["Offer accepted. Other open offers are closed."]),we(document,"#offers h2")?.focus(),i.release()}catch(E){if(E instanceof Lt||E instanceof rt&&E.status>=500){Ae(m,se.sendFailed);return}let x=E,U={offer_already_accepted:se.offerAlreadyAccepted,offer_lapsed:se.offerLapsed,offer_needs_reread:se.offerNeedsRereadRefusal,offer_not_open:se.offerNotOpen};Ae(m,U[x.body.error]??x.body.message),v.remove(),_.focus(),await i.refresh([])}}),i.hold(!0),f.show(u),r=f};return{node:Nn("offers","Offers",[p("div",{class:"card table-card"},[p("table",{"aria-label":"Offers",class:"offers-table"},[p("thead",{},[p("tr",{},[p("th",{scope:"col"},["Buyer"]),p("th",{scope:"col"},["Amount"]),p("th",{scope:"col"},["Status"]),p("th",{scope:"col"},["Progress"]),p("th",{scope:"col"},["Actions"])])]),e])]),p("div",{class:"row-actions"},[t,n])]),paint:h=>{if(t.hidden=h.car.listingStatus!=="under_offer",n.hidden=h.car.listingStatus!=="sold",h.offers.length===0){e.replaceChildren(p("tr",{},[p("td",{colspan:"5"},[Fn(se.noOffers)])]));return}if(Dt(e,h.offers,u=>u.id,()=>p("tr",{class:"offer-row"}),(u,d)=>{let m=["open","needs_reread"].includes(d.status),v=p("td",{class:"row-actions"});if(d.status==="open"){let _=p("button",{type:"button",class:"pill pill-solid"},["Accept"]);oe(_,"click",()=>l(d,_)),v.append(_)}if(m){let _=p("button",{type:"button",class:"pill pill-quiet"},["Decline"]);Je(_,()=>i.act({pending:"Declining offer",success:"Offer declined",ownKeys:["offers"],run:()=>Ee.post(`/api/owner/offers/${d.id}/decline`),onRefused:g=>{let T={offer_lapsed:se.offerLapsed,offer_not_open:se.offerNotOpen}[g.body.error];return T?(Ke(i.status(),[T]),!0):!1}}).then(()=>{})),v.append(_)}u.replaceChildren(p("th",{scope:"row"},[d.buyerName]),p("td",{class:"figures"},[hn(d.amountPounds)]),p("td",{},[Li[d.status]??d.status,p("span",{class:"figures row-note"},[m?` ${ai(d.secondsRemaining)}`:""])]),p("td",{class:"figures"},[`${d.seen} of ${d.total}`]),v)}),r&&o&&a){let u=h.offers.filter(d=>d.id!==o&&["open","needs_reread"].includes(d.status)).length;Ze(a,`Other open offers closed: ${u}`)}}}}function iv(i){let e=p("ul",{role:"list","aria-label":"Alerts",class:"alert-list"});return{node:Nn("alerts","Alerts",[e]),paint:n=>{if(n.alerts.length===0){e.replaceChildren(p("li",{},[Fn(se.noAlerts)]));return}Dt(e,n.alerts,s=>s.id,()=>p("li",{class:"alert-row",tabindex:"-1"}),(s,r)=>{let a=we(s,".retry-button");if(s.dataset.pending!=="yes"){if(r.state==="failed"){if(a){Ze(we(s,".alert-state"),Hs[r.state]);return}let o=p("button",{type:"button",class:"pill pill-solid retry-button"},["Retry"]);Je(o,async()=>{s.dataset.pending="yes",await i.act({pending:"Sending alert",success:"Alert delivered",ownKeys:["alerts"],run:()=>Ee.post(`/api/owner/alerts/${r.id}/retry`),onRefused:l=>l.status===503?(Ae(i.notice(),se.alertFailed),Ke(i.status(),[se.alertFailed]),o.focus(),!0):(Ke(i.status(),[se.alertInProgress]),o.focus(),!0),focusHome:()=>s.focus()}),delete s.dataset.pending,await i.refresh([])}),s.replaceChildren(p("span",{},[Gh(r)]),p("span",{class:"alert-state"},[Hs[r.state]]),o);return}s.replaceChildren(p("span",{},[Gh(r)]),p("span",{class:"alert-state"},[Hs[r.state]]),p("span",{class:"row-note"},[oi(r.createdAt)]))}})}}}function Gh(i){return{viewing_claim:"Viewing claim",new_offer:"New offer",offer_lapsing:"Offer about to lapse"}[i.kind]??i.kind}var sv=15e3,Cl=[{key:"panels",line:i=>`Read: ${i.standing.panelsRead} of ${i.standing.panelsGaugeable}`},{key:"findings",line:i=>`Findings: ${i.standing.findings}`},{key:"evidence",line:i=>`Files: ${i.standing.files}`},{key:"record",line:i=>`Open advisories: ${i.workingOpenAdvisories}`},{key:"publish",line:i=>`Blockers: ${i.publishBlockers.length}`},{key:"people",line:i=>`Active links: ${i.standing.activeLinks}`},{key:"viewings",line:i=>`Slots held: ${i.standing.slotsHeld} of ${i.standing.slots}`},{key:"offers",line:i=>`Live offers: ${i.standing.liveOffers}`},{key:"alerts",line:i=>`Failed alerts: ${i.standing.failedAlerts}`}];function Xh(i,e){new Rl(i,e).mount()}var Rl=class{root;data;chrome=aa("Car file");nav=p("nav",{"aria-label":"Car file sections",class:"section-nav"});sheetNav=p("nav",{"aria-label":"Car file sections",class:"section-nav"});bar=p("div",{role:"region","aria-label":"Car file bar",class:"car-file-bar"});preview;sheet=null;sheetStatus=Mt("Dialog status");announcer;readsAsked=0;readApplied=0;ownReads=0;sections=null;previewAdvisories=0;constructor(e,t){this.root=e,this.data={car:t,panels:[],medians:{steel:null,aluminium:null},findings:[],uploads:[],record:null,links:[],slots:[],offers:[],alerts:[]},this.preview=new ds({label:"Stage preview",carName:()=>this.data.car.name,preview:!0}),this.announcer=new fs(()=>this.chrome.status,Cl.map(n=>n.key))}context(){return{carId:this.data.car.id,data:()=>this.data,status:()=>this.chrome.status,notice:()=>this.chrome.notice,preview:this.preview,act:e=>this.act(e),refresh:e=>this.refresh(e),hold:e=>this.announcer.setHeld(e,this.lines()),release:()=>this.announcer.setHeld(!1,this.lines()),setPreviewPin:e=>this.drawPreview(e)}}async mount(){this.data=await this.load(),this.sections=Wh(this.context()),this.root.replaceChildren(this.build()),this.paint(),this.layout(),this.announcer.start(this.lines()),oe(window,"resize",()=>this.layout()),window.setInterval(()=>void this.poll(),sv),oe(window,"focus",()=>void this.poll()),this.openFragment()}build(){let e=this.sections,t=p("div",{class:"car-file-body"},Ws.map(n=>e?.byFragment[n.fragment]??p("section",{})));return p("div",{class:"owner-page car-file-page"},[this.chrome.bar,this.chrome.header,this.chrome.notice,p("main",{id:"main",class:"car-file-main"},[p("h1",{class:"car-file-title"},[this.data.car.name]),this.nav,t,this.chrome.status]),Xt(),this.bar])}navList(e){return p("ul",{role:"list",class:"section-list"},Ws.map(n=>{let s=p("a",{href:`#${n.fragment}`},[n.heading]);oe(s,"click",o=>{o.preventDefault(),e&&this.sheet?.close(),this.goToSection(n.fragment)});let r=p("p",{class:"standing-line","data-standing":n.fragment},[""]),a=p("li",{},[s,r]);return e&&n.fragment==="alerts"&&a.append(this.sheetRetryHolder),a}))}sheetRetryHolder=p("span",{class:"sheet-retry"});goToSection(e){window.history.replaceState(null,"",`#${e}`);let t=we(this.root,`#${e} h2`);t?.scrollIntoView({block:"start",behavior:"instant"}),t?.focus({preventScroll:!0}),this.keepClear(t)}keepClear(e){if(!e||!Bn())return;let t=e.getBoundingClientRect(),n=this.bar.getBoundingClientRect();t.bottom>n.top&&window.scrollBy({top:t.bottom-n.top+12,behavior:"instant"})}openFragment(){let e=window.location.hash.replace("#","");if(!Ws.some(n=>n.fragment===e))return;let t=we(this.root,`#${e} h2`);t?.scrollIntoView({block:"start",behavior:"instant"}),e==="panels"&&t?.focus({preventScroll:!0})}async load(){let e=this.data.car.id,[t,n,s,r,a,o,l,c]=await Promise.all([Ee.get(`/api/owner/cars/${e}`),Ee.get(`/api/owner/cars/${e}/panels`),Ee.get(`/api/owner/cars/${e}/findings`),Ee.get(`/api/owner/cars/${e}/uploads`),Ee.get(`/api/owner/cars/${e}/links`),Ee.get(`/api/owner/cars/${e}/slots`),Ee.get(`/api/owner/cars/${e}/offers`),Ee.get("/api/owner/alerts")]),h=null;try{h=await Ee.get(`/api/owner/cars/${e}/record`)}catch{h=null}return{car:t,panels:n.panels,medians:n.medians,findings:s.findings,uploads:r.uploads,record:h,links:a.links,slots:o.slots,offers:l.offers,alerts:c.alerts.filter(u=>u.carId===e)}}lines(){let e=new Map;for(let t of Cl)e.set(t.key,t.line(this.data.car));return e}async refresh(e){this.readsAsked+=1;let t=this.readsAsked;this.ownReads+=1;let n;try{n=await this.load()}finally{this.ownReads-=1}t>this.readApplied&&(this.readApplied=t,this.data=n,this.paint()),this.announcer.own(this.lines(),e)}async poll(){this.readsAsked+=1;let e=this.readsAsked,t;try{t=await this.load()}catch{return}e!==this.readsAsked||this.ownReads>0||(this.readApplied=e,this.data=t,this.paint(),this.announcer.found(this.lines()))}paint(){this.sections?.paint(this.data);for(let e of cn(document,"[data-standing]")){let t=e.getAttribute("data-standing")??"",n=Cl.find(s=>s.key===t);n&&Ze(e,n.line(this.data.car))}Ze(we(this.bar,".bar-status"),zn[this.data.car.listingStatus]??""),this.paintSheetRetry(),this.drawPreview(null)}drawPreview(e){let t=this.data.findings;if(!e&&t.length===0){this.preview.setTrack(Ri([],null)),this.preview.setOpenAdvisories(this.data.car.workingOpenAdvisories),this.preview.showEmpty(se.noFindings);return}let n=e?[{id:"pin",position:1,panelId:e.panelId,u:e.u,v:e.v,seen:!1,title:"Unsaved pin"}]:[],s=t.map(o=>({id:o.id,position:o.position,panelId:o.panelId,u:o.u,v:o.v,seen:!1,title:o.title})),r=e?n[0]:[...s].sort((o,l)=>{let c={cosmetic:0,moderate:1,serious:2},h=c[t.find(u=>u.id===l.id)?.severity??"cosmetic"]-c[t.find(u=>u.id===o.id)?.severity??"cosmetic"];return h!==0?h:o.position-l.position})[0],a=Ri(e?n:s,r?r.id:null);this.preview.setTrack(a),this.preview.setMarkers(e?[]:s),this.previewAdvisories=this.data.car.workingOpenAdvisories,this.preview.setOpenAdvisories(this.previewAdvisories),this.preview.draw({state:this.preview.stateFor(0,"still"),mode:"still",listing:this.data.car.listingStatus,dim:1})}layout(){let e=Bn();if(this.bar.hidden=!e,this.nav.hidden=e,e){if(this.nav.replaceChildren(),!we(this.bar,".bar-status")){let t=p("button",{type:"button",class:"pill pill-solid"},["Sections"]);oe(t,"click",()=>this.openSheet(t)),this.bar.replaceChildren(p("p",{class:"bar-status"},[zn[this.data.car.listingStatus]??""]),t)}}else this.sheet?.destroy(),this.sheet=null,this.nav.firstElementChild||this.nav.replaceChildren(this.navList(!1));this.paint()}openSheet(e){this.sheetStatus=Mt("Dialog status"),this.sheetNav.replaceChildren(this.navList(!0));let t=()=>this.sheet?.close();this.sheet=new Kt({name:"Car file sections",scrimCloses:!0,sheet:!0,onClose:()=>{this.announcer.setHeld(!1,this.lines());let n=this.sheetStatus.textContent??"";n.length>0&&Ae(this.chrome.status,n)}},()=>[p("div",{class:"overlay-head"},[p("h2",{},["Car file sections"]),(()=>{let n=p("button",{type:"button",class:"pill pill-quiet"},["Close"]);return oe(n,"click",t),n})()]),this.sheetNav,this.sheetStatus]),this.announcer.setHeld(!0,this.lines()),this.sheet.show(e),this.paint()}paintSheetRetry(){let e=this.data.alerts.filter(s=>s.state==="failed");if(!this.sheet||e.length===0){this.sheetRetryHolder.replaceChildren();return}let t=e[0];if(we(this.sheetRetryHolder,`[data-alert="${t.id}"]`))return;let n=p("button",{type:"button",class:"pill pill-solid sheet-retry-button","data-alert":t.id},["Retry"]);Je(n,async()=>{await Ke(this.sheetStatus,["Sending alert"]);try{await Ee.post(`/api/owner/alerts/${t.id}/retry`),await this.refresh(["alerts"]),await Ke(this.sheetStatus,["Alert delivered"]),this.data.alerts.filter(r=>r.state==="failed").length===0?we(this.sheetNav,'a[href="#alerts"]')?.focus():(this.paintSheetRetry(),we(this.sheetRetryHolder,"button")?.focus())}catch(s){let r=s instanceof rt?s.status===409?se.alertInProgress:se.alertFailed:se.alertFailed;n.focus(),this.refresh(["alerts"]),await Ke(this.sheetStatus,[r])}}),this.sheetRetryHolder.replaceChildren(n)}async act(e){let t=e.region??this.chrome.status;for(let n=0;n<2;n+=1){await Ke(t,[e.pending]);try{let s=await e.run();if(await this.refresh(e.ownKeys??[]),e.success){let r=typeof e.success=="string"?e.success:e.success(s);await Ke(t,[r])}return e.focusHome?.(),s}catch(s){if(s instanceof rt&&s.status===401&&s.body.error==="not_signed_in"&&n===0){await this.askToSignIn();continue}return s instanceof rt?e.onRefused?.(s)||await Ke(t,[s.body.message]):Ae(this.chrome.notice,se.sendFailed),null}}return null}askToSignIn(){return new Promise(e=>{let t=Mt("Dialog status"),n=p("input",{type:"password","aria-label":"Passphrase",class:"field-input"}),s=p("button",{type:"button",class:"pill pill-solid"},["Sign in"]),r=new Kt({name:"Sign in again",locked:()=>!0},()=>[p("div",{class:"overlay-head"},[p("h2",{},["Sign in again"])]),p("p",{},[se.sessionEnded]),p("label",{class:"field"},[p("span",{},["Passphrase"]),n]),t,p("div",{class:"overlay-actions"},[s])]);Je(s,async()=>{Ae(t,"Checking passphrase");try{await Ee.post("/api/owner/session",{passphrase:n.value}),r.destroy(),e()}catch{Ae(t,se.passphraseWrong)}}),oe(n,"keydown",o=>{o.key==="Enter"&&(o.preventDefault(),s.click())}),r.show(document.activeElement)})}};function rv(){let i=document.getElementById("app");if(i)return i;let e=p("div",{id:"app"});return document.body.append(e),e}function av(i){return!i||!i.startsWith("/owner/")||i.startsWith("//")||i.includes("://")||i.includes("\\")?"/owner/cars":i}async function ov(){let i=rv(),e=window.location.pathname.replace(/\/+$/,"")||"/";if(e==="/owner"){let t=new URLSearchParams(window.location.search).get("return");kh(i,av(t));return}if(e.startsWith("/owner/"))try{let t=await Ee.get("/api/owner/cars");if(e==="/owner/cars"){zh(i,t.cars);return}let n=e.slice(12),s=await Ee.get(`/api/owner/cars/${n}`);Xh(i,s);return}catch(t){if(t instanceof rt&&t.status===401){window.location.replace(`/owner?return=${encodeURIComponent(window.location.pathname)}`);return}if(t instanceof rt&&t.status===404){Un(i,se.carUnknown);return}Un(i,se.carUnknown);return}if(e.startsWith("/l/")){window.history.scrollRestoration="manual",window.location.hash&&window.history.replaceState(null,"",window.location.pathname+window.location.search),window.scrollTo({top:0,behavior:"instant"});let t=e.slice(3);try{let n=await Ee.get(`/api/link/${t}`);n.role==="inspector"?(Vs(t,n),Al(i,t,n)):Oh(i,t,n)}catch(n){if(n instanceof rt&&n.status===410){Un(i,se.linkEndedHeading,se.linkEndedBody);return}let s=n instanceof Lt?zl(t):null;if(s){Al(i,t,s);return}Un(i,se.linkUnknown)}return}window.location.replace("/owner")}ov();})();
/*! Bundled license information:

three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2024 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
