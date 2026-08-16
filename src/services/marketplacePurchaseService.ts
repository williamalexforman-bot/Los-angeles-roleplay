export type PaidAdProductKey = 'paid-ad-everyone' | 'paid-ad-here';

export interface PaidAdProductConfig {
    key: PaidAdProductKey;
    label: string;
    pingType: 'everyone' | 'here';
    itemType: string;
    itemId: string;
}

export type RobloxOwnershipResult =
    | { ok: true; owned: boolean }
    | { ok: false; message: string };

function configuredProduct(
    key: PaidAdProductKey,
    label: string,
    pingType: 'everyone' | 'here',
    idEnv: string,
    typeEnv: string,
): PaidAdProductConfig | null {
    const itemId = (process.env[idEnv] || '').trim();
    if (!/^\d+$/.test(itemId)) return null;
    const itemType = (process.env[typeEnv] || 'gamepass').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(itemType)) return null;
    return { key, label, pingType, itemType, itemId };
}

/**
 * Product IDs are intentionally configuration-only so real Roblox purchase IDs
 * never need to be hard-coded. Configure these later on the bot host:
 * MARKETPLACE_PAID_AD_EVERYONE_ITEM_ID
 * MARKETPLACE_PAID_AD_HERE_ITEM_ID
 * Optional item type vars default to "gamepass".
 */
export function paidAdProducts(): PaidAdProductConfig[] {
    return [
        configuredProduct(
            'paid-ad-everyone',
            'Paid Ad — @everyone',
            'everyone',
            'MARKETPLACE_PAID_AD_EVERYONE_ITEM_ID',
            'MARKETPLACE_PAID_AD_EVERYONE_ITEM_TYPE',
        ),
        configuredProduct(
            'paid-ad-here',
            'Paid Ad — @here',
            'here',
            'MARKETPLACE_PAID_AD_HERE_ITEM_ID',
            'MARKETPLACE_PAID_AD_HERE_ITEM_TYPE',
        ),
    ].filter((value): value is PaidAdProductConfig => Boolean(value));
}

export async function robloxUserOwnsConfiguredItem(
    robloxUserId: string,
    product: PaidAdProductConfig,
): Promise<RobloxOwnershipResult> {
    if (!/^\d+$/.test(robloxUserId)) return { ok: false, message: 'Invalid Roblox user ID.' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const url = `https://inventory.roblox.com/v1/users/${encodeURIComponent(robloxUserId)}`
            + `/items/${encodeURIComponent(product.itemType)}/${encodeURIComponent(product.itemId)}/is-owned`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) {
            return { ok: false, message: `Roblox inventory returned HTTP ${response.status}.` };
        }
        const payload = await response.json().catch(() => null);
        if (typeof payload !== 'boolean') {
            return { ok: false, message: 'Roblox inventory returned an invalid ownership response.' };
        }
        return { ok: true, owned: payload };
    } catch {
        return { ok: false, message: 'Roblox inventory could not be reached.' };
    } finally {
        clearTimeout(timer);
    }
}
