# Final board: warp the EXACT TripleA polygons (board-geometry.json) onto the VASSAL
# map with a single global affine (the two are the same map up to scale). Affine is
# fit robustly on the cleanly-extracted territory centroids; "outliers" are the
# previously-broken extractions, which the affine then places correctly. No colour
# extraction, no manual alignment, no distortion. Keeps decoBoxes; anchors keep the
# authoritative stack coord when it lands inside the new polygon, else warped centre.
import json, numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw
geo=json.load(open('data/board-geometry.json'))['territories']
vb=json.load(open('data/vassal-board.json')); vp=vb['polygons']; va=vb['anchors']
W,H=vb['width'],vb['height']
def largest(rings): return max(rings,key=lambda r:abs(sum(r[i][0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*r[i][1] for i in range(len(r)))))
def cent(r):
    A=cx=cy=0
    for i in range(len(r)):
        x1,y1=r[i];x2,y2=r[(i+1)%len(r)];cr=x1*y2-x2*y1;A+=cr;cx+=(x1+x2)*cr;cy+=(y1+y2)*cr
    if abs(A)<1: return [float(np.mean([p[0] for p in r])),float(np.mean([p[1] for p in r]))]
    A*=0.5;return [cx/(6*A),cy/(6*A)]
land=[t for t in geo if 'sea-zone' not in t and t in vp and vp[t]]
S=np.array([cent(largest(geo[t]['polygons'])) for t in land]); D=np.array([cent(largest(vp[t])) for t in land])
keep=np.ones(len(land),bool)
for _ in range(4):
    X=np.c_[S[keep],np.ones(keep.sum())]
    Mx=np.linalg.lstsq(X,D[keep,0],rcond=None)[0]; My=np.linalg.lstsq(X,D[keep,1],rcond=None)[0]
    err=np.hypot(np.c_[S,np.ones(len(S))]@Mx-D[:,0], np.c_[S,np.ones(len(S))]@My-D[:,1]); keep=err<max(25,np.quantile(err[keep],0.85))
print(f'affine fit on {keep.sum()} inliers: median {np.median(err[keep]):.0f}px max {err[keep].max():.0f}px')
def aff(p): x,y=p; return [int(round(Mx[0]*x+Mx[1]*y+Mx[2])),int(round(My[0]*x+My[1]*y+My[2]))]
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
    if not m.any(): return list(rings[0][0])
    dt=ndi.distance_transform_edt(m); y,x=np.unravel_index(int(dt.argmax()),dt.shape); return [int(x),int(y)]
polys={}; anchors={}
for t,g in geo.items():
    rings=[[aff(p) for p in r] for r in g['polygons'] if len(r)>=3]
    rings=[r for r in rings if len(r)>=3]; polys[t]=rings
    cur=va.get(t)
    if cur and rings and inside(cur,rings): anchors[t]=cur          # keep authoritative stack coord
    else:
        wc=aff(g['center'])
        anchors[t]=wc if (rings and inside(wc,rings)) else (pole(rings) if rings else (cur or wc))
json.dump({'_provenance':'exact TripleA polygons (board-geometry.json) warped onto the VASSAL map by a single global affine fit on cleanly-extracted centroids (scripts/extract/bake-affine.py). Same map up to scale; no colour extraction, no distortion. Coordinates only.',
 'width':W,'height':H,'anchors':anchors,'polygons':polys,'exactAnchors':[],'decoBoxes':vb.get('decoBoxes',[])},
 open('data/vassal-board.json','w'),separators=(',',':'))
print('wrote',len(polys),'territories,',sum(len(r) for r in polys.values()),'rings')
