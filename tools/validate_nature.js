/* Headless structural validation for Apex Nature Studio. */
const fs=require('fs'),vm=require('vm');
global.window=global;global.navigator={};
const root=__dirname.replace(/\/tools$/,'');
for(const f of ['js/core/math.js','js/core/webgl.js','js/renderer/shaders.js','js/renderer/PriomRenderer.js','js/renderer/materials/MaterialLibrary.js','js/utils/Wildlife.js','js/game/Terrain.js','js/procedural/SculptingSystem.js','js/procedural/AnatomySystem.js','js/procedural/DendrologySystem.js','js/nature/ProceduralNatureStudio.js']){
  vm.runInThisContext(fs.readFileSync(root+'/'+f,'utf8'),{filename:f});
}
const out=[];
for(let v=0;v<4;v++){const g=PriomGL.NatureStudio.buildTree(v);out.push({asset:'tree'+v,triangles:g.indexCount/3});}
for(const a of ['ciervo','lobo','oso']){const wr=new PriomGL.WildlifeRenderer({add(){},remove(){}});const r=wr._buildQuadruped({id:7,type:a,radius:.45});let t=0;r.group.traverse(o=>{if(o.geometry)t+=o.geometry.indexCount/3});out.push({asset:a,triangles:t});}
console.table(out);
