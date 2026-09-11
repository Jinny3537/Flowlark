import RequirementPrototypeButton from './RequirementPrototypeButton';
import { RequirementActions } from './RequirementWorkflow';
import styles from './Requirements.module.css';
import RequirementFields from './RequirementFields';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Col, Form, Grid, Input, List, Modal, Row, Select, Space, Table, Tabs, Tag } from 'antd';
import { CloudDownloadOutlined, FilterOutlined, SearchOutlined, PlusOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { requirementPayload } from './requirementsModel.js';

const requirementStatuses = ['待评审', '评审通过', '开发中', '已上线', '已拒绝', '暂缓'];

const statusLabels: Record<string, string> = {
  not_started: '未开始',
  designing: '已归档 / 待定稿',
  finalized: '已定稿',
  delivered: '原型已确认',
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
  const [params, setParams] = useSearchParams();
  const [view] = useState(params.get('view') || 'active');
  const [pending] = useState(params.get('pending') || '');
  const [syncPreview, setSyncPreview] = useState<any>(null);
  const [syncResult, setSyncResult] = useState<any>(null);
  const screens = Grid.useBreakpoint();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState(params.get('q') || '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState(params.get('status') || '');
  const [stage, setStage] = useState(params.get('stage') || '');
  const [priority, setPriority] = useState(params.get('priority') || '');
  const [release, setRelease] = useState(params.get('release') || '');
  const [projectFilter, setProjectFilter] = useState(params.get('project') || '');
  const [sourceFilter, setSourceFilter] = useState(params.get('source') || '');
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

  const matchingItems = useMemo(() => items.filter((item) => {
    const haystack = `${item.code} ${item.title} ${item.project || ''} ${item.module || ''} ${item.owner || ''} ${item.description || ''} ${item.businessValue || ''} ${item.businessRule || ''} ${item.acceptanceCriteria || ''} ${item.functionPoints || ''} ${item.versionName || ''}`.toLowerCase();
    return (view === 'trash' ? !!item.deletedAt : !item.deletedAt && (view === 'archived' ? !!item.archivedAt : !item.archivedAt))
      && (!pending || (pending === 'prototype' ? !item.versions?.length : pending === 'acceptance' ? !item.acceptanceCriteria?.trim() : item.overdue))
      && (!stage || item.stage === stage)
      && (!priority || item.priority === priority)
      && (!release || (item.versionName || item.versionId || '未分配') === release)
      && (!projectFilter || item.project === projectFilter)
      && (!sourceFilter || (sourceFilter === 'pool' ? Boolean(item.external) : !item.external))
      && (!query || haystack.includes(query.toLowerCase()));
  }), [items, projectFilter, query, sourceFilter, stage, priority, release, view, pending]);

  const filtered = useMemo(
    () => matchingItems.filter(item => !status || (status === 'local' ? !item.external : status === 'unknown' ? !!item.external && !requirementStatuses.includes(item.external.status) : item.external?.status === status)),
    [matchingItems, status],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.listRequirements(true));
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

  const syncPool = useCallback(async (preview = true, codes?: string[]) => {
    setSyncing(true);
    try {
      const result: any = await api.syncRequirements(external.provider, { token: external.token }, { preview, codes: codes || (!preview && syncPreview ? syncPreview.changes.map((entry: any) => entry.code) : undefined), expected: !preview && syncPreview ? Object.fromEntries(syncPreview.changes.map((entry: any) => [entry.code, entry.token])) : undefined });
      if (preview) { setSyncPreview(result); return; }
      setSyncPreview(null); setSyncResult(result);
      await load();
      const failed = Array.isArray(result.failed) ? result.failed.length : Number(result.failed || 0);
      const summary = `已同步 ${result.updated}/${result.total} 条（新增 ${result.imported || 0} 条）`;
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      if (failed || warnings.length) {
        const details = Array.isArray(result.failed) ? result.failed.map((item: any) => `${item.code}：${item.message}`).join('；') : '';
        message.warning([summary, failed ? `失败 ${failed} 条：${details}` : '', ...warnings].filter(Boolean).join('；'));
      } else {
        message.success(summary);
      }
    } catch (nextError) {
      message.error(errorText(nextError, '同步需求池失败'));
    } finally {
      setSyncing(false);
    }
  }, [external.provider, external.token, message, load, syncPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    Object.entries({ q: query, status, stage, priority, release, project: projectFilter, source: sourceFilter, view, pending }).forEach(([key, value]) => { if (value) next.set(key, value); });
    setParams(next, { replace: true });
  }, [query, status, stage, priority, release, projectFilter, sourceFilter, view, pending, setParams]);

  const activeFilters = [
    { key: 'query', label: '关键词', value: query, clear: () => setQuery('') },
    { key: 'project', label: '项目', value: projectFilter, clear: () => setProjectFilter('') },
    { key: 'status', label: '需求状态', value: status, clear: () => setStatus('') },
    { key: 'source', label: '来源', value: sourceFilter ? (sourceFilter === 'pool' ? '需求池' : '本地') : '', clear: () => setSourceFilter('') },
    { key: 'stage', label: '需求池阶段', value: stage, clear: () => setStage('') },
    { key: 'priority', label: '优先级', value: priority, clear: () => setPriority('') },
    { key: 'release', label: '发布计划', value: release, clear: () => setRelease('') },
  ].filter(filter => filter.value);
  const advancedCount = [sourceFilter, stage, priority, release].filter(Boolean).length;

  return (
    <main className={`fl-page ${styles.page}`}>
      <div className={styles.workspace}>
      <header className={styles.header}>
        <h1 className="fl-visually-hidden">需求</h1>
        <nav className={styles.statusNav} aria-label="按需求状态筛选需求">
            <Tabs
              className={styles.statusTabs}
              activeKey={status || 'all'}
              onChange={key => setStatus(key === 'all' ? '' : key)}
              items={[
                { key: 'all', label: `全部（${matchingItems.length}）` },
                { key: 'local', label: `本地需求（${matchingItems.filter(item => !item.external).length}）` },
                { key: 'unknown', label: `其他外部状态（${matchingItems.filter(item => item.external && !requirementStatuses.includes(item.external.status)).length}）` },
                ...requirementStatuses.map(key => ({
                  key,
                  label: `${key}（${matchingItems.filter(item => item.external?.status === key).length}）`,
                })),
              ]}
            />
        </nav>
      </header>
      <State loading={loading && !items.length} error={error} onRetry={load} empty={false}>
        <div className={`fl-section-stack ${styles.content}`}>
          <section className={styles.searchArea} aria-label="需求搜索与筛选">
            <div className={styles.toolbar}>
              <Input type="search" prefix={<SearchOutlined aria-hidden />} allowClear aria-label="搜索需求" placeholder="搜索编号、标题、负责人或内容" value={query} onChange={event => setQuery(event.target.value)} />
              <Select showSearch optionFilterProp="label" allowClear aria-label="项目筛选" value={projectFilter || undefined} placeholder="全部项目" options={projectOptions} onChange={value => setProjectFilter(value || '')} />
              <Button icon={<FilterOutlined />} aria-expanded={filtersOpen} aria-controls="requirement-advanced-filters" onClick={() => setFiltersOpen(current => !current)}>
                更多筛选{advancedCount ? `（${advancedCount}）` : ''}
              </Button>
        <div className={styles.actions}>
<Space wrap>
            <Button icon={<SyncOutlined />} loading={syncing} disabled={!writable} onClick={() => void syncPool()}>同步需求池</Button>
            <Button icon={<CloudDownloadOutlined />} disabled={!writable} onClick={() => setExternalOpen(true)}>从需求池导入</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={() => setOpen(true)}>新建需求</Button>
          </Space>
        </div>
            </div>
            <div id="requirement-advanced-filters" hidden={!filtersOpen}>
              <div className={styles.advanced}>
                <label>接入来源<Select allowClear aria-label="来源筛选" value={sourceFilter || undefined} placeholder="全部来源" options={[{ value: 'pool', label: '需求池' }, { value: 'local', label: '本地' }]} onChange={value => setSourceFilter(value || '')} /></label>
                <label>需求池阶段<Select allowClear aria-label="需求池阶段筛选" placeholder="全部阶段" value={stage || undefined} options={[...new Set(items.map(item => item.stage).filter(Boolean))].map(value => ({ value, label: value }))} onChange={value => setStage(value || '')} /></label>
                <label>优先级<Select allowClear aria-label="优先级筛选" placeholder="全部优先级" value={priority || undefined} options={['P0', 'P1', 'P2', 'P3'].map(value => ({ value, label: value }))} onChange={value => setPriority(value || '')} /></label>
                <label>发布计划<Select showSearch optionFilterProp="label" allowClear aria-label="发布计划筛选" placeholder="全部发布计划" value={release || undefined} options={[...new Set(items.map(item => item.versionName || item.versionId || '未分配'))].map(value => ({ value, label: value }))} onChange={value => setRelease(value || '')} /></label>
              </div>
            </div>
            <div className={styles.filterSummary}>
              <span className="fl-muted" aria-live="polite">共 {items.length} 条，当前显示 {filtered.length} 条</span>
              {activeFilters.map(filter => <Tag key={filter.key} closable onClose={filter.clear} className={styles.filterTag}>{filter.label}：{filter.value}</Tag>)}
              {activeFilters.length ? <Button type="link" size="small" onClick={() => activeFilters.forEach(filter => filter.clear())}>清空筛选</Button> : null}
            </div>
          </section>
          <Table
            rowKey="code"
            loading={loading}
            locale={{ emptyText: query || status || projectFilter || sourceFilter || stage || priority || release ? '没有匹配的需求' : '还没有需求' }}
            dataSource={filtered}
            columns={[
              { title: '需求编号', dataIndex: 'code', width: 210, fixed: screens.lg ? 'left' : undefined, render: (value) => <Button type="link" className="fl-result-link fl-mono" onClick={() => navigate(`/requirements/${encodeURIComponent(value)}`)}>{value}</Button> },
              { title: '需求标题', dataIndex: 'title', width: 260, fixed: screens.lg ? 'left' : undefined, ellipsis: true, render: value => textOf(value) },
              { title: '项目', dataIndex: 'project', width: 140, ellipsis: true, render: value => textOf(value, '未分项目') },
              { title: '优先级', dataIndex: 'priority', width: 100, render: value => value ? <Tag color="gold">{value}</Tag> : '—' },
              { title: '需求状态', key: 'sourceStatus', width: 120, render: (_, item: any) => item.external?.status || (item.external ? '来源未提供' : '本地需求') },
              { title: '需求池阶段', dataIndex: 'stage', width: 130, render: value => textOf(value, '待明确') },
              { title: '本地原型进度', dataIndex: 'derivedStatus', width: 130, render: value => <Tag color={statusColors[value]}>{statusLabels[value] || '未开始'}</Tag> },
              { title: '负责人', dataIndex: 'owner', width: 110, render: value => textOf(value) },
              { title: '最近更新', key: 'updated', width: 120, render: (_, record: any) => fmtTime(record.sourceUpdatedAt || record.updatedAt) },
              { title: '操作', key: 'actions', width: 350, render: (_, item: any) => <Space wrap><RequirementPrototypeButton code={item.code} /><RequirementActions item={item} writable={writable} onChanged={load} /></Space> },
            ]}
            scroll={{ x: 1600 }}
          />
        </div>
      </State>
      </div>

      <Modal title="同步差异预览" open={!!syncPreview} onCancel={() => setSyncPreview(null)} confirmLoading={syncing} okText="确认同步" onOk={() => void syncPool(false)} width={800}>
        <p>本地分析保留。确认前校验数据是否变化；有变化的条目需重新预览，已删除需求跳过。</p>
        <List dataSource={syncPreview?.changes || []} renderItem={(entry: any) => <List.Item><div><strong>{entry.code} · {entry.title}{entry.imported ? '（新增）' : ''}</strong>{entry.fields.length ? entry.fields.map((f: any) => <p key={f.field} style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{f.field}：{String(f.before)} → {String(f.after)}</p>) : <p>内容无变化</p>}</div></List.Item>} />
        {(syncPreview?.failed || []).map((failure: any) => <p key={failure.code}>{failure.code}：{failure.message}</p>)}
        {(syncPreview?.warnings || []).map((warning: string) => <p key={warning}>{warning}</p>)}
      </Modal>
      <Modal title="同步结果" open={!!syncResult} onCancel={() => setSyncResult(null)} footer={<Space><Button onClick={() => setSyncResult(null)}>关闭</Button>{syncResult?.failed?.length ? <Button loading={syncing} onClick={() => void syncPool(true, syncResult.failed.map((f: any) => f.code))}>重试失败项</Button> : null}</Space>}>
        <p>已更新 {syncResult?.updated}/{syncResult?.total} 条，新增 {syncResult?.imported} 条。</p>
        {(syncResult?.failed || []).map((failure: any) => <p key={failure.code}>{failure.code}：{failure.message}</p>)}
        {(syncResult?.warnings || []).map((warning: string) => <p key={warning}>{warning}</p>)}
      </Modal>
      <Modal title="新建需求" open={open} confirmLoading={saving} onOk={create} onCancel={() => setOpen(false)} width={760}>
        <Form form={form} layout="vertical">
          <RequirementFields creating />
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
