# USB Test Build

Use this checklist when you need to carry the plugin to another computer for a quick hardware test.

## Create the bundle

1. Run `npm install` if dependencies are not already installed.
2. Run `npm run build`.
3. Zip `com.jvhtec.lake-smaart.sdPlugin` after the build finishes.
4. Copy the zip to the USB drive together with:
   - `lacoustics-cardioid-preset-a.json`
   - `lacoustics-cardioid-preset-b.json`

The build step copies the runtime `ws` dependency into `com.jvhtec.lake-smaart.sdPlugin/node_modules`, so the plugin folder can run outside the repository.

## Install on the test computer

1. Quit Stream Deck.
2. Unzip `com.jvhtec.lake-smaart.sdPlugin` into the Stream Deck plugins folder:
   - Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\`
   - macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
3. Start Stream Deck.
4. Add the actions to a profile and open a property inspector to set global discovery fields.
5. For **L-Acoustics A/B Delay**, load the A and B JSON files from the USB drive in the action inspector.

Keep the two preset JSON files with the USB bundle because Stream Deck action settings store the parsed preset contents only after you load them in the inspector.
