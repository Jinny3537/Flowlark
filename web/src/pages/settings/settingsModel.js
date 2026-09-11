export const SETTINGS_NAV = [
  { key: 'general', label: '通用', tabs: [['ui', '显示与标签']] },
  { key: 'workspace', label: '工作区与同步', tabs: [['workspace', '工作区'], ['gitRemote', 'Git 远端'], ['git', '提交身份']] },
  { key: 'team', label: '团队与访问', tabs: [['team', '访问与角色']] },
  { key: 'integrations', label: '集成与通知', tabs: [['mcp', '需求、迭代与扩展'], ['feedback', '反馈平台'], ['notifications', '通知渠道'], ['links', '需求链接']] },
  { key: 'rules', label: '版本规则', tabs: [['rules', '基线规则']] },
  { key: 'maintenance', label: '维护与诊断', tabs: [['softwareUpdate', '软件更新'], ['trash', '回收站'], ['oplog', '操作日志'], ['server', '上传与索引']] },
];

const legacy = {
  ui: ['general', 'ui'], lan: ['team', 'team'], gitRemote: ['workspace', 'gitRemote'], git: ['workspace', 'git'],
  mcp: ['integrations', 'mcp'], softwareUpdate: ['maintenance', 'softwareUpdate'],
  trash: ['maintenance', 'trash'], oplog: ['maintenance', 'oplog'], server: ['maintenance', 'server'],
};

export function settingsLocation(section = 'general', tab) {
  const old = legacy[section];
  const page = SETTINGS_NAV.find(item => item.key === (old?.[0] || section)) || SETTINGS_NAV[0];
  const candidate = old?.[1] || tab || (section === 'integrations' ? 'feedback' : undefined);
  return { section: page.key, tab: page.tabs.some(([key]) => key === candidate) ? candidate : page.tabs[0][0] };
}

export function configFieldVisible(key, values) {
  const provider = values['integrations.issueProvider'];
  if (key.startsWith('integrations.issue') && key !== 'integrations.issueProvider') {
    if (!provider || provider === 'markdown') return false;
    if (key === 'integrations.issueProject') return provider === 'gitlab';
    if (['integrations.issueOwner', 'integrations.issueRepo'].includes(key)) return provider !== 'gitlab';
  }
  const notification = values['integrations.notificationProvider'];
  if (key.startsWith('integrations.notification') && key !== 'integrations.notificationProvider') return notification !== 'none';
  if (key.startsWith('integrations.wecom')) {
    if (notification !== 'wecom') return false;
    return key === 'integrations.wecomTransport' || key === 'integrations.wecomChatId' || values['integrations.wecomTransport'] === 'cli' || Boolean(values['integrations.wecomChatId']);
  }
  return true;
}

export function softwareUpdateState(status, { checking = false, applying = false, verified = false, restartNeeded = false } = {}) {
  if (applying) return { title: '正在更新软件', type: 'info', canApply: false };
  if (restartNeeded) return { title: '软件已更新，待重启生效', type: 'success', canApply: false };
  if (checking) return { title: '正在检测更新', type: 'info', canApply: false };
  if (status?.error) return { title: '检测更新失败', type: 'error', canApply: false };
  if (!status) return { title: '尚未检测更新', type: 'info', canApply: false };
  if (!status.tracked || !status.upstream) return { title: '当前软件目录不可自动更新', type: 'warning', canApply: false };
  if (status.dirty) return { title: '软件目录存在本地改动，更新受阻', type: 'warning', canApply: false };
  if (!verified) return { title: '尚未检测远端更新', type: 'info', canApply: false };
  return status.available
    ? { title: '检测到可用更新', type: 'success', canApply: true }
    : { title: '当前已是最新版本', type: 'info', canApply: false };
}
