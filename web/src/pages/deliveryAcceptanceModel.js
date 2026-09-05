export const verdictLabels = {
  pending: '待验收', approved: '通过', rejected: '拒绝', conditional: '有条件通过', waived: '豁免',
};

export function deliveryWriteGuard({ kind, canWrite, readonlyReason, integrityReady, snapshotHash, loading }) {
  if (kind !== 'delivery') return '旧快照没有冻结验收规则，不能作为正式验收依据。';
  if (canWrite !== true) return readonlyReason || '当前无法写入，请确认服务权限后重试。';
  if (loading) return '正在核验交付材料，请稍候。';
  if (integrityReady !== true || !snapshotHash) return '交付材料尚未通过完整性校验，暂不能提交验收或反馈。';
  return '';
}

export function acceptanceInput(values, roles, snapshotHash) {
  if (!snapshotHash) throw new Error('请重新加载交付详情后再提交。');
  if (!roles.some((role) => role.id === values.role)) throw new Error('请选择该交付快照中的验收角色。');
  if (!Object.hasOwn(verdictLabels, values.verdict)) throw new Error('请选择有效的验收结论。');
  const note = typeof values.note === 'string' ? values.note.trim() : '';
  if (note.length > 10000) throw new Error('备注最多 10000 字符。');
  if (values.verdict === 'waived' && !note) throw new Error('豁免验收必须填写原因。');
  let conditions = [];
  if (values.verdict === 'conditional') {
    if (!Array.isArray(values.conditions) || !values.conditions.length || values.conditions.length > 100) {
      throw new Error('有条件通过需要 1 至 100 个条件项。');
    }
    const ids = new Set();
    conditions = values.conditions.map((condition) => {
      if (!condition || typeof condition.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(condition.id) ||
          ids.has(condition.id) || typeof condition.text !== 'string' || !condition.text.trim() || condition.text.length > 2000) {
        throw new Error('请填写完整、不重复的验收条件，每项最多 2000 字符。');
      }
      ids.add(condition.id);
      return { id: condition.id, text: condition.text.trim(), closed: condition.closed === true };
    });
  }
  return { role: values.role, verdict: values.verdict, note, conditions, expectedSnapshotHash: snapshotHash };
}
