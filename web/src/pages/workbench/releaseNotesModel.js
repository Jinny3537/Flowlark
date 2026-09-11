// Keep the existing storage contract while editing release notes as one document.
export function changesToText(items = []) {
  const labels = { ADD: '新增', MODIFY: '优化', REMOVE: '删除' }
  return items.map((item) => {
    if (!item.location && !item.requirement && (!item.type || item.type === 'MODIFY')) return item.content || ''
    return `【${labels[item.type] || item.type || '优化'}】${item.location ? `【${item.location}】` : ''}${item.content || ''}${item.requirement ? `（关联需求：${item.requirement}）` : ''}`
  }).join('\n\n')
}

export function textToChanges(text) {
  return text ? [{ type: 'MODIFY', location: '', content: text, requirement: '' }] : []
}

export const releaseNotesTemplate = `项目名称 版本号 发布说明

项目：待填写　|　版本：待填写
计划迭代时间：待确认
研发负责人：待确认　|　测试负责人：待确认

本次更新主要涉及……；对其他业务功能的影响待确认。

【新增】

- 【模块-功能】新增内容。

【优化】

- 【模块-功能】优化内容。

【修复】

- 本版本暂无修复项。

【注意事项】

- 发布负责人及测试负责人待确认，研发负责人待确认。
- 本次升级的业务影响范围、兼容性及相关风险待确认。
- 升级时间窗口、操作指引、数据处理要求及回退方案待确认。
- 升级后的验证安排、问题反馈渠道及支持人员待确认。`
