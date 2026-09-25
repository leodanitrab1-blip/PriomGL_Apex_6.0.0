/**
 * PriomGL Entity Forge — procedural high-detail entity construction.
 * Builds anatomical primitives with deterministic proportions, gait phase and
 * secondary motion parameters. Rendering remains engine-native.
 */
(function(global){
'use strict';
const P=global.PriomGL||{};
class EntityBlueprint{
  constructor(spec={}){this.spec={species:'deer',detail:4,fur:.8,mass:1,gait:'quadruped',...spec};this.parts=[];this.morphTargets=[];this._build();}
  part(name,shape,scale,offset){this.parts.push({name,shape,scale,offset});return this;}
  _build(){
    const s=this.spec, d=s.detail;
    const leg=[[-.62,.0,-.72],[.62,.0,-.72],[-.62,.0,.72],[.62,.0,.72]];
    this.part('torso','ellipsoid',[1.0,.62,1.65],[0,1.55,0]);
    this.part('chest','ellipsoid',[.88,.7,.92],[0,1.72,-.72]);
    this.part('neck','ellipsoid',[.46,.75,.52],[0,2.18,-1.25]);
    this.part('head','ellipsoid',[.48,.42,.72],[0,2.48,-1.72]);
    for(let i=0;i<4;i++){this.part('leg'+i,'limb',[.20,.85,.20],[leg[i][0],.72,leg[i][2]]);this.part('hoof'+i,'ellipsoid',[.22,.12,.32],[leg[i][0],.05,leg[i][2]-.08]);}
    this.part('tail','limb',[.18,.42,.18],[0,1.75,1.58]);
    if(s.species==='wolf'||s.species==='fox') this.part('muzzle','ellipsoid',[.28,.25,.42],[0,2.39,-2.28]);
    if(s.species==='bear') this.part('shoulder','ellipsoid',[1.08,.82,.9],[0,1.75,-.62]);
    this.morphTargets.push({name:'breath',amplitude:.018+Math.min(.06,d*.012),frequency:.32});
    this.morphTargets.push({name:'earAlert',amplitude:.12,frequency:.7});
    this.morphTargets.push({name:'gait',amplitude:.2,frequency:1.4});
  }
  pose(time,activity=1){
    const gait=Math.sin(time*1.4)*activity, breath=Math.sin(time*.32)*.03;
    return this.parts.map(p=>({name:p.name,position:[p.offset[0],p.offset[1]+(p.name==='torso'?breath:0),p.offset[2]],rotation:[p.name.startsWith('leg')?gait*(p.name.endsWith('0')||p.name.endsWith('3')?1:-1):0,0,0],scale:p.scale}));
  }
}
const EntityForge={
  deer:(detail=4)=>new EntityBlueprint({species:'deer',detail}),
  wolf:(detail=4)=>new EntityBlueprint({species:'wolf',detail}),
  bear:(detail=4)=>new EntityBlueprint({species:'bear',detail}),
  fox:(detail=4)=>new EntityBlueprint({species:'fox',detail}),
  bird:(detail=4)=>new EntityBlueprint({species:'bird',detail,gait:'avian'})
};
P.EntityForge=EntityForge;P.EntityBlueprint=EntityBlueprint;global.PriomGL=P;
})(typeof window!=='undefined'?window:globalThis);
