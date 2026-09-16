const D = require('discord.js');
const BASE = 'https://raw.githubusercontent.com/williamalexforman-bot/Los-angeles-roleplay/main/assets/banners';
function gallery(name) {
  return new D.MediaGalleryBuilder().addItems(new D.MediaGalleryItemBuilder().setURL(`${BASE}/${name}.png`).setDescription(`Valenti Crime Family ${name}`));
}
function decorate(box, header) {
  if (header) box.components.unshift(gallery(header));
  box.addMediaGalleryComponents(gallery('footer'));
  return box;
}
module.exports = { decorate };
