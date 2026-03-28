import { DeviceDescriptor, TargetDescriptor } from './types';

export type InspectorActionKind = 'mute' | 'level' | 'priority' | 'preset';

export interface InspectorDeviceDescriptor extends DeviceDescriptor {
    supportedActions: InspectorActionKind[];
}

const ACTION_ORDER: InspectorActionKind[] = ['mute', 'level', 'priority', 'preset'];

export function buildInspectorDevices(
    devices: DeviceDescriptor[],
    targets: TargetDescriptor[]
): InspectorDeviceDescriptor[] {
    const actionsByDevice = new Map<string, Set<InspectorActionKind>>();

    targets.forEach((target) => {
        const actions = getSupportedActionsForTarget(target);
        if (actions.length === 0) {
            return;
        }

        const existing = actionsByDevice.get(target.deviceId) || new Set<InspectorActionKind>();
        actions.forEach((action) => existing.add(action));
        actionsByDevice.set(target.deviceId, existing);
    });

    return devices
        .filter((device) => actionsByDevice.has(device.id))
        .map((device) => ({
            ...device,
            supportedActions: sortActions(Array.from(actionsByDevice.get(device.id) || [])),
        }));
}

export function getSupportedActionsForTarget(target: TargetDescriptor): InspectorActionKind[] {
    if (target.kind === 'preset') {
        return ['preset'];
    }

    const actions: InspectorActionKind[] = [];
    if (hasSupport(target, 'mute')) {
        actions.push('mute');
    }
    if (hasSupport(target, 'level')) {
        actions.push('level');
    }
    if (hasSupport(target, 'priority')) {
        actions.push('priority');
    }
    return actions;
}

function sortActions(actions: InspectorActionKind[]): InspectorActionKind[] {
    return actions.sort((left, right) => ACTION_ORDER.indexOf(left) - ACTION_ORDER.indexOf(right));
}

function hasSupport(target: TargetDescriptor, support: InspectorActionKind) {
    if (target.kind === 'preset') {
        return false;
    }
    return Array.isArray(target.supports) && target.supports.includes(support as never);
}
