export type BackendId = 'lake' | 'la_http';

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
          kind: 'module' | 'group' | 'preset';
          id: string;
          name: string;
          supports?: Array<'mute' | 'level'>;
      }
    | {
          backend: 'la_http';
          deviceId: string;
          kind: 'output';
          index: number;
          name: string;
          supports: Array<'mute' | 'level' | 'volume'>;
      }
    | {
          backend: 'la_http';
          deviceId: string;
          kind: 'preset';
          index: number;
          name: string;
      };

export interface TargetState {
    online: boolean;
    mute?: boolean;
    levelDb?: number;
    volume?: number;
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
    recallPreset(device: DeviceDescriptor, index: number): Promise<void>;
    getActivePresetIndex?(device: DeviceDescriptor): Promise<number | null>;
}
