const D = require('discord.js');
const { collection, locked } = require('./store');
const { settings, destination } = require('./discipline');
const { ROLES } = require('./settings');
const { v2, button, section } = require('./panels');
function duration(ms) {
  const minutes = Math.floor(Math.max(0,ms)/60000);
  return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
function shiftPanel() {
  return v2('Staff Shifts', [section('on_duty','Start Your Shift','Press **Start Shift** when you begin playing. The bot records your start time and shows you on the active-shift board.'),section('duration','Track Your Time','Use **My Shift** to check your current session. Only one shift can be active at a time.'),section('off_duty','Save Your Shift','Press **End Shift** when you finish. Ending a shift saves its duration to your record.'),section('quota','Weekly Quota','The weekly target is **30 minutes** when quota is enabled. Use `/quota status` to check your progress and the configured deadline.')], [button('shift:start','Start Shift',D.ButtonStyle.Success),button('shift:end','End Shift',D.ButtonStyle.Danger),button('shift:status','My Shift')]);
}
async function changeShift(i, action) {
  return locked(`shift:${i.guildId}:${i.user.id}`,async()=>{
    const rows=collection('shifts');
    const active=await rows.findOne({guildId:i.guildId,userId:i.user.id,ended:null});
    if(action==='status') return active ? `Your shift started <t:${Math.floor(active.started/1000)}:F>.\n**Elapsed:** ${duration(Date.now()-active.started)}` : 'You are not currently on shift.';
    if(action==='end') {
      if(!active) return 'You are not currently on shift.';
      const ended=Date.now();
      await rows.updateOne({_id:active._id,ended:null},{$set:{ended,duration:ended-active.started,endLogged:false}});
      return `Shift ended. **Time worked:** ${duration(ended-active.started)}. Your record is saved.`;
    }
    if(action!=='start') throw new Error('Invalid shift action.');
    const member=await i.guild.members.fetch({user:i.user.id,force:true});
    const config=await settings(i.guildId);
    // Every human member can log time toward the server-wide quota.
    const discipline=await collection('members').findOne({_id:`${i.guildId}:${i.user.id}`});
    if(discipline?.suspension || member.roles.cache.has(ROLES.suspended)) throw new Error('You cannot start a shift while suspended.');
    if(active) return `You already have an active shift, started <t:${Math.floor(active.started/1000)}:R>.`;
    await destination(i.guild,'shiftLogs'); await destination(i.guild,'activeShifts');
    await rows.insertOne({_id:i.id,guildId:i.guildId,userId:i.user.id,started:Date.now(),ended:null,startLogged:false});
    return 'Shift started. Your start time is saved.';
  });
}
function activePages(active) {
  const pages=[];
  for(let n=0;n<active.length;n+=30) {
    pages.push(v2('Active Staff Shifts', `**On duty:** ${active.length}\n\n`+active.slice(n,n+30).map(s=>`<@${s.userId}> • started <t:${Math.floor(s.started/1000)}:R>`).join('\n')));
  }
  return pages.length ? pages : [v2('Active Staff Shifts','No staff members are currently on shift.')];
}
async function syncGuild(guild) {
  const config=await settings(guild.id);
  if(!config.shiftLogs || !config.activeShifts)return;
  return locked(`shift-sync:${guild.id}`,async()=>{
    const rows=collection('shifts');
    const unlogged=await rows.find({guildId:guild.id,$or:[{startLogged:false},{endLogged:false}]}).toArray();
    if(unlogged.length) {
      try {
      const log=await destination(guild,'shiftLogs');
      for(const shift of unlogged) {
        if(!shift.startLogged) {
          await log.send(v2('Shift Started',`**Staff:** <@${shift.userId}>\n**Started:** <t:${Math.floor(shift.started/1000)}:F>\n**Shift ID:** ${shift._id}`));
          await rows.updateOne({_id:shift._id},{$set:{startLogged:true}});
        }
        if(shift.ended && shift.endLogged===false) {
          await log.send(v2('Shift Ended',`**Staff:** <@${shift.userId}>\n**Started:** <t:${Math.floor(shift.started/1000)}:F>\n**Ended:** <t:${Math.floor(shift.ended/1000)}:F>\n**Time worked:** ${duration(shift.duration)}\n**Shift ID:** ${shift._id}`));
          await rows.updateOne({_id:shift._id},{$set:{endLogged:true}});
        }
      }
      } catch(e) { console.error('Shift log delivery pending:',guild.id,e.code || e.name); }
    }
    const active=await rows.find({guildId:guild.id,ended:null}).toArray();
    active.sort((a,b)=>a.started-b.started);
    const channel=await destination(guild,'activeShifts');
    const boards=collection('shift_boards');
    let board=await boards.findOne({_id:guild.id});
    if(board && board.channel!==channel.id) {
      const old=await guild.channels.fetch(board.channel).catch(()=>null);
      for(const id of board.messages) await old?.messages?.delete(id).catch(()=>{});
      board=null;
    }
    const ids=board?.messages || [];
    const pages=activePages(active);
    pages[0].components[0].addActionRowComponents(new D.ActionRowBuilder().addComponents(button('shift:start','Start Shift',D.ButtonStyle.Success),button('shift:end','End Shift',D.ButtonStyle.Danger),button('shift:status','My Shift')));
    pages[0].components[0].addTextDisplayComponents(new D.TextDisplayBuilder().setContent('Weekly quota: 30 minutes. End shifts to save time. Use /quota status for your total.'));
    for(let n=0;n<pages.length;n++) {
      // Fetch failures other than a missing message must not create duplicates.
      let message;
      if(ids[n]) {
        try { message=await channel.messages.fetch(ids[n]); }
        catch(e) { if(e.code!==10008) throw e; }
      }
      if(message) await message.edit(pages[n]);
      else ids[n]=(await channel.send(pages[n])).id;
      await boards.updateOne({_id:guild.id},{$set:{channel:channel.id,messages:ids}}, {upsert:true});
    }
    for(const id of ids.slice(pages.length)) await channel.messages.delete(id).catch(e=>{if(e.code!==10008)throw e;});
    await boards.updateOne({_id:guild.id},{$set:{channel:channel.id,messages:ids.slice(0,pages.length)}},{upsert:true});
  });
}
let syncing=false;
async function syncShifts(client) {
  if(syncing)return;
  syncing=true;
  try { for(const guild of client.guilds.cache.values()) { if(process.env.GUILD_ID?.trim() && guild.id!==process.env.GUILD_ID.trim())continue; await syncGuild(guild).catch(e=>console.error('Shift sync pending:',guild.id,e.code || e.name)); } }
  finally { syncing=false; }
}
async function handleShift(i,action) {
  await i.deferReply({flags:D.MessageFlags.Ephemeral});
  const result=await changeShift(i,action);
  await i.editReply(v2('Staff Shift',result,[],true));
  if(action!=='status') await syncGuild(i.guild).catch(()=>{});
}
module.exports={shiftPanel,changeShift,activePages,syncShifts,handleShift,duration};
