import numpy as np, json, heapq
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
im=np.asarray(Image.open('vmod_extracted/images/map.png').convert('RGB')).astype(float)
H,W,_=im.shape; R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]; gray=im.mean(2); mn=np.minimum(np.minimum(R,G),B)

# ---- 1. WATER by connectivity: blue ocean fading to white at shore, walled by coast ----
bt=ndi.grey_closing(gray,size=7)-gray; lines=bt>16
deep=(B>R+12)&(B>110); pale=(mn>180)
flow=(deep|pale)&~ndi.binary_dilation(lines,iterations=1)
lbl,n=ndi.label(flow,structure=np.ones((3,3)))
water=np.isin(lbl,list(set(np.unique(lbl[deep&(lbl>0)]))))
water=ndi.binary_closing(water,iterations=1); water=ndi.binary_fill_holes(water)&~ndi.binary_fill_holes(~water^water)
water=np.isin(lbl,list(set(np.unique(lbl[deep&(lbl>0)]))))  # recompute clean
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
empties=[t for t in ids if (labm==mid[t]).sum()<80]
print('water%% %.1f  empties %d %s'%(100*water.mean(),len(empties),empties[:12]))
np.save('scripts/extract/lab.npy',labm); json.dump({'ids':ids,'mid':mid},open('scripts/extract/meta.json','w'))
