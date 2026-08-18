import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { BRAND } from '../config/constants';
import { ProhibitedWord } from '../database/models';
import { isDatabaseAvailable } from '../database/connection';
import prohibitedWords, { addProhibitedWord, removeProhibitedWord, replaceProhibitedWords } from '../config/prohibitedWords';
import { legacyEmbedToV2Message } from '../utils/embeds';

const defaults = [...prohibitedWords];

export const prohibitedWordCommand = {
    data: new SlashCommandBuilder()
        .setName('prohibited-word')
        .setDescription('Manage the server prohibited-words list')
        .addSubcommand(command => command.setName('add').setDescription('Add a prohibited word or phrase')
            .addStringOption(option => option.setName('word').setDescription('Word or phrase').setRequired(true).setMaxLength(100)))
        .addSubcommand(command => command.setName('remove').setDescription('Remove a prohibited word or phrase')
            .addStringOption(option => option.setName('word').setDescription('Word or phrase').setRequired(true).setMaxLength(100)))
        .addSubcommand(command => command.setName('list').setDescription('List configured prohibited words')),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.guild || !(interaction.member instanceof GuildMember)
            || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: 'Only server administrators may manage prohibited words.', ephemeral: true });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'list') {
            const embed = new EmbedBuilder()
                .setColor(BRAND.color)
                .setTitle('Configured Prohibited Words')
                .setThumbnail(BRAND.logoUrl)
                .setDescription(prohibitedWords.length ? prohibitedWords.map(word => `• ${word}`).join('\n').slice(0, 4000) : 'No prohibited words are configured.')
                .setFooter({ text: BRAND.footer })
                .setTimestamp();
            await interaction.editReply(legacyEmbedToV2Message(embed));
            return;
        }

        const word = interaction.options.getString('word', true).trim().toLocaleLowerCase();
        if (!word || /[\r\n]/.test(word)) {
            await interaction.editReply('Enter one valid word or short phrase without line breaks.');
            return;
        }
        const adding = subcommand === 'add';
        const changed = adding ? addProhibitedWord(word) : removeProhibitedWord(word);
        let persisted = false;
        if (isDatabaseAvailable()) {
            await ProhibitedWord.findOneAndUpdate(
                { guildId: interaction.guild.id, word },
                { $set: { active: adding, createdBy: interaction.user.id, createdAt: new Date() } },
                { upsert: true, new: true },
            ).exec();
            persisted = true;
        }
        await interaction.editReply(`${changed ? (adding ? 'Added' : 'Removed') : (adding ? 'Already configured' : 'Not currently active')}: **${word}**.${persisted ? '' : ' This runtime change could not be persisted because the database is unavailable.'}`);
    },
};

export async function loadProhibitedWordOverrides(guildIds: readonly string[]): Promise<void> {
    replaceProhibitedWords(defaults);
    if (!isDatabaseAvailable() || guildIds.length === 0) return;
    const overrides = await ProhibitedWord.find({ guildId: { $in: guildIds } }).lean().exec();
    for (const override of overrides) {
        if (override.active === false) removeProhibitedWord(override.word);
        else addProhibitedWord(override.word);
    }
}
