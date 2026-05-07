---
"@openturn/core": minor
"@openturn/gamekit": minor
---

Two TypeScript tightenings for games that declare a config schema:

`GameDefinition.config` is now non-undefined when declared. Previously, accessing `game.config` after `defineGame({ config: { ... } })` typed as `Schema | undefined` — consumers like `<LobbyWithBots configSchema={game.config}>` had to use `game.config!` to satisfy the prop's `ConfigSchema` type. The interface now uses a conditional `ConfigFieldFor<TConfig>` that narrows: when `TConfig extends ConfigSchema`, the field is required and typed as the narrow schema; when `TConfig` is `undefined` (default), the field is absent. Games without `config` keep working unchanged; games that declare it can now pass `game.config` directly without `!`.

Gamekit `phases:` accepts a callback form for typed `phase.onTimeout` dispatch:

```ts
defineGame({
  moves: ({ move }) => ({ place: move.exec({ args: { x: number }, ... }) }),
  phases: ({ moves }) => ({           // NEW callback form
    play: {
      deadline: ctx => deadline.after(ctx, ctx.match.config.turnTimeoutMs),
      onTimeout: (ctx, moves) => moves.place({ x: 5 }),  // typed dispatch
    },
  }),
});
```

The existing object-literal form (`phases: { play: { ... } }`) continues to work unchanged. The callback form gets typed `BoundPhaseMoves<TMoves>` because TypeScript resolves the `moves:` field's return type before evaluating the callback. Games that pair `phase.onTimeout` with the inline-callback `moves:` factory and want compile-time arg validation should adopt the callback `phases:` form.
