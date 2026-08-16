import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    ChatInputCommandInteraction,
    GuildMember,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { savePersistentSecret } from '../services/persistentSecretStore';
import { logger } from '../utils/logger';

const DOCK_CONFIG_ROLE_ID = '1521593407850680401';
const ENV_PATH = path.resolve(process.cwd(), '.env');

async function hasDockConfigRole(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!interaction.guild) return false;

    const member = interaction.member;
    if (member instanceof GuildMember && member.roles.cache.has(DOCK_CONFIG_ROLE_ID)) return true;
    if (member && Array.isArray(member.roles) && member.roles.includes(DOCK_CONFIG_ROLE_ID)) return true;

    const fetched = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(fetched?.roles.cache.has(DOCK_CONFIG_ROLE_ID));
}

function quotedEnvValue(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function saveDockKeyLocally(key: string): Promise<boolean> {
    let current = '';
    try {
        current = await fs.readFile(ENV_PATH, 'utf8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') return false;
    }

    const lines = current.split(/\r?\n/).filter(line => !/^\s*DOCK_API_KEY\s*=/.test(line));
    while (lines.length && lines.at(-1) === '') lines.pop();
    lines.push(`DOCK_API_KEY=${quotedEnvValue(key)}`);
    lines.push('');

    try {
        await fs.writeFile(ENV_PATH, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
        await fs.chmod(ENV_PATH, 0o600).catch(() => undefined);
        return true;
    } catch {
        return false;
    }
}

export const dockConfigCommand = {
    data: new SlashCommandBuilder()
        .setName('dock-config')
        .setDescription('Configure the Dock API key for this bot')
        .setDMPermission(false)
        .setDefaultMemberPermissions(null)
        .addStringOption(option => option
            .setName('key')
            .setDescription('Your Dock API key')
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(500)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!await hasDockConfigRole(interaction)) {
            await interaction.editReply(`You need <@&${DOCK_CONFIG_ROLE_ID}> to use this command.`);
            return;
        }

        const key = interaction.options.getString('key', true).trim();
        if (!key || /[\r\n]/.test(key)) {
            await interaction.editReply('That Dock API key is not valid.');
            return;
        }

        try {
            process.env.DOCK_API_KEY = key;
            const [persisted, localSaved] = await Promise.all([
                savePersistentSecret('DOCK_API_KEY', key).catch(() => false),
                saveDockKeyLocally(key),
            ]);

            logger.info(`[Dock Config] Dock API key updated by Discord user ${interaction.user.id}; persistent=${persisted}; local=${localSaved}.`);

            if (persisted) {
                await interaction.editReply('✅ Dock API key activated and saved to encrypted persistent storage. Future bot updates/redeploys will restore it automatically.');
                return;
            }
            if (localSaved) {
                await interaction.editReply('✅ Dock API key activated and saved locally. MongoDB persistence was unavailable, so a full redeploy may require configuring it again.');
                return;
            }

            await interaction.editReply('✅ Dock API key activated for this running bot, but the host did not allow it to be saved.');
        } catch (error) {
            logger.warn(`[Dock Config] Could not save Dock API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
            await interaction.editReply('I could not save the Dock API key. The key was not shown or logged.');
        }
    },
};
