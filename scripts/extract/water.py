import numpy as np, json
from PIL import Image
from scipy import ndimage as ndi
im=np.asarray(Image.open('vmod_extracted/images/map.png').convert('RGB')).astype(float)
H,W,_=im.shape; R,G,B=im[:,:,0],im[:,:,1],im[:,:,2]; gray=im.mean(2); mn=np.minimum(np.minimum(R,G),B)
deep = (B>R+12)&(B>110)            # unambiguous blue ocean
pale = (mn>180)                    # white / near-white (shallow water OR neutral land)
watercand = deep|pale
# coastline barrier: thin dark lines
bt=ndi.grey_closing(gray,size=7)-gray; lines=bt>16
flowable = watercand & ~ndi.binary_dilation(lines,iterations=1)
# keep only watercand-components that touch deep blue => water; the rest (enclosed
# white = neutral land) are NOT water
lbl,n=ndi.label(flowable,structure=np.ones((3,3)))
deep_labels=set(np.unique(lbl[deep & (lbl>0)]))
water=np.isin(lbl,list(deep_labels))
water=ndi.binary_closing(water,iterations=1)
land=~water
print('water%% %.1f  (deep%% %.1f, pale%% %.1f)'%(100*water.mean(),100*deep.mean(),100*pale.mean()))
# visualize: water=blue tint, land=warm tint
vis=(im*0.55+90).clip(0,255).astype(np.uint8)
vis[water]=(vis[water]*0.4+np.array([0,80,255])*0.6).astype(np.uint8)
vis=Image.fromarray(vis)
vb=json.load(open('data/vassal-board.json')); A=vb['anchors']
spots={'med':(950,720,220),'baltic':(880,330,200),'ecanada_bay':(420,470,220),'neutrals_eu':(640,560,240)}
for nm,(cx,cy,r) in spots.items():
    c=vis.crop((cx-r,cy-r,cx+r,cy+r)); c=c.resize((c.width*2,c.height*2),Image.NEAREST); c.save(f'scripts/extract/wtr_{nm}.png')
vis.resize((900,int(900*H/W))).save('scripts/extract/wtr_full.png')
print('blue tint = detected water')
