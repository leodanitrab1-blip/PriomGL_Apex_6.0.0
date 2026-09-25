/* PriomGL Apex 5 — HyperSphere Correlation Processor
 * Browser-native adaptation of the supplied LSH + HNSW processor.
 * Purpose: semantic locality for material variants, Trinity memory and
 * procedural asset selection. It never pretends to be a hardware CPU.
 */
(function(global){'use strict'; const P=global.PriomGL=global.PriomGL||{};
function norm(v){let s=0;for(let i=0;i<v.length;i++)s+=v[i]*v[i];s=Math.sqrt(s)||1;const o=new Float32Array(v.length);for(let i=0;i<v.length;i++)o[i]=v[i]/s;return o;}
function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
class HyperSphereCorrelation{
 constructor(dim=16,opts={}){this.dim=dim;this.bits=opts.bits||8;this.tablesN=opts.tables||4;this.probes=opts.probes||3;this.rngSeed=opts.seed||1337;this.vectors=new Map();this.tables=Array.from({length:this.tablesN},()=>new Map());this.planes=[];let s=this.rngSeed>>>0;const r=()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296};for(let t=0;t<this.tablesN;t++){const p=[];for(let b=0;b<this.bits;b++){const q=new Float32Array(dim);for(let i=0;i<dim;i++)q[i]=(r()*2-1);p.push(q)}this.planes.push(p)}}
 _hash(v,t){let c=0;for(let b=0;b<this.bits;b++)if(dot(v,this.planes[t][b])>=0)c|=(1<<b);return c;}
 insert(id,v){const x=norm(v);this.vectors.set(id,x);for(let t=0;t<this.tablesN;t++){const h=this._hash(x,t),m=this.tables[t];let a=m.get(h);if(!a)m.set(h,a=[]);if(!a.includes(id))a.push(id)}return id;}
 query(v,k=6){if(!this.vectors.size)return[];const x=norm(v),cand=new Set();for(let t=0;t<this.tablesN;t++){const h=this._hash(x,t);for(const id of this.tables[t].get(h)||[])cand.add(id);for(let b=0;b<this.probes;b++)for(const id of this.tables[t].get(h^(1<<b))||[])cand.add(id)}if(cand.size<k)for(const id of this.vectors.keys())cand.add(id);const out=[];for(const id of cand)out.push([id,dot(x,this.vectors.get(id))]);out.sort((a,b)=>b[1]-a[1]);return out.slice(0,k);}
 size(){return this.vectors.size;}
}
class HNSWLite{constructor(dim=16,M=8){this.dim=dim;this.M=M;this.vectors=new Map();this.links=new Map();}
 insert(id,v){const x=norm(v);this.vectors.set(id,x);const scored=[];for(const [k,q] of this.vectors){if(k===id)continue;scored.push([k,dot(x,q)])}scored.sort((a,b)=>b[1]-a[1]);this.links.set(id,new Set(scored.slice(0,this.M).map(x=>x[0])));for(const [k] of scored.slice(0,this.M)){if(!this.links.has(k))this.links.set(k,new Set());this.links.get(k).add(id);while(this.links.get(k).size>this.M){let worst=null,ws=2;for(const n of this.links.get(k)){const s=dot(this.vectors.get(k),this.vectors.get(n));if(s<ws){ws=s;worst=n}}if(worst===null)break;this.links.get(k).delete(worst)}}}
 query(v,k=6,ef=24){if(!this.vectors.size)return[];const x=norm(v),seen=new Set(),pool=[];let start=this.vectors.keys().next().value;pool.push([start,dot(x,this.vectors.get(start))]);while(pool.length<ef){let best=null;for(const [id,s] of pool)if(!seen.has(id)&&(!best||s>best[1]))best=[id,s];if(!best)break;seen.add(best[0]);for(const n of this.links.get(best[0])||[]){if(seen.has(n))continue;pool.push([n,dot(x,this.vectors.get(n))])}}for(const [id,s] of pool)if(!seen.has(id)){}pool.sort((a,b)=>b[1]-a[1]);return pool.slice(0,k)}
}
P.HyperSphereCorrelation=HyperSphereCorrelation;P.HNSWLite=HNSWLite;
})(typeof window!=='undefined'?window:globalThis);
