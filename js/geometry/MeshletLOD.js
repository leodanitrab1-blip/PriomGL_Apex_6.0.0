/**
 * PriomGL Nanite Web* — meshlet partitioning, bounds, and automatic LOD.
 * A browser-native approximation inspired by mesh-shader-era virtualized geometry.
 * No Three/Babylon dependency.
 */
(function(global){
'use strict';
class Meshlet {
  constructor(){ this.vertices=[]; this.triangles=[]; this.center=[0,0,0]; this.radius=0; this.error=0; }
}
function bounds(pos, ids){
  let c=[0,0,0]; for(const i of ids){c[0]+=pos[i*3];c[1]+=pos[i*3+1];c[2]+=pos[i*3+2];}
  const n=Math.max(1,ids.length); c=c.map(v=>v/n); let r=0; for(const i of ids){const dx=pos[i*3]-c[0],dy=pos[i*3+1]-c[1],dz=pos[i*3+2]-c[2];r=Math.max(r,Math.hypot(dx,dy,dz));}
  return {center:c,radius:r};
}
class MeshletLOD {
  constructor(options={}){
    this.maxVerts=options.maxVerts||64; this.maxTris=options.maxTris||126;
    this.levels=[]; this.stats={sourceTriangles:0,meshlets:0,levels:0};
  }
  build(geometry){
    const pos=geometry?.attributes?.position?.data, idx=geometry?.indices;
    if(!pos||!idx) return this;
    const tris=idx.length/3; this.stats.sourceTriangles=tris;
    const buildLevel=(indices)=>{
      const out=[]; let m=new Meshlet(), local=new Map();
      const flush=()=>{if(!m.triangles.length)return; const b=bounds(pos,m.vertices);m.center=b.center;m.radius=b.radius;m.error=1/Math.max(1,m.triangles.length);out.push(m);m=new Meshlet();local=new Map();};
      for(let t=0;t<indices.length;t+=3){
        const tri=[indices[t],indices[t+1],indices[t+2]]; let add=0; for(const v of tri)if(!local.has(v))add++;
        if(m.triangles.length/3>=this.maxTris||local.size+add>this.maxVerts)flush();
        const li=[]; for(const v of tri){let q=local.get(v);if(q===undefined){q=m.vertices.length;local.set(v,q);m.vertices.push(v);}li.push(q);} m.triangles.push(...li);
      } flush(); return out;
    };
    // LOD0 preserves all triangles. Higher levels use deterministic vertex-grid clustering
    // (fast, stable, and safe for arbitrary topology) before meshlet partitioning.
    const levels=[idx];
    if(tris>1000000){
      // Million-triangle path: avoid allocating spatial maps for every vertex.
      // Deterministic triangle decimation is bounded-memory and produces a useful
      // coarse representation while the full-resolution stream remains intact.
      const decimate=(keep)=>{
        const out=[]; const stride=Math.max(1,Math.round(1/keep));
        for(let t=0;t<tris;t+=stride){out.push(idx[t*3],idx[t*3+1],idx[t*3+2]);}
        return new Uint32Array(out);
      };
      levels.push(decimate(.45)); levels.push(decimate(.18));
    }
    const makeSimplified=(ratio)=>{
      // Spatial vertex clustering. Cell size is derived from the geometry extent and
      // requested triangle-density target, so the reduction scales from tiny props to
      // 10M+ polygon assets without a magic world-space constant.
      let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<pos.length;i+=3){for(let a=0;a<3;a++){min[a]=Math.min(min[a],pos[i+a]);max[a]=Math.max(max[a],pos[i+a]);}}
      const extent=Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2],1e-4);
      const targetCells=Math.max(8,Math.cbrt(pos.length/3/Math.max(ratio,.02)));
      const cell=extent/targetCells, map=new Map(), out=[];
      for(let i=0;i<idx.length;i+=3){
        const tri=[]; for(let k=0;k<3;k++){const v=idx[i+k],x=pos[v*3],y=pos[v*3+1],z=pos[v*3+2];
          const key=`${Math.floor((x-min[0])/cell)}:${Math.floor((y-min[1])/cell)}:${Math.floor((z-min[2])/cell)}`;
          let nv=map.get(key);if(nv===undefined){nv=v;map.set(key,v);}tri.push(nv);}
        if(tri[0]!==tri[1]&&tri[1]!==tri[2]&&tri[2]!==tri[0])out.push(...tri);
      }
      return new Uint32Array(out);
    };
    if(tris<=1000000){levels.push(makeSimplified(.5)); levels.push(makeSimplified(.22));}
    this.levels=levels.map((x,i)=>({indices:x,meshlets:buildLevel(x),screenError:i===0?0:(i===1?.015:.045)}));
    this.stats.meshlets=this.levels.reduce((n,l)=>n+l.meshlets.length,0);this.stats.levels=this.levels.length;return this;
  }
  async buildAsync(geometry){
    await new Promise(r=>setTimeout(r,0));
    return this.build(geometry);
  }
  select(distance,radius=1,viewportHeight=1080){
    const s=radius*viewportHeight/Math.max(distance,.001);
    return s>70?0:s>24?1:2;
  }
}
global.PriomGL=global.PriomGL||{};global.PriomGL.MeshletLOD=MeshletLOD;
})(typeof window!=='undefined'?window:globalThis);
