const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {commands}=require('../src/commands/definitions');
const {commandHash}=require('../src/services/command-sync');
const {openDatabase,setSetting,settings,lockInteraction}=require('../src/database');

test('every slash command serializes and names are unique',()=>{const rows=commands.map(c=>c.toJSON());assert.equal(new Set(rows.map(c=>c.name)).size,rows.length);for(const row of rows){assert.ok(row.name.length<=32);assert.ok(row.description.length<=100);}});
test('command hash is stable and changes with definitions',()=>{const data=commands.map(c=>c.toJSON());assert.equal(commandHash(data),commandHash(structuredClone(data)));assert.notEqual(commandHash(data),commandHash(data.slice(1)));});
test('database persists configuration and blocks duplicate interactions',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'design-bot-')),file=path.join(dir,'test.sqlite');let db=openDatabase(file);setSetting(db,'g','showcase_channel','123');assert.equal(settings(db,'g').showcase_channel,'123');assert.equal(lockInteraction(db,'abc'),true);assert.equal(lockInteraction(db,'abc'),false);db.close();db=openDatabase(file);assert.equal(settings(db,'g').showcase_channel,'123');db.close();fs.rmSync(dir,{recursive:true,force:true});});
test('project contains no decorative header image features',()=>{const root=path.resolve(__dirname,'..'),files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','test'].includes(entry.name))continue;const full=path.join(dir,entry.name);entry.isDirectory()?walk(full):files.push(full);}}walk(root);for(const file of files){const text=fs.readFileSync(file,'utf8');assert.doesNotMatch(text,/banner[_ -]?(url|upload|image|setting)|setBanner|banner\.png/i,`${file} contains a prohibited decorative header feature`);}});
