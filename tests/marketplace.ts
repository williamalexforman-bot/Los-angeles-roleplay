import assert from 'node:assert/strict';
import { paidAdCommand, buildPublishedPaidAdPanel } from '../src/commands/paidAds';
import {
    buildMarketplacePanel,
    decodeMarketplaceTicketMetadata,
    encodeMarketplaceTicketMetadata,
    handleMarketplaceSelect,
    marketplaceCategoryProducts,
} from '../src/commands/marketplace';
import { resolveMelonlyRobloxProfile } from '../src/services/melonlyVerificationService';
import {
    marketplaceProducts,
    ownedMarketplaceProducts,
    robloxUserOwnsConfiguredItem,
} from '../src/services/marketplacePurchaseService';

async function run(): Promise<void> {
    const products = marketplaceProducts();
    assert.deepEqual(products.map(product => [product.key, product.itemId]), [
        ['sponsored-here', '1955281739'],
        ['instant-post', '1954897792'],
        ['paid-ad-everyone', '1955011806'],
        ['paid-ad-here', '1954819787'],
        ['sponsored-everyone', '1955581700'],
        ['priority', '1956096571'],
        ['small-donation', '1956206563'],
        ['medium-donation', '1953387997'],
        ['large-donation', '1955515772'],
        ['extra-large-donation', '1957626275'],
    ]);
    assert(products.every(product => product.purchaseUrl.includes(`/game-pass/${product.itemId}/`)));
    assert.deepEqual(
        marketplaceCategoryProducts('donations').map(product => [product.key, product.price]),
        [
            ['small-donation', 100],
            ['medium-donation', 400],
            ['large-donation', 800],
            ['extra-large-donation', 1_200],
        ],
    );
    assert.deepEqual(
        marketplaceCategoryProducts('paid-ads').map(product => product.key),
        ['sponsored-here', 'instant-post', 'paid-ad-everyone', 'paid-ad-here', 'sponsored-everyone', 'priority'],
    );

    const marketplaceJson = JSON.stringify(buildMarketplacePanel().toJSON());
    assert(marketplaceJson.includes("Hello! Welcome to Los Angeles Roleplay's Marketplace"));
    assert(marketplaceJson.includes('marketplace:browse'));
    assert(marketplaceJson.includes('marketplace:claim'));
    assert(marketplaceJson.indexOf('marketplace:browse') < marketplaceJson.indexOf('marketplace:claim'),
        'the claim button should appear below the marketplace dropdown');

    let browseReply: any = null;
    assert.equal(await handleMarketplaceSelect({
        customId: 'marketplace:browse',
        values: ['donations'],
        reply: async (payload: unknown) => { browseReply = payload; },
    } as never), true);
    assert(String(browseReply.content).includes('Donations'));
    assert.deepEqual(
        browseReply.components[0].toJSON().components[0].options.map((option: { value: string }) => option.value),
        ['small-donation', 'medium-donation', 'large-donation', 'extra-large-donation'],
    );

    let productUpdate: any = null;
    assert.equal(await handleMarketplaceSelect({
        customId: 'marketplace:products:donations',
        values: ['medium-donation'],
        update: async (payload: unknown) => { productUpdate = payload; },
    } as never), true);
    assert(String(productUpdate.content).includes('R$400'));
    assert.equal(
        productUpdate.components[1].toJSON().components[0].url,
        'https://www.roblox.com/game-pass/1953387997/Medium-Donation',
    );

    let ownershipUrl = '';
    const ownership = await robloxUserOwnsConfiguredItem('123456', products[0], async input => {
        ownershipUrl = String(input);
        return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    assert.deepEqual(ownership, { ok: true, owned: true });
    assert.equal(ownershipUrl, 'https://inventory.roblox.com/v1/users/123456/items/gamepass/1955281739/is-owned');

    const owned = await ownedMarketplaceProducts('123456', async input => {
        const isOwned = String(input).includes('/1955011806/');
        return new Response(JSON.stringify(isOwned), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    assert.deepEqual(owned.products.map(product => product.key), ['paid-ad-everyone']);
    assert.deepEqual(owned.failures, []);

    const melonlyRequests: Array<{ url: string; authorization?: string }> = [];
    const melonly = await resolveMelonlyRobloxProfile('1489388257925005511', {
        apiKey: 'test-token',
        baseUrl: 'https://api.melonly.xyz/api/v1/',
        fetchImpl: async (input, init) => {
            melonlyRequests.push({
                url: String(input),
                authorization: new Headers(init?.headers).get('Authorization') || undefined,
            });
            if (String(input).includes('/verification/')) {
                return new Response(JSON.stringify({ robloxId: '987654321', userId: 'member-1' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ name: 'VerifiedBuyer', displayName: 'Buyer' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    assert(melonly.ok);
    if (melonly.ok) {
        assert.equal(melonly.profile.robloxId, '987654321');
        assert.equal(melonly.profile.username, 'VerifiedBuyer');
    }
    assert.equal(melonlyRequests[0].url, 'https://api.melonly.xyz/api/v1/verification/discord/1489388257925005511/roblox');
    assert.equal(melonlyRequests[0].authorization, 'Bearer test-token');

    const metadata = {
        ownerId: '1489388257925005511',
        type: 'management' as const,
        createdAt: new Date().toISOString(),
        marketplace: { claimIds: ['claim-1', 'claim-2'], robloxUserId: '987654321' },
    };
    assert.deepEqual(decodeMarketplaceTicketMetadata(encodeMarketplaceTicketMetadata(metadata)), metadata);
    assert.equal(decodeMarketplaceTicketMetadata('larp-ticket:invalid'), null);

    const paidAdSchema = paidAdCommand.data.toJSON() as { options?: Array<{ name: string }> };
    assert.deepEqual(paidAdSchema.options?.map(option => option.name), ['create', 'instant', 'priority', 'queue']);

    let modalJson: any = null;
    await paidAdCommand.execute({
        user: { id: metadata.ownerId },
        channel: { topic: encodeMarketplaceTicketMetadata(metadata) },
        options: {
            getSubcommand: () => 'create',
            getString: () => 'paid-ad-everyone',
        },
        showModal: async (modal: { toJSON(): unknown }) => { modalJson = modal.toJSON(); },
    } as never);
    assert.equal(modalJson.custom_id, 'paid-ad:create:paid-ad-everyone');
    assert.deepEqual(
        modalJson.components.map((row: { components: Array<{ custom_id: string }> }) => row.components[0].custom_id),
        ['server_name', 'invite_link', 'server_ad'],
    );

    const published = buildPublishedPaidAdPanel({
        adId: 'ad-test-1',
        serverName: 'Example Server',
        inviteLink: 'https://discord.gg/example',
        advertisement: 'Full advertisement with an unauthorized @here mention',
        pingType: 'everyone',
        sponsored: false,
    }).toJSON();
    assert(JSON.stringify(published).includes('@everyone'));
    assert(JSON.stringify(published).includes('Full advertisement'));
    assert(JSON.stringify(published).includes('ad-test-1'));
    assert(!JSON.stringify(published).includes('unauthorized @here'),
        'buyer-provided ad text must not be able to add a second broadcast ping');

    console.log('Marketplace tests passed.');
}

void run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
