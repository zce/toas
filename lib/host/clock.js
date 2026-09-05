/**
 * Monotonic clock for runtime.
 */

import GLib from 'gi://GLib'

export class MonotonicClock {
  now () {
    return GLib.get_monotonic_time() / 1000 // Convert microseconds to milliseconds
  }
}
