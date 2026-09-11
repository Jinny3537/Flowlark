import { Alert, App, Badge, Button, Menu, Tabs, Space } from 'antd';
import type { MenuProps } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { GitDrawer } from '@/components/GitDrawer';
import { SETTINGS_NAV, settingsLocation } from './settings/settingsModel.js';
import { IntegrationActions } from './settings/IntegrationActions';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api, type ConfigItem, type HealthInfo } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  ConfigGroupSection,
  GitRemoteSection,
  WorkspaceSection,
  type SettingsGroup,
  type WorkspaceValues,
} from './settings/SettingsSections';
import { OperationLog } from './settings/OperationLog';
import { McpSection } from './settings/McpSection';
import { SoftwareUpdateSection } from './settings/SoftwareUpdateSection';
import Trash from './Trash';
import { TeamSection } from './settings/TeamSection';
import {
  GROUP_LABELS,
  HOISTED_CONFIG_KEYS,
  SECTION_DESCRIPTIONS,
  SETTING_ICONS,
  VISIBLE_CONFIG_KEYS,
} from './settings/settingsConfig';

export default function Settings() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const runtime = useAppRuntime();
  const [gitOpen, setGitOpen] = useState(false);
  const [identity, setIdentity] = useState<any>(null);
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
  const requestedSection = params.section || 'general';
  const location = settingsLocation(requestedSection, searchParams.get('tab'));
  const activeSection = location.section;
  const activeTab = location.tab;
  const canWrite = health?.canWrite !== false;

  const byKey = useCallback((key: string) => items.find((item) => item.key === key), [items]);

  const groups = useMemo<SettingsGroup[]>(() => Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.filter((item) => (key === 'feedback' ? item.key.startsWith('integrations.issue') : key === 'notifications' ? item.key.startsWith('integrations.notification') || item.key.startsWith('integrations.wecom') : key === 'links' ? item.key === 'ui.requirementUrlTemplate' : item.group === key && item.key !== 'ui.requirementUrlTemplate') && !HOISTED_CONFIG_KEYS.has(item.key) && VISIBLE_CONFIG_KEYS.has(item.key)),
    }))
    .filter((group) => group.items.length), [items]);

  const sections = SETTINGS_NAV.map(section => ({
    ...section,
    description: SECTION_DESCRIPTIONS[section.key],
    modified: section.tabs.reduce((count, [tab]) => count + (groups.find(group => group.key === tab)?.items.filter(item => !item.isDefault).length || 0), 0),
  }));
  const activeMeta = sections.find(section => section.key === activeSection)!;
  const lanOn = Boolean(byKey('server.lan')?.value);

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
      setIdentity(await api.gitIdentity().catch(() => null));
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
    if (requestedSection !== activeSection || (searchParams.get('tab') && searchParams.get('tab') !== activeTab)) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', activeTab);
      navigate(`/settings/${activeSection}?${next}`, { replace: true });
    }
  }, [requestedSection, activeSection, activeTab, navigate, searchParams]);

  const selectSection: MenuProps['onClick'] = ({ key }) => {
    if (busy) return;
    const section = SETTINGS_NAV.find(item => item.key === key)!;
    navigate(`/settings/${key}?tab=${section.tabs[0][0]}`);
  };

  const save = async (key: string, value: unknown) => {
    if (JSON.stringify(byKey(key)?.value) === JSON.stringify(value)) return { needsRestart: false };
    setBusy(key);
    try {
      const result: any = await api.setConfig(key, value);
      (result.problems || []).forEach((problem: string) => message.warning(problem));
      (result.sideEffects || []).forEach((sideEffect: string) => message.info(sideEffect));
      const cfg = await api.getConfig();
      setItems(cfg.items || []);
      setProblems(cfg.problems || []);
      await runtime.reload();
      if (key.startsWith('git.')) setIdentity(await api.gitIdentity().catch(() => null));
      return result;
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
    void save(item.key, value).catch(e => message.error(errorText(e, '保存失败')));
  };

  const reset = async (key: string) => {
    setBusy(key);
    try {
      await api.resetConfig(key);
      const cfg = await api.getConfig();
      setItems(cfg.items || []);
      setProblems(cfg.problems || []);
      await runtime.reload();
      if (key.startsWith('git.')) setIdentity(await api.gitIdentity().catch(() => null));
      message.success(key.startsWith('server.') ? '已恢复默认值，请重启服务生效' : '已恢复默认值');
    } catch (e) {
      message.error(errorText(e, '恢复默认值失败'));
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
      content: `仅从本机注册表移除，不删除磁盘文件：${path}`,
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
      <PageHeader eyebrow="工作区配置" title="设置" description="管理工作区、团队访问和外部连接，让配置清晰生效。" />
      <State loading={loading} error={error} onRetry={load} empty={false}>
        {problems.map((problem) => <Alert key={problem} type="warning" showIcon message={problem} className="fl-dashboard-alert" />)}
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

            {activeMeta.tabs.length > 1 ? <Tabs activeKey={activeTab} onChange={tab => {
              if (busy) return;
              const next = new URLSearchParams(searchParams); next.set('tab', tab);
              navigate(`/settings/${activeSection}?${next}`);
            }} items={activeMeta.tabs.map(([key, label]) => ({ key, label }))} /> : null}
            {activeSection === 'workspace' ? <div className="fl-settings-section">
              <Space wrap><Button onClick={() => setGitOpen(true)}>打开 Git 助手</Button>
                <span>当前 Git 身份：{identity ? identity.name || '未配置' : '尚未读取'} · {identity?.email || '未配置邮箱'}</span>
              </Space><p className="fl-settings-help">身份读取自当前 Git 配置（包含继承值）。注册表保存在本机，Git 配置作用于当前仓库。</p>
            </div> : null}
            {activeTab === 'workspace' ? (
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
              />
            ) : null}

            {activeTab === 'gitRemote' ? (
              <GitRemoteSection
                remote={remote}
                remoteUrl={remoteUrl}
                canWrite={canWrite}
                busy={busy}
                onRemoteUrlChange={setRemoteUrl}
                onSave={() => void saveRemote().catch(e => message.error(errorText(e, '保存远端失败')))}
                onRemove={() => modal.confirm({ title: '移除 Git 远端？', content: '停止向此远端同步，不删除远端仓库。', onOk: removeRemote })}
              />
            ) : null}

            {activeTab === 'softwareUpdate' ? (
              <SoftwareUpdateSection canWrite={canWrite} version={health?.version} />
            ) : null}

            {activeTab === 'team' ? <TeamSection lan={lan} lanOn={lanOn} canWrite={canWrite} networkBusy={busy === 'server.lan'} onSaveLan={(enabled) => save('server.lan', enabled)} onCopy={copy} /> : null}

            {activeTab === 'trash' ? <Trash /> : null}

            {activeTab === 'oplog' ? <OperationLog embedded /> : null}

            {activeTab === 'mcp' ? <McpSection canWrite={canWrite} /> : null}

            {groups.map(group => <div key={group.key} hidden={group.key !== activeTab}>
              <ConfigGroupSection
                group={group}
                canWrite={canWrite}
                busy={busy}
                onSave={save}
                onConfirmSave={confirmSave}
                onReset={(key) => void reset(key)}
              />
            </div>)}

            {['feedback', 'notifications'].includes(activeTab) ? <IntegrationActions key={`${activeTab}:${JSON.stringify(items.map(item => item.value))}`} kind={activeTab} items={items} canWrite={canWrite} /> : null}
            {activeTab === 'server' ? <section className="fl-settings-section"><h2>搜索索引</h2><p>跨工作区搜索缺少内容时，重建本机索引。</p><Button disabled={!canWrite || Boolean(busy)} loading={busy === 'workspaceIndex'} onClick={() => void rebuildWorkspaceIndex()}>重建索引</Button></section> : null}

            {!['mcp', 'team', 'trash', 'softwareUpdate', 'oplog'].includes(activeTab) ? (
              <p className="fl-settings-help">
                仓库配置会写入根目录的 <code>flowlark.json</code>；工作区注册表只保存在本机。
              </p>
            ) : null}
          </div>
        </div>
      </State>
      <GitDrawer open={gitOpen} onClose={() => setGitOpen(false)} onChanged={runtime.reload} />
    </main>
  );
}
