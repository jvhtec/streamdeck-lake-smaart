"use strict";
/**
 * Lake Data Model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUPS = void 0;
exports.getModuleId = getModuleId;
// Default definitions
exports.GROUPS = {
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
function getModuleId(dialIndex) {
    // 0-based index from dial event? or setting?
    // User request: Dials 1-4 = Modules A-D
    const map = ['A', 'B', 'C', 'D'];
    return map[dialIndex]; // check bounds
}
