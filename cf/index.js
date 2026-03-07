// Copyright (c) 2024 iiPython

// List of domains
// Would of preferred to use JSON, but CF doesn't allow `require("fs")`
const domains = [
    "apis",
    "assetdelivery",
    "avatar",
    "badges",
    "catalog",
    "chat",
    "contacts",
    "contentstore",
    "develop",
    "economy",
    "economycreatorstats",
    "followings",
    "friends",
    "games",
    "groups",
    "groupsmoderation",
    "inventory",
    "itemconfiguration",
    "locale",
    "notifications",
    "points",
    "presence",
    "privatemessages",
    "publish",
    "search",
    "thumbnails",
    "trades",
    "translations",
    "users"
]

// Export our request handler
export default {
    async fetch(request, env, ctx) {
        if (request.method !== "POST") {
            return new Response("Method not allowed. Use POST.", { status: 405 });
        }

        try {
            const userIds = await request.json();
            if (!Array.isArray(userIds)) {
                return new Response("Invalid payload. Expected an array of UserIds.", { status: 400 });
            }

            const results = {};
            const cache = caches.default;

            // Fetch all users in the batch in parallel
            await Promise.all(userIds.map(async (userId) => {
                // Create a unique cache key for this specific user
                const cacheKey = new Request(`https://tipjar-internal.local/user/${userId}`);
                let cachedRes = await cache.match(cacheKey);

                if (cachedRes) {
                    results[userId] = await cachedRes.json();
                    return;
                }

                // Fetch Clothing (Classic Shirts/Pants)
                const clothingUrl = `https://catalog.roblox.com/v1/search/items/details?CreatorTargetId=${userId}&CreatorType=1&Category=3`;
                // Fetch Gamepasses (Requires Games API first, but we will use the standard catalog for simplicity if they are listed)
                // Note: For full gamepass support, you usually query the universe ID first. We'll stick to catalog assets here to keep it fast.

                const proxyRes = await fetch(clothingUrl);

                if (proxyRes.ok) {
                    const rawData = await proxyRes.json();

                    // Format the items for the Luau script
                    const formattedProducts = rawData.data
                        .filter(item => item.price !== null) // Only get items on sale
                        .map(item => ({
                            Id: item.id,
                            Type: "Clothing",
                            Price: item.price
                        }));

                    results[userId] = formattedProducts;

                    // Cache this user's specific data for 60 seconds globally
                    const cacheResponse = new Response(JSON.stringify(formattedProducts), {
                        headers: { "Cache-Control": "s-maxage=60", "Content-Type": "application/json" }
                    });
                    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
                } else {
                    results[userId] = []; // Fallback to empty if Roblox errors out
                }
            }));

            return new Response(JSON.stringify(results), {
                headers: { "Content-Type": "application/json" }
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
    }
};