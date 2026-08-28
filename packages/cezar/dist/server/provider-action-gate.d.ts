import type { ProviderId, ProviderStatusResponse } from '../core/provider-auth.ts';
import type { RunRecord } from '../runs/store.ts';
import { type WorkflowDef } from '../workflows/types.ts';
import type { RunnerSelection } from '../core/runner-selection.ts';
export declare function providersRequiredByWorkflow(workflow: WorkflowDef, fallback: RunnerSelection): ProviderId[];
export declare function providerForExistingRun(run: RunRecord, override?: ProviderId): ProviderId;
/** The provider that owns a currently live session, when the record is attributed. */
export declare function providerForActiveRun(run: RunRecord): ProviderId;
export declare function unavailableProviderMessage(required: readonly ProviderId[], response: ProviderStatusResponse): string | null;
