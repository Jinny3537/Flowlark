import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Col, DatePicker, Divider, Form, Input, List, Modal, Row, Select, Space, Statistic, Table, Tag } from 'antd';
import { CloudDownloadOutlined, PlusOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { textOf } from '@/utils/format';
import {
  filterRequirements,
  requirementPayload,
} from './requirementsModel.js';
import {
  PROTOTYPE_PROGRESS_OPTIONS,
  REQUIREMENT_STATUS_OPTIONS,
} from './requirementLifecycleModel.js';
import { parseRequirementPoolManifestText, validateRequirementPoolManifestFile } from './settings/mcpModel.js';

type ExternalState = {
  provider: string;
  token: string;
  query: string;
};

type RequirementPoolManifestPreview = {
  platform?: { name?: string; id?: string };
  server?: { id?: string; name?: string };
  capability?: { tools?: Record<string, string> };
  secrets?: { name: string; label?: string; required?: boolean }[];
  warnings?: { code?: string; message?: string }[];
  blockers?: { code?: string; message?: string }[];
};

type RequirementPoolStatus = {
  status?: string;
  ready?: boolean;
  canProbe?: boolean;
  connected?: boolean;
  platform?: { name?: string; id?: string } | null;
  server?: { id?: string; name?: string } | null;
  capability?: { project?: string; tools?: Record<string, string> };
  missingSecrets?: { kind?: string; name?: string; label?: string }[];
  warnings?: { code?: string; message?: string; hint?: string }[];
  blockers?: { code?: string; message?: string; hint?: string }[];
  connection?: { identity?: string; name?: string };
};

function requirementPoolStatusTone(status: RequirementPoolStatus | null): 'success' | 'warning' | 'error' | 'info' {
  if (!status) return 'info';
  if (status.connected || status.status === 'ready_to_test') return 'success';
  if (status.status === 'needs_secret') return 'warning';
  return 'error';
}

function requirementPoolStatusTitle(status: RequirementPoolStatus) {
  if (status.connected) return '需求池连接测试通过';
  if (status.status === 'ready_to_test') return '需求池配置已具备连接测试条件';
  if (status.status === 'needs_secret') return '需求池配置缺少本机密钥';
  if (status.status === 'not_configured') return '需求池尚未完成配置';
  if (status.status === 'probe_failed') return '需求池连接测试失败';
  return '需求池配置存在阻塞项';
}

export default function Requirements() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [prototypeProgress, setPrototypeProgress] = useState('');
  const [bindingFilter, setBindingFilter] = useState('');
  const [milestoneFilter, setMilestoneFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalResults, setExternalResults] = useState<any[]>([]);
  const [importingCode, setImportingCode] = useState('');
  const [external, setExternal] = useState<ExternalState>({ provider: 'mcp', token: '', query: '' });
  const [manifestText, setManifestText] = useState('');
  const [manifestPreview, setManifestPreview] = useState<RequirementPoolManifestPreview | null>(null);
  const [requirementPoolStatus, setRequirementPoolStatus] = useState<RequirementPoolStatus | null>(null);
  const [requirementPoolSecrets, setRequirementPoolSecrets] = useState<Record<string, string>>({});
  const [manifestAction, setManifestAction] = useState('');
  const manifestFileInputRef = useRef<HTMLInputElement | null>(null);
  const [form] = Form.useForm();
  const manifestBlocked = Boolean(manifestPreview?.blockers?.length);

  const projectOptions = useMemo(
    () => [...new Set(items.map((item) => item.project).filter(Boolean))].sort().map((value) => ({ value, label: value })),
    [items],
  );
  const milestoneOptions = useMemo(
    () => [...new Set(items.flatMap((item) => item.milestones || []).map((entry: any) => typeof entry === 'string' ? entry : entry?.name).filter(Boolean))]
      .sort()
      .map((value) => ({ value, label: value })),
    [items],
  );

  const filtered = useMemo(() => filterRequirements(items, {
    query,
    lifecycle,
    prototypeProgress,
    project: projectFilter,
    source: sourceFilter,
    binding: bindingFilter,
    milestone: milestoneFilter,
  }), [bindingFilter, items, lifecycle, milestoneFilter, projectFilter, prototypeProgress, query, sourceFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [requirements, milestones] = await Promise.all([
        api.listRequirements(),
        api.listMilestones(),
      ]);
      setItems(requirements.map((requirement) => ({
        ...requirement,
        milestones: requirement.milestones || milestones.filter((milestone: any) =>
          (milestone.items || []).some((entry: any) => entry.requirement === requirement.code)),
      })));
    } catch (nextError) {
      setError(errorText(nextError, '无法读取需求'));
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const item = await api.createRequirement(requirementPayload(values));
      message.success(`已创建 ${item.code}`);
      setOpen(false);
      form.resetFields();
      navigate(`/requirements/${encodeURIComponent(item.code)}`);
    } catch (nextError) {
      message.error(errorText(nextError, '创建需求失败'));
    } finally {
      setSaving(false);
    }
  }, [form, message, navigate]);

  const saveExternalToken = useCallback(async () => {
    if (!external.token.trim()) {
      message.warning('请输入 Token');
      return;
    }
    try {
      await api.setRequirementToken(external.provider, external.token);
      setExternal((current) => ({ ...current, token: '' }));
      message.success('Token 已保存到钥匙串');
    } catch (nextError) {
      message.error(errorText(nextError, '保存 Token 失败'));
    }
  }, [external.provider, external.token, message]);

  const searchExternal = useCallback(async () => {
    if (!external.query.trim()) {
      message.warning('请输入搜索关键词');
      return;
    }
    setExternalLoading(true);
    try {
      setExternalResults(await api.searchExternalRequirements(external.provider, external.query, { token: external.token }));
    } catch (nextError) {
      message.error(errorText(nextError, '搜索需求池失败'));
    } finally {
      setExternalLoading(false);
    }
  }, [external, message]);

  const importExternal = useCallback(async (code: string) => {
    setImportingCode(code);
    try {
      const item: any = await api.importExternalRequirement(external.provider, code, { token: external.token });
      message.success(`已导入 ${item.code}`);
      setExternalOpen(false);
      await load();
      navigate(`/requirements/${encodeURIComponent(item.code)}`);
    } catch (nextError) {
      message.error(errorText(nextError, '导入需求失败'));
    } finally {
      setImportingCode('');
    }
  }, [external.provider, external.token, load, message, navigate]);

  const loadRequirementPoolManifestTemplate = useCallback(async () => {
    setManifestAction('template');
    try {
      const template = await api.requirementPoolManifestTemplate();
      setManifestText(JSON.stringify(template, null, 2));
      setManifestPreview(null);
      message.success('已加载需求池配置示例');
    } catch (nextError) {
      message.error(errorText(nextError, '加载需求池配置示例失败'));
    } finally {
      setManifestAction('');
    }
  }, [message]);

  const loadRequirementPoolManifestFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      validateRequirementPoolManifestFile(file);
      const text = await file.text();
      parseRequirementPoolManifestText(text);
      setManifestText(text);
      setManifestPreview(null);
      message.success(`已读取 ${file.name}`);
    } catch (nextError) {
      message.error(errorText(nextError, '读取需求池配置失败'));
    }
  }, [message]);

  const inspectRequirementPoolManifest = useCallback(async () => {
    let manifest: unknown;
    try {
      manifest = parseRequirementPoolManifestText(manifestText);
    } catch (nextError) {
      message.error(errorText(nextError, '需求池配置 JSON 不合法'));
      return;
    }
    setManifestAction('inspect');
    try {
      const preview = await api.inspectRequirementPoolManifest(manifest) as RequirementPoolManifestPreview;
      setManifestPreview(preview);
      if (preview.blockers?.length) message.warning(`发现 ${preview.blockers.length} 个阻塞项`);
      else message.success('配置 JSON 可导入');
    } catch (nextError) {
      message.error(errorText(nextError, '需求池配置预览失败'));
    } finally {
      setManifestAction('');
    }
  }, [manifestText, message]);

  const importRequirementPoolManifest = useCallback(async () => {
    let manifest: unknown;
    try {
      manifest = parseRequirementPoolManifestText(manifestText);
    } catch (nextError) {
      message.error(errorText(nextError, '需求池配置 JSON 不合法'));
      return;
    }
    setManifestAction('import');
    try {
      const result = await api.importRequirementPoolManifest(manifest) as { imported?: RequirementPoolManifestPreview };
      setManifestPreview(result.imported || null);
      setRequirementPoolStatus(await api.requirementPoolStatus(false) as RequirementPoolStatus);
      message.success('需求池 MCP 配置已导入；密钥仍需在本机单独保存');
    } catch (nextError) {
      message.error(errorText(nextError, '需求池配置导入失败'));
    } finally {
      setManifestAction('');
    }
  }, [manifestText, message]);

  const checkRequirementPoolStatus = useCallback(async (probe = false) => {
    setManifestAction(probe ? 'probe' : 'status');
    try {
      const result = await api.requirementPoolStatus(probe) as RequirementPoolStatus;
      setRequirementPoolStatus(result);
      if (result.connected) message.success('需求池连接测试通过');
      else if (result.ready) message.success('需求池配置已具备连接测试条件');
      else message.warning(requirementPoolStatusTitle(result));
    } catch (nextError) {
      message.error(errorText(nextError, '需求池接入状态检查失败'));
    } finally {
      setManifestAction('');
    }
  }, [message]);

  const saveRequirementPoolSecret = useCallback(async (name: string) => {
    const value = requirementPoolSecrets[name] || '';
    if (!name || !value) return;
    setManifestAction(`secret:${name}`);
    try {
      await api.setMcpServerSecret(name, value);
      setRequirementPoolSecrets((current) => ({ ...current, [name]: '' }));
      setRequirementPoolStatus(await api.requirementPoolStatus(false) as RequirementPoolStatus);
      message.success(`本机密钥 ${name} 已保存`);
    } catch (nextError) {
      message.error(errorText(nextError, '需求池本机密钥保存失败'));
    } finally {
      setManifestAction('');
    }
  }, [message, requirementPoolSecrets]);

  const syncPool = useCallback(async () => {
    setSyncing(true);
    try {
      const result: any = await api.syncRequirements(external.provider, { token: external.token }, 'list');
      await load();
      const failed = Array.isArray(result.failed) ? result.failed.length : Number(result.failed || 0);
      const missing = Number(result.missing || 0);
      message.success(`已刷新需求池：新增 ${result.created || 0} 条，更新 ${result.updated || 0} 条${missing ? `，不可访问 ${missing} 条` : ''}${failed ? `，失败 ${failed} 条` : ''}`);
    } catch (nextError) {
      message.error(errorText(nextError, '同步需求池失败'));
    } finally {
      setSyncing(false);
    }
  }, [external.provider, external.token, load, message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="需求协作"
        title="需求"
        description="接入需求池数据，并追踪需求与本地原型版本的演进关系。"
        actions={(
          <Space wrap>
            <Button icon={<SyncOutlined />} loading={syncing} disabled={!writable} onClick={syncPool}>刷新需求池列表</Button>
            <Button icon={<CloudDownloadOutlined />} disabled={!writable} onClick={() => setExternalOpen(true)}>从需求池导入</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={() => setOpen(true)}>新建需求</Button>
          </Space>
        )}
      />
      {!writable ? (
        <Alert
          className="fl-dashboard-alert"
          type="info"
          showIcon
          message="只读模式"
          description={health?.readonlyReason || '需求数据保持完整可见，但同步、导入和新建操作已停用。'}
        />
      ) : null}
      <State loading={loading && !items.length} error={error} onRetry={load} empty={false}>
        <div className="fl-section-stack">
          <section className="fl-inline-metrics" aria-label="需求指标">
            <Statistic title="需求总数" value={items.length} />
            <Statistic title="来自需求池" value={items.filter((item) => item.external).length} />
            <Statistic title="已关联版本" value={items.filter((item) => item.versions?.length).length} />
          </section>
          <div className="fl-requirement-filters">
            <Input.Search allowClear aria-label="搜索需求" placeholder="搜索编号、标题、项目或模块" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Select allowClear aria-label="项目筛选" value={projectFilter || undefined} placeholder="全部项目" options={projectOptions} onChange={(value) => setProjectFilter(value || '')} />
            <Select
              allowClear
              aria-label="来源筛选"
              value={sourceFilter || undefined}
              placeholder="全部来源"
              options={[{ value: 'pool', label: '需求池' }, { value: 'local', label: '本地' }]}
              onChange={(value) => setSourceFilter(value || '')}
            />
            <Select
              allowClear
              aria-label="生命周期筛选"
              value={lifecycle || undefined}
              placeholder="全部生命周期"
              options={REQUIREMENT_STATUS_OPTIONS}
              onChange={(value) => setLifecycle(value || '')}
            />
            <Select allowClear aria-label="原型进度筛选" value={prototypeProgress || undefined} placeholder="全部原型进度" options={PROTOTYPE_PROGRESS_OPTIONS} onChange={(value) => setPrototypeProgress(value || '')} />
            <Select
              allowClear
              aria-label="任务平台筛选"
              value={bindingFilter || undefined}
              placeholder="全部任务关联"
              options={[
                { value: 'unbound', label: '未关联任务平台' },
                { value: 'pending', label: '已关联，待同步' },
                { value: 'synced', label: '已同步' },
                { value: 'drift', label: '同步有差异' },
                { value: 'failed', label: '同步失败' },
              ]}
              onChange={(value) => setBindingFilter(value || '')}
            />
            <Select allowClear aria-label="所属迭代筛选" value={milestoneFilter || undefined} placeholder="全部所属迭代" options={milestoneOptions} onChange={(value) => setMilestoneFilter(value || '')} />
          </div>
          <Table
            rowKey="code"
            loading={loading}
            locale={{ emptyText: query || lifecycle || prototypeProgress || projectFilter || sourceFilter || bindingFilter || milestoneFilter ? '没有匹配的需求' : '还没有需求' }}
            dataSource={filtered}
            columns={[
              {
                title: '需求',
                width: 360,
                render: (_, record: any) => (
                  <div className="fl-requirement-name">
                    <Button type="link" className="fl-result-link fl-mono" onClick={() => navigate(`/requirements/${encodeURIComponent(record.code)}`)}>{record.code}</Button>
                    <strong>{record.title}</strong>
                    <span className="fl-muted">{textOf(record.description, '暂无描述')}</span>
                  </div>
                ),
              },
              { title: '项目 / 模块', width: 180, render: (_, record: any) => `${textOf(record.project, '未分项目')} / ${textOf(record.module, '未分模块')}` },
              {
                title: '类型 / 优先级',
                width: 150,
                render: (_, record: any) => <Space size="small" wrap>{record.type ? <Tag>{record.type}</Tag> : null}{record.priority ? <Tag color="gold">{record.priority}</Tag> : null}{!record.type && !record.priority ? '—' : null}</Space>,
              },
              { title: '生命周期', width: 120, render: (_, record: any) => <Tag color={record.lifecycle.color}>{record.lifecycle.label}</Tag> },
              { title: '原型进度', width: 120, render: (_, record: any) => <Tag color={record.prototypeProgress.color}>{record.prototypeProgress.label}</Tag> },
              {
                title: '截止日期', dataIndex: 'dueDate', width: 150,
                render: (value, record: any) => (
                  <Space size="small" wrap>
                    <span>{textOf(value)}</span>
                    {record.overdue ? <Tag color="error">已逾期</Tag> : null}
                  </Space>
                ),
              },
              { title: '来源', width: 110, render: (_, record: any) => <Tag color={record.source.tone}>{record.source.label}</Tag> },
              {
                title: '原型范围',
                width: 180,
                render: (_, record: any) => `${record.versions?.length || 0} 个版本 · ${new Set((record.versions || []).map((version: any) => version.project)).size} 个项目`,
              },
              {
                title: '所属迭代', width: 180,
                render: (_, record: any) => record.milestoneMembership.count
                  ? <span title={record.milestoneMembership.names.join('、')}>{record.milestoneMembership.names.join('、')}</span>
                  : <span className="fl-muted">未加入迭代</span>,
              },
              {
                title: '外部主任务', width: 180,
                render: (_, record: any) => record.externalBinding.detail || <span className="fl-muted">尚未关联</span>,
              },
              {
                title: '同步状态', width: 140,
                render: (_, record: any) => <Tag color={record.externalBinding.tone}>{record.externalBinding.label}</Tag>,
              },
              { title: '负责人', dataIndex: 'owner', width: 130, render: (value) => textOf(value) },
            ]}
            scroll={{ x: 1900 }}
          />
        </div>
      </State>

      <Modal title="新建需求" open={open} confirmLoading={saving} onOk={create} onCancel={() => setOpen(false)} width={760}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="code" label="需求编号" rules={[{ required: true, message: '请填写需求编号' }]}><Input className="fl-mono" placeholder="REQ-0275" /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}><Input placeholder="一句话描述业务目标" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="project" label="所属项目"><Input placeholder="订单中心" /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="module" label="业务模块"><Input placeholder="订单列表" /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="owner" label="负责人"><Input placeholder="PM / 研发负责人" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="type" label="需求类型"><Select allowClear placeholder="选择类型" options={['功能', '优化', '缺陷', '合规'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="priority" label="优先级"><Select allowClear placeholder="选择优先级" options={['P0', 'P1', 'P2', 'P3'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="url" label="外部链接" rules={[{ type: 'url', warningOnly: true, message: '请检查链接格式' }]}><Input placeholder="https://..." /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="dueDate" label="截止日期">
                <DatePicker className="fl-full-width" format="YYYY-MM-DD" placeholder="选择截止日期" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述"><Input.TextArea rows={4} placeholder="补充背景、验收边界或关键约束" /></Form.Item>
        </Form>
      </Modal>

      <Modal title="从需求池导入" open={externalOpen} footer={null} onCancel={() => setExternalOpen(false)} width={720}>
        <Form layout="vertical">
          <Alert
            type="info"
            showIcon
            message="先导入平台提供的需求池配置 JSON，再搜索和导入需求。"
            description="配置文件只保存平台、服务、工具和字段映射；Token 等敏感信息需要在本机单独填写。"
          />
          <div className="fl-mcp-editor fl-requirement-pool-config">
            <input
              ref={manifestFileInputRef}
              type="file"
              accept="application/json,.json"
              aria-label="选择需求池配置 JSON 文件"
              style={{ display: 'none' }}
              onChange={(event) => void loadRequirementPoolManifestFile(event)}
            />
            <Form.Item label="需求池配置 JSON">
              <Input.TextArea
                rows={6}
                className="fl-mono"
                spellCheck={false}
                value={manifestText}
                placeholder={'{\n  "manifestVersion": "2026-09",\n  "platform": { "id": "demand-pool", "name": "需求池平台" },\n  "transport": { "type": "http", "url": "https://mcp.example/api" },\n  "tools": { "test": "requirements.test", "search": "requirements.search", "get": "requirements.get" }\n}'}
                onChange={(event) => {
                  setManifestText(event.target.value);
                  setManifestPreview(null);
                }}
              />
            </Form.Item>
            <Space className="fl-external-actions" wrap>
              <Button loading={manifestAction === 'template'} disabled={Boolean(manifestAction)} onClick={() => void loadRequirementPoolManifestTemplate()}>
                加载示例配置
              </Button>
              <Button onClick={() => manifestFileInputRef.current?.click()}>
                选择配置 JSON
              </Button>
              <Button loading={manifestAction === 'inspect'} disabled={Boolean(manifestAction) || !manifestText.trim()} onClick={() => void inspectRequirementPoolManifest()}>
                预览配置
              </Button>
              <Button type="primary" loading={manifestAction === 'import'} disabled={Boolean(manifestAction) || !manifestText.trim() || manifestBlocked} onClick={() => void importRequirementPoolManifest()}>
                导入配置
              </Button>
              <Button icon={<SettingOutlined />} onClick={() => navigate('/settings/mcp')}>高级 MCP 设置</Button>
            </Space>
            {manifestPreview ? (
              <div className="fl-mcp-result">
                <Alert
                  showIcon
                  type={manifestBlocked ? 'error' : 'success'}
                  message={manifestBlocked ? '配置存在阻塞项，暂不能导入' : '配置可导入'}
                  description={[
                    manifestPreview.platform?.name ? `平台：${manifestPreview.platform.name}（${manifestPreview.platform.id || '未命名'}）` : '',
                    manifestPreview.server?.id ? `服务：${manifestPreview.server.name || manifestPreview.server.id}（${manifestPreview.server.id}）` : '',
                    manifestPreview.capability?.tools ? `工具：${Object.values(manifestPreview.capability.tools).filter(Boolean).join('、')}` : '',
                    manifestPreview.secrets?.length ? `需本机补录密钥：${manifestPreview.secrets.map((item) => item.label || item.name).join('、')}` : '',
                  ].filter(Boolean).join('；')}
                />
                {(manifestPreview.blockers || []).map((item) => (
                  <Alert key={`blocker-${item.code || item.message}`} className="fl-mcp-result" type="error" showIcon message={item.message || item.code} />
                ))}
                {(manifestPreview.warnings || []).map((item) => (
                  <Alert key={`warning-${item.code || item.message}`} className="fl-mcp-result" type="warning" showIcon message={item.message || item.code} />
                ))}
              </div>
            ) : null}
            <Space wrap className="fl-mcp-result">
              <Button loading={manifestAction === 'status'} disabled={Boolean(manifestAction)} onClick={() => void checkRequirementPoolStatus(false)}>
                检查接入状态
              </Button>
              <Button loading={manifestAction === 'probe'} disabled={Boolean(manifestAction) || requirementPoolStatus?.canProbe === false} onClick={() => void checkRequirementPoolStatus(true)}>
                执行连接测试
              </Button>
              <span className="fl-muted">连接测试只调用配置中的需求池测试工具，不执行写回。</span>
            </Space>
            {requirementPoolStatus ? (
              <Alert
                className="fl-mcp-result"
                showIcon
                type={requirementPoolStatusTone(requirementPoolStatus)}
                message={requirementPoolStatusTitle(requirementPoolStatus)}
                description={(
                  <div>
                    <div>
                      {requirementPoolStatus.platform?.name ? `平台：${requirementPoolStatus.platform.name}；` : ''}
                      {requirementPoolStatus.server?.id ? `服务：${requirementPoolStatus.server.name || requirementPoolStatus.server.id}（${requirementPoolStatus.server.id}）；` : ''}
                      {requirementPoolStatus.capability?.project ? `项目/空间：${requirementPoolStatus.capability.project}；` : ''}
                      {requirementPoolStatus.connection?.identity ? `身份：${requirementPoolStatus.connection.identity}` : ''}
                    </div>
                    {requirementPoolStatus.missingSecrets?.length ? (
                      <ul>
                        {requirementPoolStatus.missingSecrets.map((item) => {
                          const name = item.name || '';
                          return (
                            <li key={`secret:${item.kind}:${name}`}>
                              <Space wrap>
                                <span>缺少{item.label || name}</span>
                                {item.kind === 'keychain' ? (
                                  <>
                                    <Input.Password
                                      size="small"
                                      autoComplete="new-password"
                                      placeholder="输入后只保存到本机"
                                      value={requirementPoolSecrets[name] || ''}
                                      onChange={(event) => setRequirementPoolSecrets((current) => ({ ...current, [name]: event.target.value }))}
                                    />
                                    <Button
                                      size="small"
                                      disabled={!writable || Boolean(manifestAction) || !requirementPoolSecrets[name]}
                                      loading={manifestAction === `secret:${name}`}
                                      onClick={() => void saveRequirementPoolSecret(name)}
                                    >
                                      保存密钥
                                    </Button>
                                  </>
                                ) : <span className="fl-muted">请在环境变量中配置</span>}
                              </Space>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {requirementPoolStatus.blockers?.map((item) => <div key={`blocker:${item.code}:${item.message}`}>{item.message || item.code}</div>)}
                    {requirementPoolStatus.warnings?.map((item) => <div key={`warning:${item.code}:${item.message}`}>{item.message || item.code}</div>)}
                  </div>
                )}
              />
            ) : null}
          </div>
          <Divider orientation="left">搜索需求池</Divider>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item label="接入方式"><Select value={external.provider} options={[{ value: 'mcp', label: 'MCP' }]} onChange={(provider) => setExternal((current) => ({ ...current, provider }))} /></Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item label="临时 Token（兼容旧配置，可选）"><Input.Password value={external.token} placeholder="优先使用上方本机密钥；旧配置可临时填写" onChange={(event) => setExternal((current) => ({ ...current, token: event.target.value }))} /></Form.Item>
            </Col>
          </Row>
          <Input.Search
            value={external.query}
            aria-label="搜索需求池"
            placeholder="搜索需求编号或标题"
            enterButton="搜索"
            loading={externalLoading}
            onChange={(event) => setExternal((current) => ({ ...current, query: event.target.value }))}
            onSearch={searchExternal}
          />
          <Space className="fl-external-actions" wrap>
            <Button disabled={!external.token.trim()} onClick={saveExternalToken}>保存 Token</Button>
          </Space>
        </Form>
        <List
          className="fl-external-list"
          bordered
          loading={externalLoading}
          locale={{ emptyText: external.query ? '没有需求池结果' : '输入关键词搜索需求池' }}
          dataSource={externalResults}
          renderItem={(item: any) => (
            <List.Item actions={[<Button key="import" size="small" type="primary" loading={importingCode === item.code} disabled={Boolean(importingCode) && importingCode !== item.code} onClick={() => importExternal(item.code)}>导入</Button>]}>
              <List.Item.Meta
                title={<><span className="fl-mono">{item.code}</span> · {item.title}</>}
                description={`${textOf(item.project, '未分项目')} · ${textOf(item.module, '未分模块')} · ${textOf(item.status, '无状态')} · ${textOf(item.owner, '未分配')}`}
              />
            </List.Item>
          )}
        />
      </Modal>
    </main>
  );
}
