# Post-vectorize: merge extracted polygons into data/vassal-board.json, keep the
# authoritative stack anchors, but snap any anchor that falls outside its new
# (more accurate) polygon to a strictly-interior point. Coordinates only; no art.
# Run after watershed5.py + vectorize.py.
import json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
vb=json.load(open('data/vassal-board.json')); poly=json.load(open('scripts/extract/polygons.json'))
W,H=vb['width'],vb['height']
lab=np.load('scripts/extract/lab.npy'); mid=json.load(open('scripts/extract/meta.json'))['mid']
def inside(pt,rings):
    x,y=pt; c=False
    for r in rings:
        n=len(r)
        for i in range(n):
            x1,y1=r[i]; x2,y2=r[(i+1)%n]
            if ((y1>y)!=(y2>y)) and (x<(x2-x1)*(y-y1)/(y2-y1+1e-9)+x1): c=not c
    return c
def interior(t,rings):
    # deepest point of the eroded watershed basin, guaranteed inside the polygon
    for it in (3,2,1,0):
        m=ndi.binary_erosion(lab==mid[t],iterations=it) if it else (lab==mid[t])
        if not m.any(): continue
        dt=ndi.distance_transform_edt(m); y,x=np.unravel_index(int(dt.argmax()),dt.shape)
        for dy in (0,-2,-4,-6,-8):
            if inside([int(x),int(y+dy)],rings): return [int(x),int(y+dy)]
    return vb['anchors'][t]
fixed=0
for t,a in list(vb['anchors'].items()):
    rings=poly.get(t,[])
    if rings and not inside(a,rings): vb['anchors'][t]=interior(t,rings); fixed+=1
vb['polygons']=poly
vb['_provenance']=('polygons extracted from the VASSAL map raster: scripts/build-vassal-board.mjs lays '
 'down affine-warped TripleA shapes, then scripts/extract/watershed5.py runs an eroded-core '
 'marker-controlled watershed over the drawn border/coast lines and vectorize.py traces+simplifies '
 'the basins; finalize.py merges them here. Anchors are the module setup-stack coords (exactAnchors) '
 'or affine centers, snapped inside if the new polygon excluded them. Coordinates only, no art. '
 'Regenerate: node scripts/build-vassal-board.mjs; python scripts/extract/watershed5.py vectorize.py finalize.py')
out=[t for t,a in vb['anchors'].items() if poly.get(t) and not inside(a,poly[t])]
print(f'anchors snapped inside: {fixed}; remaining outside: {len(out)} {out}')
json.dump(vb,open('data/vassal-board.json','w'),separators=(',',':'))
print('territories=',len(poly),'rings=',sum(len(r) for r in poly.values()))
