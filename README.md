# rbxproxy

Proxy for Roblox info fetching from in-game `HttpService`.

## Endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET` | `/{domain}/v1/...` | — | Forward to `https://{domain}.roblox.com/v1/...` |
| `POST` | `/` | JSON `[userId, ...]` | Batch catalog clothing products |
| `POST` | `/batch/social` | JSON `[userId, ...]` (max 10) | Batch friends / followers / following counts |

### `POST /batch/social`

Returns:

```json
{
  "123": { "friends": 42, "followers": 100, "following": 50 },
  "456": null
}
```

- Processes up to 10 userIds per request
- Bounded concurrency (3 users at a time)
- Failed users are `null` (partial success)
- Response may include `Cache-Control: s-maxage=1800`
