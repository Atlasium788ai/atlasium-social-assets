#!/usr/bin/env python3
"""Generate review-only 9:16 videos from recordings of Atlasium's public pages."""
from pathlib import Path
import subprocess,json
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright

OUT=Path("product-video-drafts");OUT.mkdir(exist_ok=True)
F="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
B="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
P=[
("assessment","LINKLATCH / ASSESSMENT","https://linklatch.atlasium788.ca/Atlasium_Revenue_Assessment_Survey_Only?rep=cody",
 ["WHERE DO LEADS GET LOST?","START WITH 8 QUESTIONS.","SEE YOUR PROCESS SCORE.","IDENTIFY A FIRST FIX.","TAKE THE FREE ASSESSMENT"],
 ["See your revenue process more clearly.","Short self-check, about two minutes.","A process score, not a financial guarantee.","Focus on one practical next step.","atlasium788.ca/contact"]),
("reeviq","REEVIQ / REVENUE INTELLIGENCE","https://atlasium788.ca/core-iq",
 ["WHO OWNS THE FOLLOW-UP?","KEEP THE CONTEXT TOGETHER.","SEE PROSPECT OWNERSHIP.","KNOW THE NEXT ACTION.","START WITH THE ASSESSMENT"],
 ["Good opportunities need accountability.","Prospects and activity in one view.","Keep the right person responsible.","Make the next step visible.","atlasium788.ca/contact"]),
("xipherx","XIPHERX / LEAD INTELLIGENCE","https://atlasium788.ca/xipherx",
 ["MORE LEADS AREN'T ENOUGH.","START WITH A DEFINED MARKET.","TARGET NICHE & LOCATION.","REVIEW PROSPECT FIT.","DIAGNOSE BEFORE SCALING"],
 ["Relevance comes before volume.","Focus on your ideal B2B buyer.","Explore targeted prospect criteria.","Bring stronger context into outreach.","atlasium788.ca/contact"])
]
def ff(*args):
 p=subprocess.run(["ffmpeg","-hide_banner","-nostdin","-loglevel","error","-y",*args],capture_output=True,text=True)
 if p.returncode:raise RuntimeError(p.stderr[-3000:])
def draw_wrap(d,text,x,y,sz,maximum,color,bold=False):
 font=ImageFont.truetype(B if bold else F,sz);line=""
 for word in text.split():
  nxt=(line+" "+word).strip()
  if d.textbbox((0,0),nxt,font=font)[2]>maximum and line:
   d.text((x,y),line,font=font,fill=color);y+=sz+17;line=word
  else:line=nxt
 d.text((x,y),line,font=font,fill=color)
def slide(key,product,titles,subs,n):
 im=Image.new("RGB",(1080,1920),(5,15,34));d=ImageDraw.Draw(im)
 d.ellipse((700,-320,1280,310),outline=(25,67,117),width=9)
 d.rounded_rectangle((60,56,1020,175),radius=29,fill=(10,26,51),outline=(37,74,124),width=2)
 d.text((90,97),"ATLASIUM",font=ImageFont.truetype(B,43),fill=(237,247,255))
 d.text((415,101),"7/88",font=ImageFont.truetype(B,36),fill=(75,160,255))
 d.text((82,235),product,font=ImageFont.truetype(B,27),fill=(75,160,255))
 draw_wrap(d,titles[n],80,309,65,920,(240,247,255),True)
 draw_wrap(d,subs[n],82,483,32,920,(167,190,225))
 if n in [1,2,3]:
  d.rounded_rectangle((62,664,1018,1389),radius=33,fill=(10,28,59),outline=(50,104,169),width=3)
  d.rounded_rectangle((81,680,999,1369),radius=20,fill=(6,15,31))
  for i,c in enumerate([(220,91,102),(243,185,92),(84,190,143)]):d.ellipse((105+i*32,696,121+i*32,712),fill=c)
  d.text((217,694),"LIVE PRODUCT WEBSITE",font=ImageFont.truetype(B,21),fill=(155,187,221))
 else:
  d.rounded_rectangle((80,760,1000,1140),radius=39,fill=(9,34,71),outline=(55,110,181),width=4)
  draw_wrap(d,"DIAGNOSE  /  INSTALL  /  RECOVER",140,913,32,830,(237,247,255),True)
 if n==4:
  d.rounded_rectangle((83,1217,997,1370),radius=31,fill=(76,156,245))
  d.text((132,1270),"REVENUE LEAK ASSESSMENT",font=ImageFont.truetype(B,35),fill=(5,20,46))
 d.line((85,1740,995,1740),fill=(42,74,118),width=3)
 d.text((88,1780),"REVENUE INTELLIGENCE SYSTEMS",font=ImageFont.truetype(B,26),fill=(164,189,223))
 d.text((911,1780),str(n+1).zfill(2)+"/05",font=ImageFont.truetype(B,25),fill=(80,168,255))
 path=OUT/(key+"_slide_%02d.png"%n);im.save(path)
