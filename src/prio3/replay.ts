import type { Report } from './types'

/**
 * Application-layer replay guard.
 *
 * draft-irtf-cfrg-vdaf-22 gives every report a fresh 16-byte nonce, but the VDAF
 * itself has no memory: preparation re-runs the same arithmetic over the same
 * shares and accepts a replayed report a second time, because every proof in it is
 * still correct. Refusing a nonce that has already been seen is the job of the
 * layer around the VDAF — in DAP, the aggregators' report store. This registry is
 * that layer for this lab, and it is the only thing here that stops a replay.
 */
export class NonceRegistry {
  private readonly seen = new Set<string>()

  static key(nonce: Uint8Array): string {
    return Array.from(nonce, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  has(report: Report): boolean {
    return this.seen.has(NonceRegistry.key(report.nonce))
  }

  /** Records a first sighting and returns true; returns false for a nonce already seen. */
  admit(report: Report): boolean {
    if (report.nonce.length !== 16) throw new RangeError('nonce must be exactly 16 bytes')
    const key = NonceRegistry.key(report.nonce)
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }

  get size(): number {
    return this.seen.size
  }

  clear(): void {
    this.seen.clear()
  }
}
