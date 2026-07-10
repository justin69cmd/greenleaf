import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

OUT = "/sessions/clever-eloquent-bell/mnt/outputs/figs/"
INK="#1b2a1f"; LEAF="#2e7d4f"; LEAF2="#3f9d68"; GOLD="#c8912f"; RED="#b23a3a"; GREY="#6b7770"; BG="#ffffff"
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":11})

def box(ax,x,y,w,h,text,fc=LEAF,tc="white",fs=11,r=0.06,ec="none",lw=0):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle=f"round,pad=0.02,rounding_size={r}",fc=fc,ec=ec,lw=lw))
    ax.text(x+w/2,y+h/2,text,ha="center",va="center",color=tc,fontsize=fs,zorder=5)
def arrow(ax,x1,y1,x2,y2,c=INK,ls="-",lw=1.8,rad=0.0):
    ax.add_patch(FancyArrowPatch((x1,y1),(x2,y2),arrowstyle="-|>",mutation_scale=16,color=c,lw=lw,linestyle=ls,connectionstyle=f"arc3,rad={rad}",zorder=3))

# ── FIG 1 (rebuilt, no emoji) ──
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
box(ax,0.7,1.7,2.3,0.95,"Researcher",fc=LEAF2,fs=9.5)
box(ax,3.55,1.7,2.9,0.95,"Writer  ·  Analyst",fc=LEAF2,fs=9.5)
box(ax,7.0,1.7,2.3,0.95,"Generalist",fc=LEAF2,fs=9.5)
box(ax,2.2,0.7,2.6,0.75,"Synthesizer",fc=INK,fs=9.5)
box(ax,5.3,0.7,2.6,0.75,"Critic (revise x1)",fc=GOLD,fs=9.5)
arrow(ax,5.0,7.4,5.0,5.66,c=GREY); ax.text(5.15,6.5,"goal / progress\n/ answer",fontsize=8,color=GREY,va="center")
arrow(ax,5.0,4.7,5.0,4.32)
arrow(ax,3.9,3.35,1.9,2.66,rad=0.2); arrow(ax,5.0,3.35,5.0,2.66); arrow(ax,6.1,3.35,8.1,2.66,rad=-0.2)
arrow(ax,3.5,1.7,3.5,1.08,rad=0.15); arrow(ax,5.0,1.7,5.0,1.46); arrow(ax,7.6,1.7,6.4,1.08,rad=-0.15)
arrow(ax,4.8,1.07,5.3,1.07); arrow(ax,6.0,1.45,4.8,3.35,c=GOLD,ls="--",rad=-0.35)
box(ax,0.7,4.9,2.4,0.7,"NVIDIA NIM API\nfallback chain",fc="#d7e6db",tc=INK,fs=8.5)
arrow(ax,3.7,4.0,3.1,5.05,c=LEAF,rad=0.2)
box(ax,7.0,4.9,2.4,0.7,"Web · FS · run_code",fc="#d7e6db",tc=INK,fs=8.5)
arrow(ax,6.3,3.8,7.6,4.9,c=LEAF,rad=-0.2)
plt.title("Figure 1: Equilibrium Multi-Agent System Architecture",fontsize=12,color=INK,pad=10)
plt.tight_layout(); plt.savefig(OUT+"fig1_architecture.png",dpi=200,facecolor=BG); plt.close()

# ── FIG 2: Agent Execution Sequence (vertical flowchart) ──
fig,ax=plt.subplots(figsize=(8.4,9.6)); ax.set_xlim(0,10); ax.set_ylim(0,15); ax.axis("off")
def stage(y,text,fc=LEAF,fs=10.5,h=0.9,x=2.2,w=5.6,tc="white"):
    box(ax,x,y,w,h,text,fc=fc,fs=fs,tc=tc); return y
box(ax,2.2,13.9,5.6,0.9,"User submits goal  (WebSocket)",fc=INK,fs=10.5)
box(ax,2.2,12.6,5.6,0.9,"Planner LLM  →  ordered subtasks (JSON, 2–3)",fc=LEAF,fs=10)
# decision diamond
ax.add_patch(plt.Polygon([(5,12.0),(6.6,11.3),(5,10.6),(3.4,11.3)],closed=True,fc=GOLD,ec="none",zorder=4))
ax.text(5,11.3,"parse ok?",ha="center",va="center",color="white",fontsize=9,zorder=5)
box(ax,7.4,10.9,2.4,0.8,"single-task\nfallback",fc=GREY,fs=8.5)
box(ax,2.2,9.3,5.6,0.9,"For each subtask: load role prompt + tools",fc=LEAF2,fs=10)
# tool loop sub-box
ax.add_patch(FancyBboxPatch((1.4,4.7),7.2,3.9,boxstyle="round,pad=0.02,rounding_size=0.1",fc="#f2f7f3",ec=LEAF,lw=1.3))
ax.text(1.7,8.35,"Tool-calling loop (per specialist)",color=LEAF,fontsize=9.5,fontweight="bold")
box(ax,2.2,7.35,5.6,0.75,"LLM proposes tool call",fc=LEAF2,fs=9.5)
box(ax,2.2,6.35,5.6,0.75,"Execute: web_search / write_file / run_code / call_api",fc=INK,fs=8.7)
box(ax,2.2,5.35,5.6,0.75,"Append result to shared memory",fc=LEAF2,fs=9.5)
arrow(ax,5,7.35,5,7.1); arrow(ax,5,6.35,5,6.1)
arrow(ax,2.2,5.7,1.7,7.0,c=LEAF,ls="--",rad=0.4); ax.text(0.5,6.4,"loop\nuntil\ndone",fontsize=8,color=LEAF)
box(ax,2.2,3.4,5.6,0.9,"Synthesizer → final Markdown answer",fc=LEAF,fs=10)
ax.add_patch(plt.Polygon([(5,2.9),(6.6,2.2),(5,1.5),(3.4,2.2)],closed=True,fc=GOLD,ec="none",zorder=4))
ax.text(5,2.2,"Critic\nok?",ha="center",va="center",color="white",fontsize=9,zorder=5)
box(ax,7.4,1.8,2.4,0.8,"revise\nonce",fc=RED,fs=8.5)
box(ax,2.2,0.3,5.6,0.9,"Deliver answer + file chips to UI",fc=INK,fs=10.5)
# arrows chaining
arrow(ax,5,13.9,5,13.5); arrow(ax,5,12.6,5,12.02); arrow(ax,6.6,11.3,7.4,11.3,c=GREY)
ax.text(6.7,11.5,"no",fontsize=8,color=GREY); ax.text(5.15,10.5,"yes",fontsize=8,color=LEAF)
arrow(ax,5,10.6,5,10.22); arrow(ax,5,9.3,5,8.62)
arrow(ax,5,4.7,5,4.32); arrow(ax,5,3.4,5,2.92)
arrow(ax,6.6,2.2,7.4,2.2,c=RED); ax.text(6.7,2.4,"no",fontsize=8,color=RED)
arrow(ax,7.4,2.6,5.6,3.4,c=RED,ls="--",rad=-0.3)
ax.text(5.15,1.4,"yes",fontsize=8,color=LEAF); arrow(ax,5,1.5,5,1.22)
plt.title("Figure 2: Agent Execution Sequence (Plan → Execute → Critique)",fontsize=12,color=INK,pad=8)
plt.tight_layout(); plt.savefig(OUT+"fig2_sequence.png",dpi=200,facecolor=BG); plt.close()
print("fig1,2 done")
