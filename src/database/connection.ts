import mongoose from 'mongoose';
import { logger } from '../utils/logger';

let available = false;

export async function connectDatabase(): Promise<boolean> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        logger.warn('MONGODB_URI is not configured; persistence will use the in-memory fallback.');
        return false;
    }
    if (!/^mongodb(?:\+srv)?:\/\//i.test(uri.trim())) {
        logger.warn('MONGODB_URI is not a valid MongoDB URI; persistence will use the in-memory fallback.');
        return false;
    }

    try {
        mongoose.set('strictQuery', true);
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
        available = true;
        logger.info('Connected to MongoDB.');
        mongoose.connection.on('disconnected', () => {
            available = false;
            logger.warn('MongoDB disconnected; optional features will degrade safely.');
        });
        mongoose.connection.on('connected', () => {
            available = true;
        });
        return true;
    } catch (error) {
        available = false;
        logger.error(`MongoDB connection unavailable (${error instanceof Error ? error.name : 'connection error'}); persistence will use the in-memory fallback.`);
        return false;
    }
}

export function isDatabaseAvailable(): boolean {
    return available && mongoose.connection.readyState === 1;
}

export async function disconnectDatabase(): Promise<void> {
    available = false;
    if (mongoose.connection.readyState === 0) return;
    try {
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB.');
    } catch (error) {
        logger.warn(`MongoDB shutdown encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
