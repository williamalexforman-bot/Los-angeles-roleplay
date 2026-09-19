const source=require('../assets/emojis/pack.json');
const names=["infraction", "promotion", "ticket", "support", "internal_affairs", "high_rank", "deployment", "warning", "strike", "suspension", "termination", "blacklist", "investigation", "claim", "close", "escalated", "arrow_up", "approved", "denied", "logs", "welcome", "member", "staff", "settings", "help", "info", "appeal", "transcript", "evidence", "mail", "shield", "reason", "reference"];
module.exports=Object.fromEntries(names.map(name=>['usms_'+name,source['valenti_'+name]]));
