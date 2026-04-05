# NexSync Demo

Collaborative notes app demonstrating NexSync's offline-first sync.

## Run locally

```bash
# 1. Start the relay (from the monorepo root)
pnpm build
node packages/relay/dist/cli.js

# 2. In another terminal, start the demo
pnpm --filter @nexsync/demo dev
```

Open http://localhost:3000 and type in either window.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_RELAY_URL` | `ws://localhost:8080` | WebSocket relay URL |

## Deploy

Set `NEXT_PUBLIC_RELAY_URL` to your hosted relay URL (e.g. `wss://relay.nexsync.dev`),
then deploy to Vercel:

```bash
vercel --prod
```
