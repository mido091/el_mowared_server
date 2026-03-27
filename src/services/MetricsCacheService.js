class MetricsCacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTtlMs = 60 * 1000;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });

    return value;
  }

  invalidate(keyOrPrefix) {
    for (const key of this.cache.keys()) {
      if (key === keyOrPrefix || key.startsWith(`${keyOrPrefix}:`)) {
        this.cache.delete(key);
      }
    }
  }

  withCache(key, compute, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null) return Promise.resolve(cached);

    return Promise.resolve(compute()).then((value) => this.set(key, value, ttlMs));
  }
}

export default new MetricsCacheService();
