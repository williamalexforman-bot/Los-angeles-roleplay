"""Generate original, transparent 128px USMS server icons (Pillow)."""
from PIL import Image, ImageDraw, ImageFont
import io,base64,json
from pathlib import Path
names=['infraction','promotion','ticket','support','deployment','shift','application','approved','denied','warning','strike','suspension','claim','close','logs','welcome']
pack={}
for name in names:
 im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im);red=(0,0,0,0);cream='#ffffff'
 pass # No background tile: symbols are drawn directly on transparency.
 def line(points):d.line(points,fill=cream,width=9,joint='curve')
 if name in ['infraction','warning']:
  d.polygon([(64,23),(107,99),(21,99)],fill=cream);d.rectangle((59,47,69,73),fill=red);d.ellipse((59,81,69,91),fill=red)
 elif name=='promotion':
  line([(30,67),(64,35),(98,67)]);line([(30,93),(64,61),(98,93)])
 elif name in ['ticket','application','logs']:
  d.rounded_rectangle((31,25,97,104),radius=7,outline=cream,width=7)
  for y in [45,64,83]:line([(44,y),(84,y)])
  if name=='ticket':d.ellipse((19,54,41,76),fill=red);d.ellipse((87,54,109,76),fill=red)
  if name=='application':d.rectangle((47,19,81,34),fill=cream)
 elif name=='support':
  d.arc((29,27,99,103),180,360,fill=cream,width=9);d.rounded_rectangle((23,61,40,93),radius=5,fill=cream);d.rounded_rectangle((88,61,105,93),radius=5,fill=cream);line([(96,89),(96,103),(67,103)])
 elif name=='deployment':
  d.polygon([(26,51),(57,51),(99,29),(99,94),(57,76),(26,76)],fill=cream);d.polygon([(40,76),(58,76),(65,104),(47,104)],fill=cream)
 elif name=='shift':
  d.ellipse((25,25,103,103),outline=cream,width=8);line([(64,39),(64,65),(85,79)])
 elif name in ['approved','claim']:line([(29,65),(53,88),(101,39)])
 elif name in ['denied','close']:line([(37,37),(91,91)]);line([(91,37),(37,91)])
 elif name=='strike':d.polygon([(70,20),(36,71),(60,71),(52,109),(96,53),(71,53),(82,20)],fill=cream)
 elif name=='suspension':d.rounded_rectangle((37,31,55,98),radius=4,fill=cream);d.rounded_rectangle((73,31,91,98),radius=4,fill=cream)
 elif name=='welcome':
  d.ellipse((48,24,80,56),fill=cream);d.rounded_rectangle((34,67,94,105),radius=16,fill=cream);line([(92,46),(105,46)]);line([(99,39),(99,53)])
 b=io.BytesIO();im.save(b,format='PNG',optimize=True);pack['valenti_'+name]=base64.b64encode(b.getvalue()).decode()
