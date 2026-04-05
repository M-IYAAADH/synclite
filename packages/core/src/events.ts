type EventMap = Record<string, unknown[]>

/**
 * Minimal type-safe event emitter. Used internally by NexSync and WebSocketManager.
 */
export class EventEmitter<T extends EventMap> {
  private listeners: { [K in keyof T]?: Array<(...args: T[K]) => void> } = {}

  on<K extends keyof T>(event: K, listener: (...args: T[K]) => void): this {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event]!.push(listener)
    return this
  }

  off<K extends keyof T>(event: K, listener: (...args: T[K]) => void): this {
    const arr = this.listeners[event]
    if (arr) {
      this.listeners[event] = arr.filter((l) => l !== listener) as typeof arr
    }
    return this
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    const arr = this.listeners[event]
    if (arr) {
      for (const listener of [...arr]) {
        listener(...args)
      }
    }
  }

  removeAllListeners<K extends keyof T>(event?: K): void {
    if (event) {
      delete this.listeners[event]
    } else {
      this.listeners = {}
    }
  }
}
