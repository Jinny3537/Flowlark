import type { ReactNode } from 'react';
import {
  ApiOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DesktopOutlined,
  DeleteOutlined,
  HistoryOutlined,
  SettingOutlined,
  ShareAltOutlined,
  TeamOutlined,
} from '@ant-design/icons';

export const GROUP_LABELS: Record<string, string> = {
  server: '上传限制',
  git: 'Git 与身份',
  rules: '业务规则',
  feedback: '反馈平台',
  notifications: '通知渠道',
  links: '需求链接',
  ui: '显示与标签',
};

export const SECTION_DESCRIPTIONS: Record<string, string> = {
  general: '设置当前工作区的时间显示和常用标签，保存后生效。',
  maintenance: '维护本机软件、查看历史记录并恢复误删内容。',
  feedback: '按平台配置反馈目标；远端失败时仍可导出 Markdown。',
  notifications: '配置团队事件通知；项目发版邮件仍在项目设置中管理。',
  links: '用需求编号生成跳转链接，不会自动同步外部需求。',
  workspace: '查看当前 Flowlark 工作区，并管理本机已注册工作区。',
  team: '统一管理访问地址、协作方式和访客角色。',
  gitRemote: '设置团队同步用的 Git origin 地址。',
  softwareUpdate: '检测并安全拉取 Flowlark 软件仓库更新。',
  trash: '查看已删除的版本，并在版本号未被占用时恢复。',
  oplog: '查看随 Git 保存的语义操作记录。',
  mcp: '连接外部需求、迭代和扩展能力。',
  server: '管理原型 HTML 与附件的上传体积限制。',
  git: '配置提交身份；同步操作使用现有 Git 助手。',
  rules: '控制正式发版的变更日志检查；设定基线仅变更状态。',
  integrations: '配置反馈流向、反馈标签和团队通知。',
  ui: '时间显示作用于日常列表和详情；审计日志始终使用精确时间。',
};

export const HOISTED_CONFIG_KEYS = new Set([
  'server.lan',
  'server.readonlyFromLan',
  'git.remote',
]);

export const VISIBLE_CONFIG_KEYS = new Set([
  'server.maxFileBytes',
  'git.userName',
  'git.userEmail',
  'rules.requireChangelog',
  'integrations.issueProvider',
  'integrations.issueBaseUrl',
  'integrations.issueProject',
  'integrations.issueOwner',
  'integrations.issueRepo',
  'integrations.issueLabels',
  'integrations.notificationProvider',
  'integrations.notificationEvents',
  'integrations.notificationTemplate',
  'integrations.wecomTransport',
  'integrations.wecomChatId',
  'integrations.wecomCliCommand',
  'ui.requirementUrlTemplate',
  'ui.defaultTags',
  'ui.dateStyle',
]);

export const SETTING_ICONS: Record<string, ReactNode> = {
  general: <DesktopOutlined />,
  maintenance: <SettingOutlined />,
  workspace: <AppstoreOutlined />,
  team: <TeamOutlined />,
  gitRemote: <BranchesOutlined />,
  softwareUpdate: <CloudDownloadOutlined />,
  trash: <DeleteOutlined />,
  oplog: <HistoryOutlined />,
  mcp: <ApiOutlined />,
  server: <SettingOutlined />,
  git: <BranchesOutlined />,
  rules: <CheckCircleOutlined />,
  integrations: <ShareAltOutlined />,
  ui: <DesktopOutlined />,
};

export type SettingsSection = {
  key: string;
  label: string;
  description: string;
  modified: number;
};

export function bytesText(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}
