import { spawn } from 'child_process';

export type MacroOperation =
    | {
        type: 'keys';
        sendKeys: string;
        label: string;
    }
    | {
        type: 'delay';
        milliseconds: number;
        label: string;
    };

export interface CompiledMacroResult {
    ok: boolean;
    operations: MacroOperation[];
    display: string;
    error?: string;
}

export interface SendWindowsMacroRequest {
    windowTitle?: string;
    activateWindow?: boolean;
    focusDelayMs?: number;
    betweenStepDelayMs?: number;
    operations: MacroOperation[];
}

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift'] as const;
const MODIFIER_SENDKEYS: Record<(typeof MODIFIER_ORDER)[number], string> = {
    ctrl: '^',
    alt: '%',
    shift: '+',
};

const SPECIAL_KEY_SENDKEYS: Record<string, string> = {
    backspace: '{BACKSPACE}',
    bksp: '{BACKSPACE}',
    bs: '{BACKSPACE}',
    break: '{BREAK}',
    capslock: '{CAPSLOCK}',
    del: '{DELETE}',
    delete: '{DELETE}',
    down: '{DOWN}',
    end: '{END}',
    enter: '{ENTER}',
    esc: '{ESC}',
    escape: '{ESC}',
    help: '{HELP}',
    home: '{HOME}',
    ins: '{INSERT}',
    insert: '{INSERT}',
    left: '{LEFT}',
    numlock: '{NUMLOCK}',
    pagedown: '{PGDN}',
    pgdn: '{PGDN}',
    pageup: '{PGUP}',
    pgup: '{PGUP}',
    pause: '{PAUSE}',
    printscreen: '{PRTSC}',
    prtsc: '{PRTSC}',
    prtscr: '{PRTSC}',
    right: '{RIGHT}',
    scrolllock: '{SCROLLLOCK}',
    space: '{SPACE}',
    spacebar: '{SPACE}',
    tab: '{TAB}',
    up: '{UP}',
};

const LITERAL_KEY_ALIASES: Record<string, string> = {
    apostrophe: '\'',
    backslash: '\\',
    comma: ',',
    dot: '.',
    equals: '=',
    grave: '`',
    lbracket: '[',
    leftbracket: '[',
    minus: '-',
    period: '.',
    plus: '+',
    quote: '\'',
    rbracket: ']',
    rightbracket: ']',
    semicolon: ';',
    slash: '/',
    tilde: '~',
};

const SENDKEY_LITERAL_ESCAPES: Record<string, string> = {
    '+': '{+}',
    '^': '{^}',
    '%': '{%}',
    '~': '{~}',
    '(': '{(}',
    ')': '{)}',
    '[': '{[}',
    ']': '{]}',
    '{': '{{}',
    '}': '{}}',
    ' ': '{SPACE}',
};

function splitMacroSteps(input: string): string[] {
    return input
        .split(/\r?\n|,/)
        .map((step) => step.trim())
        .filter(Boolean);
}

function normalizeModifierToken(token: string): (typeof MODIFIER_ORDER)[number] | null {
    const normalized = token.trim().toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') return 'ctrl';
    if (normalized === 'alt' || normalized === 'option') return 'alt';
    if (normalized === 'shift') return 'shift';
    return null;
}

function escapeSendKeysLiteral(value: string): string {
    if (value.length !== 1) {
        return value;
    }

    return SENDKEY_LITERAL_ESCAPES[value] || value;
}

function encodePrimaryKey(token: string): string | null {
    const trimmed = token.trim();
    const normalized = trimmed.toLowerCase().replace(/\s+/g, '');

    if (SPECIAL_KEY_SENDKEYS[normalized]) {
        return SPECIAL_KEY_SENDKEYS[normalized];
    }

    if (LITERAL_KEY_ALIASES[normalized]) {
        return escapeSendKeysLiteral(LITERAL_KEY_ALIASES[normalized]);
    }

    if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(trimmed)) {
        return `{${trimmed.toUpperCase()}}`;
    }

    if (trimmed.length === 1) {
        return escapeSendKeysLiteral(trimmed);
    }

    return null;
}

function compileHotkeyStep(step: string): { sendKeys: string; label: string } | { error: string } {
    const tokens = step
        .split('+')
        .map((token) => token.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return { error: 'Empty hotkey step.' };
    }

    const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
    let primaryKey: string | null = null;

    for (const token of tokens) {
        const modifier = normalizeModifierToken(token);
        if (modifier) {
            modifiers.add(modifier);
            continue;
        }

        if (primaryKey) {
            return {
                error: `Only one non-modifier key is supported per step: "${step}".`,
            };
        }

        primaryKey = token;
    }

    if (!primaryKey) {
        return { error: `Missing primary key in "${step}".` };
    }

    const encodedKey = encodePrimaryKey(primaryKey);
    if (!encodedKey) {
        return {
            error: `Unsupported key token "${primaryKey}" in "${step}".`,
        };
    }

    const sendKeys =
        MODIFIER_ORDER
            .filter((modifier) => modifiers.has(modifier))
            .map((modifier) => MODIFIER_SENDKEYS[modifier])
            .join('') + encodedKey;

    return {
        sendKeys,
        label: step.trim(),
    };
}

