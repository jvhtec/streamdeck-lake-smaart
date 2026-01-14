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
        parameter: enable ? 'on' : 'off' // Hypothetical, check API v4 docs
    };
}

export function buildGetSpl(): object {
    return {
        action: 'get_spl'
    };
}
