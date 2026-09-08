import { randomUUID } from 'node:crypto';
import {
    ActionRowBuilder,
    ChatInputCommandInteraction,
    Client,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { isDatabaseAvailable } from '../database/connection';
import { PaidAd } from '../database/marketplaceModels';
import { isPaidAdProduct, marketplaceProduct, paidAdProducts } from '../services/marketplacePurchaseService';
import { logger } from '../utils/logger';

const AD_CREATOR_ROLE_ID = '1521593407850680401';
const registeredClients = new WeakSet<Client>();

const SEND_DELAY_CHOICES = [
    { name: 'Send now', value: '0' },
    { name: 'In 15 minutes', value: '15' },
    { name: 'In 30 minutes', value: '30' },
    { name: 'In 1 hour', value: '60' },
    { name: 'In 3 hours', value: '180' },
    { name: 'In 6 hours', value: '360' },
    { name: 'In 12 hours', value: '720' },
    { name: 'In 24 hours', value: '1440' },
] as const;

function inviteIsValid(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && (url.hostname === 'discord.gg' || url.hostname === 'discord.com')
            && (url.hostname === 'discord.gg' || url.pathname.startsWith('/invite/'));
    } catch {
        return false;
    }
}

async function hasCreatorRole(interaction: ChatInputCommandInteraction | ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.guild) return false;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return Boolean(member?.roles.cache.has(AD_CREATOR_ROLE_ID));
}

function creatorModal(productKey: string, delayMinutes: number): ModalBuilder {
    const product = marketplaceProduct(productKey);
    return new ModalBuilder()
        .setCustomId(`role-ad:create:${productKey}:${delayMinutes}`)
        .setTitle((product?.label || 'Create Marketplace Ad').slice(0, 45))
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('server_name')
                    .setLabel('Server name')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('invite_link')
                    .setLabel('Discord invite link')
                    .setPlaceholder('https://discord.gg/example')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(500)
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('server_ad')
                    .setLabel('Full advertisement')
                    .setPlaceholder('Write the complete advertisement exactly how it should appear.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4_000)
                    .setRequired(true),
            ),
        );
}

function discordTimestamp(date: Date): string {
    const timestamp = Math.floor(date.getTime() / 1_000);
    return `<t:${timestamp}:F> (<t:${timestamp}:R>)`;
}

async function createRoleAd(interaction: ModalSubmitInteraction, productKey: string, delayMinutes: number): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!await hasCreatorRole(interaction)) {
        await interaction.editReply(`You need <@&${AD_CREATOR_ROLE_ID}> to create marketplace advertisements.`);
        return;
    }
    if (!interaction.guildId) {
        await interaction.editReply('Marketplace advertisements can only be created inside the server.');
        return;
    }
    if (!isDatabaseAvailable()) {
        await interaction.editReply('The advertisement scheduler is temporarily unavailable while secure storage reconnects.');
        return;
    }

    const product = marketplaceProduct(productKey);
    if (!product || !isPaidAdProduct(product)) {
        await interaction.editReply('That marketplace advertisement type is not available.');
        return;
    }

    const serverName = interaction.fields.getTextInputValue('server_name').trim();
    const inviteLink = interaction.fields.getTextInputValue('invite_link').trim();
    const advertisement = interaction.fields.getTextInputValue('server_ad').trim();
    if (!inviteIsValid(inviteLink)) {
        await interaction.editReply('Please use a valid Discord invite such as `https://discord.gg/example`.');
        return;
    }

    const safeDelay = Math.max(0, Math.min(10_080, Math.floor(delayMinutes)));
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + safeDelay * 60_000);
    const adId = randomUUID();

    await PaidAd.create({
        adId,
        guildId: interaction.guildId,
        ownerDiscordId: interaction.user.id,
        robloxUserId: 'role-created',
        ticketChannelId: interaction.channelId,
        baseClaimId: `role-ad:${adId}`,
        productKey: product.key,
        productLabel: `${product.label} • Staff Created`,
        pingType: product.pingType,
        sponsored: product.sponsored,
        serverName,
        inviteLink,
        advertisement,
        status: 'scheduled',
        priority: false,
        instant: safeDelay === 0,
        scheduledFor,
        createdAt: now,
        updatedAt: now,
    });

    logger.info(`[RoleAdCreator] ${interaction.user.id} scheduled ${adId} (${product.key}) for ${scheduledFor.toISOString()}.`);
    await interaction.editReply([
        '✅ **Marketplace advertisement created.**',
        `**Type:** ${product.label}`,
        `**Server:** ${serverName}`,
        `**Sends:** ${discordTimestamp(scheduledFor)}`,
        `**Ad ID:** \`${adId}\``,
    ].join('\n'));
}

export async function handleRoleAdModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('role-ad:create:')) return false;
    const parts = interaction.customId.split(':');
    const productKey = parts[2] || '';
    const delayMinutes = Number(parts[3]);
    if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
        await interaction.reply({ content: 'That advertisement schedule is invalid.', flags: MessageFlags.Ephemeral });
        return true;
    }

    try {
        await createRoleAd(interaction, productKey, delayMinutes);
    } catch (error) {
        logger.error(`[RoleAdCreator] Could not create marketplace ad: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        const message = 'The marketplace advertisement could not be created. Please try again.';
        if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => undefined);
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return true;
}

export function registerRoleAdCreatorRuntime(client: Client): void {
    if (registeredClients.has(client)) return;
    registeredClients.add(client);
    client.on('interactionCreate', interaction => {
        if (!interaction.isModalSubmit() || !interaction.customId.startsWith('role-ad:')) return;
        void handleRoleAdModal(interaction).catch(error => {
            logger.error(`[RoleAdCreator] Modal router failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        });
    });
    logger.info(`[RoleAdCreator] Role ${AD_CREATOR_ROLE_ID} can create and schedule marketplace ads with /make-ad.`);
}

export const roleAdCreatorCommand = {
    data: new SlashCommandBuilder()
        .setName('make-ad')
        .setDescription('Create and schedule a marketplace advertisement')
        .setDMPermission(false)
        .addStringOption(option => option
            .setName('type')
            .setDescription('Which marketplace advertisement style to create')
            .setRequired(true)
            .addChoices(...paidAdProducts().map(product => ({ name: product.label, value: product.key }))))
        .addStringOption(option => option
            .setName('send-when')
            .setDescription('Choose when the advertisement should be sent')
            .setRequired(true)
            .addChoices(...SEND_DELAY_CHOICES)),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!await hasCreatorRole(interaction)) {
            await interaction.reply({
                content: `You need <@&${AD_CREATOR_ROLE_ID}> to use /make-ad.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const productKey = interaction.options.getString('type', true);
        const delayMinutes = Number(interaction.options.getString('send-when', true));
        const product = marketplaceProduct(productKey);
        if (!product || !isPaidAdProduct(product) || !Number.isFinite(delayMinutes)) {
            await interaction.reply({ content: 'That marketplace advertisement option is invalid.', flags: MessageFlags.Ephemeral });
            return;
        }

        try {
            await interaction.showModal(creatorModal(productKey, delayMinutes));
        } catch (error) {
            logger.error(`[RoleAdCreator] Could not open /make-ad modal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'I could not open the advertisement form. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => undefined);
            }
        }
    },
};
