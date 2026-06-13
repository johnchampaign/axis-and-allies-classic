import numpy as np, json, heapq
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

im=np.asarray(Image.open('vmod_extracted/images/map.png').convert('RGB')).astype(float)
H,W,_=im.shape
vb=json.load(open('data/vassal-board.json')); polys=vb['polygons']; anchors=vb['anchors']
R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]; gray=im.mean(2)

# land/sea by hue (warm=land=coast), remove printed roundels
land=(R>B+5); land=ndi.binary_closing(land,iterations=1); land=ndi.binary_fill_holes(land)
land=ndi.binary_opening(land,iterations=1); land=ndi.binary_fill_holes(land)
red=(R>150)&(G<90)&(B<95); rl,rn=ndi.label(red); big=np.zeros_like(red)
for i in range(1,rn+1):
    c=rl==i
    if c.sum()>120: big|=c
land=land & ~ndi.binary_dilation(big,iterations=46); land=ndi.binary_opening(land,iterations=1)
sea=~land

# THIN drawn lines via black-tophat (catches faint sea-grid lines absolute thresh misses)
bt=ndi.grey_closing(gray,size=7)-gray
lines=bt>16
ids=list(polys.keys()); mid={t:i for i,t in enumerate(ids,1)}
is_sea=lambda t:'sea-zone' in t
def raster(t):
    img=Image.new('L',(W,H),0); dd=ImageDraw.Draw(img)
    for r in polys[t]:
        if len(r)>=3: dd.polygon([tuple(p) for p in r],fill=1)
    return np.asarray(img)>0

# seeds: eroded affine core ∩ domain, small-first
masks={}
for t in ids:
    m=raster(t)&(sea if is_sea(t) else land)
    if not m.any():
        x,y=anchors[t]; x=max(0,min(W-1,int(x)));y=max(0,min(H-1,int(y)))
        bx=np.zeros((H,W),bool); bx[max(0,y-6):y+7,max(0,x-6):x+7]=True; m=bx&(sea if is_sea(t) else land)
        if not m.any(): m=bx
    masks[t]=m
lab=np.zeros((H,W),np.int32)
order=sorted(ids,key=lambda t:int(masks[t].sum()))
seedcore={}
for t in order:
    m=masks[t]; a=int(m.sum()); it=min(20,max(0,int((a**0.5)/9)-2))
    core=ndi.binary_erosion(m,iterations=it) if it>0 else m.copy()
    if not core.any(): core=m.copy()
    core&=(lab==0)
    if not core.any():
        ys,xs=np.where(m&(lab==0))
        if len(ys): core=np.zeros_like(m); core[ys[0],xs[0]]=True
        else: continue
    lab[core]=mid[t]; seedcore[t]=core

# ---- SEA: hard cells bounded by drawn lines; each cell -> its seed ----
seawall=ndi.binary_dilation(lines & sea, iterations=1)
cells,nc=ndi.label(sea & ~seawall, structure=np.ones((3,3)))
inv={v:k for k,v in mid.items()}
sea_labels=set(mid[t] for t in ids if is_sea(t))
seedless=[]
for c in range(1,nc+1):
    cm=cells==c
    seedlabs=np.unique(lab[cm & (lab>0)])
    seedlabs=[int(s) for s in seedlabs if int(s) in sea_labels]
    if len(seedlabs)==1:
        lab[cm]=seedlabs[0]
    elif len(seedlabs)==0:
        seedless.append(c)
    else:
        sub=cm; ev=ndi.distance_transform_edt(~lines).astype(np.int32); ev=(ev.max()-ev)
        h=[]
        for s in seedlabs:
            ys,xs=np.where((lab==s)&sub)
            for yy,xx in zip(ys,xs): heapq.heappush(h,(int(ev[yy,xx]),int(yy),int(xx)))
        while h:
            e,y,x=heapq.heappop(h); l=lab[y,x]
            for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if 0<=ny<H and 0<=nx<W and sub[ny,nx] and lab[ny,nx]==0:
                    lab[ny,nx]=l; heapq.heappush(h,(int(ev[ny,nx]),ny,nx))
# seedless sea cells (coastal water strips cut off from their zone's seed): assign
# each to the ADJACENT sea zone it shares the most border with, iterating so cells
# touching only other seedless cells resolve once their neighbour resolves.
changed=True
while seedless and changed:
    changed=False; still=[]
    for c in seedless:
        cm=cells==c
        ring=ndi.binary_dilation(cm,iterations=2)&~cm
        neigh=lab[ring & (lab>0)]
        neigh=neigh[np.isin(neigh,list(sea_labels))]
        if neigh.size:
            vals,cnts=np.unique(neigh,return_counts=True)
            lab[cm]=int(vals[cnts.argmax()]); changed=True
        else: still.append(c)
    seedless=still

# ---- LAND: domain-restricted Meyer watershed over drawn-line elevation ----
ev_l=ndi.distance_transform_edt(~(lines & land)); ev_l=((ev_l.max()-ev_l)/max(1,ev_l.max())*255).astype(np.int32)
h=[]
for t in ids:
    if is_sea(t): continue
    if t in seedcore:
        ys,xs=np.where(seedcore[t])
        for yy,xx in zip(ys,xs): heapq.heappush(h,(int(ev_l[yy,xx]),int(yy),int(xx)))
while h:
    e,y,x=heapq.heappop(h); l=lab[y,x]
    for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
        if 0<=ny<H and 0<=nx<W and land[ny,nx] and lab[ny,nx]==0:
            lab[ny,nx]=l; heapq.heappush(h,(int(ev_l[ny,nx]),ny,nx))

# fill remaining unclaimed pixels by nearest SAME-DOMAIN label
for dom in (sea, land):
    gap=(lab==0)&dom
    if gap.any():
        src=lab.copy(); src[~dom]=0
        idx=ndi.distance_transform_edt(src==0,return_distances=False,return_indices=True)
        filled=src[tuple(idx)]; lab[gap]=filled[gap]
if (lab==0).any():
    idx=ndi.distance_transform_edt(lab==0,return_distances=False,return_indices=True); lab=lab[tuple(idx)]
MIN=80
empties=[t for t in ids if (lab==mid[t]).sum()<MIN]
print('empties:',len(empties),empties)
np.save('scripts/extract/lab.npy',lab); json.dump({'ids':ids,'mid':mid},open('scripts/extract/meta.json','w'))
print('coverage %.1f%%'%(100*(lab>0).mean()))
