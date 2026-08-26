import {
  Alert,
  App,
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
  Spin,
  Tag,
} from 'antd';
import type { FormInstance } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { capabilityPayload, parseHeaders, serverForm, serverPayload } from './mcpModel.js';

type McpServer = {
  id: string;
  name: string;
  type?: string;
  enabled?: boolean;
  url: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

type McpCapability = {
  enabled?: boolean;
  server?: string;
  label?: string;
  category?: string;
  description?: string;
  project?: string;
  tools?: Record<string, string>;
};

type McpInfo = {
  file?: string;
  exists?: boolean;
  problems?: string[];
  config?: {
    servers?: McpServer[];
    capabilities?: Record<string, McpCapability>;
  };
};

type ServerValues = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  url: string;
  timeoutMs: number;
  headersText: string;
};

type CapabilityValues = {
  enabled: boolean;
  server: string;
  label: string;
  category: string;
  description: string;
  project: string;
  toolsText: string;
};

type ExtensionValues = CapabilityValues & { name: string };

type TestResult = { type: 'success' | 'error'; text: string };

const REQUIREMENT_DEFAULTS = {
  enabled: false,
  server: '',
  label: '需求',
  category: 'product',
  description: '搜索、导入和回写外部需求',
  project: '',
  tools: {
    test: 'requirements.test',
    search: 'requirements.search',
    get: 'requirements.get',
    comment: 'requirements.comment',
  },
};

const MILESTONE_DEFAULTS = {
  enabled: false,
  server: '',
  label: '迭代',
  category: 'delivery',
  description: '拉取和回写任务平台迭代计划',
  project: '',
  tools: {
    test: 'milestones.test',
    list: 'milestones.list',
    get: 'milestones.get',
    upsert: 'milestones.upsert',
  },
};

const EMPTY_EXTENSION = {
  name: '',
  enabled: false,
  server: '',
  label: '',
  category: 'extension',
  description: '',
  project: '',
  toolsText: '{\n  "test": ""\n}',
};

function capabilityForm(capability: McpCapability | undefined, defaults: typeof REQUIREMENT_DEFAULTS): CapabilityValues {
  const value = { ...defaults, ...(capability || {}) };
  return {
    enabled: value.enabled === true,
    server: value.server || '',
    label: value.label || defaults.label,
    category: value.category || defaults.category,
    description: value.description || defaults.description,
    project: value.project || '',
    toolsText: JSON.stringify({ ...defaults.tools, ...(capability?.tools || {}) }, null, 2),
  };
}

function extensionForm(name: string, capability: McpCapability): ExtensionValues {
  return {
    name,
    enabled: capability.enabled === true,
    server: capability.server || '',
    label: capability.label || name,
    category: capability.category || 'extension',
    description: capability.description || '',
    project: capability.project || '',
    toolsText: JSON.stringify(capability.tools || { test: '' }, null, 2),
  };
}

function validateHeaders(_: unknown, value: string) {
  try {
    parseHeaders(value);
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(new Error(errorText(error, '请求头 JSON 不合法')));
  }
}

function validateMcpUrl(_: unknown, value: string) {
  if (!String(value || '').trim()) return Promise.resolve();
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return Promise.resolve();
  } catch {
    // Use the same stable message for malformed and unsupported URLs.
  }
  return Promise.reject(new Error('请填写有效的 HTTP/HTTPS URL'));
}

function validateTools(_: unknown, value: string) {
  try {
    capabilityPayload({
      enabled: false,
      server: '',
      label: '',
      category: '',
      description: '',
      project: '',
      toolsText: value,
    });
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(new Error(errorText(error, '工具映射 JSON 不合法')));
  }
}

function testResultText(result: any) {
  if (result?.identity) return `连接成功：${result.identity}`;
  if (result?.name) return `连接成功：${result.name}`;
  if (result?.result !== undefined) {
    if (typeof result.result === 'string') return `连接成功：${result.result}`;
    try {
      return `连接成功：${JSON.stringify(result.result)}`;
    } catch {
      return '连接成功，已收到服务返回结果';
    }
  }
  return '连接成功';
}

