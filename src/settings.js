const CHANNELS = {
  tickets: '1538594178467110942', infractions: '1538399223307829280',
  promotions: '1538399164780511332', deployment: '1538399056986906715',
  shiftLogs: '1538399655438581810', activeShifts: '1538399713378832426',
  transcripts: '1538594354137141260',
};
const ROLES = {
  strikes: ['1538589320976535763', '1538589385413632031'],
  warnings: ['1538589408016470077', '1538589426656219177'],
  retained: '1538401039684866143', suspended: '1538589270795882516',
};
const TYPES = ['Warning', 'Strike', 'Suspension', 'Demotion', 'Termination', 'Under Investigation', 'Blacklisted'];
const TICKETS = { general: 'General Support', affairs: 'Internal Affairs', high: 'High Rank' };
const TICKET_ACCESS_ROLE = '1538395250312093768';
module.exports = { TICKET_ACCESS_ROLE, CHANNELS, ROLES, TYPES, TICKETS };
