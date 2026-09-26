// Props every view receives from App. Views read state from the URL and the audit log; they never
// compute a number themselves (the engine does).
import type { AuditEntry, BlockFile } from '@engine/types';
import type { useAudit } from '../lib/audit';
import type { LotModel } from '../lib/model';
import type { UrlState } from '../lib/url';

export interface ViewProps {
  s: UrlState;
  update: (patch: Partial<UrlState>, opts?: { push?: boolean }) => void;
  block: BlockFile | undefined;
  model: LotModel | null; // present on lot and inquiry views
  audit: AuditEntry[]; // committed reviews + this browser's log + page-link assumptions
  auditApi: ReturnType<typeof useAudit>;
}
