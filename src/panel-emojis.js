const pack = require('../assets/emojis/pack.json');
let client;
function configure(value) { client = value; }
function find(name, guildId = process.env.GUILD_ID) {
  const guilds = client?.guilds?.cache;
  const guild = guildId ? guilds?.get(guildId) : guilds?.size === 1 ? guilds.first() : null;
  const normalize=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const aliases={infraction:['infraction','infractions','discipline'],promotion:['promotion','promotions'],support:['support','assistance','general_support'],internal_affairs:['ops','ops_reports','opr','opr_report','internal_affairs'],high_rank:['hr','hr_support','administrative','admin','management'],welcome:['welcome','wave','wave1'],close:['close','closing_ticket','lock'],claim:['claim','claimed','staff'],deployment:['deployment','patrol','deploy'],approved:['approved','accept','check'],denied:['denied','reject','cross']};
  const names=[name,...(aliases[name]||[])];
  const candidates=[...names.map(n=>'usms_'+n),...names,...names.map(n=>'pcso_'+n)];
  for(const candidate of candidates){
    const emoji=guild?.emojis?.cache?.find(e=>normalize(e.name)===normalize(candidate) && e.available!==false && !e.managed && !e.roles?.cache?.size);
    if(emoji)return emoji;
  }
  return undefined;
}
function icon(name, fallback = '', guildId) {
  const e = find(name, guildId);
  return e ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : fallback;
}
function component(name, fallback, guildId) {
  const e = find(name, guildId);
  return e ? { id: e.id, name: e.name, animated: Boolean(e.animated) } : fallback;
}
// Only decorate bot-authored labels; never rewrite member-supplied reasons or answers.
function key(label) {
  const s = String(label).toLowerCase();
  const rules = [
    [/not completed|failed|rejected|denied|cancel/, 'denied'], [/accept|approv|success|saved|recorded/, 'approved'],
    [/ops reports|internal affairs/,'internal_affairs'], [/administrative|senior|high rank/,'high_rank'], [/general support/,'support'],
    [/claim/,'claim'], [/clos|delete|purge/,'close'], [/escalat/,'arrow_up'], [/appeal|review/,'appeal'],
    [/promot|new role/,'promotion'], [/old role|demot/,'demotion'], [/warning/,'warning'], [/strike/,'strike'],
    [/suspension/,'suspension'], [/infraction|disciplin|action recorded/,'infraction'], [/investigat/,'investigation'],
    [/blacklist/,'blacklist'], [/terminat/,'termination'], [/deploy/,'deployment'], [/quota/,'quota'],
    [/shift|duty/,'shift'], [/application|submit/,'application'], [/ticket/,'ticket'], [/transcript/,'transcript'],
    [/evidence/,'evidence'], [/reason|notes/,'logs'], [/staff|actor/,'staff'], [/member|user|opened by/,'member'],
    [/verif/,'verified'], [/config|setting/,'settings'], [/command|help/,'help'], [/log/,'logs'],
    [/message|dm/,'mail'], [/raid|threat/,'warning'], [/ban|kick/,'shield'], [/join|welcome/,'welcome'],
    [/leave/,'arrow_left'], [/start/,'play'], [/end|stop/,'stop'], [/keep|reopen/,'unlock'],
    [/yes/,'approved'], [/no/,'denied'], [/next/,'arrow_right'], [/back/,'arrow_left'],
  ];
  const exact=s.replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return Object.hasOwn(pack,`valenti_${exact}`) ? exact : rules.find(([pattern])=>pattern.test(s))?.[1] || 'info';
}
function heading(label, guildId) { const e=icon(key(label),'',guildId);return e ? `${e} ${label.replace(/^[🎉🎫📋⭐⚠️]+\s*/u,'')}` : label; }
module.exports={configure,find,icon,component,key,heading};
