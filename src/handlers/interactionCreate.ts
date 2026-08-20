// Emergency-stable interaction entrypoint.
//
// The previous router imported every feature module at startup. One broken
// optional module could therefore prevent Activity Check, Tickets,
// Applications, and every slash command from responding. The stable router
// lazy-loads features independently so failures stay isolated.
export { interactionCreateStable as interactionCreate } from './interactionCreateStable';
