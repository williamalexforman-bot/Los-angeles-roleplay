const GUILD_ID = '1521905971004444743';
const CHANNELS = {
 welcome:'1521905971885248734', deployment:'1549277165617549382',
 infractions:'1521905972430241913', promotions:'1521905972128256240',
 tickets_general:'1521905971717210155', tickets_affairs:'1521905971717210157', tickets_high:'1521905971717210158',
 shiftLogs:null, activeShifts:null, transcripts:null, verification:null,
 ...Object.fromEntries(['messages','infractions','promotions','claims','roles','raids','moderation','members'].map(k=>['log_'+k,null])),
};
const ROLES = {
 strikes:['1543551522716262450','1543551599228751902'],
 warnings:['1544509652891475998','1544509655949246604'],
 retained:null, suspended:'1544510578913968148', termination:'1544509652891475998',
 blacklisted:'1540811483955335358', investigation:'1544815910802427944',
};
const TYPES = ['Warning','Strike','Suspension','Demotion','Termination','Under Investigation','Blacklisted'];
const TICKETS = {general:'General Support',affairs:'OPS Reports',high:'Administrative'};
const TICKET_ACCESS_ROLE = null;
module.exports={GUILD_ID,CHANNELS,ROLES,TYPES,TICKETS,TICKET_ACCESS_ROLE};
