import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import {
    buildGiveawayPanel,
    giveawayCommand,
    parseGiveawayDuration,
    pickGiveawayWinners,
} from '../src/commands/giveaway';

assert.equal(giveawayCommand.data.name, 'giveaway');

assert.equal(parseGiveawayDuration('30m'), 30 * 60_000);
assert.equal(parseGiveawayDuration('2 hours'), 2 * 60 * 60_000);
assert.equal(parseGiveawayDuration('1d 12h'), 36 * 60 * 60_000);
assert.equal(parseGiveawayDuration('1h30m'), 90 * 60_000);
assert.equal(parseGiveawayDuration('tomorrow'), null);
assert.equal(parseGiveawayDuration('1h later'), null);

const winners = pickGiveawayWinners(['one', 'one', 'two'], 20);
assert.equal(winners.length, 2);
assert.equal(new Set(winners).size, winners.length);

const activePanel = buildGiveawayPanel({
    hostId: 'host',
    prize: 'Los Angeles VIP',
    winnerCount: 2,
    endsAt: new Date('2030-01-01T00:00:00.000Z'),
    entrantIds: ['one', 'two'],
    winnerIds: [],
    status: 'active',
}).toJSON() as any;
assert.equal(activePanel.components[0].type, 12, 'the giveaway must start with a V2 media gallery');
assert.equal(activePanel.components.some((component: any) => component.type === 1), true, 'the giveaway needs an entry button row');
assert.equal(MessageFlags.IsComponentsV2, 32768);

const endedJson = JSON.stringify(buildGiveawayPanel({
    hostId: 'host',
    prize: 'Los Angeles VIP',
    winnerCount: 1,
    endsAt: new Date('2030-01-01T00:00:00.000Z'),
    entrantIds: ['winner'],
    winnerIds: ['winner'],
    status: 'ended',
    endedAt: new Date('2030-01-01T00:00:01.000Z'),
}).toJSON());
assert.match(endedJson, /winner/);
assert.match(endedJson, /Giveaway Ended/);

console.log('[Giveaway Test] Duration parsing, unique winner selection, and Components V2 panels passed.');
