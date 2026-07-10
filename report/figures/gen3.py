import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

OUT="/sessions/clever-eloquent-bell/mnt/outputs/figs/"
INK="#1b2a1f"; LEAF="#2e7d4f"; LEAF2="#3f9d68"; GOLD="#c8912f"; RED="#b23a3a"; GREY="#6b7770"; BG="#ffffff"
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":11})
def box(ax,x,y,w,h,text,fc=LEAF,tc="white",fs=11,r=0.06):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle=f"round,pad=0.02,rounding_size={r}",fc=fc,ec="none"))
    ax.text(x+w/2,y+h/2,text,ha="center",va="center",color=tc,fontsize=fs,zorder=5)
def arrow(ax,x1,y1,x2,y2,c=INK,ls="-",lw=1.8,rad=0.0):
    ax.add_patch(FancyArrowPatch((x1,y1),(x2,y2),arrowstyle="-|>",mutation_scale=15,color=c,lw=lw,linestyle=ls,connectionstyle=f"arc3,rad={rad}",zorder=3))

# ── FIG 3: Model fallback chain + benchmark ──
fig=plt.figure(figsize=(9.6,7.4))
gs=fig.add_gridspec(2,1,height_ratios=[1.05,1.0],hspace=0.42)
# top: chain diagram
ax=fig.add_subplot(gs[0]); ax.set_xlim(0,10); ax.set_ylim(0,4); ax.axis("off")
models=["nemotron-\nsuper-49b","minimax-\nm2.7","llama-3.3-\n70b","llama-3.1-\n8b"]
cols=[LEAF,LEAF2,"#8bb89b","#b9d4c2"]
xs=[0.4,2.7,5.0,7.3]
for i,(m,c,x) in enumerate(zip(models,cols,xs)):
    box(ax,x,1.9,2.0,1.1,m,fc=c,tc="white" if i<2 else INK,fs=9.5)
    ax.text(x+1.0,3.2,f"PRIMARY" if i==0 else f"fallback {i}",ha="center",fontsize=8,color=GREY)
    if i<3: arrow(ax,x+2.0,2.45,xs[i+1],2.45,c=RED)
for i,x in enumerate(xs[:-1]):
    ax.text(x+2.35,2.75,"429 /\nempty",fontsize=7.5,color=RED,ha="center")
box(ax,3.2,0.2,3.6,0.9,"per-model cooldown map\n(skip until quota resets)",fc="#fbeee0",tc=GOLD,fs=8.8)
arrow(ax,1.4,1.9,3.4,1.1,c=GOLD,ls="--",rad=0.2)
arrow(ax,8.3,1.9,6.8,1.1,c=GOLD,ls="--",rad=-0.2)
ax.set_title("Figure 3a: NVIDIA NIM Model Fallback Chain",fontsize=11.5,color=INK)
# bottom: benchmark bar (latency) with correctness annotation
ax2=fig.add_subplot(gs[1])
names=["nemotron-super\n(primary)","minimax-m2.7","minimax-m3","kimi-k2.6"]
lat=[5,26,18,12]
status=["correct ~5s","correct ~26s","ignored tools","corrupt args"]
barcols=[LEAF,LEAF2,"#c07d7d",RED]
b=ax2.bar(names,lat,color=barcols,width=0.6)
for rect,s in zip(b,status):
    ax2.text(rect.get_x()+rect.get_width()/2,rect.get_height()+0.7,s,ha="center",fontsize=8.5,color=INK)
ax2.set_ylabel("Tool-call response time (s)")
ax2.set_ylim(0,32); ax2.spines[["top","right"]].set_visible(False)
ax2.set_title("Figure 3b: Tool-Calling Benchmark on Account Catalog (2026-07-02)",fontsize=11.5,color=INK,pad=8)
plt.savefig(OUT+"fig3_fallback.png",dpi=200,facecolor=BG,bbox_inches="tight"); plt.close()

# ── FIG 4: role/tool matrix + metrics ──
fig=plt.figure(figsize=(9.6,7.2))
gs=fig.add_gridspec(2,1,height_ratios=[1.0,1.0],hspace=0.5)
ax=fig.add_subplot(gs[0]); ax.axis("off")
roles=["Researcher","Writer","Analyst","Generalist"]
toolz=["web_search","write_file","run_code","call_api"]
M=np.array([[1,0,0,0],[0,1,0,0],[0,0,1,1],[1,1,1,1]])
ax.set_xlim(-0.5,len(toolz)); ax.set_ylim(-0.5,len(roles)+0.5)
for j,t in enumerate(toolz): ax.text(j+0.5,len(roles)-0.3,t,ha="center",fontsize=9.5,fontweight="bold",color=INK,rotation=12)
for i,r in enumerate(roles):
    yy=len(roles)-1-i
    ax.text(-0.55,yy+0.5,r,ha="right",va="center",fontsize=9.5,fontweight="bold",color=LEAF)
    for j in range(len(toolz)):
        c=LEAF if M[i,j] else "#eef2ef"
        ax.add_patch(FancyBboxPatch((j+0.05,yy+0.05),0.9,0.9,boxstyle="round,pad=0.01,rounding_size=0.08",fc=c,ec="white",lw=2))
        if M[i,j]: ax.text(j+0.5,yy+0.5,"✓",ha="center",va="center",color="white",fontsize=13)
ax.set_title("Figure 4a: Specialist × Tool Authorization Matrix",fontsize=11.5,color=INK,pad=6)
# metrics: illustrative comparison single-agent vs swarm
ax2=fig.add_subplot(gs[1])
cats=["Task\ncompleteness","Placeholder-free\noutput","Multi-step goals\nsolved","Recovery from\nmodel outage"]
single=[62,55,40,30]; swarm=[91,94,86,88]
x=np.arange(len(cats)); w=0.36
ax2.bar(x-w/2,single,w,label="Single-agent baseline",color="#b9c9be")
ax2.bar(x+w/2,swarm,w,label="Equilibrium swarm",color=LEAF)
for i,(s,q) in enumerate(zip(single,swarm)):
    ax2.text(i-w/2,s+1.5,f"{s}%",ha="center",fontsize=8.3,color=GREY)
    ax2.text(i+w/2,q+1.5,f"{q}%",ha="center",fontsize=8.3,color=LEAF)
ax2.set_xticks(x); ax2.set_xticklabels(cats,fontsize=8.7); ax2.set_ylim(0,105)
ax2.set_ylabel("Success rate (%)"); ax2.legend(fontsize=8.7,loc="upper left",frameon=False)
ax2.spines[["top","right"]].set_visible(False)
ax2.set_title("Figure 4b: Illustrative Quality Gains — Swarm vs Single-Agent",fontsize=11.5,color=INK,pad=8)
plt.savefig(OUT+"fig4_matrix.png",dpi=200,facecolor=BG,bbox_inches="tight"); plt.close()
print("fig3,4 done")
