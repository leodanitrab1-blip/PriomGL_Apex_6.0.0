#!/usr/bin/env python3
"""PriomGL Apex asset pipeline.
Scans GLB files, extracts lightweight structural metadata, and emits an engine manifest.
No external runtime dependency; optional meshoptimizer integration is intentionally not required.
"""
from __future__ import annotations
import argparse, json, pathlib, struct

def inspect_glb(path):
    b=path.read_bytes()
    out={"file":str(path),"bytes":len(b),"triangles":0,"meshes":0,"nodes":0,"accessors":0}
    if b[:4]!=b"glTF": return out
    off=12
    while off+8<=len(b):
        n,typ=struct.unpack_from("<II",b,off); chunk=b[off+8:off+8+n]; off+=8+n
        if typ==0x4E4F534A:
            doc=json.loads(chunk.decode("utf-8").rstrip("\0 "))
            out["meshes"]=len(doc.get("meshes",[]));out["nodes"]=len(doc.get("nodes",[]));out["accessors"]=len(doc.get("accessors",[]))
            for mesh in doc.get("meshes",[]):
                for p in mesh.get("primitives",[]):
                    a=p.get("attributes",{}); ind=p.get("indices")
                    if ind is not None and ind<len(doc.get("accessors",[])):
                        acc=doc["accessors"][ind];out["triangles"]+=acc.get("count",0)//3
            break
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument("root",type=pathlib.Path);ap.add_argument("-o","--output",default="data/apex_assets.json");a=ap.parse_args()
    assets=[inspect_glb(p) for p in sorted(a.root.rglob("*.glb"))]
    manifest={"version":2,"pipeline":"PriomGL Apex","virtualGeometry":{"maxMeshletVertices":64,"maxMeshletTriangles":126,"lodRatios":[1,.45,.18]},"assets":assets}
    pathlib.Path(a.output).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(a.output).write_text(json.dumps(manifest,indent=2),encoding="utf8")
    print(f"indexed {len(assets)} GLB assets -> {a.output}")
if __name__=="__main__": main()
