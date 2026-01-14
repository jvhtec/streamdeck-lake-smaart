import { Action } from '../core/router';
import { SDClient } from '../sd/sdClient';
import { DlmClient } from '../lake/dlmClient';
import { KeyDownEvent, IncomingEvent } from '../sd/events';
import { buildRecallPreset } from '../lake/dlmCommands';

import { SmaartClient } from '../smaart/smaartClient';

export class KeyPresetAction implements Action {
    private sdClient: SDClient;
    private dlmClient: DlmClient;
    private smaartClient: SmaartClient;

    constructor(sdClient: SDClient, dlmClient: DlmClient, smaartClient: SmaartClient) {
        this.sdClient = sdClient;
        this.dlmClient = dlmClient;
        this.smaartClient = smaartClient;
    }

    onKeyDown(event: IncomingEvent): void {
        // Get preset number from settings or payload
        const e = event as KeyDownEvent;
        const settings = e.payload.settings;

        // Assuming Settings have "presetNumber", else derive from Context/Coordinates?
        // User request: "Key 1-3 = Preset 1-3"
        // Simplest: Plugin Settings. 
        // Fallback: Coordinate mapping (Col 0 -> Preset 1, etc. if specific profile)

        let preset = settings.presetNumber;
        if (!preset) {
            // Fallback logic for demo/default profile
            const col = e.payload.coordinates.column;
            preset = col + 1; // 1, 2, 3
        }

        console.log(`Recalling Preset ${preset}`);
        this.dlmClient.send(buildRecallPreset(preset));

        // Safety: Stop Smaart Generator
        this.smaartClient.setGenerator(false);

        // Feedback: Show "Loaded" or similar momentarily
        this.sdClient.setTitle(e.context, `Load ${preset}`);
        setTimeout(() => {
            this.sdClient.setTitle(e.context, ""); // Reset or show label
        }, 1500);
    }
}
