export interface SDEvent {
    action: string;
    event: string;
    context: string;
    device: string;
    payload: any;
}

export interface KeyDownEvent extends SDEvent {
    event: 'keyDown';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        state: number;
        userDesiredState: number;
        isInMultiAction: boolean;
    };
}

export interface KeyUpEvent extends SDEvent {
    event: 'keyUp';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        state: number;
        userDesiredState: number;
        isInMultiAction: boolean;
    };
}

export interface DialRotateEvent extends SDEvent {
    event: 'dialRotate';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        ticks: number;
        pressed: boolean;
    };
}

export interface DialDownEvent extends SDEvent {
    event: 'dialDown';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        controller: 'Encoder';
    };
}

export interface DialUpEvent extends SDEvent {
    event: 'dialUp';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        controller: 'Encoder';
    };
}

export interface WillAppearEvent extends SDEvent {
    event: 'willAppear';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        state: number;
        isInMultiAction: boolean;
        controller: 'Keypad' | 'Encoder';
    };
}

export interface WillDisappearEvent extends SDEvent {
    event: 'willDisappear';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        state: number;
        isInMultiAction: boolean;
        controller: 'Keypad' | 'Encoder';
    };
}

export interface DidReceiveSettingsEvent extends SDEvent {
    event: 'didReceiveSettings';
    payload: {
        settings: any;
        coordinates: {
            column: number;
            row: number;
        };
        isInMultiAction: boolean;
    };
}

export interface DidReceiveGlobalSettingsEvent {
    event: 'didReceiveGlobalSettings';
    payload: {
        settings: any;
    };
}

export type IncomingEvent =
    | KeyDownEvent
    | KeyUpEvent
    | DialRotateEvent
    | DialDownEvent
    | DialUpEvent
    | WillAppearEvent
    | WillDisappearEvent
    | DidReceiveSettingsEvent
    | DidReceiveGlobalSettingsEvent;
