const D=require('discord.js');
const BASE='https://raw.githubusercontent.com/williamalexforman-bot/Los-angeles-roleplay/main/assets/banners/usms';
const CPFR='https://raw.githubusercontent.com/williamalexforman-bot/Los-angeles-roleplay/main/assets/banners/cpfr';
function gallery(name){return new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(`${BASE}/${name}.png`));}
function decorate(box,header){
 if(header?.startsWith('cpfr:')){
  const name=header.slice(5);
  box.components.unshift(new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(`${CPFR}/${name}.png`)));
  return;
 }
 if(['infraction','promotion','deployment','assistance'].includes(header))box.components.unshift(gallery(header));
 box.addMediaGalleryComponents(gallery('footer'));
 return box;
}
module.exports={decorate};
