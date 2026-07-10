import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

OUT = "/sessions/clever-eloquent-bell/mnt/outputs/figs/"
INK = "#1b2a1f"; LEAF="#2e7d4f"; LEAF2="#3f9d68"; GOLD="#c8912f"; RED="#b23a3a"
LIGHT="#eaf3ec"; GREY="#6b7770"; BG="#ffffff"
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":11})

def box(ax,x,y,w,h,text,fc=LEAF,tc="white",fs=11,r=0.06,ec="none",lw=0):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle=f"round,pad=0.02,rounding_size={r}",
        fc=fc,ec=ec,lw=lw,mutation_aspect=1))
    ax.text(x+w/2,y+h/2,text,ha="center",va="center",color=tc,fontsize=fs,zorder=5,wrap=True)

def arrow(ax,x1,y1,x2,y2,c=INK,ls="-",lw=1.8,rad=0.0):
    ax.add_patch(FancyArrowPatch((x1,y1),(x2,y2),arrowstyle="-|>",mutation_scale=16,
        color=c,lw=lw,linestyle=ls,connectionstyle=f"arc3,rad={rad}",zorder=3))

# ─────────────────── FIG 1: System Architecture ───────────────────
fig,ax=plt.subplots(figsize=(9.2,6.4)); ax.set_xlim(0,10); ax.set_ylim(0,10); ax.axis("off")
ax.add_patch(FancyBboxPatch((0.2,7.0),9.6,2.6,boxstyle="round,pad=0.02,rounding_size=0.1",fc="#f2f7f3",ec=LEAF,lw=1.2))
ax.text(0.45,9.3,"FRONTEND  ·  React + Vite",color=LEAF,fontsize=10,fontweight="bold")
box(ax,0.6,7.4,2.6,1.2,"GreenLeaf UI\nSpline hero · leaf canvas",fc=LEAF2,fs=9.5)
box(ax,3.5,7.4,2.4,1.2,"Chat / AgentPanel\nlive task states",fc=LEAF2,fs=9.5)
box(ax,6.2,7.4,3.2,1.2,"Auth · Voice input\nfollow-up chips",fc=LEAF2,fs=9.5)

ax.add_patch(FancyBboxPatch((0.2,0.5),9.6,5.7,boxstyle="round,pad=0.02,rounding_size=0.1",fc="#fbfaf5",ec=GOLD,lw=1.2))
ax.text(0.45,5.85,"BACKEND  ·  Express + WebSocket",color=GOLD,fontsize=10,fontweight="bold")
box(ax,3.7,4.7,2.6,0.95,"WS Session",fc=INK,fs=10)
box(ax,3.7,3.35,2.6,0.95,"Planner\n(orchestrator LLM)",fc=LEAF,fs=9.5)
box(ax,0.7,1.7,2.3,0.95,"🔍 Researcher",fc=LEAF2,fs=9.5)
box(ax,3.55,1.7,2.9,0.95,"✍️ Writer   📊 Analyst",fc=LEAF2,fs=9.5)
box(ax,7.0,1.7,2.3,0.95,"🤖 Generalist",fc=LEAF2,fs=9.5)
box(ax,2.2,0.7,2.6,0.75,"Synthesizer",fc=INK,fs=9.5)
box(ax,5.3,0.7,2.6,0.75,"🧐 Critic (revise ×1)",fc=GOLD,fs=9.5,tc="white")

arrow(ax,5.0,7.4,5.0,5.66,c=GREY)             # UI -> WS
ax.text(5.15,6.5,"goal / progress\n/ answer",fontsize=8,color=GREY,va="center")
arrow(ax,5.0,4.7,5.0,4.32)                      # WS -> Planner
arrow(ax,3.9,3.35,1.9,2.66,rad=0.2)            # Planner -> researcher
arrow(ax,5.0,3.35,5.0,2.66)                     # Planner -> writer/analyst
arrow(ax,6.1,3.35,8.1,2.66,rad=-0.2)           # Planner -> generalist
arrow(ax,3.5,1.7,3.5,1.08,rad=0.15)            # roles -> synth
arrow(ax,5.0,1.7,5.0,1.46)
arrow(ax,7.6,1.7,6.4,1.08,rad=-0.15)
arrow(ax,4.8,1.07,5.3,1.07)                     # synth -> critic
arrow(ax,6.0,1.45,4.8,3.35,c=GOLD,ls="--",rad=-0.35) # critic revise back
ax.text(7.9,0.45,"External tools:",fontsize=8,color=GREY)
box(ax,0.7,4.9,2.4,0.7,"NVIDIA NIM API\nfallback chain",fc="#d7e6db",tc=INK,fs=8.5)
arrow(ax,3.7,4.0,3.1,5.05,c=LEAF,rad=0.2)
box(ax,7.0,4.9,2.4,0.7,"Web · FS · run_code",fc="#d7e6db",tc=INK,fs=8.5)
arrow(ax,6.3,3.8,7.6,4.9,c=LEAF,rad=-0.2)
plt.title("Figure 1: Equilibrium Multi-Agent System Architecture",fontsize=12,color=INK,pad=10)
plt.tight_layout(); plt.savefig(OUT+"fig1_architecture.png",dpi=200,facecolor=BG); plt.close()
print("fig1 done")
