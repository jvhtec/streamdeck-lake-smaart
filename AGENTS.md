# Agent Notes for this Repository

## Project overview
This repository contains a Stream Deck plugin for controlling Lake LM modules and Smaart functions. The plugin source lives in `com.jvhtec.lake-smaart.sdPlugin`, with TypeScript sources under `plugin/` and Stream Deck property inspectors under `ui/`.

## Key paths
- `com.jvhtec.lake-smaart.sdPlugin/manifest.json`: Stream Deck plugin manifest.
- `com.jvhtec.lake-smaart.sdPlugin/plugin/`: TypeScript source for plugin runtime.
- `com.jvhtec.lake-smaart.sdPlugin/ui/`: Property Inspector UI files.
- `docs/`: Project documentation, references, and user guide.

## Development commands
- Install deps: `npm install`
- Build plugin: `npm run build`
- Watch build: `npm run watch`

## Documentation expectations
- Keep documentation in `docs/` and update `README.md` when behavior or actions change.
- Add new external references under `docs/` with the source URL and retrieval date.
