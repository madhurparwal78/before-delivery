var ht=class extends Error{constructor(t,n,s,r){super(s);this.status=t;this.code=n;this.headers=r}status;code;headers},Tt=class extends Error{},Cp="Couldn't reach the islands. Try again.";async function vs(i,e,t,n={}){let s;try{s=await fetch(e,{method:i,credentials:"same-origin",headers:t===void 0||t instanceof FormData?n:{"Content-Type":"application/json",...n},body:t===void 0?void 0:t instanceof FormData?t:JSON.stringify(t)})}catch{throw new Tt(Cp)}if(s.status===204)return;let r=await s.text(),a=r?JSON.parse(r):{};if(!s.ok)throw new ht(s.status,a.error,a.message,s.headers);return a}var at=i=>vs("GET",i),bt=(i,e={},t)=>vs("POST",i,e,t),Fn=(i,e={},t)=>vs("PUT",i,e,t),ys=i=>vs("DELETE",i);function Pi(i){if(i instanceof ht||i instanceof Tt)return i.message;throw i}var At={me:null},kh=(()=>{let i=document.getElementById("session")?.textContent??"";return i===""?null:{me:JSON.parse(i)}})();function Bh(){let i=kh;return kh=null,i&&(At.me=i.me),i}async function _s(){try{At.me=await at("/api/me")}catch(i){if(!(i instanceof ht)||i.status!==401)throw i;At.me=null}return At.me}function zh(i){return i!==null&&/^\/(?!\/)/.test(i)&&!i.includes("\\")?i:"/play"}var ca=[],kl=null,ha=null,zl,Bl=0;function pn(i,e,t){ca.push({pattern:i,signedIn:e,mount:t})}async function ua(){let i=++Bl,{pathname:e,search:t}=location;kl?.unmount(),kl=null,ha=null,zl.replaceChildren();let n=ca.find(o=>o.pattern.test(e))??ca[ca.length-1];if(!n)return;let s=Bh();if(n.signedIn&&!(s?s.me:await _s()))return history.replaceState(null,"",`/signin?next=${encodeURIComponent(e+t)}`),ua();if(!n.signedIn&&!s&&!At.me&&await _s(),i!==Bl)return;let r=(e.match(n.pattern)??[]).slice(1),a=await n.mount({path:e,query:new URLSearchParams(t),params:r,root:zl,onPop:o=>{ha=o}});i!==Bl?a.unmount():kl=a}function Jn(i,e={}){return e.replace?history.replaceState(history.state,"",i):history.pushState(null,"",i),ua()}function Hh(i){return zl=i,window.addEventListener("popstate",e=>{ha?ha(e.state):ua()}),document.addEventListener("click",e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;let t=e.target.closest("a[href]");!(t instanceof HTMLAnchorElement)||t.target||t.origin!==location.origin||(e.preventDefault(),Jn(t.pathname+t.search))}),ua()}var Rp=new Set(["value","checked","disabled","hidden","tabIndex","selected","open"]);function Gh(i,e){for(let[t,n]of Object.entries(e))n==null||n===!1||(typeof n=="function"&&t.startsWith("on")?i.addEventListener(t.slice(2),n):t==="class"?i.setAttribute("class",String(n)):t==="style"&&typeof n=="object"?Object.assign(i.style,n):Rp.has(t)?i[t]=n:i.setAttribute(t,n===!0?"":String(n)))}function Hl(i,e){for(let t of e)t==null||t===!1||(Array.isArray(t)?Hl(i,t):i.appendChild(typeof t=="object"?t:document.createTextNode(String(t))))}function y(i,e,...t){let n=document.createElement(i);return e&&Gh(n,e),Hl(n,t),n}var Pp="http://www.w3.org/2000/svg";function ut(i,e,...t){let n=document.createElementNS(Pp,i);return e&&Gh(n,e),Hl(n,t),n}function Ct(){return matchMedia("(prefers-reduced-motion: reduce)").matches}function bs(i){let e=document.createDocumentFragment();for(let t of i)e.appendChild(/[0-9]/.test(t)?y("span",{class:"digit"},t):document.createTextNode(t));return e}function jt(i,e){i.textContent!==e&&i.replaceChildren(bs(e))}var Ip=i=>1-Math.pow(1-i,3);function Ii(i,e,t=Ip){let n=performance.now(),s=0,r=!1,a=()=>{},o=new Promise(d=>{a=d}),l=()=>{r||(r=!0,cancelAnimationFrame(s),clearTimeout(u),e(1),a())},c=d=>{if(r)return;let h=(d-n)/i;if(h>=1){l();return}e(t(Math.max(0,h))),s=requestAnimationFrame(c)},u=setTimeout(l,i);return s=requestAnimationFrame(c),{cancel:()=>{r=!0,cancelAnimationFrame(s),clearTimeout(u),a()},finished:o}}function ur(i,e,t){return Ct()?(e(1),{cancel:()=>{},finished:Promise.resolve()}):Ii(i,e,t)}function Vh(i,e){let t;return{call:(...n)=>{clearTimeout(t),t=setTimeout(()=>e(...n),i)},cancel:()=>clearTimeout(t)}}var Lp=600;function Rt(i,e,t){let n=y("span",{class:"figure","data-figure":i,"aria-hidden":"true"}),s=t,r=t,a=null,o=l=>{r=l,n.replaceChildren(bs(e(l)))};return o(t),{el:n,get value(){return s},set(l,c={}){a?.cancel();let u=c.from??r;if(s=l,c.instant||Ct()||u===l){o(l);return}o(u),a=Ii(Lp,d=>o(d>=1?l:u+Math.trunc((l-u)*d)))}}}var Ss=i=>i===1?"1 frame":`${i} frames`,Wh=i=>i===1?"1 stamp":`${i} stamps`,da=i=>i===1?"1 like":`${i} likes`,Xh=i=>`${i} of 4 pages`,qh=i=>`${i} / 100`,Yh=i=>String(i);function fa(){let i=At.me;if(!i)return y("a",{href:"/signin"},"Sign in");let e=y("button",{type:"button",class:"btn","aria-haspopup":"menu","aria-expanded":"false","aria-label":`Account, ${i.player.name}`},i.player.name),t=y("span",{role:"menuitem","aria-disabled":"true",tabindex:"-1"}),n=d=>jt(t,`${Ss(d)} of film`);n(i.film);let s=y("a",{role:"menuitem",href:"/hall",tabindex:"-1"},"Your hall"),r=y("button",{type:"button",role:"menuitem",tabindex:"-1"},"Sign out"),a=y("div",{role:"menu","aria-label":"Account",class:"account-menu",hidden:!0},s,r,t),o=[s,r],l=d=>{a.hidden=!0,e.setAttribute("aria-expanded","false"),d&&e.focus()},c=()=>{a.hidden=!1,e.setAttribute("aria-expanded","true"),s.focus(),at("/api/me").then(d=>n(d.film),()=>{})};e.addEventListener("click",()=>a.hidden?c():l(!0)),r.addEventListener("click",()=>{ys("/api/session").then(()=>{At.me=null,Jn("/")})}),a.addEventListener("keydown",d=>{let h=o.indexOf(document.activeElement);d.key==="Escape"?(d.stopPropagation(),l(!0)):d.key==="ArrowDown"?(d.preventDefault(),o[(h+1)%o.length]?.focus()):d.key==="ArrowUp"?(d.preventDefault(),o[(h+o.length-1)%o.length]?.focus()):d.key==="Tab"&&l(!1)}),document.addEventListener("pointerdown",d=>{!a.hidden&&!u.contains(d.target)&&l(!1)});let u=y("div",{class:"account"},e,a);return u}function $h(){let i=ut("g",null,ut("path",{d:"M36 56 C 18 58, 10 70, 22 76 C 34 80, 44 68, 52 62 Z",fill:"#7c8f45"}),ut("ellipse",{cx:"84",cy:"56",rx:"38",ry:"16",fill:"#6b7f3a"}),ut("ellipse",{cx:"84",cy:"62",rx:"32",ry:"9",fill:"#ece2bd"}),ut("ellipse",{cx:"76",cy:"48",rx:"14",ry:"6",fill:"#93a552"}),ut("ellipse",{cx:"98",cy:"50",rx:"10",ry:"5",fill:"#8fa04a"}),ut("circle",{cx:"66",cy:"56",r:"2.6",fill:"#2f8f9a"}),ut("circle",{cx:"84",cy:"53",r:"2.2",fill:"#2f8f9a"}),ut("circle",{cx:"104",cy:"57",r:"2.6",fill:"#2f8f9a"}),ut("ellipse",{cx:"120",cy:"54",rx:"14",ry:"11",fill:"#6b7f3a"}),ut("circle",{cx:"126",cy:"50",r:"3.6",fill:"#ffffff"}),ut("circle",{cx:"127",cy:"50",r:"1.9",fill:"#0b0b0c"}),ut("rect",{x:"62",y:"66",width:"7",height:"12",rx:"3",fill:"#5a6c30"}),ut("rect",{x:"100",y:"66",width:"7",height:"12",rx:"3",fill:"#5a6c30"})),e=ut("g",null,i);return{el:ut("svg",{viewBox:"0 0 160 90",class:"wump-fallback","aria-hidden":"true",focusable:"false"},e),set(n){let s=Math.max(.35,Math.abs(Math.cos(n.spin*Math.PI/180))),r=n.zoom*.9,a=r*s*(1+n.stretch*.5),o=r*(1-n.stretch*.15);e.setAttribute("transform",`translate(80 ${70-n.hop*10}) scale(${a.toFixed(3)} ${o.toFixed(3)}) translate(-80 -70)`)}}}var Pu=0,vc=1,Iu=2;var Wn=1,Lu=2,Zs=3,Gi=0,Zt=1,Rn=2,ls=0,Js=1,Ks=2,yc=3,_c=4,Du=5;var cs=100,Nu=101,Uu=102,Fu=103,Ou=104,ku=200,Bu=201,zu=202,Hu=203,bc=204,Sc=205,Gu=206,Vu=207,Wu=208,Xu=209,qu=210,Yu=211,$u=212,Zu=213,Ju=214,Ga=0,Va=1,Wa=2,Bs=3,Xa=4,qa=5,Ya=6,$a=7,wo=0,Ku=1,ju=2,ii=0,Mc=1,wc=2,Ec=3,Tc=4,Ac=5,Cc=6,Rc=7;var Pc=300,hs=301,js=302,Eo=303,To=304,Za=1e3,jn=1001,Ja=1002,Pt=1003,Qu=1004;var Vr=1005;var Wt=1006,Ao=1007;var wi=1008;var sn=1009,Ic=1010,Lc=1011,Qs=1012,Co=1013,Tn=1014,Pn=1015,hn=1016,Ro=1017,Po=1018,us=1020,Dc=35902,Nc=35899,Uc=1021,Fc=1022,Xn=1023,vi=1026,Ei=1027,er=1028,Io=1029,Vi=1030,Lo=1031;var Do=1033,Wr=33776,Xr=33777,qr=33778,Yr=33779,No=35840,Uo=35841,Fo=35842,Oo=35843,ko=36196,Bo=37492,zo=37496,Ho=37488,Go=37489,$r=37490,Vo=37491,Wo=37808,Xo=37809,qo=37810,Yo=37811,$o=37812,Zo=37813,Jo=37814,Ko=37815,jo=37816,Qo=37817,el=37818,tl=37819,nl=37820,il=37821,sl=36492,rl=36494,al=36495,ol=36283,ll=36284,Zr=36285,cl=36286;var Sr=2300,Ka=2301,Ba=2302,cc=2303,hc=2400,uc=2401,dc=2402;var ed=3200;var hl=0,td=1,Ti="",tn="srgb",Mr="srgb-linear",wr="linear",lt="srgb";var za=7680;var nd=519,id=512,sd=513,rd=514,Oc=515,ad=516,od=517,kc=518,Bc=519,ld=35044;var zc="300 es",Cn=2e3,zs=2001;function Dp(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Np(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function Hs(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function cd(){let i=Hs("canvas");return i.style.display="block",i}var Zh={},Gs=null;function Hc(...i){let e="THREE."+i.shift();Gs?Gs("log",e,...i):console.log(e,...i)}function hd(i){let e=i[0];if(typeof e=="string"&&e.startsWith("TSL:")){let t=i[1];t&&t.isStackTrace?i[0]+=" "+t.getLocation():i[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return i}function Le(...i){i=hd(i);let e="THREE."+i.shift();if(Gs)Gs("warn",e,...i);else{let t=i[0];t&&t.isStackTrace?console.warn(t.getError(e)):console.warn(e,...i)}}function Ne(...i){i=hd(i);let e="THREE."+i.shift();if(Gs)Gs("error",e,...i);else{let t=i[0];t&&t.isStackTrace?console.error(t.getError(e)):console.error(e,...i)}}function yr(...i){let e=i.join(" ");e in Zh||(Zh[e]=!0,Le(...i))}function ud(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}var dd={[Ga]:Ga,[Wa]:Ya,[Xa]:Xa,[Bs]:qa,[Va]:Va,[Ya]:Wa,[$a]:$a,[qa]:Bs},Qn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let s=n[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,a=s.length;r<a;r++)s[r].call(this,e);e.target=null}}},Qt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Jh=1234567,_r=Math.PI/180,Vs=180/Math.PI;function tr(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Qt[i&255]+Qt[i>>8&255]+Qt[i>>16&255]+Qt[i>>24&255]+"-"+Qt[e&255]+Qt[e>>8&255]+"-"+Qt[e>>16&15|64]+Qt[e>>24&255]+"-"+Qt[t&63|128]+Qt[t>>8&255]+"-"+Qt[t>>16&255]+Qt[t>>24&255]+Qt[n&255]+Qt[n>>8&255]+Qt[n>>16&255]+Qt[n>>24&255]).toLowerCase()}function Qe(i,e,t){return Math.max(e,Math.min(t,i))}function Gc(i,e){return(i%e+e)%e}function Up(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function Fp(i,e,t){return i!==e?(t-i)/(e-i):0}function br(i,e,t){return(1-t)*i+t*e}function Op(i,e,t,n){return br(i,e,1-Math.exp(-t*n))}function kp(i,e=1){return e-Math.abs(Gc(i,e*2)-e)}function Bp(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function zp(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function Hp(i,e){return i+Math.floor(Math.random()*(e-i+1))}function Gp(i,e){return i+Math.random()*(e-i)}function Vp(i){return i*(.5-Math.random())}function Wp(i){i!==void 0&&(Jh=i);let e=Jh+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function Xp(i){return i*_r}function qp(i){return i*Vs}function Yp(i){return i>0&&Number.isInteger(i)&&2**Math.round(Math.log2(i))===i}function $p(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function Vc(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function Zp(i,e,t,n,s){let r=Math.cos,a=Math.sin,o=r(t/2),l=a(t/2),c=r((e+n)/2),u=a((e+n)/2),d=r((e-n)/2),h=a((e-n)/2),m=r((n-e)/2),g=a((n-e)/2);switch(s){case"XYX":i.set(o*u,l*d,l*h,o*c);break;case"YZY":i.set(l*h,o*u,l*d,o*c);break;case"ZXZ":i.set(l*d,l*h,o*u,o*c);break;case"XZX":i.set(o*u,l*g,l*m,o*c);break;case"YXY":i.set(l*m,o*u,l*g,o*c);break;case"ZYZ":i.set(l*g,l*m,o*u,o*c);break;default:Le("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function Wc(i){switch(i.constructor){case Uint32Array:return 4294967295;case Uint16Array:return 65535;case Uint8Array:case Uint8ClampedArray:return 255;case Int32Array:return 2147483647;case Int16Array:return 32767;case Int8Array:return 127;default:return}}function fd(i,e){if(e.constructor===Float32Array)return i;let t=Wc(e);if(t===void 0)throw new Error("THREE.MathUtils: Invalid component type.");return Math.max(i/t,-1)}function pd(i,e){if(e.constructor===Float32Array)return i;let t=Wc(e);if(t===void 0)throw new Error("THREE.MathUtils: Invalid component type.");return Math.round(i*t)}var In={DEG2RAD:_r,RAD2DEG:Vs,generateUUID:tr,clamp:Qe,euclideanModulo:Gc,mapLinear:Up,inverseLerp:Fp,lerp:br,damp:Op,pingpong:kp,smoothstep:Bp,smootherstep:zp,randInt:Hp,randFloat:Gp,randFloatSpread:Vp,seededRandom:Wp,degToRad:Xp,radToDeg:qp,isPowerOfTwo:Yp,ceilPowerOfTwo:$p,floorPowerOfTwo:Vc,setQuaternionFromProperEuler:Zp,normalize:pd,denormalize:fd},ze=class{static{this.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("THREE.Vector2: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Qe(this.x,e.x,t.x),this.y=Qe(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Qe(this.x,e,t),this.y=Qe(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Qe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Qe(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,a=this.y-e.y;return this.x=r*n-a*s+e.x,this.y=r*s+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Mn=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,a,o){let l=n[s+0],c=n[s+1],u=n[s+2],d=n[s+3],h=r[a+0],m=r[a+1],g=r[a+2],S=r[a+3];if(d!==S||l!==h||c!==m||u!==g){let f=l*h+c*m+u*g+d*S;f<0&&(h=-h,m=-m,g=-g,S=-S,f=-f);let p=1-o;if(f<.9995){let _=Math.acos(f),M=Math.sin(_);p=Math.sin(p*_)/M,o=Math.sin(o*_)/M,l=l*p+h*o,c=c*p+m*o,u=u*p+g*o,d=d*p+S*o}else{l=l*p+h*o,c=c*p+m*o,u=u*p+g*o,d=d*p+S*o;let _=1/Math.sqrt(l*l+c*c+u*u+d*d);l*=_,c*=_,u*=_,d*=_}}e[t]=l,e[t+1]=c,e[t+2]=u,e[t+3]=d}static multiplyQuaternionsFlat(e,t,n,s,r,a){let o=n[s],l=n[s+1],c=n[s+2],u=n[s+3],d=r[a],h=r[a+1],m=r[a+2],g=r[a+3];return e[t]=o*g+u*d+l*m-c*h,e[t+1]=l*g+u*h+c*d-o*m,e[t+2]=c*g+u*m+o*h-l*d,e[t+3]=u*g-o*d-l*h-c*m,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),u=o(s/2),d=o(r/2),h=l(n/2),m=l(s/2),g=l(r/2);switch(a){case"XYZ":this._x=h*u*d+c*m*g,this._y=c*m*d-h*u*g,this._z=c*u*g+h*m*d,this._w=c*u*d-h*m*g;break;case"YXZ":this._x=h*u*d+c*m*g,this._y=c*m*d-h*u*g,this._z=c*u*g-h*m*d,this._w=c*u*d+h*m*g;break;case"ZXY":this._x=h*u*d-c*m*g,this._y=c*m*d+h*u*g,this._z=c*u*g+h*m*d,this._w=c*u*d-h*m*g;break;case"ZYX":this._x=h*u*d-c*m*g,this._y=c*m*d+h*u*g,this._z=c*u*g-h*m*d,this._w=c*u*d+h*m*g;break;case"YZX":this._x=h*u*d+c*m*g,this._y=c*m*d+h*u*g,this._z=c*u*g-h*m*d,this._w=c*u*d-h*m*g;break;case"XZY":this._x=h*u*d-c*m*g,this._y=c*m*d-h*u*g,this._z=c*u*g+h*m*d,this._w=c*u*d+h*m*g;break;default:Le("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],a=t[1],o=t[5],l=t[9],c=t[2],u=t[6],d=t[10],h=n+o+d;if(h>0){let m=.5/Math.sqrt(h+1);this._w=.25/m,this._x=(u-l)*m,this._y=(r-c)*m,this._z=(a-s)*m}else if(n>o&&n>d){let m=2*Math.sqrt(1+n-o-d);this._w=(u-l)/m,this._x=.25*m,this._y=(s+a)/m,this._z=(r+c)/m}else if(o>d){let m=2*Math.sqrt(1+o-n-d);this._w=(r-c)/m,this._x=(s+a)/m,this._y=.25*m,this._z=(l+u)/m}else{let m=2*Math.sqrt(1+d-n-o);this._w=(a-s)/m,this._x=(r+c)/m,this._y=(l+u)/m,this._z=.25*m}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Qe(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=t._x,l=t._y,c=t._z,u=t._w;return this._x=n*u+a*o+s*c-r*l,this._y=s*u+a*l+r*o-n*c,this._z=r*u+a*c+n*l-s*o,this._w=a*u-n*o-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,s=e._y,r=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,s=-s,r=-r,a=-a,o=-o);let l=1-t;if(o<.9995){let c=Math.acos(o),u=Math.sin(c);l=Math.sin(l*c)/u,t=Math.sin(t*c)/u,this._x=this._x*l+n*t,this._y=this._y*l+s*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this._onChangeCallback()}else this._x=this._x*l+n*t,this._y=this._y*l+s*t,this._z=this._z*l+r*t,this._w=this._w*l+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},k=class{static{this.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("THREE.Vector3: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Kh.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Kh.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,a=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*a,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*a,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*s-o*n),u=2*(o*t-r*s),d=2*(r*n-a*t);return this.x=t+l*c+a*d-o*u,this.y=n+l*u+o*c-r*d,this.z=s+l*d+r*u-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Qe(this.x,e.x,t.x),this.y=Qe(this.y,e.y,t.y),this.z=Qe(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Qe(this.x,e,t),this.y=Qe(this.y,e,t),this.z=Qe(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Qe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,a=t.x,o=t.y,l=t.z;return this.x=s*l-r*o,this.y=r*a-n*l,this.z=n*o-s*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Gl.copy(this).projectOnVector(e),this.sub(Gl)}reflect(e){return this.sub(Gl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Qe(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Gl=new k,Kh=new Mn,Oe=class{static{this.prototype.isMatrix3=!0}constructor(e,t,n,s,r,a,o,l,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c)}set(e,t,n,s,r,a,o,l,c){let u=this.elements;return u[0]=e,u[1]=s,u[2]=o,u[3]=t,u[4]=r,u[5]=l,u[6]=n,u[7]=a,u[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],u=n[4],d=n[7],h=n[2],m=n[5],g=n[8],S=s[0],f=s[3],p=s[6],_=s[1],M=s[4],w=s[7],C=s[2],b=s[5],x=s[8];return r[0]=a*S+o*_+l*C,r[3]=a*f+o*M+l*b,r[6]=a*p+o*w+l*x,r[1]=c*S+u*_+d*C,r[4]=c*f+u*M+d*b,r[7]=c*p+u*w+d*x,r[2]=h*S+m*_+g*C,r[5]=h*f+m*M+g*b,r[8]=h*p+m*w+g*x,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],u=e[8];return t*a*u-t*o*c-n*r*u+n*o*l+s*r*c-s*a*l}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],u=e[8],d=u*a-o*c,h=o*l-u*r,m=c*r-a*l,g=t*d+n*h+s*m;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let S=1/g;return e[0]=d*S,e[1]=(s*c-u*n)*S,e[2]=(o*n-s*a)*S,e[3]=h*S,e[4]=(u*t-s*l)*S,e[5]=(s*r-o*t)*S,e[6]=m*S,e[7]=(n*l-c*t)*S,e[8]=(a*t-n*r)*S,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,a,o){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-s*c,s*l,-s*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return yr("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(Vl.makeScale(e,t)),this}rotate(e){return yr("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(Vl.makeRotation(-e)),this}translate(e,t){return yr("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(Vl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Vl=new Oe,jh=new Oe().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Qh=new Oe().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Jp(){let i={enabled:!0,workingColorSpace:Mr,spaces:{},convert:function(s,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===lt&&(s.r=xi(s.r),s.g=xi(s.g),s.b=xi(s.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===lt&&(s.r=ks(s.r),s.g=ks(s.g),s.b=ks(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===Ti?wr:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,a){return s.copy(this.spaces[a].fromXYZ).multiply(this.spaces[r].toXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Mr]:{primaries:e,whitePoint:n,transfer:wr,toXYZ:jh,fromXYZ:Qh,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:tn},outputColorSpaceConfig:{drawingBufferColorSpace:tn}},[tn]:{primaries:e,whitePoint:n,transfer:lt,toXYZ:jh,fromXYZ:Qh,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:tn}}}),i}var je=Jp();function xi(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function ks(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var Ms,ja=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Ms===void 0&&(Ms=Hs("canvas")),Ms.width=e.width,Ms.height=e.height;let s=Ms.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),n=Ms}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=Hs("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let a=0;a<r.length;a++)r[a]=xi(r[a]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(xi(t[n]/255)*255):t[n]=xi(t[n]);return{data:t,width:e.width,height:e.height}}else return Le("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},Kp=0,Ws=class{constructor(e=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:Kp++}),this.uuid=tr(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<"u"&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t!==null?e.set(t.width||0,t.height||0,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let a=0,o=s.length;a<o;a++)s[a].isDataTexture?r.push(Wl(s[a].image)):r.push(Wl(s[a]))}else r=Wl(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function Wl(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?ja.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(Le("Texture: Unable to serialize Texture."),{})}var jp=0,Xl=new k,nn=class i extends Qn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=jn,s=jn,r=Wt,a=wi,o=Xn,l=sn,c=i.DEFAULT_ANISOTROPY,u=Ti){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:jp++}),this.uuid=tr(),this.name="",this.source=new Ws(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new ze(0,0),this.repeat=new ze(1,1),this.center=new ze(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Oe,this.generateMipmaps=!0,this.mipmapsAutoUpdate=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0,this.isPMREMTexture=!1,this.normalized=!1}get width(){return this.source.getSize(Xl).x}get height(){return this.source.getSize(Xl).y}get depth(){return this.source.getSize(Xl).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.mipmapsAutoUpdate=e.mipmapsAutoUpdate,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isPMREMTexture=e.isPMREMTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){Le(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){Le(`Texture.setValues(): property '${t}' does not exist.`);continue}s&&n&&s.isVector2&&n.isVector2||s&&n&&s.isVector3&&n.isVector3||s&&n&&s.isMatrix3&&n.isMatrix3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,mipmapsAutoUpdate:this.mipmapsAutoUpdate,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Pc)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Za:e.x=e.x-Math.floor(e.x);break;case jn:e.x=e.x<0?0:1;break;case Ja:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Za:e.y=e.y-Math.floor(e.y);break;case jn:e.y=e.y<0?0:1;break;case Ja:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};nn.DEFAULT_IMAGE=null;nn.DEFAULT_MAPPING=Pc;nn.DEFAULT_ANISOTROPY=1;var pt=class{static{this.prototype.isVector4=!0}constructor(e=0,t=0,n=0,s=1){this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("THREE.Vector4: index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*s+a[12]*r,this.y=a[1]*t+a[5]*n+a[9]*s+a[13]*r,this.z=a[2]*t+a[6]*n+a[10]*s+a[14]*r,this.w=a[3]*t+a[7]*n+a[11]*s+a[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,l=e.elements,c=l[0],u=l[4],d=l[8],h=l[1],m=l[5],g=l[9],S=l[2],f=l[6],p=l[10];if(Math.abs(u-h)<.01&&Math.abs(d-S)<.01&&Math.abs(g-f)<.01){if(Math.abs(u+h)<.1&&Math.abs(d+S)<.1&&Math.abs(g+f)<.1&&Math.abs(c+m+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let M=(c+1)/2,w=(m+1)/2,C=(p+1)/2,b=(u+h)/4,x=(d+S)/4,v=(g+f)/4;return M>w&&M>C?M<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(M),s=b/n,r=x/n):w>C?w<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(w),n=b/s,r=v/s):C<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(C),n=x/r,s=v/r),this.set(n,s,r,t),this}let _=Math.sqrt((f-g)*(f-g)+(d-S)*(d-S)+(h-u)*(h-u));return Math.abs(_)<.001&&(_=1),this.x=(f-g)/_,this.y=(d-S)/_,this.z=(h-u)/_,this.w=Math.acos((c+m+p-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Qe(this.x,e.x,t.x),this.y=Qe(this.y,e.y,t.y),this.z=Qe(this.z,e.z,t.z),this.w=Qe(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Qe(this.x,e,t),this.y=Qe(this.y,e,t),this.z=Qe(this.z,e,t),this.w=Qe(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Qe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Qa=class extends Qn{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Wt,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new pt(0,0,e,t),this.scissorTest=!1,this.viewport=new pt(0,0,e,t),this.textures=[];let s=n.count;for(let r=0;r<s;r++)this.textures[r]=new nn({width:e,height:t,depth:n.depth}),this.textures[r].isRenderTargetTexture=!0,this.textures[r].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:Wt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.mipmapsAutoUpdate!==void 0&&(t.mipmapsAutoUpdate=e.mipmapsAutoUpdate),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),e!==null&&e.renderTarget===null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n,this.textures[s].isData3DTexture!==!0&&(this.textures[s].isArrayTexture=this.textures[s].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let s=Object.assign({},e.textures[t].image);this.textures[t].source=new Ws(s)}if(this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveColorBuffer=e.resolveColorBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,this.storeMultisampledColorBuffer=e.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=e.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=e.storeMultisampledStencilBuffer,e.depthTexture!==null)if(e.depthTexture.renderTarget===e){let t=e.depthTexture.clone();t.renderTarget=null,this.depthTexture=t}else this.depthTexture=e.depthTexture;else this.depthTexture=null;return this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},$t=class extends Qa{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Er=class extends nn{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Pt,this.minFilter=Pt,this.wrapR=jn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var eo=class extends nn{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Pt,this.minFilter=Pt,this.wrapR=jn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}};var Ve=class i{static{this.prototype.isMatrix4=!0}constructor(e,t,n,s,r,a,o,l,c,u,d,h,m,g,S,f){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,a,o,l,c,u,d,h,m,g,S,f)}set(e,t,n,s,r,a,o,l,c,u,d,h,m,g,S,f){let p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=s,p[1]=r,p[5]=a,p[9]=o,p[13]=l,p[2]=c,p[6]=u,p[10]=d,p[14]=h,p[3]=m,p[7]=g,p[11]=S,p[15]=f,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,s=1/ws.setFromMatrixColumn(e,0).length(),r=1/ws.setFromMatrixColumn(e,1).length(),a=1/ws.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(s),c=Math.sin(s),u=Math.cos(r),d=Math.sin(r);if(e.order==="XYZ"){let h=a*u,m=a*d,g=o*u,S=o*d;t[0]=l*u,t[4]=-l*d,t[8]=c,t[1]=m+g*c,t[5]=h-S*c,t[9]=-o*l,t[2]=S-h*c,t[6]=g+m*c,t[10]=a*l}else if(e.order==="YXZ"){let h=l*u,m=l*d,g=c*u,S=c*d;t[0]=h+S*o,t[4]=g*o-m,t[8]=a*c,t[1]=a*d,t[5]=a*u,t[9]=-o,t[2]=m*o-g,t[6]=S+h*o,t[10]=a*l}else if(e.order==="ZXY"){let h=l*u,m=l*d,g=c*u,S=c*d;t[0]=h-S*o,t[4]=-a*d,t[8]=g+m*o,t[1]=m+g*o,t[5]=a*u,t[9]=S-h*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){let h=a*u,m=a*d,g=o*u,S=o*d;t[0]=l*u,t[4]=g*c-m,t[8]=h*c+S,t[1]=l*d,t[5]=S*c+h,t[9]=m*c-g,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){let h=a*l,m=a*c,g=o*l,S=o*c;t[0]=l*u,t[4]=S-h*d,t[8]=g*d+m,t[1]=d,t[5]=a*u,t[9]=-o*u,t[2]=-c*u,t[6]=m*d+g,t[10]=h-S*d}else if(e.order==="XZY"){let h=a*l,m=a*c,g=o*l,S=o*c;t[0]=l*u,t[4]=-d,t[8]=c*u,t[1]=h*d+S,t[5]=a*u,t[9]=m*d-g,t[2]=g*d-m,t[6]=o*u,t[10]=S*d+h}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Qp,e,em)}lookAt(e,t,n){let s=this.elements;return bn.subVectors(e,t),bn.lengthSq()===0&&(bn.z=1),bn.normalize(),Li.crossVectors(n,bn),Li.lengthSq()===0&&(Math.abs(n.z)===1?bn.x+=1e-4:bn.z+=1e-4,bn.normalize(),Li.crossVectors(n,bn)),Li.normalize(),pa.crossVectors(bn,Li),s[0]=Li.x,s[4]=pa.x,s[8]=bn.x,s[1]=Li.y,s[5]=pa.y,s[9]=bn.y,s[2]=Li.z,s[6]=pa.z,s[10]=bn.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],u=n[1],d=n[5],h=n[9],m=n[13],g=n[2],S=n[6],f=n[10],p=n[14],_=n[3],M=n[7],w=n[11],C=n[15],b=s[0],x=s[4],v=s[8],A=s[12],R=s[1],L=s[5],N=s[9],B=s[13],D=s[2],W=s[6],V=s[10],Y=s[14],H=s[3],F=s[7],$=s[11],ee=s[15];return r[0]=a*b+o*R+l*D+c*H,r[4]=a*x+o*L+l*W+c*F,r[8]=a*v+o*N+l*V+c*$,r[12]=a*A+o*B+l*Y+c*ee,r[1]=u*b+d*R+h*D+m*H,r[5]=u*x+d*L+h*W+m*F,r[9]=u*v+d*N+h*V+m*$,r[13]=u*A+d*B+h*Y+m*ee,r[2]=g*b+S*R+f*D+p*H,r[6]=g*x+S*L+f*W+p*F,r[10]=g*v+S*N+f*V+p*$,r[14]=g*A+S*B+f*Y+p*ee,r[3]=_*b+M*R+w*D+C*H,r[7]=_*x+M*L+w*W+C*F,r[11]=_*v+M*N+w*V+C*$,r[15]=_*A+M*B+w*Y+C*ee,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],a=e[1],o=e[5],l=e[9],c=e[13],u=e[2],d=e[6],h=e[10],m=e[14],g=e[3],S=e[7],f=e[11],p=e[15],_=l*m-c*h,M=o*m-c*d,w=o*h-l*d,C=a*m-c*u,b=a*h-l*u,x=a*d-o*u;return t*(S*_-f*M+p*w)-n*(g*_-f*C+p*b)+s*(g*M-S*C+p*x)-r*(g*w-S*b+f*x)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[1],a=e[5],o=e[9],l=e[2],c=e[6],u=e[10];return t*(a*u-o*c)-n*(r*u-o*l)+s*(r*c-a*l)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],a=e[4],o=e[5],l=e[6],c=e[7],u=e[8],d=e[9],h=e[10],m=e[11],g=e[12],S=e[13],f=e[14],p=e[15],_=t*o-n*a,M=t*l-s*a,w=t*c-r*a,C=n*l-s*o,b=n*c-r*o,x=s*c-r*l,v=u*S-d*g,A=u*f-h*g,R=u*p-m*g,L=d*f-h*S,N=d*p-m*S,B=h*p-m*f,D=_*B-M*N+w*L+C*R-b*A+x*v;if(D===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let W=1/D;return e[0]=(o*B-l*N+c*L)*W,e[1]=(s*N-n*B-r*L)*W,e[2]=(S*x-f*b+p*C)*W,e[3]=(h*b-d*x-m*C)*W,e[4]=(l*R-a*B-c*A)*W,e[5]=(t*B-s*R+r*A)*W,e[6]=(f*w-g*x-p*M)*W,e[7]=(u*x-h*w+m*M)*W,e[8]=(a*N-o*R+c*v)*W,e[9]=(n*R-t*N-r*v)*W,e[10]=(g*b-S*w+p*_)*W,e[11]=(d*w-u*b-m*_)*W,e[12]=(o*A-a*L-l*v)*W,e[13]=(t*L-n*A+s*v)*W,e[14]=(S*M-g*C-f*_)*W,e[15]=(u*C-d*M+h*_)*W,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,a=e.x,o=e.y,l=e.z,c=r*a,u=r*o;return this.set(c*a+n,c*o-s*l,c*l+s*o,0,c*o+s*l,u*o+n,u*l-s*a,0,c*l-s*o,u*l+s*a,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,a){return this.set(1,n,r,0,e,1,a,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,a=t._y,o=t._z,l=t._w,c=r+r,u=a+a,d=o+o,h=r*c,m=r*u,g=r*d,S=a*u,f=a*d,p=o*d,_=l*c,M=l*u,w=l*d,C=n.x,b=n.y,x=n.z;return s[0]=(1-(S+p))*C,s[1]=(m+w)*C,s[2]=(g-M)*C,s[3]=0,s[4]=(m-w)*b,s[5]=(1-(h+p))*b,s[6]=(f+_)*b,s[7]=0,s[8]=(g+M)*x,s[9]=(f-_)*x,s[10]=(1-(h+S))*x,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements;e.x=s[12],e.y=s[13],e.z=s[14];let r=this.determinantAffine();if(r===0)return n.set(1,1,1),t.identity(),this;let a=ws.set(s[0],s[1],s[2]).length(),o=ws.set(s[4],s[5],s[6]).length(),l=ws.set(s[8],s[9],s[10]).length();r<0&&(a=-a),On.copy(this);let c=1/a,u=1/o,d=1/l;return On.elements[0]*=c,On.elements[1]*=c,On.elements[2]*=c,On.elements[4]*=u,On.elements[5]*=u,On.elements[6]*=u,On.elements[8]*=d,On.elements[9]*=d,On.elements[10]*=d,t.setFromRotationMatrix(On),n.x=a,n.y=o,n.z=l,this}makePerspective(e,t,n,s,r,a,o=Cn,l=!1){let c=this.elements,u=2*r/(t-e),d=2*r/(n-s),h=(t+e)/(t-e),m=(n+s)/(n-s),g,S;if(l)g=r/(a-r),S=a*r/(a-r);else if(o===Cn)g=-(a+r)/(a-r),S=-2*a*r/(a-r);else if(o===zs)g=-a/(a-r),S=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=u,c[4]=0,c[8]=h,c[12]=0,c[1]=0,c[5]=d,c[9]=m,c[13]=0,c[2]=0,c[6]=0,c[10]=g,c[14]=S,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,s,r,a,o=Cn,l=!1){let c=this.elements,u=2/(t-e),d=2/(n-s),h=-(t+e)/(t-e),m=-(n+s)/(n-s),g,S;if(l)g=1/(a-r),S=a/(a-r);else if(o===Cn)g=-2/(a-r),S=-(a+r)/(a-r);else if(o===zs)g=-1/(a-r),S=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=u,c[4]=0,c[8]=0,c[12]=h,c[1]=0,c[5]=d,c[9]=0,c[13]=m,c[2]=0,c[6]=0,c[10]=g,c[14]=S,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},ws=new k,On=new Ve,Qp=new k(0,0,0),em=new k(1,1,1),Li=new k,pa=new k,bn=new k,eu=new Ve,tu=new Mn,yi=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],a=s[4],o=s[8],l=s[1],c=s[5],u=s[9],d=s[2],h=s[6],m=s[10];switch(t){case"XYZ":this._y=Math.asin(Qe(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-u,m),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(h,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Qe(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(o,m),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,r),this._z=0);break;case"ZXY":this._x=Math.asin(Qe(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(-d,m),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Qe(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(h,m),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Qe(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,c),this._y=Math.atan2(-d,r)):(this._x=0,this._y=Math.atan2(o,m));break;case"XZY":this._z=Math.asin(-Qe(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(h,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-u,m),this._y=0);break;default:Le("Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return eu.makeRotationFromQuaternion(e),this.setFromRotationMatrix(eu,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return tu.setFromEuler(this),this.setFromQuaternion(tu,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};yi.DEFAULT_ORDER="XYZ";var Xs=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},tm=0,nu=new k,Es=new Mn,di=new Ve,ma=new k,dr=new k,nm=new k,im=new Mn,iu=new k(1,0,0),su=new k(0,1,0),ru=new k(0,0,1),au={type:"added"},sm={type:"removed"},Ts={type:"childadded",child:null},ql={type:"childremoved",child:null},Xt=class i extends Qn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:tm++}),this.uuid=tr(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new k,t=new yi,n=new Mn,s=new k(1,1,1);function r(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new Ve},normalMatrix:{value:new Oe}}),this.matrix=new Ve,this.matrixWorld=new Ve,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Xs,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale),this.pivot!==null&&this.position.copy(this.pivot).applyMatrix4(this.matrix).sub(this.pivot)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Es.setFromAxisAngle(e,t),this.quaternion.multiply(Es),this}rotateOnWorldAxis(e,t){return Es.setFromAxisAngle(e,t),this.quaternion.premultiply(Es),this}rotateX(e){return this.rotateOnAxis(iu,e)}rotateY(e){return this.rotateOnAxis(su,e)}rotateZ(e){return this.rotateOnAxis(ru,e)}translateOnAxis(e,t){return nu.copy(e).applyQuaternion(this.quaternion),this.position.add(nu.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(iu,e)}translateY(e){return this.translateOnAxis(su,e)}translateZ(e){return this.translateOnAxis(ru,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(di.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?ma.copy(e):ma.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),dr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?di.lookAt(dr,ma,this.up):di.lookAt(ma,dr,this.up),this.quaternion.setFromRotationMatrix(di),s&&(di.extractRotation(s.matrixWorld),Es.setFromRotationMatrix(di),this.quaternion.premultiply(Es.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(Ne("Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(au),Ts.child=e,this.dispatchEvent(Ts),Ts.child=null):Ne("Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(sm),ql.child=e,this.dispatchEvent(ql),ql.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),di.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),di.multiply(e.parent.matrixWorld)),e.applyMatrix4(di),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(au),Ts.child=e,this.dispatchEvent(Ts),Ts.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,a=s.length;r<a;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(dr,e,nm),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(dr,im,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}intersectsFrustum(){return!0}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,s=e.z,r=this.matrix.elements;r[12]+=t-r[0]*t-r[4]*n-r[8]*s,r[13]+=n-r[1]*t-r[5]*n-r[9]*s,r[14]+=s-r[2]*t-r[6]*n-r[10]*s}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let s=this.parent;if(e===!0&&s!==null&&s.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let r=this.children;for(let a=0,o=r.length;a<o;a++)r[a].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,s.name=this.name,s.castShadow=this.castShadow,s.receiveShadow=this.receiveShadow,s.visible=this.visible,s.frustumCulled=this.frustumCulled,s.renderOrder=this.renderOrder,s.static=this.static,s.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.pivot!==null&&(s.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(s.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(s.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(o=>({...o})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,u=l.length;c<u;c++){let d=l[c];r(e.shapes,d)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(e.materials,this.material[l]));s.material=o}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let o=0;o<this.children.length;o++)s.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];s.animations.push(r(e.animations,l))}}if(t){let o=a(e.geometries),l=a(e.materials),c=a(e.textures),u=a(e.images),d=a(e.shapes),h=a(e.skeletons),m=a(e.animations),g=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),u.length>0&&(n.images=u),d.length>0&&(n.shapes=d),h.length>0&&(n.skeletons=h),m.length>0&&(n.animations=m),g.length>0&&(n.nodes=g)}return n.object=s,n;function a(o){let l=[];for(let c in o){let u=o[c];delete u.metadata,l.push(u)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot!==null?e.pivot.clone():null,this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}};Xt.DEFAULT_UP=new k(0,1,0);Xt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Xt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var et=class extends Xt{constructor(){super(),this.isGroup=!0,this.type="Group"}},rm={type:"move"},qs=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new et,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new et,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new k,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new k),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new et,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new k,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new k,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,a=null,o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(let S of e.hand.values()){let f=t.getJointPose(S,n),p=this._getHandJoint(c,S);f!==null&&(p.matrix.fromArray(f.transform.matrix),p.matrix.decompose(p.position,p.quaternion,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=f.radius),p.visible=f!==null}let u=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],h=u.position.distanceTo(d.position),m=.02,g=.005;c.inputState.pinching&&h>m+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&h<=m-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.quaternion,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:e,target:this})));o!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(o.matrix.fromArray(s.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.matrixWorldNeedsUpdate=!0,s.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(s.linearVelocity)):o.hasLinearVelocity=!1,s.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(s.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(rm)))}return o!==null&&(o.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new et;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},md={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Di={h:0,s:0,l:0},ga={h:0,s:0,l:0};function Yl(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var me=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=tn){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,je.colorSpaceToWorking(this,t),this}setRGB(e,t,n,s=je.workingColorSpace){return this.r=e,this.g=t,this.b=n,je.colorSpaceToWorking(this,s),this}setHSL(e,t,n,s=je.workingColorSpace){if(e=Gc(e,1),t=Qe(t,0,1),n=Qe(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,a=2*n-r;this.r=Yl(a,r,e+1/3),this.g=Yl(a,r,e),this.b=Yl(a,r,e-1/3)}return je.colorSpaceToWorking(this,s),this}setStyle(e,t=tn){function n(r){r!==void 0&&parseFloat(r)<1&&Le("Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,a=s[1],o=s[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseFloat(r[1]))/100,Math.min(100,parseFloat(r[2]))/100,Math.min(100,parseFloat(r[3]))/100,t);break;case"hsl":case"hsla":if(r=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:Le("Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(r,16),t);Le("Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=tn){let n=md[e.toLowerCase()];return n!==void 0?this.setHex(n,t):Le("Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=xi(e.r),this.g=xi(e.g),this.b=xi(e.b),this}copyLinearToSRGB(e){return this.r=ks(e.r),this.g=ks(e.g),this.b=ks(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=tn){return je.workingToColorSpace(en.copy(this),e),Math.round(Qe(en.r*255,0,255))*65536+Math.round(Qe(en.g*255,0,255))*256+Math.round(Qe(en.b*255,0,255))}getHexString(e=tn){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=je.workingColorSpace){je.workingToColorSpace(en.copy(this),t);let n=en.r,s=en.g,r=en.b,a=Math.max(n,s,r),o=Math.min(n,s,r),l,c,u=(o+a)/2;if(o===a)l=0,c=0;else{let d=a-o;switch(c=u<=.5?d/(a+o):d/(2-a-o),a){case n:l=(s-r)/d+(s<r?6:0);break;case s:l=(r-n)/d+2;break;case r:l=(n-s)/d+4;break}l/=6}return e.h=l,e.s=c,e.l=u,e}getRGB(e,t=je.workingColorSpace){return je.workingToColorSpace(en.copy(this),t),e.r=en.r,e.g=en.g,e.b=en.b,e}getStyle(e=tn){je.workingToColorSpace(en.copy(this),e);let t=en.r,n=en.g,s=en.b;return e!==tn?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Di),this.setHSL(Di.h+e,Di.s+t,Di.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Di),e.getHSL(ga);let n=br(Di.h,ga.h,t),s=br(Di.s,ga.s,t),r=br(Di.l,ga.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},en=new me;me.NAMES=md;var Tr=class i{constructor(e,t=25e-5){this.isFogExp2=!0,this.name="",this.color=new me(e),this.density=t}clone(){return new i(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}};var Hn=class extends Xt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new yi,this.environmentIntensity=1,this.environmentRotation=new yi,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),this.background=e.background!==null?e.background.clone():null,this.environment=e.environment!==null?e.environment.clone():null,this.fog=e.fog!==null?e.fog.clone():null,this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),this.overrideMaterial=e.overrideMaterial!==null?e.overrideMaterial.clone():null,this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),t.object.backgroundBlurriness=this.backgroundBlurriness,t.object.backgroundIntensity=this.backgroundIntensity,t.object.backgroundRotation=this.backgroundRotation.toArray(),t.object.environmentIntensity=this.environmentIntensity,t.object.environmentRotation=this.environmentRotation.toArray(),t}},kn=new k,fi=new k,$l=new k,pi=new k,As=new k,Cs=new k,ou=new k,Zl=new k,Jl=new k,Kl=new k,jl=new pt,Ql=new pt,ec=new pt,Oi=class i{constructor(e=new k,t=new k,n=new k){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),kn.subVectors(e,t),s.cross(kn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){kn.subVectors(s,t),fi.subVectors(n,t),$l.subVectors(e,t);let a=kn.dot(kn),o=kn.dot(fi),l=kn.dot($l),c=fi.dot(fi),u=fi.dot($l),d=a*c-o*o;if(d===0)return r.set(0,0,0),null;let h=1/d,m=(c*l-o*u)*h,g=(a*u-o*l)*h;return r.set(1-m-g,g,m)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,pi)===null?!1:pi.x>=0&&pi.y>=0&&pi.x+pi.y<=1}static getInterpolation(e,t,n,s,r,a,o,l){return this.getBarycoord(e,t,n,s,pi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,pi.x),l.addScaledVector(a,pi.y),l.addScaledVector(o,pi.z),l)}static getInterpolatedAttribute(e,t,n,s,r,a){return jl.setScalar(0),Ql.setScalar(0),ec.setScalar(0),jl.fromBufferAttribute(e,t),Ql.fromBufferAttribute(e,n),ec.fromBufferAttribute(e,s),a.setScalar(0),a.addScaledVector(jl,r.x),a.addScaledVector(Ql,r.y),a.addScaledVector(ec,r.z),a}static isFrontFacing(e,t,n,s){return kn.subVectors(n,t),fi.subVectors(e,t),kn.cross(fi).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return kn.subVectors(this.c,this.b),fi.subVectors(this.a,this.b),kn.cross(fi).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,a,o;As.subVectors(s,n),Cs.subVectors(r,n),Zl.subVectors(e,n);let l=As.dot(Zl),c=Cs.dot(Zl);if(l<=0&&c<=0)return t.copy(n);Jl.subVectors(e,s);let u=As.dot(Jl),d=Cs.dot(Jl);if(u>=0&&d<=u)return t.copy(s);let h=l*d-u*c;if(h<=0&&l>=0&&u<=0&&l-u>0)return a=l/(l-u),t.copy(n).addScaledVector(As,a);Kl.subVectors(e,r);let m=As.dot(Kl),g=Cs.dot(Kl);if(g>=0&&m<=g)return t.copy(r);let S=m*c-l*g;if(S<=0&&c>=0&&g<=0)return o=c/(c-g),t.copy(n).addScaledVector(Cs,o);let f=u*g-m*d;if(f<=0&&d-u>=0&&m-g>=0)return ou.subVectors(r,s),o=(d-u)/(d-u+(m-g)),t.copy(s).addScaledVector(ou,o);let p=1/(f+S+h);return a=S*p,o=h*p,t.copy(n).addScaledVector(As,a).addScaledVector(Cs,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},ei=class{constructor(e=new k(1/0,1/0,1/0),t=new k(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Bn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Bn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=Bn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0&&e.isBatchedMesh!==!0)for(let a=0,o=r.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,Bn):Bn.fromBufferAttribute(r,a),Bn.applyMatrix4(e.matrixWorld),this.expandByPoint(Bn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),xa.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),xa.copy(n.boundingBox)),xa.applyMatrix4(e.matrixWorld),this.union(xa)}let s=e.children;for(let r=0,a=s.length;r<a;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,Bn),Bn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(fr),va.subVectors(this.max,fr),Rs.subVectors(e.a,fr),Ps.subVectors(e.b,fr),Is.subVectors(e.c,fr),Ni.subVectors(Ps,Rs),Ui.subVectors(Is,Ps),ji.subVectors(Rs,Is);let t=[0,-Ni.z,Ni.y,0,-Ui.z,Ui.y,0,-ji.z,ji.y,Ni.z,0,-Ni.x,Ui.z,0,-Ui.x,ji.z,0,-ji.x,-Ni.y,Ni.x,0,-Ui.y,Ui.x,0,-ji.y,ji.x,0];return!tc(t,Rs,Ps,Is,va)||(t=[1,0,0,0,1,0,0,0,1],!tc(t,Rs,Ps,Is,va))?!1:(ya.crossVectors(Ni,Ui),t=[ya.x,ya.y,ya.z],tc(t,Rs,Ps,Is,va))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Bn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Bn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(mi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),mi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),mi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),mi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),mi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),mi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),mi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),mi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(mi),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},mi=[new k,new k,new k,new k,new k,new k,new k,new k],Bn=new k,xa=new ei,Rs=new k,Ps=new k,Is=new k,Ni=new k,Ui=new k,ji=new k,fr=new k,va=new k,ya=new k,Qi=new k;function tc(i,e,t,n,s){for(let r=0,a=i.length-3;r<=a;r+=3){Qi.fromArray(i,r);let o=s.x*Math.abs(Qi.x)+s.y*Math.abs(Qi.y)+s.z*Math.abs(Qi.z),l=e.dot(Qi),c=t.dot(Qi),u=n.dot(Qi);if(Math.max(-Math.max(l,c,u),Math.min(l,c,u))>o)return!1}return!0}var Ut=new k,_a=new ze,am=0,zn=class extends Qn{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:am++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=ld,this.updateRanges=[],this.gpuType=Pn,this.version=0,this._normalizationScale=e!==void 0?Wc(e):void 0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this._normalizationScale=e._normalizationScale,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)_a.fromBufferAttribute(this,t),_a.applyMatrix3(e),this.setXY(t,_a.x,_a.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Ut.fromBufferAttribute(this,t),Ut.applyMatrix3(e),this.setXYZ(t,Ut.x,Ut.y,Ut.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Ut.fromBufferAttribute(this,t),Ut.applyMatrix4(e),this.setXYZ(t,Ut.x,Ut.y,Ut.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Ut.fromBufferAttribute(this,t),Ut.applyNormalMatrix(e),this.setXYZ(t,Ut.x,Ut.y,Ut.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Ut.fromBufferAttribute(this,t),Ut.transformDirection(e),this.setXYZ(t,Ut.x,Ut.y,Ut.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=this._denormalize(n)),n}setComponent(e,t,n){return this.normalized&&(n=this._normalize(n)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=this._denormalize(t)),t}setX(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=this._denormalize(t)),t}setY(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=this._denormalize(t)),t}setZ(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=this._denormalize(t)),t}setW(e,t){return this.normalized&&(t=this._normalize(t)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=this._normalize(t),n=this._normalize(n)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=this._normalize(t),n=this._normalize(n),s=this._normalize(s)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=this._normalize(t),n=this._normalize(n),s=this._normalize(s),r=this._normalize(r)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return e.name=this.name,e.usage=this.usage,e.gpuType=this.gpuType,e}dispose(){this.dispatchEvent({type:"dispose"})}_denormalize(e){let t=this._normalizationScale;return t!==void 0?Math.max(e/t,-1):fd(e,this.array)}_normalize(e){let t=this._normalizationScale;return t!==void 0?Math.round(e*t):pd(e,this.array)}};var Ar=class extends zn{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var Cr=class extends zn{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var Be=class extends zn{constructor(e,t,n){super(new Float32Array(e),t,n)}},om=new ei,pr=new k,nc=new k,ti=class{constructor(e=new k,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):om.setFromPoints(e).getCenter(n);let s=0;for(let r=0,a=e.length;r<a;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;pr.subVectors(e,this.center);let t=pr.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(pr,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(nc.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(pr.copy(e.center).add(nc)),this.expandByPoint(pr.copy(e.center).sub(nc))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},lm=0,An=new Ve,ic=new Xt,Ls=new k,Sn=new ei,mr=new ei,Vt=new k,St=class i extends Qn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:lm++}),this.uuid=tr(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Dp(e)?Cr:Ar)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new Oe().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return An.makeRotationFromQuaternion(e),this.applyMatrix4(An),this}rotateX(e){return An.makeRotationX(e),this.applyMatrix4(An),this}rotateY(e){return An.makeRotationY(e),this.applyMatrix4(An),this}rotateZ(e){return An.makeRotationZ(e),this.applyMatrix4(An),this}translate(e,t,n){return An.makeTranslation(e,t,n),this.applyMatrix4(An),this}scale(e,t,n){return An.makeScale(e,t,n),this.applyMatrix4(An),this}lookAt(e){return ic.lookAt(e),ic.updateMatrix(),this.applyMatrix4(ic.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ls).negate(),this.translate(Ls.x,Ls.y,Ls.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let a=e[s];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new Be(n,3))}else{let n=Math.min(e.length,t.count);for(let s=0;s<n;s++){let r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&Le("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ei);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Ne("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new k(-1/0,-1/0,-1/0),new k(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];Sn.setFromBufferAttribute(r),this.morphTargetsRelative?(Vt.addVectors(this.boundingBox.min,Sn.min),this.boundingBox.expandByPoint(Vt),Vt.addVectors(this.boundingBox.max,Sn.max),this.boundingBox.expandByPoint(Vt)):(this.boundingBox.expandByPoint(Sn.min),this.boundingBox.expandByPoint(Sn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Ne('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ti);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){Ne("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new k,1/0);return}if(e){let n=this.boundingSphere.center;if(Sn.setFromBufferAttribute(e),t)for(let r=0,a=t.length;r<a;r++){let o=t[r];mr.setFromBufferAttribute(o),this.morphTargetsRelative?(Vt.addVectors(Sn.min,mr.min),Sn.expandByPoint(Vt),Vt.addVectors(Sn.max,mr.max),Sn.expandByPoint(Vt)):(Sn.expandByPoint(mr.min),Sn.expandByPoint(mr.max))}Sn.getCenter(n);let s=0;for(let r=0,a=e.count;r<a;r++)Vt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(Vt));if(t)for(let r=0,a=t.length;r<a;r++){let o=t[r],l=this.morphTargetsRelative;for(let c=0,u=o.count;c<u;c++)Vt.fromBufferAttribute(o,c),l&&(Ls.fromBufferAttribute(e,c),Vt.add(Ls)),s=Math.max(s,n.distanceToSquared(Vt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&Ne('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){Ne("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv,a=this.getAttribute("tangent");(a===void 0||a.count!==n.count)&&(a=new zn(new Float32Array(4*n.count),4),this.setAttribute("tangent",a));let o=[],l=[],c=new Uint8Array(n.count);for(let A=0;A<n.count;A++)o[A]=new k,l[A]=new k;let u=new k,d=new k,h=new k,m=new ze,g=new ze,S=new ze,f=new k,p=new k;function _(A,R,L){c[A]=c[R]=c[L]=1,u.fromBufferAttribute(n,A),d.fromBufferAttribute(n,R),h.fromBufferAttribute(n,L),m.fromBufferAttribute(r,A),g.fromBufferAttribute(r,R),S.fromBufferAttribute(r,L),d.sub(u),h.sub(u),g.sub(m),S.sub(m);let N=1/(g.x*S.y-S.x*g.y);isFinite(N)&&(f.copy(d).multiplyScalar(S.y).addScaledVector(h,-g.y).multiplyScalar(N),p.copy(h).multiplyScalar(g.x).addScaledVector(d,-S.x).multiplyScalar(N),o[A].add(f),o[R].add(f),o[L].add(f),l[A].add(p),l[R].add(p),l[L].add(p))}let M=this.groups;M.length===0&&(M=[{start:0,count:e.count}]);for(let A=0,R=M.length;A<R;++A){let L=M[A],N=L.start,B=L.count;for(let D=N,W=N+B;D<W;D+=3)_(e.getX(D+0),e.getX(D+1),e.getX(D+2))}let w=new k,C=new k,b=new k,x=new k;function v(A){b.fromBufferAttribute(s,A),x.copy(b);let R=o[A];w.copy(R),w.sub(b.multiplyScalar(b.dot(R))).normalize(),C.crossVectors(x,R);let N=C.dot(l[A])<0?-1:1;a.setXYZW(A,w.x,w.y,w.z,N)}for(let A=0,R=n.count;A<R;++A)c[A]&&v(A);this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0||n.count!==t.count)n=new zn(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let h=0,m=n.count;h<m;h++)n.setXYZ(h,0,0,0);let s=new k,r=new k,a=new k,o=new k,l=new k,c=new k,u=new k,d=new k;if(e)for(let h=0,m=e.count;h<m;h+=3){let g=e.getX(h+0),S=e.getX(h+1),f=e.getX(h+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,S),a.fromBufferAttribute(t,f),u.subVectors(a,r),d.subVectors(s,r),u.cross(d),o.fromBufferAttribute(n,g),l.fromBufferAttribute(n,S),c.fromBufferAttribute(n,f),o.add(u),l.add(u),c.add(u),n.setXYZ(g,o.x,o.y,o.z),n.setXYZ(S,l.x,l.y,l.z),n.setXYZ(f,c.x,c.y,c.z)}else for(let h=0,m=t.count;h<m;h+=3)s.fromBufferAttribute(t,h+0),r.fromBufferAttribute(t,h+1),a.fromBufferAttribute(t,h+2),u.subVectors(a,r),d.subVectors(s,r),u.cross(d),n.setXYZ(h+0,u.x,u.y,u.z),n.setXYZ(h+1,u.x,u.y,u.z),n.setXYZ(h+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Vt.fromBufferAttribute(e,t),Vt.normalize(),e.setXYZ(t,Vt.x,Vt.y,Vt.z)}toNonIndexed(){function e(o,l){let c=o.array,u=o.itemSize,d=o.normalized,h=new c.constructor(l.length*u),m=0,g=0;for(let S=0,f=l.length;S<f;S++){o.isInterleavedBufferAttribute?m=l[S]*o.data.stride+o.offset:m=l[S]*u;for(let p=0;p<u;p++)h[g++]=c[m++]}return new zn(h,u,d)}if(this.index===null)return Le("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let o in s){let l=s[o],c=e(l,n);t.setAttribute(o,c)}let r=this.morphAttributes;for(let o in r){let l=[],c=r[o];for(let u=0,d=c.length;u<d;u++){let h=c[u],m=e(h,n);l.push(m)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;let a=this.groups;for(let o=0,l=a.length;o<l;o++){let c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,e.name=this.name,Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let l in n){let c=n[l];e.data.attributes[l]=c.toJSON(e.data)}let s={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],u=[];for(let d=0,h=c.length;d<h;d++){let m=c[d];u.push(m.toJSON(e.data))}u.length>0&&(s[l]=u,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let s=e.attributes;for(let c in s){let u=s[c];this.setAttribute(c,u.clone(t))}let r=e.morphAttributes;for(let c in r){let u=[],d=r[c];for(let h=0,m=d.length;h<m;h++)u.push(d[h].clone(t));this.morphAttributes[c]=u}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let c=0,u=a.length;c<u;c++){let d=a[c];this.addGroup(d.start,d.count,d.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}};var sc=new k,cm=new k,hm=new Oe,cn=class{constructor(e=new k(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=sc.subVectors(n,t).cross(cm.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let s=e.delta(sc),r=this.normal.dot(s);if(r===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/r;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(s,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||hm.getNormalMatrix(e),s=this.coplanarPoint(sc).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},um=0,ni=class extends Qn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:um++}),this.uuid=tr(),this.name="",this.type="Material",this.blending=Js,this.side=Gi,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=bc,this.blendDst=Sc,this.blendEquation=cs,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new me(0,0,0),this.blendAlpha=0,this.depthFunc=Bs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=nd,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=za,this.stencilZFail=za,this.stencilZPass=za,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){Le(`Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){Le(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector2&&n&&n.isVector2||s&&s.isEuler&&n&&n.isEuler||s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.diffuseRoughness!==void 0&&(n.diffuseRoughness=this.diffuseRoughness),this.diffuseRoughnessMap&&this.diffuseRoughnessMap.isTexture&&(n.diffuseRoughnessMap=this.diffuseRoughnessMap.toJSON(e).uuid),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessMinimum!==void 0&&(n.iridescenceThicknessMinimum=this.iridescenceThicknessMinimum),this.iridescenceThicknessMaximum!==void 0&&(n.iridescenceThicknessMaximum=this.iridescenceThicknessMaximum),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(r=>r.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let a=[];for(let o in r){let l=r[o];delete l.metadata,a.push(l)}return a}if(t){let r=s(e.textures),a=s(e.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new me().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.diffuseRoughness!==void 0&&(this.diffuseRoughness=e.diffuseRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.retroreflectivity!==void 0&&(this.retroreflectivity=e.retroreflectivity),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessMinimum!==void 0&&(this.iridescenceThicknessMinimum=e.iridescenceThicknessMinimum),e.iridescenceThicknessMaximum!==void 0&&(this.iridescenceThicknessMaximum=e.iridescenceThicknessMaximum),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessMinimum=e.iridescenceThicknessRange[0],this.iridescenceThicknessMaximum=e.iridescenceThicknessRange[1]),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.clippingPlanes!==void 0&&(this.clippingPlanes=e.clippingPlanes.map(n=>new cn().fromJSON(n))),e.clipIntersection!==void 0&&(this.clipIntersection=e.clipIntersection),e.clipShadows!==void 0&&(this.clipShadows=e.clipShadows),e.depthPacking!==void 0&&(this.depthPacking=e.depthPacking),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.linecap!==void 0&&(this.linecap=e.linecap),e.linejoin!==void 0&&(this.linejoin=e.linejoin),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(typeof e.vertexColors=="number"?this.vertexColors=e.vertexColors>0:this.vertexColors=e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let n=e.normalScale;Array.isArray(n)===!1&&(n=[n,n]),this.normalScale=new ze().fromArray(n)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new ze().fromArray(e.clearcoatNormalScale)),e.diffuseRoughnessMap!==void 0&&(this.diffuseRoughnessMap=t[e.diffuseRoughnessMap]||null),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}};var gi=new k,rc=new k,ba=new k,Sa=new k,ns=class{constructor(e=new k,t=new k(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,gi)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=gi.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(gi.copy(this.origin).addScaledVector(this.direction,t),gi.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){rc.copy(e).add(t).multiplyScalar(.5),ba.copy(t).sub(e).normalize(),Sa.copy(this.origin).sub(rc);let r=e.distanceTo(t)*.5,a=-this.direction.dot(ba),o=Sa.dot(this.direction),l=-Sa.dot(ba),c=Sa.lengthSq(),u=Math.abs(1-a*a),d,h,m,g;if(u>0)if(d=a*l-o,h=a*o-l,g=r*u,d>=0)if(h>=-g)if(h<=g){let S=1/u;d*=S,h*=S,m=d*(d+a*h+2*o)+h*(a*d+h+2*l)+c}else h=r,d=Math.max(0,-(a*h+o)),m=-d*d+h*(h+2*l)+c;else h=-r,d=Math.max(0,-(a*h+o)),m=-d*d+h*(h+2*l)+c;else h<=-g?(d=Math.max(0,-(-a*r+o)),h=d>0?-r:Math.min(Math.max(-r,-l),r),m=-d*d+h*(h+2*l)+c):h<=g?(d=0,h=Math.min(Math.max(-r,-l),r),m=h*(h+2*l)+c):(d=Math.max(0,-(a*r+o)),h=d>0?r:Math.min(Math.max(-r,-l),r),m=-d*d+h*(h+2*l)+c);else h=a>0?-r:r,d=Math.max(0,-(a*h+o)),m=-d*d+h*(h+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,d),s&&s.copy(rc).addScaledVector(ba,h),m}intersectSphere(e,t){if(e.radius<0)return null;gi.subVectors(e.center,this.origin);let n=gi.dot(this.direction),s=gi.dot(gi)-n*n,r=e.radius*e.radius;if(s>r)return null;let a=Math.sqrt(r-s),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,a,o,l,c=1/this.direction.x,u=1/this.direction.y,d=1/this.direction.z,h=this.origin;return c>=0?(n=(e.min.x-h.x)*c,s=(e.max.x-h.x)*c):(n=(e.max.x-h.x)*c,s=(e.min.x-h.x)*c),u>=0?(r=(e.min.y-h.y)*u,a=(e.max.y-h.y)*u):(r=(e.max.y-h.y)*u,a=(e.min.y-h.y)*u),n>a||r>s||((r>n||isNaN(n))&&(n=r),(a<s||isNaN(s))&&(s=a),d>=0?(o=(e.min.z-h.z)*d,l=(e.max.z-h.z)*d):(o=(e.max.z-h.z)*d,l=(e.min.z-h.z)*d),n>l||o>s)||((o>n||n!==n)&&(n=o),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,gi)!==null}intersectTriangle(e,t,n,s,r){let a=this.origin,o=this.direction,l=o.x,c=o.y,u=o.z,d=e.x-a.x,h=e.y-a.y,m=e.z-a.z,g=t.x-a.x,S=t.y-a.y,f=t.z-a.z,p=n.x-a.x,_=n.y-a.y,M=n.z-a.z,w=Math.abs(l),C=Math.abs(c),b=Math.abs(u),x,v,A,R,L,N,B,D,W,V,Y,H;if(w>=C&&w>=b?(A=l,N=d,W=g,H=p,l>=0?(x=c,v=u,R=h,L=m,B=S,D=f,V=_,Y=M):(x=u,v=c,R=m,L=h,B=f,D=S,V=M,Y=_)):C>=b?(A=c,N=h,W=S,H=_,c>=0?(x=u,v=l,R=m,L=d,B=f,D=g,V=M,Y=p):(x=l,v=u,R=d,L=m,B=g,D=f,V=p,Y=M)):(A=u,N=m,W=f,H=M,u>=0?(x=l,v=c,R=d,L=h,B=g,D=S,V=p,Y=_):(x=c,v=l,R=h,L=d,B=S,D=g,V=_,Y=p)),A===0)return null;let F=x/A,$=v/A,ee=1/A,ae=R-F*N,ge=L-$*N,J=B-F*W,xe=D-$*W,be=V-F*H,Ae=Y-$*H,pe=be*xe-Ae*J,Ue=ae*Ae-ge*be,dt=J*ge-xe*ae;if(s){if(pe<0||Ue<0||dt<0)return null}else if((pe<0||Ue<0||dt<0)&&(pe>0||Ue>0||dt>0))return null;let Te=pe+Ue+dt;if(Te===0)return null;let st=ee*(pe*N+Ue*W+dt*H);return(Te>0?st<0:st>0)?null:this.at(st/Te,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},_i=class extends ni{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new me(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new yi,this.combine=wo,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},lu=new Ve,es=new ns,Ma=new ti,cu=new k,wa=new k,Ea=new k,Ta=new k,ac=new k,Aa=new k,hu=new k,Ca=new k,He=class extends Xt{constructor(e=new St,t=new _i){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0?this.morphTargetInfluences=e.morphTargetInfluences.slice():this.morphTargetInfluences=void 0,e.morphTargetDictionary!==void 0?this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary):this.morphTargetDictionary=void 0,this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let o=this.morphTargetInfluences;if(r&&o){Aa.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let u=o[l],d=r[l];u!==0&&(ac.fromBufferAttribute(d,e),a?Aa.addScaledVector(ac,u):Aa.addScaledVector(ac.sub(t),u))}t.add(Aa)}return t}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Ma.copy(n.boundingSphere),Ma.applyMatrix4(r),es.copy(e.ray).recast(e.near),!(Ma.containsPoint(es.origin)===!1&&(es.intersectSphere(Ma,cu)===null||es.origin.distanceToSquared(cu)>(e.far-e.near)**2))&&(lu.copy(r).invert(),es.copy(e.ray).applyMatrix4(lu),!(n.boundingBox!==null&&es.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,es)))}_computeIntersections(e,t,n){let s,r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,u=r.attributes.uv1,d=r.attributes.normal,h=r.groups,m=r.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,S=h.length;g<S;g++){let f=h[g],p=a[f.materialIndex],_=Math.max(f.start,m.start),M=Math.min(o.count,Math.min(f.start+f.count,m.start+m.count));for(let w=_,C=M;w<C;w+=3){let b=o.getX(w),x=o.getX(w+1),v=o.getX(w+2);s=Ra(this,p,e,n,c,u,d,b,x,v),s&&(s.faceIndex=Math.floor(w/3),s.face.materialIndex=f.materialIndex,t.push(s))}}else{let g=Math.max(0,m.start),S=Math.min(o.count,m.start+m.count);for(let f=g,p=S;f<p;f+=3){let _=o.getX(f),M=o.getX(f+1),w=o.getX(f+2);s=Ra(this,a,e,n,c,u,d,_,M,w),s&&(s.faceIndex=Math.floor(f/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(a))for(let g=0,S=h.length;g<S;g++){let f=h[g],p=a[f.materialIndex],_=Math.max(f.start,m.start),M=Math.min(l.count,Math.min(f.start+f.count,m.start+m.count));for(let w=_,C=M;w<C;w+=3){let b=w,x=w+1,v=w+2;s=Ra(this,p,e,n,c,u,d,b,x,v),s&&(s.faceIndex=Math.floor(w/3),s.face.materialIndex=f.materialIndex,t.push(s))}}else{let g=Math.max(0,m.start),S=Math.min(l.count,m.start+m.count);for(let f=g,p=S;f<p;f+=3){let _=f,M=f+1,w=f+2;s=Ra(this,a,e,n,c,u,d,_,M,w),s&&(s.faceIndex=Math.floor(f/3),t.push(s))}}}};function dm(i,e,t,n,s,r,a,o){let l;if(e.side===Zt?l=n.intersectTriangle(a,r,s,!0,o):l=n.intersectTriangle(s,r,a,e.side===Gi,o),l===null)return null;Ca.copy(o),Ca.applyMatrix4(i.matrixWorld);let c=t.ray.origin.distanceTo(Ca);return c<t.near||c>t.far?null:{distance:c,point:Ca.clone(),object:i}}function Ra(i,e,t,n,s,r,a,o,l,c){i.getVertexPosition(o,wa),i.getVertexPosition(l,Ea),i.getVertexPosition(c,Ta);let u=dm(i,e,t,n,wa,Ea,Ta,hu);if(u){let d=new k;Oi.getBarycoord(hu,wa,Ea,Ta,d),s&&(u.uv=Oi.getInterpolatedAttribute(s,o,l,c,d,new ze)),r&&(u.uv1=Oi.getInterpolatedAttribute(r,o,l,c,d,new ze)),a&&(u.normal=Oi.getInterpolatedAttribute(a,o,l,c,d,new k),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));let h={a:o,b:l,c,normal:new k,materialIndex:0};Oi.getNormal(wa,Ea,Ta,h.normal),u.face=h,u.barycoord=d}return u}var is=class extends nn{constructor(e=null,t=1,n=1,s,r,a,o,l,c=Pt,u=Pt,d,h){super(null,a,o,l,c,u,s,r,d,h),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Rr=class extends zn{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},Ds=new Ve,uu=new Ve,Pa=[],du=new ei,fm=new Ve,gr=new He,xr=new ti,ss=class extends He{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Rr(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,fm)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new ei),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ds),du.copy(e.boundingBox).applyMatrix4(Ds),this.boundingBox.union(du)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new ti),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ds),xr.copy(e.boundingSphere).applyMatrix4(Ds),this.boundingSphere.union(xr)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),this.morphTexture=e.morphTexture!==null?e.morphTexture.clone():null,this.instanceColor=e.instanceColor!==null?e.instanceColor.clone():null,this.count=e.count,this.boundingBox=e.boundingBox!==null?e.boundingBox.clone():null,this.boundingSphere=e.boundingSphere!==null?e.boundingSphere.clone():null,this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,a=e*r+1;for(let o=0;o<n.length;o++)n[o]=s[a+o]}raycast(e,t){let n=this.matrixWorld,s=this.count;if(gr.geometry=this.geometry,gr.material=this.material,gr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),xr.copy(this.boundingSphere),xr.applyMatrix4(n),e.ray.intersectsSphere(xr)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,Ds),uu.multiplyMatrices(n,Ds),gr.matrixWorld=uu,gr.raycast(e,Pa);for(let a=0,o=Pa.length;a<o;a++){let l=Pa[a];l.instanceId=r,l.object=this,t.push(l)}Pa.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new Rr(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new is(new Float32Array(s*this.count),s,this.count,er,Pn));let r=this.morphTexture.source.data.data,a=0;for(let c=0;c<n.length;c++)a+=n[c];let o=this.geometry.morphTargetsRelative?1:1-a,l=s*e;return r[l]=o,r.set(n,l+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.instanceMatrix.dispose(),this.instanceColor!==null&&this.instanceColor.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},ts=new ti,pm=new ze(.5,.5),Ia=new k,ki=class{constructor(e=new cn,t=new cn,n=new cn,s=new cn,r=new cn,a=new cn){this.planes=[e,t,n,s,r,a]}set(e,t,n,s,r,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(s),o[4].copy(r),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Cn,n=!1){let s=this.planes,r=e.elements,a=r[0],o=r[1],l=r[2],c=r[3],u=r[4],d=r[5],h=r[6],m=r[7],g=r[8],S=r[9],f=r[10],p=r[11],_=r[12],M=r[13],w=r[14],C=r[15];if(s[0].setComponents(c-a,m-u,p-g,C-_).normalize(),s[1].setComponents(c+a,m+u,p+g,C+_).normalize(),s[2].setComponents(c+o,m+d,p+S,C+M).normalize(),s[3].setComponents(c-o,m-d,p-S,C-M).normalize(),n)s[4].setComponents(l,h,f,w).normalize(),s[5].setComponents(c-l,m-h,p-f,C-w).normalize();else if(s[4].setComponents(c-l,m-h,p-f,C-w).normalize(),t===Cn)s[5].setComponents(c+l,m+h,p+f,C+w).normalize();else if(t===zs)s[5].setComponents(l,h,f,w).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ts.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),ts.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ts)}intersectsSprite(e){ts.center.set(0,0,0);let t=pm.distanceTo(e.center);return ts.radius=.7071067811865476+t,ts.applyMatrix4(e.matrixWorld),this.intersectsSphere(ts)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(Ia.x=s.normal.x>0?e.max.x:e.min.x,Ia.y=s.normal.y>0?e.max.y:e.min.y,Ia.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(Ia)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},fu=new Ve,to=class i{constructor(){this.coordinateSystem=Cn,this._frustums=[],this._count=0}setFromArrayCamera(e){let t=e.cameras,n=this._frustums;for(let s=0;s<t.length;s++){let r=t[s];fu.multiplyMatrices(r.projectionMatrix,r.matrixWorldInverse),n[s]===void 0&&(n[s]=new ki),n[s].setFromProjectionMatrix(fu,r.coordinateSystem,r.reversedDepth)}return this._count=t.length,this}getFrustum(e){return this._frustums[e]}intersectsObject(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsObject(e))return!0;return!1}intersectsSprite(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsSprite(e))return!0;return!1}intersectsSphere(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsSphere(e))return!0;return!1}intersectsBox(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].intersectsBox(e))return!0;return!1}containsPoint(e){let t=this._frustums;for(let n=0;n<this._count;n++)if(t[n].containsPoint(e))return!0;return!1}copy(e){this.coordinateSystem=e.coordinateSystem;let t=this._frustums,n=e._frustums;for(let s=0;s<e._count;s++)t[s]===void 0&&(t[s]=new ki),t[s].copy(n[s]);return this._count=e._count,this}clone(){return new i().copy(this)}};var no=class extends ni{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new me(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},io=new k,so=new k,pu=new Ve,vr=new ns,La=new ti,oc=new k,mu=new k,ro=class extends Xt{constructor(e=new St,t=new no){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0?this.morphTargetInfluences=e.morphTargetInfluences.slice():this.morphTargetInfluences=void 0,e.morphTargetDictionary!==void 0?this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary):this.morphTargetDictionary=void 0,this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)io.fromBufferAttribute(t,s-1),so.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=io.distanceTo(so);e.setAttribute("lineDistance",new Be(n,1))}else Le("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),La.copy(n.boundingSphere),La.applyMatrix4(s),La.radius+=r,e.ray.intersectsSphere(La)===!1)return;pu.copy(s).invert(),vr.copy(e.ray).applyMatrix4(pu);let o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=this.isLineSegments?2:1,u=n.index,h=n.attributes.position;if(u!==null){let m=Math.max(0,a.start),g=Math.min(u.count,a.start+a.count);for(let S=m,f=g-1;S<f;S+=c){let p=u.getX(S),_=u.getX(S+1),M=Da(this,e,vr,l,p,_,S);M&&t.push(M)}if(this.isLineLoop){let S=u.getX(g-1),f=u.getX(m),p=Da(this,e,vr,l,S,f,g-1);p&&t.push(p)}}else{let m=Math.max(0,a.start),g=Math.min(h.count,a.start+a.count);for(let S=m,f=g-1;S<f;S+=c){let p=Da(this,e,vr,l,S,S+1,S);p&&t.push(p)}if(this.isLineLoop){let S=Da(this,e,vr,l,g-1,m,g-1);S&&t.push(S)}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}};function Da(i,e,t,n,s,r,a){let o=i.geometry.attributes.position;if(io.fromBufferAttribute(o,s),so.fromBufferAttribute(o,r),t.distanceSqToSegment(io,so,oc,mu)>n)return;oc.applyMatrix4(i.matrixWorld);let c=e.ray.origin.distanceTo(oc);if(!(c<e.near||c>e.far))return{distance:c,point:mu.clone().applyMatrix4(i.matrixWorld),index:a,face:null,faceIndex:null,barycoord:null,object:i}}var gu=new k,xu=new k,Pr=class extends ro{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)gu.fromBufferAttribute(t,s),xu.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+gu.distanceTo(xu);e.setAttribute("lineDistance",new Be(n,1))}else Le("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}};var ao=class extends ni{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new me(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},vu=new Ve,fc=new ns,Na=new ti,Ua=new k,Ir=class extends Xt{constructor(e=new St,t=new ao){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0?this.morphTargetInfluences=e.morphTargetInfluences.slice():this.morphTargetInfluences=void 0,e.morphTargetDictionary!==void 0?this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary):this.morphTargetDictionary=void 0,this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Na.copy(n.boundingSphere),Na.applyMatrix4(s),Na.radius+=r,e.ray.intersectsSphere(Na)===!1)return;vu.copy(s).invert(),fc.copy(e.ray).applyMatrix4(vu);let o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,d=n.attributes.position;if(c!==null){let h=Math.max(0,a.start),m=Math.min(c.count,a.start+a.count);for(let g=h,S=m;g<S;g++){let f=c.getX(g);Ua.fromBufferAttribute(d,f),yu(Ua,f,l,s,e,t,this)}}else{let h=Math.max(0,a.start),m=Math.min(d.count,a.start+a.count);for(let g=h,S=m;g<S;g++)Ua.fromBufferAttribute(d,g),yu(Ua,g,l,s,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=s.length;r<a;r++){let o=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}};function yu(i,e,t,n,s,r,a){let o=fc.distanceSqToPoint(i);if(o<t){let l=new k;fc.closestPointToPoint(i,l),l.applyMatrix4(n);let c=s.ray.origin.distanceTo(l);if(c<s.near||c>s.far)return;r.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:e,face:null,faceIndex:null,barycoord:null,object:a})}}var Lr=class extends nn{constructor(e=[],t=hs,n,s,r,a,o,l,c,u){super(e,t,n,s,r,a,o,l,c,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},rs=class extends nn{constructor(e,t,n,s,r,a,o,l,c){super(e,t,n,s,r,a,o,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}};var Gn=class extends nn{constructor(e,t,n=Tn,s,r,a,o=Pt,l=Pt,c,u=vi,d=1){if(u!==vi&&u!==Ei)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let h={width:e,height:t,depth:d};super(h,s,r,a,o,l,u,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Ws(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return t.compareFunction=this.compareFunction,t}},Dr=class extends Gn{constructor(e,t=Tn,n=hs,s,r,a=Pt,o=Pt,l,c=vi){let u={width:e,height:e,depth:1},d=[u,u,u,u,u,u];super(e,e,t,n,s,r,a,o,l,c),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Nr=class extends nn{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},mn=class i extends St{constructor(e=1,t=1,n=1,s=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:a};let o=this;s=Math.floor(s),r=Math.floor(r),a=Math.floor(a);let l=[],c=[],u=[],d=[],h=0,m=0;g("z","y","x",-1,-1,n,t,e,a,r,0),g("z","y","x",1,-1,n,t,-e,a,r,1),g("x","z","y",1,1,e,n,t,s,a,2),g("x","z","y",1,-1,e,n,-t,s,a,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new Be(c,3)),this.setAttribute("normal",new Be(u,3)),this.setAttribute("uv",new Be(d,2));function g(S,f,p,_,M,w,C,b,x,v,A){let R=w/x,L=C/v,N=w/2,B=C/2,D=b/2,W=x+1,V=v+1,Y=0,H=0,F=new k;for(let $=0;$<V;$++){let ee=$*L-B;for(let ae=0;ae<W;ae++){let ge=ae*R-N;F[S]=ge*_,F[f]=ee*M,F[p]=D,c.push(F.x,F.y,F.z),F[S]=0,F[f]=0,F[p]=b>0?1:-1,u.push(F.x,F.y,F.z),d.push(ae/x),d.push(1-$/v),Y+=1}}for(let $=0;$<v;$++)for(let ee=0;ee<x;ee++){let ae=h+ee+W*$,ge=h+ee+W*($+1),J=h+(ee+1)+W*($+1),xe=h+(ee+1)+W*$;l.push(ae,ge,xe),l.push(ge,J,xe),H+=6}o.addGroup(m,H,A),m+=H,h+=Y}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};var Ur=class i extends St{constructor(e=1,t=32,n=0,s=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:s},t=Math.max(3,t);let r=[],a=[],o=[],l=[],c=new k,u=new ze;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let d=0,h=3;d<=t;d++,h+=3){let m=n+d/t*s;c.x=e*Math.cos(m),c.y=e*Math.sin(m),a.push(c.x,c.y,c.z),o.push(0,0,1),u.x=(a[h]/e+1)/2,u.y=(a[h+1]/e+1)/2,l.push(u.x,u.y)}for(let d=1;d<=t;d++)r.push(d,d+1,0);this.setIndex(r),this.setAttribute("position",new Be(a,3)),this.setAttribute("normal",new Be(o,3)),this.setAttribute("uv",new Be(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.segments,e.thetaStart,e.thetaLength)}},Vn=class i extends St{constructor(e=1,t=1,n=1,s=32,r=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:a,thetaStart:o,thetaLength:l};let c=this;s=Math.floor(s),r=Math.floor(r);let u=[],d=[],h=[],m=[],g=0,S=[],f=n/2,p=0;_(),a===!1&&(e>0&&M(!0),t>0&&M(!1)),this.setIndex(u),this.setAttribute("position",new Be(d,3)),this.setAttribute("normal",new Be(h,3)),this.setAttribute("uv",new Be(m,2));function _(){let w=new k,C=new k,b=0,x=(t-e)/n;for(let v=0;v<=r;v++){let A=[],R=v/r,L=R*(t-e)+e;for(let N=0;N<=s;N++){let B=N/s,D=B*l+o,W=Math.sin(D),V=Math.cos(D);C.x=L*W,C.y=-R*n+f,C.z=L*V,d.push(C.x,C.y,C.z),w.set(W,x,V).normalize(),h.push(w.x,w.y,w.z),m.push(B,1-R),A.push(g++)}S.push(A)}for(let v=0;v<s;v++)for(let A=0;A<r;A++){let R=S[A][v],L=S[A+1][v],N=S[A+1][v+1],B=S[A][v+1];(e>0||A!==0)&&(u.push(R,L,B),b+=3),(t>0||A!==r-1)&&(u.push(L,N,B),b+=3)}c.addGroup(p,b,0),p+=b}function M(w){let C=g,b=new ze,x=new k,v=0,A=w===!0?e:t,R=w===!0?1:-1;for(let N=1;N<=s;N++)d.push(0,f*R,0),h.push(0,R,0),m.push(.5,.5),g++;let L=g;for(let N=0;N<=s;N++){let D=N/s*l+o,W=Math.cos(D),V=Math.sin(D);x.x=A*V,x.y=f*R,x.z=A*W,d.push(x.x,x.y,x.z),h.push(0,R,0),b.x=W*.5+.5,b.y=V*.5*R+.5,m.push(b.x,b.y),g++}for(let N=0;N<s;N++){let B=C+N,D=L+N;w===!0?u.push(D,D+1,B):u.push(D+1,D,B),v+=3}c.addGroup(p,v,w===!0?1:2),p+=v}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},as=class i extends Vn{constructor(e=1,t=1,n=32,s=1,r=!1,a=0,o=Math.PI*2){super(0,e,t,n,s,r,a,o),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:s,openEnded:r,thetaStart:a,thetaLength:o}}static fromJSON(e){return new i(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},oo=class i extends St{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};let r=[],a=[];o(s),c(n),u(),this.setAttribute("position",new Be(r,3)),this.setAttribute("normal",new Be(r.slice(),3)),this.setAttribute("uv",new Be(a,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function o(_){let M=new k,w=new k,C=new k;for(let b=0;b<t.length;b+=3)m(t[b+0],M),m(t[b+1],w),m(t[b+2],C),l(M,w,C,_)}function l(_,M,w,C){let b=C+1,x=[];for(let v=0;v<=b;v++){x[v]=[];let A=_.clone().lerp(w,v/b),R=M.clone().lerp(w,v/b),L=b-v;for(let N=0;N<=L;N++)N===0&&v===b?x[v][N]=A:x[v][N]=A.clone().lerp(R,N/L)}for(let v=0;v<b;v++)for(let A=0;A<2*(b-v)-1;A++){let R=Math.floor(A/2);A%2===0?(h(x[v][R+1]),h(x[v+1][R]),h(x[v][R])):(h(x[v][R+1]),h(x[v+1][R+1]),h(x[v+1][R]))}}function c(_){let M=new k;for(let w=0;w<r.length;w+=3)M.x=r[w+0],M.y=r[w+1],M.z=r[w+2],M.normalize().multiplyScalar(_),r[w+0]=M.x,r[w+1]=M.y,r[w+2]=M.z}function u(){let _=new k;for(let M=0;M<r.length;M+=3){_.x=r[M+0],_.y=r[M+1],_.z=r[M+2];let w=f(_)/2/Math.PI+.5,C=p(_)/Math.PI+.5;a.push(w,1-C)}g(),d()}function d(){for(let _=0;_<a.length;_+=6){let M=a[_+0],w=a[_+2],C=a[_+4],b=Math.max(M,w,C),x=Math.min(M,w,C);b>.9&&x<.1&&(M<.2&&(a[_+0]+=1),w<.2&&(a[_+2]+=1),C<.2&&(a[_+4]+=1))}}function h(_){r.push(_.x,_.y,_.z)}function m(_,M){let w=_*3;M.x=e[w+0],M.y=e[w+1],M.z=e[w+2]}function g(){let _=new k,M=new k,w=new k,C=new k,b=new ze,x=new ze,v=new ze;for(let A=0,R=0;A<r.length;A+=9,R+=6){_.set(r[A+0],r[A+1],r[A+2]),M.set(r[A+3],r[A+4],r[A+5]),w.set(r[A+6],r[A+7],r[A+8]),b.set(a[R+0],a[R+1]),x.set(a[R+2],a[R+3]),v.set(a[R+4],a[R+5]),C.copy(_).add(M).add(w).divideScalar(3);let L=f(C);S(b,R+0,_,L),S(x,R+2,M,L),S(v,R+4,w,L)}}function S(_,M,w,C){C<0&&_.x===1&&(a[M]=_.x-1),w.x===0&&w.z===0&&(a[M]=C/2/Math.PI+.5)}function f(_){return Math.atan2(_.z,-_.x)}function p(_){return Math.atan2(-_.y,Math.sqrt(_.x*_.x+_.z*_.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.vertices,e.indices,e.radius,e.detail)}};var bi=class i extends oo{constructor(e=1,t=0){let n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new i(e.radius,e.detail)}};var wn=class i extends St{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,a=t/2,o=Math.floor(n),l=Math.floor(s),c=o+1,u=l+1,d=e/o,h=t/l,m=[],g=[],S=[],f=[];for(let p=0;p<u;p++){let _=p*h-a;for(let M=0;M<c;M++){let w=M*d-r;g.push(w,-_,0),S.push(0,0,1),f.push(M/o),f.push(1-p/l)}}for(let p=0;p<l;p++)for(let _=0;_<o;_++){let M=_+c*p,w=_+c*(p+1),C=_+1+c*(p+1),b=_+1+c*p;m.push(M,w,b),m.push(w,C,b)}this.setIndex(m),this.setAttribute("position",new Be(g,3)),this.setAttribute("normal",new Be(S,3)),this.setAttribute("uv",new Be(f,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}},Fr=class i extends St{constructor(e=.5,t=1,n=32,s=1,r=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:s,thetaStart:r,thetaLength:a},n=Math.max(3,n),s=Math.max(1,s);let o=[],l=[],c=[],u=[],d=e,h=(t-e)/s,m=new k,g=new ze;for(let S=0;S<=s;S++){for(let f=0;f<=n;f++){let p=r+f/n*a;m.x=d*Math.cos(p),m.y=d*Math.sin(p),l.push(m.x,m.y,m.z),c.push(0,0,1),g.x=(m.x/t+1)/2,g.y=(m.y/t+1)/2,u.push(g.x,g.y)}d+=h}for(let S=0;S<s;S++){let f=S*(n+1);for(let p=0;p<n;p++){let _=p+f,M=_,w=_+n+1,C=_+n+2,b=_+1;o.push(M,w,b),o.push(w,C,b)}}this.setIndex(o),this.setAttribute("position",new Be(l,3)),this.setAttribute("normal",new Be(c,3)),this.setAttribute("uv",new Be(u,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}};var Or=class i extends St{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let l=Math.min(a+o,Math.PI),c=0,u=[],d=new k,h=new k,m=[],g=[],S=[],f=[];for(let p=0;p<=n;p++){let _=[],M=p/n,w=a+M*o,C=e*Math.cos(w),b=Math.sqrt(e*e-C*C),x=0;p===0&&a===0?x=.5/t:p===n&&l===Math.PI&&(x=-.5/t);for(let v=0;v<=t;v++){let A=v/t,R=s+A*r;d.x=-b*Math.cos(R),d.y=C,d.z=b*Math.sin(R),g.push(d.x,d.y,d.z),h.copy(d).normalize(),S.push(h.x,h.y,h.z),f.push(A+x,1-M),_.push(c++)}u.push(_)}for(let p=0;p<n;p++)for(let _=0;_<t;_++){let M=u[p][_+1],w=u[p][_],C=u[p+1][_],b=u[p+1][_+1];(p!==0||a>0)&&m.push(M,w,b),(p!==n-1||l<Math.PI)&&m.push(w,C,b)}this.setIndex(m),this.setAttribute("position",new Be(g,3)),this.setAttribute("normal",new Be(S,3)),this.setAttribute("uv",new Be(f,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};function ds(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];if(_u(s))s.isRenderTargetTexture?(Le("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone();else if(Array.isArray(s))if(_u(s[0])){let r=[];for(let a=0,o=s.length;a<o;a++)r[a]=s[a].clone();e[t][n]=r}else e[t][n]=s.slice();else e[t][n]=s}}return e}function rn(i){let e={};for(let t=0;t<i.length;t++){let n=ds(i[t]);for(let s in n)e[s]=n[s]}return e}function _u(i){return i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)}function mm(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Xc(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:je.workingColorSpace}var ul={clone:ds,merge:rn},gm=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,xm=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,wt=class extends ni{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=gm,this.fragmentShader=xm,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=ds(e.uniforms),this.uniformsGroups=mm(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let a=this.uniforms[s].value;a&&a.isTexture?t.uniforms[s]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[s]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[s]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[s]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[s]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[s]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[s]={type:"m4",value:a.toArray()}:t.uniforms[s]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let s=e.uniforms[n];switch(this.uniforms[n]={},s.type){case"t":this.uniforms[n].value=t[s.value]||null;break;case"c":this.uniforms[n].value=new me().setHex(s.value);break;case"v2":this.uniforms[n].value=new ze().fromArray(s.value);break;case"v3":this.uniforms[n].value=new k().fromArray(s.value);break;case"v4":this.uniforms[n].value=new pt().fromArray(s.value);break;case"m3":this.uniforms[n].value=new Oe().fromArray(s.value);break;case"m4":this.uniforms[n].value=new Ve().fromArray(s.value);break;default:this.uniforms[n].value=s.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let n in e.extensions)this.extensions[n]=e.extensions[n];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},lo=class extends wt{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}};var It=class extends ni{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new me(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new me(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=hl,this.normalScale=new ze(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new yi,this.combine=wo,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},co=class extends ni{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=ed,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},ho=class extends ni{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Ns(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function Fa(i){return i!==void 0&&i.inTangents!==void 0&&i.outTangents!==void 0}var Bi=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];n:{e:{let a;t:{i:if(!(e<s)){for(let o=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(r=s,s=t[++n],e<s)break e}a=t.length;break t}if(!(e>=r)){let o=t[1];e<o&&(n=2,r=o);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(s=r,r=t[--n-1],e>=r)break e}a=n,n=0;break t}break n}for(;n<a;){let o=n+a>>>1;e<t[o]?a=o:n=o+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let a=0;a!==s;++a)t[a]=n[r+a];return t}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},uo=class extends Bi{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:hc,endingEnd:hc}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,a=e+1,o=s[r],l=s[a];if(o===void 0)switch(this.getSettings_().endingStart){case uc:r=e,o=2*t-n;break;case dc:r=s.length-2,o=t+s[r]-s[r+1];break;default:r=e,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case uc:a=e,l=2*n-t;break;case dc:a=1,l=n+s[1]-s[0];break;default:a=e-1,l=t}let c=(n-t)*.5,u=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(l-n),this._offsetPrev=r*u,this._offsetNext=a*u}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,u=this._offsetPrev,d=this._offsetNext,h=this._weightPrev,m=this._weightNext,g=(n-t)/(s-t),S=g*g,f=S*g,p=-h*f+2*h*S-h*g,_=(1+h)*f+(-1.5-2*h)*S+(-.5+h)*g+1,M=(-1-m)*f+(1.5+m)*S+.5*g,w=m*f-m*S;for(let C=0;C!==o;++C)r[C]=p*a[u+C]+_*a[c+C]+M*a[l+C]+w*a[d+C];return r}},fo=class extends Bi{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,u=(n-t)/(s-t),d=1-u;for(let h=0;h!==o;++h)r[h]=a[c+h]*d+a[l+h]*u;return r}},po=class extends Bi{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},mo=class extends Bi{interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,u=this.inTangents,d=this.outTangents;if(!u||!d){let g=(n-t)/(s-t),S=1-g;for(let f=0;f!==o;++f)r[f]=a[c+f]*S+a[l+f]*g;return r}let h=o*2,m=e-1;for(let g=0;g!==o;++g){let S=a[c+g],f=a[l+g],p=m*h+g*2,_=d[p],M=d[p+1],w=e*h+g*2,C=u[w],b=u[w+1],x=ym(n,t,_,C,s);r[g]=gd(x,S,M,b,f)}return r}};function gd(i,e,t,n,s){let r=1-i;return r*r*r*e+3*r*r*i*t+3*r*i*i*n+i*i*i*s}function vm(i,e,t,n,s){let r=1-i;return 3*r*r*(t-e)+6*r*i*(n-t)+3*i*i*(s-n)}function ym(i,e,t,n,s){let r=(i-e)/(s-e);for(let a=0;a<8;a++){let o=gd(r,e,t,n,s)-i;if(Math.abs(o)<1e-10)break;let l=vm(r,e,t,n,s);if(Math.abs(l)<1e-10)break;r=Math.max(0,Math.min(1,r-o/l))}return r}var En=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Ns(t,this.TimeBufferType),this.values=Ns(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Ns(e.times,Array),values:Ns(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s),Fa(e.settings)&&(n.settings={inTangents:Ns(e.settings.inTangents,Array),outTangents:Ns(e.settings.outTangents,Array)})}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new po(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new fo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new uo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new mo(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case Sr:t=this.InterpolantFactoryMethodDiscrete;break;case Ka:t=this.InterpolantFactoryMethodLinear;break;case Ba:t=this.InterpolantFactoryMethodSmooth;break;case cc:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return Le("KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Sr;case this.InterpolantFactoryMethodLinear:return Ka;case this.InterpolantFactoryMethodSmooth:return Ba;case this.InterpolantFactoryMethodBezier:return cc}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e;Fa(this.settings)&&(bu(this.settings.inTangents,e),bu(this.settings.outTangents,e))}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e;Fa(this.settings)&&(Su(this.settings.inTangents,e),Su(this.settings.outTangents,e))}return this}trim(e,t){let n=this.times,s=n.length,r=0,a=s-1;for(;r!==s&&n[r]<e;)++r;for(;a!==-1&&n[a]>t;)--a;if(++a,r!==0||a!==s){r>=a&&(a=Math.max(a,1),r=a-1);let o=this.getValueSize();this.times=n.slice(r,a),this.values=this.values.slice(r*o,a*o)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(Ne("KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(Ne("KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==r;o++){let l=n[o];if(typeof l=="number"&&isNaN(l)){Ne("KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){Ne("KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(s!==void 0&&Np(s))for(let o=0,l=s.length;o!==l;++o){let c=s[o];if(isNaN(c)){Ne("KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===Ba,r=e.length-1,a=1;for(let o=1;o<r;++o){let l=!1,c=e[o],u=e[o+1];if(c!==u&&(o!==1||c!==e[0]))if(s)l=!0;else{let d=o*n,h=d-n,m=d+n;for(let g=0;g!==n;++g){let S=t[d+g];if(S!==t[h+g]||S!==t[m+g]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];let d=o*n,h=a*n;for(let m=0;m!==n;++m)t[h+m]=t[d+m]}++a}}if(r>0){e[a]=e[r];for(let o=r*n,l=a*n,c=0;c!==n;++c)t[l+c]=t[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,Fa(this.settings)&&(s.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),s}};function bu(i,e){for(let t=0,n=i.length;t!==n;t+=2)i[t]+=e}function Su(i,e){for(let t=0,n=i.length;t!==n;t+=2)i[t]*=e}En.prototype.ValueTypeName="";En.prototype.TimeBufferType=Float32Array;En.prototype.ValueBufferType=Float32Array;En.prototype.DefaultInterpolation=Ka;var zi=class extends En{constructor(e,t,n){super(e,t,n)}};zi.prototype.ValueTypeName="bool";zi.prototype.ValueBufferType=Array;zi.prototype.DefaultInterpolation=Sr;zi.prototype.InterpolantFactoryMethodLinear=void 0;zi.prototype.InterpolantFactoryMethodSmooth=void 0;var go=class extends En{constructor(e,t,n,s){super(e,t,n,s)}};go.prototype.ValueTypeName="color";var xo=class extends En{constructor(e,t,n,s){super(e,t,n,s)}};xo.prototype.ValueTypeName="number";var vo=class extends Bi{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-t)/(s-t),c=e*o;for(let u=c+o;c!==u;c+=4)Mn.slerpFlat(r,0,a,c-o,a,c,l);return r}},kr=class extends En{constructor(e,t,n,s){super(e,t,n,s)}InterpolantFactoryMethodLinear(e){return new vo(this.times,this.values,this.getValueSize(),e)}};kr.prototype.ValueTypeName="quaternion";kr.prototype.InterpolantFactoryMethodSmooth=void 0;var Hi=class extends En{constructor(e,t,n){super(e,t,n)}};Hi.prototype.ValueTypeName="string";Hi.prototype.ValueBufferType=Array;Hi.prototype.DefaultInterpolation=Sr;Hi.prototype.InterpolantFactoryMethodLinear=void 0;Hi.prototype.InterpolantFactoryMethodSmooth=void 0;var yo=class extends En{constructor(e,t,n,s){super(e,t,n,s)}};yo.prototype.ValueTypeName="vector";var Ha={enabled:!1,files:{},add:function(i,e){this.enabled!==!1&&(Mu(i)||(this.files[i]=e))},get:function(i){if(this.enabled!==!1&&!Mu(i))return this.files[i]},remove:function(i){delete this.files[i]},clear:function(){this.files={}}};function Mu(i){try{let e=i.slice(i.indexOf(":")+1);return new URL(e).protocol==="blob:"}catch{return!1}}var _o=class{constructor(e,t,n){let s=this,r=!1,a=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(u){o++,r===!1&&s.onStart!==void 0&&s.onStart(u,a,o),r=!0},this.itemEnd=function(u){a++,s.onProgress!==void 0&&s.onProgress(u,a,o),a===o&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(u){s.onError!==void 0&&s.onError(u)},this.resolveURL=function(u){return u=u.normalize("NFC"),l?l(u):u},this.setURLModifier=function(u){return l=u,this},this.addHandler=function(u,d){return c.push(u,d),this},this.removeHandler=function(u){let d=c.indexOf(u);return d!==-1&&c.splice(d,2),this},this.getHandler=function(u){for(let d=0,h=c.length;d<h;d+=2){let m=c[d],g=c[d+1];if(m.global&&(m.lastIndex=0),m.test(u))return g}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},xd=new _o,Ys=class{constructor(e){this.manager=e!==void 0?e:xd,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},this.priority="auto",this.cache="default",typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}setPriority(e){return this.priority=e,this}setCache(e){return this.cache=e,this}abort(){return this}};Ys.DEFAULT_MATERIAL_NAME="__DEFAULT";var Us=new WeakMap,bo=class extends Ys{constructor(e){super(e)}load(e,t,n,s){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,a=Ha.get(`image:${e}`);if(a!==void 0){if(a.complete===!0)r.manager.itemStart(e),setTimeout(function(){t&&t(a),r.manager.itemEnd(e)},0);else{let d=Us.get(a);d===void 0&&(d=[],Us.set(a,d)),d.push({onLoad:t,onError:s})}return a}let o=Hs("img");function l(){u(),t&&t(this);let d=Us.get(this)||[];for(let h=0;h<d.length;h++){let m=d[h];m.onLoad&&m.onLoad(this)}Us.delete(this),r.manager.itemEnd(e)}function c(d){u(),s&&s(d),Ha.remove(`image:${e}`);let h=Us.get(this)||[];for(let m=0;m<h.length;m++){let g=h[m];g.onError&&g.onError(d)}Us.delete(this),r.manager.itemError(e),r.manager.itemEnd(e)}function u(){o.removeEventListener("load",l,!1),o.removeEventListener("error",c,!1)}return o.addEventListener("load",l,!1),o.addEventListener("error",c,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),Ha.add(`image:${e}`,o),r.manager.itemStart(e),o.fetchPriority=this.priority,o.src=e,o}};var Br=class extends Ys{constructor(e){super(e)}load(e,t,n,s){let r=new nn,a=new bo(this.manager);return a.setPriority(this.priority),a.setCache(this.cache),a.setCrossOrigin(this.crossOrigin),a.setPath(this.path),a.load(e,function(o){r.image=o,r.needsUpdate=!0,t!==void 0&&t(r)},n,s),r}},zr=class extends Xt{static registerNode(e){this.prototype._lightNode=e}constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new me(e),this.intensity=t}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Si=class extends zr{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Xt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new me(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},lc=new Ve,wu=new k,Eu=new k,So=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new ze(512,512),this.mapType=sn,this.map=null,this.mapPass=null,this.matrix=new Ve,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ki,this._frameExtents=new ze(1,1),this._viewportCount=1,this._viewports=[new pt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera;wu.setFromMatrixPosition(e.matrixWorld),t.position.copy(wu),Eu.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Eu),t.updateMatrixWorld(),this._updateMatrix(t,this.matrix,this._frustum)}_updateMatrix(e,t,n,s){lc.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),n.setFromProjectionMatrix(lc,e.coordinateSystem,e.reversedDepth);let r=this._frameExtents,a=s?s.z/r.x:1,o=s?s.w/r.y:1,l=s?s.x/r.x:0,c=s?s.y/r.y:0;e.coordinateSystem===zs||e.reversedDepth?t.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):t.set(.5*a,0,0,.5*a+l,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),t.multiply(lc)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.mapType=e.mapType,this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return e.intensity=this.intensity,e.bias=this.bias,e.normalBias=this.normalBias,e.radius=this.radius,e.blurSamples=this.blurSamples,e.mapSize=this.mapSize.toArray(),e.mapType=this.mapType,e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},Oa=new k,ka=new Mn,Kn=new k,Hr=class extends Xt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Ve,this.projectionMatrix=new Ve,this.projectionMatrixInverse=new Ve,this.coordinateSystem=Cn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(Oa,ka,Kn),Kn.x===1&&Kn.y===1&&Kn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Oa,ka,Kn.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(Oa,ka,Kn),Kn.x===1&&Kn.y===1&&Kn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Oa,ka,Kn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Fi=new k,Tu=new ze,Au=new ze,Ot=class extends Hr{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Vs*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(_r*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Vs*2*Math.atan(Math.tan(_r*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Fi.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Fi.x,Fi.y).multiplyScalar(-e/Fi.z),Fi.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Fi.x,Fi.y).multiplyScalar(-e/Fi.z)}getViewSize(e,t){return this.getViewBounds(e,Tu,Au),t.subVectors(Au,Tu)}setViewOffset(e,t,n,s,r,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(_r*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,a=this.view;if(this.view!==null&&this.view.enabled){let l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*s/l,t-=a.offsetY*n/c,s*=a.width/l,n*=a.height/c}let o=this.filmOffset;o!==0&&(r+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}};var os=class extends Hr{constructor(e=-1,t=1,n=1,s=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,a=n+e,o=s+t,l=s-t;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=u*this.view.offsetY,l=o-u*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},pc=class extends So{constructor(){super(new os(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Mi=class extends zr{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Xt.DEFAULT_UP),this.updateMatrix(),this.target=new Xt,this.shadow=new pc}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}};var Fs=-90,Os=1,$s=class extends Xt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new Ot(Fs,Os,e,t);s.layers=this.layers,this.add(s);let r=new Ot(Fs,Os,e,t);r.layers=this.layers,this.add(r);let a=new Ot(Fs,Os,e,t);a.layers=this.layers,this.add(a);let o=new Ot(Fs,Os,e,t);o.layers=this.layers,this.add(o);let l=new Ot(Fs,Os,e,t);l.layers=this.layers,this.add(l);let c=new Ot(Fs,Os,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,a,o,l]=t;for(let c of t)this.remove(c);if(e===Cn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===zs)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,a,o,l,c,u]=this.children,d=e.getRenderTarget(),h=e.getActiveCubeFace(),m=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;let S=n.texture.mipmapsAutoUpdate;n.texture.mipmapsAutoUpdate=!1;let f=!1;e.isWebGLRenderer===!0?f=e.state.buffers.depth.getReversed():f=e.reversedDepthBuffer,e.setRenderTarget(n,0,s),f&&e.autoClear===!1&&e.clearDepth(),e.render(t,r),e.setRenderTarget(n,1,s),f&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,s),f&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,s),f&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(n,4,s),f&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.mipmapsAutoUpdate=S,e.setRenderTarget(n,5,s),f&&e.autoClear===!1&&e.clearDepth(),e.render(t,u),e.setRenderTarget(d,h,m),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}},Mo=class extends Ot{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e,this.perCameraFrustumCulled=!1}};var qc="\\[\\]\\.:\\/",_m=new RegExp("["+qc+"]","g"),Yc="[^"+qc+"]",bm="[^"+qc.replace("\\.","")+"]",Sm=/((?:WC+[\/:])*)/.source.replace("WC",Yc),Mm=/(WCOD+)?/.source.replace("WCOD",bm),wm=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Yc),Em=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Yc),Tm=new RegExp("^"+Sm+Mm+wm+Em+"$"),Am=["material","materials","bones","map"],mc=class{constructor(e,t,n){let s=n||vt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},vt=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(_m,"")}static parseTrackName(e){let t=Tm.exec(e);if(t===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);Am.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let a=0;a<r.length;a++){let o=r[a];if(o.name===t||o.uuid===t)return o;let l=n(o.children);if(l)return l}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){Le("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){Ne("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){Ne("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){Ne("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let u=0;u<e.length;u++)if(e[u].name===c){c=u;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){Ne("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){Ne("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){Ne("PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){Ne("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}let a=e[s];if(a===void 0){let c=t.nodeName;Ne("PropertyBinding: Trying to update property for track: "+c+"."+s+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){Ne("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){Ne("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=r}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=s;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};vt.Composite=mc;vt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};vt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};vt.prototype.GetterByBindingType=[vt.prototype._getValue_direct,vt.prototype._getValue_array,vt.prototype._getValue_arrayElement,vt.prototype._getValue_toArray];vt.prototype.SetterByBindingTypeAndVersioning=[[vt.prototype._setValue_direct,vt.prototype._setValue_direct_setNeedsUpdate,vt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[vt.prototype._setValue_array,vt.prototype._setValue_array_setNeedsUpdate,vt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[vt.prototype._setValue_arrayElement,vt.prototype._setValue_arrayElement_setNeedsUpdate,vt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[vt.prototype._setValue_fromArray,vt.prototype._setValue_fromArray_setNeedsUpdate,vt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var mb=new Float32Array(1);var Cu=new Ve,Gr=class{constructor(e,t,n=0,s=1/0){this.ray=new ns(e,t),this.near=n,this.far=s,this.camera=null,this.layers=new Xs,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,t.projectionMatrix.elements[14]).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):Ne("Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return Cu.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Cu),this}intersectObject(e,t=!0,n=[]){return gc(e,this,n,t),n.sort(Ru),n}intersectObjects(e,t=!0,n=[]){for(let s=0,r=e.length;s<r;s++)gc(e[s],this,n,t);return n.sort(Ru),n}};function Ru(i,e){return i.distance-e.distance}function gc(i,e,t,n){let s=!0;if(i.layers.test(e.layers)&&i.raycast(e,t)===!1&&(s=!1),s===!0&&n===!0){let r=i.children;for(let a=0,o=r.length;a<o;a++)gc(r[a],e,t,!0)}}var xc=class{static{this.prototype.isMatrix2=!0}constructor(e,t,n,s){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,s)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,s){let r=this.elements;return r[0]=e,r[2]=t,r[1]=n,r[3]=s,this}};function $c(i,e,t,n){let s=Cm(n);switch(t){case Uc:return i*e;case er:return i*e/s.components*s.byteLength;case Io:return i*e/s.components*s.byteLength;case Vi:return i*e*2/s.components*s.byteLength;case Lo:return i*e*2/s.components*s.byteLength;case Fc:return i*e*3/s.components*s.byteLength;case Xn:return i*e*4/s.components*s.byteLength;case Do:return i*e*4/s.components*s.byteLength;case Wr:case Xr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case qr:case Yr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Uo:case Oo:return Math.max(i,16)*Math.max(e,8)/4;case No:case Fo:return Math.max(i,8)*Math.max(e,8)/2;case ko:case Bo:case Ho:case Go:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case zo:case $r:case Vo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Wo:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Xo:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case qo:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case Yo:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case $o:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case Zo:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case Jo:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case Ko:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case jo:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case Qo:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case el:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case tl:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case nl:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case il:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case sl:case rl:case al:return Math.ceil(i/4)*Math.ceil(e/4)*16;case ol:case ll:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Zr:case cl:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Cm(i){switch(i){case sn:case Ic:return{byteLength:1,components:1};case Qs:case Lc:case hn:return{byteLength:2,components:1};case Ro:case Po:return{byteLength:2,components:4};case Tn:case Co:case Pn:return{byteLength:4,components:1};case Dc:case Nc:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"187"}}));typeof window<"u"&&(window.__THREE__?Le("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="187");function Bd(){let i=null,e=!1,t=null,n=null;function s(r,a){n=i.requestAnimationFrame(s),t(r,a)}return{start:function(){e!==!0&&t!==null&&i!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i!==null&&i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function Pm(i){let e=new WeakMap;function t(o,l){let c=o.array,u=o.usage,d=c.byteLength,h=i.createBuffer();i.bindBuffer(l,h),i.bufferData(l,c,u),o.onUploadCallback();let m;if(c instanceof Float32Array)m=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)m=i.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?m=i.HALF_FLOAT:m=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)m=i.SHORT;else if(c instanceof Uint32Array)m=i.UNSIGNED_INT;else if(c instanceof Int32Array)m=i.INT;else if(c instanceof Int8Array)m=i.BYTE;else if(c instanceof Uint8Array)m=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)m=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:h,type:m,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:d}}function n(o,l,c){let u=l.array,d=l.updateRanges;if(i.bindBuffer(c,o),d.length===0)i.bufferSubData(c,0,u);else{d.sort((m,g)=>m.start-g.start);let h=0;for(let m=1;m<d.length;m++){let g=d[h],S=d[m];S.start<=g.start+g.count+1?g.count=Math.max(g.count,S.start+S.count-g.start):(++h,d[h]=S)}d.length=h+1;for(let m=0,g=d.length;m<g;m++){let S=d[m];i.bufferSubData(c,S.start*u.BYTES_PER_ELEMENT,u,S.start,S.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=e.get(o);l&&(i.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let u=e.get(o);(!u||u.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:s,remove:r,update:a}}var Im=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Lm=`#ifdef USE_ALPHAHASH
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
#endif`,Dm=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Nm=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Um=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Fm=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Om=`#ifdef USE_AOMAP
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
#endif`,km=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Bm=`#ifdef USE_BATCHING
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
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,zm=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Hm=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Gm=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Vm=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Wm=`#ifdef USE_IRIDESCENCE
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
#endif`,Xm=`#ifdef USE_BUMPMAP
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
#endif`,qm=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,Ym=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,$m=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Zm=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Jm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,Km=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,jm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,Qm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,eg=`#define PI 3.141592653589793
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
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
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
} // validated`,tg=`vec3 transformedNormal = objectNormal;
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
#endif`,ng=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,ig=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,sg=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,rg=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,ag="gl_FragColor = linearToOutputTexel( gl_FragColor );",og=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,lg=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,cg=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	uniform samplerCube envMap;
	#ifdef ENVMAP_TYPE_PMREM
		float roughnessToMip( const in float roughness ) {
			float r = clamp( roughness, 0.0, 1.0 );
			return ENVMAP_MAX_LOD * r * ( 2.0 - r );
		}
	#endif
#endif`,hg=`#ifdef USE_ENVMAP
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
#endif`,ug=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,dg=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fg=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,pg=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,mg=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,gg=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,xg=`#ifdef USE_GRADIENTMAP
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
}`,vg=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,yg=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,_g=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,bg=`uniform bool receiveShadow;
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
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
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
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
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
#endif
#include <lightprobes_pars_fragment>`,Sg=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureLod( envMap, envMapRotation * retroVec, roughnessToMip( roughness ) );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_PMREM
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,Mg=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,wg=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Eg=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Tg=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Ag=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.045 );
material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef USE_DIFFUSE_ROUGHNESS
	float diffuseRoughnessFactor = diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		diffuseRoughnessFactor *= texture2D( diffuseRoughnessMap, vDiffuseRoughnessMapUv ).r;
	#endif
	material.diffuseRoughness = saturate( diffuseRoughnessFactor );
#endif
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
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
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
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.045 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
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
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
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
#endif`,Cg=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float diffuseRoughness;
	#endif
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
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
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
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
#ifdef USE_DIFFUSE_ROUGHNESS
	const float EON_EPSILON = 1e-7;
	float FON_DirectionalAlbedo( const in float mu, const in float roughness, const in float A ) {
		float muComp = 1.0 - mu;
		float gOverPi = muComp * ( 0.0571085289 + muComp * ( 0.491881867 + muComp * ( - 0.332181442 + muComp * 0.0714429953 ) ) );
		return A * ( 1.0 + roughness * gOverPi );
	}
	vec3 BRDF_EON( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 diffuseColor, const in float roughness ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return BRDF_Lambert( rho );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float s = dot( lightDir, viewDir ) - dotNL * dotNV;
		float sOverT = ( s > 0.0 ) ? s / max( max( dotNL, dotNV ), EON_EPSILON ) : s;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		vec3 singleScatter = rho * RECIPROCAL_PI * A * ( 1.0 + roughness * sOverT );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		float albedoV = FON_DirectionalAlbedo( dotNV, roughness, A );
		float albedoL = FON_DirectionalAlbedo( dotNL, roughness, A );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		vec3 multiScatter = rhoMultiScatter * RECIPROCAL_PI
			* max( EON_EPSILON, 1.0 - albedoV )
			* max( EON_EPSILON, 1.0 - albedoL )
			/ max( EON_EPSILON, 1.0 - averageAlbedo );
		return singleScatter + multiScatter;
	}
	vec3 EON_DirectionalAlbedo( const in vec3 diffuseColor, const in float roughness, const in float dotNV ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return rho;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		float directionalAlbedo = FON_DirectionalAlbedo( dotNV, roughness, A );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		return rho * directionalAlbedo + rhoMultiScatter * ( 1.0 - directionalAlbedo );
	}
#endif
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
		return 0.5 / max( gv + gl, EPSILON );
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
		float roughness = max( material.clearcoatRoughness, 0.045 );
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
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = max( material.roughness, 0.045 );
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
		float alphaT = max( material.alphaT, alpha );
		float V = V_GGX_SmithCorrelated_Anisotropic( alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( alphaT, alpha, dotNH, dotTH, dotBH );
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
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
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
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
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
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
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
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		vec3 diffuseBRDF = BRDF_EON( directLight.direction, geometryViewDir, geometryNormal, material.diffuseColor, material.diffuseRoughness ) * ( 1.0 - material.metalness );
	#else
		vec3 diffuseBRDF = BRDF_Lambert( material.diffuseContribution );
	#endif
	reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuseAlbedo = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness );
		vec3 diffuse = irradiance * RECIPROCAL_PI * diffuseAlbedo * ( 1.0 - singleScattering - multiScattering );
	#else
		vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#endif
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuse = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness ) * ( 1.0 - totalScatteringDielectric );
	#else
		vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	#endif
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Rg=`
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
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
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
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
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
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
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
	#if NUM_LIGHT_PROBE_GRIDS > 0
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		int probeGrid = - 1;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( isInsideLightProbeGrid( probeWorldPos, probeWorldNormal, probesMin[ i ], probesMax[ i ], probesResolution[ i ] ) ) probeGrid = UNROLLED_LOOP_INDEX;
		}
		#pragma unroll_loop_end
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( probeGrid == UNROLLED_LOOP_INDEX ) irradiance += getLightProbeGridIrradiance( probesSH[ i ], probesMin[ i ], probesMax[ i ], probesResolution[ i ], probeWorldPos, probeWorldNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Pg=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Ig=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Lg=`#if NUM_LIGHT_PROBE_GRIDS > 0
uniform highp sampler3D probesSH[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMin[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMax[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesResolution[ NUM_LIGHT_PROBE_GRIDS ];
bool isInsideLightProbeGrid( vec3 worldPos, vec3 worldNormal, vec3 probesMin, vec3 probesMax, vec3 probesResolution ) {
	vec3 spacing = ( probesMax - probesMin ) / probesResolution;
	vec3 samplePos = worldPos + worldNormal * spacing * 0.5;
	vec3 margin = spacing * 0.01;
	return all( greaterThanEqual( samplePos, probesMin - margin ) ) && all( lessThanEqual( samplePos, probesMax + margin ) );
}
vec3 getLightProbeGridIrradiance( highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 probeSpacing = gridRange / res;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.5 / res, 1.0 - 0.5 / res );
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,Dg=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Ng=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Ug=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Fg=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Og=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,kg=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Bg=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,zg=`#if defined( USE_POINTS_UV )
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
#endif`,Hg=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Gg=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Vg=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Wg=`#if defined( USE_MORPHCOLORS )
	#if defined( USE_COLOR_ALPHA )
		vColor *= morphTargetBaseInfluence;
	#elif defined( USE_COLOR )
		vColor.rgb *= morphTargetBaseInfluence;
	#endif
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor.rgb += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Xg=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,qg=`#ifdef USE_MORPHTARGETS
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
#endif`,Yg=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,$g=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
	#ifdef DOUBLE_SIDED
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
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Zg=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Jg=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Kg=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,jg=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,Qg=`#ifdef USE_NORMALMAP
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
#endif`,e0=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,t0=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,n0=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,i0=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,s0=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,r0=`vec3 packNormalToRGB( const in vec3 normal ) {
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
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,a0=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,o0=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,l0=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,c0=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,h0=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,u0=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,d0=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
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
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
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
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
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
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				vec2 radius = shadowRadius * texelSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float lightDistance = length( lightToPosition );
			float depthRange = shadowCameraFar - shadowCameraNear;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float depthA = - shadowCameraNear / depthRange - shadowBias;
				float depthB = shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#else
				float depthA = shadowCameraFar / depthRange + shadowBias;
				float depthB = - shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			shadow = 0.0;
			for ( int i = 0; i < 5; i ++ ) {
				vec2 offset = vogelDiskSample( i, 5, phi );
				vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
				vec3 absDirection = abs( direction );
				float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
				shadow += texture( shadowMap, vec4( direction, dp ) );
			}
			shadow *= 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,f0=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
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
#endif`,p0=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
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
#endif`,m0=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
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
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
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
}`,g0=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,x0=`#ifdef USE_SKINNING
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
#endif`,v0=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,y0=`#ifdef USE_SKINNING
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
#endif`,_0=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,b0=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,S0=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,M0=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,w0=`#ifdef USE_TRANSMISSION
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
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,E0=`#ifdef USE_TRANSMISSION
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
#endif`,T0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	varying vec2 vDiffuseRoughnessMapUv;
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
#endif`,A0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	uniform mat3 diffuseRoughnessMapTransform;
	varying vec2 vDiffuseRoughnessMapUv;
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
#endif`,C0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	vDiffuseRoughnessMapUv = ( diffuseRoughnessMapTransform * vec3( DIFFUSE_ROUGHNESSMAP_UV, 1 ) ).xy;
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
#endif`,R0=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,P0=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,I0=`uniform sampler2D t2D;
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
}`,L0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,D0=`uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <envmap_common_pars_fragment>
void main() {
	#ifdef ENVMAP_TYPE_PMREM
		vec4 texColor = textureLod( envMap, backgroundRotation * vWorldDirection, roughnessToMip( backgroundBlurriness ) );
	#else
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,N0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,U0=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,F0=`#include <common>
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
}`,O0=`#if DEPTH_PACKING == 3200
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
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,k0=`#define DISTANCE
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
}`,B0=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,z0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,H0=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,G0=`uniform float scale;
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
}`,V0=`uniform vec3 diffuse;
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
}`,W0=`#include <common>
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
}`,X0=`uniform vec3 diffuse;
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
}`,q0=`#define LAMBERT
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
}`,Y0=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
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
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
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
}`,$0=`#define MATCAP
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
}`,Z0=`#define MATCAP
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
}`,J0=`#define NORMAL
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
}`,K0=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
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
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,j0=`#define PHONG
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
}`,Q0=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
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
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
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
}`,ex=`#define STANDARD
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
}`,tx=`#define STANDARD
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
#ifdef USE_DIFFUSE_ROUGHNESS
	uniform float diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		uniform sampler2D diffuseRoughnessMap;
	#endif
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
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
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
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
}`,nx=`#define TOON
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
}`,ix=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
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
}`,sx=`uniform float size;
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
}`,rx=`uniform vec3 diffuse;
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
}`,ax=`#include <common>
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
}`,ox=`uniform vec3 color;
uniform float opacity;
#include <common>
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
	#include <premultiplied_alpha_fragment>
}`,lx=`uniform float rotation;
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
}`,cx=`uniform vec3 diffuse;
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
}`,qe={alphahash_fragment:Im,alphahash_pars_fragment:Lm,alphamap_fragment:Dm,alphamap_pars_fragment:Nm,alphatest_fragment:Um,alphatest_pars_fragment:Fm,aomap_fragment:Om,aomap_pars_fragment:km,batching_pars_vertex:Bm,batching_vertex:zm,begin_vertex:Hm,beginnormal_vertex:Gm,bsdfs:Vm,iridescence_fragment:Wm,bumpmap_pars_fragment:Xm,clipping_planes_fragment:qm,clipping_planes_pars_fragment:Ym,clipping_planes_pars_vertex:$m,clipping_planes_vertex:Zm,color_fragment:Jm,color_pars_fragment:Km,color_pars_vertex:jm,color_vertex:Qm,common:eg,defaultnormal_vertex:tg,displacementmap_pars_vertex:ng,displacementmap_vertex:ig,emissivemap_fragment:sg,emissivemap_pars_fragment:rg,colorspace_fragment:ag,colorspace_pars_fragment:og,envmap_fragment:lg,envmap_common_pars_fragment:cg,envmap_pars_fragment:hg,envmap_pars_vertex:ug,envmap_physical_pars_fragment:Sg,envmap_vertex:dg,fog_vertex:fg,fog_pars_vertex:pg,fog_fragment:mg,fog_pars_fragment:gg,gradientmap_pars_fragment:xg,lightmap_pars_fragment:vg,lights_lambert_fragment:yg,lights_lambert_pars_fragment:_g,lights_pars_begin:bg,lights_toon_fragment:Mg,lights_toon_pars_fragment:wg,lights_phong_fragment:Eg,lights_phong_pars_fragment:Tg,lights_physical_fragment:Ag,lights_physical_pars_fragment:Cg,lights_fragment_begin:Rg,lights_fragment_maps:Pg,lights_fragment_end:Ig,lightprobes_pars_fragment:Lg,logdepthbuf_fragment:Dg,logdepthbuf_pars_fragment:Ng,logdepthbuf_pars_vertex:Ug,logdepthbuf_vertex:Fg,map_fragment:Og,map_pars_fragment:kg,map_particle_fragment:Bg,map_particle_pars_fragment:zg,metalnessmap_fragment:Hg,metalnessmap_pars_fragment:Gg,morphinstance_vertex:Vg,morphcolor_vertex:Wg,morphnormal_vertex:Xg,morphtarget_pars_vertex:qg,morphtarget_vertex:Yg,normal_fragment_begin:$g,normal_fragment_maps:Zg,normal_pars_fragment:Jg,normal_pars_vertex:Kg,normal_vertex:jg,normalmap_pars_fragment:Qg,clearcoat_normal_fragment_begin:e0,clearcoat_normal_fragment_maps:t0,clearcoat_pars_fragment:n0,iridescence_pars_fragment:i0,opaque_fragment:s0,packing:r0,premultiplied_alpha_fragment:a0,project_vertex:o0,dithering_fragment:l0,dithering_pars_fragment:c0,roughnessmap_fragment:h0,roughnessmap_pars_fragment:u0,shadowmap_pars_fragment:d0,shadowmap_pars_vertex:f0,shadowmap_vertex:p0,shadowmask_pars_fragment:m0,skinbase_vertex:g0,skinning_pars_vertex:x0,skinning_vertex:v0,skinnormal_vertex:y0,specularmap_fragment:_0,specularmap_pars_fragment:b0,tonemapping_fragment:S0,tonemapping_pars_fragment:M0,transmission_fragment:w0,transmission_pars_fragment:E0,uv_pars_fragment:T0,uv_pars_vertex:A0,uv_vertex:C0,worldpos_vertex:R0,background_vert:P0,background_frag:I0,backgroundCube_vert:L0,backgroundCube_frag:D0,cube_vert:N0,cube_frag:U0,depth_vert:F0,depth_frag:O0,distance_vert:k0,distance_frag:B0,equirect_vert:z0,equirect_frag:H0,linedashed_vert:G0,linedashed_frag:V0,meshbasic_vert:W0,meshbasic_frag:X0,meshlambert_vert:q0,meshlambert_frag:Y0,meshmatcap_vert:$0,meshmatcap_frag:Z0,meshnormal_vert:J0,meshnormal_frag:K0,meshphong_vert:j0,meshphong_frag:Q0,meshphysical_vert:ex,meshphysical_frag:tx,meshtoon_vert:nx,meshtoon_frag:ix,points_vert:sx,points_frag:rx,shadow_vert:ax,shadow_frag:ox,sprite_vert:lx,sprite_frag:cx},ye={common:{diffuse:{value:new me(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Oe},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Oe}},envmap:{envMap:{value:null},envMapRotation:{value:new Oe},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Oe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Oe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Oe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Oe},normalScale:{value:new ze(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Oe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Oe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Oe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Oe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new me(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:[]},probesMin:{value:[]},probesMax:{value:[]},probesResolution:{value:[]}},points:{diffuse:{value:new me(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0},uvTransform:{value:new Oe}},sprite:{diffuse:{value:new me(16777215)},opacity:{value:1},center:{value:new ze(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Oe},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0}}},ri={basic:{uniforms:rn([ye.common,ye.specularmap,ye.envmap,ye.aomap,ye.lightmap,ye.fog]),vertexShader:qe.meshbasic_vert,fragmentShader:qe.meshbasic_frag},lambert:{uniforms:rn([ye.common,ye.specularmap,ye.envmap,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.fog,ye.lights,{emissive:{value:new me(0)},envMapIntensity:{value:1}}]),vertexShader:qe.meshlambert_vert,fragmentShader:qe.meshlambert_frag},phong:{uniforms:rn([ye.common,ye.specularmap,ye.envmap,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.fog,ye.lights,{emissive:{value:new me(0)},specular:{value:new me(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:qe.meshphong_vert,fragmentShader:qe.meshphong_frag},standard:{uniforms:rn([ye.common,ye.envmap,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.roughnessmap,ye.metalnessmap,ye.fog,ye.lights,{emissive:{value:new me(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:qe.meshphysical_vert,fragmentShader:qe.meshphysical_frag},toon:{uniforms:rn([ye.common,ye.aomap,ye.lightmap,ye.emissivemap,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.gradientmap,ye.fog,ye.lights,{emissive:{value:new me(0)}}]),vertexShader:qe.meshtoon_vert,fragmentShader:qe.meshtoon_frag},matcap:{uniforms:rn([ye.common,ye.bumpmap,ye.normalmap,ye.displacementmap,ye.fog,{matcap:{value:null}}]),vertexShader:qe.meshmatcap_vert,fragmentShader:qe.meshmatcap_frag},points:{uniforms:rn([ye.points,ye.fog]),vertexShader:qe.points_vert,fragmentShader:qe.points_frag},dashed:{uniforms:rn([ye.common,ye.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:qe.linedashed_vert,fragmentShader:qe.linedashed_frag},depth:{uniforms:rn([ye.common,ye.displacementmap]),vertexShader:qe.depth_vert,fragmentShader:qe.depth_frag},normal:{uniforms:rn([ye.common,ye.bumpmap,ye.normalmap,ye.displacementmap,{opacity:{value:1}}]),vertexShader:qe.meshnormal_vert,fragmentShader:qe.meshnormal_frag},sprite:{uniforms:rn([ye.sprite,ye.fog]),vertexShader:qe.sprite_vert,fragmentShader:qe.sprite_frag},background:{uniforms:{uvTransform:{value:new Oe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:qe.background_vert,fragmentShader:qe.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Oe}},vertexShader:qe.backgroundCube_vert,fragmentShader:qe.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:qe.cube_vert,fragmentShader:qe.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:qe.equirect_vert,fragmentShader:qe.equirect_frag},distance:{uniforms:rn([ye.common,ye.displacementmap,{referencePosition:{value:new k},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:qe.distance_vert,fragmentShader:qe.distance_frag},shadow:{uniforms:rn([ye.lights,ye.fog,{color:{value:new me(0)},opacity:{value:1}}]),vertexShader:qe.shadow_vert,fragmentShader:qe.shadow_frag}};ri.physical={uniforms:rn([ri.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Oe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Oe},clearcoatNormalScale:{value:new ze(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Oe},diffuseRoughness:{value:0},diffuseRoughnessMap:{value:null},diffuseRoughnessMapTransform:{value:new Oe},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Oe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Oe},sheen:{value:0},sheenColor:{value:new me(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Oe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Oe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Oe},transmissionSamplerSize:{value:new ze},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Oe},attenuationDistance:{value:0},attenuationColor:{value:new me(0)},specularColor:{value:new me(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Oe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Oe},anisotropyVector:{value:new ze},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Oe}}]),vertexShader:qe.meshphysical_vert,fragmentShader:qe.meshphysical_frag};var dl={r:0,b:0,g:0},hx=new Ve,zd=new Oe;zd.set(-1,0,0,0,1,0,0,0,1);function ux(i,e,t,n,s,r){let a=new me(0),o=s===!0?0:1,l,c,u=null,d=0,h=null;function m(_){let M=_.isScene===!0?_.background:null;if(M&&M.isTexture){let w=_.backgroundBlurriness>0;M=e.get(M,w)}return M}function g(_){let M=!1,w=m(_);w===null?f(a,o):w&&w.isColor&&(f(w,1),M=!0);let C=i.xr.getEnvironmentBlendMode();C==="additive"?t.buffers.color.setClear(0,0,0,1,r):C==="alpha-blend"&&t.buffers.color.setClear(0,0,0,0,r),(i.autoClear||M)&&(t.buffers.depth.setTest(!0),t.buffers.depth.setMask(!0),t.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function S(_,M){let w=m(M);w&&w.isCubeTexture?(c===void 0&&(c=new He(new mn(1,1,1),new wt({name:"BackgroundCubeMaterial",uniforms:ds(ri.backgroundCube.uniforms),vertexShader:ri.backgroundCube.vertexShader,fragmentShader:ri.backgroundCube.fragmentShader,side:Zt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(C,b,x){this.matrixWorld.copyPosition(x.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(c)),c.material.uniforms.envMap.value=w,c.material.uniforms.backgroundBlurriness.value=M.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=M.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(hx.makeRotationFromEuler(M.backgroundRotation)).transpose(),w.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(zd),c.material.toneMapped=je.getTransfer(w.colorSpace)!==lt,(u!==w||d!==w.version||h!==i.toneMapping)&&(c.material.needsUpdate=!0,u=w,d=w.version,h=i.toneMapping),c.layers.enableAll(),_.unshift(c,c.geometry,c.material,0,0,null)):w&&w.isTexture&&(l===void 0&&(l=new He(new wn(2,2),new wt({name:"BackgroundMaterial",uniforms:ds(ri.background.uniforms),vertexShader:ri.background.vertexShader,fragmentShader:ri.background.fragmentShader,side:Gi,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=w,l.material.uniforms.backgroundIntensity.value=M.backgroundIntensity,l.material.toneMapped=je.getTransfer(w.colorSpace)!==lt,w.matrixAutoUpdate===!0&&w.updateMatrix(),l.material.uniforms.uvTransform.value.copy(w.matrix),(u!==w||d!==w.version||h!==i.toneMapping)&&(l.material.needsUpdate=!0,u=w,d=w.version,h=i.toneMapping),l.layers.enableAll(),_.unshift(l,l.geometry,l.material,0,0,null))}function f(_,M){_.getRGB(dl,Xc(i)),t.buffers.color.setClear(dl.r,dl.g,dl.b,M,r)}function p(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(_,M=1){a.set(_),o=M,f(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(_){o=_,f(a,o)},render:g,addToRenderList:S,dispose:p}}function dx(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=h(null),r=s,a=!1;function o(L,N,B,D,W){let V=!1,Y=d(L,D,B,N);r!==Y&&(r=Y,c(r.object)),V=m(L,D,B,W),V&&g(L,D,B,W),W!==null&&e.update(W,i.ELEMENT_ARRAY_BUFFER),(V||a)&&(a=!1,w(L,N,B,D),W!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(W).buffer))}function l(){return i.createVertexArray()}function c(L){return i.bindVertexArray(L)}function u(L){return i.deleteVertexArray(L)}function d(L,N,B,D){let W=D.wireframe===!0,V=n[N.id];V===void 0&&(V={},n[N.id]=V);let Y=L.isInstancedMesh===!0?L.id:0,H=V[Y];H===void 0&&(H={},V[Y]=H);let F=H[B.id];F===void 0&&(F={},H[B.id]=F);let $=F[W];return $===void 0&&($=h(l()),F[W]=$),$}function h(L){let N=[],B=[],D=[];for(let W=0;W<t;W++)N[W]=0,B[W]=0,D[W]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:N,enabledAttributes:B,attributeDivisors:D,object:L,attributes:{},index:null}}function m(L,N,B,D){let W=r.attributes,V=N.attributes,Y=0,H=B.getAttributes();for(let F in H)if(H[F].location>=0){let ee=W[F],ae=V[F];if(ae===void 0&&(F==="instanceMatrix"&&L.instanceMatrix&&(ae=L.instanceMatrix),F==="instanceColor"&&L.instanceColor&&(ae=L.instanceColor)),ee===void 0||ee.attribute!==ae||ae&&ee.data!==ae.data)return!0;Y++}return r.attributesNum!==Y||r.index!==D}function g(L,N,B,D){let W={},V=N.attributes,Y=0,H=B.getAttributes();for(let F in H)if(H[F].location>=0){let ee=V[F];ee===void 0&&(F==="instanceMatrix"&&L.instanceMatrix&&(ee=L.instanceMatrix),F==="instanceColor"&&L.instanceColor&&(ee=L.instanceColor));let ae={};ae.attribute=ee,ee&&ee.data&&(ae.data=ee.data),W[F]=ae,Y++}r.attributes=W,r.attributesNum=Y,r.index=D}function S(){let L=r.newAttributes;for(let N=0,B=L.length;N<B;N++)L[N]=0}function f(L){p(L,0)}function p(L,N){let B=r.newAttributes,D=r.enabledAttributes,W=r.attributeDivisors;B[L]=1,D[L]===0&&(i.enableVertexAttribArray(L),D[L]=1),W[L]!==N&&(i.vertexAttribDivisor(L,N),W[L]=N)}function _(){let L=r.newAttributes,N=r.enabledAttributes;for(let B=0,D=N.length;B<D;B++)N[B]!==L[B]&&(i.disableVertexAttribArray(B),N[B]=0)}function M(L,N,B,D,W,V,Y){Y===!0?i.vertexAttribIPointer(L,N,B,W,V):i.vertexAttribPointer(L,N,B,D,W,V)}function w(L,N,B,D){S();let W=D.attributes,V=B.getAttributes(),Y=N.defaultAttributeValues;for(let H in V){let F=V[H];if(F.location>=0){let $=W[H];if($===void 0&&(H==="instanceMatrix"&&L.instanceMatrix&&($=L.instanceMatrix),H==="instanceColor"&&L.instanceColor&&($=L.instanceColor)),$!==void 0){let ee=$.normalized,ae=$.itemSize,ge=e.get($);if(ge===void 0)continue;let J=ge.buffer,xe=ge.type,be=ge.bytesPerElement,Ae=xe===i.INT||xe===i.UNSIGNED_INT||$.gpuType===Co;if($.isInterleavedBufferAttribute){let pe=$.data,Ue=pe.isInterleavedBuffer===!0?pe.stride:pe.itemSize,dt=$.offset;if(pe.isInstancedInterleavedBuffer||pe.isInstancedBufferAttribute){for(let Te=0;Te<F.locationSize;Te++)p(F.location+Te,pe.meshPerAttribute);L.isInstancedMesh!==!0&&D._maxInstanceCount===void 0&&(D._maxInstanceCount=pe.meshPerAttribute*pe.count)}else for(let Te=0;Te<F.locationSize;Te++)f(F.location+Te);i.bindBuffer(i.ARRAY_BUFFER,J);for(let Te=0;Te<F.locationSize;Te++)M(F.location+Te,ae/F.locationSize,xe,ee,Ue*be,(dt+ae/F.locationSize*Te)*be,Ae)}else{if($.isInstancedBufferAttribute){for(let pe=0;pe<F.locationSize;pe++)p(F.location+pe,$.meshPerAttribute);L.isInstancedMesh!==!0&&D._maxInstanceCount===void 0&&(D._maxInstanceCount=$.meshPerAttribute*$.count)}else for(let pe=0;pe<F.locationSize;pe++)f(F.location+pe);i.bindBuffer(i.ARRAY_BUFFER,J);for(let pe=0;pe<F.locationSize;pe++)M(F.location+pe,ae/F.locationSize,xe,ee,ae*be,ae/F.locationSize*pe*be,Ae)}}else if(Y!==void 0){let ee=Y[H];if(ee!==void 0)switch(ee.length){case 2:i.vertexAttrib2fv(F.location,ee);break;case 3:i.vertexAttrib3fv(F.location,ee);break;case 4:i.vertexAttrib4fv(F.location,ee);break;default:i.vertexAttrib1fv(F.location,ee)}}}}_()}function C(){A();for(let L in n){let N=n[L];for(let B in N){let D=N[B];for(let W in D){let V=D[W];for(let Y in V)u(V[Y].object),delete V[Y];delete D[W]}}delete n[L]}}function b(L){if(n[L.id]===void 0)return;let N=n[L.id];for(let B in N){let D=N[B];for(let W in D){let V=D[W];for(let Y in V)u(V[Y].object),delete V[Y];delete D[W]}}delete n[L.id]}function x(L){for(let N in n){let B=n[N];for(let D in B){let W=B[D];if(W[L.id]===void 0)continue;let V=W[L.id];for(let Y in V)u(V[Y].object),delete V[Y];delete W[L.id]}}}function v(L){for(let N in n){let B=n[N],D=L.isInstancedMesh===!0?L.id:0,W=B[D];if(W!==void 0){for(let V in W){let Y=W[V];for(let H in Y)u(Y[H].object),delete Y[H];delete W[V]}delete B[D],Object.keys(B).length===0&&delete n[N]}}}function A(){R(),a=!0,r!==s&&(r=s,c(r.object))}function R(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:o,reset:A,resetDefaultState:R,dispose:C,releaseStatesOfGeometry:b,releaseStatesOfObject:v,releaseStatesOfProgram:x,initAttributes:S,enableAttribute:f,disableUnusedAttributes:_}}function fx(i,e,t){let n;function s(l){n=l}function r(l,c){i.drawArrays(n,l,c),t.update(c,n,1)}function a(l,c,u){u!==0&&(i.drawArraysInstanced(n,l,c,u),t.update(c,n,u))}function o(l,c,u){if(u===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,c,0,u);let h=0;for(let m=0;m<u;m++)h+=c[m];t.update(h,n,1)}this.setMode=s,this.render=r,this.renderInstances=a,this.renderMultiDraw=o}function px(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let x=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(x.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function a(x){return!(x!==Xn&&n.convert(x)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(x){let v=x===hn&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(x!==sn&&x!==Pn&&!v&&n.convert(x)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE))}function l(x){if(x==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";x="mediump"}return x==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp",u=l(c);u!==c&&(Le("WebGLRenderer:",c,"not supported, using",u,"instead."),c=u);let d=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),h=t.logarithmicDepthBuffer===!0&&d===!1;t.reversedDepthBuffer===!0&&d===!1&&Le("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer."),t.logarithmicDepthBuffer===!0&&d===!0&&Le("WebGLRenderer: Logarithmic depth buffer is ignored when reversed depth buffer is enabled.");let m=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),S=i.getParameter(i.MAX_TEXTURE_SIZE),f=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),p=i.getParameter(i.MAX_VERTEX_ATTRIBS),_=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),M=i.getParameter(i.MAX_VARYING_VECTORS),w=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),C=i.getParameter(i.MAX_SAMPLES),b=i.getParameter(i.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:h,reversedDepthBuffer:d,maxTextures:m,maxVertexTextures:g,maxTextureSize:S,maxCubemapSize:f,maxAttributes:p,maxVertexUniforms:_,maxVaryings:M,maxFragmentUniforms:w,maxSamples:C,samples:b}}function mx(i){let e=this,t=null,n=0,s=!1,r=!1,a=new cn,o=new Oe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,h){let m=d.length!==0||h||n!==0||s;return s=h,n=d.length,m},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(d,h){t=u(d,h,0)},this.setState=function(d,h,m){let g=d.clippingPlanes,S=d.clipIntersection,f=d.clipShadows,p=i.get(d);if(!s||g===null||g.length===0||r&&!f)r?u(null):c();else{let _=r?0:n,M=_*4,w=p.clippingState||null;l.value=w,w=u(g,h,M,m);for(let C=0;C!==M;++C)w[C]=t[C];p.clippingState=w,this.numIntersection=S?this.numPlanes:0,this.numPlanes+=_}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function u(d,h,m,g){let S=d!==null?d.length:0,f=null;if(S!==0){if(f=l.value,g!==!0||f===null){let p=m+S*4,_=h.matrixWorldInverse;o.getNormalMatrix(_),(f===null||f.length<p)&&(f=new Float32Array(p));for(let M=0,w=m;M!==S;++M,w+=4)a.copy(d[M]).applyMatrix4(_,o),a.normal.toArray(f,w),f[w+3]=a.constant}l.value=f,l.needsUpdate=!0}return e.numPlanes=S,e.numIntersection=0,f}}var jr=class extends $t{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new Lr(s),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},s=new mn(5,5,5),r=new wt({name:"CubemapFromEquirect",uniforms:ds(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Zt,blending:ls});r.uniforms.tEquirect.value=t;let a=new He(s,r),o=t.minFilter;return t.minFilter===wi&&(t.minFilter=Wt),new $s(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,s=!0){let r=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,s);e.setRenderTarget(r)}},vd=256,gx=3,xx=20,Hd=256,Gd=16,vx=3,yx=new k,_x=new me,pl=class i{constructor(e){this._renderer=e,this._cubeSize=0,this._sourceTarget=null,this._cubeCamera=new $s(1,10,null),this._boxMesh=new He(new mn(5,5,5),null),this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null,this._integrationMaterial=null}fromScene(e,t=0,n=.1,s=100,r={}){let{size:a=256,position:o=yx}=r,l=this._renderer;this._setSize(a);let c=this._allocateTarget(),u=this._getSourceTarget(!0);t>0&&(u.texture.mipmapsAutoUpdate=!1);let d=l.autoClear,h=l.autoClearColor,m=l.autoClearDepth,g=l.autoClearStencil,S=e.background;l.autoClear=!0,l.autoClearColor=!0,l.autoClearDepth=!0,l.autoClearStencil=!0,S===null&&(e.background=l.getClearColor(_x));let f=new $s(n,s,u);return f.position.copy(o),f.update(l,e),l.autoClear=d,l.autoClearColor=h,l.autoClearDepth=m,l.autoClearStencil=g,e.background=S,t>0&&(u.texture.mipmapsAutoUpdate=!0,this._blur(c,t)),this._applyPMREM(c),c}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=bd(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=_d(),this._compileMaterial(this._equirectMaterial))}dispose(){this._sourceTarget!==null&&this._sourceTarget.dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._integrationMaterial!==null&&this._integrationMaterial.dispose(),this._boxMesh.geometry.dispose()}static lodToRoughness(e,t){return t>0?1-Math.sqrt(1-e/t):0}_setSize(e){this._cubeSize=Math.max(vd,Vc(e))}_fromTexture(e,t){e.mapping===hs||e.mapping===js?this._setSize(e.image.length===0?vd:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4);let n=t||this._allocateTarget();return this._textureToCubemap(e),this._applyPMREM(n),n}_allocateTarget(){let e=this._cubeSize,t=yd(e,!1,!1),n=Math.log2(e)-gx;for(let s=0;s<=n;s++)t.texture.mipmaps.push({width:e>>s,height:e>>s});return t.texture.name="PMREM",t.texture.isPMREMTexture=!0,t}_getSourceTarget(e=!1){let t=this._cubeSize,n=this._sourceTarget;return(n===null||n.width!==t||e&&n.depthBuffer===!1)&&(n!==null&&n.dispose(),this._sourceTarget=yd(t,!0,e)),this._sourceTarget}_compileMaterial(e){this._boxMesh.material=e,this._renderer.compile(this._boxMesh,this._cubeCamera.children[0])}_renderCube(e,t,n){let s=this._boxMesh,r=this._cubeCamera;s.material=n,r.renderTarget=e,r.activeMipmapLevel=t;let a=e.width>>t;e.viewport.set(0,0,a,a),r.update(this._renderer,s),e.viewport.set(0,0,e.width,e.height)}_textureToCubemap(e){let t;e.mapping===hs||e.mapping===js?(this._cubemapMaterial===null&&(this._cubemapMaterial=bd()),t=this._cubemapMaterial,t.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):(this._equirectMaterial===null&&(this._equirectMaterial=_d()),t=this._equirectMaterial),t.uniforms.envMap.value=e,this._renderCube(this._getSourceTarget(),0,t)}_applyPMREM(e){this._ggxMaterial===null&&(this._ggxMaterial=bx(),this._integrationMaterial=Sx());let t=this._cubeSize,n=e.texture.mipmaps.length-1,s=this._ggxMaterial.uniforms;s.envMap.value=this._sourceTarget.texture;let r=this._integrationMaterial.uniforms;r.envMap.value=this._sourceTarget.texture,r.sourceLod.value=Math.log2(t/Gd);for(let a=0;a<=n;a++){let o=i.lodToRoughness(a,n);if(a>n-vx)r.roughness.value=o,this._renderCube(e,a,this._integrationMaterial);else{let l=o>0?Math.log2(t)+.5*Math.log2(6/(Hd*Math.pow(o,4)))+.5:0;s.roughness.value=o,s.lodBias.value=l,this._renderCube(e,a,this._ggxMaterial)}}}_blur(e,t){this._blurMaterial===null&&(this._blurMaterial=Mx());let n=this._blurMaterial,s=n.uniforms,r=this._sourceTarget;s.sigma.value=Math.min(t,Math.PI)/Math.SQRT2,s.envMap.value=r.texture,this._renderCube(e,0,n),s.envMap.value=e.texture,this._renderCube(r,0,n)}};function yd(i,e,t){return new jr(i,{minFilter:wi,generateMipmaps:e,type:hn,colorSpace:Mr,depthBuffer:t})}function Qr(i,e,t){return new wt({name:i,uniforms:e,vertexShader:qe.cube_vert,fragmentShader:t,side:Zt,blending:ls,depthTest:!1,depthWrite:!1})}function bx(){return Qr("PMREMGGXConvolution",{envMap:{value:null},roughness:{value:0},lodBias:{value:0}},`

		#define GGX_SAMPLES ${Hd}u

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float lodBias;

		#include <common>

		// Van der Corput radical inverse
		float radicalInverse_VdC( uint bits ) {

			bits = ( bits << 16u ) | ( bits >> 16u );
			bits = ( ( bits & 0x55555555u ) << 1u ) | ( ( bits & 0xAAAAAAAAu ) >> 1u );
			bits = ( ( bits & 0x33333333u ) << 2u ) | ( ( bits & 0xCCCCCCCCu ) >> 2u );
			bits = ( ( bits & 0x0F0F0F0Fu ) << 4u ) | ( ( bits & 0xF0F0F0F0u ) >> 4u );
			bits = ( ( bits & 0x00FF00FFu ) << 8u ) | ( ( bits & 0xFF00FF00u ) >> 8u );
			return float( bits ) * 2.3283064365386963e-10; // / 0x100000000

		}

		// Hammersley sequence
		vec2 hammersley( uint i, uint N ) {

			return vec2( float( i ) / float( N ), radicalInverse_VdC( i ) );

		}

		void main() {

			vec3 N = normalize( vWorldDirection );

			// For very low roughness, just sample the environment directly
			if ( roughness < 0.001 ) {

				gl_FragColor = vec4( textureLod( envMap, N, 0.0 ).rgb, 1.0 );
				return;

			}

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			// Tangent space basis for VNDF sampling
			vec3 up = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, N ) );
			vec3 bitangent = cross( N, tangent );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			for ( uint i = 0u; i < GGX_SAMPLES; i ++ ) {

				vec2 Xi = hammersley( i, GGX_SAMPLES );

				// With V = N, sample the reflected direction directly.
				float invQ = 1.0 / ( 1.0 - Xi.x + alpha2 * Xi.x );
				float NdotL = ( 1.0 - Xi.x - alpha2 * Xi.x ) * invQ;

				if ( NdotL > 0.0 ) {

					float phi = 2.0 * PI * Xi.y;
					float sinTheta = 2.0 * alpha * sqrt( Xi.x * ( 1.0 - Xi.x ) ) * invQ;
					vec3 L = N * NdotL + ( tangent * cos( phi ) + bitangent * sin( phi ) ) * sinTheta;

					// Match the source mip to the sample's solid angle. The terms
					// independent of the sample are precomputed in lodBias.
					float d = alpha2 * invQ;
					float lod = max( log2( d ) + lodBias, 0.0 );

					// Weight by NdotL for the split-sum approximation
					prefilteredColor += textureLod( envMap, L, lod ).rgb * NdotL;
					totalWeight += NdotL;

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function Sx(){return Qr("PMREMGGXIntegration",{envMap:{value:null},roughness:{value:0},sourceLod:{value:0},sourceSize:{value:Gd}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float sourceLod;
		uniform int sourceSize;

		void main() {

			vec3 N = normalize( vWorldDirection );

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			float texelSize = 2.0 / float( sourceSize );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			// Pair opposite texels: only the one in N's hemisphere contributes.
			for ( int face = 0; face < 3; face ++ ) {

				for ( int y = 0; y < sourceSize; y ++ ) {

					for ( int x = 0; x < sourceSize; x ++ ) {

						vec2 uv = ( vec2( x, y ) + 0.5 ) * texelSize - 1.0;
						vec3 texelDirection = face == 0 ? vec3( 1.0, uv ) : ( face == 1 ? vec3( uv.x, 1.0, uv.y ) : vec3( uv, 1.0 ) );

						float invDistance = inversesqrt( 1.0 + dot( uv, uv ) );
						float NdotL = dot( N, texelDirection );
						texelDirection *= NdotL < 0.0 ? - 1.0 : 1.0;
						NdotL = abs( NdotL ) * invDistance;

						// With V = N, NdotH squared is ( 1 + NdotL ) / 2. Common factors
						// in the GGX distribution and texel solid angle cancel when normalized.
						float d = 1.0 + alpha2 + ( alpha2 - 1.0 ) * NdotL;
						float weight = NdotL * invDistance * invDistance * invDistance / ( d * d );

						prefilteredColor += textureLod( envMap, texelDirection, sourceLod ).rgb * weight;
						totalWeight += weight;

					}

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function Mx(){return Qr("PMREMSphericalGaussianBlur",{envMap:{value:null},sigma:{value:0}},`

		#define SAMPLES ${xx}
		#define GOLDEN_ANGLE 2.39996322973

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float sigma;

		#include <common>

		void main() {

			vec3 outputDirection = normalize( vWorldDirection );

			vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, outputDirection ) );
			vec3 bitangent = cross( outputDirection, tangent );

			// Truncate the kernel at three standard deviations or at the antipode.
			float thetaMax = min( 3.0 * sigma, PI );
			float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

			vec3 accumColor = vec3( 0.0 );
			float accumWeight = 0.0;

			for ( int i = 0; i < SAMPLES; i ++ ) {

				// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
				float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
				float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
				float phi = float( i ) * GOLDEN_ANGLE;

				vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
				vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

				// Correct the planar sample density to solid angle.
				float weight = sin( theta ) / theta;

				accumColor += weight * textureLod( envMap, sampleDirection, 0.0 ).rgb;
				accumWeight += weight;

			}

			gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

		}
	`)}function _d(){return Qr("PMREMEquirectangularToCubemap",{envMap:{value:null}},`

		varying vec3 vWorldDirection;

		uniform sampler2D envMap;

		#include <common>

		void main() {

			// Average four subpixel samples to preserve small, bright features.
			vec3 direction = normalize( vWorldDirection );
			vec3 dx = dFdx( direction ) * 0.25;
			vec3 dy = dFdy( direction ) * 0.25;

			vec3 color = textureLod( envMap, equirectUv( normalize( direction - dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction - dx + dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx + dy ) ), 0.0 ).rgb;
			gl_FragColor = vec4( color * 0.25, 1.0 );

		}
	`)}function bd(){return Qr("PMREMCubemapToCubemap",{envMap:{value:null},flipEnvMap:{value:-1}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float flipEnvMap;

		void main() {

			gl_FragColor = vec4( textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) ).rgb, 1.0 );

		}
	`)}function wx(i){let e=new WeakMap,t=new WeakMap,n=null;function s(h,m=!1){return h==null?null:m?a(h):r(h)}function r(h){if(h&&h.isTexture){let m=h.mapping;if(m===Eo||m===To)if(e.has(h)){let g=e.get(h).texture;return o(g,h.mapping)}else{let g=h.image;if(g&&g.height>0){let S=new jr(g.height);return S.fromEquirectangularTexture(i,h),e.set(h,S),h.addEventListener("dispose",c),o(S.texture,h.mapping)}else return null}}return h}function a(h){if(h&&h.isTexture&&h.isPMREMTexture!==!0){let m=h.mapping,g=m===Eo||m===To,S=m===hs||m===js;if(g||S){let f=t.get(h),p=f!==void 0?f.texture.pmremVersion:0;if(h.isRenderTargetTexture&&h.pmremVersion!==p)return n===null&&(n=new pl(i)),f=g?n.fromEquirectangular(h,f):n.fromCubemap(h,f),f.texture.pmremVersion=h.pmremVersion,t.set(h,f),f.texture;if(f!==void 0)return f.texture;{let _=h.image;return g&&_&&_.height>0||S&&_&&l(_)?(n===null&&(n=new pl(i)),f=g?n.fromEquirectangular(h):n.fromCubemap(h),f.texture.pmremVersion=h.pmremVersion,t.set(h,f),h.addEventListener("dispose",u),f.texture):null}}}return h}function o(h,m){return m===Eo?h.mapping=hs:m===To&&(h.mapping=js),h}function l(h){let m=0,g=6;for(let S=0;S<g;S++)h[S]!==void 0&&m++;return m===g}function c(h){let m=h.target;m.removeEventListener("dispose",c);let g=e.get(m);g!==void 0&&(e.delete(m),g.dispose())}function u(h){let m=h.target;m.removeEventListener("dispose",u);let g=t.get(m);g!==void 0&&(t.delete(m),g.dispose())}function d(){e=new WeakMap,t=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:s,dispose:d}}function Ex(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s=i.getExtension(n);return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&yr("WebGLRenderer: "+n+" extension not supported."),s}}}function Tx(i,e,t,n){let s={},r=new WeakMap,a=new FinalizationRegistry(g=>delete s[g]);function o(g){l(g.target)}function l(g){g.index!==null&&e.remove(g.index);for(let f in g.attributes)e.remove(g.attributes[f]);g.removeEventListener("dispose",o),delete s[g.id],a.unregister(g);let S=r.get(g);S&&(e.remove(S),r.delete(g)),n.releaseStatesOfGeometry(g),g.isInstancedBufferGeometry===!0&&delete g._maxInstanceCount,t.memory.geometries--}function c(g,S){return s[S.id]!==void 0||(S.addEventListener("dispose",o),s[S.id]=new WeakRef(S),a.register(S,S.id,S),t.memory.geometries++),S}function u(g){let S=g.attributes;for(let f in S)e.update(S[f],i.ARRAY_BUFFER)}function d(g){let S=g.index,f=g.attributes.position,p=0;if(f===void 0)return;let _=S!==null?S.array.length:f.array.length/3-1,M=f.count>=65535?Cr:Ar,w=new M(Math.ceil(_/3)*6,1),C=w.array;if(S!==null){let x=S.array;p=S.version;for(let v=0,A=0;v<_;v+=3){let R=x[v+0],L=x[v+1],N=x[v+2];C[A++]=R,C[A++]=L,C[A++]=L,C[A++]=N,C[A++]=N,C[A++]=R}}else{p=f.version;for(let x=0,v=0;x<_;x+=3){let A=x+0,R=x+1,L=x+2;C[v++]=A,C[v++]=R,C[v++]=R,C[v++]=L,C[v++]=L,C[v++]=A}}w.version=p;let b=r.get(g);b&&e.remove(b),r.set(g,w)}function h(g){let S=r.get(g);if(S){let f=g.index;f!==null&&S.version<f.version&&d(g)}else d(g);return r.get(g)}function m(){for(let g in s){let S=s[g].deref();S!==void 0&&l(S)}}return{get:c,update:u,getWireframeAttribute:h,dispose:m}}function Ax(i,e,t){let n;function s(d){n=d}let r,a;function o(d){r=d.type,a=d.bytesPerElement}function l(d,h){i.drawElements(n,h,r,d*a),t.update(h,n,1)}function c(d,h,m){m!==0&&(i.drawElementsInstanced(n,h,r,d*a,m),t.update(h,n,m))}function u(d,h,m){if(m===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,h,0,r,d,0,m);let S=0;for(let f=0;f<m;f++)S+=h[f];t.update(S,n,1)}this.setMode=s,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=u}function Cx(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(t.calls++,a){case i.TRIANGLES:t.triangles+=o*(r/3);break;case i.LINES:t.lines+=o*(r/2);break;case i.LINE_STRIP:t.lines+=o*(r-1);break;case i.LINE_LOOP:t.lines+=o*r;break;case i.POINTS:t.points+=o*r;break;default:Ne("WebGLInfo: Unknown draw mode:",a);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Rx(i,e,t){let n=new WeakMap,s=new pt;function r(a,o,l){let c=a.morphTargetInfluences,u=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,d=u!==void 0?u.length:0,h=n.get(o);if(h===void 0||h.count!==d){let A=function(){x.dispose(),n.delete(o),o.removeEventListener("dispose",A)};h!==void 0&&h.texture.dispose();let m=o.morphAttributes.position!==void 0,g=o.morphAttributes.normal!==void 0,S=o.morphAttributes.color!==void 0,f=o.morphAttributes.position||[],p=o.morphAttributes.normal||[],_=o.morphAttributes.color||[],M=0;m===!0&&(M=1),g===!0&&(M=2),S===!0&&(M=3);let w=o.attributes.position.count*M,C=1;w>e.maxTextureSize&&(C=Math.ceil(w/e.maxTextureSize),w=e.maxTextureSize);let b=new Float32Array(w*C*4*d),x=new Er(b,w,C,d);x.type=Pn,x.needsUpdate=!0;let v=M*4;for(let R=0;R<d;R++){let L=f[R],N=p[R],B=_[R],D=w*C*4*R;for(let W=0;W<L.count;W++){let V=W*v;m===!0&&(s.fromBufferAttribute(L,W),b[D+V+0]=s.x,b[D+V+1]=s.y,b[D+V+2]=s.z,b[D+V+3]=0),g===!0&&(s.fromBufferAttribute(N,W),b[D+V+4]=s.x,b[D+V+5]=s.y,b[D+V+6]=s.z,b[D+V+7]=0),S===!0&&(s.fromBufferAttribute(B,W),b[D+V+8]=s.x,b[D+V+9]=s.y,b[D+V+10]=s.z,b[D+V+11]=B.itemSize===4?s.w:1)}}h={count:d,texture:x,size:new ze(w,C)},n.set(o,h),o.addEventListener("dispose",A)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",a.morphTexture,t);else{let m=0;for(let S=0;S<c.length;S++)m+=c[S];let g=o.morphTargetsRelative?1:1-m;l.getUniforms().setValue(i,"morphTargetBaseInfluence",g),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",h.texture,t),l.getUniforms().setValue(i,"morphTargetsTextureSize",h.size)}return{update:r}}function Px(i,e,t,n,s){let r=new WeakMap;function a(c){let u=s.render.frame,d=c.geometry,h=e.get(c,d);if(r.get(h)!==u&&(e.update(h),r.set(h,u)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),r.get(c)!==u&&(t.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,i.ARRAY_BUFFER),r.set(c,u))),c.isSkinnedMesh){let m=c.skeleton;r.get(m)!==u&&(m.update(),r.set(m,u))}return h}function o(){r=new WeakMap}function l(c){let u=c.target;u.removeEventListener("dispose",l),n.releaseStatesOfObject(u),t.remove(u.instanceMatrix),u.instanceColor!==null&&t.remove(u.instanceColor)}return{update:a,dispose:o}}var Ix={[Mc]:"LINEAR_TONE_MAPPING",[wc]:"REINHARD_TONE_MAPPING",[Ec]:"CINEON_TONE_MAPPING",[Tc]:"ACES_FILMIC_TONE_MAPPING",[Cc]:"AGX_TONE_MAPPING",[Rc]:"NEUTRAL_TONE_MAPPING",[Ac]:"CUSTOM_TONE_MAPPING"};function Lx(i,e,t,n,s,r){let a=new $t(e,t,{type:i,depthBuffer:s,stencilBuffer:r,samples:n?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),o=null,l=null,c=null,u=new St;u.setAttribute("position",new Be([-1,3,0,-1,-1,0,3,-1,0],3)),u.setAttribute("uv",new Be([0,2,0,0,2,0],2));let d=new lo({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),h=new He(u,d),m=new os(-1,1,1,-1,0,1),g=null,S=null,f=!1,p,_=null,M=[],w=!1;this.setSize=function(C,b){a.setSize(C,b),o!==null&&o.setSize(C,b),l!==null&&l.setSize(C,b);for(let x=0;x<M.length;x++){let v=M[x];v.setSize&&v.setSize(C,b)}},this.setEffects=function(C){M=C,w=M.length>0&&M[0].isRenderPass===!0;let b=a.width,x=a.height;M.length>0&&o===null&&(o=new $t(b,x,{type:hn,depthBuffer:!1,stencilBuffer:!1}),l=new $t(b,x,{type:hn,depthBuffer:!1,stencilBuffer:!1}));let v=s===!0&&M.some(A=>A.needsDepthTexture===!0);v!==(a.depthTexture!==null)&&(v===!0&&c===null&&(c=new Gn(b,x),r===!0&&(c.format=Ei,c.type=us)),a.dispose(),a.depthTexture=v?c:null,a.resolveDepthBuffer=v,a.storeMultisampledDepthBuffer=v);for(let A=0;A<M.length;A++){let R=M[A];R.setSize&&R.setSize(b,x),v&&R.needsDepthTexture===!0&&R.setDepthTexture&&R.setDepthTexture(c)}},this.begin=function(C,b){if(f||C.toneMapping===ii&&M.length===0)return!1;if(_=b,b!==null){let x=b.width,v=b.height;(a.width!==x||a.height!==v)&&this.setSize(x,v)}return w===!1&&C.setRenderTarget(a),p=C.toneMapping,C.toneMapping=ii,!0},this.hasRenderPass=function(){return w},this.end=function(C,b){C.toneMapping=p,f=!0;let x=a,v=o;for(let A=0;A<M.length;A++){let R=M[A];R.enabled!==!1&&(R.render(C,v,x,b),R.needsSwap!==!1&&(x=v,v=v===o?l:o))}if(g!==C.outputColorSpace||S!==C.toneMapping){g=C.outputColorSpace,S=C.toneMapping,d.defines={},je.getTransfer(g)===lt&&(d.defines.SRGB_TRANSFER="");let A=Ix[S];A&&(d.defines[A]=""),d.needsUpdate=!0}d.uniforms.tDiffuse.value=x.texture,C.setRenderTarget(_),C.render(h,m),_=null,f=!1},this.isCompositing=function(){return f},this.dispose=function(){a.dispose(),o!==null&&o.dispose(),l!==null&&l.dispose(),u.dispose(),d.dispose()}}var Vd=new nn,Wd=new Gn(1,1),Xd=new Dr(1),qd=new Er,Yd=new eo,$d=new Lr,Sd=[],Md=[],wd=new Float32Array(16),Ed=new Float32Array(9),Td=new Float32Array(4);function ir(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=Sd[s];if(r===void 0&&(r=new Float32Array(s),Sd[s]=r),e!==0){n.toArray(r,0);for(let a=1,o=0;a!==e;++a)o+=t,i[a].toArray(r,o)}return r}function kt(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function Bt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function gl(i,e){let t=Md[e];t===void 0&&(t=new Int32Array(e),Md[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Dx(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function Nx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;i.uniform2fv(this.addr,e),Bt(t,e)}}function Ux(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(kt(t,e))return;i.uniform3fv(this.addr,e),Bt(t,e)}}function Fx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;i.uniform4fv(this.addr,e),Bt(t,e)}}function Ox(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(kt(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),Bt(t,e)}else{if(kt(t,n))return;Td.set(n),i.uniformMatrix2fv(this.addr,!1,Td),Bt(t,n)}}function kx(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(kt(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),Bt(t,e)}else{if(kt(t,n))return;Ed.set(n),i.uniformMatrix3fv(this.addr,!1,Ed),Bt(t,n)}}function Bx(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(kt(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),Bt(t,e)}else{if(kt(t,n))return;wd.set(n),i.uniformMatrix4fv(this.addr,!1,wd),Bt(t,n)}}function zx(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Hx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;i.uniform2iv(this.addr,e),Bt(t,e)}}function Gx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(kt(t,e))return;i.uniform3iv(this.addr,e),Bt(t,e)}}function Vx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;i.uniform4iv(this.addr,e),Bt(t,e)}}function Wx(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function Xx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(kt(t,e))return;i.uniform2uiv(this.addr,e),Bt(t,e)}}function qx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(kt(t,e))return;i.uniform3uiv(this.addr,e),Bt(t,e)}}function Yx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(kt(t,e))return;i.uniform4uiv(this.addr,e),Bt(t,e)}}function xl(i){return i.version===0&&(i.compareFunction=Bc,i.needsUpdate=!0),i}function $x(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?r=xl(Wd):r=Vd,t.setTexture2D(e||r,s)}function Zx(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||Yd,s)}function Jx(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_CUBE_SHADOW?r=xl(Xd):r=$d,t.setTextureCube(e||r,s)}function Kx(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||qd,s)}function jx(i){switch(i){case 5126:return Dx;case 35664:return Nx;case 35665:return Ux;case 35666:return Fx;case 35674:return Ox;case 35675:return kx;case 35676:return Bx;case 5124:case 35670:return zx;case 35667:case 35671:return Hx;case 35668:case 35672:return Gx;case 35669:case 35673:return Vx;case 5125:return Wx;case 36294:return Xx;case 36295:return qx;case 36296:return Yx;case 35678:case 36198:case 36298:case 36306:case 35682:return $x;case 35679:case 36299:case 36307:return Zx;case 35680:case 36300:case 36308:case 36293:return Jx;case 36289:case 36303:case 36311:case 36292:return Kx}}function Qx(i,e){i.uniform1fv(this.addr,e)}function ev(i,e){let t=ir(e,this.size,2);i.uniform2fv(this.addr,t)}function tv(i,e){let t=ir(e,this.size,3);i.uniform3fv(this.addr,t)}function nv(i,e){let t=ir(e,this.size,4);i.uniform4fv(this.addr,t)}function iv(i,e){let t=ir(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function sv(i,e){let t=ir(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function rv(i,e){let t=ir(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function av(i,e){i.uniform1iv(this.addr,e)}function ov(i,e){i.uniform2iv(this.addr,e)}function lv(i,e){i.uniform3iv(this.addr,e)}function cv(i,e){i.uniform4iv(this.addr,e)}function hv(i,e){i.uniform1uiv(this.addr,e)}function uv(i,e){i.uniform2uiv(this.addr,e)}function dv(i,e){i.uniform3uiv(this.addr,e)}function fv(i,e){i.uniform4uiv(this.addr,e)}function pv(i,e,t){let n=this.cache,s=e.length,r=gl(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));let a;this.type===i.SAMPLER_2D_SHADOW?a=xl(Wd):a=Vd;for(let o=0;o!==s;++o)t.setTexture2D(e[o]||a,r[o])}function mv(i,e,t){let n=this.cache,s=e.length,r=gl(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));for(let a=0;a!==s;++a)t.setTexture3D(e[a]||Yd,r[a])}function gv(i,e,t){let n=this.cache,s=e.length,r=gl(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));let a;this.type===i.SAMPLER_CUBE_SHADOW?a=xl(Xd):a=$d;for(let o=0;o!==s;++o)t.setTextureCube(e[o]||a,r[o])}function xv(i,e,t){let n=this.cache,s=e.length,r=gl(t,s);kt(n,r)||(i.uniform1iv(this.addr,r),Bt(n,r));for(let a=0;a!==s;++a)t.setTexture2DArray(e[a]||qd,r[a])}function vv(i){switch(i){case 5126:return Qx;case 35664:return ev;case 35665:return tv;case 35666:return nv;case 35674:return iv;case 35675:return sv;case 35676:return rv;case 5124:case 35670:return av;case 35667:case 35671:return ov;case 35668:case 35672:return lv;case 35669:case 35673:return cv;case 5125:return hv;case 36294:return uv;case 36295:return dv;case 36296:return fv;case 35678:case 36198:case 36298:case 36306:case 35682:return pv;case 35679:case 36299:case 36307:return mv;case 35680:case 36300:case 36308:case 36293:return gv;case 36289:case 36303:case 36311:case 36292:return xv}}var Kc=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=jx(t.type)}},jc=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=vv(t.type)}},Qc=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,a=s.length;r!==a;++r){let o=s[r];o.setValue(e,t[o.id],n)}}},Zc=/(\w+)(\])?(\[|\.)?/g;function Ad(i,e){i.seq.push(e),i.map[e.id]=e}function yv(i,e,t){let n=i.name,s=n.length;for(Zc.lastIndex=0;;){let r=Zc.exec(n),a=Zc.lastIndex,o=r[1],l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===s){Ad(t,c===void 0?new Kc(o,i,e):new jc(o,i,e));break}else{let d=t.map[o];d===void 0&&(d=new Qc(o),Ad(t,d)),t=d}}}var nr=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let a=0;a<n;++a){let o=e.getActiveUniform(t,a),l=e.getUniformLocation(t,o.name);yv(o,l,this)}let s=[],r=[];for(let a of this.seq)a.type===e.SAMPLER_2D_SHADOW||a.type===e.SAMPLER_CUBE_SHADOW||a.type===e.SAMPLER_2D_ARRAY_SHADOW?s.push(a):r.push(a);s.length>0&&(this.seq=s.concat(r))}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,a=t.length;r!==a;++r){let o=t[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let a=e[s];a.id in t&&n.push(a)}return n}};function Cd(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var _v=37297,bv=0;function Sv(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let a=s;a<r;a++){let o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}var Rd=new Oe;function Mv(i){je._getMatrix(Rd,je.workingColorSpace,i);let e=`mat3( ${Rd.elements.map(t=>t.toFixed(4))} )`;switch(je.getTransfer(i)){case wr:return[e,"LinearTransferOETF"];case lt:return[e,"sRGBTransferOETF"];default:return Le("WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function Pd(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),r=(i.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";let a=/ERROR: 0:(\d+)/.exec(r);if(a){let o=parseInt(a[1]);return t.toUpperCase()+`

`+r+`

`+Sv(i.getShaderSource(e),o)}else return r}function wv(i,e){let t=Mv(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( ${t[0]} * value.rgb, value.a ) );`,"}"].join(`
`)}var Ev={[Mc]:"Linear",[wc]:"Reinhard",[Ec]:"Cineon",[Tc]:"ACESFilmic",[Cc]:"AgX",[Rc]:"Neutral",[Ac]:"Custom"};function Tv(i,e){let t=Ev[e];return t===void 0?(Le("WebGLProgram: Unsupported toneMapping:",e),"vec3 "+i+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var fl=new k;function Av(){je.getLuminanceCoefficients(fl);let i=fl.x.toFixed(4),e=fl.y.toFixed(4),t=fl.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Cv(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Kr).join(`
`)}function Rv(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Pv(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),a=r.name,o=1;r.type===i.FLOAT_MAT2&&(o=2),r.type===i.FLOAT_MAT3&&(o=3),r.type===i.FLOAT_MAT4&&(o=4),t[a]={type:r.type,location:i.getAttribLocation(e,a),locationSize:o}}return t}function Kr(i){return i!==""}function Id(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_SUN_LIGHTS/g,e.numSunLights).replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,e.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows).replace(/NUM_LIGHT_PROBE_GRIDS/g,e.numLightProbeGrids)}function Ld(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Iv=/^[ \t]*#include +<([\w\d./]+)>/gm;function eh(i){return i.replace(Iv,Lv)}function Lv(i,e){let t=qe[e];if(t===void 0)throw new Error("THREE.WebGLProgram: Can not resolve #include <"+e+">");return eh(t)}var Dv=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Dd(i){return i.replace(Dv,Nv)}function Nv(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function Nd(i){let e=`precision ${i.precision} float;
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
#define LOW_PRECISION`),e}var Uv={[Wn]:"SHADOWMAP_TYPE_PCF",[Zs]:"SHADOWMAP_TYPE_VSM"};function Fv(i){return Uv[i.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var Ov={[js]:"ENVMAP_MODE_REFRACTION"};function kv(i){return i.envMap===!1?"ENVMAP_MODE_REFLECTION":Ov[i.envMapMode]||"ENVMAP_MODE_REFLECTION"}var Bv={[wo]:"ENVMAP_BLENDING_MULTIPLY",[Ku]:"ENVMAP_BLENDING_MIX",[ju]:"ENVMAP_BLENDING_ADD"};function zv(i){return i.envMap===!1?"ENVMAP_BLENDING_NONE":Bv[i.combine]||"ENVMAP_BLENDING_NONE"}function Hv(i,e,t,n){let s=i.getContext(),r=t.defines,a=t.vertexShader,o=t.fragmentShader,l=Fv(t),c=t.envMapPMREM===!0?"ENVMAP_TYPE_PMREM":"ENVMAP_TYPE_CUBE",u=kv(t),d=zv(t),h=Cv(t),m=Rv(r),g=s.createProgram(),S,f,p=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(S=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(Kr).join(`
`),S.length>0&&(S+=`
`),f=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(Kr).join(`
`),f.length>0&&(f+=`
`)):(S=[Nd(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.diffuseRoughnessMapUv?"#define DIFFUSE_ROUGHNESSMAP_UV "+t.diffuseRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexNormals?"#define HAS_NORMAL":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Kr).join(`
`),f=[Nd(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+u:"",t.envMap?"#define "+d:"",t.envMapPMREM?"#define ENVMAP_MAX_LOD "+t.envMapMaxLod+".0":"",t.envMapPMREM?"#define ENVMAP_SIZE "+t.envMapSize+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.diffuseRoughness?"#define USE_DIFFUSE_ROUGHNESS":"",t.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.retroreflection?"#define USE_RETROREFLECTION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas||t.batchingColor?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==ii?"#define TONE_MAPPING":"",t.toneMapping!==ii?qe.tonemapping_pars_fragment:"",t.toneMapping!==ii?Tv("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",qe.colorspace_pars_fragment,wv("linearToOutputTexel",t.outputColorSpace),Av(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Kr).join(`
`)),a=eh(a),a=Id(a,t),a=Ld(a,t),o=eh(o),o=Id(o,t),o=Ld(o,t),a=Dd(a),o=Dd(o),t.isRawShaderMaterial!==!0&&(p=`#version 300 es
`,S=[h,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+S,f=["#define varying in",t.glslVersion===zc?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===zc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+f);let _=p+S+a,M=p+f+o,w=Cd(s,s.VERTEX_SHADER,_),C=Cd(s,s.FRAGMENT_SHADER,M);s.attachShader(g,w),s.attachShader(g,C),t.index0AttributeName!==void 0?s.bindAttribLocation(g,0,t.index0AttributeName):t.hasPositionAttribute===!0&&s.bindAttribLocation(g,0,"position"),s.linkProgram(g);function b(R){if(i.debug.checkShaderErrors){let L=s.getProgramInfoLog(g)||"",N=s.getShaderInfoLog(w)||"",B=s.getShaderInfoLog(C)||"",D=L.trim(),W=N.trim(),V=B.trim(),Y=!0,H=!0;if(s.getProgramParameter(g,s.LINK_STATUS)===!1)if(Y=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,g,w,C);else{let F=Pd(s,w,"vertex"),$=Pd(s,C,"fragment");Ne("WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(g,s.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+D+`
`+F+`
`+$)}else D!==""?Le("WebGLProgram: Program Info Log:",D):(W===""||V==="")&&(H=!1);H&&(R.diagnostics={runnable:Y,programLog:D,vertexShader:{log:W,prefix:S},fragmentShader:{log:V,prefix:f}})}s.deleteShader(w),s.deleteShader(C),x=new nr(s,g),v=Pv(s,g)}let x;this.getUniforms=function(){return x===void 0&&b(this),x};let v;this.getAttributes=function(){return v===void 0&&b(this),v};let A=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return A===!1&&(A=s.getProgramParameter(g,_v)),A},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(g),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=bv++,this.cacheKey=e,this.usedTimes=1,this.program=g,this.vertexShader=w,this.fragmentShader=C,this}var Gv=0,th=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let s=this._getShaderCacheForMaterial(e);return s.has(t)===!1&&(s.add(t),t.usedTimes++),s.has(n)===!1&&(s.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new nh(e),t.set(e,n)),n}},nh=class{constructor(e){this.id=Gv++,this.code=e,this.usedTimes=0}};function Vv(i){return i===Vi||i===$r||i===Zr}function Wv(i,e,t,n,s,r){let a=new Xs,o=new th,l=new Set,c=[],u=new Map,d=n.logarithmicDepthBuffer,h={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function m(x){return l.add(x),x===0?"uv":`uv${x}`}function g(x,v,A,R,L,N){let B=R.fog,D=L.geometry,W=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?R.environment:null,V=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,Y=e.get(x.envMap||W,V),H=h[x.type],F=n.precision;x.precision!==null&&(F=n.getMaxPrecision(x.precision),F!==x.precision&&Le("WebGLProgram.getParameters:",x.precision,"not supported, using",F,"instead."));let $=D.morphAttributes.position||D.morphAttributes.normal||D.morphAttributes.color,ee=$!==void 0?$.length:0,ae=0;D.morphAttributes.position!==void 0&&(ae=1),D.morphAttributes.normal!==void 0&&(ae=2),D.morphAttributes.color!==void 0&&(ae=3);let ge,J,xe,be;if(H){let ve=ri[H];ge=ve.vertexShader,J=ve.fragmentShader}else{ge=x.vertexShader,J=x.fragmentShader;let ve=o.getVertexShaderStage(x),ct=o.getFragmentShaderStage(x);o.update(x,ve,ct),xe=ve.id,be=ct.id}let Ae=i.getRenderTarget(),pe=i.state.buffers.depth.getReversed(),Ue=L.isInstancedMesh===!0,dt=L.isBatchedMesh===!0,Te=!!x.map,st=!!x.matcap,tt=!!Y,Ye=tt&&Y.isPMREMTexture===!0,Dt=!!x.aoMap,Mt=!!x.lightMap,qt=!!x.bumpMap&&x.wireframe===!1,mt=!!x.normalMap,_n=!!x.displacementMap,yt=!!x.emissiveMap,fn=!!x.metalnessMap,an=!!x.roughnessMap,on=x.anisotropy>0,z=x.clearcoat>0,Ft=x.diffuseRoughness>0,nt=x.dispersion>0,ot=x.retroreflectivity>0,de=x.iridescence>0,Et=x.sheen>0,Ie=x.transmission>0,Fe=on&&!!x.anisotropyMap,I=z&&!!x.clearcoatMap,E=z&&!!x.clearcoatNormalMap,P=z&&!!x.clearcoatRoughnessMap,q=Ft&&!!x.diffuseRoughnessMap,K=de&&!!x.iridescenceMap,ie=de&&!!x.iridescenceThicknessMap,oe=Et&&!!x.sheenColorMap,Q=Et&&!!x.sheenRoughnessMap,te=!!x.specularMap,ce=!!x.specularColorMap,U=!!x.specularIntensityMap,ne=Ie&&!!x.transmissionMap,j=Ie&&!!x.thicknessMap,he=!!x.gradientMap,re=!!x.alphaMap,le=x.alphaTest>0,Ce=!!x.alphaHash,Xe=!!x.extensions,se=ii;x.toneMapped&&(Ae===null||Ae.isXRRenderTarget===!0)&&(se=i.toneMapping);let Pe=Ye?Y.isCompressedCubeTexture?Y.image[0].mipmaps:Y.mipmaps:null,Ge={shaderID:H,shaderType:x.type,shaderName:x.name,vertexShader:ge,fragmentShader:J,defines:x.defines,customVertexShaderID:xe,customFragmentShaderID:be,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:F,batching:dt,batchingColor:dt&&L._colorsTexture!==null,instancing:Ue,instancingColor:Ue&&L.instanceColor!==null,instancingMorph:Ue&&L.morphTexture!==null,outputColorSpace:Ae===null?i.outputColorSpace:Ae.isXRRenderTarget===!0?Ae.texture.colorSpace:je.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:Te,matcap:st,envMap:tt,envMapMode:tt&&Y.mapping,envMapPMREM:Ye,envMapMaxLod:Ye?Pe.length-1:null,envMapSize:Ye?Pe[0].width:null,aoMap:Dt,lightMap:Mt,bumpMap:qt,normalMap:mt,displacementMap:_n,emissiveMap:yt,normalMapObjectSpace:mt&&x.normalMapType===td,normalMapTangentSpace:mt&&x.normalMapType===hl,packedNormalMap:mt&&x.normalMapType===hl&&Vv(x.normalMap.format),metalnessMap:fn,roughnessMap:an,anisotropy:on,anisotropyMap:Fe,clearcoat:z,clearcoatMap:I,clearcoatNormalMap:E,clearcoatRoughnessMap:P,diffuseRoughness:Ft,diffuseRoughnessMap:q,dispersion:nt,retroreflection:ot,iridescence:de,iridescenceMap:K,iridescenceThicknessMap:ie,sheen:Et,sheenColorMap:oe,sheenRoughnessMap:Q,specularMap:te,specularColorMap:ce,specularIntensityMap:U,transmission:Ie,transmissionMap:ne,thicknessMap:j,gradientMap:he,opaque:x.transparent===!1&&x.blending===Js&&x.alphaToCoverage===!1,alphaMap:re,alphaTest:le,alphaHash:Ce,combine:x.combine,mapUv:Te&&m(x.map.channel),aoMapUv:Dt&&m(x.aoMap.channel),lightMapUv:Mt&&m(x.lightMap.channel),bumpMapUv:qt&&m(x.bumpMap.channel),normalMapUv:mt&&m(x.normalMap.channel),displacementMapUv:_n&&m(x.displacementMap.channel),emissiveMapUv:yt&&m(x.emissiveMap.channel),metalnessMapUv:fn&&m(x.metalnessMap.channel),roughnessMapUv:an&&m(x.roughnessMap.channel),anisotropyMapUv:Fe&&m(x.anisotropyMap.channel),clearcoatMapUv:I&&m(x.clearcoatMap.channel),clearcoatNormalMapUv:E&&m(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:P&&m(x.clearcoatRoughnessMap.channel),diffuseRoughnessMapUv:q&&m(x.diffuseRoughnessMap.channel),iridescenceMapUv:K&&m(x.iridescenceMap.channel),iridescenceThicknessMapUv:ie&&m(x.iridescenceThicknessMap.channel),sheenColorMapUv:oe&&m(x.sheenColorMap.channel),sheenRoughnessMapUv:Q&&m(x.sheenRoughnessMap.channel),specularMapUv:te&&m(x.specularMap.channel),specularColorMapUv:ce&&m(x.specularColorMap.channel),specularIntensityMapUv:U&&m(x.specularIntensityMap.channel),transmissionMapUv:ne&&m(x.transmissionMap.channel),thicknessMapUv:j&&m(x.thicknessMap.channel),alphaMapUv:re&&m(x.alphaMap.channel),vertexTangents:!!D.attributes.tangent&&(mt||on),vertexNormals:!!D.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!D.attributes.color&&D.attributes.color.itemSize===4,pointsUvs:L.isPoints===!0&&!!D.attributes.uv&&(Te||re),fog:!!B,useFog:x.fog===!0,fogExp2:!!B&&B.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||D.attributes.normal===void 0&&mt===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:pe,skinning:L.isSkinnedMesh===!0,hasPositionAttribute:D.attributes.position!==void 0,morphTargets:D.morphAttributes.position!==void 0,morphNormals:D.morphAttributes.normal!==void 0,morphColors:D.morphAttributes.color!==void 0,morphTargetsCount:ee,morphTextureStride:ae,numSunLights:v.sun.length,numDirLights:v.directional.length,numPointLights:v.point.length,numSpotLights:v.spot.length,numSpotLightMaps:v.spotLightMap.length,numRectAreaLights:v.rectArea.length,numHemiLights:v.hemi.length,numSunLightShadows:v.sunShadowMap.length,numDirLightShadows:v.directionalShadowMap.length,numPointLightShadows:v.pointShadowMap.length,numSpotLightShadows:v.spotShadowMap.length,numSpotLightShadowsWithMaps:v.numSpotLightShadowsWithMaps,numLightProbes:v.numLightProbes,numLightProbeGrids:N.filter(ve=>ve.texture!==null).length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:x.dithering,shadowMapEnabled:i.shadowMap.enabled&&A.length>0,shadowMapType:i.shadowMap.type,toneMapping:se,decodeVideoTexture:Te&&x.map.isVideoTexture===!0&&je.getTransfer(x.map.colorSpace)===lt,decodeVideoTextureEmissive:yt&&x.emissiveMap.isVideoTexture===!0&&je.getTransfer(x.emissiveMap.colorSpace)===lt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===Rn,flipSided:x.side===Zt,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:Xe&&x.extensions.clipCullDistance===!0&&t.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Xe&&x.extensions.multiDraw===!0||dt)&&t.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:t.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return Ge.vertexUv1s=l.has(1),Ge.vertexUv2s=l.has(2),Ge.vertexUv3s=l.has(3),l.clear(),Ge}function S(x){let v=[];if(x.shaderID?v.push(x.shaderID):(v.push(x.customVertexShaderID),v.push(x.customFragmentShaderID)),x.defines!==void 0)for(let A in x.defines)v.push(A),v.push(x.defines[A]);return x.isRawShaderMaterial===!1&&(f(v,x),p(v,x),v.push(i.outputColorSpace)),v.push(x.customProgramCacheKey),v.join()}function f(x,v){x.push(v.precision),x.push(v.outputColorSpace),x.push(v.envMapMode),x.push(v.envMapPMREM),x.push(v.envMapMaxLod),x.push(v.envMapSize),x.push(v.mapUv),x.push(v.alphaMapUv),x.push(v.lightMapUv),x.push(v.aoMapUv),x.push(v.bumpMapUv),x.push(v.normalMapUv),x.push(v.displacementMapUv),x.push(v.emissiveMapUv),x.push(v.metalnessMapUv),x.push(v.roughnessMapUv),x.push(v.anisotropyMapUv),x.push(v.clearcoatMapUv),x.push(v.clearcoatNormalMapUv),x.push(v.clearcoatRoughnessMapUv),x.push(v.diffuseRoughnessMapUv),x.push(v.iridescenceMapUv),x.push(v.iridescenceThicknessMapUv),x.push(v.sheenColorMapUv),x.push(v.sheenRoughnessMapUv),x.push(v.specularMapUv),x.push(v.specularColorMapUv),x.push(v.specularIntensityMapUv),x.push(v.transmissionMapUv),x.push(v.thicknessMapUv),x.push(v.combine),x.push(v.fogExp2),x.push(v.sizeAttenuation),x.push(v.morphTargetsCount),x.push(v.numSunLights),x.push(v.numDirLights),x.push(v.numPointLights),x.push(v.numSpotLights),x.push(v.numSpotLightMaps),x.push(v.numHemiLights),x.push(v.numRectAreaLights),x.push(v.numSunLightShadows),x.push(v.numDirLightShadows),x.push(v.numPointLightShadows),x.push(v.numSpotLightShadows),x.push(v.numSpotLightShadowsWithMaps),x.push(v.numLightProbes),x.push(v.numLightProbeGrids),x.push(v.shadowMapType),x.push(v.toneMapping),x.push(v.numClippingPlanes),x.push(v.numClipIntersection),x.push(v.depthPacking)}function p(x,v){a.disableAll(),v.instancing&&a.enable(0),v.instancingColor&&a.enable(1),v.instancingMorph&&a.enable(2),v.matcap&&a.enable(3),v.envMap&&a.enable(4),v.normalMapObjectSpace&&a.enable(5),v.normalMapTangentSpace&&a.enable(6),v.clearcoat&&a.enable(7),v.iridescence&&a.enable(8),v.alphaTest&&a.enable(9),v.vertexColors&&a.enable(10),v.vertexAlphas&&a.enable(11),v.vertexUv1s&&a.enable(12),v.vertexUv2s&&a.enable(13),v.vertexUv3s&&a.enable(14),v.vertexTangents&&a.enable(15),v.anisotropy&&a.enable(16),v.alphaHash&&a.enable(17),v.batching&&a.enable(18),v.dispersion&&a.enable(19),v.retroreflection&&a.enable(24),v.diffuseRoughness&&a.enable(25),v.batchingColor&&a.enable(20),v.gradientMap&&a.enable(21),v.packedNormalMap&&a.enable(22),v.vertexNormals&&a.enable(23),x.push(a.mask),a.disableAll(),v.fog&&a.enable(0),v.useFog&&a.enable(1),v.flatShading&&a.enable(2),v.logarithmicDepthBuffer&&a.enable(3),v.reversedDepthBuffer&&a.enable(4),v.skinning&&a.enable(5),v.morphTargets&&a.enable(6),v.morphNormals&&a.enable(7),v.morphColors&&a.enable(8),v.premultipliedAlpha&&a.enable(9),v.shadowMapEnabled&&a.enable(10),v.doubleSided&&a.enable(11),v.flipSided&&a.enable(12),v.useDepthPacking&&a.enable(13),v.dithering&&a.enable(14),v.transmission&&a.enable(15),v.sheen&&a.enable(16),v.opaque&&a.enable(17),v.pointsUvs&&a.enable(18),v.decodeVideoTexture&&a.enable(19),v.decodeVideoTextureEmissive&&a.enable(20),v.alphaToCoverage&&a.enable(21),v.numLightProbeGrids>0&&a.enable(22),v.hasPositionAttribute&&a.enable(23),x.push(a.mask)}function _(x){let v=h[x.type],A;if(v){let R=ri[v];A=ul.clone(R.uniforms)}else A=x.uniforms;return A}function M(x,v){let A=u.get(v);return A!==void 0?++A.usedTimes:(A=new Hv(i,v,x,s),c.push(A),u.set(v,A)),A}function w(x){if(--x.usedTimes===0){let v=c.indexOf(x);c[v]=c[c.length-1],c.pop(),u.delete(x.cacheKey),x.destroy()}}function C(x){o.remove(x)}function b(){o.dispose()}return{getParameters:g,getProgramCacheKey:S,getUniforms:_,acquireProgram:M,releaseProgram:w,releaseShaderCache:C,programs:c,dispose:b}}function Xv(){let i=new WeakMap;function e(a){return i.has(a)}function t(a){let o=i.get(a);return o===void 0&&(o={},i.set(a,o)),o}function n(a){i.delete(a)}function s(a,o,l){i.get(a)[o]=l}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function qv(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.materialVariant!==e.materialVariant?i.materialVariant-e.materialVariant:i.z!==e.z?i.z-e.z:i.id-e.id}function Ud(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function Fd(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function a(h){let m=0;return h.isInstancedMesh&&(m+=2),h.isSkinnedMesh&&(m+=1),m}function o(h,m,g,S,f,p){let _=i[e];return _===void 0?(_={id:h.id,object:h,geometry:m,material:g,materialVariant:a(h),groupOrder:S,renderOrder:h.renderOrder,z:f,group:p},i[e]=_):(_.id=h.id,_.object=h,_.geometry=m,_.material=g,_.materialVariant=a(h),_.groupOrder=S,_.renderOrder=h.renderOrder,_.z=f,_.group=p),e++,_}function l(h,m,g,S,f,p,_){_.reversedDepth===!0&&(f=-f);let M=o(h,m,g,S,f,p);g.transmission>0?n.push(M):g.transparent===!0?s.push(M):t.push(M)}function c(h,m,g,S,f,p){let _=o(h,m,g,S,f,p);g.transmission>0?n.unshift(_):g.transparent===!0?s.unshift(_):t.unshift(_)}function u(h,m){t.length>1&&t.sort(h||qv),n.length>1&&n.sort(m||Ud),s.length>1&&s.sort(m||Ud)}function d(){for(let h=e,m=i.length;h<m;h++){let g=i[h];if(g.id===null)break;g.id=null,g.object=null,g.geometry=null,g.material=null,g.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:l,unshift:c,finish:d,sort:u}}function Yv(){let i=new WeakMap;function e(n,s){let r=i.get(n),a;return r===void 0?(a=new Fd,i.set(n,[a])):s>=r.length?(a=new Fd,r.push(a)):a=r[s],a}function t(){i=new WeakMap}return{get:e,dispose:t}}function $v(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"SunLight":case"DirectionalLight":t={direction:new k,color:new me};break;case"SpotLight":t={position:new k,direction:new k,color:new me,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new k,color:new me,distance:0,decay:0};break;case"HemisphereLight":t={direction:new k,skyColor:new me,groundColor:new me};break;case"RectAreaLight":t={color:new me,position:new k,halfWidth:new k,halfHeight:new k};break}return i[e.id]=t,t}}}function Zv(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"SunLight":case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ze};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ze};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new ze,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var Jv=0;function Kv(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function jv(i){let e=new $v,t=Zv(),n={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new k);let s=new k,r=new Ve,a=new Ve;function o(c){let u=0,d=0,h=0;for(let N=0;N<9;N++)n.probe[N].set(0,0,0);let m=0,g=0,S=0,f=0,p=0,_=0,M=0,w=0,C=0,b=0,x=0,v=0,A=0,R=0;c.sort(Kv);for(let N=0,B=c.length;N<B;N++){let D=c[N],W=D.color,V=D.intensity,Y=D.distance,H=null;if(D.shadow&&D.shadow.map&&(D.shadow.map.texture.format===Vi?H=D.shadow.map.texture:H=D.shadow.map.depthTexture||D.shadow.map.texture),D.isAmbientLight)u+=W.r*V,d+=W.g*V,h+=W.b*V;else if(D.isLightProbe){for(let F=0;F<9;F++)n.probe[F].addScaledVector(D.sh.coefficients[F],V);R++}else if(D.isSunLight){let F=e.get(D);if(F.color.copy(D.color).multiplyScalar(D.intensity),D.castShadow){let $=D.shadow,ee=t.get(D);ee.shadowIntensity=$.intensity,ee.shadowBias=$.bias,ee.shadowNormalBias=$.normalBias,ee.shadowRadius=$.radius,ee.shadowMapSize.copy($.mapSize).multiply($.getFrameExtents()),n.sunShadow[g]=ee,n.sunShadowMap[g]=H;let ae=$.getViewportCount();for(let ge=0;ge<ae;ge++)n.sunShadowMatrix[S+ge]=$.getMatrix(ge),n.sunShadowCascade[S+ge]=$._cascadeData[ge];S+=ae,g++}n.sun[m]=F,m++}else if(D.isDirectionalLight){let F=e.get(D);if(F.color.copy(D.color).multiplyScalar(D.intensity),D.castShadow){let $=D.shadow,ee=t.get(D);ee.shadowIntensity=$.intensity,ee.shadowBias=$.bias,ee.shadowNormalBias=$.normalBias,ee.shadowRadius=$.radius,ee.shadowMapSize=$.mapSize,n.directionalShadow[f]=ee,n.directionalShadowMap[f]=H,n.directionalShadowMatrix[f]=D.shadow.matrix,C++}n.directional[f]=F,f++}else if(D.isSpotLight){let F=e.get(D);F.position.setFromMatrixPosition(D.matrixWorld),F.color.copy(W).multiplyScalar(V),F.distance=Y,F.coneCos=Math.cos(D.angle),F.penumbraCos=Math.cos(D.angle*(1-D.penumbra)),F.decay=D.decay,n.spot[_]=F;let $=D.shadow;if(D.map&&(n.spotLightMap[v]=D.map,v++,$.updateMatrices(D),D.castShadow&&A++),n.spotLightMatrix[_]=$.matrix,D.castShadow){let ee=t.get(D);ee.shadowIntensity=$.intensity,ee.shadowBias=$.bias,ee.shadowNormalBias=$.normalBias,ee.shadowRadius=$.radius,ee.shadowMapSize=$.mapSize,n.spotShadow[_]=ee,n.spotShadowMap[_]=H,x++}_++}else if(D.isRectAreaLight){let F=e.get(D);F.color.copy(W).multiplyScalar(V),F.halfWidth.set(D.width*.5,0,0),F.halfHeight.set(0,D.height*.5,0),n.rectArea[M]=F,M++}else if(D.isPointLight){let F=e.get(D);if(F.color.copy(D.color).multiplyScalar(D.intensity),F.distance=D.distance,F.decay=D.decay,D.castShadow){let $=D.shadow,ee=t.get(D);ee.shadowIntensity=$.intensity,ee.shadowBias=$.bias,ee.shadowNormalBias=$.normalBias,ee.shadowRadius=$.radius,ee.shadowMapSize=$.mapSize,ee.shadowCameraNear=$.camera.near,ee.shadowCameraFar=$.camera.far,n.pointShadow[p]=ee,n.pointShadowMap[p]=H,n.pointShadowMatrix[p]=D.shadow.matrix,b++}n.point[p]=F,p++}else if(D.isHemisphereLight){let F=e.get(D);F.skyColor.copy(D.color).multiplyScalar(V),F.groundColor.copy(D.groundColor).multiplyScalar(V),n.hemi[w]=F,w++}}M>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=ye.LTC_FLOAT_1,n.rectAreaLTC2=ye.LTC_FLOAT_2):(n.rectAreaLTC1=ye.LTC_HALF_1,n.rectAreaLTC2=ye.LTC_HALF_2)),n.ambient[0]=u,n.ambient[1]=d,n.ambient[2]=h;let L=n.hash;(L.sunLength!==m||L.directionalLength!==f||L.pointLength!==p||L.spotLength!==_||L.rectAreaLength!==M||L.hemiLength!==w||L.numSunShadows!==g||L.numDirectionalShadows!==C||L.numPointShadows!==b||L.numSpotShadows!==x||L.numSpotMaps!==v||L.numLightProbes!==R)&&(n.sun.length=m,n.directional.length=f,n.spot.length=_,n.rectArea.length=M,n.point.length=p,n.hemi.length=w,n.sunShadow.length=g,n.sunShadowMap.length=g,n.sunShadowMatrix.length=S,n.sunShadowCascade.length=S,n.directionalShadow.length=C,n.directionalShadowMap.length=C,n.directionalShadowMatrix.length=C,n.pointShadow.length=b,n.pointShadowMap.length=b,n.pointShadowMatrix.length=b,n.spotShadow.length=x,n.spotShadowMap.length=x,n.spotLightMatrix.length=x+v-A,n.spotLightMap.length=v,n.numSpotLightShadowsWithMaps=A,n.numLightProbes=R,L.sunLength=m,L.directionalLength=f,L.pointLength=p,L.spotLength=_,L.rectAreaLength=M,L.hemiLength=w,L.numSunShadows=g,L.numDirectionalShadows=C,L.numPointShadows=b,L.numSpotShadows=x,L.numSpotMaps=v,L.numLightProbes=R,n.version=Jv++)}function l(c,u){let d=0,h=0,m=0,g=0,S=0,f=0,p=u.matrixWorldInverse;for(let _=0,M=c.length;_<M;_++){let w=c[_];if(w.isSunLight){let C=n.sun[d];C.direction.setFromMatrixPosition(w.matrixWorld),C.direction.transformDirection(p),d++}else if(w.isDirectionalLight){let C=n.directional[h];C.direction.setFromMatrixPosition(w.matrixWorld),s.setFromMatrixPosition(w.target.matrixWorld),C.direction.sub(s),C.direction.transformDirection(p),h++}else if(w.isSpotLight){let C=n.spot[g];C.position.setFromMatrixPosition(w.matrixWorld),C.position.applyMatrix4(p),C.direction.setFromMatrixPosition(w.matrixWorld),s.setFromMatrixPosition(w.target.matrixWorld),C.direction.sub(s),C.direction.transformDirection(p),g++}else if(w.isRectAreaLight){let C=n.rectArea[S];C.position.setFromMatrixPosition(w.matrixWorld),C.position.applyMatrix4(p),a.identity(),r.copy(w.matrixWorld),r.premultiply(p),a.extractRotation(r),C.halfWidth.set(w.width*.5,0,0),C.halfHeight.set(0,w.height*.5,0),C.halfWidth.applyMatrix4(a),C.halfHeight.applyMatrix4(a),S++}else if(w.isPointLight){let C=n.point[m];C.position.setFromMatrixPosition(w.matrixWorld),C.position.applyMatrix4(p),m++}else if(w.isHemisphereLight){let C=n.hemi[f];C.direction.setFromMatrixPosition(w.matrixWorld),C.direction.transformDirection(p),f++}}}return{setup:o,setupView:l,state:n}}function Od(i){let e=new jv(i),t=[],n=[],s=[];function r(d){u.camera=d,t.length=0,n.length=0,s.length=0}function a(d){d.isLightProbeGrid?s.push(d):t.push(d)}function o(d){n.push(d)}function l(){e.setup(t),s.sort((d,h)=>d.priority-h.priority||d.id-h.id)}function c(d){e.setupView(t,d)}let u={lightsArray:t,shadowsArray:n,lightProbeGridArray:s,camera:null,lights:e,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:u,setupLights:l,setupLightsView:c,pushLight:a,pushShadow:o}}function Qv(i){let e=new WeakMap;function t(s,r=0){let a=e.get(s),o;return a===void 0?(o=new Od(i),e.set(s,[o])):r>=a.length?(o=new Od(i),a.push(o)):o=a[r],o}function n(){e=new WeakMap}return{get:t,dispose:n}}var ey=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,ty=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,ny=[new k(1,0,0),new k(-1,0,0),new k(0,1,0),new k(0,-1,0),new k(0,0,1),new k(0,0,-1)],iy=[new k(0,-1,0),new k(0,-1,0),new k(0,0,1),new k(0,0,-1),new k(0,-1,0),new k(0,-1,0)],kd=new Ve,Jr=new k,Jc=new k;function sy(i,e,t){let n=new ki,s=new ze,r=new ze,a=new pt,o=new co,l=new ho,c={},u=t.maxTextureSize,d={[Gi]:Zt,[Zt]:Gi,[Rn]:Rn},h=new wt({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new ze},radius:{value:4}},vertexShader:ey,fragmentShader:ty}),m=h.clone();m.defines.HORIZONTAL_PASS=1;let g=new St;g.setAttribute("position",new zn(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let S=new He(g,h),f=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Wn;let p=this.type;this.render=function(b,x,v){if(f.enabled===!1||f.autoUpdate===!1&&f.needsUpdate===!1||b.length===0)return;this.type===Lu&&(Le("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=Wn);let A=i.getRenderTarget(),R=i.getActiveCubeFace(),L=i.getActiveMipmapLevel(),N=i.state;N.setBlending(ls),N.buffers.depth.getReversed()===!0?N.buffers.color.setClear(0,0,0,0):N.buffers.color.setClear(1,1,1,1),N.buffers.depth.setTest(!0),N.setScissorTest(!1);let B=p!==this.type;B&&x.traverse(function(D){D.material&&(Array.isArray(D.material)?D.material.forEach(W=>W.needsUpdate=!0):D.material.needsUpdate=!0)});for(let D=0,W=b.length;D<W;D++){let V=b[D],Y=V.shadow;if(Y===void 0){Le("WebGLShadowMap:",V,"has no shadow.");continue}if(Y.autoUpdate===!1&&Y.needsUpdate===!1)continue;s.copy(Y.mapSize);let H=Y.getFrameExtents();s.multiply(H),r.copy(Y.mapSize),(s.x>u||s.y>u)&&(s.x>u&&(r.x=Math.floor(u/H.x),s.x=r.x*H.x,Y.mapSize.x=r.x),s.y>u&&(r.y=Math.floor(u/H.y),s.y=r.y*H.y,Y.mapSize.y=r.y));let F=i.state.buffers.depth.getReversed();if(Y.camera._reversedDepth=F,Y.map===null||B===!0){if(Y.map!==null&&(Y.map.depthTexture!==null&&(Y.map.depthTexture.dispose(),Y.map.depthTexture=null),Y.map.dispose()),this.type===Zs){if(V.isPointLight){Le("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}Y.map=new $t(s.x,s.y,{format:Vi,type:hn,minFilter:Wt,magFilter:Wt,generateMipmaps:!1}),Y.map.texture.name=V.name+".shadowMap",Y.map.depthTexture=new Gn(s.x,s.y,Pn),Y.map.depthTexture.name=V.name+".shadowMapDepth",Y.map.depthTexture.format=vi,Y.map.depthTexture.compareFunction=null,Y.map.depthTexture.minFilter=Pt,Y.map.depthTexture.magFilter=Pt}else V.isPointLight?(Y.map=new jr(s.x),Y.map.depthTexture=new Dr(s.x,Tn)):(Y.map=new $t(s.x,s.y),Y.map.depthTexture=new Gn(s.x,s.y,Tn)),Y.map.depthTexture.name=V.name+".shadowMap",Y.map.depthTexture.format=vi,this.type===Wn?(Y.map.depthTexture.compareFunction=F?kc:Oc,Y.map.depthTexture.minFilter=Wt,Y.map.depthTexture.magFilter=Wt):(Y.map.depthTexture.compareFunction=null,Y.map.depthTexture.minFilter=Pt,Y.map.depthTexture.magFilter=Pt);Y.camera.updateProjectionMatrix()}Y.map.isWebGLCubeRenderTarget!==!0&&(Y.map.width!==s.x||Y.map.height!==s.y)&&Y.map.setSize(s.x,s.y);let $=Y.map.isWebGLCubeRenderTarget?6:Y.getViewportCount();V.isPointLight!==!0&&Y.updateMatrices(V,v);let ee=(Y.camera.layers.mask&4294967294)!==0?Y.camera.layers:v.layers;for(let ae=0;ae<$;ae++){let ge=Y.getCamera(ae);if(V.isPointLight){let J=Y.camera,xe=Y.matrix,be=V.distance||J.far;be!==J.far&&(J.far=be,J.updateProjectionMatrix()),Jr.setFromMatrixPosition(V.matrixWorld),J.position.copy(Jr),Jc.copy(J.position),Jc.add(ny[ae]),J.up.copy(iy[ae]),J.lookAt(Jc),J.updateMatrixWorld(),xe.makeTranslation(-Jr.x,-Jr.y,-Jr.z),kd.multiplyMatrices(J.projectionMatrix,J.matrixWorldInverse),Y._frustum.setFromProjectionMatrix(kd,J.coordinateSystem,J.reversedDepth)}if(Y.map.isWebGLCubeRenderTarget)i.setRenderTarget(Y.map,ae),i.clear();else{ae===0&&(i.setRenderTarget(Y.map),i.clear());let J=Y.getViewport(ae);a.set(r.x*J.x,r.y*J.y,r.x*J.z,r.y*J.w),N.viewport(a)}n=Y.getFrustum(ae),w(x,v,ge,V,ee,this.type)}Y.isPointLightShadow!==!0&&this.type===Zs&&_(Y,v),Y.needsUpdate=!1}p=this.type,f.needsUpdate=!1,i.setRenderTarget(A,R,L)};function _(b,x){let v=e.update(S);h.defines.VSM_SAMPLES!==b.blurSamples&&(h.defines.VSM_SAMPLES=b.blurSamples,m.defines.VSM_SAMPLES=b.blurSamples,h.needsUpdate=!0,m.needsUpdate=!0),b.mapPass===null?b.mapPass=new $t(s.x,s.y,{format:Vi,type:hn}):(b.mapPass.width!==b.map.width||b.mapPass.height!==b.map.height)&&b.mapPass.setSize(b.map.width,b.map.height),h.uniforms.shadow_pass.value=b.map.depthTexture,h.uniforms.resolution.value.set(b.map.width,b.map.height),h.uniforms.radius.value=b.radius,i.setRenderTarget(b.mapPass),i.clear(),i.renderBufferDirect(x,null,v,h,S,null),m.uniforms.shadow_pass.value=b.mapPass.texture,m.uniforms.resolution.value.set(b.map.width,b.map.height),m.uniforms.radius.value=b.radius,i.setRenderTarget(b.map),i.clear(),i.renderBufferDirect(x,null,v,m,S,null)}function M(b,x,v,A){let R=null,L=v.isPointLight===!0?b.customDistanceMaterial:b.customDepthMaterial;if(L!==void 0)R=L;else if(R=v.isPointLight===!0?l:o,i.localClippingEnabled&&x.clipShadows===!0&&Array.isArray(x.clippingPlanes)&&x.clippingPlanes.length!==0||x.displacementMap&&x.displacementScale!==0||x.alphaMap&&x.alphaTest>0||x.map&&x.alphaTest>0||x.alphaToCoverage===!0){let N=R.uuid,B=x.uuid,D=c[N];D===void 0&&(D={},c[N]=D);let W=D[B];W===void 0&&(W=R.clone(),D[B]=W,x.addEventListener("dispose",C)),R=W}if(R.visible=x.visible,R.wireframe=x.wireframe,A===Zs?R.side=x.shadowSide!==null?x.shadowSide:x.side:R.side=x.shadowSide!==null?x.shadowSide:d[x.side],R.alphaMap=x.alphaMap,R.alphaTest=x.alphaToCoverage===!0?.5:x.alphaTest,R.map=x.map,R.clipShadows=x.clipShadows,R.clippingPlanes=x.clippingPlanes,R.clipIntersection=x.clipIntersection,R.displacementMap=x.displacementMap,R.displacementScale=x.displacementScale,R.displacementBias=x.displacementBias,R.wireframeLinewidth=x.wireframeLinewidth,R.linewidth=x.linewidth,v.isPointLight===!0&&R.isMeshDistanceMaterial===!0){let N=i.properties.get(R);N.light=v}return R}function w(b,x,v,A,R,L){if(b.visible===!1)return;if(b.layers.test(R)&&(b.isMesh||b.isLine||b.isPoints)&&(b.castShadow||b.receiveShadow&&L===Zs)&&(!b.frustumCulled||b.intersectsFrustum(n))){b.modelViewMatrix.multiplyMatrices(v.matrixWorldInverse,b.matrixWorld);let D=e.update(b),W=b.material;if(Array.isArray(W)){let V=D.groups;for(let Y=0,H=V.length;Y<H;Y++){let F=V[Y],$=W[F.materialIndex];if($&&$.visible){let ee=M(b,$,A,L);b.onBeforeShadow(i,b,x,v,D,ee,F),i.renderBufferDirect(v,null,D,ee,b,F),b.onAfterShadow(i,b,x,v,D,ee,F)}}}else if(W.visible){let V=M(b,W,A,L);b.onBeforeShadow(i,b,x,v,D,V,null),i.renderBufferDirect(v,null,D,V,b,null),b.onAfterShadow(i,b,x,v,D,V,null)}}let B=b.children;for(let D=0,W=B.length;D<W;D++)w(B[D],x,v,A,R,L)}function C(b){b.target.removeEventListener("dispose",C);for(let v in c){let A=c[v],R=b.target.uuid;R in A&&(A[R].dispose(),delete A[R])}}}function ry(i,e){function t(){let U=!1,ne=new pt,j=null,he=new pt(0,0,0,0);return{setMask:function(re){j!==re&&!U&&(i.colorMask(re,re,re,re),j=re)},setLocked:function(re){U=re},setClear:function(re,le,Ce,Xe,se){se===!0&&(re*=Xe,le*=Xe,Ce*=Xe),ne.set(re,le,Ce,Xe),he.equals(ne)===!1&&(i.clearColor(re,le,Ce,Xe),he.copy(ne))},reset:function(){U=!1,j=null,he.set(-1,0,0,0)}}}function n(){let U=!1,ne=!1,j=null,he=null,re=null;return{setReversed:function(le){if(ne!==le){let Ce=e.get("EXT_clip_control");le?Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.ZERO_TO_ONE_EXT):Ce.clipControlEXT(Ce.LOWER_LEFT_EXT,Ce.NEGATIVE_ONE_TO_ONE_EXT),ne=le;let Xe=re;re=null,this.setClear(Xe)}},getReversed:function(){return ne},setTest:function(le){le?pe(i.DEPTH_TEST):Ue(i.DEPTH_TEST)},setMask:function(le){j!==le&&!U&&(i.depthMask(le),j=le)},setFunc:function(le){if(ne&&(le=dd[le]),he!==le){switch(le){case Ga:i.depthFunc(i.NEVER);break;case Va:i.depthFunc(i.ALWAYS);break;case Wa:i.depthFunc(i.LESS);break;case Bs:i.depthFunc(i.LEQUAL);break;case Xa:i.depthFunc(i.EQUAL);break;case qa:i.depthFunc(i.GEQUAL);break;case Ya:i.depthFunc(i.GREATER);break;case $a:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}he=le}},setLocked:function(le){U=le},setClear:function(le){re!==le&&(re=le,ne&&(le=1-le),i.clearDepth(le))},reset:function(){U=!1,j=null,he=null,re=null,ne=!1}}}function s(){let U=!1,ne=null,j=null,he=null,re=null,le=null,Ce=null,Xe=null,se=null;return{setTest:function(Pe){U||(Pe?pe(i.STENCIL_TEST):Ue(i.STENCIL_TEST))},setMask:function(Pe){ne!==Pe&&!U&&(i.stencilMask(Pe),ne=Pe)},setFunc:function(Pe,Ge,ve){(j!==Pe||he!==Ge||re!==ve)&&(i.stencilFunc(Pe,Ge,ve),j=Pe,he=Ge,re=ve)},setOp:function(Pe,Ge,ve){(le!==Pe||Ce!==Ge||Xe!==ve)&&(i.stencilOp(Pe,Ge,ve),le=Pe,Ce=Ge,Xe=ve)},setLocked:function(Pe){U=Pe},setClear:function(Pe){se!==Pe&&(i.clearStencil(Pe),se=Pe)},reset:function(){U=!1,ne=null,j=null,he=null,re=null,le=null,Ce=null,Xe=null,se=null}}}let r=new t,a=new n,o=new s,l={},c=new WeakMap,u={},d={},h={},m=new WeakMap,g=[],S=null,f=!1,p=null,_=null,M=null,w=null,C=null,b=null,x=null,v=new me(0,0,0),A=0,R=!1,L=null,N=null,B=null,D=null,W=null,V=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),Y=!1,H=0,F=i.getParameter(i.VERSION);F.indexOf("WebGL")!==-1?(H=parseFloat(/^WebGL (\d)/.exec(F)[1]),Y=H>=1):F.indexOf("OpenGL ES")!==-1&&(H=parseFloat(/^OpenGL ES (\d)/.exec(F)[1]),Y=H>=2);let $=null,ee={},ae=i.getParameter(i.SCISSOR_BOX),ge=i.getParameter(i.VIEWPORT),J=new pt().fromArray(ae),xe=new pt().fromArray(ge);function be(U,ne,j,he){let re=new Uint8Array(4),le=i.createTexture();i.bindTexture(U,le),i.texParameteri(U,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(U,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ce=0;Ce<j;Ce++)U===i.TEXTURE_3D||U===i.TEXTURE_2D_ARRAY?i.texImage3D(ne,0,i.RGBA,1,1,he,0,i.RGBA,i.UNSIGNED_BYTE,re):i.texImage2D(ne+Ce,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,re);return le}let Ae={};Ae[i.TEXTURE_2D]=be(i.TEXTURE_2D,i.TEXTURE_2D,1),Ae[i.TEXTURE_CUBE_MAP]=be(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),Ae[i.TEXTURE_2D_ARRAY]=be(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),Ae[i.TEXTURE_3D]=be(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),pe(i.DEPTH_TEST),a.setFunc(Bs),qt(!1),mt(vc),pe(i.CULL_FACE),Dt(ls);function pe(U){u[U]!==!0&&(i.enable(U),u[U]=!0)}function Ue(U){u[U]!==!1&&(i.disable(U),u[U]=!1)}function dt(U,ne){return h[U]!==ne?(i.bindFramebuffer(U,ne),h[U]=ne,U===i.DRAW_FRAMEBUFFER&&(h[i.FRAMEBUFFER]=ne),U===i.FRAMEBUFFER&&(h[i.DRAW_FRAMEBUFFER]=ne),!0):!1}function Te(U,ne){let j=g,he=!1;if(U){j=m.get(ne),j===void 0&&(j=[],m.set(ne,j));let re=U.textures;if(j.length!==re.length||j[0]!==i.COLOR_ATTACHMENT0){for(let le=0,Ce=re.length;le<Ce;le++)j[le]=i.COLOR_ATTACHMENT0+le;j.length=re.length,he=!0}}else j[0]!==i.BACK&&(j[0]=i.BACK,he=!0);he&&i.drawBuffers(j)}function st(U){return S!==U?(i.useProgram(U),S=U,!0):!1}let tt={[cs]:i.FUNC_ADD,[Nu]:i.FUNC_SUBTRACT,[Uu]:i.FUNC_REVERSE_SUBTRACT};tt[Fu]=i.MIN,tt[Ou]=i.MAX;let Ye={[ku]:i.ZERO,[Bu]:i.ONE,[zu]:i.SRC_COLOR,[bc]:i.SRC_ALPHA,[qu]:i.SRC_ALPHA_SATURATE,[Wu]:i.DST_COLOR,[Gu]:i.DST_ALPHA,[Hu]:i.ONE_MINUS_SRC_COLOR,[Sc]:i.ONE_MINUS_SRC_ALPHA,[Xu]:i.ONE_MINUS_DST_COLOR,[Vu]:i.ONE_MINUS_DST_ALPHA,[Yu]:i.CONSTANT_COLOR,[$u]:i.ONE_MINUS_CONSTANT_COLOR,[Zu]:i.CONSTANT_ALPHA,[Ju]:i.ONE_MINUS_CONSTANT_ALPHA};function Dt(U,ne,j,he,re,le,Ce,Xe,se,Pe){if(U===ls){f===!0&&(Ue(i.BLEND),f=!1);return}if(f===!1&&(pe(i.BLEND),f=!0),U!==Du){if(U!==p||Pe!==R){if((_!==cs||C!==cs)&&(i.blendEquation(i.FUNC_ADD),_=cs,C=cs),Pe)switch(U){case Js:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Ks:i.blendFunc(i.ONE,i.ONE);break;case yc:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case _c:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:Ne("WebGLState: Invalid blending: ",U);break}else switch(U){case Js:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Ks:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case yc:Ne("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case _c:Ne("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Ne("WebGLState: Invalid blending: ",U);break}M=null,w=null,b=null,x=null,v.set(0,0,0),A=0,p=U,R=Pe}return}re=re||ne,le=le||j,Ce=Ce||he,(ne!==_||re!==C)&&(i.blendEquationSeparate(tt[ne],tt[re]),_=ne,C=re),(j!==M||he!==w||le!==b||Ce!==x)&&(i.blendFuncSeparate(Ye[j],Ye[he],Ye[le],Ye[Ce]),M=j,w=he,b=le,x=Ce),(Xe.equals(v)===!1||se!==A)&&(i.blendColor(Xe.r,Xe.g,Xe.b,se),v.copy(Xe),A=se),p=U,R=!1}function Mt(U,ne){U.side===Rn?Ue(i.CULL_FACE):pe(i.CULL_FACE);let j=U.side===Zt;ne&&(j=!j),qt(j),U.blending===Js&&U.transparent===!1?Dt(ls):Dt(U.blending,U.blendEquation,U.blendSrc,U.blendDst,U.blendEquationAlpha,U.blendSrcAlpha,U.blendDstAlpha,U.blendColor,U.blendAlpha,U.premultipliedAlpha),a.setFunc(U.depthFunc),a.setTest(U.depthTest),a.setMask(U.depthWrite),r.setMask(U.colorWrite);let he=U.stencilWrite;o.setTest(he),he&&(o.setMask(U.stencilWriteMask),o.setFunc(U.stencilFunc,U.stencilRef,U.stencilFuncMask),o.setOp(U.stencilFail,U.stencilZFail,U.stencilZPass)),yt(U.polygonOffset,U.polygonOffsetFactor,U.polygonOffsetUnits),U.alphaToCoverage===!0?pe(i.SAMPLE_ALPHA_TO_COVERAGE):Ue(i.SAMPLE_ALPHA_TO_COVERAGE)}function qt(U){L!==U&&(U?i.frontFace(i.CW):i.frontFace(i.CCW),L=U)}function mt(U){U!==Pu?(pe(i.CULL_FACE),U!==N&&(U===vc?i.cullFace(i.BACK):U===Iu?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Ue(i.CULL_FACE),N=U}function _n(U){U!==B&&(Y&&i.lineWidth(U),B=U)}function yt(U,ne,j){U?(pe(i.POLYGON_OFFSET_FILL),(D!==ne||W!==j)&&(D=ne,W=j,a.getReversed()&&(ne=-ne,j=-j),i.polygonOffset(ne,j))):Ue(i.POLYGON_OFFSET_FILL)}function fn(U){U?pe(i.SCISSOR_TEST):Ue(i.SCISSOR_TEST)}function an(U){U===void 0&&(U=i.TEXTURE0+V-1),$!==U&&(i.activeTexture(U),$=U)}function on(U,ne,j){j===void 0&&($===null?j=i.TEXTURE0+V-1:j=$);let he=ee[j];he===void 0&&(he={type:void 0,texture:void 0},ee[j]=he),(he.type!==U||he.texture!==ne)&&($!==j&&(i.activeTexture(j),$=j),i.bindTexture(U,ne||Ae[U]),he.type=U,he.texture=ne)}function z(){let U=ee[$];U!==void 0&&U.type!==void 0&&(i.bindTexture(U.type,null),U.type=void 0,U.texture=void 0)}function Ft(){try{i.compressedTexImage2D(...arguments)}catch(U){Ne("WebGLState:",U)}}function nt(){try{i.compressedTexImage3D(...arguments)}catch(U){Ne("WebGLState:",U)}}function ot(){try{i.texSubImage2D(...arguments)}catch(U){Ne("WebGLState:",U)}}function de(){try{i.texSubImage3D(...arguments)}catch(U){Ne("WebGLState:",U)}}function Et(){try{i.compressedTexSubImage2D(...arguments)}catch(U){Ne("WebGLState:",U)}}function Ie(){try{i.compressedTexSubImage3D(...arguments)}catch(U){Ne("WebGLState:",U)}}function Fe(){try{i.texStorage2D(...arguments)}catch(U){Ne("WebGLState:",U)}}function I(){try{i.texStorage3D(...arguments)}catch(U){Ne("WebGLState:",U)}}function E(){try{i.texImage2D(...arguments)}catch(U){Ne("WebGLState:",U)}}function P(){try{i.texImage3D(...arguments)}catch(U){Ne("WebGLState:",U)}}function q(U){return d[U]!==void 0?d[U]:i.getParameter(U)}function K(U,ne){d[U]!==ne&&(i.pixelStorei(U,ne),d[U]=ne)}function ie(U){J.equals(U)===!1&&(i.scissor(U.x,U.y,U.z,U.w),J.copy(U))}function oe(U){xe.equals(U)===!1&&(i.viewport(U.x,U.y,U.z,U.w),xe.copy(U))}function Q(U,ne){let j=c.get(ne);j===void 0&&(j=new WeakMap,c.set(ne,j));let he=j.get(U);he===void 0&&(he=i.getUniformBlockIndex(ne,U.name),i.uniformBlockBinding(ne,he,he),j.set(U,he))}function te(U,ne,j){let re=c.get(ne).get(U);l[re]!==j&&(i.bindBufferBase(i.UNIFORM_BUFFER,re,j),l[re]=j)}function ce(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),a.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),i.pixelStorei(i.PACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_ALIGNMENT,4),i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,!1),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,i.BROWSER_DEFAULT_WEBGL),i.pixelStorei(i.PACK_ROW_LENGTH,0),i.pixelStorei(i.PACK_SKIP_PIXELS,0),i.pixelStorei(i.PACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_ROW_LENGTH,0),i.pixelStorei(i.UNPACK_IMAGE_HEIGHT,0),i.pixelStorei(i.UNPACK_SKIP_PIXELS,0),i.pixelStorei(i.UNPACK_SKIP_ROWS,0),i.pixelStorei(i.UNPACK_SKIP_IMAGES,0),u={},d={},$=null,ee={},h={},l={},m=new WeakMap,g=[],S=null,f=!1,p=null,_=null,M=null,w=null,C=null,b=null,x=null,v=new me(0,0,0),A=0,R=!1,L=null,N=null,B=null,D=null,W=null,J.set(0,0,i.canvas.width,i.canvas.height),xe.set(0,0,i.canvas.width,i.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:pe,disable:Ue,bindFramebuffer:dt,drawBuffers:Te,useProgram:st,setBlending:Dt,setMaterial:Mt,setFlipSided:qt,setCullFace:mt,setLineWidth:_n,setPolygonOffset:yt,setScissorTest:fn,activeTexture:an,bindTexture:on,unbindTexture:z,compressedTexImage2D:Ft,compressedTexImage3D:nt,texImage2D:E,texImage3D:P,pixelStorei:K,getParameter:q,updateUBOMapping:Q,uniformBlockBinding:te,texStorage2D:Fe,texStorage3D:I,texSubImage2D:ot,texSubImage3D:de,compressedTexSubImage2D:Et,compressedTexSubImage3D:Ie,scissor:ie,viewport:oe,reset:ce}}function ay(i,e,t,n,s,r,a){let o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new ze,u=new WeakMap,d=new Set,h,m=new WeakMap,g=new Set,S=new FinalizationRegistry(I=>g.delete(I)),f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function p(I,E){return f?new OffscreenCanvas(I,E):Hs("canvas")}function _(I,E,P){let q=1,K=Fe(I);if((K.width>P||K.height>P)&&(q=P/Math.max(K.width,K.height)),q<1)if(typeof HTMLImageElement<"u"&&I instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&I instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&I instanceof ImageBitmap||typeof VideoFrame<"u"&&I instanceof VideoFrame){let ie=Math.floor(q*K.width),oe=Math.floor(q*K.height);h===void 0&&(h=p(ie,oe));let Q=E?p(ie,oe):h;return Q.width=ie,Q.height=oe,Q.getContext("2d").drawImage(I,0,0,ie,oe),Le("WebGLRenderer: Texture has been resized from ("+K.width+"x"+K.height+") to ("+ie+"x"+oe+")."),Q}else return"data"in I&&Le("WebGLRenderer: Image in DataTexture is too big ("+K.width+"x"+K.height+")."),I;return I}function M(I){return I.generateMipmaps}function w(I){i.generateMipmap(I)}function C(I){return I.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:I.isWebGL3DRenderTarget?i.TEXTURE_3D:I.isWebGLArrayRenderTarget||I.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function b(I,E,P,q,K,ie=!1){if(I!==null){if(i[I]!==void 0)return i[I];Le("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+I+"'")}let oe;q&&(oe=e.get("EXT_texture_norm16"),oe||Le("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Q=E;if(E===i.RED&&(P===i.FLOAT&&(Q=i.R32F),P===i.HALF_FLOAT&&(Q=i.R16F),P===i.UNSIGNED_BYTE&&(Q=i.R8),P===i.UNSIGNED_SHORT&&oe&&(Q=oe.R16_EXT),P===i.SHORT&&oe&&(Q=oe.R16_SNORM_EXT)),E===i.RED_INTEGER&&(P===i.UNSIGNED_BYTE&&(Q=i.R8UI),P===i.UNSIGNED_SHORT&&(Q=i.R16UI),P===i.UNSIGNED_INT&&(Q=i.R32UI),P===i.BYTE&&(Q=i.R8I),P===i.SHORT&&(Q=i.R16I),P===i.INT&&(Q=i.R32I)),E===i.RG&&(P===i.FLOAT&&(Q=i.RG32F),P===i.HALF_FLOAT&&(Q=i.RG16F),P===i.UNSIGNED_BYTE&&(Q=i.RG8),P===i.UNSIGNED_SHORT&&oe&&(Q=oe.RG16_EXT),P===i.SHORT&&oe&&(Q=oe.RG16_SNORM_EXT)),E===i.RG_INTEGER&&(P===i.UNSIGNED_BYTE&&(Q=i.RG8UI),P===i.UNSIGNED_SHORT&&(Q=i.RG16UI),P===i.UNSIGNED_INT&&(Q=i.RG32UI),P===i.BYTE&&(Q=i.RG8I),P===i.SHORT&&(Q=i.RG16I),P===i.INT&&(Q=i.RG32I)),E===i.RGB_INTEGER&&(P===i.UNSIGNED_BYTE&&(Q=i.RGB8UI),P===i.UNSIGNED_SHORT&&(Q=i.RGB16UI),P===i.UNSIGNED_INT&&(Q=i.RGB32UI),P===i.BYTE&&(Q=i.RGB8I),P===i.SHORT&&(Q=i.RGB16I),P===i.INT&&(Q=i.RGB32I)),E===i.RGBA_INTEGER&&(P===i.UNSIGNED_BYTE&&(Q=i.RGBA8UI),P===i.UNSIGNED_SHORT&&(Q=i.RGBA16UI),P===i.UNSIGNED_INT&&(Q=i.RGBA32UI),P===i.BYTE&&(Q=i.RGBA8I),P===i.SHORT&&(Q=i.RGBA16I),P===i.INT&&(Q=i.RGBA32I)),E===i.RGB&&(P===i.UNSIGNED_SHORT&&oe&&(Q=oe.RGB16_EXT),P===i.SHORT&&oe&&(Q=oe.RGB16_SNORM_EXT),P===i.UNSIGNED_INT_5_9_9_9_REV&&(Q=i.RGB9_E5),P===i.UNSIGNED_INT_10F_11F_11F_REV&&(Q=i.R11F_G11F_B10F)),E===i.RGBA){let te=ie?wr:je.getTransfer(K);P===i.FLOAT&&(Q=i.RGBA32F),P===i.HALF_FLOAT&&(Q=i.RGBA16F),P===i.UNSIGNED_BYTE&&(Q=te===lt?i.SRGB8_ALPHA8:i.RGBA8),P===i.UNSIGNED_SHORT&&oe&&(Q=oe.RGBA16_EXT),P===i.SHORT&&oe&&(Q=oe.RGBA16_SNORM_EXT),P===i.UNSIGNED_SHORT_4_4_4_4&&(Q=i.RGBA4),P===i.UNSIGNED_SHORT_5_5_5_1&&(Q=i.RGB5_A1)}return(Q===i.R16F||Q===i.R32F||Q===i.RG16F||Q===i.RG32F||Q===i.RGBA16F||Q===i.RGBA32F)&&e.get("EXT_color_buffer_float"),Q}function x(I,E){let P;return I?E===null||E===Tn||E===us?P=i.DEPTH24_STENCIL8:E===Pn?P=i.DEPTH32F_STENCIL8:E===Qs&&(P=i.DEPTH24_STENCIL8,Le("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):E===null||E===Tn||E===us?P=i.DEPTH_COMPONENT24:E===Pn?P=i.DEPTH_COMPONENT32F:E===Qs&&(P=i.DEPTH_COMPONENT16),P}function v(I,E){return M(I)===!0||I.isFramebufferTexture&&I.minFilter!==Pt&&I.minFilter!==Wt?Math.log2(Math.max(E.width,E.height))+1:I.mipmaps.length>0?I.mipmaps.length:I.isCompressedTexture&&Array.isArray(I.image)?E.mipmaps.length:1}function A(I){let E=new WeakRef(I);n.get(I).__ref=E,g.add(E),S.register(I,E,E)}function R(I){let E=n.get(I).__ref;E!==void 0&&(g.delete(E),S.unregister(E))}function L(I){B(I.target)}function N(I){D(I.target)}function B(I){I.removeEventListener("dispose",L),R(I),V(I),I.isVideoTexture&&u.delete(I),I.isHTMLTexture&&d.delete(I)}function D(I){I.removeEventListener("dispose",N),R(I),H(I)}function W(){for(let I of g){let E=I.deref();E!==void 0&&(E.isRenderTarget===!0?D(E):B(E))}g.clear(),d.clear()}function V(I){let E=n.get(I);if(E.__webglInit===void 0)return;let P=I.source,q=m.get(P);if(q){let K=q[E.__cacheKey];K.usedTimes--,K.usedTimes===0&&Y(I),Object.keys(q).length===0&&m.delete(P)}n.remove(I)}function Y(I){let E=n.get(I);i.deleteTexture(E.__webglTexture);let P=I.source,q=m.get(P);delete q[E.__cacheKey],a.memory.textures--}function H(I){let E=n.get(I);E.__depthDisposeCallback&&E.__depthDisposeCallback();let P=I.depthTexture;if(P&&P.renderTarget===I&&B(P),I.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(E.__webglFramebuffer[K]))for(let ie=0;ie<E.__webglFramebuffer[K].length;ie++)i.deleteFramebuffer(E.__webglFramebuffer[K][ie]);else i.deleteFramebuffer(E.__webglFramebuffer[K]);E.__webglDepthbuffer&&i.deleteRenderbuffer(E.__webglDepthbuffer[K])}else{if(Array.isArray(E.__webglFramebuffer))for(let K=0;K<E.__webglFramebuffer.length;K++)i.deleteFramebuffer(E.__webglFramebuffer[K]);else i.deleteFramebuffer(E.__webglFramebuffer);if(E.__webglDepthbuffer&&i.deleteRenderbuffer(E.__webglDepthbuffer),E.__webglMultisampledFramebuffer&&i.deleteFramebuffer(E.__webglMultisampledFramebuffer),E.__webglColorRenderbuffer)for(let K=0;K<E.__webglColorRenderbuffer.length;K++)E.__webglColorRenderbuffer[K]&&i.deleteRenderbuffer(E.__webglColorRenderbuffer[K]);E.__webglDepthRenderbuffer&&i.deleteRenderbuffer(E.__webglDepthRenderbuffer)}let q=I.textures;for(let K=0,ie=q.length;K<ie;K++){let oe=n.get(q[K]);oe.__webglTexture&&(i.deleteTexture(oe.__webglTexture),a.memory.textures--),n.remove(q[K])}n.remove(I)}let F=0;function $(){F=0}function ee(){return F}function ae(I){F=I}function ge(){let I=F;return I>=s.maxTextures&&Le("WebGLTextures: Trying to use "+(I+1)+" texture units while this GPU supports only "+s.maxTextures),F+=1,I}function J(I){let E=[];return E.push(I.wrapS),E.push(I.wrapT),E.push(I.wrapR||0),E.push(I.magFilter),E.push(I.minFilter),E.push(I.anisotropy),E.push(I.internalFormat),E.push(I.format),E.push(I.type),E.push(I.generateMipmaps),E.push(I.mipmapsAutoUpdate),E.push(I.premultiplyAlpha),E.push(I.flipY),E.push(I.unpackAlignment),E.push(I.colorSpace),E.join()}function xe(I,E){let P=n.get(I);if(I.isVideoTexture&&Et(I),I.isRenderTargetTexture===!1&&I.isExternalTexture!==!0&&I.version>0&&P.__version!==I.version){let q=I.image;if(q===null)Le("WebGLRenderer: Texture marked for update but no image data found.");else if(q.complete===!1)Le("WebGLRenderer: Texture marked for update but image is incomplete");else{Mt(P,I,E);return}}else I.isExternalTexture&&(P.__webglTexture=I.sourceTexture?I.sourceTexture:null);t.bindTexture(i.TEXTURE_2D,P.__webglTexture,i.TEXTURE0+E)}function be(I,E){let P=n.get(I);if(I.isRenderTargetTexture===!1&&I.version>0&&P.__version!==I.version){Mt(P,I,E);return}else I.isExternalTexture&&(P.__webglTexture=I.sourceTexture?I.sourceTexture:null);t.bindTexture(i.TEXTURE_2D_ARRAY,P.__webglTexture,i.TEXTURE0+E)}function Ae(I,E){let P=n.get(I);if(I.isRenderTargetTexture===!1&&I.version>0&&P.__version!==I.version){Mt(P,I,E);return}t.bindTexture(i.TEXTURE_3D,P.__webglTexture,i.TEXTURE0+E)}function pe(I,E){let P=n.get(I);if(I.version>0&&P.__version!==I.version){qt(P,I,E);return}t.bindTexture(i.TEXTURE_CUBE_MAP,P.__webglTexture,i.TEXTURE0+E)}let Ue={[Za]:i.REPEAT,[jn]:i.CLAMP_TO_EDGE,[Ja]:i.MIRRORED_REPEAT},dt={[Pt]:i.NEAREST,[Qu]:i.NEAREST_MIPMAP_NEAREST,[Vr]:i.NEAREST_MIPMAP_LINEAR,[Wt]:i.LINEAR,[Ao]:i.LINEAR_MIPMAP_NEAREST,[wi]:i.LINEAR_MIPMAP_LINEAR},Te={[id]:i.NEVER,[Bc]:i.ALWAYS,[sd]:i.LESS,[Oc]:i.LEQUAL,[rd]:i.EQUAL,[kc]:i.GEQUAL,[ad]:i.GREATER,[od]:i.NOTEQUAL};function st(I,E){if(E.type===Pn&&e.has("OES_texture_float_linear")===!1&&(E.magFilter===Wt||E.magFilter===Ao||E.magFilter===Vr||E.magFilter===wi||E.minFilter===Wt||E.minFilter===Ao||E.minFilter===Vr||E.minFilter===wi)&&Le("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(I,i.TEXTURE_WRAP_S,Ue[E.wrapS]),i.texParameteri(I,i.TEXTURE_WRAP_T,Ue[E.wrapT]),(I===i.TEXTURE_3D||I===i.TEXTURE_2D_ARRAY)&&i.texParameteri(I,i.TEXTURE_WRAP_R,Ue[E.wrapR]),i.texParameteri(I,i.TEXTURE_MAG_FILTER,dt[E.magFilter]),i.texParameteri(I,i.TEXTURE_MIN_FILTER,dt[E.minFilter]),E.compareFunction&&(i.texParameteri(I,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(I,i.TEXTURE_COMPARE_FUNC,Te[E.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(E.magFilter===Pt||E.minFilter!==Vr&&E.minFilter!==wi||E.type===Pn&&e.has("OES_texture_float_linear")===!1)return;if(E.anisotropy>1||n.get(E).__currentAnisotropy){let P=e.get("EXT_texture_filter_anisotropic");i.texParameterf(I,P.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(E.anisotropy,s.getMaxAnisotropy())),n.get(E).__currentAnisotropy=E.anisotropy}}}function tt(I,E){let P=!1;I.__webglInit===void 0&&(I.__webglInit=!0,E.addEventListener("dispose",L),A(E));let q=E.source,K=m.get(q);K===void 0&&(K={},m.set(q,K));let ie=J(E);if(ie!==I.__cacheKey){K[ie]===void 0&&(K[ie]={texture:i.createTexture(),usedTimes:0},a.memory.textures++,P=!0),K[ie].usedTimes++;let oe=K[I.__cacheKey];oe!==void 0&&(K[I.__cacheKey].usedTimes--,oe.usedTimes===0&&Y(E)),I.__cacheKey=ie,I.__webglTexture=K[ie].texture}return P}function Ye(I,E,P){return Math.floor(Math.floor(I/P)/E)}function Dt(I,E,P,q){let ie=I.updateRanges;if(ie.length===0)t.texSubImage2D(i.TEXTURE_2D,0,0,0,E.width,E.height,P,q,E.data);else{ie.sort((U,ne)=>U.start-ne.start);let oe=0;for(let U=1;U<ie.length;U++){let ne=ie[oe],j=ie[U],he=ne.start+ne.count,re=Ye(j.start,E.width,4),le=Ye(ne.start,E.width,4);j.start<=he+1&&re===le&&Ye(j.start+j.count-1,E.width,4)===re?ne.count=Math.max(ne.count,j.start+j.count-ne.start):(++oe,ie[oe]=j)}ie.length=oe+1;let Q=t.getParameter(i.UNPACK_ROW_LENGTH),te=t.getParameter(i.UNPACK_SKIP_PIXELS),ce=t.getParameter(i.UNPACK_SKIP_ROWS);t.pixelStorei(i.UNPACK_ROW_LENGTH,E.width);for(let U=0,ne=ie.length;U<ne;U++){let j=ie[U],he=Math.floor(j.start/4),re=Math.ceil(j.count/4),le=he%E.width,Ce=Math.floor(he/E.width),Xe=re,se=1;t.pixelStorei(i.UNPACK_SKIP_PIXELS,le),t.pixelStorei(i.UNPACK_SKIP_ROWS,Ce),t.texSubImage2D(i.TEXTURE_2D,0,le,Ce,Xe,se,P,q,E.data)}I.clearUpdateRanges(),t.pixelStorei(i.UNPACK_ROW_LENGTH,Q),t.pixelStorei(i.UNPACK_SKIP_PIXELS,te),t.pixelStorei(i.UNPACK_SKIP_ROWS,ce)}}function Mt(I,E,P){let q=i.TEXTURE_2D;(E.isDataArrayTexture||E.isCompressedArrayTexture)&&(q=i.TEXTURE_2D_ARRAY),E.isData3DTexture&&(q=i.TEXTURE_3D);let K=tt(I,E),ie=E.source;t.bindTexture(q,I.__webglTexture,i.TEXTURE0+P);let oe=n.get(ie);if(ie.version!==oe.__version||K===!0){if(t.activeTexture(i.TEXTURE0+P),(typeof ImageBitmap<"u"&&E.image instanceof ImageBitmap)===!1){let se=je.getPrimaries(je.workingColorSpace),Pe=E.colorSpace===Ti?null:je.getPrimaries(E.colorSpace),Ge=E.colorSpace===Ti||se===Pe?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,E.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ge)}t.pixelStorei(i.UNPACK_ALIGNMENT,E.unpackAlignment);let te=_(E.image,!1,s.maxTextureSize);te=Ie(E,te);let ce=r.convert(E.format,E.colorSpace),U=r.convert(E.type),ne=b(E.internalFormat,ce,U,E.normalized,E.colorSpace,E.isVideoTexture);st(q,E);let j,he=E.mipmaps,re=E.isVideoTexture!==!0,le=oe.__version===void 0||K===!0,Ce=ie.dataReady,Xe=v(E,te);if(E.isDepthTexture)ne=x(E.format===Ei,E.type),le&&(re?t.texStorage2D(i.TEXTURE_2D,1,ne,te.width,te.height):t.texImage2D(i.TEXTURE_2D,0,ne,te.width,te.height,0,ce,U,null));else if(E.isDataTexture)if(he.length>0){re&&le&&t.texStorage2D(i.TEXTURE_2D,Xe,ne,he[0].width,he[0].height);for(let se=0,Pe=he.length;se<Pe;se++)j=he[se],re?Ce&&t.texSubImage2D(i.TEXTURE_2D,se,0,0,j.width,j.height,ce,U,j.data):t.texImage2D(i.TEXTURE_2D,se,ne,j.width,j.height,0,ce,U,j.data);E.generateMipmaps=!1}else re?(le&&t.texStorage2D(i.TEXTURE_2D,Xe,ne,te.width,te.height),Ce&&Dt(E,te,ce,U)):t.texImage2D(i.TEXTURE_2D,0,ne,te.width,te.height,0,ce,U,te.data);else if(E.isCompressedTexture)if(E.isCompressedArrayTexture){re&&le&&t.texStorage3D(i.TEXTURE_2D_ARRAY,Xe,ne,he[0].width,he[0].height,te.depth);for(let se=0,Pe=he.length;se<Pe;se++)if(j=he[se],E.format!==Xn)if(ce!==null)if(re){if(Ce)if(E.layerUpdates.size>0){let Ge=$c(j.width,j.height,E.format,E.type);for(let ve of E.layerUpdates){let ct=j.data.subarray(ve*Ge/j.data.BYTES_PER_ELEMENT,(ve+1)*Ge/j.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,se,0,0,ve,j.width,j.height,1,ce,ct)}}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,se,0,0,0,j.width,j.height,te.depth,ce,j.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,se,ne,j.width,j.height,te.depth,0,j.data,0,0);else Le("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else re?Ce&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,se,0,0,0,j.width,j.height,te.depth,ce,U,j.data):t.texImage3D(i.TEXTURE_2D_ARRAY,se,ne,j.width,j.height,te.depth,0,ce,U,j.data);E.layerUpdates.size>0&&E.clearLayerUpdates()}else{re&&le&&t.texStorage2D(i.TEXTURE_2D,Xe,ne,he[0].width,he[0].height);for(let se=0,Pe=he.length;se<Pe;se++)j=he[se],E.format!==Xn?ce!==null?re?Ce&&t.compressedTexSubImage2D(i.TEXTURE_2D,se,0,0,j.width,j.height,ce,j.data):t.compressedTexImage2D(i.TEXTURE_2D,se,ne,j.width,j.height,0,j.data):Le("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):re?Ce&&t.texSubImage2D(i.TEXTURE_2D,se,0,0,j.width,j.height,ce,U,j.data):t.texImage2D(i.TEXTURE_2D,se,ne,j.width,j.height,0,ce,U,j.data)}else if(E.isDataArrayTexture)if(re){if(le&&t.texStorage3D(i.TEXTURE_2D_ARRAY,Xe,ne,te.width,te.height,te.depth),Ce)if(E.layerUpdates.size>0){let se=$c(te.width,te.height,E.format,E.type);for(let Pe of E.layerUpdates){let Ge=te.data.subarray(Pe*se/te.data.BYTES_PER_ELEMENT,(Pe+1)*se/te.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,Pe,te.width,te.height,1,ce,U,Ge)}E.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,te.width,te.height,te.depth,ce,U,te.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,ne,te.width,te.height,te.depth,0,ce,U,te.data);else if(E.isData3DTexture)re?(le&&t.texStorage3D(i.TEXTURE_3D,Xe,ne,te.width,te.height,te.depth),Ce&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,te.width,te.height,te.depth,ce,U,te.data)):t.texImage3D(i.TEXTURE_3D,0,ne,te.width,te.height,te.depth,0,ce,U,te.data);else if(E.isFramebufferTexture){if(le)if(re)t.texStorage2D(i.TEXTURE_2D,Xe,ne,te.width,te.height);else{let se=te.width,Pe=te.height;for(let Ge=0;Ge<Xe;Ge++)t.texImage2D(i.TEXTURE_2D,Ge,ne,se,Pe,0,ce,U,null),se>>=1,Pe>>=1}}else if(E.isHTMLTexture){if("texElementImage2D"in i){let se=i.canvas;if(se.hasAttribute("layoutsubtree")||se.setAttribute("layoutsubtree","true"),te.parentNode!==se){se.appendChild(te),d.add(E),se.onpaint=Pe=>{let Ge=Pe.changedElements;for(let ve of d)Ge.includes(ve.image)&&(ve.needsUpdate=!0)},se.requestPaint();return}if(i.texElementImage2D.length===3)i.texElementImage2D(i.TEXTURE_2D,i.RGBA8,te);else{let Ge=i.RGBA,ve=i.RGBA,ct=i.UNSIGNED_BYTE;i.texElementImage2D(i.TEXTURE_2D,0,Ge,ve,ct,te)}i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE)}}else if(he.length>0){if(re&&le){let se=Fe(he[0]);t.texStorage2D(i.TEXTURE_2D,Xe,ne,se.width,se.height)}for(let se=0,Pe=he.length;se<Pe;se++)j=he[se],re?Ce&&t.texSubImage2D(i.TEXTURE_2D,se,0,0,ce,U,j):t.texImage2D(i.TEXTURE_2D,se,ne,ce,U,j);E.generateMipmaps=!1}else if(re){if(le){let se=Fe(te);t.texStorage2D(i.TEXTURE_2D,Xe,ne,se.width,se.height)}Ce&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,ce,U,te)}else t.texImage2D(i.TEXTURE_2D,0,ne,ce,U,te);M(E)&&E.mipmapsAutoUpdate===!0&&w(q),oe.__version=ie.version,E.onUpdate&&E.onUpdate(E)}I.__version=E.version}function qt(I,E,P){if(E.image.length!==6)return;let q=tt(I,E),K=E.source;t.bindTexture(i.TEXTURE_CUBE_MAP,I.__webglTexture,i.TEXTURE0+P);let ie=n.get(K);if(K.version!==ie.__version||q===!0){t.activeTexture(i.TEXTURE0+P);let oe=je.getPrimaries(je.workingColorSpace),Q=E.colorSpace===Ti?null:je.getPrimaries(E.colorSpace),te=E.colorSpace===Ti||oe===Q?i.NONE:i.BROWSER_DEFAULT_WEBGL;t.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,E.flipY),t.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),t.pixelStorei(i.UNPACK_ALIGNMENT,E.unpackAlignment),t.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,te);let ce=E.isCompressedTexture||E.image[0].isCompressedTexture,U=E.image[0]&&E.image[0].isDataTexture,ne=[];for(let ve=0;ve<6;ve++)!ce&&!U?ne[ve]=_(E.image[ve],!0,s.maxCubemapSize):ne[ve]=U?E.image[ve].image:E.image[ve],ne[ve]=Ie(E,ne[ve]);let j=ne[0],he=r.convert(E.format,E.colorSpace),re=r.convert(E.type),le=b(E.internalFormat,he,re,E.normalized,E.colorSpace),Ce=E.isVideoTexture!==!0,Xe=ie.__version===void 0||q===!0,se=K.dataReady,Pe=v(E,j);st(i.TEXTURE_CUBE_MAP,E);let Ge;if(E.isDepthTexture){if(le=x(E.format===Ei,E.type),Xe)if(Ce)t.texStorage2D(i.TEXTURE_CUBE_MAP,1,le,j.width,j.height);else for(let ve=0;ve<6;ve++)t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,0,le,j.width,j.height,0,he,re,null)}else if(ce){Ce&&Xe&&t.texStorage2D(i.TEXTURE_CUBE_MAP,Pe,le,j.width,j.height);for(let ve=0;ve<6;ve++){Ge=ne[ve].mipmaps;for(let ct=0;ct<Ge.length;ct++){let Ht=Ge[ct];E.format!==Xn?he!==null?Ce?se&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct,0,0,Ht.width,Ht.height,he,Ht.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct,le,Ht.width,Ht.height,0,Ht.data):Le("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Ce?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct,0,0,Ht.width,Ht.height,he,re,Ht.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct,le,Ht.width,Ht.height,0,he,re,Ht.data)}}}else{if(Ge=E.mipmaps,Ce&&Xe){Ge.length>0&&Pe++;let ve=Fe(ne[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,Pe,le,ve.width,ve.height)}for(let ve=0;ve<6;ve++)if(U){Ce?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,0,0,0,ne[ve].width,ne[ve].height,he,re,ne[ve].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,0,le,ne[ve].width,ne[ve].height,0,he,re,ne[ve].data);for(let ct=0;ct<Ge.length;ct++){let Ci=Ge[ct].image[ve].image;Ce?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct+1,0,0,Ci.width,Ci.height,he,re,Ci.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct+1,le,Ci.width,Ci.height,0,he,re,Ci.data)}}else{Ce?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,0,0,0,he,re,ne[ve]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,0,le,he,re,ne[ve]);for(let ct=0;ct<Ge.length;ct++){let Ht=Ge[ct];Ce?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct+1,0,0,he,re,Ht.image[ve]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ve,ct+1,le,he,re,Ht.image[ve])}}}M(E)&&E.mipmapsAutoUpdate===!0&&w(i.TEXTURE_CUBE_MAP),ie.__version=K.version,E.onUpdate&&E.onUpdate(E)}I.__version=E.version}function mt(I,E,P,q,K,ie){let oe=r.convert(P.format,P.colorSpace),Q=r.convert(P.type),te=b(P.internalFormat,oe,Q,P.normalized,P.colorSpace),ce=n.get(E),U=n.get(P);if(U.__renderTarget=E,!ce.__hasExternalTextures){let ne=Math.max(1,E.width>>ie),j=Math.max(1,E.height>>ie);K===i.TEXTURE_3D||K===i.TEXTURE_2D_ARRAY?t.texImage3D(K,ie,te,ne,j,E.depth,0,oe,Q,null):t.texImage2D(K,ie,te,ne,j,0,oe,Q,null)}t.bindFramebuffer(i.FRAMEBUFFER,I),de(E)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,q,K,U.__webglTexture,0,ot(E)):(K===i.TEXTURE_2D||K>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&K<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,q,K,U.__webglTexture,ie),t.bindFramebuffer(i.FRAMEBUFFER,null)}function _n(I,E,P){if(i.bindRenderbuffer(i.RENDERBUFFER,I),E.depthBuffer){let q=E.depthTexture,K=q&&q.isDepthTexture?q.type:null,ie=x(E.stencilBuffer,K),oe=E.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;de(E)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ot(E),ie,E.width,E.height):P?i.renderbufferStorageMultisample(i.RENDERBUFFER,ot(E),ie,E.width,E.height):i.renderbufferStorage(i.RENDERBUFFER,ie,E.width,E.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,oe,i.RENDERBUFFER,I)}else{let q=E.textures;for(let K=0;K<q.length;K++){let ie=q[K],oe=r.convert(ie.format,ie.colorSpace),Q=r.convert(ie.type),te=b(ie.internalFormat,oe,Q,ie.normalized,ie.colorSpace);de(E)?o.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ot(E),te,E.width,E.height):P?i.renderbufferStorageMultisample(i.RENDERBUFFER,ot(E),te,E.width,E.height):i.renderbufferStorage(i.RENDERBUFFER,te,E.width,E.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function yt(I,E,P){let q=E.isWebGLCubeRenderTarget===!0;if(t.bindFramebuffer(i.FRAMEBUFFER,I),!(E.depthTexture&&E.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let K=n.get(E.depthTexture);K.__renderTarget=E;let ie=q?E.depthTexture.image[0]:E.depthTexture.image;(!K.__webglTexture||ie.width!==E.width||ie.height!==E.height)&&(ie.width=E.width,ie.height=E.height,E.depthTexture.needsUpdate=!0),q?pe(E.depthTexture,0):xe(E.depthTexture,0);let oe=K.__webglTexture,Q=ot(E),te=q?i.TEXTURE_CUBE_MAP_POSITIVE_X+P:i.TEXTURE_2D,ce=E.depthTexture.format===Ei?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;if(E.depthTexture.format===vi)de(E)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ce,te,oe,0,Q):i.framebufferTexture2D(i.FRAMEBUFFER,ce,te,oe,0);else if(E.depthTexture.format===Ei)de(E)?o.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,ce,te,oe,0,Q):i.framebufferTexture2D(i.FRAMEBUFFER,ce,te,oe,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function fn(I){let E=n.get(I),P=I.isWebGLCubeRenderTarget===!0;if(E.__boundDepthTexture!==I.depthTexture){let q=I.depthTexture;if(E.__depthDisposeCallback&&E.__depthDisposeCallback(),q){let K=()=>{delete E.__boundDepthTexture,delete E.__depthDisposeCallback,q.removeEventListener("dispose",K)};q.addEventListener("dispose",K),E.__depthDisposeCallback=K}E.__boundDepthTexture=q}if(I.depthTexture&&!E.__autoAllocateDepthBuffer)if(P)for(let q=0;q<6;q++)yt(E.__webglFramebuffer[q],I,q);else I.texture.mipmaps.length>0?yt(E.__webglFramebuffer[0],I,0):yt(E.__webglFramebuffer,I,0);else if(P){E.__webglDepthbuffer=[];for(let q=0;q<6;q++)if(t.bindFramebuffer(i.FRAMEBUFFER,E.__webglFramebuffer[q]),E.__webglDepthbuffer[q]===void 0)E.__webglDepthbuffer[q]=i.createRenderbuffer(),_n(E.__webglDepthbuffer[q],I,!1);else{let K=I.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ie=E.__webglDepthbuffer[q];i.bindRenderbuffer(i.RENDERBUFFER,ie),i.framebufferRenderbuffer(i.FRAMEBUFFER,K,i.RENDERBUFFER,ie)}}else if(I.texture.mipmaps.length>0?t.bindFramebuffer(i.FRAMEBUFFER,E.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,E.__webglFramebuffer),E.__webglDepthbuffer===void 0)E.__webglDepthbuffer=i.createRenderbuffer(),_n(E.__webglDepthbuffer,I,!1);else{let K=I.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,ie=E.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,ie),i.framebufferRenderbuffer(i.FRAMEBUFFER,K,i.RENDERBUFFER,ie)}t.bindFramebuffer(i.FRAMEBUFFER,null)}function an(I,E,P){let q=n.get(I);E!==void 0&&mt(q.__webglFramebuffer,I,I.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),P!==void 0&&fn(I)}function on(I){let E=I.texture,P=n.get(I),q=n.get(E);I.addEventListener("dispose",N),A(I);let K=I.textures,ie=I.isWebGLCubeRenderTarget===!0,oe=K.length>1;if(oe||(q.__webglTexture===void 0&&(q.__webglTexture=i.createTexture()),q.__version=E.version,a.memory.textures++),ie){P.__webglFramebuffer=[];for(let Q=0;Q<6;Q++)if(E.mipmaps.length>0){P.__webglFramebuffer[Q]=[];for(let te=0;te<E.mipmaps.length;te++)P.__webglFramebuffer[Q][te]=i.createFramebuffer()}else P.__webglFramebuffer[Q]=i.createFramebuffer()}else{if(E.mipmaps.length>0){P.__webglFramebuffer=[];for(let Q=0;Q<E.mipmaps.length;Q++)P.__webglFramebuffer[Q]=i.createFramebuffer()}else P.__webglFramebuffer=i.createFramebuffer();if(oe)for(let Q=0,te=K.length;Q<te;Q++){let ce=n.get(K[Q]);ce.__webglTexture===void 0&&(ce.__webglTexture=i.createTexture(),a.memory.textures++)}if(I.samples>0&&de(I)===!1){P.__webglMultisampledFramebuffer=i.createFramebuffer(),P.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,P.__webglMultisampledFramebuffer);for(let Q=0;Q<K.length;Q++){let te=K[Q];P.__webglColorRenderbuffer[Q]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,P.__webglColorRenderbuffer[Q]);let ce=r.convert(te.format,te.colorSpace),U=r.convert(te.type),ne=b(te.internalFormat,ce,U,te.normalized,te.colorSpace,I.isXRRenderTarget===!0),j=ot(I);i.renderbufferStorageMultisample(i.RENDERBUFFER,j,ne,I.width,I.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Q,i.RENDERBUFFER,P.__webglColorRenderbuffer[Q])}i.bindRenderbuffer(i.RENDERBUFFER,null),I.depthBuffer&&(P.__webglDepthRenderbuffer=i.createRenderbuffer(),_n(P.__webglDepthRenderbuffer,I,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(ie){t.bindTexture(i.TEXTURE_CUBE_MAP,q.__webglTexture),st(i.TEXTURE_CUBE_MAP,E);for(let Q=0;Q<6;Q++)if(E.mipmaps.length>0)for(let te=0;te<E.mipmaps.length;te++)mt(P.__webglFramebuffer[Q][te],I,E,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,te);else mt(P.__webglFramebuffer[Q],I,E,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0);M(E)?w(i.TEXTURE_CUBE_MAP):E.mipmaps.length>0&&i.texParameteri(i.TEXTURE_CUBE_MAP,i.TEXTURE_MAX_LEVEL,E.mipmaps.length-1),t.unbindTexture()}else if(oe){for(let Q=0,te=K.length;Q<te;Q++){let ce=K[Q],U=n.get(ce),ne=i.TEXTURE_2D;(I.isWebGL3DRenderTarget||I.isWebGLArrayRenderTarget)&&(ne=I.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(ne,U.__webglTexture),st(ne,ce),mt(P.__webglFramebuffer,I,ce,i.COLOR_ATTACHMENT0+Q,ne,0),M(ce)&&w(ne)}t.unbindTexture()}else{let Q=i.TEXTURE_2D;if((I.isWebGL3DRenderTarget||I.isWebGLArrayRenderTarget)&&(Q=I.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(Q,q.__webglTexture),st(Q,E),E.mipmaps.length>0)for(let te=0;te<E.mipmaps.length;te++)mt(P.__webglFramebuffer[te],I,E,i.COLOR_ATTACHMENT0,Q,te);else mt(P.__webglFramebuffer,I,E,i.COLOR_ATTACHMENT0,Q,0);M(E)?w(Q):E.mipmaps.length>0&&i.texParameteri(Q,i.TEXTURE_MAX_LEVEL,E.mipmaps.length-1),t.unbindTexture()}I.depthBuffer&&fn(I)}function z(I){let E=I.textures;for(let P=0,q=E.length;P<q;P++){let K=E[P];if(M(K)&&K.mipmapsAutoUpdate===!0){let ie=C(I),oe=n.get(K).__webglTexture;t.bindTexture(ie,oe),w(ie),t.unbindTexture()}}}let Ft=[];function nt(I){if(I.samples>0){if(de(I)===!1){let E=I.textures,P=I.width,q=I.height,K=i.COLOR_BUFFER_BIT,ie=I.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,oe=n.get(I),Q=E.length>1;if(Q)for(let ce=0;ce<E.length;ce++)t.bindFramebuffer(i.FRAMEBUFFER,oe.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ce,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,oe.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ce,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,oe.__webglMultisampledFramebuffer),I.texture.mipmaps.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,oe.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,oe.__webglFramebuffer);for(let ce=0;ce<E.length;ce++){if(I.resolveDepthBuffer&&(I.depthBuffer&&(K|=i.DEPTH_BUFFER_BIT),I.stencilBuffer&&I.resolveStencilBuffer&&(K|=i.STENCIL_BUFFER_BIT)),Q){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,oe.__webglColorRenderbuffer[ce]);let U=n.get(E[ce]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,U,0)}i.blitFramebuffer(0,0,P,q,0,0,P,q,K,i.NEAREST),l===!0&&(Ft.length=0,Ft.push(i.COLOR_ATTACHMENT0+ce),I.depthBuffer&&I.storeMultisampledDepthBuffer===!1&&Ft.push(ie),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,Ft))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),Q)for(let ce=0;ce<E.length;ce++){t.bindFramebuffer(i.FRAMEBUFFER,oe.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ce,i.RENDERBUFFER,oe.__webglColorRenderbuffer[ce]);let U=n.get(E[ce]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,oe.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+ce,i.TEXTURE_2D,U,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,oe.__webglMultisampledFramebuffer)}else if(I.depthBuffer&&I.storeMultisampledDepthBuffer===!1&&l){let E=I.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[E])}}}function ot(I){return Math.min(s.maxSamples,I.samples)}function de(I){let E=n.get(I);return I.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&E.__useRenderToTexture!==!1}function Et(I){let E=a.render.frame;u.get(I)!==E&&(u.set(I,E),I.update())}function Ie(I,E){let P=I.colorSpace,q=I.format,K=I.type;return I.isCompressedTexture===!0||I.isVideoTexture===!0||P!==Mr&&P!==Ti&&(je.getTransfer(P)===lt?(q!==Xn||K!==sn)&&Le("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Ne("WebGLTextures: Unsupported texture color space:",P)),E}function Fe(I){return typeof HTMLImageElement<"u"&&I instanceof HTMLImageElement?(c.width=I.naturalWidth||I.width,c.height=I.naturalHeight||I.height):typeof VideoFrame<"u"&&I instanceof VideoFrame?(c.width=I.displayWidth,c.height=I.displayHeight):(c.width=I.width,c.height=I.height),c}this.allocateTextureUnit=ge,this.resetTextureUnits=$,this.getTextureUnits=ee,this.setTextureUnits=ae,this.setTexture2D=xe,this.setTexture2DArray=be,this.setTexture3D=Ae,this.setTextureCube=pe,this.rebindTextures=an,this.setupRenderTarget=on,this.updateRenderTargetMipmap=z,this.updateMultisampleRenderTarget=nt,this.setupDepthRenderbuffer=fn,this.setupFrameBufferTexture=mt,this.useMultisampledRTT=de,this.dispose=W}function oy(i,e){function t(n,s=Ti){let r,a=je.getTransfer(s);if(n===sn)return i.UNSIGNED_BYTE;if(n===Ro)return i.UNSIGNED_SHORT_4_4_4_4;if(n===Po)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Dc)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Nc)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===Ic)return i.BYTE;if(n===Lc)return i.SHORT;if(n===Qs)return i.UNSIGNED_SHORT;if(n===Co)return i.INT;if(n===Tn)return i.UNSIGNED_INT;if(n===Pn)return i.FLOAT;if(n===hn)return i.HALF_FLOAT;if(n===Uc)return i.ALPHA;if(n===Fc)return i.RGB;if(n===Xn)return i.RGBA;if(n===vi)return i.DEPTH_COMPONENT;if(n===Ei)return i.DEPTH_STENCIL;if(n===er)return i.RED;if(n===Io)return i.RED_INTEGER;if(n===Vi)return i.RG;if(n===Lo)return i.RG_INTEGER;if(n===Do)return i.RGBA_INTEGER;if(n===Wr||n===Xr||n===qr||n===Yr)if(a===lt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Wr)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Xr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===qr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Yr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Wr)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Xr)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===qr)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Yr)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===No||n===Uo||n===Fo||n===Oo)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===No)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Uo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Fo)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Oo)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===ko||n===Bo||n===zo||n===Ho||n===Go||n===$r||n===Vo)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===ko||n===Bo)return a===lt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===zo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(n===Ho)return r.COMPRESSED_R11_EAC;if(n===Go)return r.COMPRESSED_SIGNED_R11_EAC;if(n===$r)return r.COMPRESSED_RG11_EAC;if(n===Vo)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===Wo||n===Xo||n===qo||n===Yo||n===$o||n===Zo||n===Jo||n===Ko||n===jo||n===Qo||n===el||n===tl||n===nl||n===il)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===Wo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Xo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===qo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Yo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===$o)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Zo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Jo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Ko)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===jo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Qo)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===el)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===tl)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===nl)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===il)return a===lt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===sl||n===rl||n===al)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===sl)return a===lt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===rl)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===al)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===ol||n===ll||n===Zr||n===cl)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===ol)return r.COMPRESSED_RED_RGTC1_EXT;if(n===ll)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Zr)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===cl)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===us?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}var ly=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,cy=`
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

}`,ih=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new Nr(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new wt({vertexShader:ly,fragmentShader:cy,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new He(new wn(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},sh=class extends Qn{constructor(e,t){super();let n=this,s=null,r=1,a=null,o="local-floor",l=1,c=null,u=null,d=null,h=null,m=null,g=null,S=typeof XRWebGLBinding<"u",f=new ih,p={},_=t.getContextAttributes(),M=null,w=null,C=[],b=[],x=new ze,v=null,A=null,R=new Ot;R.viewport=new pt;let L=new Ot;L.viewport=new pt;let N=[R,L],B=new Mo,D=null,W=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(J){let xe=C[J];return xe===void 0&&(xe=new qs,C[J]=xe),xe.getTargetRaySpace()},this.getControllerGrip=function(J){let xe=C[J];return xe===void 0&&(xe=new qs,C[J]=xe),xe.getGripSpace()},this.getHand=function(J){let xe=C[J];return xe===void 0&&(xe=new qs,C[J]=xe),xe.getHandSpace()};function V(J){let xe=b.indexOf(J.inputSource);if(xe===-1)return;let be=C[xe];be!==void 0&&(be.update(J.inputSource,J.frame,c||a),be.dispatchEvent({type:J.type,data:J.inputSource}))}function Y(){s.removeEventListener("select",V),s.removeEventListener("selectstart",V),s.removeEventListener("selectend",V),s.removeEventListener("squeeze",V),s.removeEventListener("squeezestart",V),s.removeEventListener("squeezeend",V),s.removeEventListener("end",Y),s.removeEventListener("inputsourceschange",H);for(let J=0;J<C.length;J++){let xe=b[J];xe!==null&&(b[J]=null,C[J].disconnect(xe))}D=null,W=null,f.reset();for(let J in p)delete p[J];if(e.setRenderTarget(M),m=null,h=null,d=null,s=null,w=null,ge.stop(),n.isPresenting=!1,e.setPixelRatio(v),e.setSize(x.width,x.height,!1),A!==null){let J=A.camera;J.fov=A.fov,J.zoom=A.zoom,J.updateProjectionMatrix(),A=null}n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(J){r=J,n.isPresenting===!0&&Le("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(J){o=J,n.isPresenting===!0&&Le("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(J){c=J},this.getBaseLayer=function(){return h!==null?h:m},this.getBinding=function(){return d===null&&S&&(d=new XRWebGLBinding(s,t)),d},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(J){if(s=J,s!==null){if(M=e.getRenderTarget(),s.addEventListener("select",V),s.addEventListener("selectstart",V),s.addEventListener("selectend",V),s.addEventListener("squeeze",V),s.addEventListener("squeezestart",V),s.addEventListener("squeezeend",V),s.addEventListener("end",Y),s.addEventListener("inputsourceschange",H),_.xrCompatible!==!0&&await t.makeXRCompatible(),v=e.getPixelRatio(),e.getSize(x),S&&"createProjectionLayer"in XRWebGLBinding.prototype){let be=null,Ae=null,pe=null;_.depth&&(pe=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,be=_.stencil?Ei:vi,Ae=_.stencil?us:Tn);let Ue={colorFormat:t.RGBA8,depthFormat:pe,scaleFactor:r};d=this.getBinding(),h=d.createProjectionLayer(Ue),s.updateRenderState({layers:[h]}),e.setPixelRatio(1),e.setSize(h.textureWidth,h.textureHeight,!1),w=new $t(h.textureWidth,h.textureHeight,{format:Xn,type:sn,depthTexture:new Gn(h.textureWidth,h.textureHeight,Ae,void 0,void 0,void 0,void 0,void 0,void 0,be),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:h.ignoreDepthValues===!1,resolveStencilBuffer:h.ignoreDepthValues===!1,storeMultisampledDepthBuffer:h.ignoreDepthValues===!1,storeMultisampledStencilBuffer:h.ignoreDepthValues===!1})}else{let be={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:r};m=new XRWebGLLayer(s,t,be),s.updateRenderState({baseLayer:m}),e.setPixelRatio(1),e.setSize(m.framebufferWidth,m.framebufferHeight,!1),w=new $t(m.framebufferWidth,m.framebufferHeight,{format:Xn,type:sn,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:m.ignoreDepthValues===!1,resolveStencilBuffer:m.ignoreDepthValues===!1,storeMultisampledDepthBuffer:m.ignoreDepthValues===!1,storeMultisampledStencilBuffer:m.ignoreDepthValues===!1})}w.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await s.requestReferenceSpace(o),ge.setContext(s),ge.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return f.getDepthTexture()};function H(J){for(let xe=0;xe<J.removed.length;xe++){let be=J.removed[xe],Ae=b.indexOf(be);Ae>=0&&(b[Ae]=null,C[Ae].disconnect(be))}for(let xe=0;xe<J.added.length;xe++){let be=J.added[xe],Ae=b.indexOf(be);if(Ae===-1){for(let Ue=0;Ue<C.length;Ue++)if(Ue>=b.length){b.push(be),Ae=Ue;break}else if(b[Ue]===null){b[Ue]=be,Ae=Ue;break}if(Ae===-1)break}let pe=C[Ae];pe&&pe.connect(be)}}function F(J,xe){xe===null?J.matrixWorld.copy(J.matrix):J.matrixWorld.multiplyMatrices(xe.matrixWorld,J.matrix),J.matrixWorldInverse.copy(J.matrixWorld).invert()}this.updateCamera=function(J){if(s===null)return;let xe=J.near,be=J.far;f.texture!==null&&(f.depthNear>0&&(xe=f.depthNear),f.depthFar>0&&(be=f.depthFar)),B.near=L.near=R.near=xe,B.far=L.far=R.far=be,(D!==B.near||W!==B.far)&&(s.updateRenderState({depthNear:B.near,depthFar:B.far}),D=B.near,W=B.far),B.layers.mask=J.layers.mask|6,R.layers.mask=B.layers.mask&-5,L.layers.mask=B.layers.mask&-3;let Ae=J.parent,pe=B.cameras;F(B,Ae);for(let Ue=0;Ue<pe.length;Ue++)F(pe[Ue],Ae);B.projectionMatrix.copy(R.projectionMatrix),B.projectionMatrixInverse.copy(R.projectionMatrixInverse),A===null&&J.isPerspectiveCamera&&(A={camera:J,fov:J.fov,zoom:J.zoom}),$(J,B,Ae)};function $(J,xe,be){be===null?J.matrix.copy(xe.matrixWorld):(J.matrix.copy(be.matrixWorld),J.matrix.invert(),J.matrix.multiply(xe.matrixWorld)),J.matrix.decompose(J.position,J.quaternion,J.scale),J.updateMatrixWorld(!0),J.projectionMatrix.copy(xe.projectionMatrix),J.projectionMatrixInverse.copy(xe.projectionMatrixInverse),J.isPerspectiveCamera&&(J.fov=Vs*2*Math.atan(1/J.projectionMatrix.elements[5]),J.zoom=1)}this.getCamera=function(){return B},this.getFoveation=function(){if(!(h===null&&m===null))return l},this.setFoveation=function(J){l=J,h!==null&&(h.fixedFoveation=J),m!==null&&m.fixedFoveation!==void 0&&(m.fixedFoveation=J)},this.hasDepthSensing=function(){return f.texture!==null},this.getDepthSensingMesh=function(){return f.getMesh(B)},this.getCameraTexture=function(J){return p[J]};let ee=null;function ae(J,xe){if(u=xe.getViewerPose(c||a),g=xe,u!==null){let be=u.views;m!==null&&(e.setRenderTargetFramebuffer(w,m.framebuffer),e.setRenderTarget(w));let Ae=!1;be.length!==B.cameras.length&&(B.cameras.length=0,Ae=!0);for(let Te=0;Te<be.length;Te++){let st=be[Te],tt=null;if(m!==null)tt=m.getViewport(st);else{let Dt=d.getViewSubImage(h,st);tt=Dt.viewport,Te===0&&(e.setRenderTargetTextures(w,Dt.colorTexture,Dt.depthStencilTexture),e.setRenderTarget(w))}let Ye=N[Te];Ye===void 0&&(Ye=new Ot,Ye.layers.enable(Te),Ye.viewport=new pt,N[Te]=Ye),Ye.matrix.fromArray(st.transform.matrix),Ye.matrix.decompose(Ye.position,Ye.quaternion,Ye.scale),Ye.projectionMatrix.fromArray(st.projectionMatrix),Ye.projectionMatrixInverse.copy(Ye.projectionMatrix).invert(),Ye.viewport.set(tt.x,tt.y,tt.width,tt.height),Te===0&&(B.matrix.copy(Ye.matrix),B.matrix.decompose(B.position,B.quaternion,B.scale)),Ae===!0&&B.cameras.push(Ye)}let pe=s.enabledFeatures;if(pe&&pe.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&S){d=n.getBinding();let Te=d.getDepthInformation(be[0]);Te&&Te.isValid&&Te.texture&&f.init(Te,s.renderState)}if(pe&&pe.includes("camera-access")&&S){e.state.unbindTexture(),d=n.getBinding();for(let Te=0;Te<be.length;Te++){let st=be[Te].camera;if(st){let tt=p[st];tt||(tt=new Nr,p[st]=tt);let Ye=d.getCameraImage(st);tt.sourceTexture=Ye}}}}for(let be=0;be<C.length;be++){let Ae=b[be],pe=C[be];Ae!==null&&pe!==void 0&&pe.update(Ae,xe,c||a)}ee&&ee(J,xe),xe.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:xe}),g=null}let ge=new Bd;ge.setAnimationLoop(ae),this.setAnimationLoop=function(J){ee=J},this.dispose=function(){}}},hy=new Ve,Zd=new Oe;Zd.set(-1,0,0,0,1,0,0,0,1);function uy(i,e){function t(f,p){f.matrixAutoUpdate===!0&&f.updateMatrix(),p.value.copy(f.matrix)}function n(f,p){p.color.getRGB(f.fogColor.value,Xc(i)),p.isFog?(f.fogNear.value=p.near,f.fogFar.value=p.far):p.isFogExp2&&(f.fogDensity.value=p.density)}function s(f,p,_,M,w){p.isNodeMaterial?p.uniformsNeedUpdate=!1:p.isMeshBasicMaterial?r(f,p):p.isMeshLambertMaterial?(r(f,p),p.envMap&&(f.envMapIntensity.value=p.envMapIntensity)):p.isMeshToonMaterial?(r(f,p),d(f,p)):p.isMeshPhongMaterial?(r(f,p),u(f,p),p.envMap&&(f.envMapIntensity.value=p.envMapIntensity)):p.isMeshStandardMaterial?(r(f,p),h(f,p),p.isMeshPhysicalMaterial&&m(f,p,w)):p.isMeshMatcapMaterial?(r(f,p),g(f,p)):p.isMeshDepthMaterial?r(f,p):p.isMeshDistanceMaterial?(r(f,p),S(f,p)):p.isMeshNormalMaterial?r(f,p):p.isLineBasicMaterial?(a(f,p),p.isLineDashedMaterial&&o(f,p)):p.isPointsMaterial?l(f,p,_,M):p.isSpriteMaterial?c(f,p):p.isShadowMaterial?(f.color.value.copy(p.color),f.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(f,p){f.opacity.value=p.opacity,p.color&&f.diffuse.value.copy(p.color),p.emissive&&f.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(f.map.value=p.map,t(p.map,f.mapTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,t(p.alphaMap,f.alphaMapTransform)),p.bumpMap&&(f.bumpMap.value=p.bumpMap,t(p.bumpMap,f.bumpMapTransform),f.bumpScale.value=p.bumpScale,p.side===Zt&&(f.bumpScale.value*=-1)),p.normalMap&&(f.normalMap.value=p.normalMap,t(p.normalMap,f.normalMapTransform),f.normalScale.value.copy(p.normalScale),p.side===Zt&&f.normalScale.value.negate()),p.displacementMap&&(f.displacementMap.value=p.displacementMap,t(p.displacementMap,f.displacementMapTransform),f.displacementScale.value=p.displacementScale,f.displacementBias.value=p.displacementBias),p.emissiveMap&&(f.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,f.emissiveMapTransform)),p.specularMap&&(f.specularMap.value=p.specularMap,t(p.specularMap,f.specularMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest);let _=e.get(p),M=_.envMap,w=_.envMapRotation;M&&(f.envMap.value=M,f.envMapRotation.value.setFromMatrix4(hy.makeRotationFromEuler(w)).transpose(),M.isCubeTexture&&M.isRenderTargetTexture===!1&&f.envMapRotation.value.premultiply(Zd),f.reflectivity.value=p.reflectivity,f.ior.value=p.ior,f.refractionRatio.value=p.refractionRatio),p.lightMap&&(f.lightMap.value=p.lightMap,f.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,f.lightMapTransform)),p.aoMap&&(f.aoMap.value=p.aoMap,f.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,f.aoMapTransform))}function a(f,p){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,p.map&&(f.map.value=p.map,t(p.map,f.mapTransform))}function o(f,p){f.dashSize.value=p.dashSize,f.totalSize.value=p.dashSize+p.gapSize,f.scale.value=p.scale}function l(f,p,_,M){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,f.size.value=p.size*_,f.scale.value=M*.5,p.map&&(f.map.value=p.map,t(p.map,f.uvTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,t(p.alphaMap,f.alphaMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest)}function c(f,p){f.diffuse.value.copy(p.color),f.opacity.value=p.opacity,f.rotation.value=p.rotation,p.map&&(f.map.value=p.map,t(p.map,f.mapTransform)),p.alphaMap&&(f.alphaMap.value=p.alphaMap,t(p.alphaMap,f.alphaMapTransform)),p.alphaTest>0&&(f.alphaTest.value=p.alphaTest)}function u(f,p){f.specular.value.copy(p.specular),f.shininess.value=Math.max(p.shininess,1e-4)}function d(f,p){p.gradientMap&&(f.gradientMap.value=p.gradientMap)}function h(f,p){f.metalness.value=p.metalness,p.metalnessMap&&(f.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,f.metalnessMapTransform)),f.roughness.value=p.roughness,p.roughnessMap&&(f.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,f.roughnessMapTransform)),p.envMap&&(f.envMapIntensity.value=p.envMapIntensity)}function m(f,p,_){f.ior.value=p.ior,p.diffuseRoughness>0&&(f.diffuseRoughness.value=p.diffuseRoughness,p.diffuseRoughnessMap&&(f.diffuseRoughnessMap.value=p.diffuseRoughnessMap,t(p.diffuseRoughnessMap,f.diffuseRoughnessMapTransform))),p.sheen>0&&(f.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),f.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(f.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,f.sheenColorMapTransform)),p.sheenRoughnessMap&&(f.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,f.sheenRoughnessMapTransform))),p.clearcoat>0&&(f.clearcoat.value=p.clearcoat,f.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(f.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,f.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(f.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,f.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(f.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,f.clearcoatNormalMapTransform),f.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Zt&&f.clearcoatNormalScale.value.negate())),p.dispersion>0&&(f.dispersion.value=p.dispersion),p.retroreflectivity>0&&(f.retroreflectivity.value=p.retroreflectivity),p.iridescence>0&&(f.iridescence.value=p.iridescence,f.iridescenceIOR.value=p.iridescenceIOR,f.iridescenceThicknessMinimum.value=p.iridescenceThicknessMinimum,f.iridescenceThicknessMaximum.value=p.iridescenceThicknessMaximum,p.iridescenceMap&&(f.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,f.iridescenceMapTransform)),p.iridescenceThicknessMap&&(f.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,f.iridescenceThicknessMapTransform))),p.transmission>0&&(f.transmission.value=p.transmission,f.transmissionSamplerMap.value=_.texture,f.transmissionSamplerSize.value.set(_.width,_.height),p.transmissionMap&&(f.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,f.transmissionMapTransform)),f.thickness.value=p.thickness,p.thicknessMap&&(f.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,f.thicknessMapTransform)),f.attenuationDistance.value=p.attenuationDistance,f.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(f.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(f.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,f.anisotropyMapTransform))),f.specularIntensity.value=p.specularIntensity,f.specularColor.value.copy(p.specularColor),p.specularColorMap&&(f.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,f.specularColorMapTransform)),p.specularIntensityMap&&(f.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,f.specularIntensityMapTransform))}function g(f,p){p.matcap&&(f.matcap.value=p.matcap)}function S(f,p){let _=e.get(p).light;f.referencePosition.value.setFromMatrixPosition(_.matrixWorld),f.nearDistance.value=_.shadow.camera.near,f.farDistance.value=_.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function dy(i,e,t,n){let s={},r={};function a(_,M){let w=M.program;n.uniformBlockBinding(_,w,s[_.id])}function o(_,M){let w=s[_.id];w===void 0&&(g(_),w=l(_),s[_.id]=w,_.addEventListener("dispose",f));let C=M.program;n.updateUBOMapping(_,C);let b=e.render.frame;r[_.id]!==b&&(c(_),r[_.id]=b)}function l(_){let M=i.createBuffer(),w=_.__size,C=_.usage;return i.bindBuffer(i.UNIFORM_BUFFER,M),i.bufferData(i.UNIFORM_BUFFER,w,C),i.bindBuffer(i.UNIFORM_BUFFER,null),M}function c(_){let M=s[_.id],w=_.uniforms,C=_.__cache;i.bindBuffer(i.UNIFORM_BUFFER,M);for(let b=0,x=w.length;b<x;b++){let v=w[b];if(Array.isArray(v))for(let A=0,R=v.length;A<R;A++)u(v[A],b,A,C);else u(v,b,0,C)}i.bindBuffer(i.UNIFORM_BUFFER,null)}function u(_,M,w,C){if(h(_,M,w,C)===!0){let b=_.__offset,x=_.value;if(Array.isArray(x)){let v=0;for(let A=0;A<x.length;A++){let R=x[A],L=S(R,!0);d(R,_.__data,v),v+=L.storage/Float32Array.BYTES_PER_ELEMENT}}else d(x,_.__data,0);i.bufferSubData(i.UNIFORM_BUFFER,b,_.__data)}}function d(_,M,w){typeof _=="number"||typeof _=="boolean"?M[w]=_:_.isMatrix3?(M[w]=_.elements[0],M[w+1]=_.elements[1],M[w+2]=_.elements[2],M[w+3]=0,M[w+4]=_.elements[3],M[w+5]=_.elements[4],M[w+6]=_.elements[5],M[w+7]=0,M[w+8]=_.elements[6],M[w+9]=_.elements[7],M[w+10]=_.elements[8],M[w+11]=0):ArrayBuffer.isView(_)?M.set(_.subarray(0,M.length-w),w):_.toArray(M,w)}function h(_,M,w,C){let b=_.value,x=M+"_"+w;if(Array.isArray(b)){C[x]===void 0&&(C[x]=[]);let v=C[x],A=!1;for(let R=0;R<b.length;R++)m(b[R],v,R)===!0&&(A=!0);return A}return m(b,C,x)}function m(_,M,w){if(M[w]===void 0)return typeof _=="number"||typeof _=="boolean"?M[w]=_:ArrayBuffer.isView(_)?M[w]=_.slice():M[w]=_.clone(),!0;{let C=M[w];if(typeof _=="number"||typeof _=="boolean"){if(C!==_)return M[w]=_,!0}else{if(ArrayBuffer.isView(_))return!0;if(C.equals(_)===!1)return C.copy(_),!0}}return!1}function g(_){let M=_.uniforms,w=0,C=16;for(let x=0,v=M.length;x<v;x++){let A=Array.isArray(M[x])?M[x]:[M[x]];for(let R=0,L=A.length;R<L;R++){let N=A[R],B=Array.isArray(N.value)?N.value:[N.value],D=Array.isArray(M[x])||Array.isArray(N.value),W=w;for(let Y=0,H=B.length;Y<H;Y++){let F=B[Y],$=S(F,D),ee=w%C,ae=ee%$.boundary,ge=ee+ae;w+=ae,ge!==0&&C-ge<$.storage&&(w+=C-ge),Y===0&&(W=w),w+=$.storage}let V=N.type==="int"?Int32Array:N.type==="uint"?Uint32Array:Float32Array;N.__data=new V((w-W)/Float32Array.BYTES_PER_ELEMENT),N.__offset=W}}let b=w%C;return b>0&&(w+=C-b),_.__size=w,_.__cache={},this}function S(_,M){let w={boundary:0,storage:0};return typeof _=="number"||typeof _=="boolean"?(w.boundary=4,w.storage=4):_.isVector2?(w.boundary=8,w.storage=8):_.isVector3||_.isColor?(w.boundary=16,w.storage=12):_.isVector4?(w.boundary=16,w.storage=16):_.isMatrix3?(w.boundary=16,w.storage=48):_.isMatrix4?(w.boundary=16,w.storage=64):_.isTexture?Le("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(_)?(w.boundary=16,w.storage=_.byteLength):Le("WebGLRenderer: Unsupported uniform value type.",_),M===!0&&(w.boundary=16,w.storage=Math.ceil(w.storage/16)*16),w}function f(_){let M=_.target;M.removeEventListener("dispose",f),i.deleteBuffer(s[M.id]),delete s[M.id],delete r[M.id]}function p(){for(let _ in s)i.deleteBuffer(s[_]);s={},r={}}return{bind:a,update:o,dispose:p}}var fy=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),si=null;function py(){return si===null&&(si=new is(fy,16,16,Vi,hn),si.name="DFG_LUT",si.minFilter=Wt,si.magFilter=Wt,si.wrapS=jn,si.wrapT=jn,si.generateMipmaps=!1,si.needsUpdate=!0),si}var ml=class{constructor(e={}){let{canvas:t=cd(),context:n=null,depth:s=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:h=!1,outputBufferType:m=sn}=e;this.isWebGLRenderer=!0;let g;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");g=n.getContextAttributes().alpha}else g=a;let S=m,f=new Set([Do,Lo,Io]),p=new Set([sn,Tn,Qs,us,Ro,Po]),_=new Uint32Array(4),M=new Int32Array(4),w={textures:[],min:[],max:[],resolution:[]},C=null,b=null,x=[],v=[],A=null;this.domElement=t,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=ii,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let R=this,L=!1,N=null,B=null,D=null,W=null;this._outputColorSpace=tn;let V=0,Y=0,H=null,F=-1,$=null,ee=new pt,ae=new pt,ge=null,J=new me(0),xe=0,be=t.width,Ae=t.height,pe=1,Ue=null,dt=null,Te=new pt(0,0,be,Ae),st=new pt(0,0,be,Ae),tt=!1,Ye=new ki,Dt=new to,Mt=!1,qt=!1,mt=new Ve,_n=new k,yt=new pt,fn={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},an=!1;function on(){return H===null?pe:1}let z=n;function Ft(T,O){return t.getContext(T,O)}let nt,ot,de,Et,Ie,Fe,I,E,P,q,K,ie,oe,Q,te,ce,U,ne,j,he,re,le,Ce;try{let T={alpha:!0,depth:s,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:u,failIfMajorPerformanceCaveat:d};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"187"}`),t.addEventListener("webglcontextlost",Pe,!1),t.addEventListener("webglcontextrestored",Ge,!1),t.addEventListener("webglcontextcreationerror",ve,!1),z===null){let O="webgl2";if(z=Ft(O,T),z===null)throw Ft(O)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}Xe()}catch(T){throw t.removeEventListener("webglcontextlost",Pe,!1),t.removeEventListener("webglcontextrestored",Ge,!1),t.removeEventListener("webglcontextcreationerror",ve,!1),Ne("WebGLRenderer: "+T.message),T}function Xe(){nt=new Ex(z),nt.init(),re=new oy(z,nt),ot=new px(z,nt,e,re),de=new ry(z,nt),ot.reversedDepthBuffer&&h&&de.buffers.depth.setReversed(!0),B=z.createFramebuffer(),D=z.createFramebuffer(),W=z.createFramebuffer(),Et=new Cx(z),Ie=new Xv,Fe=new ay(z,nt,de,Ie,ot,re,Et),I=new wx(R),E=new Pm(z),le=new dx(z,E),P=new Tx(z,E,Et,le),q=new Px(z,P,E,le,Et),ne=new Rx(z,ot,Fe),te=new mx(Ie),K=new Wv(R,I,nt,ot,le,te),ie=new uy(R,Ie),oe=new Yv,Q=new Qv(nt),U=new ux(R,I,de,q,g,l),ce=new sy(R,q,ot),Ce=new dy(z,Et,ot,de),j=new fx(z,nt,Et),he=new Ax(z,nt,Et),Et.programs=K.programs,R.capabilities=ot,R.extensions=nt,R.properties=Ie,R.renderLists=oe,R.shadowMap=ce,R.state=de,R.info=Et}S!==sn&&(A=new Lx(S,t.width,t.height,o,s,r));let se=new sh(R,z);this.xr=se,this.getContext=function(){return z},this.getContextAttributes=function(){return z.getContextAttributes()},this.forceContextLoss=function(){let T=nt.get("WEBGL_lose_context");T&&T.loseContext()},this.forceContextRestore=function(){let T=nt.get("WEBGL_lose_context");T&&T.restoreContext()},this.getPixelRatio=function(){return pe},this.setPixelRatio=function(T){T!==void 0&&(pe=T,this.setSize(be,Ae,!1))},this.getSize=function(T){return T.set(be,Ae)},this.setSize=function(T,O,Z=!0){if(se.isPresenting){Le("WebGLRenderer: Can't change size while VR device is presenting.");return}be=T,Ae=O,t.width=Math.floor(T*pe),t.height=Math.floor(O*pe),Z===!0&&(t.style.width=T+"px",t.style.height=O+"px"),A!==null&&A.setSize(t.width,t.height),this.setViewport(0,0,T,O)},this.getDrawingBufferSize=function(T){return T.set(be*pe,Ae*pe).floor()},this.setDrawingBufferSize=function(T,O,Z){be=T,Ae=O,pe=Z,t.width=Math.floor(T*Z),t.height=Math.floor(O*Z),this.setViewport(0,0,T,O)},this.setEffects=function(T){if(S===sn){Ne("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(T){for(let O=0;O<T.length;O++)if(T[O].isOutputPass===!0){Le("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}A.setEffects(T||[])},this.getCurrentViewport=function(T){return T.copy(ee)},this.getViewport=function(T){return T.copy(Te)},this.setViewport=function(T,O,Z,G){T.isVector4?Te.set(T.x,T.y,T.z,T.w):Te.set(T,O,Z,G),de.viewport(ee.copy(Te).multiplyScalar(on()).round())},this.getScissor=function(T){return T.copy(st)},this.setScissor=function(T,O,Z,G){T.isVector4?st.set(T.x,T.y,T.z,T.w):st.set(T,O,Z,G),de.scissor(ae.copy(st).multiplyScalar(on()).round())},this.getScissorTest=function(){return tt},this.setScissorTest=function(T){de.setScissorTest(tt=T)},this.setOpaqueSort=function(T){Ue=T},this.setTransparentSort=function(T){dt=T},this.getClearColor=function(T){return T.copy(U.getClearColor())},this.setClearColor=function(){U.setClearColor(...arguments)},this.getClearAlpha=function(){return U.getClearAlpha()},this.setClearAlpha=function(){U.setClearAlpha(...arguments)},this.clear=function(T=!0,O=!0,Z=!0){let G=0;if(T){let X=!1;if(H!==null){let fe=H.texture.format;X=f.has(fe)}if(X){let fe=H.texture.type,Se=p.has(fe),ue=U.getClearColor(),_e=U.getClearAlpha(),Ee=ue.r,ke=ue.g,Je=ue.b;Se?(_[0]=Ee,_[1]=ke,_[2]=Je,_[3]=_e,z.clearBufferuiv(z.COLOR,0,_)):(M[0]=Ee,M[1]=ke,M[2]=Je,M[3]=_e,z.clearBufferiv(z.COLOR,0,M))}else G|=z.COLOR_BUFFER_BIT}O&&(G|=z.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),Z&&(G|=z.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),G!==0&&z.clear(G)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(T){T.setRenderer(this),N=T},this.dispose=function(){t.removeEventListener("webglcontextlost",Pe,!1),t.removeEventListener("webglcontextrestored",Ge,!1),t.removeEventListener("webglcontextcreationerror",ve,!1),U.dispose(),oe.dispose(),Q.dispose(),Fe.dispose(),Ie.dispose(),I.dispose(),q.dispose(),P.dispose(),le.dispose(),Ce.dispose(),K.dispose(),se.dispose(),se.removeEventListener("sessionstart",Ch),se.removeEventListener("sessionend",Rh),Zi.stop()};function Pe(T){T.preventDefault(),Hc("WebGLRenderer: Context Lost."),L=!0}function Ge(){Hc("WebGLRenderer: Context Restored."),L=!1;let T=Et.autoReset,O=ce.enabled,Z=ce.autoUpdate,G=ce.needsUpdate,X=ce.type;Xe(),Et.autoReset=T,ce.enabled=O,ce.autoUpdate=Z,ce.needsUpdate=G,ce.type=X}function ve(T){Ne("WebGLRenderer: A WebGL context could not be created. Reason: ",T.statusMessage)}function ct(T){let O=T.target;O.removeEventListener("dispose",ct),Ht(O)}function Ht(T){Ci(T),Ie.remove(T)}function Ci(T){let O=Ie.get(T).programs;O!==void 0&&(O.forEach(function(Z){K.releaseProgram(Z)}),T.isShaderMaterial&&K.releaseShaderCache(T))}this.renderBufferDirect=function(T,O,Z,G,X,fe){O===null&&(O=fn);let Se=X.isMesh&&X.matrixWorld.determinantAffine()<0,ue=Ep(T,O,Z,G,X);de.setMaterial(G,Se);let _e=Z.index,Ee=1;if(G.wireframe===!0){if(_e=P.getWireframeAttribute(Z),_e===void 0)return;Ee=2}let ke=Z.drawRange,Je=Z.attributes.position,Me=ke.start*Ee,Ke=(ke.start+ke.count)*Ee;fe!==null&&(Me=Math.max(Me,fe.start*Ee),Ke=Math.min(Ke,(fe.start+fe.count)*Ee)),_e!==null?(Me=Math.max(Me,0),Ke=Math.min(Ke,_e.count)):Je!=null&&(Me=Math.max(Me,0),Ke=Math.min(Ke,Je.count));let Nt=Ke-Me;if(Nt<0||Nt===1/0)return;le.setup(X,G,ue,Z,_e);let gt,ft=j;if(_e!==null&&(gt=E.get(_e),ft=he,ft.setIndex(gt)),X.isMesh)G.wireframe===!0?(de.setLineWidth(G.wireframeLinewidth*on()),ft.setMode(z.LINES)):ft.setMode(z.TRIANGLES);else if(X.isLine){let Jt=G.linewidth;Jt===void 0&&(Jt=1),de.setLineWidth(Jt*on()),X.isLineSegments?ft.setMode(z.LINES):X.isLineLoop?ft.setMode(z.LINE_LOOP):ft.setMode(z.LINE_STRIP)}else X.isPoints?ft.setMode(z.POINTS):X.isSprite&&ft.setMode(z.TRIANGLES);if(X.isBatchedMesh)if(nt.get("WEBGL_multi_draw"))ft.renderMultiDraw(X._multiDrawStarts,X._multiDrawCounts,X._multiDrawCount);else{let Jt=X._multiDrawStarts,we=X._multiDrawCounts,ln=X._multiDrawCount,rt=_e?E.get(_e).bytesPerElement:1,Ji=Ie.get(G).currentProgram.getUniforms();for(let Kt=0;Kt<ln;Kt++)Ji.setValue(z,"_gl_DrawID",Kt),ft.render(Jt[Kt]/rt,we[Kt])}else if(X.isInstancedMesh)ft.renderInstances(Me,Nt,X.count);else if(Z.isInstancedBufferGeometry){let Jt=Z._maxInstanceCount!==void 0?Z._maxInstanceCount:1/0,we=Math.min(Z.instanceCount,Jt);ft.renderInstances(Me,Nt,we)}else ft.render(Me,Nt)};function Ah(T,O,Z,G){N!==null&&T.isNodeMaterial&&N.setObject(G,T),Mt===!0&&te.setState(T,Z,!1),T.transparent===!0&&T.side===Rn&&T.forceSinglePass===!1?(T.side=Zt,T.needsUpdate=!0,hr(T,O,G),T.side=Gi,T.needsUpdate=!0,hr(T,O,G),T.side=Rn):hr(T,O,G)}this.compile=function(T,O,Z=null){Z===null&&(Z=T),N!==null&&N.renderStart(T,O,Z),b=Q.get(Z),b.init(O),v.push(b),Z.traverseVisible(function(X){X.isLight&&X.layers.test(O.layers)&&(b.pushLight(X),X.castShadow&&b.pushShadow(X))}),T!==Z&&T.traverseVisible(function(X){X.isLight&&X.layers.test(O.layers)&&(b.pushLight(X),X.castShadow&&b.pushShadow(X))}),b.setupLights(),N!==null&&N.updateLights(b.state.lightsArray),qt=this.localClippingEnabled,Mt=te.init(this.clippingPlanes,qt),Mt===!0&&te.setGlobalState(this.clippingPlanes,O),N!==null&&ce.render(b.state.shadowsArray,Z,O);let G=new Set;return T.traverse(function(X){if(!(X.isMesh||X.isPoints||X.isLine||X.isSprite))return;let fe=X.material;if(fe)if(Array.isArray(fe))for(let Se=0;Se<fe.length;Se++){let ue=fe[Se];Ah(ue,Z,O,X),G.add(ue)}else Ah(fe,Z,O,X),G.add(fe)}),b=v.pop(),N!==null&&N.renderEnd(),G},this.compileAsync=function(T,O,Z=null){let G=this.compile(T,O,Z);return new Promise(X=>{function fe(){if(G.forEach(function(Se){let _e=Ie.get(Se).currentProgram;(_e===void 0||_e.isReady())&&G.delete(Se)}),G.size===0){X(T);return}setTimeout(fe,10)}nt.get("KHR_parallel_shader_compile")!==null?fe():setTimeout(fe,10)})};let Fl=null;function Mp(T){Fl&&Fl(T)}function Ch(){Zi.stop()}function Rh(){Zi.start()}let Zi=new Bd;Zi.setAnimationLoop(Mp),typeof self<"u"&&Zi.setContext(self),this.setAnimationLoop=function(T){Fl=T,se.setAnimationLoop(T),T===null?Zi.stop():Zi.start()},se.addEventListener("sessionstart",Ch),se.addEventListener("sessionend",Rh),this.render=function(T,O){if(O!==void 0&&O.isCamera!==!0){Ne("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(L===!0)return;N!==null&&N.renderStart(T,O);let Z=se.enabled===!0&&se.isPresenting===!0,G=A!==null&&(H===null||Z)&&A.begin(R,H);if(T.matrixWorldAutoUpdate===!0&&T.updateMatrixWorld(),O.parent===null&&O.matrixWorldAutoUpdate===!0&&O.updateMatrixWorld(),se.enabled===!0&&se.isPresenting===!0&&(A===null||A.isCompositing()===!1)&&(se.cameraAutoUpdate===!0&&se.updateCamera(O),O=se.getCamera()),T.isScene===!0&&T.onBeforeRender(R,T,O,H),b=Q.get(T,v.length),b.init(O),b.state.textureUnits=Fe.getTextureUnits(),v.push(b),mt.multiplyMatrices(O.projectionMatrix,O.matrixWorldInverse),O.isArrayCamera?Dt.setFromArrayCamera(O):Ye.setFromProjectionMatrix(mt,Cn,O.reversedDepth),qt=this.localClippingEnabled,Mt=te.init(this.clippingPlanes,qt),C=oe.get(T,x.length),C.init(),x.push(C),this.info.render.frame++,se.enabled===!0&&se.isPresenting===!0){let Se=R.xr.getDepthSensingMesh();Se!==null&&Ol(Se,O,-1/0,R.sortObjects)}Ol(T,O,0,R.sortObjects),C.finish(),N!==null&&N.updateLights(b.state.lightsArray),R.sortObjects===!0&&C.sort(Ue,dt),an=se.enabled===!1||se.isPresenting===!1||se.hasDepthSensing()===!1,an&&U.addToRenderList(C,T),this.info.autoReset===!0&&this.info.reset(),Mt===!0&&te.beginShadows();let X=b.state.shadowsArray;if(ce.render(X,T,O),Mt===!0&&te.endShadows(),(G&&A.hasRenderPass())===!1){let Se=C.opaque,ue=C.transmissive;if(b.setupLights(),O.isArrayCamera){let _e=O.cameras;if(ue.length>0)for(let Ee=0,ke=_e.length;Ee<ke;Ee++){let Je=_e[Ee];Ih(Se,ue,T,Je)}an&&U.render(T);for(let Ee=0,ke=_e.length;Ee<ke;Ee++){let Je=_e[Ee];Ph(C,T,Je,Je.viewport)}}else ue.length>0&&Ih(Se,ue,T,O),an&&U.render(T),Ph(C,T,O)}H!==null&&Y===0&&(Fe.updateMultisampleRenderTarget(H),Fe.updateRenderTargetMipmap(H)),G&&A.end(R),T.isScene===!0&&T.onAfterRender(R,T,O),le.resetDefaultState(),F=-1,$=null,v.pop(),v.length>0?(b=v[v.length-1],Fe.setTextureUnits(b.state.textureUnits),Mt===!0&&te.setGlobalState(R.clippingPlanes,b.state.camera)):b=null,x.pop(),x.length>0?C=x[x.length-1]:C=null,N!==null&&N.renderEnd()};function Ol(T,O,Z,G){if(T.visible===!1)return;if(T.layers.test(O.layers)){if(T.isGroup)Z=T.renderOrder;else if(T.isLOD)T.autoUpdate===!0&&T.update(O);else if(T.isLight)b.pushLight(T),T.castShadow&&b.pushShadow(T);else if(T.isSprite){let Se=O.isArrayCamera?Dt:Ye;if(!T.frustumCulled||T.intersectsFrustum(Se)){G&&yt.setFromMatrixPosition(T.matrixWorld).applyMatrix4(mt);let ue=q.update(T),_e=T.material;_e.visible&&C.push(T,ue,_e,Z,yt.z,null,O)}}else if(T.isMesh||T.isLine||T.isPoints){let Se=O.isArrayCamera?Dt:Ye;if(!T.frustumCulled||T.intersectsFrustum(Se)){let ue=q.update(T),_e=T.material;if(G&&(T.boundingSphere!==void 0?(T.boundingSphere===null&&T.computeBoundingSphere(),yt.copy(T.boundingSphere.center)):(ue.boundingSphere===null&&ue.computeBoundingSphere(),yt.copy(ue.boundingSphere.center)),yt.applyMatrix4(T.matrixWorld).applyMatrix4(mt)),Array.isArray(_e)){let Ee=ue.groups;for(let ke=0,Je=Ee.length;ke<Je;ke++){let Me=Ee[ke],Ke=_e[Me.materialIndex];Ke&&Ke.visible&&C.push(T,ue,Ke,Z,yt.z,Me,O)}}else _e.visible&&C.push(T,ue,_e,Z,yt.z,null,O)}}}let fe=T.children;for(let Se=0,ue=fe.length;Se<ue;Se++)Ol(fe[Se],O,Z,G)}function Ph(T,O,Z,G){let{opaque:X,transmissive:fe,transparent:Se}=T;b.setupLightsView(Z),Mt===!0&&te.setGlobalState(R.clippingPlanes,Z),G&&de.viewport(ee.copy(G)),X.length>0&&oa(X,O,Z),fe.length>0&&oa(fe,O,Z),Se.length>0&&oa(Se,O,Z),de.buffers.depth.setTest(!0),de.buffers.depth.setMask(!0),de.buffers.color.setMask(!0),de.setPolygonOffset(!1)}function Ih(T,O,Z,G){if((Z.isScene===!0?Z.overrideMaterial:null)!==null)return;if(b.state.transmissionRenderTarget[G.id]===void 0){let Me=nt.has("EXT_color_buffer_half_float")||nt.has("EXT_color_buffer_float");b.state.transmissionRenderTarget[G.id]=new $t(1,1,{generateMipmaps:!0,type:Me?hn:sn,minFilter:wi,samples:Math.max(4,ot.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:je.workingColorSpace})}let fe=b.state.transmissionRenderTarget[G.id],Se=G.viewport||ee;fe.setSize(Se.z*R.transmissionResolutionScale,Se.w*R.transmissionResolutionScale);let ue=R.getRenderTarget(),_e=R.getActiveCubeFace(),Ee=R.getActiveMipmapLevel();R.setRenderTarget(fe),R.getClearColor(J),xe=R.getClearAlpha(),xe<1&&R.setClearColor(16777215,.5),R.clear(),an&&U.render(Z);let ke=R.toneMapping;R.toneMapping=ii;let Je=G.viewport;if(G.viewport!==void 0&&(G.viewport=void 0),b.setupLightsView(G),Mt===!0&&te.setGlobalState(R.clippingPlanes,G),oa(T,Z,G),Fe.updateMultisampleRenderTarget(fe),Fe.updateRenderTargetMipmap(fe),nt.has("WEBGL_multisampled_render_to_texture")===!1){let Me=!1;for(let Ke=0,Nt=O.length;Ke<Nt;Ke++){let gt=O[Ke],{object:ft,geometry:Jt,material:we,group:ln}=gt;if(we.side===Rn&&ft.layers.test(G.layers)){let rt=we.side;we.side=Zt,we.needsUpdate=!0,Lh(ft,Z,G,Jt,we,ln),we.side=rt,we.needsUpdate=!0,Me=!0}}Me===!0&&(Fe.updateMultisampleRenderTarget(fe),Fe.updateRenderTargetMipmap(fe))}R.setRenderTarget(ue,_e,Ee),R.setClearColor(J,xe),Je!==void 0&&(G.viewport=Je),R.toneMapping=ke}function oa(T,O,Z){let G=O.isScene===!0?O.overrideMaterial:null;for(let X=0,fe=T.length;X<fe;X++){let Se=T[X],{object:ue,geometry:_e,group:Ee}=Se,ke=Se.material;ke.allowOverride===!0&&G!==null&&(ke=G),ue.layers.test(Z.layers)&&Lh(ue,O,Z,_e,ke,Ee)}}function Lh(T,O,Z,G,X,fe){N!==null&&X.isNodeMaterial&&N.setObject(T,X),T.onBeforeRender(R,O,Z,G,X,fe),T.modelViewMatrix.multiplyMatrices(Z.matrixWorldInverse,T.matrixWorld),T.normalMatrix.getNormalMatrix(T.modelViewMatrix),X.onBeforeRender(R,O,Z,G,T,fe),X.transparent===!0&&X.side===Rn&&X.forceSinglePass===!1?(X.side=Zt,X.needsUpdate=!0,R.renderBufferDirect(Z,O,G,X,T,fe),X.side=Gi,X.needsUpdate=!0,R.renderBufferDirect(Z,O,G,X,T,fe),X.side=Rn):R.renderBufferDirect(Z,O,G,X,T,fe),T.onAfterRender(R,O,Z,G,X,fe)}function Dh(T){let O=0;for(let Z of T)Z.texture!==null&&O++;return O}function hr(T,O,Z){O.isScene!==!0&&(O=fn);let G=Ie.get(T),X=b.state.lights,fe=b.state.shadowsArray,Se=X.state.version,ue=K.getParameters(T,X.state,fe,O,Z,b.state.lightProbeGridArray),_e=K.getProgramCacheKey(ue),Ee=G.programs;G.environment=T.isMeshStandardMaterial||T.isMeshLambertMaterial||T.isMeshPhongMaterial?O.environment:null,G.fog=O.fog;let ke=T.isMeshStandardMaterial||T.isMeshLambertMaterial&&!T.envMap||T.isMeshPhongMaterial&&!T.envMap;G.envMap=I.get(T.envMap||G.environment,ke),G.envMapRotation=G.environment!==null&&T.envMap===null?O.environmentRotation:T.envMapRotation,Ee===void 0&&(T.addEventListener("dispose",ct),Ee=new Map,G.programs=Ee,G.programVariants=new Map);let Je=Ee.get(_e);if(Je!==void 0){if(G.currentProgram===Je&&G.lightsStateVersion===Se)return Uh(T,ue),Je}else ue.uniforms=K.getUniforms(T),N!==null&&T.isNodeMaterial&&N.build(T,Z,ue),T.onBeforeCompile(ue,R),Je=K.acquireProgram(ue,_e),Ee.set(_e,Je),G.uniforms=ue.uniforms;let Me=G.uniforms;return(!T.isShaderMaterial&&!T.isRawShaderMaterial||T.clipping===!0)&&(Me.clippingPlanes=te.uniform),Uh(T,ue),G.needsLights=Ap(T),G.lightsStateVersion=Se,G.needsLights&&(Me.ambientLightColor.value=X.state.ambient,Me.lightProbe.value=X.state.probe,Me.sunLights.value=X.state.sun,Me.sunLightShadows.value=X.state.sunShadow,Me.directionalLights.value=X.state.directional,Me.directionalLightShadows.value=X.state.directionalShadow,Me.spotLights.value=X.state.spot,Me.spotLightShadows.value=X.state.spotShadow,Me.rectAreaLights.value=X.state.rectArea,Me.ltc_1.value=X.state.rectAreaLTC1,Me.ltc_2.value=X.state.rectAreaLTC2,Me.pointLights.value=X.state.point,Me.pointLightShadows.value=X.state.pointShadow,Me.hemisphereLights.value=X.state.hemi,Me.sunShadowMatrix.value=X.state.sunShadowMatrix,Me.sunShadowCascade.value=X.state.sunShadowCascade,Me.directionalShadowMatrix.value=X.state.directionalShadowMatrix,Me.spotLightMatrix.value=X.state.spotLightMatrix,Me.spotLightMap.value=X.state.spotLightMap,Me.pointShadowMatrix.value=X.state.pointShadowMatrix),G.numLightProbeGrids=Dh(b.state.lightProbeGridArray),G.currentProgram=Je,G.uniformsList=null,Je}function wp(T,O,Z,G,X){let fe=Ie.get(T),Se=fe.currentProgram.id+","+G+","+X,ue=fe.programVariants.get(Se);return ue===void 0?(ue=hr(T,O,Z),fe.programVariants.set(Se,ue)):(fe.currentProgram=ue,fe.uniformsList=null,fe.outputColorSpace=G,fe.toneMapping=X),ue}function Nh(T){if(T.uniformsList===null){let O=T.currentProgram.getUniforms();T.uniformsList=nr.seqWithValue(O.seq,T.uniforms)}return T.uniformsList}function Uh(T,O){let Z=Ie.get(T);Z.outputColorSpace=O.outputColorSpace,Z.batching=O.batching,Z.batchingColor=O.batchingColor,Z.instancing=O.instancing,Z.instancingColor=O.instancingColor,Z.instancingMorph=O.instancingMorph,Z.skinning=O.skinning,Z.morphTargets=O.morphTargets,Z.morphNormals=O.morphNormals,Z.morphColors=O.morphColors,Z.morphTargetsCount=O.morphTargetsCount,Z.numClippingPlanes=O.numClippingPlanes,Z.numIntersection=O.numClipIntersection,Z.vertexAlphas=O.vertexAlphas,Z.vertexTangents=O.vertexTangents,Z.toneMapping=O.toneMapping}function Ep(T,O,Z,G,X){O.isScene!==!0&&(O=fn),Fe.resetTextureUnits();let fe=O.fog,Se=G.isMeshStandardMaterial||G.isMeshLambertMaterial||G.isMeshPhongMaterial?O.environment:null,ue=H===null?R.outputColorSpace:H.isXRRenderTarget===!0?H.texture.colorSpace:je.workingColorSpace,_e=G.isMeshStandardMaterial||G.isMeshLambertMaterial&&!G.envMap||G.isMeshPhongMaterial&&!G.envMap,Ee=I.get(G.envMap||Se,_e),ke=G.vertexColors===!0&&!!Z.attributes.color&&Z.attributes.color.itemSize===4,Je=!!Z.attributes.tangent&&(!!G.normalMap||G.anisotropy>0),Me=!!Z.morphAttributes.position,Ke=!!Z.morphAttributes.normal,Nt=!!Z.morphAttributes.color,gt=ii;G.toneMapped&&(H===null||H.isXRRenderTarget===!0)&&(gt=R.toneMapping);let ft=Z.morphAttributes.position||Z.morphAttributes.normal||Z.morphAttributes.color,Jt=ft!==void 0?ft.length:0,we=Ie.get(G),ln=b.state.lights;if(Mt===!0&&(qt===!0||T!==$)){let _t=T===$&&G.id===F;te.setState(G,T,_t)}let rt=!1,Ji=!1;G.version===we.__version?we.needsLights&&we.lightsStateVersion!==ln.state.version||X.isBatchedMesh&&we.batching===!1||!X.isBatchedMesh&&we.batching===!0||X.isBatchedMesh&&we.batchingColor===!0&&X._colorsTexture===null||X.isBatchedMesh&&we.batchingColor===!1&&X._colorsTexture!==null||X.isInstancedMesh&&we.instancing===!1||!X.isInstancedMesh&&we.instancing===!0||X.isSkinnedMesh&&we.skinning===!1||!X.isSkinnedMesh&&we.skinning===!0||X.isInstancedMesh&&we.instancingColor===!0&&X.instanceColor===null||X.isInstancedMesh&&we.instancingColor===!1&&X.instanceColor!==null||X.isInstancedMesh&&we.instancingMorph===!0&&X.morphTexture===null||X.isInstancedMesh&&we.instancingMorph===!1&&X.morphTexture!==null||we.envMap!==Ee||G.fog===!0&&we.fog!==fe||we.numClippingPlanes!==void 0&&(we.numClippingPlanes!==te.numPlanes||we.numIntersection!==te.numIntersection)||we.vertexAlphas!==ke||we.vertexTangents!==Je||we.morphTargets!==Me||we.morphNormals!==Ke||we.morphColors!==Nt||we.morphTargetsCount!==Jt||we.numLightProbeGrids!==Dh(b.state.lightProbeGridArray)?rt=!0:(we.outputColorSpace!==ue||we.toneMapping!==gt)&&(Ji=!0):(rt=!0,we.__version=G.version);let Kt=we.currentProgram;(rt===!0||Ji===!0)&&(Kt=Ji===!0?wp(G,O,X,ue,gt):hr(G,O,X),N&&G.isNodeMaterial&&N.onUpdateProgram(G,Kt,we));let la=!1,Ri=!1,Ki=!1,it=Kt.getUniforms(),Yt=we.uniforms;if(de.useProgram(Kt.program)&&(la=!0,Ri=!0,Ki=!0),G.id!==F&&(F=G.id,Ri=!0),la||$!==T){de.buffers.depth.getReversed()&&T.reversedDepth!==!0&&(T._reversedDepth=!0,T.updateProjectionMatrix()),it.setValue(z,"projectionMatrix",T.projectionMatrix),it.setValue(z,"viewMatrix",T.matrixWorldInverse);let Gt=it.map.cameraPosition;Gt!==void 0&&Gt.setValue(z,_n.setFromMatrixPosition(T.matrixWorld)),ot.logarithmicDepthBuffer&&it.setValue(z,"logDepthBufFC",2/(Math.log(T.far+1)/Math.LN2)),(G.isMeshPhongMaterial||G.isMeshToonMaterial||G.isMeshLambertMaterial||G.isMeshBasicMaterial||G.isMeshStandardMaterial||G.isShaderMaterial)&&it.setValue(z,"isOrthographic",T.isOrthographicCamera===!0),$!==T&&($=T,Ri=!0,Ki=!0)}if(we.needsLights&&(ln.state.sunShadowMap.length>0&&it.setValue(z,"sunShadowMap",ln.state.sunShadowMap,Fe),ln.state.directionalShadowMap.length>0&&it.setValue(z,"directionalShadowMap",ln.state.directionalShadowMap,Fe),ln.state.spotShadowMap.length>0&&it.setValue(z,"spotShadowMap",ln.state.spotShadowMap,Fe),ln.state.pointShadowMap.length>0&&it.setValue(z,"pointShadowMap",ln.state.pointShadowMap,Fe)),X.isSkinnedMesh){it.setOptional(z,X,"bindMatrix"),it.setOptional(z,X,"bindMatrixInverse");let _t=X.skeleton;_t&&(_t.boneTexture===null&&_t.computeBoneTexture(),it.setValue(z,"boneTexture",_t.boneTexture,Fe))}X.isBatchedMesh&&(it.setOptional(z,X,"batchingTexture"),it.setValue(z,"batchingTexture",X._matricesTexture,Fe),it.setOptional(z,X,"batchingIdTexture"),it.setValue(z,"batchingIdTexture",X._indirectTexture,Fe),it.setOptional(z,X,"batchingColorTexture"),X._colorsTexture!==null&&it.setValue(z,"batchingColorTexture",X._colorsTexture,Fe));let Un=Z.morphAttributes;if((Un.position!==void 0||Un.normal!==void 0||Un.color!==void 0)&&ne.update(X,Z,Kt),(Ri||we.receiveShadow!==X.receiveShadow)&&(we.receiveShadow=X.receiveShadow,it.setValue(z,"receiveShadow",X.receiveShadow)),(G.isMeshStandardMaterial||G.isMeshLambertMaterial||G.isMeshPhongMaterial)&&G.envMap===null&&O.environment!==null&&(Yt.envMapIntensity.value=O.environmentIntensity),Yt.dfgLUT!==void 0&&(Yt.dfgLUT.value=py()),Ri){if(it.setValue(z,"toneMappingExposure",R.toneMappingExposure),we.needsLights&&Tp(Yt,Ki),fe&&G.fog===!0&&ie.refreshFogUniforms(Yt,fe),ie.refreshMaterialUniforms(Yt,G,pe,Ae,b.state.transmissionRenderTarget[T.id]),we.needsLights&&we.numLightProbeGrids>0){let _t=w,Gt=0;for(let ui of b.state.lightProbeGridArray)ui.texture!==null&&(_t.textures[Gt]=ui.texture,_t.min[Gt]=ui.boundingBox.min,_t.max[Gt]=ui.boundingBox.max,_t.resolution[Gt]=ui.resolution,Gt++);for(let ui in _t)_t[ui].length=Gt;Yt.probesSH.value=_t.textures,Yt.probesMin.value=_t.min,Yt.probesMax.value=_t.max,Yt.probesResolution.value=_t.resolution}nr.upload(z,Nh(we),Yt,Fe)}if(G.isShaderMaterial&&G.uniformsNeedUpdate===!0&&(nr.upload(z,Nh(we),Yt,Fe),G.uniformsNeedUpdate=!1),G.isSpriteMaterial&&it.setValue(z,"center",X.center),it.setValue(z,"modelViewMatrix",X.modelViewMatrix),it.setValue(z,"normalMatrix",X.normalMatrix),it.setValue(z,"modelMatrix",X.matrixWorld),G.uniformsGroups!==void 0){let _t=G.uniformsGroups;for(let Gt=0,ui=_t.length;Gt<ui;Gt++){let Oh=_t[Gt];Ce.update(Oh,Kt),Ce.bind(Oh,Kt)}}return Kt}function Tp(T,O){T.ambientLightColor.needsUpdate=O,T.lightProbe.needsUpdate=O,T.sunLights.needsUpdate=O,T.sunLightShadows.needsUpdate=O,T.directionalLights.needsUpdate=O,T.directionalLightShadows.needsUpdate=O,T.pointLights.needsUpdate=O,T.pointLightShadows.needsUpdate=O,T.spotLights.needsUpdate=O,T.spotLightShadows.needsUpdate=O,T.rectAreaLights.needsUpdate=O,T.hemisphereLights.needsUpdate=O}function Ap(T){return T.isMeshLambertMaterial||T.isMeshToonMaterial||T.isMeshPhongMaterial||T.isMeshStandardMaterial||T.isShadowMaterial||T.isShaderMaterial&&T.lights===!0}this.getActiveCubeFace=function(){return V},this.getActiveMipmapLevel=function(){return Y},this.getRenderTarget=function(){return H},this.setRenderTargetTextures=function(T,O,Z){let G=Ie.get(T);G.__autoAllocateDepthBuffer=T.resolveDepthBuffer===!1,G.__autoAllocateDepthBuffer===!1&&(G.__useRenderToTexture=!1),Ie.get(T.texture).__webglTexture=O,Ie.get(T.depthTexture).__webglTexture=G.__autoAllocateDepthBuffer?void 0:Z,G.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(T,O){let Z=Ie.get(T);Z.__webglFramebuffer=O,Z.__useDefaultFramebuffer=O===void 0},this.setRenderTarget=function(T,O=0,Z=0){H=T,V=O,Y=Z;let G=null,X=!1,fe=!1;if(T){let ue=Ie.get(T);if(ue.__useDefaultFramebuffer!==void 0){de.bindFramebuffer(z.FRAMEBUFFER,ue.__webglFramebuffer),ee.copy(T.viewport),ae.copy(T.scissor),ge=T.scissorTest,de.viewport(ee),de.scissor(ae),de.setScissorTest(ge),F=-1;return}else if(ue.__webglFramebuffer===void 0)Fe.setupRenderTarget(T);else if(ue.__hasExternalTextures)Fe.rebindTextures(T,Ie.get(T.texture).__webglTexture,Ie.get(T.depthTexture).__webglTexture);else if(T.depthBuffer){let ke=T.depthTexture;if(ue.__boundDepthTexture!==ke){if(ke!==null&&Ie.has(ke)&&(T.width!==ke.image.width||T.height!==ke.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");Fe.setupDepthRenderbuffer(T)}}let _e=T.texture;(_e.isData3DTexture||_e.isDataArrayTexture||_e.isCompressedArrayTexture)&&(fe=!0);let Ee=Ie.get(T).__webglFramebuffer;T.isWebGLCubeRenderTarget?(Array.isArray(Ee[O])?G=Ee[O][Z]:G=Ee[O],X=!0):T.samples>0&&Fe.useMultisampledRTT(T)===!1?G=Ie.get(T).__webglMultisampledFramebuffer:Array.isArray(Ee)?G=Ee[Z]:G=Ee,ee.copy(T.viewport),ae.copy(T.scissor),ge=T.scissorTest}else ee.copy(Te).multiplyScalar(pe).floor(),ae.copy(st).multiplyScalar(pe).floor(),ge=tt;if(Z!==0&&(G=B),de.bindFramebuffer(z.FRAMEBUFFER,G)&&de.drawBuffers(T,G),de.viewport(ee),de.scissor(ae),de.setScissorTest(ge),X){let ue=Ie.get(T.texture);z.framebufferTexture2D(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_CUBE_MAP_POSITIVE_X+O,ue.__webglTexture,Z)}else if(fe){let ue=O;for(let _e=0;_e<T.textures.length;_e++){let Ee=Ie.get(T.textures[_e]);z.framebufferTextureLayer(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0+_e,Ee.__webglTexture,Z,ue)}}else if(T!==null&&Z!==0){let ue=Ie.get(T.texture);z.framebufferTexture2D(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_2D,ue.__webglTexture,Z)}F=-1};function Fh(T){let O=Ie.get(T);return(O.__readFormat!==T.format||O.__readType!==T.type)&&(O.__readFormat=T.format,O.__readType=T.type,O.__formatReadable=ot.textureFormatReadable(T.format),O.__typeReadable=ot.textureTypeReadable(T.type)),O}this.readRenderTargetPixels=function(T,O,Z,G,X,fe,Se,ue=0){if(!(T&&T.isWebGLRenderTarget)){Ne("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let _e=Ie.get(T).__webglFramebuffer;if(T.isWebGLCubeRenderTarget&&Se!==void 0&&(_e=_e[Se],Array.isArray(_e)&&(_e=_e[0])),_e){de.bindFramebuffer(z.FRAMEBUFFER,_e);try{let Ee=T.textures[ue],ke=Ee.format,Je=Ee.type;T.textures.length>1&&z.readBuffer(z.COLOR_ATTACHMENT0+ue);let Me=Fh(Ee);if(Me.__formatReadable===!1){Ne("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(Me.__typeReadable===!1){Ne("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}O>=0&&O<=T.width-G&&Z>=0&&Z<=T.height-X&&z.readPixels(O,Z,G,X,re.convert(ke),re.convert(Je),fe)}finally{let Ee=H!==null?Ie.get(H).__webglFramebuffer:null;de.bindFramebuffer(z.FRAMEBUFFER,Ee)}}},this.readRenderTargetPixelsAsync=async function(T,O,Z,G,X,fe,Se,ue=0){if(!(T&&T.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let _e=Ie.get(T).__webglFramebuffer;if(T.isWebGLCubeRenderTarget&&Se!==void 0&&(_e=_e[Se],Array.isArray(_e)&&(_e=_e[0])),_e)if(O>=0&&O<=T.width-G&&Z>=0&&Z<=T.height-X){de.bindFramebuffer(z.FRAMEBUFFER,_e);let Ee=T.textures[ue],ke=Ee.format,Je=Ee.type;T.textures.length>1&&z.readBuffer(z.COLOR_ATTACHMENT0+ue);let Me=Fh(Ee);if(Me.__formatReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(Me.__typeReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let Ke=z.createBuffer();z.bindBuffer(z.PIXEL_PACK_BUFFER,Ke),z.bufferData(z.PIXEL_PACK_BUFFER,fe.byteLength,z.STREAM_READ),z.readPixels(O,Z,G,X,re.convert(ke),re.convert(Je),0),z.bindBuffer(z.PIXEL_PACK_BUFFER,null);let Nt=H!==null?Ie.get(H).__webglFramebuffer:null;de.bindFramebuffer(z.FRAMEBUFFER,Nt);let gt=z.fenceSync(z.SYNC_GPU_COMMANDS_COMPLETE,0);return z.flush(),await ud(z,gt,4),z.bindBuffer(z.PIXEL_PACK_BUFFER,Ke),z.getBufferSubData(z.PIXEL_PACK_BUFFER,0,fe),z.bindBuffer(z.PIXEL_PACK_BUFFER,null),z.deleteBuffer(Ke),z.deleteSync(gt),fe}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(T,O=null,Z=0){let G=Math.pow(2,-Z),X=Math.floor(T.image.width*G),fe=Math.floor(T.image.height*G),Se=O!==null?O.x:0,ue=O!==null?O.y:0;Fe.setTexture2D(T,0),z.copyTexSubImage2D(z.TEXTURE_2D,Z,0,0,Se,ue,X,fe),de.unbindTexture()},this.copyTextureToTexture=function(T,O,Z=null,G=null,X=0,fe=0){let Se,ue,_e,Ee,ke,Je,Me,Ke,Nt,gt=T.isCompressedTexture?T.mipmaps[fe]:T.image;if(Z!==null)Se=Z.max.x-Z.min.x,ue=Z.max.y-Z.min.y,_e=Z.isBox3?Z.max.z-Z.min.z:1,Ee=Z.min.x,ke=Z.min.y,Je=Z.isBox3?Z.min.z:0;else{let it=Math.pow(2,-X);Se=Math.floor(gt.width*it),ue=Math.floor(gt.height*it),T.isDataArrayTexture?_e=gt.depth:T.isData3DTexture?_e=Math.floor(gt.depth*it):_e=1,Ee=0,ke=0,Je=0}G!==null?(Me=G.x,Ke=G.y,Nt=G.z):(Me=0,Ke=0,Nt=0);let ft=re.convert(O.format),Jt=re.convert(O.type),we;O.isData3DTexture?(Fe.setTexture3D(O,0),we=z.TEXTURE_3D):O.isDataArrayTexture||O.isCompressedArrayTexture?(Fe.setTexture2DArray(O,0),we=z.TEXTURE_2D_ARRAY):(Fe.setTexture2D(O,0),we=z.TEXTURE_2D),de.activeTexture(z.TEXTURE0),de.pixelStorei(z.UNPACK_FLIP_Y_WEBGL,O.flipY),de.pixelStorei(z.UNPACK_PREMULTIPLY_ALPHA_WEBGL,O.premultiplyAlpha),de.pixelStorei(z.UNPACK_ALIGNMENT,O.unpackAlignment);let ln=de.getParameter(z.UNPACK_ROW_LENGTH),rt=de.getParameter(z.UNPACK_IMAGE_HEIGHT),Ji=de.getParameter(z.UNPACK_SKIP_PIXELS),Kt=de.getParameter(z.UNPACK_SKIP_ROWS),la=de.getParameter(z.UNPACK_SKIP_IMAGES);de.pixelStorei(z.UNPACK_ROW_LENGTH,gt.width),de.pixelStorei(z.UNPACK_IMAGE_HEIGHT,gt.height),de.pixelStorei(z.UNPACK_SKIP_PIXELS,Ee),de.pixelStorei(z.UNPACK_SKIP_ROWS,ke),de.pixelStorei(z.UNPACK_SKIP_IMAGES,Je);let Ri=T.isDataArrayTexture||T.isData3DTexture,Ki=O.isDataArrayTexture||O.isData3DTexture;if(T.isDepthTexture){let it=Ie.get(T),Yt=Ie.get(O),Un=Ie.get(it.__renderTarget),_t=Ie.get(Yt.__renderTarget);de.bindFramebuffer(z.READ_FRAMEBUFFER,Un.__webglFramebuffer),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,_t.__webglFramebuffer);for(let Gt=0;Gt<_e;Gt++)Ri&&(z.framebufferTextureLayer(z.READ_FRAMEBUFFER,z.COLOR_ATTACHMENT0,Ie.get(T).__webglTexture,X,Je+Gt),z.framebufferTextureLayer(z.DRAW_FRAMEBUFFER,z.COLOR_ATTACHMENT0,Ie.get(O).__webglTexture,fe,Nt+Gt)),z.blitFramebuffer(Ee,ke,Ee+Se,ke+ue,Me,Ke,Me+Se,Ke+ue,z.DEPTH_BUFFER_BIT,z.NEAREST);de.bindFramebuffer(z.READ_FRAMEBUFFER,null),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,null)}else if(X!==0||T.isRenderTargetTexture||Ie.has(T)){let it=Ie.get(T),Yt=Ie.get(O);de.bindFramebuffer(z.READ_FRAMEBUFFER,D),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,W);for(let Un=0;Un<_e;Un++)Ri?z.framebufferTextureLayer(z.READ_FRAMEBUFFER,z.COLOR_ATTACHMENT0,it.__webglTexture,X,Je+Un):z.framebufferTexture2D(z.READ_FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_2D,it.__webglTexture,X),Ki?z.framebufferTextureLayer(z.DRAW_FRAMEBUFFER,z.COLOR_ATTACHMENT0,Yt.__webglTexture,fe,Nt+Un):z.framebufferTexture2D(z.DRAW_FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_2D,Yt.__webglTexture,fe),X!==0?z.blitFramebuffer(Ee,ke,Ee+Se,ke+ue,Me,Ke,Me+Se,Ke+ue,z.COLOR_BUFFER_BIT,z.NEAREST):Ki?z.copyTexSubImage3D(we,fe,Me,Ke,Nt+Un,Ee,ke,Se,ue):z.copyTexSubImage2D(we,fe,Me,Ke,Ee,ke,Se,ue);de.bindFramebuffer(z.READ_FRAMEBUFFER,null),de.bindFramebuffer(z.DRAW_FRAMEBUFFER,null)}else Ki?T.isDataTexture||T.isData3DTexture?z.texSubImage3D(we,fe,Me,Ke,Nt,Se,ue,_e,ft,Jt,gt.data):O.isCompressedArrayTexture?z.compressedTexSubImage3D(we,fe,Me,Ke,Nt,Se,ue,_e,ft,gt.data):z.texSubImage3D(we,fe,Me,Ke,Nt,Se,ue,_e,ft,Jt,gt):T.isDataTexture?z.texSubImage2D(z.TEXTURE_2D,fe,Me,Ke,Se,ue,ft,Jt,gt.data):T.isCompressedTexture?z.compressedTexSubImage2D(z.TEXTURE_2D,fe,Me,Ke,gt.width,gt.height,ft,gt.data):z.texSubImage2D(z.TEXTURE_2D,fe,Me,Ke,Se,ue,ft,Jt,gt);de.pixelStorei(z.UNPACK_ROW_LENGTH,ln),de.pixelStorei(z.UNPACK_IMAGE_HEIGHT,rt),de.pixelStorei(z.UNPACK_SKIP_PIXELS,Ji),de.pixelStorei(z.UNPACK_SKIP_ROWS,Kt),de.pixelStorei(z.UNPACK_SKIP_IMAGES,la),fe===0&&O.generateMipmaps===!0&&O.mipmapsAutoUpdate===!0&&z.generateMipmap(we),de.unbindTexture()},this.initRenderTarget=function(T){Ie.get(T).__webglFramebuffer===void 0&&Fe.setupRenderTarget(T)},this.initTexture=function(T){T.isCubeTexture?Fe.setTextureCube(T,0):T.isData3DTexture?Fe.setTexture3D(T,0):T.isDataArrayTexture||T.isCompressedArrayTexture?Fe.setTexture2DArray(T,0):Fe.setTexture2D(T,0),de.unbindTexture()},this.resetState=function(){V=0,Y=0,H=null,de.reset(),le.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Cn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=je._getDrawingBufferColorSpace(e),t.unpackColorSpace=je._getUnpackColorSpace()}};var rh;function fs(){if(rh===void 0){let i=document.createElement("canvas");rh=!!(i.getContext("webgl2")??i.getContext("webgl"))}return rh}function Ze(i,e,t=0){let n=Math.sin(i*127.1+e*311.7+t*74.7)*43758.5453;return n-Math.floor(n)}function sr(i,e){let t=new ml({canvas:i,antialias:e,powerPreference:"high-performance"});return t.setClearColor(16777215,1),t}var Jd=i=>1-Math.pow(1-In.clamp(i,0,1),3);function ea(i,e){return Math.atan2(Math.sin(e-i),Math.cos(e-i))}var qn=(i,e)=>1-Math.exp(-i/e);var my=`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uFocus;
uniform float uStrength;
uniform float uNear;
uniform float uFar;
uniform float uUnits;
varying vec2 vUv;
float tilesAt(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  float viewZ = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  return viewZ * uUnits;
}
float blurAt(float tiles) {
  return min(1.0, abs(1.0 / uFocus - 1.0 / max(tiles, 0.3)) * uStrength);
}
void main() {
  float centre = blurAt(tilesAt(vUv));
  vec3 sum = texture2D(tColor, vUv).rgb;
  float weight = 1.0;
  const int TAPS = 20;
  for (int i = 0; i < TAPS; i++) {
    float f = float(i) + 0.5;
    float r = sqrt(f / float(TAPS));
    float a = f * 2.39996323;
    vec2 offset = vec2(cos(a), sin(a)) * r * centre;
    vec2 uv = vUv + offset * uTexel * 14.0;
    float other = blurAt(tilesAt(uv));
    float w = other >= r * centre * 0.9 ? 1.0 : 0.12;
    sum += texture2D(tColor, uv).rgb * w;
    weight += w;
  }
  gl_FragColor = vec4(sum / weight, 1.0);
  #include <colorspace_fragment>
}`,rr=class{target;material;scene=new Hn;camera=new os(-1,1,1,-1,0,1);quad;constructor(e,t){this.target=this.makeTarget(e,t),this.material=new wt({uniforms:{tColor:{value:this.target.texture},tDepth:{value:this.target.depthTexture},uTexel:{value:[1/e,1/t]},uFocus:{value:4},uStrength:{value:2.2},uNear:{value:.1},uFar:{value:600},uUnits:{value:1}},vertexShader:"varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",fragmentShader:my,depthTest:!1,depthWrite:!1}),this.quad=new He(new wn(2,2),this.material),this.quad.frustumCulled=!1,this.scene.add(this.quad)}makeTarget(e,t){let n=new $t(e,t,{type:hn,magFilter:Pt,minFilter:Pt});return n.depthTexture=new Gn(e,t,Tn),n}resize(e,t){this.target.dispose(),this.target=this.makeTarget(e,t),this.material.uniforms.tColor.value=this.target.texture,this.material.uniforms.tDepth.value=this.target.depthTexture,this.material.uniforms.uTexel.value=[1/e,1/t]}render(e,t,n,s,r=1){let a=this.material.uniforms;a.uFocus.value=s,a.uNear.value=n.near,a.uFar.value=n.far,a.uUnits.value=1/r,e.setRenderTarget(this.target),e.clear(),e.render(t,n),e.setRenderTarget(null),e.render(this.scene,this.camera)}dispose(){this.target.dispose(),this.material.dispose(),this.quad.geometry.dispose()}};var zt=new Or(1,10,8),Wi=new Vn(1,1,1,8),gy=new as(1,1,8),gn=new mn(1,1,1),Kd=new Map;function We(i,e=0,t=!0){let n=`${i}:${e}:${t}`,s=Kd.get(n);return s||(s=new It({color:i,flatShading:t}),e&&s.emissive.setHex(e),Kd.set(n,s)),s}function $e(i,e,{at:t=[0,0,0],scale:n=[1,1,1],rotate:s=[0,0,0]}={}){let r=new He(i,e);return r.position.set(...t),r.scale.set(...n),r.rotation.set(...s),r.castShadow=!0,r}var De=(i,e,t,n=0)=>$e(zt,We(i,n),{at:t,scale:e}),ai=(i,e,t,n,s=[0,0,0])=>$e(Wi,We(i),{at:n,scale:[e,t,e],rotate:s}),Yn=(i,e,t,n,s=[0,0,0])=>$e(gy,We(i),{at:n,scale:[e,t,e],rotate:s});function $n(i,e,t,n){let s=new et;return s.position.set(...n),s.add(ai(i,e,t,[0,-t/2,0])),s}var jd=7309882,Qd=10203212,ef=8294216,xy=15722173,tf=4891552,vy=15909198;function vl(){let i=new et,e=new et;i.add(e);let t=[[-.62,.2,.2,.2],[-.35,.21,.22,.24],[-.05,.21,.24,.26],[.25,.2,.2,.22],[.5,.17,.15,.17],[.72,.14,.11,.12],[.92,.11,.08,.09],[1.08,.09,.05,.06]];for(let[r,a,o,l]of t)e.add($e(zt,We(ef),{at:[0,a,r],scale:[o,o*.8,l]}));e.add($e(zt,We(xy),{at:[0,.1,-.1],scale:[.2,.09,.62]})),e.add($e(zt,We(jd),{at:[0,.22,-.78],scale:[.2,.14,.22]}));for(let r of[-1,1])e.add(De(1776404,[.045,.045,.045],[r*.12,.31,-.78])),e.add(De(16777215,[.014,.014,.014],[r*.13,.33,-.815]));[[-.12,.34,-.5,.09],[.1,.38,-.3,.11],[-.09,.4,-.08,.12],[.11,.39,.1,.11],[-.07,.36,.3,.09],[.06,.3,.5,.07],[0,.42,-.2,.1],[0,.4,.2,.09]].forEach(([r,a,o,l],c)=>e.add(De(c%2?jd:Qd,[l,l*.7,l],[r,a-.06,o])));for(let r of[-1,1])for(let a of[-.4,-.05,.3,.6])e.add($e(zt,We(tf),{at:[r*.185,.2,a],scale:[.02,.07,.07]})),e.add($e(zt,We(vy),{at:[r*.2,.2,a],scale:[.015,.035,.035]}));e.add($e(zt,We(tf),{at:[0,.2,.95],scale:[.015,.1,.28]}));let s=[];for(let[r,a]of[[-1,-.4],[1,-.4],[-1,.25],[1,.25]]){let o=$n(ef,.045,.2,[r*.2,.17,a]);o.rotation.z=r*.9,o.add(Yn(Qd,.06,.08,[0,-.2,-.03],[Math.PI/2,0,0])),e.add(o),s.push(o)}return i.traverse(r=>{r.castShadow=!0}),{group:i,body:e,legs:s}}var ah=4.4,yy=1500,_y=16184817,yl=class{canvas;renderer;scene=new Hn;camera=new Ot(30,16/9,.1,200);newt=vl();wump=new et;disposables=[];dof=null;view={spin:0,zoom:1,stretch:0,hop:0};dirty=!0;breathStart=-1;nextBreath=null;breaths=0;breath=0;constructor(e){this.canvas=e,this.renderer=sr(e,!0),this.renderer.setClearColor(_y,1),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=Wn,this.scene.background=null;let t=new Si(16774884,13161664,1.9),n=new Mi(16773846,2.6);n.position.set(-3,6,4),n.castShadow=!0,n.shadow.mapSize.set(1024,1024),n.shadow.camera.left=-4,n.shadow.camera.right=4,n.shadow.camera.top=4,n.shadow.camera.bottom=-4,n.shadow.radius=4,n.shadow.bias=-8e-4,this.scene.add(t,n);let s=new Vn(7,7.6,.4,40),r=new He(s,new It({color:15328208}));r.position.y=-.2,r.receiveShadow=!0;let a=new Ur(1.7,32);a.rotateX(-Math.PI/2);let o=new He(a,new It({color:11130578}));o.position.set(1.9,.005,-1.1),this.scene.add(r,o),this.disposables.push(s,a,r.material,o.material);let l=[13221798,12037007,14208952,10459786,9086346];for(let c=0;c<46;c++){let u=Ze(c,1,2)*Math.PI*2,d=1.8+Ze(c,2,2)*12,h=.08+Ze(c,3,2)*(.1+d*.035),m=$e(zt,We(l[c%l.length]),{at:[Math.cos(u)*d,h*.5,Math.sin(u)*d-2],scale:[h,h*.65,h]});m.receiveShadow=!0,this.scene.add(m)}this.wump.add(this.newt.group),this.newt.group.scale.setScalar(1.6),this.newt.group.position.z=-.35,this.scene.add(this.wump),this.resize(e.clientWidth||640,e.clientHeight||360),this.set(this.view)}set(e){this.view=e,this.dirty=!0}place(){let{spin:e,zoom:t,stretch:n,hop:s}=this.view;this.wump.rotation.y=Math.PI*.8-e*Math.PI/180,this.wump.position.y=Math.sin(Math.PI*Math.min(1,Math.max(0,s)))*.6;let r=1+.035*Math.sin(Math.PI*this.breath);this.newt.body.scale.set(1-.2*n,(1-.12*n)*r,1+.55*n);let a=ah/t;this.camera.position.set(0,1.55*(a/ah)+.45,a),this.camera.lookAt(0,.3,0),this.camera.updateMatrixWorld()}frame(e){if(Ct())this.breath!==0&&(this.breath=0,this.dirty=!0);else if(this.nextBreath===null&&(this.nextBreath=e+1500),this.breathStart<0&&e>=this.nextBreath&&(this.breathStart=e),this.breathStart>=0){let n=(e-this.breathStart)/yy;this.breath=n>=1?0:n,this.dirty=!0,n>=1&&(this.breathStart=-1,this.breaths++,this.nextBreath=e+3e3+this.breaths*1731%2e3)}if(!this.dirty)return;this.dirty=!1,this.place();let t=this.view.focus;t?(this.dof??=new rr(this.renderer.domElement.width,this.renderer.domElement.height),this.dof.render(this.renderer,this.scene,this.camera,t,ah/4)):this.renderer.render(this.scene,this.camera)}resize(e,t){this.renderer.setSize(Math.max(1,e),Math.max(1,t),!1),this.camera.aspect=Math.max(1,e)/Math.max(1,t),this.camera.updateProjectionMatrix(),this.dof?.resize(this.renderer.domElement.width,this.renderer.domElement.height),this.dirty=!0}dispose(){for(let e of this.disposables)e.dispose();this.dof?.dispose(),this.renderer.dispose(),this.renderer.forceContextLoss()}};var ps=["N","E","S","W"],Zn={N:0,E:90,S:180,W:270},oi={N:[0,-1],E:[1,0],S:[0,1],W:[-1,0]};var Lt=[{id:1,name:"Saltmarsh Harbour",pond:{x:[15,17],y:[3,5]},rocks:[[6,6],[7,6],[8,6],[14,14],[14,15],[14,16]]},{id:2,name:"Fernhollow",pond:{x:[4,6],y:[15,17]},rocks:[[10,4],[10,5],[10,6],[17,17],[18,17],[19,17]]},{id:3,name:"Driftglass Reef",pond:{x:[11,13],y:[11,13]},rocks:[[5,18],[6,18],[7,18],[18,5],[18,6],[18,7]]},{id:4,name:"Mistcrown Fells",pond:{x:[17,19],y:[15,17]},rocks:[[4,9],[5,9],[6,9],[12,2],[12,3],[12,4]]},{id:5,name:"Lantern Point",pond:{x:[3,5],y:[3,5]},rocks:[[9,15],[10,15],[11,15],[16,9],[16,10],[16,11]],lighthouse:[20,4]}],li=[{spot:1,tile:[3,12],heading:"E"},{spot:2,tile:[12,10],heading:"N"},{spot:3,tile:[8,20],heading:"N"},{spot:4,tile:[20,12],heading:"W"}],_l=1;function ci(i){return Lt.find(e=>e.id===i)}function xn(i,e,t){if(e<=0||t<=0||e>=23||t>=23)return"water";let{pond:n}=i;return e>=n.x[0]&&e<=n.x[1]&&t>=n.y[0]&&t<=n.y[1]?"water":i.rocks.some(([s,r])=>s===e&&r===t)?"rock":i.lighthouse&&i.lighthouse[0]===e&&i.lighthouse[1]===t?"lighthouse":"land"}function ms(i,e,t){return xn(i,e,t)==="land"}var Xi=(i,e,t)=>({stay:{at:[i,e],heading:t}}),Ln=(i,e,t,n,s)=>({patrol:{from:[i,e],to:[t,n],ticksPerTile:s}}),bl=[{id:"mossback-newt",name:"Mossback newt",island:1,size:1,present:"always",route:Xi(12,6,"S")},{id:"reedpipe-heron",name:"Reedpipe heron",island:1,size:2,present:"always",route:Ln(6,16,10,16,10)},{id:"gloamfin-moth",name:"Gloamfin moth",island:1,size:1,present:"dusk only",route:Xi(18,12,"W")},{id:"puddle-lark",name:"Puddle lark",island:1,size:1,present:"rain only",route:Ln(4,4,4,9,5)},{id:"bracken-hare",name:"Bracken hare",island:2,size:1,present:"always",route:Ln(8,8,14,8,6)},{id:"mossfern-stag",name:"Mossfern stag",island:2,size:3,present:"always",route:Ln(12,13,12,18,8)},{id:"lantern-toad",name:"Lantern toad",island:2,size:1,present:"dusk only",route:Xi(16,12,"W")},{id:"drizzle-snail",name:"Drizzle snail",island:2,size:1,present:"rain only",route:Xi(20,6,"S")},{id:"glasswing-crab",name:"Glasswing crab",island:3,size:1,present:"always",route:Ln(3,6,9,6,6)},{id:"tidewhistle-otter",name:"Tidewhistle otter",island:3,size:2,present:"always",route:Ln(15,16,20,16,8)},{id:"duskshell-snipe",name:"Duskshell snipe",island:3,size:1,present:"dusk only",route:Xi(6,12,"E")},{id:"rainbead-gecko",name:"Rainbead gecko",island:3,size:1,present:"rain only",route:Ln(15,3,15,8,5)},{id:"cragtail-goat",name:"Cragtail goat",island:4,size:2,present:"always",route:Ln(8,14,8,20,10)},{id:"fell-mouse",name:"Fell mouse",island:4,size:1,present:"always",route:Ln(15,4,20,4,4)},{id:"mistcrown-owl",name:"Mistcrown owl",island:4,size:2,present:"dusk only",route:Xi(14,8,"S")},{id:"cloudpuff-vole",name:"Cloudpuff vole",island:4,size:1,present:"rain only",route:Xi(6,4,"E")},{id:"beacon-gull",name:"Beacon gull",island:5,size:2,present:"always",route:Ln(12,20,18,20,6)},{id:"shingle-plover",name:"Shingle plover",island:5,size:1,present:"always",route:Ln(4,12,4,18,5)},{id:"wickwing-bat",name:"Wickwing bat",island:5,size:1,present:"dusk only",route:Xi(8,8,"S")},{id:"sleetfoot-fox",name:"Sleetfoot fox",island:5,size:2,present:"rain only",route:Ln(13,4,13,10,8)}];function ta(i){return bl.find(e=>e.id===i)}function qi(i){return bl.filter(e=>e.island===i)}var nf=1.2;function Sl(i){let e=new et,t=new et;t.position.y=.58,e.add(t),t.add($e(gn,We(i),{at:[0,.22,0],scale:[.36,.46,.22]})),t.add($e(gn,We(4157304),{at:[0,.22,.17],scale:[.28,.4,.14]})),t.add($e(gn,We(2369322),{at:[0,.2,-.14],scale:[.16,.1,.08]})),t.add(De(15780256,[.15,.16,.15],[0,.63,0])),t.add(De(2760984,[.03,.03,.03],[-.055,.65,-.13])),t.add(De(2760984,[.03,.03,.03],[.055,.65,-.13])),t.add($e(Wi,We(11831359),{at:[0,.76,0],scale:[.28,.025,.28]})),t.add($e(Wi,We(9333292),{at:[0,.83,0],scale:[.14,.1,.14]}));let n=[$n(3883602,.07,.58,[-.1,.58,0]),$n(3883602,.07,.58,[.1,.58,0])],s=[$n(i,.055,.4,[-.23,.4,0]),$n(i,.055,.4,[.23,.4,0])];return e.add(...n),t.add(...s),e.traverse(r=>{r.castShadow=!0}),{group:e,legs:n,arms:s,torso:t}}function Ml(i,e,t){let n=e==="walk"?.6:e==="run"?1:0,s=Math.sin(t)*n;e==="jump"?(i.legs[0].rotation.x=-.7,i.legs[1].rotation.x=-.4,i.arms[0].rotation.x=-2.4,i.arms[1].rotation.x=-2.4):(i.legs[0].rotation.x=s,i.legs[1].rotation.x=-s,i.arms[0].rotation.x=-s*.8,i.arms[1].rotation.x=s*.8),i.torso.rotation.x=e==="run"?-.18:0}var vn=6,Dn=14,ar=3.2,sf=1.75,by=1.9,Sy=2.2,My=i=>Zn[i]*Math.PI/180;function wy(i){let e=document.createElement("canvas");e.width=384,e.height=80;let t=e.getContext("2d");t.fillStyle="#f4f1e8",t.fillRect(0,0,384,80),t.fillStyle="#0b0b0c",t.font='600 30px "Albert Sans", system-ui, sans-serif',t.textBaseline="middle",t.textAlign="center",t.fillText(i.length>26?`${i.slice(0,25)}\u2026`:i,192,42);let n=new rs(e);return n.colorSpace=tn,n}var wl=class{canvas;renderer;scene=new Hn;camera=new Ot(55,1,.1,100);hemi=new Si(16775406,12100746,2.1);sun=new Mi(16773336,1.8);visitor=Sl(4157304);frames=new et;loader=new Br;disposables=[];width=1;height=1;dirty=!0;lastNow=null;vx=2.5;vz=13.5;tx=2.5;tz=13.5;angle=0;targetAngle=0;gait="idle";phase=0;lift=0;snapped=!0;cam=new k(2.5,2.4,17);camTarget=new k;constructor(e){this.canvas=e,this.renderer=sr(e,!0),this.renderer.setClearColor(15855593,1),this.sun.position.set(2,9,6),this.sun.target.position.set(3,0,7),this.sun.shadow.camera.left=-9,this.sun.shadow.camera.right=9,this.sun.shadow.camera.top=9,this.sun.shadow.camera.bottom=-9,this.sun.shadow.mapSize.set(1024,1024),this.sun.shadow.radius=3,this.sun.shadow.bias=-6e-4,this.scene.add(this.hemi,this.sun,this.sun.target,this.frames,this.visitor.group),this.buildRoom(),this.resize(e.clientWidth||640,e.clientHeight||400)}buildRoom(){let e=new wn(vn,Dn,vn,Dn);e.rotateX(-Math.PI/2),e.translate(vn/2,0,Dn/2);let t=[],n=e.getAttribute("position"),s=[new me(12159834),new me(12884584),new me(11370319)];for(let g=0;g<n.count;g++){let S=Math.floor(n.getX(g)*1+.001)%3,f=s[Math.abs(S)];t.push(f.r,f.g,f.b)}e.setAttribute("color",new Be(t,3));let r=new He(e,new It({vertexColors:!0}));r.receiveShadow=!0,this.scene.add(r),this.disposables.push(e,r.material);let a=new It({color:15987180}),o=new It({color:3813158}),l=new mn(.2,ar,Dn+.4),c=new mn(vn+.4,ar,.2),u=new mn(.06,.16,Dn),d=new mn(vn,.16,.06),h=(g,S,f,p,_)=>{let M=new He(g,S);M.position.set(f,p,_),M.receiveShadow=!0,this.scene.add(M)};h(l,a,-.1,ar/2,Dn/2),h(l,a,vn+.1,ar/2,Dn/2),h(c,a,vn/2,ar/2,-.1),h(c,a,vn/2,ar/2,Dn+.1),h(u,o,.03,.08,Dn/2),h(u,o,vn-.03,.08,Dn/2),h(d,o,vn/2,.08,.03),h(d,o,vn/2,.08,Dn-.03),this.disposables.push(a,o,l,c,u,d);let m=$e(gn,We(5981744),{at:[vn/2,.22,7],scale:[.7,.44,4.2]});m.receiveShadow=!0,this.scene.add(m)}setFrames(e){for(let t of[...this.frames.children])this.frames.remove(t),t.traverse(n=>{if(n instanceof He){n.geometry.dispose();let s=n.material;s.map?.dispose(),s.dispose()}});e.slice(0,12).forEach((t,n)=>{let s=n%2===0,r=by+Math.floor(n/2)*Sy,a=new et;a.position.set(s?.04:vn-.04,sf,r),a.rotation.y=s?Math.PI/2:-Math.PI/2;let o=new He(new mn(1.8,1.2,.06),We(1315087,0,!1)),l=new He(new wn(1.6,1),new _i({color:14210768}));l.position.z=.04;let c=new He(new wn(1.1,.23),new _i({map:wy(t.caption||t.creatureName)}));c.position.set(0,-.82,.02),a.add(o,l,c),this.frames.add(a),this.loader.load(t.url,u=>{u.colorSpace=tn;let d=l.material;d.color.set(16777215),d.map=u,d.needsUpdate=!0,this.dirty=!0})}),this.dirty=!0}setVisitor(e){this.tx=e.tile[0]+.5,this.tz=e.tile[1]+.5,this.targetAngle=My(e.heading),this.gait=e.gait,(this.snapped||Ct())&&(this.vx=this.tx,this.vz=this.tz,this.angle=this.targetAngle,this.snapped=!1),this.dirty=!0}setPreset(e){let t=e==="full"?1.5:1;this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,t)),this.renderer.setSize(this.width,this.height,!1),this.renderer.shadowMap.enabled=e==="full",this.renderer.shadowMap.autoUpdate=!1,this.renderer.shadowMap.type=Wn,this.sun.castShadow=e==="full",this.sun.shadow.map?.dispose(),this.sun.shadow.map=null,this.scene.traverse(n=>{n instanceof He&&(n.material.needsUpdate=!0)}),this.dirty=!0}frame(e){let t=this.lastNow===null?0:In.clamp((e-this.lastNow)/1e3,0,.1);this.lastNow=e;let n=Ct(),s=!1,r=this.tx-this.vx,a=this.tz-this.vz,o=ea(this.angle,this.targetAngle);if(Math.abs(r)>.002||Math.abs(a)>.002||Math.abs(o)>.002){let h=n?1:qn(t,this.gait==="run"?.05:.09);this.vx+=r*h,this.vz+=a*h,this.angle+=o*(n?1:qn(t,.06)),s=!0}let l=this.gait==="jump"?.5:0;Math.abs(l-this.lift)>.002&&(this.lift+=(l-this.lift)*(n?1:qn(t,.07)),s=!0),!n&&(this.gait==="walk"||this.gait==="run")&&(this.phase+=t*(this.gait==="run"?16:10),s=!0),Ml(this.visitor,n?"idle":this.gait,this.phase),this.visitor.group.position.set(this.vx,this.lift,this.vz),this.visitor.group.rotation.y=-this.angle;let c=new k(Math.sin(this.angle),0,-Math.cos(this.angle)),u=new k(this.vx,2.05,this.vz).addScaledVector(c,-3.3);u.x=In.clamp(u.x,.35,vn-.35),u.z=In.clamp(u.z,.35,Dn-.35);let d=n?1:qn(t,.22);this.cam.distanceTo(u)>.002&&(this.cam.lerp(u,d),s=!0),this.camTarget.set(this.vx,sf-.25+this.lift,this.vz).addScaledVector(c,6),this.camera.position.copy(this.cam),this.camera.lookAt(this.camTarget),(this.dirty||s)&&(this.dirty=!1,this.renderer.shadowMap.enabled&&(this.renderer.shadowMap.needsUpdate=!0),this.renderer.render(this.scene,this.camera))}resize(e,t){this.width=Math.max(1,Math.round(e)),this.height=Math.max(1,Math.round(t)),this.renderer.setSize(this.width,this.height,!1),this.camera.aspect=this.width/this.height,this.camera.updateProjectionMatrix(),this.dirty=!0}dispose(){this.setFrames([]);for(let e of this.disposables)e.dispose();this.renderer.dispose(),this.renderer.forceContextLoss()}};var or=i=>(e,t)=>{let n=i.length??.9,s=i.height??.3,r=i.legLength??.3,a=r+s*.7;if(e.add(De(i.body,[s*(i.thick??1),s,n/2],[0,a,0])),i.belly&&e.add(De(i.belly,[s*.8,s*.6,n*.4],[0,a-s*.45,0])),i.spots)for(let l of[-.25,0,.25])e.add(De(i.spots,[.07,.03,.07],[l*.3*n,a+s*.95,l*n]));let o=a+s*.55;if(e.add(De(i.head??i.body,[s*.55,s*.5,s*.65],[0,o,-n/2-s*.25])),i.snout&&e.add(De(i.snout,[s*.25,s*.22,s*.35],[0,o-s*.1,-n/2-s*.8])),e.add(De(1710614,[.035,.035,.035],[-s*.3,o+s*.12,-n/2-s*.5])),e.add(De(1710614,[.035,.035,.035],[s*.3,o+s*.12,-n/2-s*.5])),i.ears)for(let l of[-1,1])e.add($e(zt,We(i.ears),{at:[l*s*.38,o+s*(.55+(i.earLength??.3)),-n/2-s*.15],scale:[s*.14,s*(i.earLength??.3)*1.3,s*.09],rotate:[0,0,l*-.25]}));if(i.horns)for(let l of[-1,1])e.add(Yn(i.horns,s*.13,s*1.1,[l*s*.3,o+s*.8,-n/2-s*.1],[.5,0,l*-.35]));if(i.antlers)for(let l of[-1,1]){e.add(ai(i.antlers,s*.07,s*1.5,[l*s*.32,o+s*1.05,-n/2-s*.15],[.2,0,l*-.35]));for(let c of[.25,.6])e.add(ai(i.antlers,s*.05,s*.7,[l*(s*.52+c*.12),o+s*(.95+c*.9),-n/2-s*.15-c*.1],[.5,0,l*-1]))}i.beard&&e.add(Yn(15328728,s*.1,s*.5,[0,o-s*.5,-n/2-s*.4],[Math.PI,0,0])),e.add($e(zt,We(i.tailColor??i.tail??i.body),{at:[0,a+s*.15,n/2+s*.35],scale:[s*.22,s*.22,s*.5],rotate:[-.5,0,0]}));for(let[l,c]of[[-1,-.3],[1,-.3],[-1,.32],[1,.32]]){let u=$n(i.leg??i.body,s*.17,r+s*.4,[l*s*.55,a-s*.2,c*n]);i.paws&&u.add(De(i.paws,[s*.2,s*.12,s*.28],[0,-(r+s*.4),-.02])),e.add(u),t.push(u)}return 0},na=i=>(e,t)=>{let n=i.size??.3,s=i.legLength+n*.8;if(e.add(De(i.body,[n*.8,n*.85,n*1.5],[0,s,.05])),i.belly&&e.add(De(i.belly,[n*.65,n*.55,n*1.2],[0,s-n*.3,-.04])),i.wing)for(let a of[-1,1])e.add(De(i.wing,[n*.18,n*.6,n*1.2],[a*n*.72,s+n*.1,.1]));e.add($e(zt,We(i.tail??i.wing??i.body),{at:[0,s+n*.05,n*1.7],scale:[n*.4,n*.12,n*.9],rotate:[-.2,0,0]}));let r=s+n*.5+i.neck;i.neck>.05&&e.add(ai(i.belly??i.body,n*.2,i.neck+n*.4,[0,s+n*.3+i.neck/2,-n*1],[.25,0,0])),e.add(De(i.head??i.body,[n*.5,n*.5,n*.55],[0,r,-n*1.15-i.neck*.2])),e.add(Yn(i.beak,n*.16,n*(i.beakLength??.9),[0,r-n*.05,-n*1.7-i.neck*.2-(i.beakLength??.9)*n*.3],[-Math.PI/2,0,0]));for(let a of[-1,1])e.add(De(1315855,[.03,.03,.03],[a*n*.38,r+n*.12,-n*1.45-i.neck*.2]));i.crest&&e.add(Yn(i.crest,n*.1,n*.7,[0,r+n*.55,-n*1-i.neck*.2],[.5,0,0])),i.collar&&e.add($e(zt,We(i.collar),{at:[0,r-n*.4,-n*1.1-i.neck*.2],scale:[n*.45,n*.12,n*.45]}));for(let a of[-1,1]){let o=$n(i.legColor,.025,i.legLength,[a*n*.4,i.legLength+n*.1,0]);e.add(o),t.push(o)}return 0},rf=i=>e=>{if(e.add(De(i.body,[.09,.09,.3],[0,0,0])),e.add(De(i.body,[.1,.1,.1],[0,.02,-.3])),i.eyes)for(let t of[-1,1])e.add(De(i.eyes,[.025,.025,.025],[t*.06,.05,-.37],i.eyes));for(let t of[-1,1])e.add($e(i.bat?gn:zt,We(i.wing,i.glow??0),{at:[t*i.span*.5,.05,.02],scale:i.bat?[i.span,.015,.32]:[i.span*.55,.012,.38],rotate:[0,0,t*.35]})),e.add($e(zt,We(i.edge,i.glow??0),{at:[t*i.span*.82,.08,.05],scale:[i.span*.2,.014,.2],rotate:[0,0,t*.35]}));return i.hover},El=i=>(e,t)=>{let{length:n,height:s}=i;e.add(De(i.body,[s*(i.wide??1),s,n/2],[0,s+.05,0])),i.belly&&e.add(De(i.belly,[s*.8,s*.55,n*.4],[0,s*.5+.05,0])),i.shell&&(e.add(De(i.shell,[s*1.7,s*1.7,s*1.7],[0,s*2.2,n*.1])),e.add(De(i.shellMarks??i.shell,[s*.9,s*.9,s*.9],[0,s*2.7,n*.1]))),e.add(De(i.body,[s*.8,s*.7,s*.9],[0,s+.08,-n/2-s*.4]));for(let r of[-1,1])i.stalk?(e.add(ai(i.body,.015,.16,[r*s*.5,s*2.1,-n/2],[0,0,r*.2])),e.add(De(i.eyes??1315855,[.04,.04,.04],[r*s*.55,s*2.35,-n/2]))):e.add(De(i.eyes??1315855,[s*.28,s*.28,s*.28],[r*s*.55,s*1.4,-n/2-s*.5])),i.claws&&e.add(De(i.claws,[s*.6,s*.4,s*.7],[r*(s*1.8),s+.05,-n/2-s*.4]));if(i.lamp&&e.add(De(i.lamp,[s*.5,s*.5,s*.5],[0,s*2.6,-n*.1],i.lamp)),i.beads)for(let r of[-.3,0,.3])for(let a of[-1,1])e.add(De(i.beads,[.035,.035,.035],[a*s*.75,s*1.3,r*n]));if(i.marks)for(let r of[-.3,.05,.35])e.add(De(i.marks,[s*.5,s*.2,s*.3],[0,s*2,r*n]));i.tail&&e.add($e(zt,We(i.tail),{at:[0,s+.02,n/2+n*.4],scale:[s*.3,s*.25,n*.5]}));for(let r=0;r<i.legs;r++){let a=r%2?1:-1,o=(Math.floor(r/2)/Math.max(1,i.legs/2-1)-.5)*n*.8,l=$n(i.leg,.02+s*.05,s*1+.06,[a*s*.9,s*.8+.06,o]);l.rotation.z=a*.9,e.add(l),t.push(l)}return 0},Ey=i=>e=>{e.add(De(i.body,[.28,.36,.28],[0,.45,0])),e.add(De(i.face,[.2,.17,.05],[0,.66,-.2]));for(let t of[-1,1])e.add(De(i.eye,[.07,.07,.04],[t*.09,.67,-.25],i.eye)),e.add(De(1315855,[.03,.03,.03],[t*.09,.67,-.29])),e.add(Yn(i.tuft,.06,.2,[t*.16,.9,-.05],[0,0,t*-.3])),e.add(De(i.face,[.07,.3,.2],[t*.28,.4,.05]));return e.add(Yn(13673034,.04,.1,[0,.6,-.27],[-Math.PI/2,0,0])),e.add($e(zt,We(15196886),{at:[0,.34,.5],scale:[.5,.05,.5]})),0},Ty=i=>e=>{e.add(De(i.body,[.34,.32,.36],[0,.34,0])),e.add(De(i.body,[.2,.18,.2],[0,.4,-.34]));for(let t of[-1,1])e.add(De(i.ear,[.07,.07,.04],[t*.14,.56,-.28])),e.add(De(1315855,[.025,.025,.025],[t*.09,.45,-.5])),e.add(De(i.body,[.12,.12,.12],[t*.2,.3,.2]));return e.add(De(13203594,[.03,.03,.03],[0,.4,-.54])),0},Ay={"mossback-newt":()=>0,"reedpipe-heron":na({body:8361126,belly:15002094,wing:6124423,beak:14722362,legColor:12098138,legLength:.7,neck:.5,size:.25,crest:3095368,tail:5202549}),"gloamfin-moth":rf({body:6969994,wing:11771355,edge:9404352,hover:.9,span:.4,glow:4864634,eyes:16773280}),"puddle-lark":na({body:10255186,belly:15852484,beak:7166522,legColor:13215610,legLength:.14,neck:0,size:.17,wing:8019002,crest:8019002}),"bracken-hare":or({body:12094042,belly:15852748,ears:12094042,earLength:.9,tail:16777215,legLength:.25,height:.24,length:.85,paws:9069120}),"mossfern-stag":or({body:7035452,belly:13154448,antlers:4865578,spots:6261322,legLength:.55,height:.3,length:1,tail:15327432,snout:3813410,paws:3024668}),"lantern-toad":El({body:8359740,belly:14867622,length:.55,height:.2,legs:4,leg:6978096,lamp:16766044,beads:4872738,wide:1.25,eyes:15777856}),"drizzle-snail":El({body:14275256,length:.6,height:.1,legs:0,leg:14275256,shell:4889248,shellMarks:10475216,stalk:!0}),"glasswing-crab":El({body:10410464,belly:15136504,length:.45,height:.1,legs:6,leg:8175820,claws:15769760,stalk:!0,marks:16777215,wide:1.6}),"tidewhistle-otter":or({body:7031346,belly:14271648,head:8017728,snout:15127472,legLength:.08,height:.2,length:1.15,tail:5913898,paws:4862754}),"duskshell-snipe":na({body:9341594,belly:14473444,wing:6973048,beak:4867672,legColor:9076624,legLength:.3,neck:.12,size:.2,beakLength:2.4,crest:5920362}),"rainbead-gecko":El({body:6467706,belly:14151880,length:.6,height:.07,legs:4,leg:5216872,beads:15267839,tail:5678192,eyes:16769674,wide:1.4}),"cragtail-goat":or({body:14210248,belly:15723746,horns:6969928,beard:!0,legLength:.4,height:.28,length:.95,tail:14210248,paws:3814444,snout:13091508}),"fell-mouse":or({body:9077364,belly:14275782,ears:13203594,earLength:.45,tail:13214368,legLength:.04,height:.16,length:.6,snout:9077364}),"mistcrown-owl":Ey({body:8020552,face:15129803,eye:16765002,tuft:5916210}),"cloudpuff-vole":Ty({body:14474460,ear:15120576}),"beacon-gull":na({body:16053488,belly:16777215,wing:10134701,beak:14715434,legColor:14715434,legLength:.35,neck:.08,size:.25,tail:16053488}),"shingle-plover":na({body:13219210,belly:16446950,beak:2763300,legColor:14723168,legLength:.16,neck:0,size:.17,collar:2763300,wing:11112292}),"wickwing-bat":rf({body:3879751,wing:4866648,edge:2761782,hover:1.1,span:.55,eyes:16751194,bat:!0}),"sleetfoot-fox":or({body:12742714,belly:15984338,ears:12742714,earLength:.5,tail:12742714,tailColor:15328476,legLength:.3,height:.22,length:.95,snout:15984338,paws:9418968,leg:4864560})},af=[0,.9,1.5,2.2];function of(i){let e=new et,t=[],n=0;if(i.id==="mossback-newt"){let r=vl();e.add(r.group),t.push(...r.legs)}else n=Ay[i.id](e,t);let s=new et;return s.add(...e.children),e.add(s),s.scale.setScalar(i.id==="mossback-newt"?.9:af[i.size]),e.traverse(r=>{r.castShadow=!0}),{group:e,legs:t,hover:n*(i.id==="mossback-newt"?1:af[i.size])}}function lf(){return{uTime:{value:0},uWind:{value:0},uPart:{value:0},uExplorer:{value:[-99,-99]}}}function Cy(){let i=[];for(let t=0;t<3;t++){let n=t/3*Math.PI,s=Math.cos(n),r=Math.sin(n),a=(t-1)*.06;i.push(-s*.05,0,-r*.05,s*.05,0,r*.05,a,.42,a*.7),i.push(s*.05,0,r*.05,-s*.05,0,-r*.05,a,.42,a*.7)}let e=new St;return e.setAttribute("position",new Be(i,3)),e.computeVertexNormals(),e}function Ry(i){let e=new It({side:Rn});return e.onBeforeCompile=t=>{Object.assign(t.uniforms,i),t.vertexShader=t.vertexShader.replace("#include <common>",`#include <common>
uniform float uTime;
uniform float uWind;
uniform float uPart;
uniform vec2 uExplorer;`).replace("#include <begin_vertex>",`
        vec3 transformed = vec3(position);
        vec2 root = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        float bend = position.y * position.y * 5.5;
        float sway = sin(uTime * 2.1 + root.x * 0.8 + root.y * 0.6) + 0.5 * sin(uTime * 1.6 + root.y * 1.3);
        transformed.x += sway * 0.09 * bend * uWind;
        transformed.z += cos(uTime * 1.7 + root.x) * 0.06 * bend * uWind;
        vec2 away = root - uExplorer;
        float gap = length(away);
        float push = smoothstep(1.3, 0.1, gap) * uPart;
        transformed.xz += (away / max(gap, 0.001)) * push * 0.42 * bend;
        transformed.y *= 1.0 - 0.5 * push * bend;
      `)},e}function ia(i,e,t,n){let s=new ss(i,e,Math.max(1,t.length));s.count=t.length;let r=new Ve,a=new Mn;return t.forEach((o,l)=>{a.setFromAxisAngle(new k(0,1,0),o.turn),r.compose(new k(o.x,0,o.z),a,new k(o.scale,o.scale,o.scale)),s.setMatrixAt(l,r),s.setColorAt(l,o.color)}),s.castShadow=n,s.frustumCulled=!1,s}function cf(i,e,t,n){let s=new et,r=[],a=new Set;for(let H of li)a.add(`${H.tile[0]},${H.tile[1]}`);for(let H of bl.filter(F=>F.island===i.id)){let F=H.route,[$,ee]="stay"in F?[F.stay.at,F.stay.at]:[F.patrol.from,F.patrol.to];for(let ae=Math.min($[0],ee[0])-1;ae<=Math.max($[0],ee[0])+1;ae++)for(let ge=Math.min($[1],ee[1])-1;ge<=Math.max($[1],ee[1])+1;ge++)a.add(`${ae},${ge}`)}let o=[],l=[],c=[],u=[],d=e.flowers.map(H=>new me(H));for(let H=1;H<23;H++)for(let F=1;F<23;F++){if(xn(i,F,H)!=="land"||t.isShoreTile(F,H))continue;let $=a.has(`${F},${H}`),ee=$?1:2+Math.floor(Ze(F,H,9)*3);for(let J=0;J<ee;J++){let xe=F+.1+Ze(F,H,10+J)*.8,be=H+.1+Ze(F,H,20+J)*.8,Ae=Ze(F,H,30+J);o.push({x:xe,z:be,scale:.8+Ae*.7,turn:0,color:new me(e.grass[0]).lerp(new me(e.grass[1]),Ae).multiplyScalar(.85+Ze(F,H,40+J)*.35)})}if($)continue;let ae=F<=2||H<=2||F>=21||H>=21,ge=Ze(F,H,50);ae&&ge<e.trees?c.push({x:F+.5,z:H+.5,scale:.8+Ze(F,H,51)*.7,turn:Ze(F,H,52)*6,color:new me(e.leaf[Ze(F,H,53)>.5?1:0])}):ge>.945?l.push({x:F+.3+Ze(F,H,54)*.4,z:H+.3+Ze(F,H,55)*.4,scale:.5+Ze(F,H,56)*.4,turn:Ze(F,H,57)*6,color:new me(e.bush).multiplyScalar(.8+Ze(F,H,58)*.4)}):ge<.14&&u.push({x:F+.2+Ze(F,H,59)*.6,z:H+.2+Ze(F,H,60)*.6,scale:.065,turn:0,color:d[Math.floor(Ze(F,H,61)*d.length)]})}let h=(H,F,$)=>{let ee=new Ve,ae=new Mn;F.forEach((ge,J)=>{ae.setFromAxisAngle(new k(0,1,0),ge.turn),ee.compose(new k(ge.x,t.heightAt(ge.x,ge.z)+$*ge.scale,ge.z),ae,new k(ge.scale,ge.scale,ge.scale)),H.setMatrixAt(J,ee)}),H.instanceMatrix.needsUpdate=!0},m=Cy(),g=Ry(n),S=ia(m,g,o,!1);h(S,o,0),s.add(S),r.push(m,g);let f=new bi(.5,1),p=new It({flatShading:!0}),_=ia(f,p,l,!0);h(_,l,.2),s.add(_),r.push(f,p);let M=new as(.62,1.7,7),w=new It({flatShading:!0}),C=ia(M,w,c,!0);h(C,c,1.55),s.add(C);let b=new Vn(.08,.11,.8,6),x=new It({color:e.trunk,flatShading:!0}),v=ia(b,x,c.map(H=>({...H,color:new me(16777215)})),!0);h(v,c,.4),s.add(v),r.push(M,w,b,x);let A=new bi(1,0),R=new It({flatShading:!0}),L=ia(A,R,u,!1);h(L,u,1.4),s.add(L),r.push(A,R);let N=new bi(.5,1),B=new It({color:e.stone,flatShading:!0});r.push(N,B);for(let[H,F]of i.rocks){let $=new He(N,B);$.scale.set(.95,.6+Ze(H,F,1)*.3,.9),$.rotation.y=Ze(H,F,2)*6,$.position.set(H+.5,t.heightAt(H+.5,F+.5)+.22,F+.5);let ee=new He(N,B);ee.scale.set(.45,.35,.4),ee.position.set(H+.8,t.heightAt(H+.8,F+.3)+.12,F+.3);for(let ae of[$,ee])ae.castShadow=!0,ae.receiveShadow=!0,s.add(ae)}let D=new et,W=We(9071172);for(let H=0;H<=3;H++)D.add($e(gn,W,{at:[H+.5,t.heightAt(H+.5,12.5)+.07,12.5],scale:[.96,.08,1.15]})),D.add($e(gn,We(7624506),{at:[H+.5,t.heightAt(H+.5,12.5)+.11,12.5],scale:[.02,.02,1.15]}));for(let H of[11.95,13.05])for(let F of[.4,2])D.add(ai(5981744,.06,.8,[F,.2,H]));if(s.add(D),i.id===1){let H=new et;H.add(ai(5981744,.05,1,[4,.7,13.6]),ai(5981744,.05,1,[4.9,.7,13.6])),H.add($e(gn,We(9071172),{at:[4.45,1,13.6],scale:[1.1,.7,.06]}));for(let[F,$,ee]of[[4.15,1.12,16117724],[4.45,.95,15331573],[4.75,1.1,16117724]])H.add($e(gn,We(ee),{at:[F,$,13.56],scale:[.22,.28,.01]}));s.add(H)}let V=[];if(i.lighthouse){let[H,F]=i.lighthouse,$=new et;$.position.set(H+.5,t.heightAt(H+.5,F+.5),F+.5),$.add($e(Wi,We(9407878),{at:[0,.15,0],scale:[.62,.3,.62]}));for(let ge=0;ge<4;ge++){let J=new Vn(.42-ge*.03,.46-ge*.03,.85,12);r.push(J),$.add($e(J,We(ge%2?11680558:15855074),{at:[0,.7+ge*.85,0]}))}$.add($e(Wi,We(2829619),{at:[0,4.15,0],scale:[.55,.08,.55]}));let ee=$e(Wi,We(4477013),{at:[0,4.5,0],scale:[.3,.62,.3]});V.push(ee),$.add(ee,Yn(11680558,.42,.55,[0,5.1,0]),De(15855074,[.08,.08,.08],[0,5.45,0]));let ae=$e(gn,We(4863268),{at:[0,.75,.43],scale:[.26,.5,.04]});V.push(ae),$.add(ae),s.add($)}let Y=new Map;for(let[H,F]of V.entries())Y.set(F,{off:F.material,on:We(H===0?16771488:16765562,H===0?16767072:16757575)});return{group:s,setLighthouse(H){for(let[F,$]of Y)F.material=H?$.on:$.off},dispose(){for(let H of r)H.dispose()}}}var uf={1:{grass:[7314002,8825178],sand:14272144,stone:9408908,water:2383750,shallow:5025976,bush:5209413,flowers:[16052710,15909198],trunk:7033398,leaf:[5081674,6987854],trees:.3},2:{grass:[4160828,5804362],sand:12035447,stone:7172710,water:2055264,shallow:4170650,bush:3107384,flowers:[12159704,15784298],trunk:5981744,leaf:[3109944,4885823],trees:.62},3:{grass:[9614700,11125882],sand:15260582,stone:12040624,water:2327194,shallow:6475976,bush:7314018,flowers:[16752512,16773577],trunk:9074261,leaf:[8367722,10470522],trees:.18},4:{grass:[8228715,9675644],sand:12432276,stone:7830136,water:2840693,shallow:6069936,bush:6714970,flowers:[15262975,14067944],trunk:5851450,leaf:[5205846,6849893],trees:.4},5:{grass:[10133594,11711078],sand:14731658,stone:9276030,water:2052223,shallow:4890808,bush:8358472,flowers:[16765818,15895388],trunk:7295544,leaf:[7313990,9088596],trees:.28}},lh=.3,gs=.05,hf=-12,Py=48,oh=4;function df(i,e){let t=(v,A)=>v>=0&&A>=0&&v<24&&A<24&&xn(i,v,A)!=="water",n=25,s=new Float32Array(n*n),r=new Float32Array(n*n*3),a=(v,A)=>{let R=xn(i,v,A);return R==="rock"||R==="lighthouse"?new me(e.stone).lerp(new me(e.grass[0]),.25):!t(v-1,A)||!t(v+1,A)||!t(v,A-1)||!t(v,A+1)?new me(e.sand):new me(e.grass[0]).lerp(new me(e.grass[1]),Ze(v,A,i.id))};for(let v=0;v<n;v++)for(let A=0;A<n;A++){let R=0,L=!1,N=new me(0,0,0);for(let[D,W]of[[-1,-1],[0,-1],[-1,0],[0,0]])if(t(A+D,v+W)){R++;let V=a(A+D,v+W);N.r+=V.r,N.g+=V.g,N.b+=V.b}else L=!0;let B=v*n+A;s[B]=L?gs+.07:lh+(Ze(A,v,5)-.5)*.07,R&&(r[B*3]=N.r/R,r[B*3+1]=N.g/R,r[B*3+2]=N.b/R)}let o=[];for(let v=0;v<n;v++)for(let A=0;A<n;A++)o.push(A,s[v*n+A],v);let l=[];for(let v=0;v<24;v++)for(let A=0;A<24;A++){if(!t(A,v))continue;let R=v*n+A,L=R+n;l.push(R,L,R+1,R+1,L,L+1)}let c=new St;c.setAttribute("position",new Be(o,3)),c.setAttribute("color",new Be(r,3)),c.setIndex(l),c.computeVertexNormals();let u=[],d=[],h=[],m=new me(e.sand).multiplyScalar(.72),g=new me(e.sand).multiplyScalar(.38),S=(v,A,R,L,N,B)=>{let D=s[A*n+v],W=s[L*n+R],V=[[v,D,A,m],[R,W,L,m],[v,-.45,A,g],[R,W,L,m],[R,-.45,L,g],[v,-.45,A,g]];for(let[Y,H,F,$]of V)u.push(Y,H,F),d.push($.r,$.g,$.b),h.push(N,0,B)};for(let v=0;v<24;v++)for(let A=0;A<24;A++)t(A,v)&&(t(A,v-1)||S(A,v,A+1,v,0,-1),t(A+1,v)||S(A+1,v,A+1,v+1,1,0),t(A,v+1)||S(A+1,v+1,A,v+1,0,1),t(A-1,v)||S(A,v+1,A,v,-1,0));let f=new St;f.setAttribute("position",new Be(u,3)),f.setAttribute("color",new Be(d,3)),f.setAttribute("normal",new Be(h,3));let p=new It({vertexColors:!0}),_=new He(c,p);_.receiveShadow=!0;let M=new He(f,p);M.receiveShadow=!0;let w=new et;w.add(_,M);let C=Py*oh,b=new Uint8Array(C*C);for(let v=0;v<C;v++){let A=hf+(v+.5)/oh;for(let R=0;R<C;R++){let L=hf+(R+.5)/oh,N=3;for(let B=Math.floor(A)-3;B<=Math.floor(A)+3;B++)for(let D=Math.floor(L)-3;D<=Math.floor(L)+3;D++){if(!t(D,B))continue;let W=Math.max(D-L,0,L-(D+1)),V=Math.max(B-A,0,A-(B+1));N=Math.min(N,Math.hypot(W,V))}b[v*C+R]=Math.round(N/3*255)}}let x=new is(b,C,C,er,sn);return x.magFilter=Wt,x.minFilter=Wt,x.needsUpdate=!0,{group:w,shore:x,heightAt(v,A){if(v<0||A<0||v>24||A>24)return gs;let R=Math.min(23,Math.floor(v)),L=Math.min(23,Math.floor(A)),N=v-R,B=A-L,D=(W,V)=>s[V*n+W];return(D(R,L)*(1-N)+D(R+1,L)*N)*(1-B)+(D(R,L+1)*(1-N)+D(R+1,L+1)*N)*B},isShoreTile:(v,A)=>t(v,A)&&(!t(v-1,A)||!t(v+1,A)||!t(v,A-1)||!t(v,A+1)),dispose(){c.dispose(),f.dispose(),p.dispose(),x.dispose()}}}function Iy(){let i=document.createElement("canvas");i.width=i.height=64;let e=i.getContext("2d"),t=e.createRadialGradient(32,32,0,32,32,32);return t.addColorStop(0,"rgba(255,248,180,1)"),t.addColorStop(.35,"rgba(255,230,120,0.55)"),t.addColorStop(1,"rgba(255,220,100,0)"),e.fillStyle=t,e.fillRect(0,0,64,64),new rs(i)}function ff(i){let e=new et,t=[];for(let C=-6;C<30;C++)for(let b=-6;b<30;b++){let x=b>=0&&C>=0&&b<24&&C<24;if(x&&xn(i,b,C)!=="water")continue;let v=Ze(b,C,77);v<(x?.7:.22)&&t.push([b+Ze(b,C,78),C+Ze(b,C,79),v])}let n=new Fr(.8,1,24);n.rotateX(-Math.PI/2);let s=new _i({color:16777215,transparent:!0,blending:Ks,depthWrite:!1}),r=new ss(n,s,t.length);r.frustumCulled=!1,r.renderOrder=2,t.forEach((C,b)=>r.setColorAt(b,new me(0,0,0))),e.add(r);let a=520,o=[],l=[];for(let C=0;C<a;C++){let b=(Ze(C,1,3)-.5)*30,x=(Ze(C,2,3)-.5)*30,v=Ze(C,3,3)*16;o.push(b,v,x,b,v,x),l.push(0,1)}let c=new St;c.setAttribute("position",new Be(o,3)),c.setAttribute("tail",new Be(l,1));let u=new wt({uniforms:{uTime:{value:0},uCentre:{value:new k}},transparent:!0,depthWrite:!1,vertexShader:`
      uniform float uTime;
      uniform vec3 uCentre;
      attribute float tail;
      varying float vTail;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * 14.0, 16.0);
        p.y += tail * 0.55;
        p.x += tail * 0.06;
        vTail = tail;
        vec4 mv = viewMatrix * vec4(p + vec3(uCentre.x, 0.0, uCentre.z), 1.0);
        gl_Position = projectionMatrix * mv;
      }`,fragmentShader:`
      varying float vTail;
      void main() { gl_FragColor = vec4(0.82, 0.88, 0.95, 0.5 * (1.0 - vTail * 0.6)); }`}),d=new Pr(c,u);d.frustumCulled=!1,e.add(d);let h=70,m=[],g=[];for(let C=0;C<h;C++)m.push(2+Ze(C,4,5)*20,.5+Ze(C,5,5)*1.6,2+Ze(C,6,5)*20),g.push(Ze(C,7,5)*6.28);let S=new St;S.setAttribute("position",new Be(m,3)),S.setAttribute("seed",new Be(g,1));let f=Iy(),p=new wt({uniforms:{uTime:{value:0},uMap:{value:f}},transparent:!0,depthWrite:!1,blending:Ks,vertexShader:`
      uniform float uTime;
      attribute float seed;
      varying float vGlow;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.6 + seed) * 0.7;
        p.z += cos(uTime * 0.5 + seed * 1.7) * 0.7;
        p.y += sin(uTime * 0.9 + seed * 2.3) * 0.25;
        vGlow = 0.55 + 0.45 * sin(uTime * 2.4 + seed * 5.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(220.0 / -mv.z, 3.0, 24.0);
        gl_Position = projectionMatrix * mv;
      }`,fragmentShader:`
      uniform sampler2D uMap;
      varying float vGlow;
      void main() {
        vec4 c = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(c.rgb * vGlow, c.a * vGlow);
      }`}),_=new Ir(S,p);_.frustumCulled=!1,e.add(_);let M=new Ve,w=new me;return{group:e,update(C,{rain:b,dusk:x,centre:v}){d.visible=b,r.visible=b,_.visible=x,b&&(u.uniforms.uTime.value=C,u.uniforms.uCentre.value.copy(v),t.forEach(([A,R,L],N)=>{let B=(C*.75+L*7)%1,D=.08+B*.55;M.makeScale(D,1,D).setPosition(A,gs+.02,R),r.setMatrixAt(N,M),w.setScalar(.85*(1-B)*(1-B)),r.setColorAt(N,w)}),r.instanceMatrix.needsUpdate=!0,r.instanceColor&&(r.instanceColor.needsUpdate=!0)),x&&(p.uniforms.uTime.value=C)},dispose(){n.dispose(),s.dispose(),c.dispose(),u.dispose(),S.dispose(),p.dispose(),f.dispose()}}}var Tl=[{t:0,top:330004,horizon:1055283,sun:0,sunI:0,hemiSky:3820928,hemiGround:1053727,hemiI:.9},{t:5,top:461852,horizon:1318973,sun:0,sunI:0,hemiSky:3820928,hemiGround:1053727,hemiI:.9},{t:6,top:4152731,horizon:15902314,sun:16754784,sunI:1.6,hemiSky:9675976,hemiGround:4866100,hemiI:1.3},{t:7.5,top:5214166,horizon:14674408,sun:16773328,sunI:2.6,hemiSky:11061488,hemiGround:7039568,hemiI:1.7},{t:9.5,top:4032216,horizon:12575735,sun:16775920,sunI:3.1,hemiSky:12376309,hemiGround:8026712,hemiI:1.8},{t:15,top:4032216,horizon:12575735,sun:16775920,sunI:3.1,hemiSky:12376309,hemiGround:8026712,hemiI:1.8},{t:17,top:4884688,horizon:14213856,sun:16769712,sunI:2.6,hemiSky:11848680,hemiGround:8023632,hemiI:1.6},{t:18.3,top:5925544,horizon:15764043,sun:16747068,sunI:2,hemiSky:10133704,hemiGround:6965818,hemiI:1.25},{t:19.5,top:2962032,horizon:10111580,sun:16738876,sunI:.7,hemiSky:6973600,hemiGround:3811892,hemiI:1},{t:20.7,top:461852,horizon:1318973,sun:0,sunI:0,hemiSky:3820928,hemiGround:1053727,hemiI:.9},{t:24,top:330004,horizon:1055283,sun:0,sunI:0,hemiSky:3820928,hemiGround:1053727,hemiI:.9}],Ly=new me(8226964),pf=new me(11186874),Dy=new me(10335487);function Ny(i){return(i-5.5)/14*Math.PI}function mf(i,e,t){let n=i+e/60,s=0;for(;s<Tl.length-2&&n>=Tl[s+1].t;)s++;let r=Tl[s],a=Tl[s+1],o=(n-r.t)/(a.t-r.t),l=(m,g)=>new me(m).lerp(new me(g),o),c={top:l(r.top,a.top),horizon:l(r.horizon,a.horizon),sunColor:l(r.sun,a.sun),sunIntensity:r.sunI+(a.sunI-r.sunI)*o,hemiSky:l(r.hemiSky,a.hemiSky),hemiGround:l(r.hemiGround,a.hemiGround),hemiIntensity:r.hemiI+(a.hemiI-r.hemiI)*o,sunDir:new k,night:0,day:0},u=Ny(n),d=Math.sin(u),h=new k(Math.cos(u),d,.4).normalize();return c.night=Math.min(1,Math.max(0,(.12-d)/.3)),c.day=Math.min(1,Math.max(.12,d*1.6)),d<.04?(h.set(-Math.cos(u),Math.max(.35,-d),.4).normalize(),c.sunColor.copy(Dy),c.sunIntensity=.55):(h.y=Math.max(h.y,.2),h.normalize()),c.sunDir.copy(h),t==="rain"&&(c.top.lerp(Ly.clone().multiplyScalar(.4+.6*c.day),.75),c.horizon.lerp(pf.clone().multiplyScalar(.3+.7*c.day),.75),c.sunIntensity*=.35,c.hemiSky.lerp(pf,.5),c.hemiIntensity*=1.05),c}var ch=`
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
float skyHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 skyColor(vec3 d) {
  float h = clamp(d.y, -0.3, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.5));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.3, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 10.0) * 0.22 + pow(s, 600.0) * 2.5);
  float star = step(0.9965, skyHash(floor(d * 240.0)));
  col += vec3(0.9) * star * uNight * smoothstep(0.05, 0.4, d.y);
  return col;
}
`;function gf(){return{uTop:{value:new me},uHorizon:{value:new me},uSunDir:{value:new k(0,1,0)},uSunColor:{value:new me},uNight:{value:0}}}function xf(i,e){i.uTop.value.copy(e.top),i.uHorizon.value.copy(e.horizon),i.uSunDir.value.copy(e.sunDir),i.uSunColor.value.copy(e.sunColor),i.uNight.value=e.night}function vf(i){let e=new wt({uniforms:{...i},side:Zt,depthWrite:!1,depthTest:!1,fog:!1,vertexShader:`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,fragmentShader:`
      ${ch}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
        #include <colorspace_fragment>
      }`}),t=new He(new bi(450,3),e);return t.renderOrder=-100,t.frustumCulled=!1,t}var sa=class i extends He{constructor(e,t={}){super(e),this.isReflector=!0,this.type="Reflector",this.forceUpdate=!1,this._reflectionCameras=new WeakMap;let n=this,s=t.color!==void 0?new me(t.color):new me(8355711),r=t.textureWidth||512,a=t.textureHeight||512,o=t.clipBias||0,l=t.shader||i.ReflectorShader,c=t.multisample!==void 0?t.multisample:4,u=new cn,d=new k,h=new k,m=new k,g=new Ve,S=new k(0,0,-1),f=new pt,p=new k,_=new k,M=new pt,w=new Ve,C=new $t(r,a,{samples:c,type:hn}),b=new wt({name:l.name!==void 0?l.name:"unspecified",uniforms:ul.clone(l.uniforms),fragmentShader:l.fragmentShader,vertexShader:l.vertexShader});b.uniforms.tDiffuse.value=C.texture,b.uniforms.color.value=s,b.uniforms.textureMatrix.value=w,this.material=b,this.onBeforeRender=function(x,v,A){let R=this.getReflectionCamera(A);if(h.setFromMatrixPosition(n.matrixWorld),m.setFromMatrixPosition(A.matrixWorld),g.extractRotation(n.matrixWorld),d.set(0,0,1),d.applyMatrix4(g),p.subVectors(h,m),p.dot(d)>0===!0&&this.forceUpdate===!1)return;p.reflect(d).negate(),p.add(h),g.extractRotation(A.matrixWorld),S.set(0,0,-1),S.applyMatrix4(g),S.add(m),_.subVectors(h,S),_.reflect(d).negate(),_.add(h),R.position.copy(p),R.up.set(0,1,0),R.up.applyMatrix4(g),R.up.reflect(d),R.lookAt(_),R.far=A.far,R.updateMatrixWorld(),R.projectionMatrix.copy(A.projectionMatrix),R.projectionMatrix.elements[8]*=-1,R.projectionMatrix.elements[12]*=-1,w.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),w.multiply(R.projectionMatrix),w.multiply(R.matrixWorldInverse),w.multiply(n.matrixWorld),u.setFromNormalAndCoplanarPoint(d,h),u.applyMatrix4(R.matrixWorldInverse),f.set(u.normal.x,u.normal.y,u.normal.z,u.constant);let N=R.projectionMatrix;R.isOrthographicCamera?(M.x=(Math.sign(f.x)+N.elements[8])/N.elements[0],M.y=(Math.sign(f.y)+N.elements[9])/N.elements[5],M.z=-A.far,M.w=1):(M.x=(Math.sign(f.x)+N.elements[8])/N.elements[0],M.y=(Math.sign(f.y)+N.elements[9])/N.elements[5],M.z=-1,M.w=(1+N.elements[10])/N.elements[14]),f.multiplyScalar(2/f.dot(M)),N.elements[2]=f.x,N.elements[6]=f.y,R.isOrthographicCamera?(N.elements[10]=f.z-o,N.elements[14]=f.w-1):(N.elements[10]=f.z+1-o,N.elements[14]=f.w),n.visible=!1;let B=x.getRenderTarget(),D=x.xr.enabled,W=x.shadowMap.autoUpdate;x.xr.enabled=!1,x.shadowMap.autoUpdate=!1,x.setRenderTarget(C),x.state.buffers.depth.setMask(!0),x.autoClear===!1&&x.clear(),x.render(v,R),x.xr.enabled=D,x.shadowMap.autoUpdate=W,x.setRenderTarget(B);let V=A.viewport;V!==void 0&&x.state.viewport(V),n.visible=!0,this.forceUpdate=!1},this.getRenderTarget=function(){return C},this.dispose=function(){C.dispose(),n.material.dispose()},this.getReflectionCamera=function(x){let v=this._reflectionCameras.get(x);return v===void 0&&(v=x.clone(),this._reflectionCameras.set(x,v)),v}}};sa.ReflectorShader={name:"ReflectorShader",uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null}},vertexShader:`
		uniform mat4 textureMatrix;
		varying vec4 vUv;

		#include <common>
		#include <logdepthbuf_pars_vertex>

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

			#include <logdepthbuf_vertex>

		}`,fragmentShader:`
		uniform vec3 color;
		uniform sampler2D tDiffuse;
		varying vec4 vUv;

		#include <logdepthbuf_pars_fragment>

		float blendOverlay( float base, float blend ) {

			return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

		}

		vec3 blendOverlay( vec3 base, vec3 blend ) {

			return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );

		}

		void main() {

			#include <logdepthbuf_fragment>

			vec4 base = texture2DProj( tDiffuse, vUv );
			gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};function yf(){return{uDeep:{value:new me},uShallow:{value:new me},uFogColor:{value:new me},uFogDensity:{value:.006},uShore:{value:null},uLight:{value:1},uFoam:{value:1}}}var hh=`
uniform mat4 textureMatrix;
varying vec3 vWorld;
varying vec4 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`,uh=i=>`
${i==="reflect"?"#define REFLECT":i==="sky"?"#define MIRROR_SKY":""}
${ch}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uShore;
uniform float uLight;
uniform float uFoam;
varying vec3 vWorld;
varying vec4 vUv;
#ifdef REFLECT
uniform sampler2D tDiffuse;
#endif
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float dist = texture2D(uShore, (vWorld.xz + vec2(12.0)) / 48.0).r * 3.0;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 2.4, dist)) * uLight;
#if defined(REFLECT) || defined(MIRROR_SKY)
  float fresnel = 0.3 + 0.62 * pow(1.0 - clamp(view.y, 0.0, 1.0), 2.0);
  fresnel *= 0.55 + 0.45 * smoothstep(0.1, 1.2, dist);
#ifdef REFLECT
  vec2 wobble = (vec2(vnoise(vWorld.xz * 1.3), vnoise(vWorld.xz * 1.3 + 17.0)) - 0.5) * 0.03;
  vec3 mirrored = texture2DProj(tDiffuse, vec4(vUv.xy + wobble * vUv.w, vUv.zw)).rgb;
#else
  vec3 mirrored = skyColor(reflect(-view, vec3(0.0, 1.0, 0.0)));
#endif
  col = mix(col, mirrored, fresnel);
  col = mix(col, vec3(1.0) * uLight, uFoam * smoothstep(0.3, 0.04, dist) * 0.65);
#endif
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dot(vWorld - cameraPosition, vWorld - cameraPosition));
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,Al=class{constructor(e,t){this.sharedSky=e;this.shared=t;let n=()=>({...this.sharedSky,...this.shared}),s=new wt({uniforms:{...n(),textureMatrix:{value:new Ve},tDiffuse:{value:null}},vertexShader:hh,fragmentShader:uh("flat")}),r=new wt({uniforms:{...n(),textureMatrix:{value:new Ve},tDiffuse:{value:null}},vertexShader:hh,fragmentShader:uh("sky")});this.flat=new He(this.geometry,s),this.sky=new He(this.geometry,r);for(let o of[this.flat,this.sky])o.rotation.x=-Math.PI/2,o.position.y=gs,o.frustumCulled=!1;this.reflect=new sa(this.geometry,{textureWidth:640,textureHeight:400,clipBias:.003,shader:{name:"HushfootWater",uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null},...n()},vertexShader:hh,fragmentShader:uh("reflect")}});let a=this.reflect.material;for(let[o,l]of Object.entries(n()))a.uniforms[o]=l;this.reflect.rotation.x=-Math.PI/2,this.reflect.position.y=gs,this.reflect.frustumCulled=!1}sharedSky;shared;reflect;sky;flat;geometry=new wn(420,420);mode="flat";get meshes(){return[this.flat,this.sky,this.reflect]}setMode(e){this.mode=e,this.flat.visible=e==="flat",this.sky.visible=e==="sky",this.reflect.visible=e==="reflect"}get current(){return this.mode}dispose(){this.geometry.dispose(),this.flat.material.dispose(),this.sky.material.dispose(),this.reflect.dispose()}};var Uy=320,Fy=[0,13,9,6,4],_f=36*Math.PI/180,Oy=33,ky=.35,Cl=i=>Zn[i]*Math.PI/180,Rl=class{canvas;renderer;scene=new Hn;camera=new Ot(50,1,.1,700);sky=gf();waterUniforms=yf();grass=lf();dome=vf(this.sky);hemi=new Si(16777215,4473924,1);sun=new Mi(16777215,1);fog=new Tr(16777215,.007);water=new Al(this.sky,this.waterUniforms);explorer=Sl(13205806);actors=new Map;raycaster=new Gr;dof=null;islandId=0;terrain;decor;particles;worldGroup=new et;env;lighting;preset=null;width=1;height=1;dirty=!0;lastNow=null;lastRender=-1e9;ex=3.5;ez=12.5;etx=3.5;etz=12.5;eAngle=Cl("E");eTargetAngle=Cl("E");ePhase=0;jump=0;pose={tile:[3,12],heading:"E",gait:"idle",jumpStep:0};snapExplorer=!0;view={mode:"explore",yaw:90,zoom:2,focus:0};hasView=!1;glide=null;current={position:new k,target:new k,fov:50};constructor(e){this.canvas=e.canvas,this.env=e.environment,this.renderer=sr(e.canvas,e.environment.preset!=="light"),this.scene.fog=this.fog,this.scene.add(this.dome,this.hemi,this.sun,this.sun.target,...this.water.meshes,this.explorer.group),this.scene.add(this.worldGroup),this.sun.shadow.camera.left=-20,this.sun.shadow.camera.right=20,this.sun.shadow.camera.top=20,this.sun.shadow.camera.bottom=-20,this.sun.shadow.camera.near=1,this.sun.shadow.camera.far=120,this.sun.shadow.bias=-6e-4,this.sun.shadow.normalBias=.04,this.sun.target.position.set(12,0,12),this.resize(e.canvas.clientWidth||640,e.canvas.clientHeight||400),this.setIsland(e.island),this.setEnvironment(e.environment)}setIsland(e){if(e===this.islandId)return;this.islandId=e,this.terrain?.dispose(),this.decor?.dispose(),this.particles?.dispose(),this.worldGroup.removeFromParent(),this.worldGroup=new et;let t=ci(e);if(!t)throw new Error(`no island ${e}`);let n=uf[e];if(!n)throw new Error(`no palette ${e}`);this.terrain=df(t,n),this.decor=cf(t,n,this.terrain,this.grass),this.particles=ff(t),this.worldGroup.add(this.terrain.group,this.decor.group,this.particles.group),this.scene.add(this.worldGroup),this.waterUniforms.uShore.value=this.terrain.shore,this.waterUniforms.uDeep.value.set(n.water),this.waterUniforms.uShallow.value.set(n.shallow);for(let s of this.actors.values())this.scene.remove(s.rig.group);this.actors.clear(),this.snapExplorer=!0,this.decor.setLighthouse(this.env?.lighthouse==="open"),this.refreshMaterials(),this.dirty=!0}setEnvironment(e){let t=e.preset!==this.preset;this.env=e,this.lighting=mf(e.hour,e.minute,e.weather);let n=this.lighting;xf(this.sky,n),this.hemi.color.copy(n.hemiSky),this.hemi.groundColor.copy(n.hemiGround),this.hemi.intensity=n.hemiIntensity,this.sun.color.copy(n.sunColor),this.sun.intensity=n.sunIntensity,this.sun.position.copy(n.sunDir).multiplyScalar(60).add(this.sun.target.position),this.fog.color.copy(n.horizon),this.waterUniforms.uFogColor.value.copy(n.horizon),this.waterUniforms.uLight.value=(.22+.78*n.day)*(e.weather==="rain"?.8:1),this.decor.setLighthouse(e.lighthouse==="open"),t&&this.applyPreset(e.preset),this.dirty=!0}applyPreset(e){this.preset=e;let t=this.renderer,n=e==="full"?1.5:e==="balanced"?1.25:1;t.setPixelRatio(Math.min(window.devicePixelRatio||1,n)),t.setSize(this.width,this.height,!1),t.shadowMap.enabled=e!=="light",t.shadowMap.autoUpdate=!1,t.shadowMap.type=Wn,this.sun.shadow.radius=e==="full"?3:1,this.sun.castShadow=e!=="light",this.sun.shadow.mapSize.set(e==="full"?2048:1024,e==="full"?2048:1024),this.sun.shadow.map?.dispose(),this.sun.shadow.map=null,this.water.setMode(e==="full"?"reflect":e==="balanced"?"sky":"flat"),this.refreshMaterials(),this.dof?.resize(t.domElement.width,t.domElement.height)}refreshMaterials(){this.scene.traverse(e=>{if(e instanceof He){let t=Array.isArray(e.material)?e.material:[e.material];for(let n of t)n.needsUpdate=!0}})}setCreatures(e){let t=new Set,n=Ct();for(let s of e){t.add(s.id);let r=this.actors.get(s.id),a=s.x+.5,o=s.y+.5,l=Cl(s.heading);if(r)(Math.hypot(a-r.x,o-r.z)>3||n)&&(r.x=a,r.z=o,r.angle=l),r.tx=a,r.tz=o,r.targetAngle=l;else{let c=ta(s.id);if(!c)continue;let u=of(c);this.scene.add(u.group),r={rig:u,x:a,z:o,tx:a,tz:o,angle:l,targetAngle:l,phase:0},this.actors.set(s.id,r),this.applyActor(r)}}for(let[s,r]of this.actors)t.has(s)||(this.scene.remove(r.rig.group),this.actors.delete(s));this.refreshMaterials(),this.dirty=!0}applyActor(e){e.rig.group.position.set(e.x,this.terrain.heightAt(e.x,e.z)+e.rig.hover,e.z),e.rig.group.rotation.y=-e.angle}setExplorer(e){this.pose=e,this.etx=e.tile[0]+.5,this.etz=e.tile[1]+.5,this.eTargetAngle=Cl(e.heading),(this.snapExplorer||Math.hypot(this.etx-this.ex,this.etz-this.ez)>3||Ct())&&(this.ex=this.etx,this.ez=this.etz,this.eAngle=this.eTargetAngle,this.snapExplorer=!1),this.dirty=!0}setView(e,t={}){let n=this.view.mode!==e.mode||this.view.yaw!==e.yaw||this.view.zoom!==e.zoom||this.view.focus!==e.focus;this.view=e,!(!n&&this.hasView)&&(this.glide=t.cut||!this.hasView||Ct()?null:{from:By(this.current),start:performance.now()},this.hasView=!0,this.dirty=!0)}explorerGround(){return this.terrain.heightAt(this.ex,this.ez)}livePose(){let e=this.view,t=e.yaw*Math.PI/180,n=new k(Math.sin(t),0,-Math.cos(t)),s=this.explorerGround()+this.jump;if(e.mode==="photo"){let l=new k(this.ex,s+nf,this.ez).addScaledVector(n,.12),c=Math.atan(1/(2*e.zoom)),u=this.width/this.height,d=In.clamp(2*Math.atan(Math.tan(c)/u),8*Math.PI/180,80*Math.PI/180),h=new k(this.ex,s+ky,this.ez).addScaledVector(n,Math.max(2,e.focus));return{position:l,target:h,fov:In.radToDeg(d)}}let r=new k(this.ex,s+.9,this.ez),a=Fy[e.zoom]??9,o=r.clone().addScaledVector(n,-a*Math.cos(_f));return o.y+=a*Math.sin(_f),{position:o,target:r,fov:50}}updateCamera(e,t){let n=this.livePose(),s=n,r=!1;if(this.glide&&!t){let a=(e-this.glide.start)/Uy;if(a>=1)this.glide=null;else{let o=Jd(a),{from:l}=this.glide;s={position:l.position.clone().lerp(n.position,o),target:l.target.clone().lerp(n.target,o),fov:In.lerp(l.fov,n.fov,o)},r=!0}}else this.glide=null;return(this.current.fov!==s.fov||this.camera.aspect!==this.width/this.height)&&(this.camera.fov=s.fov,this.camera.aspect=this.width/this.height,this.camera.updateProjectionMatrix()),this.current=s,this.camera.position.copy(s.position),this.camera.lookAt(s.target),this.camera.updateMatrixWorld(),this.explorer.group.visible=!(this.view.mode==="photo"&&!this.glide),r}updateActors(e,t){let n=!1,s=this.pose.gait,r=t?1:qn(e,s==="run"?.05:.09),a=this.etx-this.ex,o=this.etz-this.ez,l=ea(this.eAngle,this.eTargetAngle);(Math.abs(a)>.002||Math.abs(o)>.002||Math.abs(l)>.002)&&(this.ex+=a*r,this.ez+=o*r,this.eAngle+=l*(t?1:qn(e,.06)),n=!0);let c=this.pose.jumpStep>0?[.3,.65,.65,.3][this.pose.jumpStep-1]??0:0;Math.abs(c-this.jump)>.002&&(this.jump+=(c-this.jump)*(t?1:qn(e,.06)),n=!0),!t&&(s==="walk"||s==="run")&&(this.ePhase+=e*(s==="run"?16:10),n=!0),Ml(this.explorer,t?"idle":s,this.ePhase),this.explorer.group.position.set(this.ex,this.explorerGround()+this.jump,this.ez),this.explorer.group.rotation.y=-this.eAngle,this.grass.uExplorer.value=[this.ex,this.ez];for(let d of this.actors.values()){let h=d.tx-d.x,m=d.tz-d.z,g=ea(d.angle,d.targetAngle),S=Math.abs(h)>.01||Math.abs(m)>.01;if(S||Math.abs(g)>.01){let f=t?1:qn(e,.18);d.x+=h*f,d.z+=m*f,d.angle+=g*(t?1:qn(e,.1)),n=!0}S&&!t?(d.phase+=e*9,d.rig.legs.forEach((f,p)=>{f.rotation.x=Math.sin(d.phase+(p%3===0?0:Math.PI))*.5})):d.rig.legs.forEach(f=>{f.rotation.x=0}),this.applyActor(d)}return n}frame(e){let t=this.lastNow===null?0:In.clamp((e-this.lastNow)/1e3,0,.1);this.lastNow=e;let n=Ct(),s=this.preset!=="light",r=this.updateActors(t,n);r=this.updateCamera(e,n)||r;let a=n?0:e/1e3;this.grass.uTime.value=a,this.grass.uWind.value=s&&!n?1:0,this.grass.uPart.value=s?1:0;let o=s&&!n;(o||this.dirty||r)&&this.particles.update(a,{rain:s&&this.env.weather==="rain",dusk:s&&this.env.dusk,centre:new k(this.ex,0,this.ez)}),(this.dirty||r||o&&e-this.lastRender>=Oy)&&(this.render(),this.lastRender=e,this.dirty=!1);let{position:l,target:c}=this.current;return[l.x,l.y,l.z,c.x,c.y,c.z].map(u=>u.toFixed(2)).join(",")}render(){this.renderer.shadowMap.enabled&&(this.renderer.shadowMap.needsUpdate=!0),this.dome.position.copy(this.camera.position),this.view.mode==="photo"&&this.preset!=="light"?(this.dof??=new rr(this.renderer.domElement.width,this.renderer.domElement.height),this.dof.render(this.renderer,this.scene,this.camera,this.view.focus,1)):this.renderer.render(this.scene,this.camera)}pick(e,t){let n=this.canvas.getBoundingClientRect(),s=new ze((e-n.left)/n.width*2-1,-((t-n.top)/n.height*2-1));this.camera.updateMatrixWorld(),this.raycaster.setFromCamera(s,this.camera);let r=this.raycaster.ray.intersectPlane(new cn(new k(0,1,0),-(lh-.05)),new k);if(!r)return null;let a=Math.floor(r.x),o=Math.floor(r.z),l=ci(this.islandId);return l&&a>=0&&o>=0&&a<24&&o<24&&ms(l,a,o)?[a,o]:null}capture(e){this.glide=null,this.updateActors(0,!0),this.updateCamera(performance.now(),!0),this.render();let t=Math.min(e,this.canvas.width),n=Math.round(this.canvas.height*t/this.canvas.width),s=document.createElement("canvas");s.width=t,s.height=n,s.getContext("2d").drawImage(this.canvas,0,0,t,n);let r=s.toDataURL("image/jpeg",.9);if(!r.startsWith("data:image/jpeg;base64,"))return Promise.reject(new Error("capture failed"));let a=atob(r.slice(r.indexOf(",")+1)),o=new Uint8Array(a.length);for(let l=0;l<a.length;l+=1)o[l]=a.charCodeAt(l);return Promise.resolve(new Blob([o],{type:"image/jpeg"}))}resize(e,t){this.width=Math.max(1,Math.round(e)),this.height=Math.max(1,Math.round(t)),this.renderer.setSize(this.width,this.height,!1),this.dof?.resize(this.renderer.domElement.width,this.renderer.domElement.height),this.dirty=!0}dispose(){this.terrain.dispose(),this.decor.dispose(),this.particles.dispose(),this.water.dispose(),this.dof?.dispose(),this.renderer.dispose(),this.renderer.forceContextLoss()}};function By(i){return{position:i.position.clone(),target:i.target.clone(),fov:i.fov}}function bf(i){return new Rl(i)}function Sf(i){return new yl(i)}function Mf(i){return new wl(i)}var Ai=null,Yi=!1,Pl={music:60,effects:80},dh=new Set;function zy(i,e){let n=i.createBuffer(1,i.sampleRate*8,i.sampleRate),s=n.getChannelData(0),r=.02+e*.006,a=0,o=7+e;for(let l=0;l<s.length;l++){o=o*1664525+1013904223>>>0,a+=(o/4294967295*2-1-a)*r;let c=.55+.45*Math.sin(l/s.length*Math.PI*2*2),u=Math.min(1,l/2e3,(s.length-l)/2e3);s[l]=a*c*u*5}return n}function Hy(i){let e=new AudioContext,t=e.createGain(),n=e.createGain(),s=e.createGain();t.gain.value=1,n.gain.value=Pl.music/100,s.gain.value=Pl.effects/100,n.connect(t),s.connect(t),t.connect(e.destination);let r=e.createBufferSource();return r.buffer=zy(e,i),r.loop=!0,r.connect(n),r.start(),{context:e,master:t,music:n,effects:s}}function Gy(){for(let i of dh)i.setAttribute("aria-pressed",String(Yi))}function fh(i,e){Pl.music=i,Pl.effects=e,Ai&&(Ai.music.gain.value=i/100,Ai.effects.gain.value=e/100)}function wf(i){if(!Ai||!Yi)return;let{context:e,effects:t}=Ai,n=e.createOscillator(),s=e.createGain(),r=e.currentTime,[a,o,l]=i==="shutter"?[1800,300,.09]:i==="stamp"?[520,780,.25]:[220,160,.05];n.frequency.setValueAtTime(a,r),n.frequency.exponentialRampToValueAtTime(o,r+l),s.gain.setValueAtTime(.4,r),s.gain.exponentialRampToValueAtTime(.001,r+l),n.connect(s),s.connect(t),n.start(r),n.stop(r+l)}function lr(i=1){let e=y("button",{type:"button",class:"btn","aria-pressed":String(Yi)},"Sound");return e.addEventListener("click",()=>{Ai?(Yi=!Yi,Ai.master.gain.value=Yi?1:0,Yi&&Ai.context.resume()):(Ai=Hy(i),Yi=!0),Gy()}),dh.add(e),e}function cr(i){dh.delete(i)}function xt(i,e=1,t={}){let n=y("div",{role:"status","aria-label":i,class:"status",...t});return{el:n,say(s,r={}){let a=y("p",{class:r.error?"status-line band-error":"status-line"},s);for(n.appendChild(a);n.children.length>e;)n.firstElementChild?.remove()},clear:()=>n.replaceChildren(),latest:()=>n.lastElementChild?.textContent??""}}function Ef(i){return y("div",{role:"log","aria-label":i,class:"feed"})}var ph=15,mh=.25,Tf=.5,Af=2,Vy=20,Wy=200,Xy=40,qy=400,Yy=500,Cf=[1,2,4],Il=[2,4,8,16],$y={1:.8,2:1.2,4:1.8},gh=(i,e,t)=>Math.min(t,Math.max(e,i));function Pf(i){if(fs()){let t=y("canvas",{"aria-hidden":"true"});i.prepend(t);let n=Sf(t),s=()=>{let a=i.getBoundingClientRect();a.width>0&&n.resize(Math.round(a.width),Math.round(a.height))};s();let r=new ResizeObserver(s);return r.observe(i),{set:a=>n.set(a),frame:a=>n.frame(a),dispose:()=>{r.disconnect(),n.dispose()},drawn:!0}}let e=$h();return i.prepend(e.el),{set:e.set,frame:()=>{},dispose:()=>{},drawn:!1}}function If(){return y("div",{class:"corners-lock","aria-hidden":"true"},y("i"),y("i"),y("i"),y("i"))}function Zy(i){let e=y("div",{class:"viewfinder",role:"application","aria-label":"Guide creature",tabindex:"0","aria-describedby":"guide-help","data-state":"loading"}),t={spin:0,zoom:1,stretch:0,hop:0},n=0,s=null,r=null,a=!0,o=()=>{e.dataset.spin=String(t.spin),e.dataset.zoom=t.zoom.toFixed(2),e.dataset.stretch=t.stretch.toFixed(2),e.dataset.nudges=String(n),a=!0},l=b=>{t.spin=(b%360+360)%360,o()},c=b=>i.say(b),u=Pf(e);e.append(If()),e.dataset.state=u.drawn?"ready":"still",o();let d=()=>{s?.cancel();let b=t.stretch;if(b!==0){if(Ct()){t.stretch=0,o(),c("Wump is back at rest.");return}s=Ii(Yy,x=>{t.stretch=b*(1-x),o()}),s.finished.then(()=>{t.stretch===0&&c("Wump is back at rest.")})}},h=()=>{s?.cancel(),r?.cancel(),t.spin=0,t.zoom=1,t.stretch=0,t.hop=0,o(),c("Wump is back at rest.")},m=()=>{n+=1,o(),c("Wump hops."),!Ct()&&(r?.cancel(),r=Ii(qy,b=>{t.hop=Math.sin(Math.PI*b),a=!0},b=>b))},g=b=>{t.zoom=gh(t.zoom+b,Tf,Af),o(),c(`Wump at ${Math.round(t.zoom*100)} percent.`)},S=b=>{l(t.spin+b),c(`Wump faces ${t.spin} degrees.`)};e.addEventListener("keydown",b=>{(()=>{switch(b.key){case"ArrowLeft":case"q":case"Q":return S(-ph),!0;case"ArrowRight":case"e":case"E":return S(ph),!0;case"+":case"=":return g(mh),!0;case"-":case"_":return g(-mh),!0;case" ":return m(),!0;case"Home":return h(),!0;default:return!1}})()&&b.preventDefault()});let f=new Map,p=null,_=null,M=()=>{let[b,x]=[...f.values()];return Math.hypot((b?.x??0)-(x?.x??0),(b?.y??0)-(x?.y??0))};e.addEventListener("pointerdown",b=>{e.setPointerCapture(b.pointerId),f.set(b.pointerId,{x:b.clientX,y:b.clientY}),f.size===1?(s?.cancel(),p={x:b.clientX,y:b.clientY,spin:t.spin}):f.size===2&&(p=null,_={distance:M(),zoom:t.zoom})}),e.addEventListener("pointermove",b=>{let x=f.get(b.pointerId);if(x){if(x.x=b.clientX,x.y=b.clientY,_&&f.size>=2){let v=Math.trunc((M()-_.distance)/Xy),A=gh(_.zoom+v*mh,Tf,Af);A!==t.zoom&&(t.zoom=A,o(),c(`Wump at ${Math.round(t.zoom*100)} percent.`))}else if(p){let v=b.clientX-p.x,A=b.clientY-p.y;l(p.spin+ph*Math.trunc(v/Vy)),t.stretch=Math.min(1,Math.hypot(v,A)/Wy),o()}}});let w=b=>{f.delete(b.pointerId)&&(f.size<2&&(_=null),f.size===0&&(p=null,d()))};return e.addEventListener("pointerup",w),e.addEventListener("pointercancel",w),{el:e,reset:h,frame:b=>{a&&(u.set({...t}),a=!1),u.frame(b)},dispose:()=>{s?.cancel(),r?.cancel(),u.dispose()}}}var Jy=["Zoom in on a creature that keeps its own route.","Pull focus until it is sharp and the frame corners lock.","The server scores the photo and fills a page in your album."],Ky=["Zoom 2, focus 16","Zoom 2, focus 4","Score 100 / 100"];function jy(i,e){let t=y("div",{class:"fragment-frame"}),n=Pf(t);t.append(If());let s=Rt("reel-zoom",v=>`${v}x`,1),r=Rt("reel-focus",v=>String(v),16),a=y("input",{type:"range",id:"demo-zoom",min:"0",max:String(Cf.length-1),step:"1",value:"0","aria-label":"Demo zoom"}),o=y("input",{type:"range",id:"demo-focus",min:"0",max:String(Il.length-1),step:"1",value:String(Il.length-1),"aria-label":"Demo focus"}),l={spin:30,zoom:.8,stretch:0,hop:0,focus:16},c=!0,u=()=>{let v=Cf[Number(a.value)]??1,A=Il[Number(o.value)]??16;l.zoom=$y[v]??1,l.focus=A,c=!0,a.setAttribute("aria-valuetext",`${v}x`),o.setAttribute("aria-valuetext",`${A} tiles`),s.set(v),r.set(A)};a.addEventListener("input",u),o.addEventListener("input",u);let d={size:Rt("reel-size",String,0),centring:Rt("reel-centring",String,0),facing:Rt("reel-facing",String,0),sharpness:Rt("reel-sharpness",String,0),total:Rt("reel-total",v=>`${v} / 100`,0)},h=y("div",{class:"fragment","data-ui":"score"},y("h3",null,"Photo score"),y("div",{class:"score-rows"},y("div",null,y("span",null,"Size"),d.size.el),y("div",null,y("span",null,"Centring"),d.centring.el),y("div",null,y("span",null,"Facing"),d.facing.el),y("div",null,y("span",null,"Sharpness"),d.sharpness.el),y("div",{class:"total"},y("span",null,"Total"),d.total.el))),m=Rt("reel-pages",v=>`${v} of 4 pages`,0),S=qi(1).map((v,A)=>y("li",{"data-filled":A===0?"false":"true"},v.name,y("small",null,A===0?"Not photographed yet.":"Filled"))),f=y("div",{class:"fragment","data-ui":"album"},y("h3",null,"Album page"),y("p",{class:"row"},y("strong",null,"Saltmarsh Harbour"),m.el),y("ul",{class:"album-tiles"},...S));m.set(3,{instant:!0});let p=y("div",{class:"fragment","data-ui":"camera"},y("h3",null,"Working camera"),t,y("div",{class:"readouts"},y("div",{class:"demo-readout"},y("span",null,"Zoom"),s.el),y("div",{class:"demo-readout"},y("span",null,"Focus"),r.el)),y("div",{class:"controls"},y("div",{class:"row"},y("button",{type:"button",class:"btn",onclick:e},"Reset view"),i),y("div",{class:"slider-field"},y("label",{for:"demo-zoom"},"Demo zoom"),a),y("div",{class:"slider-field"},y("label",{for:"demo-focus"},"Demo focus"),o)));u();let _=v=>{d.size.set(v?30:0),d.centring.set(v?25:0),d.facing.set(v?25:0),d.sharpness.set(v?20:0),d.total.set(v?100:0),m.set(v?4:3),S[0]?.setAttribute("data-filled",String(v));let A=S[0]?.querySelector("small");A&&(A.textContent=v?"Filled":"Not photographed yet.")},M=Jy.map((v,A)=>y("li",null,y("p",null,v),y("p",{class:"step-state"},Ky[A]))),w=y("ol",{class:"reel-steps"},...M),C=y("section",{class:"reel","aria-label":"How a photo works"},y("div",{class:"reel-pin"},p,h,f),w),b=v=>{M.forEach((A,R)=>R===v?A.setAttribute("aria-current","step"):A.removeAttribute("aria-current")),a.value=v>=0?"1":"0",o.value=v>=1?"1":String(Il.length-1),u(),_(v>=2)},x=null;if(Ct())C.classList.add("reel-static"),a.value="1",o.value="1",u(),_(!0);else{let v=-2;x=()=>{let A=C.getBoundingClientRect(),R=A.height-innerHeight,L=R>0?gh(-A.top/R,0,1):0,N=A.top>innerHeight*.4?-1:Math.min(M.length-1,Math.floor(L*M.length));N!==v&&(v=N,b(N))},addEventListener("scroll",x,{passive:!0}),x()}return{el:C,frame:v=>{c&&(n.set({...l}),c=!1),n.frame(v)},dispose:()=>{x&&removeEventListener("scroll",x),n.dispose()}}}var Rf={1:{land:"#b6c47a",shore:"#e6d9a8",rock:"#8b8f8a"},2:{land:"#6fa05a",shore:"#c9d39a",rock:"#7d8279"},3:{land:"#d9c38a",shore:"#f0e3b8",rock:"#6f8b94"},4:{land:"#9fb08c",shore:"#d4d7c0",rock:"#8a8478"},5:{land:"#c7b98f",shore:"#eadfc0",rock:"#9a9288"}};function Qy(i){let e=Rf[i.id]??Rf[1],t=ut("svg",{class:"island-map",viewBox:`0 0 ${24} ${24}`,role:"img","aria-label":`Map of ${i.name}`},ut("rect",{width:String(24),height:String(24),fill:"#5b9fb5"}));for(let n=0;n<24;n+=1)for(let s=0;s<24;s+=1){let r=xn(i,s,n);if(r==="water"){s>0&&n>0&&s<23&&n<23&&t.appendChild(ut("rect",{x:String(s),y:String(n),width:"1.02",height:"1.02",fill:"#7fbad0"}));continue}let a=s===1||n===1||s===22||n===22,o=r==="land"?a?e.shore:e.land:e.rock;t.appendChild(ut("rect",{x:String(s),y:String(n),width:"1.02",height:"1.02",fill:r==="lighthouse"?"#f2f2f2":o})),r==="lighthouse"&&t.appendChild(ut("rect",{x:String(s+.25),y:String(n),width:"0.5",height:"1",fill:"#0b0b0c"}))}return t}function e_(){let i=Lt.map(e=>y("li",{class:"island-card"},Qy(e),y("h3",null,e.name),y("ul",null,...qi(e.id).map(t=>y("li",null,`${t.name}, ${t.present}`)))));return y("section",{class:"islands",id:"islands",tabindex:"-1"},y("h2",null,"Islands"),y("ul",{class:"island-grid"},...i))}function Lf(i){let e=xt("Guide status"),t=Zy(e),n=lr(),s=jy(n,t.reset),r=e_(),a=y("a",{href:"#islands"},"Islands");a.addEventListener("click",d=>{d.preventDefault(),r.scrollIntoView({behavior:"auto"}),r.focus({preventScroll:!0})});let o=y("header",{class:"title-header"},y("a",{class:"wordmark",href:"/"},"Hushfoot"),y("nav",{class:"topnav","aria-label":"Site"},a,y("a",{href:"/text-world"},"Text world"),fa(),y("a",{class:"btn btn-primary btn-small",href:"/play"},"Start walking"))),l=y("main",{class:"hero"},y("div",{class:"hero-row"},y("h1",{class:"hero-headline"},y("span",{class:"hero-left"},"Walk softly"),y("span",{class:"hero-right"},"and bring film.")),t.el),y("p",{id:"guide-help",class:"visually-hidden"},"Arrow keys or Q and E spin Wump, plus and minus zoom, Space nudges, Home resets."),e.el);e.el.classList.add("visually-hidden"),i.root.append(y("div",{class:"title-page"},o,l,s.el,r,y("footer",{class:"title-foot"},"Marram & Wick Hushfoot. Creatures are only photographed, never caught or harmed.")));let c=0,u=d=>{t.frame(d),s.frame(d),c=requestAnimationFrame(u)};return c=requestAnimationFrame(u),{unmount:()=>{cancelAnimationFrame(c),t.dispose(),s.dispose(),cr(n)}}}var t_={bad_name:"name",bad_email:"email",bad_password:"password",bad_credentials:"email",bad_code:"code",code_expired:"code"},xh="hf-confirm-note";function vh(i,e,...t){e.root.append(y("header",{class:"topbar"},y("a",{class:"wordmark",href:"/"},"Hushfoot")),y("main",{class:"auth"},y("h1",null,i),...t))}function yh(i){let e={};return{rows:i.map(n=>{let s=y("input",{id:`field-${n.id}`,name:n.id,type:n.type,autocomplete:n.autocomplete,inputmode:n.inputmode,spellcheck:"false"});return e[n.id]=s,y("div",{class:"field"},y("label",{for:s.id},n.label),s)}),input:e}}function _h(i,e,t,n,s,r){let a=e.textContent??"";i.addEventListener("submit",o=>{if(o.preventDefault(),e.getAttribute("aria-busy")!=="true"){for(let l of Object.values(t))l.removeAttribute("aria-invalid");n.clear(),e.setAttribute("aria-busy","true"),e.textContent=s,r().catch(l=>{if(!(l instanceof ht)&&!(l instanceof Tt))throw l;n.say(l.message,{error:!0});let c=l instanceof ht?t[t_[l.code]??""]:void 0;c&&(c.setAttribute("aria-invalid","true"),c.setAttribute("aria-describedby","account-status"),c.focus())}).finally(()=>{e.removeAttribute("aria-busy"),e.textContent=a})}})}function Df(i){let{rows:e,input:t}=yh([{id:"name",label:"Name",type:"text",autocomplete:"name"},{id:"email",label:"Email",type:"email",autocomplete:"email"},{id:"password",label:"Password",type:"password",autocomplete:"new-password"}]),n=xt("Account status");n.el.id="account-status";let s=y("button",{type:"submit",class:"btn btn-primary"},"Create account"),r=y("form",{novalidate:!0},...e,s);return _h(r,s,t,n,"Creating\u2026",async()=>{(await bt("/api/signup",{name:t.name?.value,email:t.email?.value,password:t.password?.value})).code_sent||sessionStorage.setItem(xh,"failed"),await _s(),await Jn("/confirm")}),vh("Create an account",i,r,n.el,y("div",{class:"auth-links"},y("span",null,"Already walking?"),y("a",{href:"/signin"},"Sign in"))),{unmount:()=>{}}}function Nf(i){let{rows:e,input:t}=yh([{id:"email",label:"Email",type:"email",autocomplete:"email"},{id:"password",label:"Password",type:"password",autocomplete:"current-password"}]),n=xt("Account status");n.el.id="account-status";let s=y("button",{type:"submit",class:"btn btn-primary"},"Sign in"),r=y("form",{novalidate:!0},...e,s);return _h(r,s,t,n,"Signing in\u2026",async()=>{await bt("/api/session",{email:t.email?.value,password:t.password?.value}),await _s(),await Jn(zh(i.query.get("next")),{replace:!0})}),vh("Sign in",i,r,n.el,y("div",{class:"auth-links"},y("a",{href:"/signup"},"Create an account"))),{unmount:()=>{}}}function Uf(i){let{rows:e,input:t}=yh([{id:"code",label:"Confirmation code",type:"text",autocomplete:"one-time-code",inputmode:"numeric"}]),n=xt("Account status");n.el.id="account-status";let s=y("button",{type:"submit",class:"btn btn-primary"},"Confirm"),r=y("form",{novalidate:!0},...e,s),a=y("button",{type:"button",class:"btn"},"Send a new code"),o=y("a",{href:"/play"},"Later");return _h(r,s,t,n,"Confirming\u2026",async()=>{let l=await bt("/api/confirm",{code:t.code?.value.trim()});At.me&&(At.me={...At.me,player:l.player}),n.say("Email confirmed."),o.textContent="Start walking"}),a.addEventListener("click",()=>{a.getAttribute("aria-busy")!=="true"&&(a.setAttribute("aria-busy","true"),bt("/api/confirm/resend").then(()=>n.say("New code sent."),l=>{if(l instanceof ht)n.say(l.message,{error:!0});else if(l instanceof Tt)n.say("Couldn't send the code. Press Send a new code to try again.",{error:!0});else throw l}).finally(()=>a.removeAttribute("aria-busy")))}),sessionStorage.getItem(xh)==="failed"&&(sessionStorage.removeItem(xh),n.say("Couldn't send the code. Press Send a new code to try again.",{error:!0})),vh("Confirm your email",i,y("p",null,"We mailed you a six-digit code. Type it here to post postcards, pin notes and enter boards."),r,n.el,y("div",{class:"auth-links"},a,o)),{unmount:()=>{}}}var ra=[],n_='a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';function i_(i,e){if(!(i instanceof HTMLInputElement)||i.type!=="radio"||!i.name)return!0;let t=[...e.querySelectorAll('input[type="radio"]')].filter(n=>n.name===i.name);return i.checked||!t.some(n=>n.checked)&&t[0]===i}function Ff(i,e){return i===e?!0:i instanceof HTMLInputElement&&e instanceof HTMLInputElement&&i.type==="radio"&&e.type==="radio"&&i.name!==""&&i.name===e.name}function Of(i){return[...i.querySelectorAll(n_)].filter(e=>e.tabIndex>=0&&!e.disabled&&!e.closest("[inert]")&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=="hidden"&&i_(e,i))}function Nn(i){i.opener??=document.activeElement instanceof HTMLElement?document.activeElement:null,ra.push(i),(i.initial?.()??Of(i.el)[0]??i.el).focus()}function un(i){let e=ra.indexOf(i);e<0||(ra.splice(e,1),i.opener?.focus())}function s_(){return ra[ra.length-1]}function r_(i){let e=s_();if(e){if(i.key==="Escape")i.preventDefault(),i.stopPropagation(),e.dismiss();else if(i.key==="Tab"&&e.modal){let t=Of(e.el);if(t.length===0){i.preventDefault();return}let n=t[0],s=t[t.length-1],r=e.el.contains(document.activeElement);i.shiftKey&&(Ff(document.activeElement,n)||!r)?(i.preventDefault(),s.focus()):!i.shiftKey&&(Ff(document.activeElement,s)||!r)&&(i.preventDefault(),n.focus())}}}document.addEventListener("keydown",r_,!0);var xs=crypto.randomUUID(),a_=["world","progress","position","restart","host_position","like","note","board","safari_joined","safari_left","safari_ended","sighting","safari_photo"],kf=250,o_=3,l_=16;function c_(i){try{let e=URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${kf})`],{type:"text/javascript"})),t=new Worker(e);return t.onmessage=i,{stop:()=>{t.terminate(),URL.revokeObjectURL(e)}}}catch{return null}}function dn(i={}){let e=new Map,t=null,n=!1,s=null,r=c=>{if(s?.stop(),s=null,n)return;let u=new URLSearchParams({link:crypto.randomUUID(),age:String(c*kf+150)});i.hall&&u.set("hall",i.hall),t=new EventSource(`/api/live?${u}`);for(let d of a_)t.addEventListener(d,h=>{let m=JSON.parse(h.data);for(let g of e.get(d)??[])g(m)})},a=0,o=-1,l=0;return s=c_(()=>{a+=1;let c=performance.getEntriesByType("resource").length;l=c===o&&document.readyState==="complete"?l+1:0,o=c,(l>=o_||a>=l_)&&r(a)}),s||r(0),{on(c,u){let d=e.get(c)??[];d.push(u),e.set(c,d)},close:()=>{n=!0,s?.stop(),t?.close()}}}var Bf=i=>`You are on ${Lt.find(t=>t.id===i.island)?.name??""} at tile ${i.tile[0]}, ${i.tile[1]}.`;function zf(i){return new Map(i.albums.map(e=>[e.island,e.pages_filled]))}function Hf(i){let e=new Map;for(let t of i)e.set(t.creature,Math.max(e.get(t.creature)??0,t.score.total));return e}function Ll(i={}){let e=At.me!==null,t=y("div",{class:"tw"}),n=xt("Text world status"),s=null,r=!1,a=null,o="",l=new Map,c=new Map,u=new Map,d=y("p"),h=y("p"),m=y("p"),g=y("p"),S=y("button",{type:"button",class:"btn"},"Refill film");function f(){for(let b of Lt){for(let x of qi(b.id)){let v=a?.best.get(x.id),A=a?v===void 0?`${x.name}: ${x.present}, not photographed yet`:`${x.name}: ${x.present}, photographed, best ${v} points`:`${x.name}: ${x.present}`,R=l.get(x.id);v===void 0?R.textContent=A:jt(R,A)}a&&(jt(c.get(b.id),`${a.pages.get(b.id)??0} of 4 album pages`),u.get(b.id).hidden=b.id===a.position.island)}a&&(jt(d,`Stamps: ${a.stamps}`),h.textContent=`Lighthouse: ${a.lighthouse}`,jt(m,`Film: ${Ss(a.film)}`),o=Bf(a.position),jt(g,o),S.disabled=a.position.island!==_l||a.film>=36)}function p(b){a&&(a.position=b,f(),n.say(Bf(b)))}function _(b){a&&(a.film=b.film,a.stamps=b.stamps,a.lighthouse=b.lighthouse,a.pages=zf(b))}function M(b){if(b instanceof ht||b instanceof Tt)n.say(b.message,{error:!0});else throw b}for(let b of Lt){let x=y("ul",{class:"tw-list"});for(let A of qi(b.id)){let R=y("li",null,`${A.name}: ${A.present}`);l.set(A.id,R),x.appendChild(R)}let v=y("section",{class:"tw-island"},y("h2",null,b.name));if(e){let A=y("button",{type:"button",class:"btn",hidden:!0},`Sail to ${b.name}`);A.addEventListener("click",()=>{let L=li[0];Fn("/api/me/position",{island:b.id,tile:L.tile,heading:L.heading},{"X-Tab-Id":xs}).then(N=>p(N.position),M)}),u.set(b.id,A);let R=y("p",{class:"tw-pages"});c.set(b.id,R),v.append(A,x,R)}else v.append(x);t.appendChild(v)}let w=y("section",{class:"tw-progress"},y("h2",null,"Your progress"));e?(S.addEventListener("click",()=>{bt("/api/me/refill").then(b=>{a&&(a.film=b.film),f(),n.say(`Film refilled to ${b.film} frames.`)},M)}),w.append(y("div",{class:"tw-lines"},d,h,m,g),y("div",{class:"tw-actions"},S))):w.append(y("p",null,"Sign in to see your progress."),y("a",{class:"btn",href:"/signin?next=/text-world"},"Sign in")),w.appendChild(n.el),t.appendChild(w),f(),t.hidden=e;async function C(){let[b,x,v]=await Promise.all([at("/api/me"),at("/api/me/albums"),at("/api/me/photos")]);a={position:b.position,film:b.film,stamps:b.stamps,lighthouse:b.lighthouse,pages:zf(x),best:Hf(v.photos)},f()}return e&&C().finally(()=>{t.hidden=!1}).then(()=>{s=i.live??dn(),r=i.live===void 0,s.on("progress",b=>{_(b),f(),at("/api/me/photos").then(x=>{a&&(a.best=Hf(x.photos),f())},M)}),s.on("position",b=>{b.tab!==xs&&p({island:b.island,tile:b.tile,heading:b.heading})}),s.on("restart",b=>{_(b.progress),p(b.position)})},M),{el:t,unmount:()=>{r&&s?.close()}}}function Gf(i){let e=Lt.map(p=>({island:p.id,island_name:p.name,pages_filled:0,stamp:!1,pages:qi(p.id).map(_=>({creature:_.id,creature_name:_.name,filled:!1,photo_id:null,total:null}))})),t=i.island(),n=Rt("album-pages",Xh,0),s=Lt.map(p=>y("button",{type:"button",role:"tab",class:"album-tab","aria-selected":"false",tabindex:-1,id:`album-tab-${p.id}`,onclick:()=>S(p.id,!0),onkeydown:_=>h(_,p.id)},p.name)),r=y("ul",{role:"list","aria-label":"Album pages",class:"album-pages"}),a=y("button",{type:"button",class:"btn",onclick:()=>i.onRefill()},"Refill film"),o=y("a",{class:"btn",href:"/hall"},"Your hall"),l=y("a",{class:"btn",href:"/boards/1"},"Challenge board"),c=y("button",{type:"button",class:"btn",onclick:()=>i.onClose()},"Close album"),u=new Map,d=y("section",{class:"album-pane","aria-label":"Album pane"},y("header",{class:"pane-head"},y("h2",null,"Album"),c),y("div",{role:"tablist","aria-label":"Islands",class:"album-tabs"},s),y("p",{class:"album-count"},n.el),r,y("div",{class:"pane-actions"},a,o,l));function h(p,_){let M=Lt.findIndex(b=>b.id===_),w=p.key==="ArrowRight"?M+1:p.key==="ArrowLeft"?M-1:p.key==="Home"?0:p.key==="End"?Lt.length-1:null;if(w===null)return;p.preventDefault();let C=Lt[(w+Lt.length)%Lt.length];C&&S(C.id,!0)}function m(p,_){let M=u.get(_);if(!M){let A=y("div",{class:"album-page-body"});M={li:y("li",{class:"album-page"},y("h3",null,p.creature_name),A),body:A},u.set(_,M),r.appendChild(M.li)}let{body:w,li:C}=M;if(C.dataset.filled=String(p.filled),!p.filled||p.photo_id===null){w.querySelector(".album-empty")||w.replaceChildren(y("p",{class:"album-empty"},"Not photographed yet."));return}let b=`/api/photos/${p.photo_id}/image`,x=w.querySelector("img");if(x){x.getAttribute("src")!==b&&x.setAttribute("src",b);let A=w.querySelector(".album-score");A&&A.replaceChildren(bs(`${p.total} points`));let R=w.querySelector("button");R.onclick=()=>i.onPostcard(p.photo_id,p.creature_name,R);return}let v=y("button",{type:"button",class:"btn btn-small","aria-label":`Send ${p.creature_name} photo as a postcard`},"Postcard");v.onclick=()=>i.onPostcard(p.photo_id,p.creature_name,v),w.replaceChildren(y("img",{src:b,alt:`${p.creature_name} photo`,width:960,height:600,class:"album-photo"}),y("p",{class:"album-score"},bs(`${p.total} points`)),v)}function g(p){let _=e.find(M=>M.island===t);s.forEach((M,w)=>{let C=Lt[w]?.id===t;M.setAttribute("aria-selected",String(C)),M.tabIndex=C?0:-1}),n.set(_.pages_filled,{instant:p}),l.setAttribute("href",`/boards/${t}`);for(let M of _.pages)m(M,M.creature)}function S(p,_){p!==t&&(t=p,u.clear(),r.replaceChildren()),g(!1),_&&s[Lt.findIndex(M=>M.id===p)].focus()}g(!0);let f={el:d,closeButton:c,update(p,_={}){e=p.albums,g(_.instant??!1),f.refreshRefill()},select(p,_={}){p!==t&&(t=p,u.clear(),r.replaceChildren()),g(_.instant??!0)},refreshRefill(){a.disabled=!(i.island()===_l&&i.film()<36)},selectedTab(){return s[Lt.findIndex(p=>p.id===t)]}};return f.refreshRefill(),f}function aa(i){let e=y("div",{role:i.role??"dialog","aria-label":i.name,class:"modal"},i.title?y("h2",{class:"modal-title"},i.title):null,...i.body),t=y("div",{class:"modal-veil",hidden:!0},e);document.getElementById("layers")?.appendChild(t);let n={el:e,modal:!0,initial:i.initial,dismiss:()=>s.close()},s={el:e,destroy(){t.hidden||un(n),t.remove()},get isOpen(){return!t.hidden},open(r){t.hidden&&(i.onOpen?.(),t.hidden=!1,n.opener=r??(document.activeElement instanceof HTMLElement?document.activeElement:null),Nn(n))},close(){t.hidden||(t.hidden=!0,un(n),i.onClose?.())}};return s}function Sh(i){let e=y("div",{class:"dialog-status"});return{slot:e,onOpen:()=>e.appendChild(i.status.el),onClose:()=>i.home.appendChild(i.status.el)}}var h_=i=>{if(i instanceof Tt)return"Couldn't save settings. Try again.";if(i instanceof ht)return i.message;throw i};function Vf(i){let e=(d,h)=>{let m=y("input",{type:"range",min:0,max:100,step:5,id:h,"aria-label":d}),g=y("output",{class:"range-value",for:h});return m.addEventListener("input",()=>{g.textContent=m.value}),{row:y("div",{class:"field range-field"},y("label",{for:h},d),y("div",{class:"range-row"},m,g)),input:m,output:g}},t=e("Music volume","setting-music"),n=e("Effects volume","setting-effects"),r=[["full","Full"],["balanced","Balanced"],["light","Light"]].map(([d,h])=>({value:d,input:y("input",{type:"radio",name:"graphics",value:d}),label:h})),a=y("div",{role:"radiogroup","aria-label":"Graphics",class:"radio-group"},r.map(d=>y("label",{class:"radio"},d.input,y("span",null,d.label)))),o=y("button",{type:"button",class:"btn btn-primary"},"Save settings"),l=y("button",{type:"button",class:"btn"},"Close"),c=Sh(i.docked),u=aa({name:"Settings",title:"Settings",body:[t.row,n.row,y("div",{class:"field"},y("p",{class:"label"},"Graphics"),a),c.slot,y("div",{class:"row"},o,l)],initial:()=>t.input,onOpen:()=>{let d=i.current();t.input.value=String(d.music),t.output.textContent=String(d.music),n.input.value=String(d.effects),n.output.textContent=String(d.effects);for(let h of r)h.input.checked=h.value===d.graphics;i.docked.status.clear(),c.onOpen()},onClose:c.onClose});return l.addEventListener("click",()=>u.close()),o.addEventListener("click",async()=>{let d=r.find(h=>h.input.checked)?.value??i.current().graphics;try{await i.save({music:Number(t.input.value),effects:Number(n.input.value),graphics:d}),i.docked.status.say("Settings saved.")}catch(h){i.docked.status.say(h_(h),{error:!0})}}),u}function Wf(i){let e=y("button",{type:"button",class:"btn"},"Restart"),t=y("button",{type:"button",class:"btn"},"Keep playing"),n=aa({name:"Restart the expedition?",role:"alertdialog",title:"Restart the expedition?",body:[y("p",null,"Start the whole expedition again?"),y("div",{class:"row"},e,t)],initial:()=>t});return t.addEventListener("click",()=>n.close()),e.addEventListener("click",async()=>{await i.restart(),n.close()}),n}function Xf(i){let e=y("input",{type:"text",id:"safari-code","aria-label":"Safari code",autocomplete:"off",autocapitalize:"characters",spellcheck:"false",maxlength:12}),t=y("button",{type:"button",class:"btn"},"Join"),n=Sh(i.docked),s=aa({name:"Join a safari",title:"Join a safari",body:[y("div",{class:"field"},y("label",{for:"safari-code"},"Safari code"),e),n.slot,y("div",{class:"row"},t)],initial:()=>e,onOpen:n.onOpen,onClose:n.onClose}),r=async()=>{if(t.getAttribute("aria-busy")!=="true"){t.setAttribute("aria-busy","true");try{await i.join(e.value.trim().toUpperCase())?(e.value="",s.close()):e.focus()}finally{t.removeAttribute("aria-busy")}}};return t.addEventListener("click",()=>{r()}),e.addEventListener("keydown",a=>{a.key==="Enter"&&(a.preventDefault(),r())}),s}function qf(i){let e=y("input",{type:"email",id:"postcard-recipient","aria-label":"Recipient email",autocomplete:"off"}),t=y("textarea",{id:"postcard-line","aria-label":"Your line",rows:3}),n=y("button",{type:"button",class:"btn btn-primary"},"Post"),s=y("button",{type:"button",class:"btn"},"Cancel"),r=y("p",{class:"hint"}),a=Sh(i.docked),o="",l=null,c=aa({name:"Send postcard",title:"Send postcard",body:[r,y("div",{class:"field"},y("label",{for:"postcard-recipient"},"Recipient email"),e),y("div",{class:"field"},y("label",{for:"postcard-line"},"Your line"),t),a.slot,y("div",{class:"row"},n,s)],initial:()=>e,onOpen:a.onOpen,onClose:a.onClose});return s.addEventListener("click",()=>c.close()),n.addEventListener("click",async()=>{if(n.getAttribute("aria-busy")==="true")return;let u={photo:o,recipient:e.value.trim(),line:t.value},d=JSON.stringify(u);l?.body!==d&&(l={body:d,key:crypto.randomUUID()}),n.setAttribute("aria-busy","true"),n.textContent="Posting\u2026";try{await i.send(u,l.key)&&(e.value="",t.value="",l=null,c.close())}finally{n.removeAttribute("aria-busy"),n.textContent="Post"}}),Object.assign(c,{prepare(u,d){o=u,l=null,r.textContent=`A postcard of your ${d} photo, mailed to anyone.`}})}var hi=(i,e="")=>y("button",{type:"button",class:`btn hud-btn ${e}`.trim()},i);function Yf(i,e,t){let n=hi("Camera");n.setAttribute("aria-pressed","false");let s=hi("Zoom in"),r=hi("Zoom out"),a=hi("Focus"),o=y("button",{type:"button",class:"btn btn-primary hud-btn shutter"},"Take photo"),l=y("div",{class:"photo-controls",hidden:!0},s,r,a,o),c=hi("Map"),u=hi("Album"),d=hi("Settings"),h=hi("Restart expedition"),m=hi("Run","touch-btn");m.setAttribute("aria-pressed","false");let g=hi("Jump","touch-btn"),S=y("span",{class:"joystick-knob"}),f=y("div",{role:"group","aria-label":"Joystick",class:"joystick"},S),p=y("a",{class:"skip-link",href:"/text-world"},"Skip to the text world"),_=Rt("film",Ss,i),M=Rt("stamps",Wh,e),w=y("span",{role:"timer","aria-label":"World time",class:"world-time"}),C=y("div",{class:"chips"},y("span",{class:"chip"},_.el),y("span",{class:"chip"},M.el),y("span",{class:"chip"},w)),b=y("div",{class:"hud-messages"}),x=y("div",{class:"safari-slot"}),v=y("div",{class:"hud-controls"},m,g),A=y("div",{class:"hud"},y("div",{class:"hud-bar"},n,l,c,u,t,d,h),C,b,x,f,v);return{skip:p,bar:A,camera:n,zoomIn:s,zoomOut:r,focus:a,take:o,map:c,album:u,settings:d,restart:h,run:m,jump:g,photoControls:l,joystick:f,knob:S,film:_,stamps:M,time:w,messages:b,safariSlot:x,controls:v,chips:C}}var u_={water:"#8fbcd0",land:"#a9c58a",rock:"#7d8288",lighthouse:"#f4f1e8"},d_=6;function $f(i){let e=y("canvas",{"aria-hidden":"true"}),t=y("div",{role:"application","aria-label":"Island map",tabindex:0,class:"island-map","data-cursor":"0,0","data-tile-size":"12"},e),n=e.getContext("2d"),s,r=12,a=[0,0],o={tile:[0,0],heading:"N"},l=[],c=null,u=()=>{if(!s)return;n.setTransform(1,0,0,1,0,0),n.clearRect(0,0,e.width,e.height);let m=e.width/(24*r);n.scale(m,m);for(let p=0;p<24;p++)for(let _=0;_<24;_++)n.fillStyle=u_[xn(s,_,p)],n.fillRect(_*r,p*r,r,r);n.fillStyle="#0b0b0c";for(let p of l){if(p.island!==s.id)continue;let _=(p.x+.5)*r,M=(p.y+.5)*r;n.beginPath(),n.moveTo(_,M-r*.4),n.lineTo(_+r*.4,M),n.lineTo(_,M+r*.4),n.lineTo(_-r*.4,M),n.closePath(),n.fill()}let[g,S]=o.tile;n.save(),n.translate((g+.5)*r,(S+.5)*r),n.rotate(Zn[o.heading]*Math.PI/180),n.fillStyle="#ffffff",n.strokeStyle="#0b0b0c",n.lineWidth=Math.max(1.5,r*.15),n.beginPath(),n.moveTo(0,-r*.55),n.lineTo(r*.42,r*.4),n.lineTo(-r*.42,r*.4),n.closePath(),n.fill(),n.stroke(),n.restore(),n.strokeStyle="#0b0b0c",n.lineWidth=Math.max(2,r*.2);let f=n.lineWidth/2;n.strokeRect(a[0]*r+f,a[1]*r+f,r-n.lineWidth,r-n.lineWidth)},d=m=>{a=m,t.dataset.cursor=`${m[0]},${m[1]}`,u()},h=m=>{let g=t.getBoundingClientRect(),S=f=>Math.min(23,Math.max(0,Math.floor(f/r)));return[S(m.clientX-g.left),S(m.clientY-g.top)]};return t.addEventListener("keydown",m=>{let[g,S]=a,p={ArrowLeft:[g-1,S],ArrowRight:[g+1,S],ArrowUp:[g,S-1],ArrowDown:[g,S+1]}[m.key];p?(m.preventDefault(),d([Math.min(23,Math.max(0,p[0])),Math.min(23,Math.max(0,p[1]))])):m.key==="Enter"?(m.preventDefault(),i.onWalk(a)):m.key.toLowerCase()==="s"&&!m.ctrlKey&&!m.metaKey&&(m.preventDefault(),i.onSighting(a))}),t.addEventListener("pointerdown",m=>{c={x:m.clientX,y:m.clientY,id:m.pointerId},t.focus()}),t.addEventListener("pointerup",m=>{let g=c;if(c=null,!g||g.id!==m.pointerId||Math.hypot(m.clientX-g.x,m.clientY-g.y)>=d_)return;let S=h(m);d(S),i.onWalk(S)}),t.addEventListener("pointercancel",()=>{c=null}),{el:t,setIsland(m){s=m,u()},setExplorer(m,g){o={tile:m,heading:g},u()},setSightings(m){l=m,u()},resetCursor(m){d(m)},fit(m){let g=Math.max(8,Math.floor(m/24)),S=Math.min(2,window.devicePixelRatio||1);r=g,t.dataset.tileSize=String(g),t.style.width=t.style.height=`${24*g}px`,e.width=e.height=24*g*S,e.style.width=e.style.height=`${24*g}px`,u()}}}var f_=180,p_=210;function Zf(){let i=xt("Frame guide"),e=y("span",{class:"readout-value"}),t=y("span",{class:"readout-value"}),n=y("span",{class:"readout","data-readout":"zoom"},y("span",{class:"readout-label"},"Zoom"),e),s=y("span",{class:"readout","data-readout":"focus"},y("span",{class:"readout-label"},"Focus"),t),r=y("div",{class:"guide",hidden:!0},y("span",{class:"guide-corner tl"}),y("span",{class:"guide-corner tr"}),y("span",{class:"guide-corner bl"}),y("span",{class:"guide-corner br"}),y("span",{class:"guide-centre"}),y("div",{class:"guide-label"},i.el),y("div",{class:"guide-readouts"},n,s)),a=y("div",{class:"shutter-bar top"}),o=y("div",{class:"shutter-bar bottom"}),l=y("img",{alt:"",class:"thumb-image"}),c=y("figure",{class:"thumb",hidden:!0},l,y("figcaption",null,"Scoring")),u=y("div",{class:"overlay"},r,a,o,c),d=null,h=null,m=g=>{r.style.setProperty("--draw",String(g))};return{el:u,frameGuide:i,drawGuide(g){d?.cancel(),r.hidden=!1,m(0),d=ur(f_,S=>{m(S),S>=1&&g()})},hideGuide(){d?.cancel(),r.hidden=!0},setLock:g=>r.classList.toggle("lock",g),setReadouts(g,S){jt(e,`${g}\xD7`),jt(t,String(S))},runShutter(g){h?.cancel(),h=Ii(p_,S=>{let p=`${(S<.5?S*2:(1-S)*2)*50}%`;a.style.height=o.style.height=S>=1?"0":p,S>=1&&g()},S=>S)},showThumbnail(g){l.src=g,c.hidden=!1},hideThumbnail(){c.hidden=!0,l.removeAttribute("src")}}}var Jf=280,Kf=()=>!matchMedia("(min-width: 768px)").matches,Dl=()=>matchMedia("(min-width: 1200px)").matches,$i=class{constructor(e){this.el=e;e.hidden=!0}el;running=null;get open(){return!this.el.hidden&&!this.el.inert}show(){this.running?.cancel();let e=Kf()?"Y":"X";this.el.hidden=!1,this.el.inert=!1,this.el.removeAttribute("aria-hidden"),this.running=ur(Jf,t=>{this.el.style.transform=t>=1?"":`translate${e}(${(1-t)*100}%)`})}hide(){this.running?.cancel();let e=Kf()?"Y":"X";this.el.inert=!0,this.el.setAttribute("aria-hidden","true");let t=ur(Jf,n=>{n>=1?(this.el.hidden=!0,this.el.style.transform=""):this.el.style.transform=`translate${e}(${n*100}%)`});this.running=t}};var m_={toward:"faces you",side:"side-on",away:"faces away"};function jf(i){let e=y("h2",{class:"sheet-title"}),t=y("dl",{class:"result-rows"}),n=Rt("score-total",qh,0),s=y("button",{type:"button",class:"btn"},"Close"),r=y("button",{type:"button",class:"btn"},"Send as postcard"),a=y("div",{role:"dialog","aria-label":"Photo result",class:"sheet result-sheet"},y("header",{class:"pane-head"},e,s),t,y("p",{class:"result-total"},y("span",{class:"result-total-label"},"Total"),n.el),y("div",{class:"pane-actions"},r));document.getElementById("layers")?.appendChild(a);let o=new $i(a),l=null,c={el:a,modal:!0,initial:()=>s,dismiss:()=>u.close()},u={get isOpen(){return o.open},show(d,h){l=d,e.textContent=d.creature_name;let{score:m,measures:g}=d,S=[["Size","score-size",m.size,`${g.distance} tiles away, best ${g.best_distance}`],["Centring","score-centring",m.centring,`${g.offset} tiles off centre`],["Facing","score-facing",m.facing,m_[g.creature_facing]],["Sharpness","score-sharpness",m.sharpness,`focus ${g.focus_error} tiles off`]];t.replaceChildren(...S.flatMap(([f,p,_,M])=>{let w=Rt(p,Yh,0);return w.set(_,{from:0}),[y("dt",null,f),y("dd",null,w.el,y("span",{class:"result-note"},M))]})),n.set(m.total,{from:0}),c.opener=h,o.show(),Nn(c)},close(){o.open&&(o.hide(),un(c))},destroy(){o.open&&un(c),a.remove()}};return s.addEventListener("click",()=>u.close()),r.addEventListener("click",()=>{l&&i.onPostcard(l.id,l.creature_name,r)}),u}function Qf(i){let e=y("p",{class:"safari-code"}),t=y("ul",{role:"list","aria-label":"Sightings",class:"safari-sightings"}),n=Ef("Safari feed"),s=y("button",{type:"button",class:"btn btn-small"}),r=y("section",{role:"region","aria-label":"Safari",class:"safari",hidden:!0},y("div",{class:"safari-head"},e,s),t,n),a=[],o=new Set,l=!1;s.addEventListener("click",()=>l?i.onEnd():i.onLeave());let c=u=>{let d=`${u.island}:${u.x}:${u.y}:${u.by}`;o.has(d)||(o.add(d),a.push(u),t.appendChild(y("li",null,`Sighting at ${u.x}, ${u.y} by ${u.by}`)))};return{el:r,get sightings(){return a},set(u){if(!u||u.status==="ended"){r.hidden=!0,t.replaceChildren(),n.replaceChildren(),a.length=0,o.clear();return}let d=r.hidden;if(r.hidden=!1,l=u.host.id===i.playerId,e.textContent=`Safari code ${u.code}`,s.textContent=l?"End safari":"Leave safari",d)for(let h of u.sightings??[])c(h)},addSighting:c,addFeed(u,d){n.appendChild(y("div",{class:"feed-entry"},y("p",null,`${u} photographed ${d.creature_name}: ${d.score.total} points.`),y("img",{src:d.image_url,alt:`${d.creature_name} photo by ${u}`,width:960,height:600,loading:"lazy"})))}}}var ep={water:"#8fbcd0",land:"#a9c58a",rock:"#7d8288",lighthouse:"#f4f1e8"};function tp(i){let e=[];for(let n=0;n<24;n++)for(let s=0;s<24;s++){let r=xn(i,s,n);r!=="water"&&e.push(ut("rect",{x:s,y:n,width:1.02,height:1.02,fill:ep[r],rx:r==="rock"?.3:0}))}let t=li.map(({tile:[n,s]})=>ut("circle",{cx:n+.5,cy:s+.5,r:.28,fill:"#0b0b0c"}));return ut("svg",{role:"img","aria-label":`Still map of ${i.name}`,viewBox:`0 0 ${24} ${24}`,class:"still-map"},ut("rect",{width:24,height:24,fill:ep.water}),...e,...t)}function g_(i,e,t){let[n,s]=i,[r,a]=t;switch(e){case"N":return{a:s-a,l:r-n};case"E":return{a:r-n,l:a-s};case"S":return{a:a-s,l:n-r};case"W":return{a:n-r,l:s-a}}}function np(i,e,t,n){let s=[];for(let r of n){let{a,l:o}=g_(i,e,[r.x,r.y]);a>=1&&a<=24&&2*t*Math.abs(o)<=a&&s.push({id:r.id,a,l:o})}return s.sort((r,a)=>r.a-a.a||Math.abs(r.l)-Math.abs(a.l)||(r.id<a.id?-1:1))}var ip=100,sp=4;function rp(i,e,t){if(!ms(i,t[0],t[1]))return null;let n=(u,d)=>d*24+u,s=new Map([[n(t[0],t[1]),0]]),r=[t];for(let u=0;u<r.length;u++){let[d,h]=r[u],m=s.get(n(d,h));for(let g of ps){let[S,f]=oi[g],p=d+S,_=h+f;ms(i,p,_)&&!s.has(n(p,_))&&(s.set(n(p,_),m+1),r.push([p,_]))}}let a=s.get(n(e[0],e[1]));if(a===void 0)return null;let o=[],[l,c]=e;for(;a>0;)[l,c]=ps.map(d=>[l+oi[d][0],c+oi[d][1]]).find(([d,h])=>s.get(n(d,h))===a-1),o.push([l,c]),a--;return o}var Nl=class{constructor(e,t,n,s){this.island=e;this.hooks=s;this.tile=t,this.heading=n}island;hooks;step=0;tile;heading;gait="idle";jumpStep=0;frozen=!1;runToggle=!1;startedAt=0;holds=[];heldCount=0;heldHeading=null;jumpPending=!1;path=null;pathCount=0;start(e){this.startedAt=e}place(e,t,n){this.island=e,this.tile=t,this.heading=n,this.path=null,this.jumpStep=0,this.jumpPending=!1,this.gait="idle",this.heldCount=0,this.heldHeading=null}snapshot(){return{tile:this.tile,heading:this.heading,gait:this.gait,jumpStep:this.jumpStep}}catchUp(e){for(;this.startedAt+(this.step+1)*ip<=e;)this.runStep(this.startedAt+(this.step+1)*ip)}press(e,t,n){this.catchUp(n),!this.holds.some(s=>s.id===e&&s.up===null)&&this.holds.push({id:e,heading:t,down:n,up:null})}release(e,t){this.catchUp(t);for(let n of this.holds)n.id===e&&n.up===null&&(n.up=t)}releaseAll(e){this.catchUp(e);for(let t of this.holds)t.up===null&&(t.up=e)}requestJump(e){this.catchUp(e),this.jumpPending=!0}toggleRun(e){return this.catchUp(e),this.runToggle=!this.runToggle,this.runToggle}walkPath(e,t){this.catchUp(t),this.path=e,this.pathCount=0}cancelPath(){this.path=null}get walking(){return this.path!==null}heldAt(e,t){let n;for(let s of this.holds)s.heading===null!==t||!(s.down<e&&(s.up===null||s.up>=e))||(!n||s.down>=n.down)&&(n=s);return n}moveTo(e){this.tile=e,this.hooks.onTileChange(e,this.heading)}ahead(e,t,n){let[s,r]=oi[t];return[e[0]+s*n,e[1]+r*n]}runStep(e){this.step++,this.holds=this.holds.filter(s=>s.up===null||s.up>=e);let t=this.runToggle||this.heldAt(e,!0)!==void 0,n=this.frozen?void 0:this.heldAt(e,!1)?.heading??void 0;if(this.jumpStep>0||this.jumpPending){if(this.heldCount=0,this.heldHeading=null,this.path=null,this.jumpPending=!1,this.jumpStep++,this.gait="jump",this.jumpStep===sp){let s=this.ahead(this.tile,this.heading,2);ms(this.island,s[0],s[1])&&this.moveTo(s)}this.hooks.onStep(this.step,this.snapshot()),this.jumpStep===sp&&(this.jumpStep=0);return}if(n){if(this.path=null,this.heldCount=n===this.heldHeading?this.heldCount+1:1,this.heldHeading=n,this.heading=n,this.gait=t?"run":"walk",t||this.heldCount%2===1){let s=this.ahead(this.tile,n,1);ms(this.island,s[0],s[1])&&this.moveTo(s)}}else if(this.heldCount=0,this.heldHeading=null,this.path&&!this.frozen){if(this.pathCount++,this.gait=t?"run":"walk",t||this.pathCount%2===1){let s=this.path.shift();this.heading=this.headingTo(this.tile,s),this.moveTo(s),this.path.length===0&&(this.path=null)}}else this.gait="idle";this.hooks.onStep(this.step,this.snapshot())}headingTo(e,t){return ps.find(n=>oi[n][0]===t[0]-e[0]&&oi[n][1]===t[1]-e[1])}};var Mh=[1,2,3,4],wh=[1,2,4],Eh=[2,4,8,16],x_=6,v_=16,y_=40,ap={w:"N",arrowup:"N",a:"W",arrowleft:"W",s:"S",arrowdown:"S",d:"E",arrowright:"E"},op=6,Th=i=>(i%360+360)%360,lp=i=>Math.sign(i)*Math.round(Math.abs(i)/2),Ul=class{constructor(e){this.deps=e;this.island=e.island,this.world=e.world,this.preset=e.preset,this.lighthouse=e.lighthouse,this.exploreYaw=Zn[e.heading],this.el=y("div",{role:"application","aria-label":"World view",tabindex:0,class:"world-view"},this.canvas,e.overlay.el),this.scene=bf({canvas:this.canvas,island:e.island.id,environment:this.environment()}),this.sim=new Nl(e.island,e.tile,e.heading,{onStep:(t,n)=>this.stepped(t,n),onTileChange:(t,n)=>{this.nearby(),e.onMoved(t,n)}}),this.bind(),this.paintAll(),this.scene.setCreatures(this.creaturesHere()),this.scene.setExplorer(this.sim.snapshot()),this.pushView(!0),this.raf=requestAnimationFrame(this.loop)}deps;el;canvas=y("canvas",{class:"world-canvas"});scene;sim;island;mode="explore";world;exploreYaw;exploreZoom=2;photoZoom=1;focus=4;preset;lighthouse;hooks=new Map;ready=!1;raf=0;width=0;height=0;spotted=new Set;scoring=!1;shutterRunning=!1;thumbnailUrl=null;pointers=new Map;gesture=null;stick=null;get tile(){return this.sim.tile}get heading(){return this.sim.heading}get presetNow(){return this.preset}get yaw(){return this.mode==="photo"?Zn[this.sim.heading]:this.exploreYaw}get zoom(){return this.mode==="photo"?this.photoZoom:this.exploreZoom}hook(e,t){let n=String(t);this.hooks.get(e)!==n&&(this.hooks.set(e,n),this.el.setAttribute(`data-${e}`,n))}creaturesHere(){return this.world.creatures.filter(e=>e.island===this.island.id)}environment(){let{hour:e,minute:t,weather:n,dusk:s}=this.world;return{hour:e,minute:t,weather:n,dusk:s,lighthouse:this.lighthouse,preset:this.preset}}paintAll(){this.hook("state",this.ready?"ready":"loading"),this.hook("step",this.sim.step),this.hook("island",this.island.id),this.paintMovement(),this.hook("mode",this.mode),this.paintCamera(),this.paintWorld(),this.hook("lighthouse",this.lighthouse),this.hook("preset",this.preset),this.hook("camera",""),this.hook("guide","hidden"),this.hook("shutter","idle"),this.hook("host-island",""),this.hook("host-tile","")}paintMovement(){let{tile:e,heading:t,gait:n}=this.sim;this.hook("tile",`${e[0]},${e[1]}`),this.hook("heading",t),this.hook("gait",n)}paintCamera(){this.hook("yaw",this.yaw),this.hook("zoom",this.zoom),this.hook("focus",this.mode==="photo"?this.focus:""),this.updateFrame(),this.deps.overlay.setReadouts(this.photoZoom,this.focus)}paintWorld(){let{world:e}=this;this.hook("tick",e.tick),this.hook("weather",e.weather),this.hook("world-hour",e.hour),this.hook("creatures",this.creaturesHere().map(t=>`${t.id}@${t.x},${t.y},${t.heading}`).join(";")),this.deps.hud.time.textContent=e.time}setHost(e){this.hook("host-island",e?e.island:""),this.hook("host-tile",e?`${e.tile[0]},${e.tile[1]}`:"")}loop=()=>{let e=performance.now();this.ready?this.sim.catchUp(e):(this.ready=!0,this.sim.start(e),this.hook("state","ready")),(this.el.clientWidth!==this.width||this.el.clientHeight!==this.height)&&(this.width=this.el.clientWidth,this.height=this.el.clientHeight,this.scene.resize(this.width,this.height)),this.hook("camera",this.scene.frame(e)),this.raf=requestAnimationFrame(this.loop)};destroy(){cancelAnimationFrame(this.raf),window.removeEventListener("keyup",this.keyup),this.scene.dispose(),this.thumbnailUrl&&URL.revokeObjectURL(this.thumbnailUrl)}stepped(e,t){this.hook("step",e),this.paintMovement(),this.scene.setExplorer(t),this.updateFrame()}setWorld(e){let t=this.world;this.world=e,e.weather!==t.weather&&this.deps.worldStatus.say(e.weather==="rain"?"Rain begins on the islands.":"The rain stops."),e.dusk!==t.dusk&&this.deps.worldStatus.say(e.dusk?"Dusk falls on the islands.":"Dusk is over."),this.paintWorld(),this.scene.setEnvironment(this.environment()),this.scene.setCreatures(this.creaturesHere()),this.updateFrame(),this.nearby()}setLighthouse(e){this.lighthouse=e,this.hook("lighthouse",e),this.scene.setEnvironment(this.environment())}setPreset(e){this.preset=e,this.hook("preset",e),this.scene.setEnvironment(this.environment())}arrive(e,t,n){this.mode==="photo"&&this.leavePhoto(),this.island=e,this.sim.place(e,t,n),this.exploreYaw=Zn[n],this.exploreZoom=2,this.spotted.clear(),this.hook("island",e.id),this.scene.setIsland(e.id),this.scene.setCreatures(this.creaturesHere()),this.scene.setExplorer(this.sim.snapshot()),this.paintMovement(),this.paintWorld(),this.paintCamera(),this.pushView(!0)}nearby(){let[e,t]=this.sim.tile;for(let n of this.creaturesHere())this.spotted.has(n.id)||Math.abs(n.x-e)>op||Math.abs(n.y-t)>op||(this.spotted.add(n.id),this.deps.worldStatus.say(`You spot a ${ta(n.id)?.name}.`))}pushView(e=!1){let t={mode:this.mode,yaw:this.yaw,zoom:this.zoom,focus:this.mode==="photo"?this.focus:0};this.scene.setView(t,{cut:e||Ct()})}changed(){this.paintCamera(),this.pushView()}orbit(e){this.exploreYaw=Th(this.exploreYaw+e*90),this.changed()}stepZoom(e){let t=this.mode==="photo"?wh:Mh,n=t.indexOf(this.zoom),s=t[Math.min(t.length-1,Math.max(0,n+e))];this.mode==="photo"?this.photoZoom=s:this.exploreZoom=s,this.changed()}home(){this.exploreYaw=Zn[this.sim.heading],this.exploreZoom=2,this.changed()}turn(e){this.sim.heading=e,this.hook("heading",e),this.scene.setExplorer(this.sim.snapshot()),this.changed()}turnQuarter(e){let t=ps.indexOf(this.sim.heading);this.turn(ps[(t+e+4)%4])}cycleFocus(){this.focus=Eh[(Eh.indexOf(this.focus)+1)%Eh.length],this.changed()}togglePhoto(){this.mode==="photo"?this.leavePhoto():this.enterPhoto()}enterPhoto(){this.mode!=="photo"&&(this.mode="photo",this.photoZoom=1,this.focus=4,this.sim.frozen=!0,this.sim.cancelPath(),this.hook("mode","photo"),this.deps.hud.camera.setAttribute("aria-pressed","true"),this.deps.hud.photoControls.hidden=!1,this.hook("guide","drawing"),this.deps.overlay.drawGuide(()=>{this.mode==="photo"&&this.hook("guide","drawn")}),this.changed())}leavePhoto(){this.mode!=="explore"&&(this.mode="explore",this.sim.frozen=!1,this.hook("mode","explore"),this.deps.hud.camera.setAttribute("aria-pressed","false"),this.deps.hud.photoControls.hidden=!0,this.hook("guide","hidden"),this.deps.overlay.hideGuide(),this.deps.overlay.frameGuide.clear(),this.changed())}updateFrame(){if(this.mode!=="photo"){this.hook("in-view","");return}let e=np(this.sim.tile,this.sim.heading,this.photoZoom,this.creaturesHere());this.hook("in-view",e.map(s=>s.id).join(","));let t=e[0],n=t?`${ta(t.id)?.name} in frame`:"No creature in frame";this.deps.overlay.frameGuide.latest()!==n&&this.deps.overlay.frameGuide.say(n),this.deps.overlay.setLock(t!==void 0)}async takePhoto(){if(this.mode!=="photo"||this.scoring)return;this.scoring=!0;let e=document.activeElement instanceof HTMLElement?document.activeElement:null,{photoStatus:t,hud:n}=this.deps;t.clear(),t.say("Scoring\u2026"),n.take.setAttribute("aria-busy","true"),!Ct()&&!this.shutterRunning&&(this.shutterRunning=!0,this.hook("shutter","moving"),this.deps.overlay.runShutter(()=>{this.shutterRunning=!1,this.hook("shutter","idle")})),wf("shutter");let[s,r]=this.sim.tile,a={island:this.island.id,tile:[s,r],camera:[s,r],heading:this.sim.heading,zoom:this.photoZoom,focus:this.focus,tick:this.world.tick};try{let o=await this.scene.capture(960).catch(()=>this.scene.capture(960));this.thumbnailUrl&&URL.revokeObjectURL(this.thumbnailUrl),this.thumbnailUrl=URL.createObjectURL(o),this.deps.overlay.showThumbnail(this.thumbnailUrl);let l=new FormData;l.set("image",o,"photo.jpg"),l.set("pose",JSON.stringify(a));let c=await vs("POST","/api/photos",l,{"Shot-Key":crypto.randomUUID()}),{photo:u}=c;t.clear(),t.say(`${u.creature_name}: ${u.score.total} points. Size ${u.score.size}, centring ${u.score.centring}, facing ${u.score.facing}, sharpness ${u.score.sharpness}.`),u.album.page_filled&&t.say(`Album page filled: ${u.creature_name}.`),this.deps.onPhotoKept(u,e)}catch(o){t.clear(),t.say(Pi(o),{error:!0})}finally{this.scoring=!1,n.take.removeAttribute("aria-busy"),this.deps.overlay.hideThumbnail()}}walkTo(e){if(this.mode!=="explore")return;let t=rp(this.island,this.sim.tile,e);t===null?this.deps.worldStatus.say("No path to that spot."):t.length>0&&this.sim.walkPath(t,performance.now())}toggleRun(){this.deps.hud.run.setAttribute("aria-pressed",String(this.sim.toggleRun(performance.now())))}jump(){this.sim.requestJump(performance.now())}bind(){let{el:e,deps:t}=this,{hud:n}=t;e.addEventListener("keydown",s=>this.keydown(s)),window.addEventListener("keyup",this.keyup),e.addEventListener("blur",()=>this.sim.releaseAll(performance.now())),e.addEventListener("contextmenu",s=>{s.preventDefault(),this.enterPhoto()}),e.addEventListener("pointerdown",s=>this.pointerDown(s)),e.addEventListener("pointermove",s=>this.pointerMove(s)),e.addEventListener("pointerup",s=>this.pointerUp(s)),e.addEventListener("pointercancel",s=>this.pointerEnd(s)),n.camera.addEventListener("click",()=>this.togglePhoto()),n.zoomIn.addEventListener("click",()=>this.stepZoom(1)),n.zoomOut.addEventListener("click",()=>this.stepZoom(-1)),n.focus.addEventListener("click",()=>this.cycleFocus()),n.take.addEventListener("click",()=>{this.takePhoto()}),n.run.addEventListener("click",()=>this.toggleRun()),n.jump.addEventListener("click",()=>this.jump()),n.joystick.addEventListener("pointerdown",s=>this.stickDown(s)),n.joystick.addEventListener("pointermove",s=>this.stickMove(s)),n.joystick.addEventListener("pointerup",s=>this.stickEnd(s)),n.joystick.addEventListener("pointercancel",s=>this.stickEnd(s))}keydown(e){if(e.ctrlKey||e.metaKey||e.altKey)return;let t=e.key.length===1?e.key.toLowerCase():e.key==="Shift"?"shift":e.key.toLowerCase(),n=ap[t],s=performance.now(),r=!e.repeat;if(n)e.preventDefault(),this.mode==="photo"?r&&this.turn(n):this.sim.press(`key:${t}`,n,s);else if(t==="shift")this.sim.press("shift",null,s);else if(t==="enter"&&this.mode==="photo")e.preventDefault(),r&&this.takePhoto();else if(t==="escape"&&this.mode==="photo")this.leavePhoto();else if(r)if(t===" "&&this.mode==="explore")e.preventDefault(),this.jump();else if(t==="r"&&this.mode==="explore")this.toggleRun();else if(t==="q"||t==="e"){let a=t==="q"?-1:1;this.mode==="photo"?this.turnQuarter(a):this.orbit(a)}else t==="+"||t==="-"?this.stepZoom(t==="+"?1:-1):t==="home"&&this.mode==="explore"?this.home():t==="f"&&this.mode==="photo"?this.cycleFocus():t==="c"?this.togglePhoto():t==="m"?this.deps.openMap():t==="j"&&this.deps.openAlbum();else return}keyup=e=>{let t=e.key.length===1?e.key.toLowerCase():e.key==="Shift"?"shift":e.key.toLowerCase();ap[t]?this.sim.release(`key:${t}`,performance.now()):t==="shift"&&this.sim.release("shift",performance.now())};pointerDown(e){if(!(e.pointerType==="mouse"&&e.button!==0)){if(this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}),this.pointers.size===1)this.gesture={kind:"one",startX:e.clientX,startY:e.clientY,startYaw:this.exploreYaw,moved:!1};else if(this.pointers.size===2){let[t,n]=[...this.pointers.values()],s=this.mode==="photo"?wh:Mh;this.gesture={kind:"two",startMidX:(t.x+n.x)/2,startDistance:Math.hypot(t.x-n.x,t.y-n.y),startYaw:this.exploreYaw,startZoomIndex:s.indexOf(this.zoom)}}}}pointerMove(e){let t=this.pointers.get(e.pointerId);if(!t||!this.gesture)return;t.x=e.clientX,t.y=e.clientY;let{gesture:n}=this;if(n.kind==="one"){let s=e.clientX-n.startX;Math.hypot(s,e.clientY-n.startY)>=x_&&(n.moved=!0),n.moved&&this.mode==="explore"&&(this.exploreYaw=Th(n.startYaw+lp(s)),this.changed())}else if(this.pointers.size===2){let[s,r]=[...this.pointers.values()];this.mode==="explore"&&(this.exploreYaw=Th(n.startYaw+lp((s.x+r.x)/2-n.startMidX)));let a=this.mode==="photo"?wh:Mh,o=Math.trunc((Math.hypot(s.x-r.x,s.y-r.y)-n.startDistance)/y_),l=a[Math.min(a.length-1,Math.max(0,n.startZoomIndex+o))];this.mode==="photo"?this.photoZoom=l:this.exploreZoom=l,this.changed()}}pointerUp(e){let{gesture:t}=this;if(t?.kind==="one"&&!t.moved&&this.pointers.size===1&&this.mode==="explore"){let n=this.scene.pick(e.clientX,e.clientY);n&&this.walkTo(n)}this.pointerEnd(e)}pointerEnd(e){this.pointers.delete(e.pointerId),this.gesture=null}stickDown(e){this.stick={x:e.clientX,y:e.clientY,id:e.pointerId,heading:null},this.deps.hud.joystick.setPointerCapture(e.pointerId)}stickMove(e){let{stick:t}=this;if(!t||t.id!==e.pointerId)return;let n=e.clientX-t.x,s=e.clientY-t.y,r=Math.hypot(n,s)<v_?null:Math.abs(n)>=Math.abs(s)?n>0?"E":"W":s>0?"S":"N",a=Math.min(34,Math.hypot(n,s)),o=Math.atan2(s,n);if(this.deps.hud.knob.style.transform=`translate(${Math.cos(o)*a}px, ${Math.sin(o)*a}px)`,r===t.heading)return;let l=performance.now();this.sim.release("joystick",l),t.heading=r,r&&(this.mode==="photo"?this.turn(r):this.sim.press("joystick",r,l))}stickEnd(e){!this.stick||this.stick.id!==e.pointerId||(this.sim.release("joystick",performance.now()),this.stick=null,this.deps.hud.knob.style.transform="")}};var __=["full","balanced","light"],b_="That spot doesn't exist. You are at Saltmarsh Harbour, spot 1.",S_="3D is not available here. The text world below has everything.",M_=i=>typeof i=="object"&&i!==null&&"island"in i&&"tile"in i&&"heading"in i;function w_(i,e){if(!i.has("island")&&!i.has("spot"))return{position:e,unknown:!1,deepLink:!1};let t=Number(i.get("island")),n=li.find(s=>s.spot===Number(i.get("spot")));if(!ci(t)||!n){let s=li[0];return{position:{island:1,tile:s.tile,heading:s.heading},unknown:!0,deepLink:!0}}return{position:{island:t,tile:n.tile,heading:n.heading},unknown:!1,deepLink:!0}}function cp(i){let e=[],t=!1;return document.body.classList.add("play-body"),e.push(()=>document.body.classList.remove("play-body")),E_(i,e,()=>t).catch(n=>{if(!t)throw n}),{unmount(){t=!0;for(let n of e.reverse())n()}}}async function E_(i,e,t){let{root:n}=i,[s,r,a,o]=await Promise.all([at("/api/me"),at("/api/world"),at("/api/me/albums"),at("/api/safaris/current")]);if(t())return;let l=w_(i.query,s.position);if(l.unknown&&history.replaceState(null,"","/play?island=1&spot=1"),l.deepLink&&await Fn("/api/me/position",l.position,{"X-Tab-Id":xs}),t())return;let c=i.query.get("gfx"),u=__.find(P=>P===c),{position:d}=l,h=s.settings,m=()=>u??h.graphics;if(fh(h.music,h.effects),!fs()){document.body.classList.remove("play-body"),T_(n,d,e);return}let g={world:xt("World status",5),photo:xt("Photo status",3),safari:xt("Safari status",5),postcard:xt("Postcard status"),settings:xt("Settings status")},S=lr(d.island);e.push(()=>cr(S));let f=Yf(a.film,a.stamps,S);f.messages.append(g.world.el,g.photo.el,g.safari.el,g.postcard.el,g.settings.el);let p=Zf(),_=dn();e.push(()=>_.close());let M={albums:a.albums,stamps:a.stamps,lighthouse:a.lighthouse,safari:o.safari,restarting:!1},w=ci(d.island),C=!1,b=null,x=async P=>{if(b=P,!C){for(C=!0;b;){let q=b;b=null;try{await Fn("/api/me/position",q,{"X-Tab-Id":xs})}catch(K){g.world.say(Pi(K),{error:!0})}}C=!1}},v=$f({onWalk:P=>A.walkTo(P),onSighting:P=>{Fe(P)}}),A=new Ul({island:w,tile:d.tile,heading:d.heading,preset:m(),lighthouse:a.lighthouse,world:r,hud:f,overlay:p,worldStatus:g.world,photoStatus:g.photo,onMoved:(P,q)=>{v.setExplorer(P,q),x({island:A.island.id,tile:P,heading:q})},onPhotoKept:(P,q)=>{f.film.set(P.film),_n.show(P,q),at("/api/me/albums").then(K=>{t()||N(K)})},openMap:()=>Ye(),openAlbum:()=>Dt()});e.push(()=>A.destroy());let R=P=>M.albums.find(q=>q.island===P)?.pages_filled??0,L=(P,q={})=>{let K=ci(P.island);A.arrive(K,P.tile,P.heading),v.setIsland(K),v.setExplorer(P.tile,P.heading),F.select(K.id),F.refreshRefill(),g.world.say(q.message??`You are on ${K.name}. ${R(K.id)} of 4 album pages filled.`),A.nearby(),D(),q.save&&x(P)},N=(P,q={})=>{let K=q.announce??!0;if(P.film!==f.film.value&&f.film.set(P.film),K){for(let ie of P.albums){let oe=M.albums.find(Q=>Q.island===ie.island);ie.stamp&&oe&&!oe.stamp&&g.world.say(`Stamp earned for ${ie.island_name}. You have ${P.stamps} ${P.stamps===1?"stamp":"stamps"}.`)}P.lighthouse==="open"&&M.lighthouse==="closed"&&g.world.say("The lighthouse at Lantern Point is open.")}P.stamps!==f.stamps.value&&f.stamps.set(P.stamps),M.albums=P.albums,M.stamps=P.stamps,M.lighthouse=P.lighthouse,A.setLighthouse(P.lighthouse),F.update(P)},B=Lt.map(P=>y("button",{type:"button",class:"btn",onclick:()=>I(P.id)},`Sail to ${P.name}`)),D=()=>B.forEach((P,q)=>{P.hidden=Lt[q]?.id===A.island.id}),W=y("button",{type:"button",class:"btn"},"Start a shared safari"),V=y("button",{type:"button",class:"btn"},"Join a safari"),Y=y("button",{type:"button",class:"btn"},"Close map"),H=y("section",{class:"map-pane","aria-label":"Map pane"},y("header",{class:"pane-head"},y("h2",null,"Map"),Y),v.el,y("div",{class:"pane-actions"},B,W,V,y("a",{class:"btn",href:"/board"},"Notice board"))),F=Gf({island:()=>A.island.id,film:()=>f.film.value,onClose:()=>tt(),onRefill:()=>{fn()},onPostcard:(P,q,K)=>{yt.prepare(P,q),yt.open(K)}});F.update(a,{instant:!0}),F.select(w.id);let $=y("div",{role:"dialog","aria-label":"Map",class:"sheet map-sheet"}),ee=y("div",{role:"dialog","aria-label":"Album",class:"sheet album-sheet"}),ae={value:50},ge=y("div",{role:"separator","aria-label":"Resize map and album","aria-orientation":"vertical","aria-valuemin":30,"aria-valuemax":70,"aria-valuenow":50,tabindex:0,class:"panel-separator"}),J=y("aside",{role:"complementary","aria-label":"Map and album",class:"sheet panel"});document.getElementById("layers").append($,ee,J),e.push(()=>{$.remove(),ee.remove(),J.remove()});let be=P=>{ae.value=Math.min(70,Math.max(30,P)),ge.setAttribute("aria-valuenow",String(ae.value)),J.style.setProperty("--map-share",`${ae.value}%`),pe()};ge.addEventListener("keydown",P=>{let q=P.key==="ArrowLeft"?ae.value-5:P.key==="ArrowRight"?ae.value+5:P.key==="Home"?30:P.key==="End"?70:null;q!==null&&(P.preventDefault(),be(q))}),ge.addEventListener("pointerdown",P=>{ge.setPointerCapture(P.pointerId);let q=K=>{let ie=J.getBoundingClientRect();be(Math.round((K.clientX-ie.left)/ie.width*20)*5)};ge.addEventListener("pointermove",q),ge.addEventListener("pointerup",()=>ge.removeEventListener("pointermove",q),{once:!0})});let Ae=()=>{Dl()?(J.replaceChildren(H,ge,F.el),J.style.setProperty("--map-share",`${ae.value}%`)):($.replaceChildren(H),ee.replaceChildren(F.el))},pe=()=>{H.clientWidth>0&&v.fit(H.clientWidth-32)},Ue={map:new $i($),album:new $i(ee),panel:new $i(J)},dt={map:{el:$,modal:!0,dismiss:()=>tt(),initial:()=>v.el},album:{el:ee,modal:!0,dismiss:()=>tt(),initial:()=>F.closeButton},panel:{el:J,modal:!1,dismiss:()=>tt()}},Te=null,st=(P,q,K)=>{if(Te&&Te!==P){let ie=Te,oe=dt[ie].opener;Ue[ie].hide(),un(dt[ie]),q=q??oe??null}Te!==P?(Ue[P].show(),dt[P].opener=q??(document.activeElement instanceof HTMLElement?document.activeElement:null),dt[P].initial=K,Nn(dt[P]),Te=P):K()?.focus(),pe(),P!=="album"&&(v.resetCursor(A.tile),v.setExplorer(A.tile,A.heading))};function tt(){if(!Te)return;let P=Te;Te=null,Ue[P].hide(),un(dt[P])}let Ye=P=>{let q=P??(document.activeElement instanceof HTMLElement?document.activeElement:null);st(Dl()?"panel":"map",q,()=>v.el)},Dt=P=>{let q=P??(document.activeElement instanceof HTMLElement?document.activeElement:null);st(Dl()?"panel":"album",q,()=>F.selectedTab())},Mt=matchMedia("(min-width: 1200px)"),qt=()=>{tt(),Ae()};Mt.addEventListener("change",qt),e.push(()=>Mt.removeEventListener("change",qt)),Ae(),Y.addEventListener("click",()=>tt()),f.map.addEventListener("click",()=>Ye(f.map)),f.album.addEventListener("click",()=>Dt(f.album));let mt=()=>{Te&&pe()};window.addEventListener("resize",mt),e.push(()=>window.removeEventListener("resize",mt)),v.setIsland(w),v.setExplorer(d.tile,d.heading),D(),pe();let _n=jf({onPostcard:(P,q,K)=>{yt.prepare(P,q),yt.open(K)}});e.push(()=>_n.destroy());let yt=qf({docked:{status:g.postcard,home:f.messages},send:async(P,q)=>{g.postcard.clear(),g.postcard.say("Posting\u2026");try{return await bt("/api/postcards",P,{"Request-Key":q}),g.postcard.clear(),g.postcard.say("Postcard posted."),!0}catch(K){return g.postcard.clear(),g.postcard.say(Pi(K),{error:!0}),!1}}});e.push(()=>yt.destroy());let fn=async()=>{try{let{film:P}=await bt("/api/me/refill");g.world.say(`Film refilled to ${P} frames.`),f.film.set(P),F.refreshRefill()}catch(P){g.world.say(Pi(P),{error:!0})}},an=(P,q)=>{N(P.progress,{announce:!1}),location.search.includes("island")&&history.replaceState({...P.position},"","/play"),L(P.position,{message:q?"Expedition restarted. You are on Saltmarsh Harbour.":void 0}),F.refreshRefill()},on=Wf({restart:async()=>{M.restarting=!0;try{let P=await bt("/api/me/restart"),q=await at("/api/me/albums");an({position:P.position,progress:q},!0)}catch(P){g.world.say(Pi(P),{error:!0})}finally{M.restarting=!1}}});e.push(()=>on.destroy()),f.restart.addEventListener("click",()=>on.open(f.restart));let z=Vf({current:()=>h,docked:{status:g.settings,home:f.messages},save:async P=>{h=(await Fn("/api/me/settings",P)).settings,fh(h.music,h.effects),A.setPreset(m())}});e.push(()=>z.destroy()),f.settings.addEventListener("click",()=>z.open(f.settings));let Ft=Qf({playerId:s.player.id,onEnd:()=>{Et()},onLeave:()=>{Ie()}});f.safariSlot.append(Ft.el);let nt=P=>{M.safari=P,Ft.set(P),v.setSightings(Ft.sightings),(!P||P.status==="ended"||P.host.id===s.player.id)&&A.setHost(null)};nt(o.safari);let ot=async P=>{try{return await P(),!0}catch(q){return g.safari.say(Pi(q),{error:!0}),!1}};W.addEventListener("click",()=>{ot(async()=>{let{safari:P}=await bt("/api/safaris");nt(P),g.safari.say("Safari started.")})});let de=Xf({docked:{status:g.safari,home:f.messages},join:P=>ot(async()=>{let{safari:q}=await bt(`/api/safaris/${P}/join`);nt(q),g.safari.say(`You joined ${q.host.name}'s safari.`)})});e.push(()=>de.destroy()),V.addEventListener("click",()=>de.open(V));let Et=()=>ot(async()=>{await bt(`/api/safaris/${M.safari?.code}/end`),nt(null),g.safari.say("Safari ended.")}),Ie=()=>ot(async()=>{let P=s.player.name;await bt(`/api/safaris/${M.safari?.code}/leave`),nt(null),A.setHost(null),g.safari.say(`${P} left. The guest seat is free.`)}),Fe=async P=>{let q=M.safari;!q||q.host.id!==s.player.id||q.status==="ended"||await ot(async()=>{await bt(`/api/safaris/${q.code}/sightings`,{island:A.island.id,tile:P})})},I=P=>{history.replaceState({island:A.island.id,tile:A.tile,heading:A.heading},"");let q=li[0],K={island:P,tile:q.tile,heading:q.heading};history.pushState({...K},"",`/play?island=${P}&spot=1`),L(K,{save:!0})};i.onPop(P=>{if(!M_(P)){Jn(location.pathname+location.search,{replace:!0});return}L({island:P.island,tile:P.tile,heading:P.heading},{save:!0})}),history.replaceState({island:d.island,tile:d.tile,heading:d.heading},""),_.on("world",P=>A.setWorld(P)),_.on("progress",P=>N(P)),_.on("restart",P=>{M.restarting||an(P,!0)}),_.on("position",P=>{P.tab!==xs&&P.island!==A.island.id&&L({island:P.island,tile:P.tile,heading:P.heading})}),_.on("host_position",P=>A.setHost(P)),_.on("safari_joined",({guest_name:P,safari:q})=>{nt(q),g.safari.say(`${P} joined your safari.`)}),_.on("safari_left",({guest_name:P,safari:q})=>{nt(q.host.id===s.player.id?q:null),g.safari.say(`${P} left. The guest seat is free.`)}),_.on("safari_ended",()=>{nt(null),g.safari.say("Safari ended.")}),_.on("sighting",({sighting:P})=>{Ft.addSighting(P),v.setSightings(Ft.sightings),g.safari.say(`Sighting at ${P.x}, ${P.y} by ${P.by}`)}),_.on("safari_photo",({host_name:P,photo:q})=>Ft.addFeed(P,q));let E=y("div",{class:"play"},f.skip,A.el,f.bar);n.replaceChildren(E),pe(),l.unknown&&g.world.say(b_),L(d),e.push(()=>n.replaceChildren())}function T_(i,e,t){let n=dn();t.push(()=>n.close());let s=Ll({live:n});t.push(()=>s.unmount());let r=ci(e.island);i.replaceChildren(y("main",{class:"play-still","data-state":"still","data-island":r.id},y("div",{class:"still-frame"},tp(r)),y("p",{class:"still-notice"},S_),s.el)),t.push(()=>i.replaceChildren())}function yn(){return y("header",{class:"topbar site-header"},y("a",{class:"wordmark",href:"/"},"Hushfoot"),y("nav",{class:"topnav","aria-label":"Site"},y("a",{href:"/play"},"Play"),y("a",{href:"/text-world"},"Text world"),fa()))}function hp(i){let e=xt("Gallery status",5),t=y("ul",{role:"list","aria-label":"Hall order",class:"hall-items"}),n=y("ul",{role:"list","aria-label":"Your photos",class:"hall-items"}),s=y("div",{class:"frame-empty"},y("span",{class:"corners"}),y("p",null,"No photos hung yet.")),r=y("a",{href:"/hall"},"Open your hall as a visitor"),a=y("input",{type:"checkbox",role:"switch",id:"hall-public"}),o=y("button",{type:"button",class:"btn btn-primary"},"Save hall"),l=[],c=new Map,u="",d=M=>{if(M instanceof ht||M instanceof Tt)e.say(M.message,{error:!0});else throw M},h=M=>`${M.creature_name} photo`,m=()=>{l.forEach((M,w)=>{M.li.setAttribute("aria-label",`${h(M.photo)}, frame ${w+1}`),M.frameNo.textContent=`Frame ${w+1}`}),s.hidden=l.length>0};function g(M,w,C){let b=l.indexOf(M),x=b+w;x<0||x>=l.length||(l.splice(b,1),l.splice(x,0,M),t.insertBefore(M.li,w<0?t.children[x]??null:t.children[x+1]??null),m(),e.say(`${h(M.photo)} moved to frame ${x+1} of ${l.length}.`),C.focus())}function S(M){c.set(M.id,M);let w=y("button",{type:"button",class:"btn"},`Hang ${h(M)}`),C=y("li",{class:"own-photo","data-photo":M.id},y("img",{src:M.image_url,alt:"",loading:"lazy"}),y("strong",null,`${M.creature_name}, ${M.score.total} points`),w);w.addEventListener("click",()=>{C.remove(),c.delete(M.id),f(M,""),t.lastElementChild?.querySelector("input")?.focus()}),n.appendChild(C)}function f(M,w,C=0){let b=y("input",{type:"text","aria-label":`Caption for ${h(M)}`,value:w}),x=Rt("likes",da,C),v=y("span",{class:"frame-no"}),A=y("button",{type:"button",class:"btn btn-small"},`Move ${h(M)} up`),R=y("button",{type:"button",class:"btn btn-small"},`Move ${h(M)} down`),L=y("button",{type:"button",class:"btn btn-small"},`Take down ${h(M)}`),N=y("li",{class:"hall-item",tabindex:"0",role:"listitem","data-photo":M.id},y("img",{src:M.image_url,alt:"",loading:"lazy"}),y("header",null,y("strong",null,`${M.creature_name}, ${M.score.total} points`),v,x.el),y("label",{class:"field caption-field"},y("span",{class:"field-label"},"Caption"),b),y("div",{class:"tools"},A,R,L)),B={photo:M,li:N,caption:b,frameNo:v,likes:x,up:A,down:R};l.push(B),t.appendChild(N),A.addEventListener("click",()=>g(B,-1,A)),R.addEventListener("click",()=>g(B,1,R)),L.addEventListener("click",()=>{l.splice(l.indexOf(B),1),N.remove(),m(),S(M),n.lastElementChild?.querySelector("button")?.focus()}),N.addEventListener("keydown",D=>{D.altKey&&(D.key==="ArrowUp"||D.key==="ArrowDown")&&(D.preventDefault(),g(B,D.key==="ArrowUp"?-1:1,N))}),m()}function p(M,w){u=M.handle,r.setAttribute("href",`/hall/${u}`),a.checked=M.public;let C=new Set(M.frames.map(b=>b.photo.id));for(let b of M.frames)f(b.photo,b.caption,b.likes);for(let b of w)C.has(b.id)||S(b)}a.addEventListener("change",()=>{let M=a.checked;Fn("/api/me/hall",{public:M}).then(()=>e.say(M?"Hall is now public.":"Hall is now private."),w=>{a.checked=!M,d(w)})}),o.addEventListener("click",()=>{o.getAttribute("aria-busy")!=="true"&&(o.setAttribute("aria-busy","true"),e.say("Saving hall\u2026"),Fn("/api/me/hall",{public:a.checked,frames:l.map(M=>({photo:M.photo.id,caption:M.caption.value}))}).then(({hall:M})=>{for(let w of M.frames)l.find(C=>C.photo.id===w.photo.id)?.likes.set(w.likes);e.say("Hall saved.")},d).finally(()=>o.removeAttribute("aria-busy")))});let _=dn();return _.on("like",M=>{let w=l.find(C=>C.photo.id===M.photo);w&&(w.likes.set(M.likes),M.liked&&e.say(`${M.visitor_name} liked your ${M.creature_name} photo.`))}),i.root.append(yn(),y("main",{class:"page"},y("h1",null,"Your hall"),y("div",{class:"hall-bar"},y("label",{class:"switch",for:"hall-public"},a,"Public hall"),o,r),e.el,y("div",{class:"hall-grid"},y("section",null,y("h2",null,"Hall order"),t,s),y("section",null,y("h2",null,"Your photos"),n)))),Promise.all([at("/api/me/hall"),at("/api/me/photos")]).then(([M,w])=>p(M.hall,w.photos),d),{unmount:()=>_.close()}}var A_=100,C_=4,R_=2,up={w:"N",arrowup:"N",a:"W",arrowleft:"W",s:"S",arrowdown:"S",d:"E",arrowright:"E"};function dp(i){let e={tile:i.start,heading:i.heading,gait:"idle",step:0},t=[],n=!1,s=!1,r=!1,a=0,o=null,l=0,c=(h,m,g)=>[h[0]+oi[m][0]*g,h[1]+oi[m][1]*g];function u(){if(e.step+=1,a>0||r){if(r=!1,a+=1,e.gait="jump",a===C_){let h=c(e.tile,e.heading,R_);i.isLand(h[0],h[1])&&(e.tile=h),a=0}}else{let h=t[t.length-1];if(h===void 0)o=null,l=0,e.gait="idle";else{h!==o&&(o=h,l=0),l+=1,e.heading=h;let m=s||n;if(e.gait=m?"run":"walk",m||l%2===1){let g=c(e.tile,h,1);i.isLand(g[0],g[1])&&(e.tile=g)}}}i.onStep(e)}let d={walk:e,catchUp(h){for(;i.readyAt+(e.step+1)*A_<=h;)u()},keyDown(h,m){let g=h.toLowerCase(),S=up[g];if(S===void 0&&g!=="shift"&&g!=="r"&&g!==" ")return!1;if(d.catchUp(m),S!==void 0){let f=t.indexOf(S);f>=0&&t.splice(f,1),t.push(S)}else g==="shift"?n=!0:g==="r"?s=!s:r=!0;return!0},keyUp(h,m){let g=h.toLowerCase(),S=up[g];if(S===void 0&&g!=="shift")return!1;if(d.catchUp(m),S!==void 0){let f=t.indexOf(S);f>=0&&t.splice(f,1)}else n=!1;return!0},release(h){d.catchUp(h),t.length=0,n=!1}};return d}var P_=6,I_=14,L_=4,D_=["full","balanced","light"],N_=(i,e)=>i>=0&&e>=0&&i<P_&&e<I_;function U_(i,e){let t=1,n=y("img",{src:i.photo.image_url,alt:`${i.photo.creature_name} photo`}),s=y("div",{class:"stage"},n),r=h=>{t=Math.min(L_,Math.max(1,h)),o.dataset.zoom=String(t),n.style.width=`${t*100}%`},a=y("button",{type:"button",class:"btn"},"Close"),o=y("div",{class:"viewer",role:"dialog","aria-label":"Photo viewer","data-zoom":"1",tabindex:"-1"},y("div",{class:"bar"},y("strong",null,`${i.photo.creature_name}, ${i.photo.score.total} points`),a),s,y("div",{class:"bar"},y("span",null,i.caption),y("span",{class:"row"},y("button",{type:"button",class:"btn",onclick:()=>r(t-1)},"Zoom out"),y("button",{type:"button",class:"btn",onclick:()=>r(t+1)},"Zoom in")))),l=y("div",{class:"viewer-backdrop"}),c={el:o,modal:!0,opener:e,dismiss:()=>u(),initial:()=>a},u=()=>{o.remove(),l.remove(),un(c)};a.addEventListener("click",u),l.addEventListener("click",u),o.addEventListener("keydown",h=>{h.key==="+"||h.key==="="?r(t+1):h.key==="-"&&r(t-1)}),document.getElementById("layers").append(l,o),Nn(c)}function fp(i){let e=decodeURIComponent(i.params[0]??""),t=xt("Gallery status",5),n=y("main",{class:"page"});i.root.append(yn(),n);let s=()=>{},r=!1,a=o=>{let l=At.me,c=l?.player.handle===o.handle,u=i.query.get("gfx"),d=u&&D_.includes(u)?u:l?.settings.graphics??"full",h=y("div",{class:"gallery-hall",role:"application","aria-label":"Gallery hall",tabindex:"0","data-step":"0","data-tile":"2,13","data-heading":"N","data-gait":"idle","data-preset":d,"data-state":"loading"}),m=new Map,g=new Map,S=o.frames.map(v=>{let A=Rt("likes",da,v.likes);m.set(v.photo.id,A);let R=`${v.photo.creature_name} photo`,L=y("button",{type:"button",class:"btn","aria-label":`View ${R}`},"View");L.addEventListener("click",()=>U_(v,L));let N=y("div",{class:"tools"},L);if(!c){let B=y("button",{type:"button",class:"btn","aria-label":`Like ${R}`,"aria-pressed":String(v.liked_by_me===!0)},"Like");B.addEventListener("click",()=>{if(!l){Jn(`/signin?next=${encodeURIComponent(location.pathname+location.search)}`);return}(B.getAttribute("aria-pressed")==="true"?ys(`/api/photos/${v.photo.id}/like`):Fn(`/api/photos/${v.photo.id}/like`)).then(V=>{B.setAttribute("aria-pressed",String(V.liked)),A.set(V.likes),t.say(V.liked?`Liked ${R}.`:`Like removed from ${R}.`)},V=>{if(V instanceof ht||V instanceof Tt)t.say(V.message,{error:!0});else throw V})}),g.set(v.photo.id,B),N.appendChild(B)}return y("li",{class:"hung-item","data-photo":v.photo.id},y("img",{src:v.photo.image_url,alt:"",loading:"lazy"}),y("h3",null,v.photo.creature_name),v.caption?y("p",{class:"caption"},v.caption):null,y("p",{class:"meta"},y("span",null,`Score ${v.photo.score.total} / 100`),A.el),N)}),f=y("ul",{role:"list","aria-label":"Hung photos",class:"hung"},...S),p=y("div",{class:"frame-empty"},y("span",{class:"corners"}),y("p",null,"No photos hung yet."));p.hidden=o.frames.length>0;let _=lr();n.append(y("h1",null,`${o.owner_name}'s hall`),y("div",{class:"hall-bar"},_,c?y("a",{href:"/hall"},"Edit your hall"):null),t.el,y("div",{class:"visit"},h,y("section",null,f,p)));let M=null,w=0;if(fs()){let v=y("canvas",{"aria-hidden":"true"});h.prepend(v);let A=Mf(v);M=A;let R=()=>{let L=h.getBoundingClientRect();L.width>0&&A.resize(Math.round(L.width),Math.round(L.height))};R(),new ResizeObserver(R).observe(h),A.setPreset(d),A.setFrames(o.frames.map(L=>({url:L.photo.image_url,caption:L.caption,creatureName:L.photo.creature_name}))),h.dataset.state="ready"}else h.append(y("p",{class:"notice"},"3D is not available here. The hung photos below are the hall.")),h.dataset.state="still";let C=dp({start:[2,13],heading:"N",readyAt:performance.now(),isLand:N_,onStep:v=>{h.dataset.step=String(v.step),h.dataset.tile=`${v.tile[0]},${v.tile[1]}`,h.dataset.heading=v.heading,h.dataset.gait=v.gait,M?.setVisitor({tile:v.tile,heading:v.heading,gait:v.gait})}});M?.setVisitor({tile:[2,13],heading:"N",gait:"idle"}),h.addEventListener("keydown",v=>{if(v.repeat){C.keyDown(v.key,performance.now())&&v.preventDefault();return}!v.altKey&&!v.ctrlKey&&!v.metaKey&&C.keyDown(v.key,performance.now())&&v.preventDefault()}),h.addEventListener("keyup",v=>{C.keyUp(v.key,performance.now())&&v.preventDefault()}),h.addEventListener("blur",()=>C.release(performance.now()));let b=v=>{C.catchUp(performance.now()),M?.frame(v),w=requestAnimationFrame(b)};w=requestAnimationFrame(b);let x=l?dn({hall:o.handle}):null;x?.on("like",v=>{m.get(v.photo)?.set(v.likes),v.visitor===l?.player.id&&g.get(v.photo)?.setAttribute("aria-pressed",String(v.liked))}),s=()=>{cancelAnimationFrame(w),x?.close(),M?.dispose(),cr(_)},r&&s()};return at(`/api/halls/${encodeURIComponent(e)}`).then(({hall:o})=>{r||a(o)},o=>{if(!(o instanceof ht)||o.status!==404)throw o;r||n.replaceChildren(y("h1",null,"No gallery here"),y("p",null,"This hall is not open to visitors."),y("a",{class:"btn",href:"/"},"Back to the title screen"))}),{unmount:()=>{r=!0,s()}}}function pp(i){let e=At.me,t=xt("Notes status",5),n=y("ul",{role:"list","aria-label":"Notice board",class:"notes"}),s=y("div",{class:"frame-empty"},y("span",{class:"corners"}),y("p",null,"No notes yet.")),r=y("textarea",{id:"note-text",rows:"3",placeholder:"Tide tables, sightings, news from the dock"}),a=y("button",{type:"button",class:"btn btn-primary"},"Pin note"),o=new Map,l=new Set,c=null,u=f=>{if(f instanceof ht||f instanceof Tt)t.say(f.message,{error:!0});else throw f};function d(f){return!l.has(f.id)||f.status==="approved"?"":f.status==="pending"?"Waiting for a ranger":`Declined: ${f.reason??""}`}function h(f){let p=d(f),_=y("div",{class:"tools"});if(e?.player.ranger&&f.status==="approved"){let M=y("button",{type:"button",class:"btn btn-small"},"Remove note");M.addEventListener("click",()=>{ys(`/api/notes/${f.id}`).then(()=>{},u)}),_.appendChild(M)}return y("li",{class:"note","data-note":f.id},y("p",{class:"text"},f.text),y("p",{class:"by"},`Pinned by ${f.author_name}`),p?y("p",{class:"state"},p):null,_)}function m(f,p){let _=h(f),M=o.get(f.id);M?M.replaceWith(_):p?n.prepend(_):n.appendChild(_),o.set(f.id,_),s.hidden=o.size>0}function g(f){o.get(f)?.remove(),o.delete(f),s.hidden=o.size>0}a.addEventListener("click",()=>{if(a.getAttribute("aria-busy")==="true")return;let f=r.value;c?.text!==f&&(c={key:crypto.randomUUID(),text:f}),a.setAttribute("aria-busy","true"),t.say("Pinning\u2026"),bt("/api/notes",{text:f},{"Request-Key":c.key}).then(({note:p})=>{l.add(p.id),m({...p,author_name:e?.player.name??"",reason:null},!0),r.value="",c=null,t.say("Note pinned.")},u).finally(()=>{a.removeAttribute("aria-busy"),r.focus()})});let S=dn();return S.on("note",({kind:f,note:p})=>{if(f==="approved"){let _=l.has(p.id);m(p,!0),t.say(_?"Your note is on the board.":"New note on the board.")}else if(f==="declined"){if(!l.has(p.id))return;m(p,!1),t.say(`Your note was declined: ${p.reason??""}.`)}else f==="removed"&&(g(p.id),t.say("Note removed."))}),i.root.append(yn(),y("main",{class:"page"},y("h1",null,"Notice board"),y("div",{class:"note-form"},y("div",{class:"field"},y("label",{for:"note-text"},"Your note"),r,y("p",{class:"hint"},"Up to 140 characters. A ranger reads every note before anyone else sees it.")),y("div",null,a)),t.el,y("section",null,y("h2",null,"On the board"),n,s))),at("/api/notes").then(({notes:f})=>{for(let p of f)p.status!=="approved"&&l.add(p.id);for(let p of f)m(p,!1)},u),{unmount:()=>S.close()}}var F_=["Not about the islands","Unkind","Shares personal details"];function mp(i){let e=xt("Notes status",5);e.el.classList.add("sticky-status");let t=y("ul",{role:"list","aria-label":"Waiting notes",class:"notes"}),n=y("div",{class:"frame-empty"},y("span",{class:"corners"}),y("p",null,"No notes waiting.")),s=new Map,r=y("section",null,y("h2",null,"Waiting notes"),t,n);r.hidden=!0;let a=null,o=h=>{if(h instanceof ht||h instanceof Tt)e.say(h.message,{error:!0});else throw h},l=()=>{n.hidden=s.size>0};function c(h){s.get(h)?.remove(),s.delete(h),l()}function u(h,m){let g=F_.map(b=>{let x=y("input",{type:"radio",name:"reason",value:b});return{reason:b,input:x,label:y("label",{class:"choice"},x,b)}}),S=y("button",{type:"button",class:"btn btn-primary"},"Decline note"),f=y("button",{type:"button",class:"btn"},"Keep waiting"),p=y("fieldset",{class:"choices",role:"radiogroup","aria-label":"Reason"},...g.map(b=>b.label)),_=y("div",{class:"dialog",role:"dialog","aria-label":"Decline note"},y("h2",null,"Decline this note?"),y("p",null,h.text),p,y("div",{class:"actions"},f,S)),M=y("div",{class:"dialog-backdrop"}),w={el:_,modal:!0,opener:m,dismiss:()=>C(),initial:()=>g[0]?.input??null},C=()=>{_.remove(),M.remove(),un(w)};f.addEventListener("click",C),M.addEventListener("click",C),S.addEventListener("click",()=>{if(S.getAttribute("aria-busy")==="true")return;let b=g.find(x=>x.input.checked);S.setAttribute("aria-busy","true"),bt(`/api/notes/${h.id}/decline`,{reason:b?.reason}).then(()=>{c(h.id),e.say("Note declined."),C(),t.querySelector("button")?.focus()},x=>{x instanceof ht&&x.code==="note_decided"&&c(h.id),o(x)}).finally(()=>S.removeAttribute("aria-busy"))}),document.getElementById("layers").append(M,_),Nn(w)}function d(h){if(s.has(h.id))return;let m=y("button",{type:"button",class:"btn"},"Approve"),g=y("button",{type:"button",class:"btn"},"Decline");m.addEventListener("click",()=>{m.getAttribute("aria-busy")!=="true"&&(m.setAttribute("aria-busy","true"),bt(`/api/notes/${h.id}/approve`).then(()=>{c(h.id),e.say("Note approved.")},o).finally(()=>m.removeAttribute("aria-busy")))}),g.addEventListener("click",()=>u(h,g));let S=y("li",{class:"note","data-note":h.id},y("p",{class:"text"},h.text),y("p",{class:"by"},`From ${h.author_name}`),y("div",{class:"tools"},m,g));s.set(h.id,S),t.appendChild(S),l()}return i.root.append(yn(),y("main",{class:"page"},y("h1",null,"Ranger queue"),e.el,r)),at("/api/ranger/notes").then(({notes:h})=>{r.hidden=!1;for(let m of h)d(m);l(),a=dn(),a.on("note",({kind:m,note:g})=>{m==="pending"?d(g):(m==="approved"||m==="declined")&&c(g.id)})},o),{unmount:()=>a?.close()}}var O_=250,k_="Couldn't load the board. Try again.",B_=i=>i===1?"1 entry":`${i} entries`;function gp(i){let e=Number(i.params[0]),t=ci(e),n=At.me,s=xt("Board status");s.el.classList.add("sticky-status");let r=y("tbody"),a=y("table",{"aria-label":"Challenge board"},y("thead",null,y("tr",null,...["Rank","Player","Creature","Score"].map(R=>y("th",{scope:"col"},R)))),r),o=y("div",{class:"board-table"},a),l=y("div",{class:"frame-empty"},y("span",{class:"corners"}),y("p",null,"No entries yet.")),c=y("input",{type:"search",id:"filter-players","aria-label":"Filter players",autocomplete:"off",spellcheck:"false"}),u=y("button",{type:"button",class:"btn btn-primary"},"Enter a photo"),d=new Map,h=R=>{if(R instanceof ht||R instanceof Tt)s.say(R.message,{error:!0});else throw R},m=[],g=!1,S=0,f=!1;function p(){let R=y("td"),L=y("td"),N=y("td"),B=y("td");return{tr:y("tr",null,R,L,N,B),rank:R,player:L,creature:N,score:B}}function _(R){let L=new Set(R.map(N=>N.handle));for(let[N,B]of d)L.has(N)||(B.tr.remove(),d.delete(N));R.forEach((N,B)=>{let D=d.get(N.handle);D||(D=p(),d.set(N.handle,D)),jt(D.rank,String(N.rank)),D.player.textContent=N.player,D.creature.textContent=N.creature_name,jt(D.score,String(N.total)),D.tr.dataset.me=String(N.handle===n?.player.handle),r.children[B]!==D.tr&&r.insertBefore(D.tr,r.children[B]??null)}),o.hidden=R.length===0,l.hidden=R.length>0}let M=R=>m.filter(L=>L.player.toLowerCase().includes(R.toLowerCase()));function w(R,L){L===""&&(m=R.entries),_(R.entries),g=!1,s.say(L===""?B_(R.total):`Showing ${R.shown} of ${R.total} entries for \u201C${L}\u201D.`)}function C(){let R=c.value,L=++S,N=R===""?`/api/boards/${e}`:`/api/boards/${e}?player=${encodeURIComponent(R)}`;at(N).then(B=>{L===S&&w(B,R)},()=>{L===S&&(g=!0,s.say(k_,{error:!0}))})}let b=Vh(O_,C);c.addEventListener("input",()=>b.call());async function x(R){let L=await at(`/api/boards/${e}`);m=L.entries,_(c.value===""?L.entries:M(c.value)),!g&&(f&&R.player_name===n?.player.name?f=!1:s.say(`Board updated. ${R.player_name} is now number ${R.rank}.`))}let v=dn();v.on("board",R=>{R.island===e&&x(R).catch(()=>{})});function A(R){let L=y("form",{novalidate:!0}),N=y("fieldset",{class:"choices",role:"radiogroup","aria-label":"Your photos"}),B=y("button",{type:"submit",class:"btn btn-primary",disabled:!0},"Enter photo"),D=y("button",{type:"button",class:"btn"},"Cancel"),W=y("div",{class:"dialog",role:"dialog","aria-label":"Enter a photo"},y("h2",null,"Enter a photo"),L);L.append(N,y("div",{class:"actions"},D,B));let V=y("div",{class:"dialog-backdrop"}),Y={el:W,modal:!0,opener:u,dismiss:()=>H(),initial:()=>N.querySelector("input")??D},H=()=>{W.remove(),V.remove(),un(Y)};R.length===0&&N.append(y("p",null,"No photos taken on this island yet."));for(let F of R)N.append(y("label",{class:"choice"},y("input",{type:"radio",name:"photo",value:F.id}),`${F.creature_name} photo, ${F.score.total}`));D.addEventListener("click",H),V.addEventListener("click",H),N.addEventListener("change",()=>{B.disabled=!1}),L.addEventListener("submit",F=>{F.preventDefault();let $=N.querySelector("input:checked"),ee=R.find(ae=>ae.id===$?.value);!ee||B.getAttribute("aria-busy")==="true"||(B.setAttribute("aria-busy","true"),bt(`/api/boards/${e}/entries`,{photo:ee.id}).then(()=>{f=!0,H(),s.say(`Your ${ee.creature_name} photo is entered.`),C()},ae=>{H(),h(ae)}).finally(()=>B.removeAttribute("aria-busy")))}),document.getElementById("layers").append(V,W),Nn(Y)}return u.addEventListener("click",()=>{at("/api/me/photos").then(R=>{A(R.photos.filter(L=>L.island===e).sort((L,N)=>N.score.total-L.score.total||L.tick-N.tick))},h)}),i.root.append(yn(),y("main",{class:"page"},y("h1",null,t?`Challenge board: ${t.name}`:"Challenge board"),s.el,y("div",{class:"board-bar"},y("div",{class:"field"},y("label",{for:"filter-players"},"Filter players"),c),u),o,l)),o.hidden=!0,l.hidden=!0,C(),{unmount:()=>{b.cancel(),v.close()}}}function xp(i){let e=y("main",{class:"postcard-page"});i.root.append(y("header",{class:"topbar"},y("a",{class:"wordmark",href:"/"},"Hushfoot")),e);let t=!1;return at(`/api/postcards/${encodeURIComponent(i.params[0]??"")}`).then(({postcard:n})=>{if(t)return;let s=y("dd");jt(s,`${n.total} points`),e.append(y("h1",{class:"visually-hidden"},`A postcard from ${n.sender_name}`),y("article",{class:"postcard"},y("img",{src:n.image_url,alt:`${n.creature_name} photo`}),y("div",{class:"postcard-text"},y("h2",null,n.creature_name),y("p",{class:"line"},n.line),y("dl",null,y("dt",null,"Score"),s,y("dt",null,"Island"),y("dd",null,n.island_name)),y("p",{class:"sender"},`Sent by ${n.sender_name}`))))},n=>{if(!(n instanceof ht)||n.status!==404)throw n;t||e.append(y("h1",null,"No postcard here"),y("p",null,"This postcard link does not match any postcard."),y("a",{class:"btn",href:"/"},"Back to the title screen"))}),{unmount:()=>{t=!0}}}function vp(i){let e=Ll();return i.root.append(yn(),y("main",{class:"page"},y("h1",null,"Text world"),y("p",null,"Every island, every creature and your own progress, as plain text. Nothing here needs the 3D scene."),e.el)),{unmount:e.unmount}}function yp(i){return i.root.append(yn(),y("main",{class:"page"},y("h1",null,"Nothing here."),y("p",null,"That page is not on any of the five islands."),y("a",{class:"btn",href:"/"},"Back to the title screen"))),{unmount:()=>{}}}function _p(){pn(/^\/$/,!1,Lf),pn(/^\/signup$/,!1,Df),pn(/^\/signin$/,!1,Nf),pn(/^\/confirm$/,!0,Uf),pn(/^\/play$/,!0,cp),pn(/^\/hall$/,!0,hp),pn(/^\/hall\/([^/]+)$/,!1,fp),pn(/^\/board$/,!0,pp),pn(/^\/ranger$/,!0,mp),pn(/^\/boards\/(\d+)$/,!0,gp),pn(/^\/postcards\/([^/]+)$/,!1,xp),pn(/^\/text-world$/,!1,vp),pn(/^/,!1,yp)}var bp=matchMedia("(pointer: coarse)"),Sp=()=>{document.documentElement.classList.toggle("touch-device",bp.matches&&navigator.maxTouchPoints>=2)};Sp();bp.addEventListener("change",Sp);async function z_(){let i=document.fonts.load('400 1em "Albert Sans"').then(()=>{},()=>{});await Promise.race([i,new Promise(e=>setTimeout(e,1500))])}_p();z_().then(()=>Hh(document.getElementById("app")));
/*! Bundled license information:

three/build/three.core.js:
three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2026 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
