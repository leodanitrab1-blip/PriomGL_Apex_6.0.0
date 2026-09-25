/** PriomGL Apex 4.0 — Nature Studio integration layer. */
(function(global){'use strict';const P=global.PriomGL;if(!P)return;const {GeometryMerger,Primitives}=P;
const S=P.Sculpting,D=P.Dendrology,A=P.AnatomySystem;
const N={version:'4.0.0',buildTree(v=0){return D.buildTree(v,7001+v*991)},buildBush(){return D.buildBush(9127)},buildRock(){const g=S.organicSphere(.9,[1.15,.72,.95],1,1,26,18,733,.13);const o=GeometryMerger.mergeRigid([{geometry:g,color:[.30,.28,.26]}]);o.__boundsRadius=1.1;o.__boundsHeight=1.15;return o},patch(){if(P.Vegetation){P.Vegetation.buildTreeGeometryMerged=(Pr,G,v)=>N.buildTree(v);P.Vegetation.buildBushGeometryMerged=(Pr,G)=>N.buildBush();P.Vegetation.buildRockGeometryMerged=(Pr,G)=>N.buildRock()}}};
if(P.WildlifeRenderer){P.WildlifeRenderer.__ApexSpecies4=true;const W=P.WildlifeRenderer.prototype;W._buildQuadruped=function(a){return A.buildQuadruped(a)};}
N.patch();P.NatureStudio=N;P.Apex4={Sculpting:S,Dendrology:D,Anatomy:A};console.log('🌲 PriomGL Apex 4.0 Nature Studio — sculpted dendrology + anatomy active');})(typeof window!=='undefined'?window:globalThis);
