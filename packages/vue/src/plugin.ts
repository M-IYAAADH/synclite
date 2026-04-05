import { type App, type InjectionKey } from 'vue'
import { NexSync, type NexSyncConfig } from '@nexsync/core'

/** Injection key used to share the NexSync instance via Vue's provide/inject. */
export const SYNCLITE_KEY: InjectionKey<NexSync> = Symbol('nexsync')

/**
 * Create a Vue plugin that installs NexSync globally.
 *
 * @example
 * ```ts
 * import { createApp } from 'vue'
 * import { createNexSync } from '@nexsync/vue'
 *
 * const app = createApp(App)
 * app.use(createNexSync({ relay: 'wss://relay.example.com', appId: 'my-app' }))
 * app.mount('#app')
 * ```
 */
export function createNexSync(config: NexSyncConfig): { install(app: App): void } {
  return {
    install(app: App) {
      const db = new NexSync(config)
      app.provide(SYNCLITE_KEY, db)
    },
  }
}
