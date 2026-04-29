# Tic Tac Toe Multiplayer

This example is the cloud-hosted multiplayer Tic Tac Toe deployment. The app
bundle runs in the openturn-cloud play iframe, and Openturn generates the
multiplayer Worker from `app/game.ts` during build/deploy.

## Local multiplayer development

```sh
cd openturn
bun --filter @openturn/cli dev examples/tic-tac-toe-multiplayer/app
```

Open the printed play URL. The local play shell creates or joins a room,
injects the hosted backend fragment into the iframe, and serves the generated
browser bundle. Open the invite URL in a second tab to claim the other seat.

## Cloud deployment

```sh
cd openturn/examples/tic-tac-toe-multiplayer/app
bun run deploy
```

The CLI builds the browser bundle, generates and uploads the multiplayer Worker,
then prints the openturn-cloud play URL.
