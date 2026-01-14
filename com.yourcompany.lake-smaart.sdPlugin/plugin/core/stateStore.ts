import { EventEmitter } from 'events';
import { ModuleId, ParamType, TargetState } from '../lake/lakeModel';

export class StateStore extends EventEmitter {
    private moduleState = new Map<ModuleId, TargetState>();

    constructor() {
        super();
        // Initialize defaults
        ['A', 'B', 'C', 'D'].forEach((m) => {
            this.moduleState.set(m as ModuleId, {
                online: false,
                lastUpdatedMs: 0,
                gainDb: -100, // default / unknown
                mute: false,
            });
        });
    }

    public updateModule(module: ModuleId, updates: Partial<TargetState>) {
        const current = this.moduleState.get(module) || {
            online: false,
            lastUpdatedMs: 0,
        };

        let changed = false;

        if (updates.online !== undefined && updates.online !== current.online) {
            current.online = updates.online;
            changed = true;
        }

        if (updates.mute !== undefined && updates.mute !== current.mute) {
            current.mute = updates.mute;
            changed = true;
        }

        if (updates.gainDb !== undefined && updates.gainDb !== current.gainDb) {
            current.gainDb = updates.gainDb;
            changed = true;
        }

        if (changed) {
            current.lastUpdatedMs = Date.now();
            this.moduleState.set(module, current);
            this.emit('update', { module, state: current });
        }
    }

    public getModule(module: ModuleId): TargetState {
        return this.moduleState.get(module) || { online: false, lastUpdatedMs: 0 };
    }
}
