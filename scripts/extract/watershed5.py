import numpy as np, json, heapq
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

im = np.asarray(Image.open('vmod_extracted/images/map.png').convert('RGB')).astype(np.float64)
H,W,_ = im.shape
vb=json.load(open('data/vassal-board.json')); polys=vb['polygons']; anchors=vb['anchors']
R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]
bright=(R+G+B)/3
dark = bright<120
dist = ndi.distance_transform_edt(~dark)
elev=(dist.max()-dist); elev=(elev/elev.max()*255).astype(np.int32)

ids=list(polys.keys()); mid={t:i for i,t in enumerate(ids,1)}
def raster(t):
    img=Image.new('L',(W,H),0); d=ImageDraw.Draw(img)
    for r in polys[t]:
        if len(r)>=3: d.polygon([tuple(p) for p in r],fill=1)
    return np.asarray(img)>0

lab=np.zeros((H,W),np.int32); heap=[]
masks={}
for t in ids:
    m=raster(t)
    if not m.any():
        x,y=anchors[t]; m=np.zeros((H,W),bool); m[max(0,int(y)-3):int(y)+4,max(0,int(x)-3):int(x)+4]=True
    masks[t]=m
# seed SMALL territories first so islands/small seas claim pixels before big cores
order=sorted(ids,key=lambda t:int(masks[t].sum()))
for t in order:
    m=masks[t]; a=int(m.sum())
    it=min(22,max(0,int((a**0.5)/8)-2))
    core=ndi.binary_erosion(m,iterations=it) if it>0 else m.copy()
    if not core.any(): core=m.copy()
    core &= (lab==0)
    if not core.any():
        ys,xs=np.where(m & (lab==0))
        if len(ys): core=np.zeros_like(m); core[ys[0],xs[0]]=True
        else: continue
    lab[core]=mid[t]
    ys,xs=np.where(core)
    for yy,xx in zip(ys,xs): heapq.heappush(heap,(int(elev[yy,xx]),int(yy),int(xx)))
push=heapq.heappush; pop=heapq.heappop
while heap:
    e,y,x=pop(heap); l=lab[y,x]
    if y>0 and lab[y-1,x]==0: lab[y-1,x]=l; push(heap,(int(elev[y-1,x]),y-1,x))
    if y<H-1 and lab[y+1,x]==0: lab[y+1,x]=l; push(heap,(int(elev[y+1,x]),y+1,x))
    if x>0 and lab[y,x-1]==0: lab[y,x-1]=l; push(heap,(int(elev[y,x-1]),y,x-1))
    if x<W-1 and lab[y,x+1]==0: lab[y,x+1]=l; push(heap,(int(elev[y,x+1]),y,x+1))
MIN=80
empties=[t for t in ids if (lab==mid[t]).sum()<MIN]
print('empties:',len(empties), empties)
np.save('scripts/extract/lab.npy',lab); json.dump({'ids':ids,'mid':mid},open('scripts/extract/meta.json','w'))
rng=np.random.default_rng(7); pal=rng.integers(60,255,size=(len(ids)+1,3)); pal[0]=[0,0,0]
over=pal[lab.clip(0)].astype(np.uint8); blend=(im*0.45+over*0.55).astype(np.uint8)
Image.fromarray(blend).save('scripts/extract/overlay.png')
print('coverage %.1f%%'%(100*(lab>0).mean()))
