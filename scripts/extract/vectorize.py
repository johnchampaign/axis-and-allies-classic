import numpy as np, json
from scipy import ndimage as ndi

lab = np.load('scripts/extract/lab.npy')
meta = json.load(open('scripts/extract/meta.json'))
ids = meta['ids']; mid = meta['mid']
H,W = lab.shape

# Moore-neighbor boundary tracing (8-conn) with Jacob's stopping criterion.
# neighbors clockwise starting from west of current entry.
N8 = [(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1),(0,-1),(-1,-1)]  # (dy,dx) clockwise from N
def trace(mask):
    ys,xs = np.where(mask)
    if len(ys)==0: return None
    sy,sx = int(ys[0]),int(xs[0])  # top-most, then left-most foreground
    start=(sy,sx)
    # initial backtrack came from the left (outside)
    b=(sy,sx-1)
    contour=[start]
    cur=start; prev=b
    def nbr(c,p):
        # index of p relative to c in N8
        d=(p[0]-c[0],p[1]-c[1])
        return N8.index(d)
    safety=0; maxs=mask.sum()*8+100
    while True:
        safety+=1
        if safety>maxs: break
        k=nbr(cur,prev)
        found=None
        for j in range(1,9):
            idx=(k+j)%8
            ny,nx=cur[0]+N8[idx][0], cur[1]+N8[idx][1]
            if 0<=ny<mask.shape[0] and 0<=nx<mask.shape[1] and mask[ny,nx]:
                found=(ny,nx); prevcand=(cur[0]+N8[(idx-1)%8][0],cur[1]+N8[(idx-1)%8][1])
                break
        if found is None: break
        prev=prevcand
        cur=found
        if cur==start and len(contour)>2: break
        contour.append(cur)
        if len(contour)>3 and contour[-1]==contour[1] and contour[0]==start: 
            contour.pop(); break
    return contour  # list of (y,x)

def rdp(pts, eps):
    if len(pts)<3: return pts
    a=np.array(pts[0]); b=np.array(pts[-1])
    ab=b-a; L=np.hypot(*ab)
    if L==0:
        d=[np.hypot(*(np.array(p)-a)) for p in pts]
    else:
        d=[abs(np.cross(ab,np.array(p)-a))/L for p in pts]
    i=int(np.argmax(d))
    if d[i]>eps:
        l=rdp(pts[:i+1],eps); r=rdp(pts[i:],eps)
        return l[:-1]+r
    return [pts[0],pts[-1]]

EPS=3.0
MIN_AREA=60
out={}
total_rings=0
for t in ids:
    i=mid[t]
    mask = lab==i
    if not mask.any(): out[t]=[]; continue
    comps,nc = ndi.label(mask, structure=np.ones((3,3)))
    rings=[]
    for c in range(1,nc+1):
        cm = comps==c
        a=int(cm.sum())
        if a<MIN_AREA: continue
        cont=trace(cm)
        if not cont or len(cont)<4: continue
        simp=rdp(cont,EPS)
        if len(simp)<4: continue
        # (y,x)->[x,y], round
        ring=[[int(x),int(y)] for (y,x) in simp]
        rings.append((a,ring))
    rings.sort(key=lambda r:-r[0])
    # keep the main body + only rings >=8% of it (drop tiny coastal-water slivers)
    if rings:
        big=rings[0][0]
        rings=[r for r in rings if r[0]>=max(MIN_AREA, 0.08*big)]
    out[t]=[r for _,r in rings]
    total_rings+=len(out[t])

print('territories with polygons:', sum(1 for t in out if out[t]), '/', len(ids))
print('total rings:', total_rings)
empties=[t for t in ids if not out[t]]
if empties: print('EMPTY:', empties)
json.dump(out, open('scripts/extract/polygons.json','w'))
print('saved polygons.json')
