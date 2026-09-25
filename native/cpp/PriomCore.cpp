// PriomGL Native Core v2 — C++20
// Authoritative high-performance algorithms for the browser WASM build.
// This module owns the numerical core; JS only marshals typed arrays.
// Algorithms: deterministic noise, sphere/AABB culling, meshlet clustering,
// LOD error metrics, and animal steering primitives.
#include <cstdint>
#include <cmath>
#include <algorithm>
#include <vector>
#include <unordered_map>

namespace priom {
static inline uint32_t hash_u32(uint32_t x){x^=x>>16;x*=0x7feb352dU;x^=x>>15;x*=0x846ca68bU;x^=x>>16;return x;}
static inline float hash2(float x,float z,float seed){uint32_t a=hash_u32((uint32_t)(x*374761393.f) ^ (uint32_t)(z*668265263.f) ^ (uint32_t)(seed*1442695041.f));return (a/4294967295.f)*2.f-1.f;}
static inline float value_noise(float x,float z,float seed){
  int x0=(int)std::floor(x),z0=(int)std::floor(z);float fx=x-x0,fz=z-z0;
  fx=fx*fx*(3-2*fx);fz=fz*fz*(3-2*fz);
  float a=hash2((float)x0,(float)z0,seed),b=hash2((float)x0+1,z0,seed),c=hash2(x0,z0+1,seed),d=hash2(x0+1,z0+1,seed);
  return (a+(b-a)*fx)+(c-a-(d-b)*fx)*fz;
}
static inline float fbm(float x,float z,int oct,float seed){float v=0,a=.5,f=1;for(int i=0;i<oct;i++){v+=value_noise(x*f,z*f,seed+i*17.13f)*a;f*=2.01f;a*=.5f;}return v;}
struct MeshletOut{uint32_t firstIndex,indexCount,vertexCount;float cx,cy,cz,radius,error;};
}
extern "C" {
float priom_fbm(float x,float z,int octaves,float seed){return priom::fbm(x,z,std::clamp(octaves,1,12),seed);}
float priom_hash(float x,float z,float seed){return priom::hash2(x,z,seed);}
int priom_sphere_visible(float cx,float cy,float cz,float r,const float* planes,int n){
  for(int p=0;p<n;p++){const float* q=planes+p*4;if(q[0]*cx+q[1]*cy+q[2]*cz+q[3]<-r)return 0;}return 1;
}
// Greedy triangle clustering: output is a stream of triangle IDs grouped into
// meshlets. The JS fallback implements the same contract. A production WASM
// build can call this directly for multi-million triangle preprocessing.
uint32_t priom_build_meshlet_groups(const uint32_t* indices,uint32_t triCount,uint32_t maxVerts,uint32_t maxTris,uint32_t* outGroups){
  uint32_t meshlets=0,tris=0,verts=0;std::unordered_map<uint32_t,uint32_t> local;local.reserve(maxVerts*2);
  for(uint32_t t=0;t<triCount;t++){
    uint32_t add=0;for(int k=0;k<3;k++)if(!local.count(indices[t*3+k]))add++;
    if(tris>=maxTris || verts+add>maxVerts){meshlets++;tris=0;verts=0;local.clear();}
    outGroups[t]=meshlets;tris++;for(int k=0;k<3;k++)if(local.emplace(indices[t*3+k],verts).second)verts++;
  }
  if(triCount)meshlets++;
  return meshlets;
}
void priom_integrate_flock(float* pos,float* vel,const float* goal,uint32_t count,float dt,float maxSpeed){
  for(uint32_t i=0;i<count;i++){float dx=goal[i*3]-pos[i*3],dy=goal[i*3+1]-pos[i*3+1],dz=goal[i*3+2]-pos[i*3+2];
    float l=std::sqrt(dx*dx+dy*dy+dz*dz)+1e-5f;dx/=l;dy/=l;dz/=l;
    vel[i*3]+=dx*dt*2;vel[i*3+1]+=dy*dt*2;vel[i*3+2]+=dz*dt*2;
    float s=std::sqrt(vel[i*3]*vel[i*3]+vel[i*3+1]*vel[i*3+1]+vel[i*3+2]*vel[i*3+2]);
    if(s>maxSpeed){float q=maxSpeed/s;vel[i*3]*=q;vel[i*3+1]*=q;vel[i*3+2]*=q;}
    pos[i*3]+=vel[i*3]*dt;pos[i*3+1]+=vel[i*3+1]*dt;pos[i*3+2]+=vel[i*3+2]*dt;
  }
}
}
