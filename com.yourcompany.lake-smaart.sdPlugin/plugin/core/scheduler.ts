import { DlmClient } from '../lake/dlmClient';
import { StateStore } from './stateStore';
import { buildGetGain, buildGetMute } from '../lake/dlmCommands';
import { ModuleId } from '../lake/lakeModel';

export class Scheduler {
    private dlmClient: DlmClient;
    private stateStore: StateStore;
    private intervalMs: number = 500;
    private modules: ModuleId[] = ['A', 'B', 'C', 'D'];
    private timer: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor(dlmClient: DlmClient, stateStore: StateStore) {
        this.dlmClient = dlmClient;
        this.stateStore = stateStore;
    }

    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.loop();
    }

    public stop() {
        this.isRunning = false;
        if (this.timer) clearTimeout(this.timer);
    }

    private async loop() {
        if (!this.isRunning) return;

        // Concurrency: we can fire all requests, but maybe sequential is safer for basic implementation
        // or Promise.all. UDP is fast.

        const polls = this.modules.flatMap(m => [
            { module: m, type: 'mute' },
            { module: m, type: 'gain' }
        ]);

        for (const poll of polls) {
            try {
                const cmd = poll.type === 'mute' ? buildGetMute(poll.module) : buildGetGain(poll.module);
                const res = await this.dlmClient.send(cmd, 0); // 0 retries for polling, just skip if packet loss

                if (res) {
                    // Parse res.payload
                    // Mute format: "1" or "0" (Wait, response format differs? Need to verify)
                    // Assuming "Mod.In.Mute=A 1" is echoed back? Or just "1"? 
                    // Usually query returns full set command string "Mod.In.Mute=A 1"

                    if (poll.type === 'mute') {
                        // Extract value
                        const val = res.payload.includes(' 1'); // Simplistic
                        this.stateStore.updateModule(poll.module, { mute: val, online: true });
                    } else {
                        // Gain format "Mod.In.Gain=A -12.00"
                        const parts = res.payload.split(' ');
                        if (parts.length > 1) {
                            const db = parseFloat(parts[parts.length - 1]);
                            if (!isNaN(db)) {
                                this.stateStore.updateModule(poll.module, { gainDb: db, online: true });
                            }
                        }
                    }
                }
            } catch (e) {
                // Optional: Mark offline here if consecutive failures
                // this.stateStore.updateModule(poll.module, { online: false });
            }
        }

        this.timer = setTimeout(() => this.loop(), this.intervalMs);
    }
}
