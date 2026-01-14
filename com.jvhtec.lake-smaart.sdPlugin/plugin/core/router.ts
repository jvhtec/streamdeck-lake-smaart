import { SDClient } from '../sd/sdClient';
import { IncomingEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';

export interface Action {
    onWillAppear?(event: WillAppearEvent): void;
    onWillDisappear?(event: WillDisappearEvent): void;
    onKeyDown?(event: IncomingEvent): void;
    onKeyUp?(event: IncomingEvent): void;
    onDialRotate?(event: IncomingEvent): void;
    onDialDown?(event: IncomingEvent): void;
    onDialUp?(event: IncomingEvent): void;
    onDidReceiveSettings?(event: IncomingEvent): void;
}

export class Router {
    private actions = new Map<string, Action>();
    private contextMap = new Map<string, Action>();
    private sdClient: SDClient;

    constructor(sdClient: SDClient) {
        this.sdClient = sdClient;
    }

    public registerAction(uuid: string, action: Action) {
        this.actions.set(uuid, action);
    }

    public route(event: IncomingEvent) {
        // Handle global events or specific lifecycle events that map contexts
        if (event.event === 'willAppear') {
            const e = event as WillAppearEvent;
            const actionFactory = this.actions.get(e.action);
            if (actionFactory) {
                // ideally we might instantiate a new action instance per context if we wanted to be rigorous
                // for now we'll map context to the singleton action handler for that UUID
                this.contextMap.set(e.context, actionFactory);
                if (actionFactory.onWillAppear) actionFactory.onWillAppear(e);
            }
            return;
        }

        if (event.event === 'willDisappear') {
            const e = event as WillDisappearEvent;
            const action = this.contextMap.get(e.context);
            if (action) {
                if (action.onWillDisappear) action.onWillDisappear(e);
                this.contextMap.delete(e.context);
            }
            return;
        }

        if (event.event === 'didReceiveGlobalSettings') {
            // Global settings don't have context, handled via SDClient or ignored here
            return;
        }

        // Narrowing: All other events have context
        // @ts-ignore - TS might still complain depending on union strictness but logic holds
        const ctx = (event as any).context;
        const action = this.contextMap.get(ctx);
        if (!action) return;

        switch (event.event) {
            case 'keyDown':
                if (action.onKeyDown) action.onKeyDown(event);
                break;
            case 'keyUp':
                if (action.onKeyUp) action.onKeyUp(event);
                break;
            case 'dialRotate':
                if (action.onDialRotate) action.onDialRotate(event);
                break;
            case 'dialDown':
                if (action.onDialDown) action.onDialDown(event);
                break;
            case 'dialUp':
                if (action.onDialUp) action.onDialUp(event);
                break;
            case 'didReceiveSettings':
                if (action.onDidReceiveSettings) action.onDidReceiveSettings(event);
                break;
        }
    }
}