type CapabilityEditorProps = {
  name: 'requirements' | 'milestones';
  title: string;
  serverLabel: string;
  nameLabel: string;
  form: FormInstance<CapabilityValues>;
  serverOptions: { value: string; label: string }[];
  canWrite: boolean;
  saving: string;
  testing: string;
  result?: TestResult;
  onSave: (name: string, form: FormInstance<CapabilityValues>, successText: string) => Promise<void>;
  onTest: (name: string) => Promise<void>;
};

function CapabilityEditor({
  name,
  title,
  serverLabel,
  nameLabel,
  form,
  serverOptions,
  canWrite,
  saving,
  testing,
  result,
  onSave,
  onTest,
}: CapabilityEditorProps) {
  const noun = name === 'requirements' ? '需求' : '迭代';
  return (
    <div className="fl-mcp-capability">
      <div className="fl-mcp-subtitle">{title}</div>
      <Form<CapabilityValues> name={`mcp-${name}`} form={form} layout="vertical" disabled={!canWrite}>
        <div className="fl-mcp-form-grid">
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Checkbox>启用{noun} MCP 能力</Checkbox>
          </Form.Item>
          <Form.Item name="server" label={serverLabel}>
            <Select options={serverOptions} placeholder="选择 MCP 服务" allowClear />
          </Form.Item>
        </div>
        <div className="fl-mcp-form-grid">
          <Form.Item name="project" label={`${noun}外部项目标识`}><Input placeholder="可选" /></Form.Item>
          <Form.Item name="label" label={nameLabel} rules={[{ required: true, whitespace: true, message: `请填写${noun}能力名称` }]}>
            <Input />
          </Form.Item>
        </div>
        <div className="fl-mcp-form-grid">
          <Form.Item name="category" label={`${noun}能力分类`} rules={[{ required: true, whitespace: true, message: `请填写${noun}能力分类` }]}>
            <Input className="fl-mono" />
          </Form.Item>
          <Form.Item name="description" label={`${noun}能力说明`}><Input /></Form.Item>
        </div>
        <Form.Item name="toolsText" label="工具映射 JSON" rules={[{ validator: validateTools }]}>
          <Input.TextArea rows={5} className="fl-mono" spellCheck={false} />
        </Form.Item>
        <Space wrap>
          <Button type="primary" loading={saving === name} disabled={!canWrite || Boolean(saving)} onClick={() => void onSave(name, form, `${noun} MCP 映射已保存`)}>
            保存{noun}能力
          </Button>
          <Button loading={testing === name} disabled={!canWrite || Boolean(testing)} onClick={() => void onTest(name)}>
            测试{noun}能力
          </Button>
        </Space>
      </Form>
      {result ? <Alert className="fl-mcp-result" showIcon type={result.type} message={result.text} /> : null}
    </div>
  );
}

