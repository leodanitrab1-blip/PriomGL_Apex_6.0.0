/**
 * PriomGL Atmosphere — deterministic multi-scale climate field.
 * Produces temperature, humidity, pressure, wind and precipitation fields from
 * a compact simulation state. Designed to feed terrain, wildlife and materials.
 */
(function(global){
'use strict';
class ClimateEngine{
 constructor(seed=1337){this.seed=seed;this.time=0;this.season=0;this.state={temperature:18,humidity:.55,pressure:1013,wind:[1,0,.35],precipitation:0,visibility:1};}
 _n(x,z,s){let v=Math.sin(x*12.9898+z*78.233+s*37.719)*43758.5453;return v-Math.floor(v);}
 sample(x,z,alt=0){
  const macro=this._n(x*.002,z*.002,this.seed),micro=this._n(x*.03,z*.03,this.seed+9);
  const seasonal=Math.sin(this.season*Math.PI*2), temp=18+seasonal*11-alt*.006+(macro-.5)*8;
  const humidity=Math.max(0,Math.min(1,.55-seasonal*.18+(micro-.5)*.25));
  const pressure=1013+(macro-.5)*18;
  const rain=Math.max(0,humidity-.58)*2.8;
  const windA=this._n(x*.004,z*.004,this.seed+21)*Math.PI*2;
  return {temperature:temp,humidity,pressure,wind:[Math.cos(windA),0,Math.sin(windA)],precipitation:rain,visibility:Math.max(.12,1-rain*.22)};
 }
 update(dt,world){
  this.time+=dt;this.season=(this.time/120)%1;
  const f=this.sample(0,0,0);this.state=f;
  if(world){world.climateField=f; if(world.weather==='lluvia'||world.weather==='tormenta')world.weatherIntensity=Math.max(world.weatherIntensity||1,f.precipitation+.4);}
  return f;
 }
}
global.PriomGL=global.PriomGL||{};global.PriomGL.ClimateEngine=ClimateEngine;
})(typeof window!=='undefined'?window:globalThis);
