"""Generate original, transparent 128px Valenti server icons (Pillow)."""
from PIL import Image, ImageDraw
import io,base64,json
from pathlib import Path
names=['infraction','promotion','ticket','support','deployment','shift','application','approved','denied','warning','strike','suspension','claim','close','logs','welcome']
pack={}
for name in names:
 im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im);red='#cf191f';cream='#ffe5d2'
 d.rounded_rectangle((7,7,120,120),radius=27,fill=red)
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
Path('assets/emojis/pack.json').write_text(json.dumps(pack,indent=2)+'\n')
