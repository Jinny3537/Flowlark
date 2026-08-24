import type { ReactNode } from 'react';
import {
  AppstoreOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  DesktopOutlined,
  SettingOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';

export const GROUP_LABELS: Record<string, string> = {
  server: '服务与网络',
  git: 'Git 与身份',
  rules: '业务规则',
  integrations: '反馈与集成',
  ui: '外观与默认值',
};

export const SECTION_DESCRIPTIONS: Record<string, string> = {
  workspace: '查看当前 Flowlark 工作区，并管理本机已注册工作区。',
  lan: '给同网段成员开放查看入口，并控制局域网写入权限。',
  gitRemote: '设置团队同步用的 Git origin 地址。',
  server: '管理原型 HTML 与附件的上传体积限制。',
  git: '配置默认分支、提交身份和自动提交策略。',
  rules: '控制基线和变更日志相关的业务约束。',
  integrations: '配置反馈流向、反馈标签和团队通知。',
  ui: '设置需求链接模板、常用标签和时间显示方式。',
};

export const HOISTED_CONFIG_KEYS = new Set([
  'server.lan',
  'server.readonlyFromLan',
  'git.remote',
]);

export const VISIBLE_CONFIG_KEYS = new Set([
  'server.maxFileBytes',
  'git.defaultBranch',
  'git.userName',
  'git.userEmail',
  'git.autoCommit',
  'rules.requireChangelog',
  'rules.lockBaseline',
  'integrations.issueProvider',
  'integrations.issueOwner',
  'integrations.issueRepo',
  'integrations.issueLabels',
  'integrations.notificationProvider',
  'integrations.notificationEvents',
  'ui.requirementUrlTemplate',
  'ui.defaultTags',
  'ui.dateStyle',
]);

export const SETTING_ICONS: Record<string, ReactNode> = {
  workspace: <AppstoreOutlined />,
  lan: <ShareAltOutlined />,
  gitRemote: <BranchesOutlined />,
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
