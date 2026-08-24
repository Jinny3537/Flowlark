import { useNavigate } from 'react-router-dom';
import { App, Button, Col, Form, Input, List, Modal, Row, Select, Space, Statistic, Table, Tag } from 'antd';
import { CloudDownloadOutlined, PlusOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { textOf } from '@/utils/format';

const statusLabels: Record<string, string> = {
  not_started: '未开始',
  designing: '设计中',
  finalized: '已定稿',
  delivered: '已交付',
};

const statusColors: Record<string, string> = {
  not_started: 'default',
  designing: 'gold',
  finalized: 'cyan',
  delivered: 'green',
};

type ExternalState = {
  provider: string;
  token: string;
  query: string;
};

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
  const [status, setStatus] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalResults, setExternalResults] = useState<any[]>([]);
  const [importingCode, setImportingCode] = useState('');
  const [external, setExternal] = useState<ExternalState>({ provider: 'mcp', token: '', query: '' });
  const [form] = Form.useForm();

  const projectOptions = useMemo(
    () => [...new Set(items.map((item) => item.project).filter(Boolean))].sort().map((value) => ({ value, label: value })),
    [items],
  );

  const filtered = useMemo(() => items.filter((item) => {
    const haystack = `${item.code} ${item.title} ${item.project || ''} ${item.module || ''}`.toLowerCase();
    return (!status || item.derivedStatus === status)
      && (!projectFilter || item.project === projectFilter)
      && (!sourceFilter || (sourceFilter === 'pool' ? Boolean(item.external) : !item.external))
      && (!query || haystack.includes(query.toLowerCase()));
  }), [items, projectFilter, query, sourceFilter, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.listRequirements());
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
      const item = await api.createRequirement(values);
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

  const syncPool = useCallback(async () => {
    setSyncing(true);
    try {
      const result: any = await api.syncRequirements(external.provider, { token: external.token });
      setItems(result.items || []);
      const failed = Array.isArray(result.failed) ? result.failed.length : Number(result.failed || 0);
      message.success(`已同步 ${result.updated}/${result.total} 条${failed ? `，失败 ${failed} 条` : ''}`);
    } catch (nextError) {
      message.error(errorText(nextError, '同步需求池失败'));
    } finally {
      setSyncing(false);
    }
  }, [external.provider, external.token, message]);

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
            <Button icon={<SyncOutlined />} loading={syncing} disabled={!writable} onClick={syncPool}>同步需求池</Button>
            <Button icon={<CloudDownloadOutlined />} disabled={!writable} onClick={() => setExternalOpen(true)}>从需求池导入</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={() => setOpen(true)}>新建需求</Button>
          </Space>
        )}
      />
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
              aria-label="状态筛选"
              value={status || undefined}
              placeholder="全部本地状态"
              options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
              onChange={(value) => setStatus(value || '')}
            />
          </div>
          <Table
            rowKey="code"
            loading={loading}
            locale={{ emptyText: query || status || projectFilter || sourceFilter ? '没有匹配的需求' : '还没有需求' }}
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
              { title: '本地状态', width: 140, dataIndex: 'derivedStatus', render: (value) => <Tag color={statusColors[value]}>{statusLabels[value] || textOf(value, '未开始')}</Tag> },
              { title: '来源', width: 130, render: (_, record: any) => <Tag color={record.external ? 'success' : 'default'}>{record.external ? '需求池' : '本地'}</Tag> },
              {
                title: '关联范围',
                width: 180,
                render: (_, record: any) => `${record.versions?.length || 0} 个版本 · ${new Set((record.versions || []).map((version: any) => version.project)).size} 个项目`,
              },
              { title: '负责人', dataIndex: 'owner', width: 130, render: (value) => textOf(value) },
            ]}
            scroll={{ x: 1140 }}
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
          <Form.Item name="description" label="描述"><Input.TextArea rows={4} placeholder="补充背景、验收边界或关键约束" /></Form.Item>
        </Form>
      </Modal>

      <Modal title="从需求池导入" open={externalOpen} footer={null} onCancel={() => setExternalOpen(false)} width={720}>
        <Form layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item label="接入方式"><Select value={external.provider} options={[{ value: 'mcp', label: 'MCP' }]} onChange={(provider) => setExternal((current) => ({ ...current, provider }))} /></Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item label="Token（可选，保存到钥匙串）"><Input.Password value={external.token} placeholder="留空则使用环境变量或已保存密钥" onChange={(event) => setExternal((current) => ({ ...current, token: event.target.value }))} /></Form.Item>
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
            <Button icon={<SettingOutlined />} onClick={() => navigate('/settings')}>打开集成配置</Button>
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
