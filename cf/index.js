
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
	"users",
];

async function handleBatchCatalog(request, ctx) {
	const userIds = await request.json();
	if (!Array.isArray(userIds)) {
		return new Response("Invalid payload. Expected an array of UserIds.", { status: 400 });
	}

	const results = {};
	const cache = caches.default;

	await Promise.all(
		userIds.map(async (userId) => {
			const cacheKey = new Request(`https://tipjar-internal.local/user/${userId}`);
			const cachedRes = await cache.match(cacheKey);

			if (cachedRes) {
				results[userId] = await cachedRes.json();
				return;
			}

			const clothingUrl = `https://catalog.roblox.com/v1/search/items/details?CreatorTargetId=${userId}&CreatorType=1&Category=3`;
			const proxyRes = await fetch(clothingUrl);

			if (proxyRes.ok) {
				const rawData = await proxyRes.json();
				const formattedProducts = rawData.data
					.filter((item) => item.price !== null)
					.map((item) => ({
						Id: item.id,
						Type: "Clothing",
						Price: item.price,
					}));

				results[userId] = formattedProducts;

				const cacheResponse = new Response(JSON.stringify(formattedProducts), {
					headers: { "Cache-Control": "s-maxage=60", "Content-Type": "application/json" },
				});
				ctx.waitUntil(cache.put(cacheKey, cacheResponse));
			} else {
				results[userId] = [];
			}
		}),
	);

	return new Response(JSON.stringify(results), {
		headers: { "Content-Type": "application/json" },
	});
}

async function handleGetProxy(request) {
	const url = new URL(request.url);
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts.length < 2) {
		return new Response("Missing Roblox API path. Example: /friends/v1/users/1/followers/count", {
			status: 400,
		});
	}

	const subdomain = parts[0];
	if (!domains.includes(subdomain)) {
		return new Response(`Unknown domain: ${subdomain}`, { status: 404 });
	}

	const robloxPath = "/" + parts.slice(1).join("/");
	const targetUrl = `https://${subdomain}.roblox.com${robloxPath}${url.search}`;

	const proxyRes = await fetch(targetUrl, {
		method: "GET",
		headers: {
			Accept: "application/json",
			"User-Agent": "Roblox/WinInet",
		},
	});

	return new Response(proxyRes.body, {
		status: proxyRes.status,
		headers: {
			"Content-Type": proxyRes.headers.get("Content-Type") || "application/json",
		},
	});
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const isRoot = url.pathname === "/" || url.pathname === "";

		if (request.method === "GET" && !isRoot) {
			return handleGetProxy(request);
		}

		if (request.method === "POST" && isRoot) {
			try {
				return await handleBatchCatalog(request, ctx);
			} catch (error) {
				return new Response(JSON.stringify({ error: error.message }), { status: 500 });
			}
		}

		return new Response("Use POST / with [userIds] or GET /{domain}/v1/...", { status: 405 });
	},
};
