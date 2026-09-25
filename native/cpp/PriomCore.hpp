#pragma once
#include <cstdint>
extern "C" {
float priom_fbm(float x,float z,int octaves,float seed);
float priom_hash(float x,float z,float seed);
int priom_sphere_visible(float cx,float cy,float cz,float r,const float* planes,int n);
uint32_t priom_build_meshlet_groups(const uint32_t* indices,uint32_t triCount,uint32_t maxVerts,uint32_t maxTris,uint32_t* outGroups);
void priom_integrate_flock(float* pos,float* vel,const float* goal,uint32_t count,float dt,float maxSpeed);
}
