(function(global){'use strict';const P=global.PriomGL=global.PriomGL||{};
class Apex6WorldForge{
 constructor(engine){this.engine=engine;this.version='6.0.0';this.features={gpuDrivenCulling:false,materialArrays:false,atmosphere:true,water:true,wind:true,semanticMemory:true};}
 async install(){
  const e=this.engine,r=e.renderer;
  if(r?.isWebGPU){this.features.gpuDrivenCulling=!!r.cullPipeline;this.features.materialArrays=await r.materialReadyPromise;}
  this._patchNatureMaterials();this._patchStats();this._patchWeather();this._addWorldControls();
  if(e.correlationProcessor){e.correlationProcessor.insert('apex6_world',[.92,.88,.76,.81,.74,.64,.58,.72,.66,.91,.83,.77,.69,.55,.73,.86,.62,.79]);}
  e.apex6=this;return this;
 }
 _patchNatureMaterials(){const e=this.engine;for(const f of e._allForests||[]){if(!f)continue;for(const cell of f.cells?.values?.()||[]){const m=cell.forest?.mesh?.material||cell.mesh?.material;if(!m)continue;if(f===e.forests?.grass)m.textureFamily='grass';else if(f===e.forests?.bush)m.textureFamily='leaf';else if(Array.isArray(e.forests?.pine)&&e.forests.pine.includes(f))m.textureFamily='bark';else if(f===e.forests?.rock)m.textureFamily='rock';}}}
 _patchStats(){const e=this.engine;if(!e.renderer)return;const old=e.renderer.render.bind(e.renderer);e.renderer.render=(scene,camera)=>{old(scene,camera);if(e.renderer.stats)e.renderer.stats.apex6MaterialArrays=e.renderer.materialReady;};}
 _patchWeather(){const e=this.engine;if(e._apex6WeatherPatched)return;e._apex6WeatherPatched=true;const old=e._updateWeather?.bind(e);if(old)e._updateWeather=(dt)=>{old(dt);const w=e.worldAI?.weather||'despejado';if(e.renderer?.time!=null)e.renderer.weatherState=w;};}
 _addWorldControls(){const e=this.engine; if(!e._apex6Controls){e._apex6Controls=true;window.addEventListener('keydown',ev=>{if(ev.code==='KeyG')this.toggleGPUCulling();if(ev.code==='KeyV')this.spawnLifePulse();});}}
 toggleGPUCulling(){const r=this.engine.renderer;if(r)r.gpuCullingEnabled=r.gpuCullingEnabled===false;}
 spawnLifePulse(){const e=this.engine;if(e.apex5World)e.apex5World.spawnFauna(3);}
 summary(){return {...this.features,materialArrays:this.engine.renderer?.materialReady===true};}
}
P.Apex6WorldForge=Apex6WorldForge;
})(typeof window!=='undefined'?window:globalThis);