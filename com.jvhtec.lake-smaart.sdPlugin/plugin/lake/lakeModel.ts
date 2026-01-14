/**
 * Lake Data Model
 */

export type ModuleId = 'A' | 'B' | 'C' | 'D';
export type ParamType = 'mute' | 'gain';

export type TargetKey =
    | { kind: 'module'; module: ModuleId; param: ParamType }
    | { kind: 'group'; name: 'LR' | 'ALL'; param: ParamType };

export interface TargetState {
    online: boolean; // Device online status (inherited or specific)
    mute?: boolean;
    gainDb?: number;
    lastUpdatedMs: number;
}

export interface GroupDef {
    name: 'LR' | 'ALL';
    gainMembers: Array<{ module: ModuleId; param: 'gain'; weight?: number }>;
    muteMembers: Array<{ module: ModuleId; param: 'mute' }>;
}

// Default definitions
export const GROUPS: Record<string, GroupDef> = {
    LR: {
        name: 'LR',
        gainMembers: [
            { module: 'A', param: 'gain' },
            { module: 'B', param: 'gain' },
        ],
        muteMembers: [
            { module: 'A', param: 'mute' },
            { module: 'B', param: 'mute' },
        ],
    },
    ALL: {
        name: 'ALL',
        gainMembers: [
            { module: 'A', param: 'gain' },
            { module: 'B', param: 'gain' },
            { module: 'C', param: 'gain' },
            { module: 'D', param: 'gain' },
        ],
        muteMembers: [
            { module: 'A', param: 'mute' },
            { module: 'B', param: 'mute' },
            { module: 'C', param: 'mute' },
            { module: 'D', param: 'mute' },
        ],
    },
};

export function getModuleId(dialIndex: number): ModuleId | undefined {
    // 0-based index from dial event? or setting?
    // User request: Dials 1-4 = Modules A-D
    const map: ModuleId[] = ['A', 'B', 'C', 'D'];
    return map[dialIndex]; // check bounds
}