def record(browser,key,url):
 ctx=browser.new_context(viewport={"width":1100,"height":780},color_scheme="dark",record_video_dir=str(OUT),record_video_size={"width":1100,"height":780})
 page=ctx.new_page();status={"page":url}
 try:
  page.goto(url,wait_until="domcontentloaded",timeout=45000);page.wait_for_timeout(3000)
  status["title"]=page.title()
  if key=="assessment":
   for loc in [page.get_by_text("START MY ASSESSMENT",exact=False),page.get_by_role("button",name="Start My Assessment")]:
    if loc.count():
     try:loc.first.click(timeout=3500);status["started"]=True;break
     except Exception:pass
   page.wait_for_timeout(6200)
  else:
   page.evaluate("scrollTo(0, 250)");page.wait_for_timeout(3000)
   page.evaluate("scrollTo(0, 620)");page.wait_for_timeout(4800)
  status["end_url"]=page.url
 except Exception as e:status["error"]=str(e)[:450]
 page.close();clip=Path(page.video.path());ctx.close()
 if "title" not in status or clip.stat().st_size<2000:raise RuntimeError("Live capture failed "+json.dumps(status))
 return clip,status

reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
 for key,product,url,titles,subs in P:
  print("Recording",key,flush=True)
  clip,status=record(browser,key,url)
  for n in range(5):slide(key,product,titles,subs,n)
  video=OUT/("Atlasium_"+key+"_REAL_SCREEN_Tutorial_REVIEW.mp4")
  filt="[0:v]fps=25,trim=duration=20,setpts=PTS-STARTPTS[bg];[1:v]fps=25,scale=918:600:force_original_aspect_ratio=decrease,pad=918:600:(ow-iw)/2:(oh-ih)/2:0x071224,setsar=1,trim=duration=12,setpts=PTS-STARTPTS+4/TB[demo];[bg][demo]overlay=81:749:enable='between(t,4,16)':shortest=0:repeatlast=0[v]"
  ff("-framerate","1/4","-i",str(OUT/(key+"_slide_%02d.png")),"-stream_loop","-1","-i",str(clip),"-filter_complex",filt,"-map","[v]","-t","20","-r","25","-c:v","libx264","-preset","veryfast","-crf","27","-pix_fmt","yuv420p","-movflags","+faststart",str(video))
  status.update({"file":video.name,"bytes":video.stat().st_size})
  reports.append(status)
 browser.close()

captions={
"assessment":"Where are otherwise winnable opportunities slipping away? Take Atlasium's free eight-question self-check for a Process Health Score, primary gap and suggested first fix. This is not a guaranteed financial report. Start: https://atlasium788.ca/contact #RevenueLeakAssessment #Atlasium #RevenueIntelligence",
"reeviq":"A lead comes in. Who owns the next follow-up? ReeVIQ helps teams keep prospect context, ownership and next actions in one operating view. Start with a free Revenue Leak Assessment: https://atlasium788.ca/contact #ReeVIQ #RevenueIntelligence #SalesOperations",
"xipherx":"More leads won't fix a weak process. XipherX helps build reviewed B2B prospect lists matched to your niche and location. Start by diagnosing where your existing opportunities are getting stuck: https://atlasium788.ca/contact #XipherX #B2BProspecting #Atlasium"
}
(OUT/"Captions_And_Approval_Guide.md").write_text("# Atlasium 7/88 real-screen tutorial review drafts\n\nThree silent, 20-second, vertical MP4s. Footage is screen-recorded from public Atlasium pages in dark mode. No accounts accessed, questionnaire answers submitted, posts scheduled, or external messages sent. These are approval drafts, not claimed customer results.\n\n"+"\n\n".join("## "+k.upper()+"\n"+v for k,v in captions.items())+"\n\nDo not publish until reviewed. Confirm footage still matches current product behavior and the assessment destination is working.\n")
(OUT/"capture-report.json").write_text(json.dumps(reports,indent=2))
print(json.dumps(reports,indent=2),flush=True)
