/**
 * PriomGL WebGPU Renderer — native WebGPU path.
 * No Babylon/Three. PBR, clustered-ish light data, depth, instancing,
 * procedural micro-detail, atmospheric response and automatic meshlet LOD.
 *
 * The renderer is intentionally duck-typed against PriomGL's Scene/Mesh classes,
 * so the existing engine can switch back to WebGL2 without a scene rewrite.
 */
(function(global){
'use strict';
const P=global.PriomGL||{};
const MeshletLOD=P.MeshletLOD;

const WGSL=`
struct Frame { viewProj:mat4x4f, camera:vec4f, sunDir:vec4f, sunColor:vec4f, fog:vec4f, params:vec4f };
struct ObjectData { model:mat4x4f, color:vec4f, material:vec4f };
@group(0) @binding(0) var<uniform> frame:Frame;
@group(1) @binding(0) var<uniform> obj:ObjectData;
@group(2) @binding(0) var matSampler:sampler;
@group(2) @binding(1) var albedoTex:texture_2d_array<f32>;
@group(2) @binding(2) var normalTex:texture_2d_array<f32>;
@group(2) @binding(3) var roughTex:texture_2d_array<f32>;
struct VSIn { @location(0) pos:vec3f, @location(1) nrm:vec3f, @location(2) uv:vec2f, @location(3) col:vec4f };
struct VSOut { @builtin(position) p:vec4f, @location(0) wp:vec3f, @location(1) n:vec3f, @location(2) uv:vec2f, @location(3) col:vec4f };
@vertex fn vs(i:VSIn)->VSOut{
  var o:VSOut; let wp=(obj.model*vec4f(i.pos,1)).xyz;
  o.p=frame.viewProj*vec4f(wp,1); o.wp=wp;
  o.n=normalize((obj.model*vec4f(i.nrm,0)).xyz); o.uv=i.uv; o.col=i.col; return o;
}
fn hash(p:vec3f)->f32{ let q=fract(p*0.3183099+.1); return fract(17.0*q.x*q.y*q.z*(q.x+q.y+q.z)); }
fn noise(p:vec3f)->f32{
  let i=floor(p); let f=fract(p); let u=f*f*(3.0-2.0*f);
  let n000=hash(i);let n100=hash(i+vec3f(1,0,0));let n010=hash(i+vec3f(0,1,0));let n110=hash(i+vec3f(1,1,0));
  let n001=hash(i+vec3f(0,0,1));let n101=hash(i+vec3f(1,0,1));let n011=hash(i+vec3f(0,1,1));let n111=hash(i+vec3f(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z);
}
fn aces(x:vec3f)->vec3f{let a=2.51;let b=.03;let c=2.43;let d=.59;let e=.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3f(0),vec3f(1));}
fn sampleMat(layer:f32, uv:vec2f)->vec3f{return textureSample(albedoTex,matSampler,fract(uv),i32(layer)).rgb;}
fn sampleNorm(layer:f32, uv:vec2f)->vec3f{return textureSample(normalTex,matSampler,fract(uv),i32(layer)).rgb*2.0-1.0;}
fn sampleRough(layer:f32, uv:vec2f)->f32{return textureSample(roughTex,matSampler,fract(uv),i32(layer)).r;}
fn applyNormalMap(N0:vec3f,wp:vec3f,uv:vec2f,layer:f32)->vec3f{
  let dp1=dpdx(wp); let dp2=dpdy(wp); let du1=dpdx(uv); let du2=dpdy(uv);
  let T=normalize(dp1*du2.y-dp2*du1.y); let B=normalize(cross(N0,T)); let nm=normalize(sampleNorm(layer,uv));
  return normalize(T*nm.x+B*nm.y+N0*nm.z);
}
@fragment fn fs(i:VSOut)->@location(0) vec4f{
  var N=normalize(i.n); let L=normalize(-frame.sunDir.xyz); let V=normalize(frame.camera.xyz-i.wp);
  let kind=obj.material.w; var base=obj.color.rgb*i.col.rgb; var rough=clamp(obj.material.y,.035,.98); var layer=obj.color.a;
  if(kind>0.5 && kind<1.5){
    let slope=1.0-max(N.y,0.0); let h=i.wp.y; let moisture=noise(i.wp*.018)*.65+noise(i.wp*.071)*.35;
    let grassW=smoothstep(.15,.55,1.0-slope)*(1.0-smoothstep(20.0,29.0,h));
    let rockW=smoothstep(.42,.82,slope)+smoothstep(22.0,31.0,h)*.45;
    let soilW=max(.0,1.0-grassW-rockW*.72);
    let sum=max(grassW+rockW+soilW,.001);
    base=(sampleMat(1.0,i.uv*7.0)*grassW+sampleMat(4.0,i.uv*5.0)*rockW+sampleMat(0.0,i.uv*6.0)*soilW)/sum;
    rough=(sampleRough(1.0,i.uv*7.0)*grassW+sampleRough(4.0,i.uv*5.0)*rockW+sampleRough(0.0,i.uv*6.0)*soilW)/sum;
    let macroTone=0.82+0.18*noise(i.wp*.035+vec3f(2,4,1)); base*=macroTone;
    N=applyNormalMap(N,i.wp,i.uv*7.0,select(0.0,1.0,grassW>=rockW));
  } else if(kind>1.5 && kind<2.5){
    let wave=sin(i.wp.x*1.7+frame.params.w*1.8)+sin(i.wp.z*1.25-frame.params.w*1.2)+noise(i.wp*.7+vec3f(frame.params.w*.12,0,0))*.6;
    let fres=pow(1.0-max(dot(N,V),0.0),5.0); base=sampleMat(6.0,i.uv*3.2); base=mix(base,vec3f(.08,.38,.52),.35); base+=vec3f(.35,.55,.72)*fres*.65+vec3f(.02,.05,.06)*wave; rough=.055;
  } else {
    let fam=clamp(layer,0.0,6.0); base=base*sampleMat(fam,i.uv*5.0); rough=clamp(rough*.55+sampleRough(fam,i.uv*5.0)*.45,.035,.98);
    N=applyNormalMap(N,i.wp,i.uv*5.0,fam);
  }
  let H=normalize(L+V); let NoL=max(dot(N,L),0); let NoV=max(dot(N,V),.001); let NoH=max(dot(N,H),.001);
  let metal=clamp(obj.material.x,0,1); let a=rough*rough; let a2=a*a; let den=NoH*NoH*(a2-1)+1; let D=a2/(3.14159*den*den);
  let k=(rough+1)*(rough+1)/8; let Gv=NoV/(NoV*(1-k)+k); let Gl=NoL/(NoL*(1-k)+k);
  let F0=mix(vec3f(.04),base,metal); let F=F0+(1-F0)*pow(1-max(dot(H,V),0),5); let spec=D*Gv*Gl*F/(4*NoV*NoL+1e-4); let diff=(1-F)*(1-metal)*base/3.14159;
  var c=(diff+spec)*frame.sunColor.rgb*NoL + base*(.055+.085*NoV);
  if(kind>2.5 && kind<4.5){let back=max(dot(-N,L),0);c+=base*back*.18;}
  let micro=(noise(i.wp*9.0)-.5)*.035+(noise(i.wp*31.0)-.5)*.014;c*=1.0+micro;
  let dist=length(frame.camera.xyz-i.wp);let fog=1-exp(-dist*frame.fog.x);c=mix(c,frame.fog.yzw,fog);
  return vec4f(pow(aces(c*frame.params.x),vec3f(1.0/2.2)),1);
}
`;
const SKY_WGSL=`
struct Frame { viewProj:mat4x4f, camera:vec4f, sunDir:vec4f, sunColor:vec4f, fog:vec4f, params:vec4f };
@group(0) @binding(0) var<uniform> frame:Frame;
struct O{@builtin(position)p:vec4f,@location(0)uv:vec2f};
@vertex fn vs(@builtin(vertex_index)i:u32)->O{var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:O;o.p=vec4f(p[i],0,1);o.uv=p[i]*.5+.5;return o;}
fn h2(p:vec2f)->f32{let q=fract(p*vec2f(127.1,311.7));return fract(sin(dot(q,vec2f(41.73,113.17)))*43758.5453);}
fn n2(p:vec2f)->f32{let i=floor(p);let f=fract(p);let u=f*f*(3-2*f);return mix(mix(h2(i),h2(i+vec2f(1,0)),u.x),mix(h2(i+vec2f(0,1)),h2(i+vec2f(1,1)),u.x),u.y);}
fn fbm(p0:vec2f)->f32{var p=p0;var a=.5;var v=0.;for(var i=0;i<5;i++){v+=n2(p)*a;p*=2.02;a*=.5;}return v;}
fn aces(x:vec3f)->vec3f{let a=2.51;let b=.03;let c=2.43;let d=.59;let e=.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3f(0),vec3f(1));}
@fragment fn fs(i:O)->@location(0)vec4f{
 let y=clamp(i.uv.y,0,1);let horizon=vec3f(.58,.70,.82);let zenith=vec3f(.025,.055,.13);var c=mix(horizon,zenith,pow(y,.72));
 let uv=i.uv*2.0-1.0;let dir=normalize(vec3f(uv.x*1.18,uv.y*.92,1.0));let sunDir=normalize(-frame.sunDir.xyz);let sunAmount=max(dot(dir,sunDir),0.0);
 let disk=pow(sunAmount,720.0);let glow=pow(sunAmount,28.0);c+=frame.sunColor.rgb*(disk*5.0+glow*.5);
 let weather=clamp(frame.params.y,0,1);let cloudUv=dir.xz/(max(abs(dir.y),.12))*1.35+vec2f(frame.params.w*.004,frame.params.w*.001);let cloud=pow(clamp(fbm(cloudUv),0,1),1.7);let cloudMask=smoothstep(.43,.72,cloud)*smoothstep(.05,.55,dir.y+0.25);c=mix(c,vec3f(.72,.75,.78),cloudMask*(.72+.18*weather));
 let haze=exp(-abs(y-.42)*7.0);c+=vec3f(.12,.14,.16)*haze*(1-.25*weather);c=mix(c,vec3f(.24,.29,.34),weather*.28);
 return vec4f(pow(clamp(aces(c),vec3f(0),vec3f(1)),vec3f(1/2.2)),1);
}`;

const INST_WGSL=`
struct Frame { viewProj:mat4x4f, camera:vec4f, sunDir:vec4f, sunColor:vec4f, fog:vec4f, params:vec4f };
struct ObjectData { model:mat4x4f, color:vec4f, material:vec4f };
struct Inst { p:vec3f, _p:f32, q:vec4f, s:vec3f, _s:f32, c:vec3f, phase:f32 };
@group(0) @binding(0) var<uniform> frame:Frame; @group(1) @binding(0) var<uniform> obj:ObjectData;
@group(2) @binding(0) var<storage,read> inst:array<Inst>;
@group(3) @binding(0) var matSampler:sampler; @group(3) @binding(1) var albedoTex:texture_2d_array<f32>; @group(3) @binding(2) var normalTex:texture_2d_array<f32>; @group(3) @binding(3) var roughTex:texture_2d_array<f32>;
struct VSIn { @location(0) pos:vec3f,@location(1)nrm:vec3f,@location(2)uv:vec2f,@location(3)col:vec4f };
struct VSOut { @builtin(position)p:vec4f,@location(0)wp:vec3f,@location(1)n:vec3f,@location(2)uv:vec2f,@location(3)c:vec3f };
fn qrot(q:vec4f,v:vec3f)->vec3f{return v+2*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@vertex fn vs(i:VSIn,@builtin(instance_index) id:u32)->VSOut{
 let a=inst[id]; let wind=sin(a.phase+frame.params.w*1.4+a.p.x*.09+a.p.z*.07)*.035; var lp=i.pos*a.s; lp.x+=wind*max(0.0,lp.y); lp.z+=wind*.35*max(0.0,lp.y); let local=qrot(a.q,lp)+a.p; let wp=(obj.model*vec4f(local,1)).xyz;
 var o:VSOut;o.p=frame.viewProj*vec4f(wp,1);o.wp=wp;o.n=normalize(qrot(a.q,i.nrm));o.uv=i.uv;o.c=a.c*i.col.rgb;return o;
}
fn hash(p:vec3f)->f32{let q=fract(p*.3183099+.1);return fract(17*q.x*q.y*q.z*(q.x+q.y+q.z));}
fn aces(x:vec3f)->vec3f{let a=2.51;let b=.03;let c=2.43;let d=.59;let e=.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),vec3f(0),vec3f(1));}
fn sm(layer:f32,uv:vec2f)->vec3f{return textureSample(albedoTex,matSampler,fract(uv),i32(layer)).rgb;}
fn sn(layer:f32,uv:vec2f)->vec3f{return textureSample(normalTex,matSampler,fract(uv),i32(layer)).rgb*2-1;}
fn sr(layer:f32,uv:vec2f)->f32{return textureSample(roughTex,matSampler,fract(uv),i32(layer)).r;}
@fragment fn fs(i:VSOut)->@location(0)vec4f{
 let N0=normalize(i.n);let layer=clamp(obj.color.a,0,6);let dp1=dpdx(i.wp);let dp2=dpdy(i.wp);let du1=dpdx(i.uv);let du2=dpdy(i.uv);let T=normalize(dp1*du2.y-dp2*du1.y);let B=normalize(cross(N0,T));let N=normalize(T*sn(layer,i.uv*4).x+B*sn(layer,i.uv*4).y+N0*sn(layer,i.uv*4).z);
 let L=normalize(-frame.sunDir.xyz);let V=normalize(frame.camera.xyz-i.wp);let NoL=max(dot(N,L),0);let base=i.c*sm(layer,i.uv*4);let rough=clamp(sr(layer,i.uv*4),.12,.98);let back=max(dot(-N,L),0);let H=normalize(L+V);let NoV=max(dot(N,V),.001);let NoH=max(dot(N,H),.001);let a=rough*rough;let a2=a*a;let den=NoH*NoH*(a2-1)+1;let D=a2/(3.14159*den*den);let k=(rough+1)*(rough+1)/8;let Gv=NoV/(NoV*(1-k)+k);let Gl=NoL/(NoL*(1-k)+k);let F=.04+(1-.04)*pow(1-max(dot(H,V),0),5);let spec=D*Gv*Gl*F/(4*NoV*NoL+1e-4);let diff=(1-F)*base/3.14159;var c=(diff+spec)*frame.sunColor.rgb*NoL+base*(.06+.10*NoV)+base*back*.20;c*=.92+.08*hash(i.wp*7);let fog=1-exp(-length(frame.camera.xyz-i.wp)*frame.fog.x);c=mix(c,frame.fog.yzw,fog);return vec4f(pow(aces(c*frame.params.x),vec3f(1/2.2)),1);
}
`;

class WebGPURenderer {
  constructor(canvas, options={}){
    this.canvas=canvas;this.options=options;this.isWebGPU=true;this.ready=false;this.failed=false;
    this.stats={drawCalls:0,triangles:0,webgpu:true,meshlets:0,visibleMeshlets:0};
    this.failureReason='';
    this.ssaoEnabled=true;this.bloomEnabled=true;this.useNeuralTonemap=false;this.gpuCullingEnabled=false;this.time=0;this.waterGeo=null;
    this.maxPixelRatio=options.maxPixelRatio||1.25;this.pixelRatio=Math.min(devicePixelRatio||1,this.maxPixelRatio);this.exposure=options.exposure||1.2;this.shadowCascadeScale=1;this.isMobile=!!options.mobile;this.tier=options.tier||'unknown';this.gpuCullingEnabled=options.gpuCulling !== false && !this.isMobile;this._cullFrame=0;this._cullInterval=this.isMobile?8:4;this._dynamicScale=this.isMobile?0.82:1.0;this._frameTimes=[];this._frameCounter=0;
    this._cache=new WeakMap();this._instCache=new WeakMap();this._gpuCullCache=new WeakMap();this.materialReady=false;this.materialReadyPromise=Promise.resolve(false);
    // Build CPU-side utility geometry synchronously. The engine constructs the
    // world immediately while WebGPU initialization is async; leaving
    // waterGeo null during that window made Apex 4.0 vulnerable to a startup
    // crash/fallback race. Geometry is API-compatible with both WebGPU and
    // WebGL2 renderers.
    this._makeWaterGeoCPU();
    // Same race as waterGeo above, different victim: ParticleSystem and
    // GLTFLoader read `renderer.assetGL || renderer.gl` synchronously the
    // moment the engine is constructed (PriomEngine._initParticles runs
    // before WebGPU's adapter/device negotiation — which needs several
    // awaits — has any chance to resolve). assetGL doesn't actually need
    // the GPU adapter or device at all, only a plain WebGL2 context on a
    // throwaway canvas, so build it here too instead of inside the async
    // _init(). Without this, on any device where navigator.gpu exists but
    // real adapter creation fails or is merely slow (common on Android),
    // `new ParticleSystem(this.renderer, ...)` crashes with "Cannot read
    // properties of undefined (reading 'VERTEX_SHADER')" and takes the
    // whole PriomEngine constructor down with it before the automatic
    // WebGL2 fallback ever gets a chance to run.
    this._makeAssetGL();
    this.readyPromise=this._init();
  }
  _makeAssetGL(){
    const assetCanvas=document.createElement('canvas');assetCanvas.width=1;assetCanvas.height=1;
    this.assetGL=assetCanvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:false});
  }
  async _init(){
    try{
    if(!navigator.gpu) throw new Error('navigator.gpu no existe en este navegador/dispositivo');
    this.adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!this.adapter)throw new Error('No se encontró adaptador WebGPU');
    this.device=await this.adapter.requestDevice();
    this.device.addEventListener?.('uncapturederror', e => { this.lastGPUError=e.error; console.warn('WebGPU uncaptured error:', e.error); });
    this.device.lost?.then(info=>{ this.deviceLostInfo=info; this.ready=false; this.failed=true; this.failureReason='WebGPU device lost: '+(info?.message||info?.reason||'unknown'); console.warn(this.failureReason); });
    this.context=this.canvas.getContext('webgpu');this.format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
    this.frameBuf=this.device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    // BUGFIX (root cause of "giant wrong-colored triangle" rendering,
    // visible for the first time only once the shaders finally compiled —
    // see 6.1.5 through 6.1.11): every mesh/instanced draw in a frame used
    // to share ONE 256-byte `objBuf`, rewritten via device.queue.writeBuffer()
    // right before each draw, then bound at a fixed offset 0. But all the
    // draws for a frame are recorded into a single command encoder and only
    // actually submitted once, at the very end of render(). writeBuffer()
    // calls are ordered on the *queue* timeline, completely separately from
    // command *recording* — so by the time the GPU actually executes any of
    // that frame's draws, every single one of them sees whatever was the
    // LAST writeBuffer() call's data (the last object drawn that frame),
    // not its own. Every mesh/instance ends up rendered with the same
    // (wrong) transform/color/material — which is exactly the huge,
    // flat-colored, frame-to-frame-shifting-hue triangles in the report.
    // Fix: one bigger buffer, one fixed-size slot per draw call this frame
    // (never overwritten by another draw), addressed via a dynamic bind
    // group offset — see _ensureObjCapacity()/_drawMesh()/_drawInstanced().
    this._objStride=256;this._objCapacity=2048;this._objSlot=0;
    this.objBuf=this.device.createBuffer({size:this._objCapacity*this._objStride,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.frameLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
    this.objLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:128}}]});
    this.frameBG=this.device.createBindGroup({layout:this.frameLayout,entries:[{binding:0,resource:{buffer:this.frameBuf}}]});
    this.objBG=this.device.createBindGroup({layout:this.objLayout,entries:[{binding:0,resource:{buffer:this.objBuf,size:128}}]});
    this.materialLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}}]});
    this.materialBG=null;this._legacyInstCache=new WeakMap();
    this.materialReadyPromise=this._initMaterialArrays();
    // Both createShaderModule() and createRenderPipeline() are effectively
    // "fire and forget" about validation by default: neither throws when
    // something's wrong, they just hand back an object that's silently
    // marked invalid, and the *real* reason only ever shows up later, once
    // removed from context, as a generic "[Invalid X] is invalid (due to a
    // previous error)" — which is all we've been able to show so far (see
    // 6.1.4/6.1.5/6.1.8 changelogs; each of those bugs took a full
    // line-by-line manual read to find precisely because of this). Explicitly
    // pulling each module's getCompilationInfo() gives the *actual* Tint/Naga
    // diagnostic — file, line, column, message — before it ever gets used,
    // so any future WGSL typo fails fast with an exact pointer to the bug
    // instead of another round of manual auditing.
    const compileChecked=async(label,code)=>{
      const mod=this.device.createShaderModule({code,label});
      if(mod.getCompilationInfo){
        const info=await mod.getCompilationInfo();
        const errors=info.messages.filter(m=>m.type==='error');
        if(errors.length){
          const detail=errors.map(m=>`${label}:${m.lineNum}:${m.linePos} — ${m.message}`).join(' | ');
          throw new Error(`WGSL compile error in "${label}": ${detail}`);
        }
      }
      return mod;
    };
    const mainMod=await compileChecked('main',WGSL);
    this.pipeline=await this.device.createRenderPipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.frameLayout,this.objLayout,this.materialLayout]}),vertex:{module:mainMod,entryPoint:'vs',buffers:[
      {arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]},
      {arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:'float32x3'}]},
      {arrayStride:8,attributes:[{shaderLocation:2,offset:0,format:'float32x2'}]},
      {arrayStride:16,attributes:[{shaderLocation:3,offset:0,format:'float32x4'}]}
    ]},fragment:{module:mainMod,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    const skyModule=await compileChecked('sky',SKY_WGSL);
    this.skyPipeline=await this.device.createRenderPipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.frameLayout]}),vertex:{module:skyModule,entryPoint:'vs'},fragment:{module:skyModule,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}});
    this.instLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
    const instMod=await compileChecked('instanced',INST_WGSL);
    this.instPipeline=await this.device.createRenderPipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.frameLayout,this.objLayout,this.instLayout,this.materialLayout]}),vertex:{module:instMod,entryPoint:'vs',buffers:[
      {arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]},
      {arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:'float32x3'}]},
      {arrayStride:8,attributes:[{shaderLocation:2,offset:0,format:'float32x2'}]},
      {arrayStride:16,attributes:[{shaderLocation:3,offset:0,format:'float32x4'}]}
    ]},fragment:{module:instMod,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    this.cullLayout=this.device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}
    ]});
    const cullShader=`struct Inst{p:vec3f,_p:f32,q:vec4f,s:vec3f,_s:f32,c:vec3f,phase:f32};struct Params{camera:vec4f,limit:vec4f};@group(0)@binding(0)var<storage,read>src:array<Inst>;@group(0)@binding(1)var<storage,read_write>dst:array<Inst>;@group(0)@binding(2)var<storage,read_write>counter:atomic<u32>;@group(0)@binding(3)var<storage,read_write>args:array<u32>;@group(0)@binding(4)var<uniform>params:Params;@compute@workgroup_size(64)fn main(@builtin(global_invocation_id)gid:vec3u){let id=gid.x;if(id>=arrayLength(&src)){return;}let a=src[id];let d=distance(a.p,params.camera.xyz);if(d<=params.limit.x){let out=atomicAdd(&counter,1u);dst[out]=a;}}`;
    const cmod=await compileChecked('cull',cullShader);
    this.cullPipeline=await this.device.createComputePipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.cullLayout]}),compute:{module:cmod,entryPoint:'main'}});
    const finalizeShader=`@group(0)@binding(0)var<storage,read_write>counter:atomic<u32>;@group(0)@binding(1)var<storage,read_write>args:array<u32>;@compute@workgroup_size(1)fn main(){args[1]=atomicLoad(&counter);}`;const fmod=await compileChecked('cull-finalize',finalizeShader);this.cullFinalizeLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});this.cullFinalizePipeline=await this.device.createComputePipelineAsync({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.cullFinalizeLayout]}),compute:{module:fmod,entryPoint:'main'}});
    this._makeDepth();this._makeWaterGeo();this.ready=true;console.log('⚡ PriomGL WebGPU pipeline activo');return true;
    }catch(err){this.failed=true;this.failureReason=err?.message||String(err);console.warn('WebGPU init failed:',err);return false;}
  }
  _makeDepth(){
    this._depthW=Math.max(1,this.canvas.width||this.width||1);this._depthH=Math.max(1,this.canvas.height||this.height||1);
    this.depth=this.device.createTexture({size:[this._depthW,this._depthH],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  }
  _makeWaterGeoCPU(){ // CPU geometry compatible with the existing Mesh API
    const G=P.Geometry;if(!G)return;
    const g=new G();g.setAttribute('position',[-700,0,-700,700,0,-700,700,0,700,-700,0,700],3);
    g.setAttribute('normal',[0,1,0,0,1,0,0,1,0,0,1,0],3);g.setAttribute('uv',[0,0,1,0,1,1,0,1],2);g.setIndex([0,1,2,0,2,3]);this.waterGeo=g;
  }
  _makeWaterGeo(){ this._makeWaterGeoCPU(); }
  async _initMaterialArrays(){
    if(!this.device)return false;
    try{
      const names=['soil','grass','leaf','bark','rock','fur','water'];
      const layers=names.length;
      // Always install a tiny valid bind group first. This is critical for
      // browsers where image decoding is slow: the render pipeline never
      // reaches a draw with a missing group-3 binding (which otherwise yields
      // a WebGPU validation error and a black canvas). Real 1024px arrays are
      // swapped in once loaded.
      const make=(size,format)=>this.device.createTexture({size:[size,size,layers],format,mipLevelCount:1,sampleCount:1,dimension:'2d',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      const al=make(1,'rgba8unorm'), no=make(1,'rgba8unorm'), ro=make(1,'r8unorm');
      const fallbackAl=new Uint8Array([180,180,180,255]), fallbackNo=new Uint8Array([128,128,255,255]), fallbackRo=new Uint8Array([190]);
      for(let layer=0;layer<layers;layer++){
        this.device.queue.writeTexture({texture:al,origin:{x:0,y:0,z:layer}},fallbackAl,{bytesPerRow:4,rowsPerImage:1},[1,1,1]);
        this.device.queue.writeTexture({texture:no,origin:{x:0,y:0,z:layer}},fallbackNo,{bytesPerRow:4,rowsPerImage:1},[1,1,1]);
        this.device.queue.writeTexture({texture:ro,origin:{x:0,y:0,z:layer}},fallbackRo,{bytesPerRow:1,rowsPerImage:1},[1,1,1]);
      }
      this.materialBG=this.device.createBindGroup({layout:this.materialLayout,entries:[{binding:0,resource:this.device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'})},{binding:1,resource:al.createView({dimension:'2d-array'})},{binding:2,resource:no.createView({dimension:'2d-array'})},{binding:3,resource:ro.createView({dimension:'2d-array'})}]});
      this.materialReady=true;
      const size=1024;
      const realAl=make(size,'rgba8unorm'), realNo=make(size,'rgba8unorm'), realRo=make(size,'r8unorm');
      for(let layer=0;layer<names.length;layer++){
        const n=names[layer];
        for(const [suffix,tex] of [['albedo',realAl],['normal',realNo],['roughness',realRo]]){
          const res=await fetch(`assets/materials/${n}_${suffix}.png`); if(!res.ok)throw new Error(`material ${n}_${suffix} ${res.status}`);
          const bmp=await createImageBitmap(await res.blob());
          this.device.queue.copyExternalImageToTexture({source:bmp},{texture:tex,origin:{x:0,y:0,z:layer}},[bmp.width,bmp.height]); bmp.close?.();
        }
      }
      const sampler=this.device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'});
      this.materialBG=this.device.createBindGroup({layout:this.materialLayout,entries:[{binding:0,resource:sampler},{binding:1,resource:realAl.createView({dimension:'2d-array'})},{binding:2,resource:realNo.createView({dimension:'2d-array'})},{binding:3,resource:realRo.createView({dimension:'2d-array'})}]});
      this.materialReady=true;return true;
    }catch(e){console.warn('Apex6 material arrays unavailable; procedural fallback remains:',e);this.materialReady=false;return false;}
  }
  _familyLayer(mat, mesh){const f=(mat&&mat.textureFamily)||mesh?.userData?.apex6Material||'';return ({soil:0,grass:1,leaf:2,bark:3,rock:4,fur:5,water:6})[f] ?? 0;}
  _cullState(im,packed,count,g){
    let st=this._gpuCullCache.get(im);const bytes=Math.max(64,count*64);
    if(!st||st.count!==count){
      const inBuf=this._buf(packed,GPUBufferUsage.STORAGE),outBuf=this.device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),counter=this.device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),args=this.device.createBuffer({size:20,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST}),params=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const bg=this.device.createBindGroup({layout:this.cullLayout,entries:[{binding:0,resource:{buffer:inBuf}},{binding:1,resource:{buffer:outBuf}},{binding:2,resource:{buffer:counter}},{binding:3,resource:{buffer:args}},{binding:4,resource:{buffer:params}}]});
      const outBG=this.device.createBindGroup({layout:this.instLayout,entries:[{binding:0,resource:{buffer:outBuf}}]});st={count,inBuf,outBuf,counter,args,params,bg,outBG};this._gpuCullCache.set(im,st);
    }else this.device.queue.writeBuffer(st.inBuf,0,packed);
    return st;
  }
  getDiagnostics(){return {backend:'WebGPU',ready:this.ready,failed:this.failed,deviceLost:this.deviceLostInfo||null,lastGPUError:this.lastGPUError?.message||null,consecutiveGPUErrors:this._consecutiveGPUErrors||0,dynamicScale:this._dynamicScale,gpuCulling:this.gpuCullingEnabled,materialReady:!!this.materialReady,meshCache:this._cache?.size||0};}
  setGPUCulling(enabled){this.gpuCullingEnabled=!!enabled;return this.gpuCullingEnabled;}
  resize(){this.setSize(this.canvas.clientWidth||this.width||1,this.canvas.clientHeight||this.height||1);}
  setSize(w,h){this.width=Math.max(1,Math.floor(w));this.height=Math.max(1,Math.floor(h));this.pixelRatio=Math.max(.5,Math.min(this.pixelRatio||devicePixelRatio||1,this.maxPixelRatio));this.canvas.width=Math.max(1,Math.floor(this.width*this.pixelRatio*this._dynamicScale));this.canvas.height=Math.max(1,Math.floor(this.height*this.pixelRatio*this._dynamicScale));if(this.device)this._makeDepth();}
  _buf(data,usage){const b=this.device.createBuffer({size:Math.max(4,((data.byteLength+3)>>2)<<2),usage:usage|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(b,0,data);return b;}
  _geom(g){
    let c=this._cache.get(g);if(c)return c;
    const p=g.attributes.position?.data,n=g.attributes.normal?.data||new Float32Array(p.length),uv=g.attributes.uv?.data||new Float32Array((p.length/3)*2),cc=g.attributes.color?.data||null,ix=g.indices;
    if(!p||!ix)return null;
    let color;
    if(cc){
      const itemSize=g.attributes.color.size||3, vc=p.length/3; color=new Float32Array(vc*4);
      if(itemSize===4) color.set(cc);
      else for(let j=0;j<vc;j++){color[j*4]=cc[j*itemSize]??1;color[j*4+1]=cc[j*itemSize+1]??1;color[j*4+2]=cc[j*itemSize+2]??1;color[j*4+3]=1;}
    } else {color=new Float32Array((p.length/3)*4);for(let j=0;j<color.length;j+=4)color[j]=color[j+1]=color[j+2]=color[j+3]=1;}
    c={p:this._buf(p,GPUBufferUsage.VERTEX),n:this._buf(n,GPUBufferUsage.VERTEX),uv:this._buf(uv,GPUBufferUsage.VERTEX),col:this._buf(color,GPUBufferUsage.VERTEX),i:this._buf(ix,GPUBufferUsage.INDEX),count:ix.length,meshlet:null};
    if(MeshletLOD){
      // Upload first, render immediately; build virtualized LOD metadata off the
      // critical frame so a 10M-triangle asset never blocks the first present.
      const ml=new MeshletLOD();
      c.meshletPromise=ml.buildAsync(g).then(x=>{c.meshlet=x;this.stats.meshlets+=x.stats.meshlets;return x;});
    }
    this._cache.set(g,c);return c;
  }
  _matrixArray(m){return m?.e?m.e:new Float32Array(m||16);}
  // Grows the shared per-object uniform buffer (and its bind group) so
  // every draw this frame gets its own never-overwritten slot. Called once
  // per frame, before recording any draws — see the note on this.objBuf.
  _ensureObjCapacity(count){
    if(count<=this._objCapacity)return;
    this._objCapacity=Math.max(count,this._objCapacity*2);
    this.objBuf=this.device.createBuffer({size:this._objCapacity*this._objStride,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.objBG=this.device.createBindGroup({layout:this.objLayout,entries:[{binding:0,resource:{buffer:this.objBuf,size:128}}]});
  }
  _drawMesh(pass,mesh,frame){
    const g=this._geom(mesh.geometry);if(!g)return;
    const mat=mesh.material||{};const model=this._matrixArray(mesh.matrixWorld);
    const layer=this._familyLayer(mat,mesh);const c=mat.albedo?[mat.albedo.r,mat.albedo.g,mat.albedo.b,layer]:[.7,.72,.75,layer];
    const md=new Float32Array(32);md.set(model,0);md.set(c,16);const kind=mesh.userData?.generator?1:(mat.shader==='water'||mat.textureFamily==='water'?2:0);md.set([mat.metallic||0,mat.roughness??.55,mat.ao??1,kind],20);
    const slot=this._objSlot++,off=slot*this._objStride;
    this.device.queue.writeBuffer(this.objBuf,off,md);
    pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.frameBG);pass.setBindGroup(1,this.objBG,[off]);if(this.materialBG)pass.setBindGroup(2,this.materialBG);
    pass.setVertexBuffer(0,g.p);pass.setVertexBuffer(1,g.n);pass.setVertexBuffer(2,g.uv);pass.setVertexBuffer(3,g.col);pass.setIndexBuffer(g.i,'uint32');
    let level=0;if(g.meshlet&&mesh.position){const d=Math.hypot(mesh.position.x-frame[0],mesh.position.y-frame[1],mesh.position.z-frame[2]);level=g.meshlet.select(d,Math.max(1,g.meshlet.levels[0]?.meshlets[0]?.radius||1,this.height||1080));}
    // LOD selection is automatic; full index buffer remains the safe fallback.
    // If a simplified level exists, use its index buffer lazily.
    if(level>0&&g.meshlet?.levels[level]){const l=g.meshlet.levels[level];if(!g.lodBufs)g.lodBufs=[];if(!g.lodBufs[level])g.lodBufs[level]=this._buf(l.indices,GPUBufferUsage.INDEX);pass.setIndexBuffer(g.lodBufs[level],'uint32');pass.drawIndexed(l.indices.length);this.stats.triangles+=l.indices.length/3;}
    else{pass.drawIndexed(g.count);this.stats.triangles+=g.count/3;}
    this.stats.drawCalls++;
  }
  _drawInstanced(pass,im,frame,encoder){
    const g=this._geom(im.geometry);if(!g||!im.count)return;
    if(this.gpuCullingEnabled===false){const mat=im.material||{},layer=this._familyLayer(mat,im),md=new Float32Array(32);md.set(this._matrixArray(im.matrixWorld),0);md.set([mat.albedo?.r||.5,mat.albedo?.g||.5,mat.albedo?.b||.5,layer],16);md.set([mat.metallic||0,mat.roughness??.7,mat.ao??1,0],20);const slot=this._objSlot++,off=slot*this._objStride;this.device.queue.writeBuffer(this.objBuf,off,md);let legacy=this._legacyInstCache.get(im);const bytes=Math.max(64,im.instanceData.byteLength);if(!legacy||legacy.size!==bytes){const buffer=this.device.createBuffer({size:Math.max(4,((bytes+3)>>2)<<2),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const bg=this.device.createBindGroup({layout:this.instLayout,entries:[{binding:0,resource:{buffer}}]});legacy={buffer,bg,size:bytes};this._legacyInstCache.set(im,legacy);}this.device.queue.writeBuffer(legacy.buffer,0,im.instanceData);pass.setPipeline(this.instPipeline);pass.setBindGroup(0,this.frameBG);pass.setBindGroup(1,this.objBG,[off]);pass.setBindGroup(2,legacy.bg);if(this.materialBG)pass.setBindGroup(3,this.materialBG);pass.setVertexBuffer(0,g.p);pass.setVertexBuffer(1,g.n);pass.setVertexBuffer(2,g.uv);pass.setVertexBuffer(3,g.col);pass.setIndexBuffer(g.i,'uint32');pass.drawIndexed(g.count,im.count);this.stats.drawCalls++;this.stats.triangles+=g.count*im.count/3;return;}
    const need=im.count*16;let packed=this._packedInstances?.get(im);
    if(!packed||packed.length!==need){packed=new Float32Array(need);if(!this._packedInstances)this._packedInstances=new WeakMap();this._packedInstances.set(im,packed);}
    packed.set(im.instanceData.subarray(0,need));
    let st=this._cullState(im,packed,im.count,g);
    
    const mat=im.material||{},layer=this._familyLayer(mat,im);const md=new Float32Array(32);md.set(this._matrixArray(im.matrixWorld),0);md.set([mat.albedo?.r||.5,mat.albedo?.g||.5,mat.albedo?.b||.5,layer],16);md.set([mat.metallic||0,mat.roughness??.7,mat.ao??1,0],20);const slot=this._objSlot++,off=slot*this._objStride;this.device.queue.writeBuffer(this.objBuf,off,md);
    pass.setPipeline(this.instPipeline);pass.setBindGroup(0,this.frameBG);pass.setBindGroup(1,this.objBG,[off]);pass.setBindGroup(2,st.outBG);if(this.materialBG)pass.setBindGroup(3,this.materialBG);
    pass.setVertexBuffer(0,g.p);pass.setVertexBuffer(1,g.n);pass.setVertexBuffer(2,g.uv);pass.setVertexBuffer(3,g.col);pass.setIndexBuffer(g.i,'uint32');pass.drawIndexedIndirect(st.args,0);this.stats.drawCalls++;this.stats.triangles+=g.count*im.count/3;
  }
  _adaptResolution(){
    if(!this.canvas) return;
    const target=this.isMobile?48:58;
    if(this._frameTimes.length<24)return;
    let sum=0;for(const x of this._frameTimes)sum+=x;const fps=1000/(sum/this._frameTimes.length);
    let next=this._dynamicScale;
    if(fps<target-6)next=Math.max(this.isMobile?0.62:0.72,next-.06);
    else if(fps>target+8)next=Math.min(1.0,next+.04);
    if(Math.abs(next-this._dynamicScale)>.025){this._dynamicScale=next;this.setSize(this.canvas.clientWidth||this.width||1,this.canvas.clientHeight||this.height||1);}
  }
  render(scene,camera){
    if(!this.ready){return;}
    // The pushErrorScope/popErrorScope pair added for diagnosability is
    // itself not free on every GPU driver — on some mobile
    // implementations, wrapping *every single frame* forever in a
    // validation error scope measurably serializes/stalls the queue rather
    // than just sampling it, which could itself tank FPS on weaker
    // hardware. Its only real job is to catch a PERSISTENT problem (see the
    // 20-in-a-row fallback trigger below), so there's no need to pay that
    // cost forever — check every frame for the first few seconds after
    // startup (when a lingering validation bug would already show up
    // repeatedly), then drop to a light periodic sample.
    const framesSinceInit=(this._frameCounter||0);
    const checkThisFrame=this.device.pushErrorScope && (framesSinceInit<180 || framesSinceInit%30===0);
    if(checkThisFrame)this.device.pushErrorScope('validation');
    const frameStart=performance.now();
    const w=this.width||this.canvas.clientWidth||1,h=this.height||this.canvas.clientHeight||1;
    const pw=Math.floor(w*(this.pixelRatio||1)*this._dynamicScale),ph=Math.floor(h*(this.pixelRatio||1)*this._dynamicScale);
    if(!this.depth||this._depthW!==pw||this._depthH!==ph)this.setSize(w,h);
    camera.aspect=w/h;camera.updateProjection();camera.updateView();scene.updateMatrixWorld(true);
    const sun=scene.sun?.direction||{x:-.6,y:-.55,z:-.35},sc=scene.sun?.color||{r:1,g:.9,b:.8};
    const pm=camera.projectionMatrix.e, vm=camera.viewMatrix.e, vp=new Float32Array(16);
    // Column-major 4x4 multiplication: projection * view.
    for(let col=0;col<4;col++)for(let row=0;row<4;row++){let v=0;for(let k=0;k<4;k++)v+=pm[k*4+row]*vm[col*4+k];vp[col*4+row]=v;}
    const fd=new Float32Array(64);fd.set(vp,0);
    fd.set([camera.position.x,camera.position.y,camera.position.z,1],16);fd.set([sun.x,sun.y,sun.z,1],20);fd.set([sc.r,sc.g,sc.b,scene.sun?.intensity||2],24);
    fd.set([scene.fogDensity||.0015,scene.fogColor?.r||.5,scene.fogColor?.g||.65,scene.fogColor?.b||.8],28);const weatherName=scene.weather||this.weatherState||'despejado';const weatherFactor=weatherName==='tormenta'?1:(weatherName==='nublado'?.72:(weatherName==='lluvia'?.9:(weatherName==='niebla'?.82:(weatherName==='nieve'?.65:.05))));fd.set([this.exposure,weatherFactor,0,this.time],32);this.device.queue.writeBuffer(this.frameBuf,0,fd);
    // Diagnostic: a single NaN anywhere in the lighting inputs (sun
    // direction/color, fog color, exposure) propagates through the entire
    // lighting equation in the shader — normalize(NaN)->NaN->every dot
    // product->NaN->pow(NaN,...)->NaN — and browsers/drivers commonly
    // sanitize a NaN fragment to solid black on output. That would make
    // *every* pixel of *every* object black regardless of camera position,
    // which matches "black even flying far above the terrain" far better
    // than a camera/geometry bug. Surface the raw values so a NaN here is
    // immediately visible in the HUD instead of guessing further.
    if(fd.some(v=>Number.isNaN(v))){
      this.lastFrameDebug={nan:true,sun,sc,exposure:this.exposure,fogColor:scene.fogColor};
      if(!this._nanWarned){this._nanWarned=true;console.error('💥 PriomGL: NaN en los datos de frame enviados a WebGPU — esto produce pantalla negra en TODOS los píxeles.',this.lastFrameDebug);}
    } else if(this._nanWarned){this._nanWarned=false;}
    this.lastFrameSun=sun;this.lastFrameSunColor=sc;
    this.stats.drawCalls=0;this.stats.triangles=0;this.stats.visibleMeshlets=0;
    const enc=this.device.createCommandEncoder();
    // BUGFIX (black screen): `meshes`/`inst` must be collected before anything
    // reads `inst`. The GPU-culling gate below used to reference `inst` while
    // it was still declared later via `const` in this same function scope —
    // a temporal-dead-zone ReferenceError thrown on every single call to
    // render() whenever gpuCullingEnabled was anything but explicitly false
    // (i.e. any non-mobile device, or any device HardwareProfiler didn't
    // flag as mobile). Because that throw happened right after the command
    // encoder was created but before anything was ever drawn or submitted,
    // the canvas never received a frame — not even the sky pass — while the
    // engine's outer per-frame try/catch swallowed the error and kept the
    // loop alive, so the UI/HUD kept ticking normally on top of a canvas
    // that was, and would forever remain, solid black.
    const meshes=[],inst=[];scene.traverse(o=>{if(o.isInstanced&&o.visible)inst.push(o);else if(o.visible&&o.geometry)meshes.push(o);});
    this._objSlot=0;this._ensureObjCapacity(meshes.length+inst.length);
    const doCull=this.gpuCullingEnabled!==false && inst.length>0 && (this._cullFrame++%this._cullInterval===0);
    const cullPass=doCull?enc.beginComputePass():null;
    if(doCull) for(const im of inst){const g=this._geom(im.geometry);if(!g||!im.count)continue;const need=im.count*16;let packed=this._packedInstances?.get(im);if(!packed||packed.length!==need){packed=new Float32Array(need);if(!this._packedInstances)this._packedInstances=new WeakMap();this._packedInstances.set(im,packed);}packed.set(im.instanceData.subarray(0,need));const st=this._cullState(im,packed,im.count,g);this.device.queue.writeBuffer(st.params,0,new Float32Array([camera.position.x,camera.position.y,camera.position.z,0,im.userData?.apex6CullDistance||420,0,0,0]));this.device.queue.writeBuffer(st.counter,0,new Uint32Array([0]));this.device.queue.writeBuffer(st.args,0,new Uint32Array([g.count,0,0,0,0]));cullPass.setPipeline(this.cullPipeline);cullPass.setBindGroup(0,st.bg);cullPass.dispatchWorkgroups(Math.ceil(im.count/64));const finBG=this.device.createBindGroup({layout:this.cullFinalizeLayout,entries:[{binding:0,resource:{buffer:st.counter}},{binding:1,resource:{buffer:st.args}}]});cullPass.setPipeline(this.cullFinalizePipeline);cullPass.setBindGroup(0,finBG);cullPass.dispatchWorkgroups(1);}
    if(cullPass)cullPass.end();
    const view=this.context.getCurrentTexture().createView();
    const pass=enc.beginRenderPass({colorAttachments:[{view,clearValue:{r:.025,g:.035,b:.055,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    pass.setPipeline(this.skyPipeline);pass.setBindGroup(0,this.frameBG);pass.draw(3);
    for(const m of meshes)this._drawMesh(pass,m,fd.subarray(16,19));
    for(const i of inst)this._drawInstanced(pass,i,fd.subarray(16,19));
    pass.end();this.device.queue.submit([enc.finish()]);this.time+=1/60;
    const ft=performance.now()-frameStart;this._frameTimes.push(ft);if(this._frameTimes.length>48)this._frameTimes.shift();if((++this._frameCounter%48)===0)this._adaptResolution();
    // Diagnostics/self-healing: WebGPU validation errors (e.g. a mismatched
    // bind group, a stale/undersized buffer) don't throw a catchable JS
    // exception — the offending draw just silently no-ops, which used to be
    // indistinguishable from "engine is fine but the canvas stays black".
    // Surface them, and if they persist across many frames in a row, hand
    // off to the WebGL2 fallback (see PriomEngine's runtime watchdog) rather
    // than staying black forever.
    if(checkThisFrame){
      this.device.popErrorScope().then(error=>{
        if(!error){this._consecutiveGPUErrors=0;return;}
        this._consecutiveGPUErrors=(this._consecutiveGPUErrors||0)+1;
        this.lastGPUError=error;
        console.warn('⚠️ PriomGL WebGPU validation error (frame render):',error.message);
        if(this._consecutiveGPUErrors>=20 && !this.failed){
          this.failed=true;this.ready=false;
          this.failureReason='WebGPU validation errors repetidos: '+error.message;
          console.error('💥 WebGPU produce frames inválidos de forma persistente; solicitando fallback a WebGL2.');
        }
      }).catch(()=>{});
    }
  }
}
P.WebGPURenderer=WebGPURenderer;global.PriomGL=P;
})(typeof window!=='undefined'?window:globalThis);
