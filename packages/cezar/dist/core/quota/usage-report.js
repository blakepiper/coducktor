/** Read a stable provider-order report without exposing profile paths or env. */
export async function readUsageReport(usage, accounts, refresh) {
    return Promise.all(['claude', 'codex'].map(async (provider) => {
        const account = accounts[provider];
        return refresh || usage.get(account) === undefined
            ? usage.refresh(account, refresh)
            : usage.get(account);
    }));
}
export function formatUsageReport(snapshots) {
    return snapshots.map((snapshot) => {
        const windows = snapshot.windows.length === 0
            ? 'no usage windows reported'
            : snapshot.windows.map((window) => {
                const usage = window.usedPercent === null ? 'unknown' : `${window.usedPercent}%`;
                return `${window.kind}: ${usage}${window.resetsAt ? ` (resets ${window.resetsAt})` : ''}`;
            }).join(', ');
        return `${snapshot.provider}: ${snapshot.health}${snapshot.stale ? ' (stale)' : ''} — ${windows}`;
    }).join('\n');
}
//# sourceMappingURL=usage-report.js.map