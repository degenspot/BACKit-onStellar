# Caching Layer (Feed + Profile) - Implementation Checklist

- [ ] Install and configure `cache-manager-redis-store`.
- [ ] Update `src/app.module.ts` to configure `CacheModule` with Redis via `REDIS_URL` and fall back to in-memory when Redis is unavailable.
- [ ] Add endpoint caching interceptors/keys + TTLs:
  - [ ] Cache `GET /calls/feed` for 30s
  - [ ] Cache `GET /users/:address` for 5m
  - [ ] Cache `GET /leaderboard` for 2m
- [ ] Implement cache invalidation:
  - [ ] Clear feed cache when a new call/stake is indexed (find indexing hook in `src/indexer/`).
  - [ ] Clear profile cache on profile update (find profile update handler and delete matching cache keys).
- [ ] Add unit tests verifying cache hit/miss + invalidation.
- [ ] Run `pnpm test` (and optionally build) for backend.
