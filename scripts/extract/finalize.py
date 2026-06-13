# Post-vectorize: merge extracted polygons into data/vassal-board.json. For any
# territory the extraction left empty (tiny islands the watershed couldn't carve),
# fall back to its affine polygon (still in vassal-board.json at this point, since
# watershed6/vectorize write only to scripts/extract/). Keep the authoritative
# stack anchors but snap any anchor the new polygon excludes to a strict interior.
import json, numpy as np
from scipy import ndimage as ndi
vb=json.load(open('data/vassal-board.json')); affine=vb['polygons']
extracted=json.load(open('scripts/extract/polygons.json'))
W,H=vb['width'],vb['height']
_meta=json.load(open('scripts/extract/meta.json')); mid=_meta['mid']
lab=np.load('scripts/extract/lab.npy')
poly={}; fellback=[]
for t in affine:
    r=extracted.get(t) or []
    if r: poly[t]=r
    else: poly[t]=affine[t]; fellback.append(t)
def inside(pt,rings):
    x,y=pt; c=False
    for r in rings:
        n=len(r)
        for i in range(n):
            x1,y1=r[i]; x2,y2=r[(i+1)%n]
            if ((y1>y)!=(y2>y)) and (x<(x2-x1)*(y-y1)/(y2-y1+1e-9)+x1): c=not c
    return c
def interior(t,rings):
    if t in mid:
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
vb['decoBoxes']=_meta.get('decoBoxes',[])  # token-overflow boxes to paint over in UI
vb['_provenance']=('polygons extracted from the VASSAL map raster: build-vassal-board.mjs lays affine-warped '
 'TripleA shapes as seeds; watershed7.py classifies land/sea by hue (warm=land, the coastline), removes the '
 'printed national roundels, and runs an eroded-core marker-controlled watershed RESTRICTED to each land/sea '
 'domain (so boundaries cannot cross a coast) over the drawn border lines; vectorize.py traces+simplifies; '
 'finalize.py merges (tiny territories fall back to the affine polygon). Coords only, no art. '
 'Regenerate: node scripts/build-vassal-board.mjs; python scripts/extract/watershed7.py vectorize.py finalize.py')
out=[t for t,a in vb['anchors'].items() if poly.get(t) and not inside(a,poly[t])]
print(f'fellback(affine): {len(fellback)} {fellback}; anchors snapped: {fixed}; outside: {len(out)} {out}')
json.dump(vb,open('data/vassal-board.json','w'),separators=(',',':'))
print('territories=',len(poly),'rings=',sum(len(r) for r in poly.values()))
