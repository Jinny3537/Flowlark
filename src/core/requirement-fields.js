// 保留需求池的原始文本；TBD、待确认等值不转换为日期或业务状态。
export const REQUIREMENT_DETAIL_FIELDS = [
  'businessValue', 'rawDescription', 'businessRule', 'acceptanceCriteria',
  'functionPoints', 'impactScope', 'projectId', 'versionId', 'versionName',
  'expectedOnlineDate', 'targetDeliveryDate', 'proposedDate', 'protoUrl',
  'source', 'stage', 'analysisStatus', 'sourceUpdatedAt'
]

export function requirementDetailFields(input, { defaults = false } = {}) {
  return Object.fromEntries(REQUIREMENT_DETAIL_FIELDS
    .filter((key) => defaults || input[key] !== undefined)
    .map((key) => [key, String(input[key] ?? '')]))
}
