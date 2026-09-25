(function(global){'use strict';const P=global.PriomGL=global.PriomGL||{};
async function install(engine){
 engine.apex5World=new P.ApexWorldSystem(engine);engine.apex5World.build();
 engine.correlationProcessor=new P.HyperSphereCorrelation(18,{bits:9,tables:5,probes:4,seed:0xA5E5});
 engine.apex5TextureSystem=new P.TextureMaterialSystem(engine);
 // Seed the correlation core with semantic material embeddings. This is the
 // supplied processor's real idea repurposed for graphics locality.
 const mats={grass:[.1,.8,.1,.9,.1,.0,.0,.3,.1,.2,.4,.1,.7,.2,.1,.0,.5,.3],leaf:[.05,.9,.1,.8,.1,.0,.0,.5,.2,.3,.5,.2,.8,.2,.1,.1,.6,.2],bark:[.5,.2,.05,.9,.8,.0,.0,.2,.7,.8,.1,.0,.6,.2,.5,.1,.2,.7],rock:[.5,.5,.5,.9,.9,.0,.1,.8,.1,.2,.7,.4,.4,.6,.6,.1,.3,.2],fur:[.45,.3,.15,.95,.8,.0,.0,.6,.4,.5,.3,.2,.7,.2,.2,.3,.5,.4]};for(const [k,v] of Object.entries(mats))engine.correlationProcessor.insert(k,v);
 const r=engine.renderer;if(r&&r.gl)r._metaSaturation=Math.max(r._metaSaturation||1.08,1.16);
 await engine.apex5TextureSystem.apply().catch(err=>console.warn('Apex5 texture pass:',err));
 const oldStart=engine.start.bind(engine);engine.start=()=>oldStart();
 engine.spawnProceduralFauna=(n=9)=>engine.apex5World.spawnFauna(n);
 engine.apex5World.spawnFauna=engine.apex5World.spawnFauna.bind(engine.apex5World);
 return engine;
}
P.Apex5={install};})(typeof window!=='undefined'?window:globalThis);
