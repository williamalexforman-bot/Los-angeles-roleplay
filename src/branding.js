const D=require('discord.js');
const CPFR='https://raw.githubusercontent.com/williamalexforman-bot/Los-angeles-roleplay/main/assets/banners/cpfr';
function decorate(box,header){
 if(header?.startsWith('cpfr:')){
  const name=header.slice(5);
  box.components.unshift(new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(`${CPFR}/${name}.png`)));
 }
 return box;
}
module.exports={decorate};
