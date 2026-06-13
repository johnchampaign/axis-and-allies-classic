import numpy as np, json, heapq
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
im=np.asarray(Image.open('vmod_extracted/images/map.png').convert('RGB')).astype(float)
H,W,_=im.shape; R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]; gray=im.mean(2); mn=np.minimum(np.minimum(R,G),B)

# ---- 1. WATER by connectivity: blue ocean fading to white at shore, walled by coast ----
bt=ndi.grey_closing(gray,size=7)-gray
lines=bt>16            # walls for splitting territories / sea zones
coastlines=bt>12       # more sensitive: seal the coast against the water flood
deep=(B>R+12)&(B>110); pale=(mn>180)
# cool/neutral water: the Mediterranean (and similar enclosed seas) is a muted
# grey-blue that fails deep AND pale, but it is never WARM like land — so anything
# non-warm and reasonably bright is a water candidate. Connectivity + the coast
# barrier still keep it from leaking into land.
cool=(B>=R-2)&(mn>115)
# barrier for the water flood is WARM LAND, not the tophat lines: open water is full
# of grid lines/labels/texture that the tophat fires on, which fragmented enclosed
# seas (the Mediterranean) and stopped them connecting to the ocean. Warm land
# (R>B) is the true shore; cool/neutral water flows freely up to it.
warmland=(R>B+8)
flow=(deep|pale|cool)&~ndi.binary_dilation(warmland,iterations=2)
lbl,n=ndi.label(flow,structure=np.ones((3,3)))
water=np.isin(lbl,list(set(np.unique(lbl[deep&(lbl>0)]))))
# remove thin coast-gap tendrils that leak white-water into white/pale land (keep
# wide bays via opening+regrow), then re-anchor to the deep ocean component
w2=ndi.binary_dilation(ndi.binary_opening(water,iterations=3),iterations=3)&water
lbl2,_=ndi.label(w2,structure=np.ones((3,3)))
water=np.isin(lbl2,list(set(np.unique(lbl2[deep&(lbl2>0)]))))
# absorb printed labels floating in the ocean (e.g. 'North Atlantic'): thin dark
# marks reachable from water become water, so the sea zone fills straight through
sat=(np.maximum(np.maximum(R,G),B))-mn
darktext=(~water)&(sat<28)&(gray<155)
for _ in range(8):
    grow=darktext & ndi.binary_dilation(water,iterations=1) & ~water
    if not grow.any(): break
    water=water|grow
land=~water
# explicit decoration rectangles (compass rose, title cartouche): large open-ocean
# art at fixed spots that colour/connectivity can't classify; force water + erase
# lines so the surrounding sea zone runs straight through (verified: no land here)
for (x0,y0,x1,y1) in [(1213,1197,1500,1520),(232,1374,820,1622)]:
    water[y0:y1,x0:x1]=True
    lines[y0:y1,x0:x1]=False; coastlines[y0:y1,x0:x1]=False
land=~water

# ---- 2. OWNER-COLOUR classification on land; colour change = a wall ----
PAL={'us':(98,142,56),'uk':(190,170,110),'germany':(185,185,150),
     'japan':(214,188,35),'ussr':(170,110,45),'neutral':(228,224,205)}
names=list(PAL); cents=np.array([PAL[k] for k in names])
flat=im.reshape(-1,3)
d=((flat[:,None,:]-cents[None,:,:])**2).sum(2)
owner=d.argmin(1).reshape(H,W)
owner=ndi.median_filter(owner,size=5)               # de-noise terrain texture
owner_edge = (owner!=np.roll(owner,1,0))|(owner!=np.roll(owner,1,1))
wall = lines & land   # black lines split same-owner neighbours; colour-edge walls over-fragment

# ---- 3. seeds: eroded affine-core ∩ domain, small-first ----
vb=json.load(open('data/vassal-board.json')); polys=vb['polygons']; anchors=vb['anchors']
ids=list(polys.keys()); mid={t:i for i,t in enumerate(ids,1)}; is_sea=lambda t:'sea-zone' in t
def raster(t):
    img=Image.new('L',(W,H),0); dd=ImageDraw.Draw(img)
    for r in polys[t]:
        if len(r)>=3: dd.polygon([tuple(p) for p in r],fill=1)
    return np.asarray(img)>0
masks={}
for t in ids:
    m=raster(t)&(water if is_sea(t) else land)
    if not m.any():
        x,y=anchors[t]; x=max(0,min(W-1,int(x)));y=max(0,min(H-1,int(y)))
        bx=np.zeros((H,W),bool); bx[max(0,y-6):y+7,max(0,x-6):x+7]=True
        dom=water if is_sea(t) else land; m=bx&dom
        if not m.any(): m=bx
    masks[t]=m
labm=np.zeros((H,W),np.int32); seedcore={}
for t in sorted(ids,key=lambda t:int(masks[t].sum())):
    m=masks[t]; a=int(m.sum()); it=min(20,max(0,int((a**0.5)/9)-2))
    core=ndi.binary_erosion(m,iterations=it) if it>0 else m.copy()
    if not core.any(): core=m.copy()
    core&=(labm==0)
    if not core.any():
        ys,xs=np.where(m&(labm==0))
        if len(ys): core=np.zeros_like(m); core[ys[0],xs[0]]=True
        else: continue
    labm[core]=mid[t]; seedcore[t]=core

