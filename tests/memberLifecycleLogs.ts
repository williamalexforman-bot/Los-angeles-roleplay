import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { buildMemberJoinPayload } from '../src/events/memberLifecycleLogs';

const createdAt = Date.UTC(2020, 0, 2, 3, 4, 5);
const joinedAt = Date.UTC(2026, 7, 25, 12, 30, 0);
const payload = buildMemberJoinPayload({
    userId: '123456789012345678',
    username: 'AccurateDateUser',
    accountCreatedTimestamp: createdAt,
    joinedTimestamp: joinedAt,
    memberCount: 12_345,
});
const serialized = JSON.stringify(payload.components[0].toJSON());

assert.equal(payload.flags, MessageFlags.IsComponentsV2);
assert.match(serialized, new RegExp(`<t:${Math.floor(createdAt / 1_000)}:F>`));
assert.match(serialized, new RegExp(`<t:${Math.floor(joinedAt / 1_000)}:F>`));
assert.match(serialized, /12,345/);
assert.equal(payload.files.length, 2);

console.log('[Member Join Test] Native V2 payload and Discord-provided account creation timestamp passed.');
