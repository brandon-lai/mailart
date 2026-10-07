/**
 * The only source of randomness in the envelope package. Every generator and
 * recipe receives an Rng; nothing calls Math.random. Same seed, same envelope.
 */

/** FNV-1a 32-bit. Stable across runtimes, which is all a seed hash needs. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;
  constructor(seed: number | string) {
    this.state = typeof seed === "string" ? hash32(seed) : seed >>> 0;
  }

  /** mulberry32 */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error("pick from empty list");
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick: [[item, weight], ...] */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      if ((r -= w) < 0) return item;
    }
    return items[items.length - 1][0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** A seed for a child generator. Children never share a stream with parents. */
  seed(): number {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }

  /** Approximately normal, mean 0, sd 1 (sum of uniforms). */
  gauss(): number {
    return this.next() + this.next() + this.next() - 1.5;
  }
}

/** Seed for a letter's nth envelope option: hash(letterId + shuffleIndex). */
export function envelopeSeed(letterId: string, index: number): string {
  return `${letterId}:${index}`;
}
