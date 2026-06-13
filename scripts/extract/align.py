# Bake the ?dev=align correspondence into data/vassal-board.json: fit a thin-plate
# spline from TripleA centres -> the VASSAL positions you dragged, then warp EVERY
# exact TripleA polygon (data/board-geometry.json) onto the VASSAL map. Replaces
# the colour-extraction with exact, tessellated shapes. Anchors = warped centre,
# snapped inside. Keeps decoBoxes. Run: python scripts/extract/align.py
# (reads the pasted correspondence from scripts/extract/align_points.json)
import json, numpy as np
from scipy.interpolate import RBFInterpolator
from scipy import ndimage as ndi
from PIL import Image, ImageDraw
geo=json.load(open('data/board-geometry.json'))['territories']
vb=json.load(open('data/vassal-board.json'))
W,H=vb['width'],vb['height']
pts=json.load(open('scripts/extract/align_points.json'))   # {tid:[x,y],...}
ctrl=[t for t in pts if t in geo]
src=np.array([geo[t]['center'] for t in ctrl],float)
dst=np.array([pts[t] for t in ctrl],float)
f=RBFInterpolator(src,dst,kernel='thin_plate_spline',smoothing=0)
res=np.hypot(*(f(src)-dst).T); print(f'fit on {len(ctrl)} control points, residual max {res.max():.0f}px')
def warp(poly): return [[int(round(x)),int(round(y))] for x,y in f(np.array(poly,float))]
def inside(p,rings):
    x,y=p;c=False
    for r in rings:
        n=len(r)
        for i in range(n):
            x1,y1=r[i];x2,y2=r[(i+1)%n]
            if ((y1>y)!=(y2>y)) and (x<(x2-x1)*(y-y1)/(y2-y1+1e-9)+x1): c=not c
    return c
def pole(rings):
    rings=sorted(rings,key=lambda r:-abs(sum(r[i][0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*r[i][1] for i in range(len(r)))))
    img=Image.new('L',(W,H),0); ImageDraw.Draw(img).polygon([tuple(p) for p in rings[0]],fill=1)
    m=np.asarray(img)>0
    if not m.any(): return rings[0][0]
    dt=ndi.distance_transform_edt(m); y,x=np.unravel_index(int(dt.argmax()),dt.shape); return [int(x),int(y)]
polys={}; anchors={}
for t,g in geo.items():
    rings=[warp(r) for r in g['polygons'] if len(r)>=3]
    rings=[r for r in rings if len(r)>=3]
    polys[t]=rings
    a=warp([g['center']])[0]
    anchors[t]=a if (rings and inside(a,rings)) else (pole(rings) if rings else a)
out={'_provenance':'exact TripleA polygons (board-geometry.json) warped onto the VASSAL map via a thin-plate spline fit on hand-aligned control points (?dev=align -> scripts/extract/align_points.json, baked by align.py). Coordinates only.',
     'width':W,'height':H,'anchors':anchors,'polygons':polys,
     'exactAnchors':[],'decoBoxes':vb.get('decoBoxes',[])}
json.dump(out,open('data/vassal-board.json','w'),separators=(',',':'))
print('wrote',len(polys),'territories')