export function McpSection({ canWrite }: { canWrite: boolean }) {
  const { message, modal } = App.useApp();
  const [serverAntForm] = Form.useForm<ServerValues>();
  const [requirementForm] = Form.useForm<CapabilityValues>();
  const [milestoneForm] = Form.useForm<CapabilityValues>();
  const [extensionAntForm] = Form.useForm<ExtensionValues>();
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState('');
  const [testing, setTesting] = useState('');
  const [editingServer, setEditingServer] = useState(false);
  const [editingExtension, setEditingExtension] = useState(false);
  const [secret, setSecret] = useState('');
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const serverId = Form.useWatch('id', serverAntForm) || '';
  const extensionName = Form.useWatch('name', extensionAntForm) || '';
  const extensionLabel = Form.useWatch('label', extensionAntForm) || extensionName || '扩展能力';

  const updateBuiltinForms = useCallback((next: McpInfo) => {
    requirementForm.setFieldsValue(capabilityForm(next.config?.capabilities?.requirements, REQUIREMENT_DEFAULTS));
    milestoneForm.setFieldsValue(capabilityForm(next.config?.capabilities?.milestones, MILESTONE_DEFAULTS));
  }, [milestoneForm, requirementForm]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next: McpInfo = await api.getMcpConfig();
      setInfo(next);
      updateBuiltinForms(next);
      setEditingServer(false);
      setEditingExtension(false);
      setSecret('');
      serverAntForm.resetFields();
      extensionAntForm.resetFields();
    } catch (error) {
      setLoadError(errorText(error, '无法读取 MCP 配置'));
    } finally {
      setLoading(false);
    }
  }, [extensionAntForm, serverAntForm, updateBuiltinForms]);

  useEffect(() => {
    void load();
  }, [load]);

  const servers = info?.config?.servers || [];
  const capabilities = info?.config?.capabilities || {};
  const customCapabilities = useMemo(() => Object.entries(capabilities)
    .filter(([name]) => !['requirements', 'milestones'].includes(name))
    .map(([name, capability]) => ({ name, capability })), [capabilities]);
  const enabledCapabilityCount = Object.values(capabilities).filter((capability) => capability?.enabled).length;
  const serverOptions = servers.map((server) => ({
    value: server.id,
    label: `${server.name || server.id} · ${server.id}${server.enabled === false ? '（停用）' : ''}`,
  }));

  const newServer = () => {
    setEditingServer(false);
    setSecret('');
    serverAntForm.resetFields();
  };

  const editServer = (server: McpServer) => {
    setEditingServer(true);
    setSecret('');
    serverAntForm.setFieldsValue(serverForm(server));
  };

  const saveServer = async () => {
    let values: ServerValues;
    try {
      values = await serverAntForm.validateFields();
    } catch {
      return;
    }
    const id = values.id.trim();
    setSaving('server');
    try {
      const next: McpInfo = await api.saveMcpServer(id, serverPayload(values));
      if (secret) await api.setMcpServerSecret(id, secret);
      setSecret('');
      setInfo(next);
      const saved = next.config?.servers?.find((server) => server.id === id);
      if (saved) {
        setEditingServer(true);
        serverAntForm.setFieldsValue(serverForm(saved));
      }
      message.success('MCP 服务已保存');
    } catch (error) {
      message.error(errorText(error, 'MCP 服务保存失败'));
    } finally {
      setSaving('');
    }
  };

  const removeServer = (id: string) => {
    modal.confirm({
      title: '删除 MCP 服务？',
      content: `删除 ${id} 后，绑定该服务的能力会自动停用。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(`removeServer:${id}`);
        try {
          const next: McpInfo = await api.removeMcpServer(id);
          setInfo(next);
          updateBuiltinForms(next);
          if (serverAntForm.getFieldValue('id') === id) newServer();
          message.success('MCP 服务已删除');
        } catch (error) {
          message.error(errorText(error, 'MCP 服务删除失败'));
          throw error;
        } finally {
          setSaving('');
        }
      },
    });
  };

  const saveSecret = async () => {
    const id = String(serverAntForm.getFieldValue('id') || '').trim();
    if (!id || !secret) return;
    setSaving('secret');
    try {
      await api.setMcpServerSecret(id, secret);
      setSecret('');
      message.success('MCP 密钥已保存到本机');
    } catch (error) {
      message.error(errorText(error, 'MCP 密钥保存失败'));
    } finally {
      setSaving('');
    }
  };

  const deleteSecret = () => {
    const id = String(serverAntForm.getFieldValue('id') || '').trim();
    if (!id) return;
    modal.confirm({
      title: '删除本机 MCP 密钥？',
      content: `只删除服务 ${id} 在本机保存的密钥，不修改仓库中的 MCP 配置。`,
      okText: '删除密钥',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving('deleteSecret');
        try {
          await api.deleteMcpServerSecret(id);
          setSecret('');
          message.success('MCP 密钥已删除');
        } catch (error) {
          message.error(errorText(error, 'MCP 密钥删除失败'));
          throw error;
        } finally {
          setSaving('');
        }
      },
    });
  };

  const saveCapability = async (name: string, form: FormInstance<CapabilityValues>, successText: string) => {
    let values: CapabilityValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(name);
    try {
      const next: McpInfo = await api.saveMcpCapability(name, capabilityPayload(values));
      setInfo(next);
      message.success(successText);
    } catch (error) {
      message.error(errorText(error, `${successText.replace('已保存', '保存失败')}`));
    } finally {
      setSaving('');
    }
  };

  const testCapability = async (name: string) => {
    setTesting(name);
    try {
      const result = await api.testMcpCapability(name);
      const text = testResultText(result);
      setTestResults((current) => ({ ...current, [name]: { type: 'success', text } }));
      message.success(text);
    } catch (error) {
      const text = errorText(error, 'MCP 连接测试失败');
      setTestResults((current) => ({ ...current, [name]: { type: 'error', text } }));
      message.error(text);
    } finally {
      setTesting('');
    }
  };

  const newExtension = () => {
    setEditingExtension(false);
    extensionAntForm.resetFields();
  };

  const editExtension = (name: string, capability: McpCapability) => {
    setEditingExtension(true);
    extensionAntForm.setFieldsValue(extensionForm(name, capability));
  };

  const saveExtension = async () => {
    let values: ExtensionValues;
    try {
      values = await extensionAntForm.validateFields();
    } catch {
      return;
    }
    const name = values.name.trim();
    setSaving('extension');
    try {
      const next: McpInfo = await api.saveMcpCapability(name, capabilityPayload(values));
      setInfo(next);
      setEditingExtension(true);
      const saved = next.config?.capabilities?.[name];
      if (saved) extensionAntForm.setFieldsValue(extensionForm(name, saved));
      message.success('扩展 MCP 能力已保存');
    } catch (error) {
      message.error(errorText(error, '扩展 MCP 能力保存失败'));
    } finally {
      setSaving('');
    }
  };

  const removeExtension = (name: string, label: string) => {
    modal.confirm({
      title: '删除扩展 MCP 能力？',
      content: `${label}（${name}）`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(`removeExtension:${name}`);
        try {
          const next: McpInfo = await api.removeMcpCapability(name);
          setInfo(next);
          if (extensionAntForm.getFieldValue('name') === name) newExtension();
          message.success('扩展 MCP 能力已删除');
        } catch (error) {
          message.error(errorText(error, '扩展 MCP 能力删除失败'));
          throw error;
        } finally {
          setSaving('');
        }
      },
    });
  };

  return (
    <section className="fl-settings-section">
      <div className="fl-section-head">
        <div>
          <h2>MCP 中心</h2>
          <p>集中管理外部 MCP 服务、保存在本机的密钥和业务能力映射。</p>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
          <Button type="primary" disabled={!canWrite} onClick={newServer}>新增服务</Button>
        </Space>
      </div>

      {loadError ? <Alert className="fl-settings-status" type="error" showIcon message={loadError} action={<Button size="small" onClick={() => void load()}>重试</Button>} /> : null}
      {(info?.problems || []).map((problem) => <Alert key={problem} className="fl-settings-status" type="warning" showIcon message={problem} />)}

      <Spin spinning={loading && !info}>
        {info ? (
          <div className="fl-mcp-stack">
            <div className="fl-settings-summary">
              <div><strong>{servers.length}</strong><span>MCP 服务</span></div>
              <div><strong>{enabledCapabilityCount}</strong><span>已启用能力</span></div>
              <div><strong>{info.exists ? '已创建' : '未创建'}</strong><span>{info.file || 'mcp.json'}</span></div>
            </div>

            <Divider orientation="left">MCP 服务</Divider>
            <div className="fl-mcp-grid">
              <List
                bordered
                dataSource={servers}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 MCP 服务" /> }}
                renderItem={(server) => (
                  <List.Item
                    actions={[
                      <Button key="edit" type="link" onClick={() => editServer(server)}>编辑</Button>,
                      <Button key="delete" type="link" danger disabled={!canWrite || Boolean(saving)} loading={saving === `removeServer:${server.id}`} onClick={() => removeServer(server.id)}>删除</Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Space wrap size={6}><span>{server.name || server.id}</span><code>{server.id}</code><Tag color={server.enabled === false ? 'default' : 'green'}>{server.enabled === false ? '停用' : '启用'}</Tag></Space>}
                      description={<span className="fl-mcp-url">{server.url}</span>}
                    />
                  </List.Item>
                )}
              />

              <div className="fl-mcp-editor">
                <div className="fl-mcp-subtitle">{editingServer ? '编辑 MCP 服务' : '新增 MCP 服务'}</div>
                <Form<ServerValues> name="mcp-server" form={serverAntForm} layout="vertical" disabled={!canWrite} initialValues={serverForm()}>
                  <div className="fl-mcp-form-grid">
                    <Form.Item name="id" label="服务标识" rules={[
                      { required: true, whitespace: true, message: '请填写 MCP 服务标识' },
                      { pattern: /^[a-z0-9._-]{1,64}$/, message: '只能包含小写字母、数字、点、下划线和连字符' },
                    ]}>
                      <Input className="fl-mono" disabled={editingServer || !canWrite} placeholder="requirements-mcp" />
                    </Form.Item>
                    <Form.Item name="name" label="显示名称" rules={[{ required: true, whitespace: true, message: '请填写显示名称' }]}>
                      <Input placeholder="需求系统 MCP" />
                    </Form.Item>
                  </div>
                  <Form.Item name="url" label="MCP URL" rules={[
                    { required: true, whitespace: true, message: '请填写 MCP URL' },
                    { validator: validateMcpUrl },
                  ]}>
                    <Input placeholder="http://127.0.0.1:9000/mcp" />
                  </Form.Item>
                  <Form.Item label="本机密钥" extra="已保存的密钥不会回显；留空保存服务时不会覆盖原值。">
                    <Input.Password value={secret} autoComplete="new-password" placeholder="只保存在本机，不写入仓库" onChange={(event) => setSecret(event.target.value)} />
                  </Form.Item>
                  <div className="fl-mcp-form-grid">
                    <Form.Item name="type" label="传输类型"><Select options={[{ value: 'http', label: 'HTTP' }, { value: 'sse', label: 'SSE' }]} /></Form.Item>
                    <Form.Item name="timeoutMs" label="超时（毫秒）" rules={[{ required: true, message: '请填写超时时间' }]}>
                      <InputNumber min={100} step={1000} className="fl-full-width" />
                    </Form.Item>
                  </div>
                  <Form.Item name="enabled" label="服务状态" valuePropName="checked"><Checkbox>启用服务</Checkbox></Form.Item>
                  <Form.Item name="headersText" label="请求头 JSON" rules={[{ validator: validateHeaders }]}>
                    <Input.TextArea rows={5} className="fl-mono" spellCheck={false} />
                  </Form.Item>
                  <Space wrap>
                    <Button type="primary" loading={saving === 'server'} disabled={!canWrite || Boolean(saving)} onClick={() => void saveServer()}>保存服务</Button>
                    <Button loading={saving === 'secret'} disabled={!canWrite || Boolean(saving) || !secret || !String(serverId).trim()} onClick={() => void saveSecret()}>保存密钥</Button>
                    <Button danger loading={saving === 'deleteSecret'} disabled={!canWrite || Boolean(saving) || !String(serverId).trim()} onClick={deleteSecret}>删除本机密钥</Button>
                    <Button onClick={newServer}>清空</Button>
                  </Space>
                </Form>
              </div>
            </div>

            <Divider orientation="left">内置能力映射</Divider>
            <div className="fl-mcp-capabilities">
              <CapabilityEditor
                name="requirements"
                title="需求能力映射"
                serverLabel="需求绑定服务"
                nameLabel="需求能力名称"
                form={requirementForm}
                serverOptions={serverOptions}
                canWrite={canWrite}
                saving={saving}
                testing={testing}
                result={testResults.requirements}
                onSave={saveCapability}
                onTest={testCapability}
              />
              <CapabilityEditor
                name="milestones"
                title="迭代能力映射"
                serverLabel="迭代绑定服务"
                nameLabel="迭代能力名称"
                form={milestoneForm}
                serverOptions={serverOptions}
                canWrite={canWrite}
                saving={saving}
                testing={testing}
                result={testResults.milestones}
                onSave={saveCapability}
                onTest={testCapability}
              />
            </div>

            <Divider orientation="left">扩展模块（{customCapabilities.length}）</Divider>
            <Alert type="info" showIcon message="只有业务页面已经接入某个 MCP 能力时，才需要增加扩展映射。" />
            <div className="fl-mcp-grid">
              <List
                bordered
                dataSource={customCapabilities}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无扩展能力" /> }}
                renderItem={({ name, capability }) => {
                  const label = capability.label || name;
                  return (
                    <List.Item
                    actions={[
                      <Button key="edit" type="link" onClick={() => editExtension(name, capability)}>编辑</Button>,
                      <Button key="delete" type="link" danger disabled={!canWrite || Boolean(saving)} loading={saving === `removeExtension:${name}`} onClick={() => removeExtension(name, label)}>删除 {label}</Button>,
                    ]}
                    >
                      <List.Item.Meta
                        title={<Space wrap size={6}><span>{label}</span><code>{name}</code><Tag color={capability.enabled ? 'green' : 'default'}>{capability.enabled ? '启用' : '停用'}</Tag></Space>}
                        description={`${capability.description || '未填写说明'} · ${capability.server || '未绑定服务'}`}
                      />
                    </List.Item>
                  );
                }}
              />

              <div className="fl-mcp-editor">
                <div className="fl-mcp-subtitle">{editingExtension ? '编辑扩展能力' : '新增扩展能力'}</div>
                <Form<ExtensionValues> name="mcp-extension" form={extensionAntForm} layout="vertical" disabled={!canWrite} initialValues={EMPTY_EXTENSION}>
                  <div className="fl-mcp-form-grid">
                    <Form.Item name="name" label="能力标识" rules={[
                      { required: true, whitespace: true, message: '请填写 MCP 能力标识' },
                      { pattern: /^[a-z0-9._-]{1,64}$/, message: '只能包含小写字母、数字、点、下划线和连字符' },
                      { validator: (_, value) => ['requirements', 'milestones'].includes(String(value || '').trim()) ? Promise.reject(new Error('内置能力请在上方编辑')) : Promise.resolve() },
                    ]}>
                      <Input className="fl-mono" disabled={editingExtension || !canWrite} placeholder="tickets" />
                    </Form.Item>
                    <Form.Item name="label" label="扩展名称" rules={[{ required: true, whitespace: true, message: '请填写扩展名称' }]}>
                      <Input placeholder="工单" />
                    </Form.Item>
                  </div>
                  <div className="fl-mcp-form-grid">
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Checkbox>启用扩展能力</Checkbox></Form.Item>
                    <Form.Item name="server" label="扩展绑定服务"><Select options={serverOptions} placeholder="选择 MCP 服务" allowClear /></Form.Item>
                  </div>
                  <div className="fl-mcp-form-grid">
                    <Form.Item name="category" label="扩展能力分类" rules={[{ required: true, whitespace: true, message: '请填写扩展能力分类' }]}>
                      <Input className="fl-mono" />
                    </Form.Item>
                    <Form.Item name="project" label="扩展外部项目标识"><Input placeholder="可选" /></Form.Item>
                  </div>
                  <Form.Item name="description" label="扩展能力说明"><Input /></Form.Item>
                  <Form.Item name="toolsText" label="扩展工具映射 JSON" rules={[{ validator: validateTools }]}>
                    <Input.TextArea rows={5} className="fl-mono" spellCheck={false} />
                  </Form.Item>
                  <Space wrap>
                    <Button type="primary" loading={saving === 'extension'} disabled={!canWrite || Boolean(saving)} onClick={() => void saveExtension()}>保存扩展能力</Button>
                    <Button loading={Boolean(extensionName) && testing === extensionName} disabled={!canWrite || Boolean(testing) || !extensionName} onClick={() => void testCapability(extensionName)}>测试 {extensionLabel}</Button>
                    <Button onClick={newExtension}>清空</Button>
                  </Space>
                </Form>
                {extensionName && testResults[extensionName] ? <Alert className="fl-mcp-result" showIcon type={testResults[extensionName].type} message={testResults[extensionName].text} /> : null}
              </div>
            </div>
          </div>
        ) : null}
      </Spin>
    </section>
  );
}
