export const phaseLabels = { planning: '规划中', reviewing: '评审中', frozen: '已冻结', active: '进行中', delivered: '已交付', archived: '已归档', canceled: '已取消' };
export const editablePhase = status => ['planning', 'reviewing'].includes(status || 'planning');
export const scopeLabel = status => editablePhase(status) ? '候选版本' : status === 'canceled' ? '已取消范围' : ['delivered', 'archived'].includes(status) ? '历史采用版本' : '采用版本';
export const scopeKey = item => JSON.stringify([item.requirement, item.project, item.version]);
export const versionKey = item => JSON.stringify([item.project, item.version || item.versionNo]);
export function scopeCounts(items = []) {
  return { requirements: new Set(items.map(x => x.requirement).filter(Boolean)).size,
    projects: new Set(items.map(x => x.project)).size, versions: new Set(items.map(versionKey)).size };
}
export function assignmentPreview(existing = [], selected = [], mode = 'append') {
  const duplicate = selected.filter(x => existing.some(y => scopeKey(x) === scopeKey(y)));
  const conflicts = existing.filter(x => selected.some(y => x.requirement === y.requirement && x.project === y.project && x.version !== y.version));
  const retained = mode === 'replace' ? existing.filter(x => !selected.some(y => x.requirement === y.requirement && x.project === y.project)) : existing;
  const items = [...new Map([...retained, ...selected].map(x => [scopeKey(x), x])).values()];
  return { duplicate, conflicts, items };
}
export function safeReturn(value) {
  if (typeof value !== 'string' || value.length > 10000 || /[\\\r\n]/.test(value)) return '';
  return /^\/(requirements|projects|milestones|deliveries)(?:[/?]|$)/.test(value) ? value : '';
}
export function contextualRoute(target, source, label) {
  const [pathname, query = ''] = target.split('?');
  const params = new URLSearchParams(query);
  if (safeReturn(source)) { params.set('returnTo', source); params.set('from', label); }
  return `${pathname}?${params}`;
}
export const milestoneRowId = item => `scope-${encodeURIComponent(scopeKey(item))}`;
export function deliveryDraftKey(repo, origin = '') { return `flowlark.delivery-draft:${JSON.stringify([repo, origin])}`; }
