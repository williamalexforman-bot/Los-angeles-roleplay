const D=require('discord.js');
const BASE='https://raw.githubusercontent.com/williamalexforman-bot/Los-angeles-roleplay/main/assets/banners/usms';
function gallery(name){return new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(`${BASE}/${name}.png`));}
function decorate(box,header){
 if(['infraction','promotion','deployment','assistance'].includes(header))box.components.unshift(gallery(header));
 box.addMediaGalleryComponents(gallery('footer'));
 return box;
}
module.exports={decorate};
