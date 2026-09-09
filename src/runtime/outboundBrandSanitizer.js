'use strict';

function replaceBrand(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/Los Angeles Roleplay/g, 'California State Roleplay')
    .replace(/Los Angeles Dashboard/g, 'California State Roleplay Dashboard')
    .replace(/Los Angeles Highway Patrol/g, 'California Highway Patrol')
    .replace(/Los Angeles experience/g, 'California experience')
    .replace(/\bLARP\b/g, 'CSRP');
}

function isOldArtwork(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('banner') || text.includes('underbanner') || text.includes('emblem');
}

function cleanNode(node) {
  if (typeof node === 'string') return replaceBrand(node);
  if (Array.isArray(node)) {
    return node
      .map(cleanNode)
      .filter(item => item !== undefined && item !== null)
      .filter(item => {
        if (!item || typeof item !== 'object') return true;
        const url = item.url || item.media?.url;
        return !isOldArtwork(url);
      });
  }
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'url' && isOldArtwork(value)) return null;
    const cleaned = cleanNode(value);
    if (cleaned === null && (key === 'media' || key === 'thumbnail' || key === 'image')) continue;
    out[key] = cleaned;
  }

  // Components V2 media galleries become invalid if all old artwork items were removed.
  if (Array.isArray(out.items) && out.items.length === 0) return null;
  return out;
}

function cleanFiles(files) {
  if (!Array.isArray(files)) return files;
  return files.filter(file => {
    const name = file?.name || file?.attachment?.name || file?.attachment || file?.data?.name;
    return !isOldArtwork(name);
  });
}

function sanitizeOptions(options) {
  if (!options || typeof options !== 'object') return options;
  const next = { ...options };
  if ('body' in next) next.body = cleanNode(next.body);
  if ('files' in next) next.files = cleanFiles(next.files);
  return next;
}

function install() {
  const { REST } = require('discord.js');
  const key = Symbol.for('csrp.outboundBrandSanitizer');
  if (REST.prototype[key]) return;

  Object.defineProperty(REST.prototype, key, { value: true });
  for (const method of ['post', 'patch', 'put']) {
    const original = REST.prototype[method];
    if (typeof original !== 'function') continue;
    REST.prototype[method] = function csrpSanitizedRequest(route, options) {
      return original.call(this, route, sanitizeOptions(options));
    };
  }

  console.log('[CSRPBrand] Outbound sanitizer active: old LA/LARP text is rebranded and banner/emblem attachments are blocked.');
}

module.exports = { installOutboundBrandSanitizer: install };
