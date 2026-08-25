export type MarketplaceProductKey =
    | 'sponsored-here'
    | 'instant-post'
    | 'paid-ad-everyone'
    | 'paid-ad-here'
    | 'sponsored-everyone'
    | 'priority';

export type PaidAdProductKey = Exclude<MarketplaceProductKey, 'instant-post' | 'priority'>;
export type MarketplaceAddOnKey = Extract<MarketplaceProductKey, 'instant-post' | 'priority'>;

export interface MarketplaceProductConfig {
    key: MarketplaceProductKey;
    label: string;
    description: string;
    price: number;
    itemType: 'gamepass';
    itemId: string;
    purchaseUrl: string;
    kind: 'paid-ad' | 'add-on';
    pingType?: 'everyone' | 'here';
    sponsored?: boolean;
}

export type PaidAdProductConfig = MarketplaceProductConfig & {
    key: PaidAdProductKey;
    kind: 'paid-ad';
    pingType: 'everyone' | 'here';
    sponsored: boolean;
};

export type RobloxOwnershipResult =
    | { ok: true; owned: boolean }
    | { ok: false; message: string };

const PRODUCTS: readonly MarketplaceProductConfig[] = [
    {
        key: 'sponsored-here',
        label: 'Sponsored — @here',
        description: 'A sponsored advertisement that notifies everyone currently online.',
        price: 350,
        itemType: 'gamepass',
        itemId: '1955281739',
        purchaseUrl: 'https://www.roblox.com/game-pass/1955281739/here-sponsored',
        kind: 'paid-ad',
        pingType: 'here',
        sponsored: true,
    },
    {
        key: 'instant-post',
        label: 'Instant Post',
        description: 'Publish one queued advertisement immediately instead of waiting for its scheduled slot.',
        price: 1_500,
        itemType: 'gamepass',
        itemId: '1954897792',
        purchaseUrl: 'https://www.roblox.com/game-pass/1954897792/Instant-Post',
        kind: 'add-on',
    },
    {
        key: 'paid-ad-everyone',
        label: 'Paid Ad — @everyone',
        description: 'A paid advertisement that notifies everyone in the server.',
        price: 800,
        itemType: 'gamepass',
        itemId: '1955011806',
        purchaseUrl: 'https://www.roblox.com/game-pass/1955011806/everyone-PAID-AD',
        kind: 'paid-ad',
        pingType: 'everyone',
        sponsored: false,
    },
    {
        key: 'paid-ad-here',
        label: 'Paid Ad — @here',
        description: 'A paid advertisement that notifies everyone currently online.',
        price: 450,
        itemType: 'gamepass',
        itemId: '1954819787',
        purchaseUrl: 'https://www.roblox.com/game-pass/1954819787/here-paid-ad',
        kind: 'paid-ad',
        pingType: 'here',
        sponsored: false,
    },
    {
        key: 'sponsored-everyone',
        label: 'Sponsored — @everyone',
        description: 'A sponsored advertisement that notifies everyone in the server.',
        price: 650,
        itemType: 'gamepass',
        itemId: '1955581700',
        purchaseUrl: 'https://www.roblox.com/game-pass/1955581700/everyone-sponsored',
        kind: 'paid-ad',
        pingType: 'everyone',
        sponsored: true,
    },
    {
        key: 'priority',
        label: 'Priority',
        description: 'Move one scheduled advertisement to the front of the waiting list.',
        price: 1_000,
        itemType: 'gamepass',
        itemId: '1956096571',
        purchaseUrl: 'https://www.roblox.com/game-pass/1956096571/Priority',
        kind: 'add-on',
    },
] as const;

export function marketplaceProducts(): MarketplaceProductConfig[] {
    return PRODUCTS.map(product => ({ ...product }));
}

export function marketplaceProduct(key: string): MarketplaceProductConfig | undefined {
    return PRODUCTS.find(product => product.key === key);
}

export function paidAdProducts(): PaidAdProductConfig[] {
    return PRODUCTS.filter((product): product is PaidAdProductConfig => product.kind === 'paid-ad');
}

export function isPaidAdProduct(product: MarketplaceProductConfig): product is PaidAdProductConfig {
    return product.kind === 'paid-ad';
}

export async function robloxUserOwnsConfiguredItem(
    robloxUserId: string,
    product: MarketplaceProductConfig,
    fetchImpl: typeof fetch = fetch,
): Promise<RobloxOwnershipResult> {
    if (!/^\d+$/.test(robloxUserId)) return { ok: false, message: 'Invalid Roblox user ID.' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const url = `https://inventory.roblox.com/v1/users/${encodeURIComponent(robloxUserId)}`
            + `/items/${encodeURIComponent(product.itemType)}/${encodeURIComponent(product.itemId)}/is-owned`;
        const response = await fetchImpl(url, {
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

export async function ownedMarketplaceProducts(
    robloxUserId: string,
    fetchImpl: typeof fetch = fetch,
): Promise<{ products: MarketplaceProductConfig[]; failures: string[] }> {
    const results = await Promise.all(PRODUCTS.map(async product => ({
        product,
        result: await robloxUserOwnsConfiguredItem(robloxUserId, product, fetchImpl),
    })));
    return {
        products: results
            .filter(result => result.result.ok && result.result.owned)
            .map(result => result.product),
        failures: results
            .filter(result => !result.result.ok)
            .map(result => result.result.ok ? '' : result.result.message),
    };
}
