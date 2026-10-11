# Server (not started)

Multiplayer lands after Prototype 0.1. Plan: Node.js + Colyseus, ~10 players per room,
server-authoritative using the same rules in `@9ja/shared` (`applyAction`, `worldTime`).
The client will send actions; the server validates them with `applyAction` and syncs state.
