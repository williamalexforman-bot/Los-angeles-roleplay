const D=require('discord.js');
const CPFR='https://raw.githubusercontent.com/williamalexforman-bot/Los-angeles-roleplay/main/assets/banners/cpfr';
function gallery(name){return new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(`${CPFR}/${name}.png`));}
function decorate(box,header){
 const name=header?.startsWith('cpfr:')?header.slice(5):header;
 if(['assistance','infraction','promotion','shift','information','employee','cadet','oia','regulations'].includes(name))box.components.unshift(gallery(name));
 box.addMediaGalleryComponents(gallery('footer'));
 return box;
}
module.exports={decorate};
