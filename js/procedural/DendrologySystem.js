/** PriomGL Apex 4.0 — Dendrology: recursive growth + crown architecture. */
(function(global){'use strict';const P=global.PriomGL;if(!P||!P.Sculpting)return;const {Primitives,GeometryMerger}=P,S=P.Sculpting;
function rng(seed){let s=(seed|0)||1;return()=>{s=(Math.imul(1664525,s)+1013904223)|0;return(s>>>0)/4294967296}}
function seg(parts,a,b,r0,r1,color,radial=9){parts.push({geometry:S.capsule(a,b,r0,r1,radial,4),color})}
function buildTree(variant=0,seed=1){const R=rng(seed+variant*7919),parts=[],bark=[.20,.105,.045],leaf=variant%3===0?[.045,.22,.035]:variant%3===1?[.075,.26,.05]:[.035,.19,.075],h=variant===2?7.8:6.4+R()*2.2,root=[0,0,0];
  // trunk rings with lean, flare and real taper
  let spine=[];for(let i=0;i<=10;i++){const t=i/10,ang=R()*6.28+t*3.7,lean=t*t;spine.push([(Math.sin(ang)*.18+lean*.35),h*t,(Math.cos(ang)*.14+lean*.22)])}
  for(let i=0;i<10;i++){const t=i/10,r=.30*(1-t)+.045*t;seg(parts,spine[i],spine[i+1],r,r*.91,bark,11)}
  // roots / buttresses
  for(let i=0;i<8;i++){const a=i*Math.PI*2/8+R()*.25,len=.75+R()*.55;seg(parts,[0,.05,0],[Math.cos(a)*len,.12,Math.sin(a)*len],.22,.018,bark,8)}
  // recursive branch levels. Branches get their own sub-branches and crown clusters.
  const branch=(a,dir,len,r,depth)=>{const n=[a[0]+dir[0]*len,a[1]+dir[1]*len,a[2]+dir[2]*len];seg(parts,a,n,r,r*.52,bark,depth>1?8:9);if(depth<=0)return n;for(let j=0;j<3;j++){const az=Math.atan2(dir[2],dir[0])+(-1+j)*(.75+R()*.28),up=.25+R()*.42;const d=[Math.cos(az)*Math.cos(up),Math.sin(up),Math.sin(az)*Math.cos(up)];branch(n,d,len*(.48+R()*.12),r*.50,depth-1)}return n};
  for(let level=0;level<5;level++){const t=.42+level*.105,base=spine[Math.floor(t*10)],count=6+(level%2)*2;for(let j=0;j<count;j++){const a=j*Math.PI*2/count+R()*.3,up=.25+R()*.38,d=[Math.cos(a)*Math.cos(up),Math.sin(up),Math.sin(a)*Math.cos(up)];const tip=branch(base,d,(1.0-level*.11)+R()*.55,.075-level*.009,2);for(let k=0;k<4;k++){const q=(k+1)/7,center=[base[0]+(tip[0]-base[0])*q,base[1]+(tip[1]-base[1])*q+.08+R()*.18,base[2]+(tip[2]-base[2])*q];const rx=.32*(1-q*.45)*(1+R()*.25),rz=rx*(.7+R()*.55);parts.push({geometry:S.organicSphere(.22,[rx/.22,.55,rz/.22],14,9,14,9,seed+level*71+j*13+k,.09),position:center,color:[leaf[0]*(.82+R()*.35),leaf[1]*(.84+R()*.28),leaf[2]*(.82+R()*.4)]})}}}
  const g=GeometryMerger.mergeRigid(parts);g.__boundsRadius=Math.max(2.8,h*.38);g.__boundsHeight=h+.4;g.__apexNature='tree';g.__triangles=g.indices.length/3;return g}
function buildBush(seed=1){const R=rng(seed),parts=[];for(let i=0;i<20;i++){const a=i*Math.PI*2/20+R()*.4,r=.25+R()*.65;parts.push({geometry:S.organicSphere(.24,[1.5+R(),.9+.4*R(),1.2+R()],16,10,16,10,seed+i,.08),position:[Math.cos(a)*r,.25+R()*.35,Math.sin(a)*r],color:[.035+.04*R(),.16+.13*R(),.025+.035*R()]})}const g=GeometryMerger.mergeRigid(parts);g.__boundsRadius=1.3;g.__boundsHeight=1.4;return g}
P.Dendrology={buildTree,buildBush};})(typeof window!=='undefined'?window:globalThis);