export function compileHotkeyMacro(input: string): CompiledMacroResult {
    const trimmed = String(input || '').trim();
    if (!trimmed) {
        return {
            ok: false,
            operations: [],
            display: '',
            error: 'Macro is empty.',
        };
    }

    const steps = splitMacroSteps(trimmed);
    if (steps.length === 0) {
        return {
            ok: false,
            operations: [],
            display: '',
            error: 'Macro is empty.',
        };
    }

    const operations: MacroOperation[] = [];

    for (const step of steps) {
        const delayMatch = step.match(/^(delay|sleep)\s+(\d+)$/i);
        if (delayMatch) {
            operations.push({
                type: 'delay',
                milliseconds: Number(delayMatch[2]),
                label: `Delay ${Number(delayMatch[2])}ms`,
            });
            continue;
        }

        const compiledStep = compileHotkeyStep(step);
        if ('error' in compiledStep) {
            return {
                ok: false,
                operations: [],
                display: '',
                error: compiledStep.error,
            };
        }

        operations.push({
            type: 'keys',
            sendKeys: compiledStep.sendKeys,
            label: compiledStep.label,
        });
    }

    return {
        ok: true,
        operations,
        display: operations.map((operation) => operation.label).join(' -> '),
    };
}

const HOTKEY_SENDER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:STREAMDOCK_HOTKEY_PAYLOAD))
    $payload = $payloadJson | ConvertFrom-Json

    $windowTitle = [string]$payload.windowTitle
    $activateWindow = [bool]$payload.activateWindow
    $focusDelayMs = [int]$payload.focusDelayMs
    $betweenStepDelayMs = [int]$payload.betweenStepDelayMs
    $operations = @($payload.operations)

    $shell = New-Object -ComObject WScript.Shell

    if ($activateWindow) {
        if ([string]::IsNullOrWhiteSpace($windowTitle)) {
            throw 'Window title is required when Focus Window is enabled.'
        }

        Add-Type -AssemblyName Microsoft.VisualBasic

        $escapedWindowTitle = [Regex]::Escape($windowTitle.Trim())
        $process = Get-Process | Where-Object {
            $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match $escapedWindowTitle
        } | Sort-Object StartTime -Descending | Select-Object -First 1

        if (-not $process) {
            throw ("No visible window matching '" + $windowTitle + "' was found.")
        }

        if (-not [Microsoft.VisualBasic.Interaction]::AppActivate($process.Id)) {
            throw ("Unable to activate '" + $process.MainWindowTitle + "'.")
        }

        if ($focusDelayMs -gt 0) {
            Start-Sleep -Milliseconds $focusDelayMs
        }
    }

    foreach ($operation in $operations) {
        if ($operation.type -eq 'delay') {
            Start-Sleep -Milliseconds ([int]$operation.milliseconds)
            continue
        }

        if ($operation.type -eq 'keys' -and -not [string]::IsNullOrWhiteSpace([string]$operation.sendKeys)) {
            $shell.SendKeys([string]$operation.sendKeys)
            if ($betweenStepDelayMs -gt 0) {
                Start-Sleep -Milliseconds $betweenStepDelayMs
            }
        }
    }

    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`;

function cleanPowerShellError(detail: string): string {
    const trimmed = detail.trim();
    if (!trimmed) {
        return trimmed;
    }

    return trimmed
        .replace(/^#< CLIXML\s*/i, '')
        .replace(/<Objs[\s\S]*$/i, '')
        .replace(/\r?\n+/g, ' ')
        .trim();
}

export async function sendWindowsMacro(request: SendWindowsMacroRequest): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'win32') {
        return {
            ok: false,
            error: 'Windows hotkey macros are only supported on Windows.',
        };
    }

    if (!Array.isArray(request.operations) || request.operations.length === 0) {
        return {
            ok: false,
            error: 'Macro is empty.',
        };
    }

    const payload = Buffer.from(JSON.stringify({
        windowTitle: request.windowTitle || '',
        activateWindow: Boolean(request.activateWindow),
        focusDelayMs: Number(request.focusDelayMs) || 0,
        betweenStepDelayMs: Number(request.betweenStepDelayMs) || 0,
        operations: request.operations,
    }), 'utf8').toString('base64');
    const encodedCommand = Buffer.from(HOTKEY_SENDER_SCRIPT, 'utf16le').toString('base64');

    return new Promise((resolve) => {
        const child = spawn(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
            {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    STREAMDOCK_HOTKEY_PAYLOAD: payload,
                },
            }
        );

        let stderr = '';
        let stdout = '';
        let settled = false;

        const finish = (result: { ok: boolean; error?: string }) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            finish({
                ok: false,
                error: `Failed to launch PowerShell: ${error.message}`,
            });
        });

        child.on('close', (code) => {
            if (code === 0) {
                finish({ ok: true });
                return;
            }

            const detail = cleanPowerShellError(stderr || stdout) || `PowerShell exited with code ${code}.`;
            finish({
                ok: false,
                error: detail,
            });
        });
    });
}
