(function(global){'use strict';const P=global.PriomGL=global.PriomGL||{};
function load(url){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Texture failed: '+url));i.src=url})}
class TextureMaterialSystem{
 constructor(engine){this.engine=engine;this.loaded=0;this.total=0;this.cache=new Map();}
 async _tex(gl,url){if(this.cache.has(url))return this.cache.get(url);const img=await load(url);const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);this.cache.set(url,tex);return tex}
 async apply(){const r=this.engine.renderer;if(!r||!r.gl)return false;const gl=r.gl;const root='assets/materials/';const fam=['bark','leaf','fur','rock','soil','grass','water'];this.total=fam.length*3;for(const f of fam){const m={};for(const kind of ['albedo','normal','roughness']){try{m[kind]=await this._tex(gl,root+f+'_'+kind+'.png');this.loaded++}catch(e){console.warn(e)}}this[f]=m}
 const assign=(mat,f)=>{if(!mat||!this[f])return;mat.albedoMap=this[f].albedo||mat.albedoMap;mat.normalMap=this[f].normal||mat.normalMap;mat.roughnessMap=this[f].roughness||mat.roughnessMap;if(mat.albedo&&mat.albedoMap)mat.albedo.set(1,1,1)};
 this.engine.scene?.traverse(o=>{if(!o.material)return;const f=o.material.textureFamily||((o.material.shader==='water')?'water':null);if(f)assign(o.material,f)});
 // Existing forests/instances are created before this pass; traverse catches all of them.
 r._apex5TextureSystem=this;return true;}
 applyMaterial(mat,f){if(this[f]){mat.albedoMap=this[f].albedo;mat.normalMap=this[f].normal;mat.roughnessMap=this[f].roughness;if(mat.albedo)mat.albedo.set(1,1,1);}}
}
P.TextureMaterialSystem=TextureMaterialSystem;
})(typeof window!=='undefined'?window:globalThis);
