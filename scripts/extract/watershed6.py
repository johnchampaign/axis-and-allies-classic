import numpy as np, json, heapq
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

im = np.asarray(Image.open('vmod_extracted/images/map.png').convert('RGB')).astype(np.float64)
H,W,_ = im.shape
vb=json.load(open('data/vassal-board.json')); polys=vb['polygons']; anchors=vb['anchors']
R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]
mx=np.maximum(np.maximum(R,G),B); mn=np.minimum(np.minimum(R,G),B); sat=mx-mn
bright=(R+G+B)/3

# LAND vs SEA by colour: land is saturated, sea is pale/neutral. This boundary IS
# the coastline. Fill small interior holes (printed IPC badges, names) so they
# don't punch holes in land; keep islands (don't remove small land components).
land = (R>B+5)              # warm = land, cool/blue = sea; the coastline
land = ndi.binary_closing(land, iterations=1)
# fill holes (badges/text/border-lines enclosed by land); ocean isn't enclosed
land = ndi.binary_fill_holes(land)
land = ndi.binary_opening(land, iterations=1)
land = ndi.binary_fill_holes(land)
# Remove printed national roundels: saturated pure-red bullseyes drawn at the 5
# capitals. They are warm (R>B) so they'd be mis-read as land and bulge the coast.
red = (R>150)&(G<90)&(B<95)   # pure roundel red, not reddish-tan land
# keep only LARGE solid red blobs (the 5 capital bullseye centers), not small red
# unit pieces, then dilate to swallow the whole roundel (yellow/blue/white rings)
rl,rn=ndi.label(red)
big=np.zeros_like(red)
for i in range(1,rn+1):
    c=rl==i
    if c.sum()>120: big|=c
roundel = ndi.binary_dilation(big, iterations=46)
land = land & ~roundel
land = ndi.binary_opening(land, iterations=1)
sea = ~land
print('land%% %.1f sea%% %.1f'%(100*land.mean(),100*sea.mean()))

# drawn political/border lines (thin dark) -> ridges WITHIN a domain only
dark = bright<120
def elev_for(domain):
    d=ndi.distance_transform_edt(~(dark & domain))
    e=(d.max()-d); 
    return (e/e.max()*255).astype(np.int32)
elev_land=elev_for(land); elev_sea=elev_for(sea)

ids=list(polys.keys()); mid={t:i for i,t in enumerate(ids,1)}
is_sea=lambda t:'sea-zone' in t
def raster(t):
    img=Image.new('L',(W,H),0); dd=ImageDraw.Draw(img)
    for r in polys[t]:
        if len(r)>=3: dd.polygon([tuple(p) for p in r],fill=1)
    return np.asarray(img)>0

lab=np.zeros((H,W),np.int32); heap_l=[]; heap_s=[]
masks={}
for t in ids:
    m=raster(t)
    dom = sea if is_sea(t) else land
    m = m & dom
    if not m.any():  # affine poly missed its domain — use anchor neighbourhood in domain
        x,y=anchors[t]; x=max(0,min(W-1,int(x)));y=max(0,min(H-1,int(y)))
        bx=np.zeros((H,W),bool); bx[max(0,y-6):y+7,max(0,x-6):x+7]=True
        m=bx&dom
        if not m.any(): m=bx
    masks[t]=m
order=sorted(ids,key=lambda t:int(masks[t].sum()))
for t in order:
    m=masks[t]; a=int(m.sum()); it=min(20,max(0,int((a**0.5)/9)-2))
    core=ndi.binary_erosion(m,iterations=it) if it>0 else m.copy()
    if not core.any(): core=m.copy()
    core &= (lab==0)
    if not core.any():
        ys,xs=np.where(m&(lab==0))
        if len(ys): core=np.zeros_like(m); core[ys[0],xs[0]]=True
        else: continue
    lab[core]=mid[t]
    ev = elev_sea if is_sea(t) else elev_land
    h = heap_s if is_sea(t) else heap_l
    ys,xs=np.where(core)
    for yy,xx in zip(ys,xs): heapq.heappush(h,(int(ev[yy,xx]),int(yy),int(xx)))

def flood(heap, domain, ev):
    push=heapq.heappush; pop=heapq.heappop
    while heap:
        e,y,x=pop(heap); l=lab[y,x]
        for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0<=ny<H and 0<=nx<W and lab[ny,nx]==0 and domain[ny,nx]:
                lab[ny,nx]=l; push(heap,(int(ev[ny,nx]),ny,nx))
flood(heap_l, land, elev_land)
flood(heap_s, sea, elev_sea)
# any unclaimed domain pixels (isolated): nearest-label fill
if (lab==0).any():
    idx=ndi.distance_transform_edt(lab==0,return_distances=False,return_indices=True)
    lab=lab[tuple(idx)]
MIN=80
empties=[t for t in ids if (lab==mid[t]).sum()<MIN]
print('empties:',len(empties),empties)
np.save('scripts/extract/lab.npy',lab); json.dump({'ids':ids,'mid':mid},open('scripts/extract/meta.json','w'))
print('coverage %.1f%%'%(100*(lab>0).mean()))
