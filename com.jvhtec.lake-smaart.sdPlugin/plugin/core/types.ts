export type BackendId = 'lake' | 'la_http';
export type LaHttpDeviceProfile = 'p1' | 'lc16d' | 'amplified' | 'unknown';
export type InputPriorityMode = 'auto' | '1' | '2' | '3' | '4';
export type TargetSupport = 'mute' | 'level' | 'volume' | 'priority';

export interface DeviceDescriptor {
    id: string;
    name: string;
    backend: BackendId;
    address?: string;
    model?: string;
    online: boolean;
}

export type TargetDescriptor =
    | {
          backend: 'lake';
          deviceId: string;
          kind: 'module' | 'group' | 'preset' | 'router';
          id: string;
          name: string;
          supports?: TargetSupport[];
          routerIndex?: number;
      }
      | {
            backend: 'la_http';
            deviceId: string;
            kind: 'input' | 'output';
            id: string;
            index?: number;
            name: string;
            supports: Array<'mute' | 'level' | 'volume'>;
            path: string;
            profile: LaHttpDeviceProfile;
            family?: string;
            memberIds?: string[];
        }
    | {
          backend: 'la_http';
          deviceId: string;
          kind: 'preset';
          index: number;
          name: string;
          profile: LaHttpDeviceProfile;
      };

export interface TargetState {
    online: boolean;
    mute?: boolean;
    levelDb?: number;
    volume?: number;
    priorityMode?: InputPriorityMode;
    lastUpdatedMs: number;
}

export interface DeviceState {
    online: boolean;
    activePresetIndex?: number;
    lastUpdatedMs: number;
}

export type LevelMode = 'gain' | 'volume';

export interface Backend {
    readonly id: BackendId;
    discover(): Promise<DeviceDescriptor[]>;
    getTargets(device: DeviceDescriptor): Promise<TargetDescriptor[]>;
    getState(target: TargetDescriptor): Promise<TargetState>;
    setMute(target: TargetDescriptor, mute: boolean): Promise<void>;
    setLevel(target: TargetDescriptor, value: number, mode: LevelMode): Promise<void>;
    setPriority?(target: TargetDescriptor, value: InputPriorityMode): Promise<void>;
    recallPreset(device: DeviceDescriptor, index: number): Promise<void>;
    getActivePresetIndex?(device: DeviceDescriptor): Promise<number | null>;
}
