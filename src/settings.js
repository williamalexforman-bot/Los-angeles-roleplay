const GUILD_ID='1521385783477407847';
const CHANNELS={
 roleRequests:null,
 welcome:'1521502153942892687',deployment:null,
 ticketPanel:'1545944377019596800',tickets:'1521385784622579726',
 tickets_general:'1521385784622579726',tickets_affairs:'1521385784622579725',tickets_high:'1521588452041294066',
 infractions:'1521385785020907600',promotions:'1521385785020907599',transcripts:'1521385785532878911',appeals:null,
 information:'1521385784622579729',employeeInfo:'1546638883725385870',oiaInfo:null,applicationPanel:'1545944891316510740',applicationResults:'1545945073882234900',verification:'1521568855791767768',cadetInfo:'1521385784878563424',shiftLogs:'1521385785020907600',
 log_bot:'1521385785532878913',log_claims:'1521385785532878913',log_tickets:'1521385785532878913',log_infractions:'1521385785532878913',
 ...Object.fromEntries(['messages','promotions','roles','raids','moderation','members'].map(k=>['log_'+k,'1521385785532878913'])),
};
// No old-server role IDs are permitted to affect the new server.
const ROLES={warnings:[],strikes:[],retained:null,suspended:null,termination:null,blacklisted:null,investigation:null};
const TYPES=['Warning','Strike','Suspension','Demotion','Termination','Under Investigation','Blacklisted'];
const TICKETS={general:'General Support',affairs:'Internal Affairs',high:'Office of the Chief'};
const TICKET_DESCRIPTIONS={general:'General questions, assistance, technical issues, and department requests.',affairs:'Complaints, conduct concerns, policy violations, or confidential internal review.',high:'Command-level matters, department concerns, appeals, or Chief Office support.'};
const TICKET_ACCESS_ROLE=null;
module.exports={GUILD_ID,CHANNELS,ROLES,TYPES,TICKETS,TICKET_DESCRIPTIONS,TICKET_ACCESS_ROLE};
