function ticketName(reason,userId){
 const words=String(reason).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75).replace(/-$/,'');
 return `${words||'support'}-${String(userId).slice(-6)}`;
}
function ticketReason(reason){return '`'+String(reason||'Not provided').replace(/`/g,"'").replace(/[\r\n\t]+/g,' ').slice(0,1200)+'`';}
module.exports={ticketName,ticketReason};