# Expanded pack follows below.
# Path('assets/emojis/pack.json').write_text(json.dumps(pack,indent=2)+'\n')
# Bold, small-size navigation glyphs and readable role/status badges.
symbols={
 'arrow_right':'right','arrow_left':'left','arrow_up':'up','arrow_down':'down',
 'plus':'plus','minus':'minus','lock':'lock','unlock':'unlock','search':'search',
 'info':'i','help':'?','pending':'...','online':'circle','offline':'ring',
 'busy':'stop','star':'star','favorite':'heart','announcement':'bell','mail':'mail',
 'calendar':'calendar','folder':'folder','shield':'shield','pin':'pin','link':'link',
 'play':'play','stop':'square','pause':'pause','refresh':'refresh',
 'settings':'settings','crown':'crown','member':'member','members':'members',
}
badges={
 'owner':'OWN','founder':'FDR','management':'MGT','admin':'ADM','moderator':'MOD',
 'staff':'STAFF','high_rank':'HR','internal_affairs':'OPR','trainee':'TRN','trainer':'TR',
 'on_duty':'ON','off_duty':'OFF','break':'BRK','quota':'2h','loa':'LOA',
 'warning_one':'W1','warning_two':'W2','strike_one':'S1','strike_two':'S2','strike_three':'S3',
 'demotion':'DEM','termination':'TERM','investigation':'INV','blacklist':'BL',
 'appeal':'APL','evidence':'EVD','transcript':'TXT','verified':'VER',
 'rules':'RULE','priority':'VIP','event':'EVT','meeting':'MTG',
}
font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for name,shape in {**symbols,**badges}.items():
 im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im);pass # No background tile: symbols are drawn directly on transparency.
 def line(points,w=8):d.line(points,fill=cream,width=w,joint='curve')
 def text(label):
  font=ImageFont.truetype(font_path,58 if len(label)<3 else 35 if len(label)<4 else 28)
  d.text((64,62),label,font=font,anchor='mm',fill=cream)
 if name in badges or shape in ['i','?','...']:text(shape)
 elif shape in ['right','left','up','down']:
  line([(29,64),(99,64)]);line([(72,38),(99,64),(72,90)])
  if shape!='right':im=im.rotate({'left':180,'up':90,'down':270}[shape])
 elif shape in ['plus','minus']:line([(30,64),(98,64)]);line([(64,30),(64,98)]) if shape=='plus' else None
 elif shape in ['lock','unlock']:
  d.arc((41,24,87,78),180,360,fill=cream,width=8);d.rounded_rectangle((32,56,96,102),radius=8,fill=cream);d.ellipse((59,69,69,79),fill=red)
  if shape=='unlock':d.rectangle((77,39,96,55),fill=red)
 elif shape=='search':d.ellipse((27,25,81,79),outline=cream,width=8);line([(77,76),(104,103)],11)
 elif shape in ['circle','ring','stop']:
  d.ellipse((29,29,99,99),fill=cream if shape!='ring' else None,outline=cream,width=8)
  if shape=='stop':d.rectangle((41,59,87,69),fill=red)
 elif shape=='star':
  import math
  pts=[(64+(43 if i%2==0 else 19)*math.cos(-math.pi/2+i*math.pi/5),64+(43 if i%2==0 else 19)*math.sin(-math.pi/2+i*math.pi/5)) for i in range(10)];d.polygon(pts,fill=cream)
 elif shape=='heart':d.ellipse((24,32,66,76),fill=cream);d.ellipse((62,32,104,76),fill=cream);d.polygon([(25,57),(103,57),(64,103)],fill=cream)
 elif shape=='bell':d.ellipse((41,28,87,77),fill=cream);d.polygon([(40,53),(88,53),(101,92),(27,92)],fill=cream);d.ellipse((56,96,72,110),fill=cream)
 elif shape=='mail':d.rounded_rectangle((23,37,105,94),radius=6,outline=cream,width=7);line([(27,40),(64,69),(101,40)])
 elif shape=='calendar':
  d.rounded_rectangle((27,30,101,104),radius=5,outline=cream,width=7);line([(29,51),(99,51)]);line([(44,22),(44,39)]);line([(84,22),(84,39)])
  for x in [44,63,82]:d.rectangle((x,66,x+7,73),fill=cream);d.rectangle((x,84,x+7,91),fill=cream)
 elif shape=='folder':d.polygon([(23,34),(57,34),(67,46),(105,46),(105,97),(23,97)],fill=cream)
 elif shape=='shield':d.polygon([(64,23),(102,38),(95,81),(64,106),(33,81),(26,38)],fill=cream);line([(48,62),(61,75),(81,50)],6)
 elif shape=='pin':d.ellipse((39,22,89,72),fill=cream);d.polygon([(40,51),(88,51),(64,106)],fill=cream);d.ellipse((55,36,73,54),fill=red)
 elif shape=='link':d.rounded_rectangle((22,49,72,79),radius=14,outline=cream,width=7);d.rounded_rectangle((56,49,106,79),radius=14,outline=cream,width=7)
 elif shape=='play':d.polygon([(42,27),(104,64),(42,101)],fill=cream)
 elif shape=='square':d.rounded_rectangle((33,33,95,95),radius=6,fill=cream)
 elif shape=='pause':d.rectangle((36,31,55,97),fill=cream);d.rectangle((73,31,92,97),fill=cream)
 elif shape=='refresh':d.arc((28,28,100,100),35,320,fill=cream,width=9);d.polygon([(99,27),(103,61),(75,48)],fill=cream)
 elif shape=='settings':
  for y,x in [(37,48),(64,81),(91,56)]:line([(26,y),(102,y)],5);d.ellipse((x-9,y-9,x+9,y+9),fill=cream)
 elif shape=='crown':d.polygon([(24,35),(45,58),(64,24),(83,58),(104,35),(94,98),(34,98)],fill=cream)
 elif shape in ['member','members']:
  for x in ([64] if shape=='member' else [42,86]):d.ellipse((x-16,27,x+16,59),fill=cream);d.rounded_rectangle((x-24,66,x+24,101),radius=12,fill=cream)
 b=io.BytesIO();im.save(b,format='PNG',optimize=True);pack['valenti_'+name]=base64.b64encode(b.getvalue()).decode()
