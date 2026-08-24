import { Alert, App, Badge, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api, type ConfigItem, type HealthInfo } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  ConfigGroupSection,
  GitRemoteSection,
  LanSection,
  WorkspaceSection,
  type SettingsGroup,
  type WorkspaceValues,
} from './settings/SettingsSections';
import { OperationLog } from './settings/OperationLog';
import { McpSection } from './settings/McpSection';
import { SoftwareUpdateSection } from './settings/SoftwareUpdateSection';
import {
  GROUP_LABELS,
  HOISTED_CONFIG_KEYS,
  SECTION_DESCRIPTIONS,
  SETTING_ICONS,
  VISIBLE_CONFIG_KEYS,
  type SettingsSection,
} from './settings/settingsConfig';

export default function Settings() {
  const navigate = useNavigate();
  const params = useParams();
  const { message, modal } = App.useApp();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [lan, setLan] = useState<any>(null);
  const [remote, setRemote] = useState<any>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [workspaces, setWorkspaces] = useState<any>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [restartNeeded, setRestartNeeded] = useState(false);
  const activeSection = params.section || 'workspace';
  const canWrite = health?.canWrite !== false;

  const byKey = useCallback((key: string) => items.find((item) => item.key === key), [items]);

  const groups = useMemo<SettingsGroup[]>(() => Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.filter((item) => item.group === key && !HOISTED_CONFIG_KEYS.has(item.key) && VISIBLE_CONFIG_KEYS.has(item.key)),
    }))
    .filter((group) => group.items.length), [items]);

  const modifiedCount = useCallback((keys: string[]) =>
    keys.map(byKey).filter((item) => item && !item.isDefault).length, [byKey]);

  const sections = useMemo<SettingsSection[]>(() => [
    { key: 'workspace', label: '工作区', description: SECTION_DESCRIPTIONS.workspace, modified: 0 },
    { key: 'lan', label: '局域网分享', description: SECTION_DESCRIPTIONS.lan, modified: modifiedCount(['server.lan', 'server.readonlyFromLan']) },
    { key: 'gitRemote', label: 'Git 远端', description: SECTION_DESCRIPTIONS.gitRemote, modified: modifiedCount(['git.remote']) },
    { key: 'softwareUpdate', label: '软件更新', description: SECTION_DESCRIPTIONS.softwareUpdate, modified: 0 },
    { key: 'oplog', label: '操作日志', description: SECTION_DESCRIPTIONS.oplog, modified: 0 },
    { key: 'mcp', label: 'MCP 中心', description: SECTION_DESCRIPTIONS.mcp, modified: 0 },
    ...groups.map((group) => ({
      key: group.key,
      label: group.label,
      description: SECTION_DESCRIPTIONS[group.key] || '',
      modified: group.items.filter((item) => !item.isDefault).length,
    })),
  ], [groups, modifiedCount]);

  const activeMeta = sections.find((section) => section.key === activeSection) || sections[0];
  const activeGroup = groups.find((group) => group.key === activeMeta?.key);
  const lanOn = Boolean(byKey('server.lan')?.value);
  const readonlyOn = byKey('server.readonlyFromLan')?.value !== false;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextHealth, cfg, nextLan, nextRemote, nextWorkspaces] = await Promise.all([
        api.health(),
        api.getConfig(),
        api.lan().catch(() => null),
        api.getRemote().catch(() => null),
        api.listWorkspaces().catch(() => ({ items: [] })),
      ]);
      setHealth(nextHealth);
      setItems(cfg.items || []);
      setProblems(cfg.problems || []);
      setLan(nextLan);
      setRemote(nextRemote);
      setRemoteUrl(nextRemote?.url || '');
      setWorkspaces(Array.isArray(nextWorkspaces) ? { items: nextWorkspaces } : nextWorkspaces);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取设置');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (sections.length && !sections.some((section) => section.key === activeSection)) {
      navigate('/settings', { replace: true });
    }
  }, [activeSection, navigate, sections]);

  const selectSection: MenuProps['onClick'] = ({ key }) => {
    navigate(key === 'workspace' ? '/settings' : `/settings/${key}`);
  };

  const save = async (key: string, value: unknown) => {
    setBusy(key);
    try {
      const result: any = await api.setConfig(key, value);
      if (result.needsRestart) setRestartNeeded(true);
      (result.problems || []).forEach((problem: string) => message.warning(problem));
      (result.sideEffects || []).forEach((sideEffect: string) => message.info(sideEffect));
      await load();
    } finally {
      setBusy('');
    }
  };

  const confirmSave = (item: ConfigItem, value: unknown) => {
    if (item.danger && value === false) {
      modal.confirm({
        title: `确定关闭「${item.label}」？`,
        content: item.note,
        okText: '确定关闭',
        okButtonProps: { danger: true },
        onOk: () => save(item.key, value),
      });
      return;
    }
    void save(item.key, value);
  };

  const reset = async (key: string) => {
    setBusy(key);
    try {
      await api.resetConfig(key);
      await load();
      message.success('已恢复默认值');
    } finally {
      setBusy('');
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  };

  const saveRemote = async () => {
    setBusy('gitRemote');
    try {
      await api.setRemote(remoteUrl.trim());
      message.success('远端已保存');
      await load();
    } finally {
      setBusy('');
    }
  };

  const removeRemote = async () => {
    setBusy('gitRemote');
    try {
      await api.removeRemote();
      message.success('远端已移除');
      await load();
    } finally {
      setBusy('');
    }
  };

  const removeWorkspace = (path: string) => {
    modal.confirm({
      title: '移除工作区？',
      content: path,
      okText: '移除',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(`workspaceRemove:${path}`);
        try {
          await api.removeWorkspace(path);
          message.success('工作区已移除');
          await load();
        } catch (nextError) {
          message.error(errorText(nextError, '无法移除工作区'));
          throw nextError;
        } finally {
          setBusy('');
        }
      },
    });
  };

  const saveWorkspace = async (mode: 'existing' | 'clone', values: WorkspaceValues) => {
    setBusy('workspaceSave');
    try {
      const mirror = Boolean(values.mirror);
      const body = {
        path: values.path.trim(),
        name: values.name?.trim() || undefined,
        mirror,
        mode: mirror ? 'mirror' : 'normal',
      };
      if (mode === 'clone') await api.cloneWorkspace({ ...body, url: values.url?.trim() || '' });
      else await api.registerWorkspace(body);
      message.success(mode === 'clone' ? '仓库已克隆并注册' : '工作区已注册');
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, mode === 'clone' ? '无法克隆工作区' : '无法注册工作区'));
      throw nextError;
    } finally {
      setBusy('');
    }
  };

  const rebuildWorkspaceIndex = async () => {
    setBusy('workspaceIndex');
    try {
      const result: any = await api.buildWorkspaceIndex();
      const count = Number.isFinite(result?.count) ? result.count : Array.isArray(result?.records) ? result.records.length : 0;
      const location = result?.path ? `，文件：${result.path}` : '';
      message.success(`索引已重建，共 ${count} 条记录${location}`);
    } catch (nextError) {
      message.error(errorText(nextError, '无法重建工作区索引'));
    } finally {
      setBusy('');
    }
  };

  const menuItems = sections.map((section) => ({
    key: section.key,
    icon: SETTING_ICONS[section.key],
    label: (
      <span className="fl-settings-menu-label">
        {section.label}
        {section.modified ? <Badge count={section.modified} size="small" /> : null}
      </span>
    ),
  }));

  return (
    <main className="fl-page">
      <PageHeader eyebrow="工作区配置" title="设置" description="工作区、网络、Git、规则、集成和外观配置。" />
      <State loading={loading} error={error} onRetry={load} empty={false}>
        {problems.map((problem) => <Alert key={problem} type="warning" showIcon message={problem} className="fl-dashboard-alert" />)}
        {!canWrite ? <Alert type="info" showIcon message="只读模式" description="这是别人共享出来的视图，设置项不可修改。" className="fl-dashboard-alert" /> : null}
        <div className="fl-settings-shell">
          <aside className="fl-settings-nav">
            <Menu mode="inline" selectedKeys={[activeMeta?.key]} items={menuItems} onClick={selectSection} />
          </aside>
          <div className="fl-settings-main">
            <div className="fl-settings-current">
              {SETTING_ICONS[activeMeta?.key]}
              <div>
                <strong>{activeMeta?.label}</strong>
                <span>{activeMeta?.description}</span>
              </div>
            </div>

            {activeMeta?.key === 'workspace' ? (
              <WorkspaceSection
                health={health}
                workspaces={workspaces}
                canWrite={canWrite}
                busy={busy}
                onCopy={(text) => void copy(text)}
                onReload={() => void load()}
                onRemove={removeWorkspace}
                onRegister={(values) => saveWorkspace('existing', values)}
                onClone={(values) => saveWorkspace('clone', values)}
                onRebuildIndex={() => void rebuildWorkspaceIndex()}
              />
            ) : null}

            {activeMeta?.key === 'lan' ? (
              <LanSection
                lan={lan}
                lanOn={lanOn}
                readonlyOn={readonlyOn}
                canWrite={canWrite}
                busy={busy}
                restartNeeded={restartNeeded}
                onCopy={(text) => void copy(text)}
                onSave={(key, value) => void save(key, value)}
              />
            ) : null}

            {activeMeta?.key === 'gitRemote' ? (
              <GitRemoteSection
                remote={remote}
                remoteUrl={remoteUrl}
                canWrite={canWrite}
                busy={busy}
                onRemoteUrlChange={setRemoteUrl}
                onSave={() => void saveRemote()}
                onRemove={() => void removeRemote()}
              />
            ) : null}

            {activeMeta?.key === 'softwareUpdate' ? (
              <SoftwareUpdateSection canWrite={canWrite} version={health?.version} />
            ) : null}

            {activeMeta?.key === 'oplog' ? <OperationLog embedded /> : null}

            {activeMeta?.key === 'mcp' ? <McpSection canWrite={canWrite} /> : null}

            {activeGroup ? (
              <ConfigGroupSection
                group={activeGroup}
                canWrite={canWrite}
                busy={busy}
                onSave={(key, value) => void save(key, value)}
                onConfirmSave={confirmSave}
                onReset={(key) => void reset(key)}
              />
            ) : null}

            {activeMeta?.key !== 'mcp' ? (
              <p className="fl-settings-help">
                仓库配置会写入根目录的 <code>flowlark.json</code>；工作区注册表只保存在本机。
              </p>
            ) : null}
          </div>
        </div>
      </State>
    </main>
  );
}
