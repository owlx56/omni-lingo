// 最小 LRU：依赖 Map 保留插入顺序。
// get 命中时删后重插即"升到最新"；满员时 keys().next() 就是最老的。

export class LRU<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly cap: number) {
    if (cap <= 0) throw new Error("LRU cap must be > 0");
  }

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) {
      this.map.delete(k);
    } else if (this.map.size >= this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, v);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