assert len(pack)==80
Path('assets/emojis/pack.json').write_text(json.dumps(pack,indent=2)+'\n')

# Additional transparent panel badges and numbered guides.
extra = {
 'checklist':'LIST','requirements':'REQ','instructions':'HOW','process':'FLOW','preparation':'PREP',
 'review_queue':'REV','interview':'CHAT','ride_along':'RIDE','training':'LEARN','experience':'XP',
 'activity':'ACT','availability':'TIME','identity':'ID','username':'USER','roblox':'RBLX',
 'game':'GAME','server':'SRV','community':'COM','family':'USMS','team':'TEAM',
 'communication':'COMMS','radio':'RAD','briefing':'BRF','attendance':'ATT','rally':'JOIN',
 'join_game':'PLAY','game_rules':'RULES','conduct':'CARE','respect':'RSP','teamwork':'COOP',
 'check_in':'IN','check_out':'OUT','schedule':'PLAN','deadline':'DUE','timezone':'UTC',
 'duration':'HRS','weekly':'WEEK','monthly':'MON','daily':'DAY','session':'LIVE',
 'session_start':'GO','session_end':'END','session_full':'FULL','session_vote':'VOTE','session_boost':'UP',
 'feedback':'NOTE','suggestion':'IDEA','report':'RPT','privacy':'PVT','confidential':'SAFE',
 'resolved':'DONE','unresolved':'OPEN','assigned':'ASGN','unassigned':'FREE','escalated':'ESC',
 'archived':'ARCH','reopened':'OPEN','waiting':'WAIT','in_progress':'WIP','completed':'OK',
 'submitted':'SENT','draft':'EDIT','saved':'SAVE','synced':'SYNC','retry':'AGAIN',
 'download':'GET','upload':'SEND','attachment':'FILE','image':'IMG','document':'DOC',
 'history':'HIST','reference':'REF','case':'CASE','case_open':'NEW','case_closed':'END',
 'reason':'WHY','note':'NOTE','result':'RES','decision':'DEC','reviewer':'REV',
 'recipient':'TO','issuer':'BY','effective':'DATE','expires':'EXP','restored':'BACK',
 'rank':'RANK','rank_up':'UP','rank_down':'DOWN','leadership':'LEAD','supervisor':'SUP',
 'mentor':'HELP','recruit':'REC','veteran':'VET','milestone':'GOAL','achievement':'WIN',
 'notification':'PING','reminder':'REM','update':'NEW','maintenance':'FIX','connection':'LINK',
}
assert len(extra)==100
for n in range(1,11):
 extra[f'step_{n}']=str(n)
 extra[f'rating_{n}']=f'{n}/10'
for n,(name,label) in enumerate(extra.items()):
 assert 'valenti_'+name not in pack,name
 im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im)
 # White linework remains legible on Discord's dark surfaces; no filled tile.
 color=cream
 family=n%5
 if family==0:d.rounded_rectangle((12,22,116,106),radius=14,outline=color,width=5)
 elif family==1:d.ellipse((10,10,118,118),outline=color,width=5)
 elif family==2:d.polygon([(64,8),(116,32),(106,93),(64,120),(22,93),(12,32)],outline=color,width=5)
 elif family==3:
  d.line([(13,43),(13,19),(37,19)],fill=color,width=5);d.line([(91,109),(115,109),(115,85)],fill=color,width=5)
 else:
  d.line([(21,23),(107,23)],fill=color,width=5);d.line([(21,105),(107,105)],fill=color,width=5)
 font=ImageFont.truetype(font_path,48 if len(label)<=2 else 30 if len(label)<=4 else 25)
 d.text((64,63),label,font=font,anchor='mm',fill=color)
 b=io.BytesIO();im.save(b,format='PNG',optimize=True);pack['valenti_'+name]=base64.b64encode(b.getvalue()).decode()
assert len(pack)==200
Path('assets/emojis/pack.json').write_text(json.dumps(pack,indent=2)+'\n')
