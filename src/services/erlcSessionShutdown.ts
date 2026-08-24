import { runErlcCommand, type ErlcCommandResult } from './erlcCommandService';

/** ER:LC's supported command for removing every current player from the server. */
export const ERLC_SSD_COMMAND = ':kick all';

export type ErlcSsdResult =
    | { status: 'kicked'; message: string }
    | { status: 'already-empty'; message: string }
    | { status: 'failed'; message: string };

function serverIsAlreadyEmpty(result: Extract<ErlcCommandResult, { ok: false }>): boolean {
    return result.code === 3002 || /offline|no players/i.test(result.message);
}

/** Runs the in-game SSD action and reduces API details to a safe staff-facing result. */
export async function shutdownErlcForSsd(): Promise<ErlcSsdResult> {
    const result = await runErlcCommand(ERLC_SSD_COMMAND);
    if (result.ok) return { status: 'kicked', message: result.message };
    if (serverIsAlreadyEmpty(result)) return { status: 'already-empty', message: result.message };
    return { status: 'failed', message: result.message };
}

export function erlcSsdReply(result: ErlcSsdResult): string {
    if (result.status === 'kicked') {
        return ' ER:LC accepted `:kick all`, so every current player was kicked.';
    }
    if (result.status === 'already-empty') {
        return ' ER:LC was already offline or had no players, so no one remained to kick.';
    }
    return ` ⚠️ **ER:LC did not confirm the shutdown:** ${result.message} Run \`:kick all\` in-game immediately.`;
}
