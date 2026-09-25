/**
 * PriomGL Advanced Materials — physically inspired material parameter families.
 * These are data-driven descriptors consumed by native PriomGL renderers.
 */
(function(global){
'use strict';
const P=global.PriomGL||{};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
class AdvancedMaterial{
 constructor(name,params={}){this.name=name;Object.assign(this,{albedo:[.7,.7,.7],metallic:0,roughness:.5,ao:1,subsurface:0,clearcoat:0,sheen:0,transmission:0,ior:1.5,normalStrength:1,detailScale:32,wetnessResponse:.7,...params});}
 wet(amount){const w=clamp(amount);this.roughness=Math.max(.035,this.roughness*(1-w*.72));this.ao=clamp(this.ao*(1+w*.08));return this;}
}
const AdvancedMaterials={
  skin:(c=[.48,.25,.18])=>new AdvancedMaterial('skin',{albedo:c,roughness:.48,subsurface:.28,ior:1.4}),
  fur:(c=[.35,.22,.12])=>new AdvancedMaterial('fur',{albedo:c,roughness:.88,sheen:.35,detailScale:75}),
  wetStone:()=>new AdvancedMaterial('wetStone',{albedo:[.35,.34,.32],roughness:.72,wetnessResponse:.95}),
  soil:()=>new AdvancedMaterial('soil',{albedo:[.24,.16,.09],roughness:.97,detailScale:48}),
  leaf:()=>new AdvancedMaterial('leaf',{albedo:[.08,.27,.06],roughness:.78,subsurface:.12,sheen:.18}),
  snow:()=>new AdvancedMaterial('snow',{albedo:[.9,.93,.98],roughness:.38,subsurface:.06}),
  glass:()=>new AdvancedMaterial('glass',{albedo:[.96,.98,1],roughness:.04,transmission:.92,ior:1.5}),
  brushedMetal:()=>new AdvancedMaterial('brushedMetal',{albedo:[.55,.58,.62],metallic:.94,roughness:.28}),
  water:()=>new AdvancedMaterial('water',{albedo:[.02,.12,.16],roughness:.035,transmission:.94,ior:1.333,detailScale:6})
};
P.AdvancedMaterial=AdvancedMaterial;P.AdvancedMaterials=AdvancedMaterials;global.PriomGL=P;
})(typeof window!=='undefined'?window:globalThis);
