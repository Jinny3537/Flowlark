import { useEffect, useRef, useState } from 'react';
import {
  CopyOutlined,
  ReloadOutlined,
  RollbackOutlined
} from '@ant-design/icons';
import {
  Alert,
  Collapse,
  Button,
  Checkbox,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import type { ConfigItem, HealthInfo } from '@/services/api';
import { configFieldVisible } from './settingsModel.js';
import { errorText } from '@/services/requestModel.js';
import { SECTION_DESCRIPTIONS, bytesText } from './settingsConfig';

export type SettingsGroup = {
  key: string;
  label: string;
  items: ConfigItem[];
};

type WorkspaceSectionProps = {
  health: HealthInfo | null;
  workspaces: any;
  canWrite: boolean;
  busy: string;
  onCopy: (text: string) => void;
  onReload: () => void;
  onRemove: (path: string) => void;
  onRegister: (values: WorkspaceValues) => Promise<void>;
  onClone: (values: WorkspaceValues) => Promise<void>;
};

export type WorkspaceValues = {
  url?: string;
  path: string;
  name?: string;
  mirror?: boolean;
};

type GitRemoteSectionProps = {
  remote: any;
  remoteUrl: string;
  canWrite: boolean;
  busy: string;
  onRemoteUrlChange: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
};

type ConfigGroupSectionProps = {
  group: SettingsGroup;
  canWrite: boolean;
  busy: string;
  onSave: (key: string, value: unknown) => Promise<{ needsRestart?: boolean }>;
  onConfirmSave: (item: ConfigItem, value: unknown) => void;
  onReset: (key: string) => void;
};

export function WorkspaceSection({
  health,
  workspaces,
  canWrite,
  busy,
  onCopy,
  onReload,
  onRemove,
  onRegister,
  onClone,
}: WorkspaceSectionProps) {
  const [form] = Form.useForm<WorkspaceValues>();
  const [mode, setMode] = useState<'existing' | 'clone'>('existing');

  const submit = async (values: WorkspaceValues) => {
    try {
      if (mode === 'clone') await onClone(values);
      else await onRegister(values);
      form.resetFields();
    } catch {
      // Settings reports the API error. Keeping the form intact makes retrying safe.
    }
  };

  return (
    <section className="fl-settings-section">
      <div className="fl-section-head">
        <div><h2>工作区</h2><p>{SECTION_DESCRIPTIONS.workspace}</p></div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={onReload}>刷新</Button>
        </Space>
      </div>
      <div className="fl-current-workspace">
        <div>
          <strong>当前工作区</strong>
          <code>{health?.repo || '尚未加载工作区'}</code>
        </div>
        <Button icon={<CopyOutlined />} disabled={!health?.repo} onClick={() => onCopy(health?.repo || '')}>复制路径</Button>
      </div>
      <Collapse items={[{ key: 'add', label: '添加工作区', children: <div className="fl-workspace-editor">
        <Tabs
          activeKey={mode}
          onChange={(key) => setMode(key as 'existing' | 'clone')}
          items={[
            { key: 'existing', label: '已有仓库' },
            { key: 'clone', label: '从 Git clone' },
          ]}
        />
        <Form<WorkspaceValues>
          form={form}
          layout="vertical"
          initialValues={{ mirror: false }}
          disabled={!canWrite || Boolean(busy)}
          onFinish={(values) => void submit(values)}
        >
          {mode === 'clone' ? (
            <Form.Item name="url" label="Git 地址" rules={[{ required: true, whitespace: true, message: '请填写 Git 地址' }]}>
              <Input placeholder="git@host:team/prototypes.git" />
            </Form.Item>
          ) : null}
          <Form.Item name="path" label="本机目录" rules={[{ required: true, whitespace: true, message: '请填写本机目录' }]}>
            <Input placeholder="/Users/name/Prototypes" />
          </Form.Item>
          <div className="fl-settings-two-col fl-settings-two-col-top">
            <Form.Item name="name" label="显示名称"><Input /></Form.Item>
            <Form.Item name="mirror" label="模式" valuePropName="checked"><Checkbox>只读镜像</Checkbox></Form.Item>
          </div>
          <div className="fl-workspace-form-actions">
            <Button type="primary" htmlType="submit" loading={busy === 'workspaceSave'}>
              {mode === 'clone' ? 'Clone 并注册' : '注册工作区'}
            </Button>
          </div>
        </Form>
      </div> }]} />
      <Divider />
      <List
        dataSource={workspaces.items || []}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作区" /> }}
        renderItem={(item: any) => (
          <List.Item actions={[<Button key="remove" type="text" danger disabled={!canWrite || Boolean(busy)} loading={busy === `workspaceRemove:${item.path}`} onClick={() => onRemove(item.path)}>移除</Button>]}>
            <List.Item.Meta title={item.name} description={<code>{item.path}</code>} />
            <Tag color={item.missing ? 'red' : item.mode === 'mirror' ? 'gold' : 'green'}>
              {item.missing ? '路径缺失' : item.mode === 'mirror' ? '只读镜像' : '可用'}
            </Tag>
          </List.Item>
        )}
      />
    </section>
  );
}

export function GitRemoteSection({ remote, remoteUrl, canWrite, busy, onRemoteUrlChange, onSave, onRemove }: GitRemoteSectionProps) {
  return (
    <section className="fl-settings-section">
      <div className="fl-section-head"><div><h2>Git 远端</h2><p>{SECTION_DESCRIPTIONS.gitRemote}</p></div></div>
      <Space.Compact className="fl-full-width">
        <Input value={remoteUrl} onChange={(e) => onRemoteUrlChange(e.target.value)} disabled={!canWrite} placeholder="git@github.com:team/prototypes.git" />
        <Button type="primary" disabled={!canWrite || Boolean(busy) || !remoteUrl.trim() || remoteUrl.trim() === remote?.url} loading={busy === 'gitRemote'} onClick={onSave}>保存</Button>
        <Button danger disabled={!canWrite || Boolean(busy) || !remote} onClick={onRemove}>移除</Button>
      </Space.Compact>
      {remote ? <p className="fl-settings-help">当前：<code>{remote.url}</code></p> : null}
    </section>
  );
}

export function ConfigGroupSection({ group, canWrite, busy, onSave, onConfirmSave, onReset }: ConfigGroupSectionProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!Object.keys(draft).length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  const values = Object.fromEntries(group.items.map(item => [item.key, draft[item.key] ?? item.value]));
  const visible = group.items.filter(item => configFieldVisible(item.key, values));
  const changed = visible.filter(item => item.type !== 'bool' && JSON.stringify(values[item.key]) !== JSON.stringify(item.value));
  const disabled = !canWrite || Boolean(busy) || saving;
  const edit = (key: string, value: unknown) => { setDraft(current => ({ ...current, [key]: value })); setNotice(''); };
  const submit = async () => {
    if (lock.current || !changed.length) return;
    lock.current = true; setSaving(true); setError(''); setNotice('');
    let completed = 0;
    let needsRestart = false;
    try {
      const issue = values['integrations.issueProvider'];
      if (group.key === 'feedback' && issue !== 'markdown') {
        const required = issue === 'gitlab' ? ['integrations.issueProject'] : ['integrations.issueOwner', 'integrations.issueRepo'];
        if (required.some(key => !String(values[key] || '').trim())) throw new Error(issue === 'gitlab' ? '请填写 GitLab 项目标识' : '请填写组织/用户和仓库');
      }
      if (group.key === 'links') {
        const template = String(values['ui.requirementUrlTemplate'] || '');
        if (template && !template.includes('{code}')) throw new Error('需求链接模板必须包含 {code}');
        if (template && !/^https?:\/\//i.test(template)) throw new Error('需求链接请使用 HTTP 或 HTTPS 地址');
      }
      // The API saves one key at a time. Keep failed and unattempted drafts for retry.
      // Enable providers last, after their configuration has been saved.
      const ordered = [...changed].sort((a, b) => Number(a.key.endsWith('Provider')) - Number(b.key.endsWith('Provider')));
      for (const item of ordered) {
        const result = await onSave(item.key, values[item.key]);
        needsRestart ||= Boolean(result?.needsRestart);
        completed++;
        setDraft(current => { const next = { ...current }; delete next[item.key]; return next; });
      }
      setNotice(needsRestart ? '已保存，请重启服务使配置生效' : '已保存，配置已生效');
    } catch (e) {
      setError(`${completed ? `已保存 ${completed} 项${needsRestart ? '（需重启）' : ''}；其余输入已保留。` : ''}${errorText(e, '保存失败')}`);
    } finally { lock.current = false; setSaving(false); }
  };
  const enumLabels: Record<string, string> = { relative: '相对时间（3 小时前）', absolute: '完整时间（2026-09-08 14:30）', markdown: 'Markdown 导出', none: '不启用', github: 'GitHub', gitlab: 'GitLab', gitee: 'Gitee', wecom: '企业微信', dingtalk: '钉钉', slack: 'Slack', webhook: '群机器人 Webhook', cli: '企业微信 CLI' };
  const renderControl = (item: ConfigItem) => {
    const value = values[item.key];
    if (item.type === 'bool') return <Switch aria-label={item.label} checked={Boolean(item.value)} disabled={disabled} checkedChildren="开" unCheckedChildren="关" onChange={next => onConfirmSave(item, next)} />;
    if (item.enum) return <Select aria-label={item.label} value={String(value)} disabled={disabled} options={item.enum.map(value => ({ value, label: enumLabels[value] || value }))} onChange={value => edit(item.key, value)} />;
    if (item.type === 'port' || item.type === 'int') return <InputNumber aria-label={item.label} value={Number(value)} disabled={disabled} min={item.min ?? 1} max={item.max} onChange={value => edit(item.key, value)} />;
    if (item.type === 'list') return <Select aria-label={item.label} mode="tags" value={Array.isArray(value) ? value.map(String) : []} disabled={disabled} placeholder="回车添加" onChange={value => edit(item.key, value)} />;
    return <Input aria-label={item.label} value={item.type === 'bytes' && typeof value === 'number' ? bytesText(value) : String(value ?? '')} disabled={disabled} placeholder={String(item.default || '')} onChange={event => edit(item.key, event.target.value)} />;
  };
  return <section className="fl-settings-section">
    <div className="fl-section-head"><div><h2>{group.label}</h2><p>{SECTION_DESCRIPTIONS[group.key]}</p></div></div>
    {error ? <Alert type="error" showIcon message={error} /> : null}
    {notice ? <Alert type="success" showIcon message={notice} /> : null}
    <div className="fl-config-list">{visible.map(item => <div className="fl-config-row" key={item.key}>
      <div className="fl-config-copy"><strong>{item.label}{item.danger ? <Tag color="red">高风险</Tag> : null}{!item.isDefault ? <Tag>已修改</Tag> : null}</strong>{item.note ? <span>{item.note}</span> : null}{item.key === 'integrations.wecomChatId' ? <span>已有会话 ID 时会优先使用 CLI；如需使用 Webhook，请清空会话 ID 后保存。</span> : null}</div>
      <div className="fl-config-control">{renderControl(item)}{!item.isDefault && canWrite ? <Tooltip title="恢复默认值"><Button aria-label={`恢复${item.label}默认值`} disabled={disabled || Object.keys(draft).length > 0} icon={<RollbackOutlined />} onClick={() => onReset(item.key)} /></Tooltip> : null}</div>
    </div>)}</div>
    {group.key === 'links' ? <LinkPreview template={String(values['ui.requirementUrlTemplate'] || '')} /> : null}
    {group.items.some(item => item.type !== 'bool') ? <Space wrap className="fl-settings-form-actions"><Button type="primary" disabled={disabled || !changed.length} loading={saving} onClick={() => void submit()}>保存设置</Button><Button disabled={disabled || !Object.keys(draft).length} onClick={() => { setDraft({}); setError(''); setNotice(''); }}>取消修改</Button><span className="fl-muted">{changed.length ? `${changed.length} 项待保存` : '无待保存修改'}</span></Space> : null}
    <details className="fl-settings-help"><summary>高级信息：配置键</summary>{group.items.map(item => <div key={item.key}>{item.label}：<code>{item.key}</code></div>)}</details>
  </section>;
}

function LinkPreview({ template }: { template: string }) {
  const [code, setCode] = useState('REQ-001');
  const url = template.replaceAll('{code}', encodeURIComponent(code));
  return <div className="fl-settings-link-preview"><label>预览需求编号<Input aria-label="预览需求编号" value={code} onChange={event => setCode(event.target.value)} /></label><p>链接预览：<code>{url || '尚未配置模板'}</code></p></div>;
}
