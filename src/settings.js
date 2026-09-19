const GUILD_ID='1536150657440948324';
const CHANNELS={
 welcome:null,deployment:null,ticketPanel:'1536201127950024714',tickets:'1548331533197115563',
 infractions:'1539959958903455815',promotions:'1539959822680592415',
 transcripts:'1536274703050612797',appeals:'1544620247527465040',
 log_bot:'1548066902629294131',log_claims:'1536274703050612797',log_tickets:'1536274703050612797',
 log_infractions:'1544603710192357387',
 ...Object.fromEntries(['messages','promotions','roles','raids','moderation','members'].map(k=>['log_'+k,'1548066902629294131'])),
};
const ROLES={warnings:['1550972697830367263','1550972751496487102'],strikes:['1550972916005478562','1550972965363912754'],
 retained:null,suspended:'1550973028114890752',termination:'1550973091000090655',blacklisted:'1550973143785410650',investigation:null};
const TYPES=['Warning','Strike','Suspension','Demotion','Termination','Under Investigation','Blacklisted'];
const TICKETS={general:'General Support',affairs:'OPR Report',division:'Divisional Inquiries',high:'HR Support',recruitment:'Recruitment Support'};
const TICKET_DESCRIPTIONS={general:'General questions or server issues.',affairs:'Office of Professional Responsibility reports.',division:'Questions relating to specific divisions.',high:'Human Resources assistance.',recruitment:'Assistance with applications and joining.'};
const TICKET_ACCESS_ROLE=null;
module.exports={GUILD_ID,CHANNELS,ROLES,TYPES,TICKETS,TICKET_DESCRIPTIONS,TICKET_ACCESS_ROLE};
