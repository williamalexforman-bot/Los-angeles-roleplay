import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { BotSecret } from '../database/botSecretModel';
import { isDatabaseAvailable } from '../database/connection';
import { getDiscordBotToken } from '../config/env';
import { logger } from '../utils/logger';

const ALGORITHM = 'aes-256-gcm';

function encryptionKey(): Buffer | null {
    const token = getDiscordBotToken();
    if (!token) return null;
    return createHash('sha256').update(`larp-persistent-secret:${token}`, 'utf8').digest();
}

export async function savePersistentSecret(name: string, value: string): Promise<boolean> {
    if (!isDatabaseAvailable()) return false;
    const key = encryptionKey();
    if (!key) return false;

    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    await BotSecret.findOneAndUpdate(
        { name },
        {
            $set: {
                ciphertext: ciphertext.toString('base64'),
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64'),
                updatedAt: new Date(),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec();
    return true;
}

export async function loadPersistentSecret(name: string): Promise<string | null> {
    if (!isDatabaseAvailable()) return null;
    const key = encryptionKey();
    if (!key) return null;

    const record = await BotSecret.findOne({ name }).lean().exec();
    if (!record) return null;

    try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(record.ciphertext, 'base64')),
            decipher.final(),
        ]).toString('utf8').trim();
        return plaintext || null;
    } catch (error) {
        logger.warn(`[Secrets] Could not decrypt ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}
