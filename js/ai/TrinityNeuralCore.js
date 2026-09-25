/**
 * PriomGL Trinity Neural Core v1
 * Real in-browser neural networks: dense MLP + gated recurrent state + online SGD.
 * No external ML runtime. Deterministic initialization keeps builds reproducible.
 */
(function(global){
  'use strict';

  class DenseNet {
    constructor(name, sizes, seed=1, opts={}){
      this.name=name; this.sizes=sizes.slice(); this.seed=seed|0;
      this.lr=opts.lr ?? 0.0025; this.decay=opts.decay ?? 0.0002;
      this.clip=opts.clip ?? 1.0; this.step=0;
      this.W=[]; this.b=[];
      let s=this.seed>>>0;
      const rnd=()=>{ s=(Math.imul(1664525,s)+1013904223)>>>0; return s/4294967296; };
      for(let l=0;l<sizes.length-1;l++){
        const fanIn=sizes[l], fanOut=sizes[l+1], scale=Math.sqrt(6/(fanIn+fanOut));
        const w=new Float32Array(fanIn*fanOut), b=new Float32Array(fanOut);
        for(let i=0;i<w.length;i++) w[i]=(rnd()*2-1)*scale;
        this.W.push(w); this.b.push(b);
      }
      this.state=new Float32Array(sizes[sizes.length-1]);
      this.lastLoss=0;
    }
    _act(x, final){ return final ? x : Math.tanh(x); }
    forward(input){
      let a=Float32Array.from(input);
      for(let l=0;l<this.W.length;l++){
        const ni=this.sizes[l], no=this.sizes[l+1], w=this.W[l], b=this.b[l];
        const out=new Float32Array(no);
        for(let j=0;j<no;j++){
          let z=b[j]; for(let i=0;i<ni;i++) z += a[i]*w[i*no+j];
          out[j]=this._act(z,l===this.W.length-1);
        }
        a=out;
      }
      return a;
    }
    recurrent(input, leak=0.86){
      const y=this.forward(input);
      for(let i=0;i<this.state.length;i++) this.state[i]=this.state[i]*leak+y[i]*(1-leak);
      return this.state;
    }
    train(input,target){
      // One-step backpropagation through the dense stack. This is intentionally
      // small enough for frame-budgeted online learning.
      const acts=[Float32Array.from(input)];
      for(let l=0;l<this.W.length;l++){
        const ni=this.sizes[l], no=this.sizes[l+1], w=this.W[l], b=this.b[l], prev=acts[l], out=new Float32Array(no);
        for(let j=0;j<no;j++){ let z=b[j]; for(let i=0;i<ni;i++) z+=prev[i]*w[i*no+j]; out[j]=this._act(z,l===this.W.length-1); }
        acts.push(out);
      }
      const delta=new Array(this.W.length);
      const out=acts.at(-1); let loss=0;
      delta[delta.length-1]=new Float32Array(out.length);
      for(let j=0;j<out.length;j++){ const e=out[j]-(target[j]??0); loss+=e*e; delta.at(-1)[j]=Math.max(-this.clip,Math.min(this.clip,e)); }
      for(let l=this.W.length-2;l>=0;l--){
        const no=this.sizes[l+1], nn=this.sizes[l+2], d=new Float32Array(no);
        for(let j=0;j<no;j++){ let v=0; for(let k=0;k<nn;k++) v+=this.W[l+1][j*nn+k]*delta[l+1][k]; const a=acts[l+1][j]; d[j]=v*(1-a*a); }
        delta[l]=d;
      }
      for(let l=0;l<this.W.length;l++){
        const ni=this.sizes[l], no=this.sizes[l+1], prev=acts[l], d=delta[l], w=this.W[l], b=this.b[l];
        for(let j=0;j<no;j++){
          b[j]-=this.lr*d[j];
          for(let i=0;i<ni;i++) w[i*no+j]-=this.lr*(d[j]*prev[i]+this.decay*w[i*no+j]);
        }
      }
      this.step++; this.lastLoss=loss/out.length; return this.lastLoss;
    }
  }

  class TrinityNeuralCore {
    constructor(engine){
      this.engine=engine; this.t=0; this.trainingBudget=0.0;
      // Three distinct brains, each with a different role but a shared low-dimensional
      // telemetry bus. These are actual trainable neural nets, not rule labels.
      this.world=new DenseNet('World', [18,64,64,32,10], 0x51A7, {lr:.0018});
      this.optimizer=new DenseNet('Optimizer', [16,56,40,20,8], 0xA91C, {lr:.0022});
      this.meta=new DenseNet('Meta', [22,80,64,32,10], 0xC0DE, {lr:.0012});
      this.outputs={world:new Float32Array(8),optimizer:new Float32Array(6),meta:new Float32Array(8)};
      this.correlationMemory=null; this.memoryTick=0;
    }
    _norm(x,a,b){ return Math.max(-1,Math.min(1,(x-a)/(b-a)*2-1)); }
    tick(dt){
      const e=this.engine, w=e.worldAI, o=e.optimizerAI, m=e.metaAI, s=e.renderer?.stats||{};
      const fps=this._norm(1000/Math.max(1,(e._lastFrameMs||16.7)),20,100);
      const day=this._norm(w?.dayTime??12,0,24), weather=(w?.weatherIntensity??0);
      const load=this._norm(o?.getLoadPressure?.()??0,0,1);
      const quality=this._norm(o?.quality??1,.1,1.2);
      const entities=this._norm(w?.animals?.length??0,0,300);
      const wind=this._norm(e.scene?.windStrength??0,0,1);
      const rain=w?.weather==='lluvia'||w?.weather==='tormenta'?1:-1;
      const base18=new Float32Array([fps,day,weather,load,quality,entities,wind,rain,
        Math.sin(this.t),Math.cos(this.t),Math.sin(this.t*.17),Math.cos(this.t*.17),
        this._norm(s.drawCalls??0,0,5000),this._norm(s.triangles??0,0,2e6),
        this._norm(e.camera?.position?.y??0,-10,200),this._norm(e.camera?.position?.x??0,-500,500),
        this._norm(e.camera?.position?.z??0,-500,500),this.memorySimilarity||0]);
      this.outputs.world=this.world.recurrent(base18);
      const oin=Float32Array.from(base18.slice(0,16)); this.outputs.optimizer=this.optimizer.recurrent(oin);
      const min=new Float32Array(22); min.set(base18); min[18]=this.outputs.world[0]; min[19]=this.outputs.world[1]; min[20]=this.outputs.optimizer[0]; min[21]=this.outputs.optimizer[1];
      this.outputs.meta=this.meta.recurrent(min);
      // Apex 5: the supplied hyper-spherical correlation processor becomes a
      // genuine episodic memory. Similar world states are retrieved by cosine
      // locality rather than by exact timestamps.
      const CP=global.PriomGL?.HyperSphereCorrelation;
      if(!this.correlationMemory && CP) this.correlationMemory=new CP(18,{bits:9,tables:5,probes:4,seed:0x77AA});
      if(this.correlationMemory){
        this.memoryTick++; const emb=Float32Array.from(base18);
        if((this.memoryTick&7)===0) this.correlationMemory.insert(this.memoryTick,emb);
        const nearest=this.correlationMemory.query(emb,4);
        this.memorySimilarity=nearest.length?nearest[0][1]:0;
      }
      // Frame-budgeted self-supervision: learn toward stable FPS, coherent world activity,
      // and lower render pressure. At most a few updates per second.
      this.trainingBudget+=dt;
      if(this.trainingBudget>.08){
        this.trainingBudget=0;
        const wt=new Float32Array(8); wt[0]=0.5+0.5*fps; wt[1]=Math.max(0,1-load); wt[2]=weather; wt[3]=quality; wt[4]=entities; wt[5]=wind; wt[6]=day; wt[7]=1;
        this.world.train(base18,wt);
        const ot=new Float32Array(6); ot[0]=fps; ot[1]=1-load; ot[2]=quality; ot[3]=Math.max(0,1-load); ot[4]=this.outputs.world[0]; ot[5]=this.outputs.world[1]; this.optimizer.train(oin,ot);
        const mt=new Float32Array(8); mt[0]=fps; mt[1]=quality; mt[2]=load; mt[3]=this.outputs.world[0]; mt[4]=this.outputs.optimizer[0]; mt[5]=day; mt[6]=weather; mt[7]=1; this.meta.train(min,mt);
      }
      this.t+=dt;
      // Very small influence: neural outputs advise existing Trinity controllers rather
      // than replacing deterministic safety limits.
      if(o && Number.isFinite(this.outputs.optimizer[0])){
        const pressure=Math.max(0,Math.min(1,(this.outputs.optimizer[0]+1)*.5));
        o.neuralPressure=pressure;
      }
      if(m) m.neuralConfidence=Math.max(.1,Math.min(1,(this.outputs.meta[0]+1)*.5));
    }
    diagnostics(){ return {steps:this.world.step+this.optimizer.step+this.meta.step, worldLoss:this.world.lastLoss, optimizerLoss:this.optimizer.lastLoss, metaLoss:this.meta.lastLoss, memory:this.correlationMemory?.size()||0, memorySimilarity:this.memorySimilarity||0}; }
  }
  global.PriomGL=global.PriomGL||{}; global.PriomGL.TrinityNeuralCore=TrinityNeuralCore; global.PriomGL.DenseNet=DenseNet;
})(typeof window!=='undefined'?window:globalThis);