# ---- prune seedless isolated land blobs = decorations (compass, overflow-box
# island duplicates, title): real territories all have a seed; blobs with none are
# decoration -> convert to water so the surrounding sea fills straight through ----
seedunion=np.zeros((H,W),bool)
for _c in seedcore.values(): seedunion|=_c
landcomp,_ncl=ndi.label(land,structure=np.ones((3,3)))
has_seed=set(int(v) for v in np.unique(landcomp[seedunion]))-{0}
deco=land & ~np.isin(landcomp,list(has_seed)) & (labm==0)
if deco.any():
    water=water|deco; land=~water
    # rebuild sea structures below will use the updated water mask
    print('seedless decoration land blobs -> water:',int(deco.sum()))

# ---- 4. LAND watershed over wall-distance elevation, restricted to land ----
ev=ndi.distance_transform_edt(~wall); ev=((ev.max()-ev)/max(1,ev.max())*255).astype(np.int32)
def flood(dom):
    h=[]
    for t in ids:
        if (is_sea(t) and dom is land) or ((not is_sea(t)) and dom is water): continue
        if t in seedcore:
            ys,xs=np.where(seedcore[t])
            for yy,xx in zip(ys,xs): heapq.heappush(h,(int(ev[yy,xx]),int(yy),int(xx)))
    while h:
        e,y,x=heapq.heappop(h); l=labm[y,x]
        for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0<=ny<H and 0<=nx<W and dom[ny,nx] and labm[ny,nx]==0:
                labm[ny,nx]=l; heapq.heappush(h,(int(ev[ny,nx]),ny,nx))
flood(land)
# ---- 5. SEA: hard cells by grid lines, assign to seed / adjacent zone ----
seawall=ndi.binary_dilation(lines&water,iterations=1)
cells,nc=ndi.label(water&~seawall,structure=np.ones((3,3)))
sea_labels=set(mid[t] for t in ids if is_sea(t)); seedless=[]
for c in range(1,nc+1):
    cm=cells==c; sl=[int(s) for s in np.unique(labm[cm&(labm>0)]) if int(s) in sea_labels]
    if len(sl)==1: labm[cm]=sl[0]
    elif len(sl)==0: seedless.append(c)
    else:
        evs=ndi.distance_transform_edt(~lines).astype(np.int32); evs=(evs.max()-evs); h=[]
        for s in sl:
            ys,xs=np.where((labm==s)&cm)
            for yy,xx in zip(ys,xs): heapq.heappush(h,(int(evs[yy,xx]),int(yy),int(xx)))
        while h:
            e,y,x=heapq.heappop(h); l=labm[y,x]
            for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if 0<=ny<H and 0<=nx<W and cm[ny,nx] and labm[ny,nx]==0: labm[ny,nx]=l; heapq.heappush(h,(int(evs[ny,nx]),ny,nx))
changed=True
while seedless and changed:
    changed=False; still=[]
    for c in seedless:
        cm=cells==c; ring=ndi.binary_dilation(cm,iterations=2)&~cm
        ne=labm[ring&(labm>0)]; ne=ne[np.isin(ne,list(sea_labels))]
        if ne.size: v,ct=np.unique(ne,return_counts=True); labm[cm]=int(v[ct.argmax()]); changed=True
        else: still.append(c)
    seedless=still
# domain-aware fill
for dom in (water,land):
    gap=(labm==0)&dom
    if gap.any():
        src=labm.copy(); src[~dom]=0
        idx=ndi.distance_transform_edt(src==0,return_distances=False,return_indices=True); f=src[tuple(idx)]; labm[gap]=f[gap]
if (labm==0).any():
    idx=ndi.distance_transform_edt(labm==0,return_distances=False,return_indices=True); labm=labm[tuple(idx)]
# ---- drop orphan components (overflow boxes, title cartouche, compass, over-grown
# blobs): a territory's pixels NOT connected to its seed are decoration/error.
# Real islands keep their seed component; decorations have no seed -> reassigned to
# the surrounding label (the sea zone), so boundary lines run straight through. ----
struct=np.ones((3,3)); clear=np.zeros((H,W),bool)
for t in ids:
    if t not in seedcore: continue
    m=labm==mid[t]
    comps,ncomp=ndi.label(m,structure=struct)
    if ncomp<=1: continue
    keep=set(int(v) for v in np.unique(comps[seedcore[t]]))-{0}
    if not keep:
        sizes=ndi.sum(np.ones_like(comps),comps,index=range(1,ncomp+1)); keep={int(np.argmax(sizes))+1}
    for c in range(1,ncomp+1):
        if c not in keep: clear|=(comps==c)
if clear.any():
    labm[clear]=0
    idx=ndi.distance_transform_edt(labm==0,return_distances=False,return_indices=True)
    nn=labm[tuple(idx)]; labm[clear]=nn[clear]
    print('orphan decoration/overgrowth pixels reassigned:',int(clear.sum()))

# ---- void the square token-overflow boxes (UL/UR/LR margins): they duplicate
# island art and were being claimed by neighbouring territories (e.g. East Canada
# grew into the UL boxes). Set to 0 = no territory; the UI paints them ocean-blue. ----
DECO_BOXES=[[0,0,676,184],[1320,0,2816,179],[2345,1268,2816,1623]]
for (x0,y0,x1,y1) in DECO_BOXES: labm[y0:y1,x0:x1]=0

empties=[t for t in ids if (labm==mid[t]).sum()<80]
print('water%% %.1f  empties %d %s'%(100*water.mean(),len(empties),empties[:12]))
np.save('scripts/extract/lab.npy',labm)
json.dump({'ids':ids,'mid':mid,'decoBoxes':DECO_BOXES},open('scripts/extract/meta.json','w'))
