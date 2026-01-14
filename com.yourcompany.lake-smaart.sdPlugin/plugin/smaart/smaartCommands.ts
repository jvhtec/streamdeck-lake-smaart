/**
 * Smaart Command Builders
 */

export function buildGetStatus(): object {
    return {
        action: 'status'
    };
}

export function buildSetGenerator(enable: boolean): object {
    return {
        action: 'generator',
        state: enable
    };
}

export function buildGetSpl(): object {
    return {
        action: 'get_spl'
    };
}
