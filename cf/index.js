
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

const MAX_BATCH_SOCIAL_USERS = 10;
const SOCIAL_USER_CONCURRENCY = 3;

async function mapPool(items, concurrency, mapper) {
	const results = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index], index);
		}
	}

	const workers = [];
	const workerCount = Math.min(concurrency, items.length);
	for (let i = 0; i < workerCount; i++) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return results;
}

async function fetchJson(url) {
	const proxyRes = await fetch(url, {
		method: "GET",
		headers: {
			Accept: "application/json",
			"User-Agent": "Roblox/WinInet",
		},
	});
	if (!proxyRes.ok) {
		return null;
	}
	try {
		return await proxyRes.json();
	} catch {
		return null;
	}
}

function readCount(payload) {
	if (payload && typeof payload.count === "number") {
		return Math.max(0, Math.floor(payload.count));
	}
	return null;
}

async function fetchSocialCountsForUser(userId) {
	const uid = String(Math.floor(Number(userId)));
	if (!uid || uid === "NaN") {
		return null;
	}

	const [friendsPayload, followersPayload, followingsPayload] = await Promise.all([
		fetchJson(`https://friends.roblox.com/v1/users/${uid}/friends/count`),
		fetchJson(`https://friends.roblox.com/v1/users/${uid}/followers/count`),
		fetchJson(`https://friends.roblox.com/v1/users/${uid}/followings/count`),
	]);

	let following = readCount(followingsPayload);
	if (following == null) {
		following = readCount(await fetchJson(`https://friends.roblox.com/v1/users/${uid}/following/count`));
	}

	const friends = readCount(friendsPayload);
	const followers = readCount(followersPayload);

	if (friends == null && followers == null && following == null) {
		return null;
	}

	return {
		friends,
		followers,
		following,
	};
}

async function handleBatchSocial(request) {
	const userIds = await request.json();
	if (!Array.isArray(userIds)) {
		return new Response("Invalid payload. Expected an array of UserIds.", { status: 400 });
	}

	const limited = userIds.slice(0, MAX_BATCH_SOCIAL_USERS);
	const results = {};

	await mapPool(limited, SOCIAL_USER_CONCURRENCY, async (userId) => {
		const key = String(Math.floor(Number(userId)));
		try {
			results[key] = await fetchSocialCountsForUser(userId);
		} catch {
			results[key] = null;
		}
	});

	return new Response(JSON.stringify(results), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "s-maxage=1800",
		},
	});
}

async function handleBatchCatalog(request, ctx) {
	const userIds = await request.json();
	if (!Array.isArray(userIds)) {
		return new Response("Invalid payload. Expected an array of UserIds.", { status: 400 });
	}

	const results = {};
	const cache = caches.default;
	const limited = userIds.slice(0, MAX_BATCH_SOCIAL_USERS);

	await mapPool(limited, SOCIAL_USER_CONCURRENCY, async (userId) => {
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
	});

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
		const isBatchSocial = url.pathname === "/batch/social" || url.pathname === "/batch/social/";

		if (request.method === "GET" && !isRoot) {
			return handleGetProxy(request);
		}

		if (request.method === "POST" && isBatchSocial) {
			try {
				return await handleBatchSocial(request);
			} catch (error) {
				return new Response(JSON.stringify({ error: error.message }), { status: 500 });
			}
		}

		if (request.method === "POST" && isRoot) {
			try {
				return await handleBatchCatalog(request, ctx);
			} catch (error) {
				return new Response(JSON.stringify({ error: error.message }), { status: 500 });
			}
		}

		return new Response("Use POST / with [userIds], POST /batch/social with [userIds], or GET /{domain}/v1/...", {
			status: 405,
		});
	},
};
