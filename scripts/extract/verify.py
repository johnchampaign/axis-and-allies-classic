# Whole-map self-verification: replicate the ArtBoard hit-test for every territory
# and flag any that don't resolve to themselves. The board renders hit-paths
# sea-zones-first then land, topmost wins; a point hits the LAST territory (in that
# order) whose polygon contains it. For each territory we test its anchor + a grid
# of interior points; if a land/island point resolves to a different territory (the
# island-under-sea bug) or any anchor is wrong, it's reported.
import json, numpy as np
vb=json.load(open('data/vassal-board.json')); P=vb['polygons']; A=vb['anchors']; BOX=vb['decoBoxes']
W,H=vb['width'],vb['height']
is_sea=lambda t:'sea-zone' in t
order=sorted(P.keys(), key=lambda t:(0 if is_sea(t) else 1))  # sea first, land last (on top)

def inrings(pt,rings):
    x,y=pt; c=False
    for r in rings:
        n=len(r)
        for i in range(n):
            x1,y1=r[i]; x2,y2=r[(i+1)%n]
            if ((y1>y)!=(y2>y)) and (x<(x2-x1)*(y-y1)/(y2-y1+1e-9)+x1): c=not c
    return c

# precompute bbox per territory for speed
bbox={t:(min(p[0] for r in P[t] for p in r), min(p[1] for r in P[t] for p in r),
         max(p[0] for r in P[t] for p in r), max(p[1] for r in P[t] for p in r)) for t in P if P[t]}
def hit(pt):
    win=None
    for t in order:
        if t not in bbox: continue
        bx=bbox[t]
        if not (bx[0]<=pt[0]<=bx[2] and bx[1]<=pt[1]<=bx[3]): continue
        if inrings(pt,P[t]): win=t   # later in order overrides
    return win

def interior_points(t,k=12):
    # sample points inside the territory's largest ring via bbox rejection
    rings=P[t]; pts=[tuple(A[t])]
    bx=bbox[t]; rng=np.random.default_rng(hash(t)%2**32)
    tries=0
    while len(pts)<k and tries<400:
        tries+=1
        x=int(rng.uniform(bx[0],bx[2])); y=int(rng.uniform(bx[1],bx[3]))
        if inrings((x,y),rings): pts.append((x,y))
    return pts

bad_anchor=[]; bad_hover=[]
for t in P:
    if not P[t]: continue
    # anchor must hit its own territory
    if hit(tuple(A[t]))!=t: bad_anchor.append((t,hit(tuple(A[t]))))
    # majority of interior points should resolve to t
    pts=interior_points(t); wins=[hit(p) for p in pts]
    selfrate=sum(1 for w in wins if w==t)/len(wins)
    if selfrate<0.6:
        from collections import Counter
        steal=Counter(w for w in wins if w!=t).most_common(1)
        bad_hover.append((t,round(selfrate,2),steal[0][0] if steal else None))

print(f'territories: {len(P)}')
print(f'ANCHOR resolves to wrong territory: {len(bad_anchor)}')
for t,w in bad_anchor: print(f'   {t} -> {w}')
print(f'HOVER mostly steals to another territory (<60% self): {len(bad_hover)}')
for t,rate,steal in sorted(bad_hover,key=lambda x:x[1]): print(f'   {t:26s} self={rate} stolen-by={steal}')
