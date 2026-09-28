import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { postTicketPanel } from './tickets';

export const data = new SlashCommandBuilder()
    .setName('verify-message')
    .setDescription('Legacy alias: post the professional LARP ticket panel');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await postTicketPanel(interaction);
}

