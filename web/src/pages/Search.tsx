import { App, Button, Empty, Form, Input, List, Modal, Select, Space, Tag } from 'antd';
import { SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { normalizeWorkspaceResults, resultRoute } from './searchModel.js';

const fieldOptions = [
  { value: '', label: '全部字段' },
  { value: 'versionNo,title,change,requirement,spec,tag,note,projectName,description', label: '版本与项目' },
  { value: 'requirement,change,spec', label: '需求与规格' },
  { value: 'tag', label: '标签' },
];

const objectOptions = [
  { value: 'all', label: '全部对象' },
  { value: 'versions', label: '版本' },
  { value: 'requirements', label: '需求' },
  { value: 'milestones', label: '迭代' },
];

const typeLabels: Record<string, string> = {
  version: '版本',
  requirement: '需求',
  milestone: '迭代',
  project: '项目',
  workspace: '工作区',
};

type SearchFilters = {
  scope: string;
  project: string;
  requirement: string;
  milestone: string;
  field: string;
};

type SearchConfig = {
  workspaceScope: string;
  query: string;
  filters: SearchFilters;
};

const emptyFilters: SearchFilters = { scope: 'all', project: '', requirement: '', milestone: '', field: '' };

function snippetText(item: any) {
  const snippet = item?.snippet;
  if (!snippet?.text) return textOf(item?.description || item?.title || item?.versionTitle || item?.projectName);
  return snippet.text;
}

function resultTypeLabel(item: any) {
  if (item.objectType === 'version' && !item.versionNo && item.project) return typeLabels.project;
  return typeLabels[item.objectType] || textOf(item.objectType, '结果');
}

function configFromParams(params: URLSearchParams): SearchConfig {
  return {
    workspaceScope: params.get('workspace') === 'all' ? 'all' : 'current',
    query: params.get('q') || '',
    filters: {
      scope: params.get('scope') || 'all',
      project: params.get('project') || '',
      requirement: params.get('requirement') || '',
      milestone: params.get('milestone') || '',
      field: params.get('field') || '',
    },
  };
}

function paramsFromConfig(config: SearchConfig) {
  const next = new URLSearchParams();
  next.set('searched', '1');
  if (config.workspaceScope === 'all') next.set('workspace', 'all');
  if (config.query.trim()) next.set('q', config.query.trim());
  if (config.filters.scope && config.filters.scope !== 'all') next.set('scope', config.filters.scope);
  if (config.filters.project) next.set('project', config.filters.project);
  if (config.filters.requirement) next.set('requirement', config.filters.requirement);
  if (config.filters.milestone) next.set('milestone', config.filters.milestone);
  if (config.filters.field) next.set('field', config.filters.field);
  return next;
}

function hasCriteria(config: SearchConfig) {
  return Boolean(
    config.query.trim()
    || config.filters.scope !== 'all'
    || config.filters.project
    || config.filters.requirement
    || config.filters.milestone
    || config.filters.field,
  );
}

export default function Search() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => configFromParams(params));
  const [projects, setProjects] = useState<any[]>([]);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [selectedView, setSelectedView] = useState<string>();
  const [workspaceScope, setWorkspaceScope] = useState(initial.workspaceScope);
  const [query, setQuery] = useState(initial.query);
  const [filters, setFilters] = useState<SearchFilters>(initial.filters);
  const [result, setResult] = useState<any>({ total: 0, results: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(params.get('searched') === '1' || hasCriteria(initial));
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [viewForm] = Form.useForm();
  const searchRequest = useRef(0);
  const paramsKey = params.toString();

  const setFilter = useCallback((key: keyof SearchFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      const [nextProjects, nextRequirements, nextMilestones, nextViews] = await Promise.all([
        api.listProjects(),
        api.listRequirements(),
        api.listMilestones(),
        api.listViews(),
      ]);
      setProjects(nextProjects);
      setRequirements(nextRequirements);
      setMilestones(nextMilestones);
      setViews(nextViews);
    } catch (nextError) {
      message.error(errorText(nextError, '无法读取搜索筛选项'));
    }
  }, [message]);

  const performSearch = useCallback(async (config: SearchConfig) => {
    const requestId = ++searchRequest.current;
    setLoading(true);
    setError('');
    setHasSearched(true);
    try {
      let nextResult: any;
      if (config.workspaceScope === 'all') {
        const items: any = await api.searchWorkspaces(config.query.trim(), 100);
        nextResult = { total: items.length, results: normalizeWorkspaceResults(items) };
      } else {
        nextResult = await api.search(config.query.trim(), {
          project: config.filters.project || null,
          field: config.filters.field || null,
          limit: 100,
          filters: {
            scope: config.filters.scope === 'all' ? null : config.filters.scope,
            requirement: config.filters.requirement || null,
            milestone: config.filters.milestone || null,
          },
        });
      }
      if (requestId === searchRequest.current) setResult(nextResult);
    } catch (nextError) {
      if (requestId === searchRequest.current) setError(errorText(nextError, '搜索失败'));
    } finally {
      if (requestId === searchRequest.current) setLoading(false);
    }
  }, []);

  const submitConfig = useCallback((config: SearchConfig) => {
    const next = paramsFromConfig(config);
    if (next.toString() === paramsKey) void performSearch(config);
    else setParams(next, { replace: false });
  }, [paramsKey, performSearch, setParams]);

  const submit = useCallback(() => {
    submitConfig({ workspaceScope, query, filters });
  }, [filters, query, submitConfig, workspaceScope]);

  const applyView = useCallback((id?: string) => {
    setSelectedView(id);
    const view = views.find((item) => item.id === id);
    if (!view) return;
    const savedFilters = view.filters || {};
    const { workspaceScope: savedWorkspaceScope, ...structuredFilters } = savedFilters;
    const next: SearchConfig = {
      workspaceScope: savedWorkspaceScope === 'all' ? 'all' : 'current',
      query: view.query || '',
      filters: {
        ...emptyFilters,
        ...structuredFilters,
        scope: view.scope || savedFilters.scope || 'all',
      },
    };
    setWorkspaceScope(next.workspaceScope);
    setQuery(next.query);
    setFilters(next.filters);
    submitConfig(next);
  }, [submitConfig, views]);

  const saveView = useCallback(async () => {
    let values: { id: string; name: string };
    try {
      values = await viewForm.validateFields();
    } catch {
      return;
    }
    setSavingView(true);
    try {
      const scope = filters.scope || 'all';
      await api.saveView(values.id.trim(), {
        name: values.name.trim(),
        scope,
        query,
        filters: { ...filters, workspaceScope },
      });
      message.success('团队视图已保存');
      setSaveOpen(false);
      viewForm.resetFields();
      await loadOptions();
    } catch (nextError) {
      message.error(errorText(nextError, '保存视图失败'));
    } finally {
      setSavingView(false);
    }
  }, [filters, loadOptions, message, query, viewForm, workspaceScope]);

  const openResult = useCallback((item: any) => {
    if (item.workspace && health?.repo && item.workspace !== health.repo) {
      message.info(`结果位于工作区：${item.workspaceName || item.workspace}`);
      return;
    }
    const route = resultRoute(item);
    if (route) navigate(route);
    else message.info('该结果没有可打开的本地路由');
  }, [health?.repo, message, navigate]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    const currentParams = new URLSearchParams(paramsKey);
    const next = configFromParams(currentParams);
    setWorkspaceScope(next.workspaceScope);
    setQuery(next.query);
    setFilters(next.filters);
    if (currentParams.get('searched') === '1' || hasCriteria(next)) void performSearch(next);
    else {
      searchRequest.current += 1;
      setHasSearched(false);
      setLoading(false);
      setError('');
      setResult({ total: 0, results: [] });
    }
  }, [paramsKey, performSearch]);

  const structuredDisabled = workspaceScope === 'all';

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="全局检索"
        title="搜索"
        description="按项目、版本、需求、迭代或所有本机工作区检索。"
      />

      <section className="fl-surface fl-search-panel" aria-label="搜索条件">
        <div className="fl-search-toolbar">
          <Select
            allowClear
            className="fl-filter-select"
            value={selectedView}
            placeholder="已存视图"
            aria-label="已存视图"
            options={views.map((item) => ({ value: item.id, label: item.name }))}
            onChange={applyView}
          />
          <Button
            icon={<SaveOutlined />}
            disabled={health?.canWrite === false}
            onClick={() => setSaveOpen(true)}
          >
            保存视图
          </Button>
        </div>
        <Select
          className="fl-filter-select"
          value={workspaceScope}
          aria-label="搜索工作区范围"
          options={[
            { value: 'current', label: '当前工作区' },
            { value: 'all', label: '跨工作区' },
          ]}
          onChange={setWorkspaceScope}
        />
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined />}
          value={query}
          aria-label="搜索关键词"
          placeholder="关键词，可留空仅使用结构化筛选"
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={submit}
        />
        <div className="fl-search-filters">
          <Select value={filters.scope} options={objectOptions} disabled={structuredDisabled} aria-label="对象范围" onChange={(value) => setFilter('scope', value)} />
          <Select
            allowClear
            showSearch
            value={filters.project || undefined}
            placeholder="全部项目"
            aria-label="项目筛选"
            disabled={structuredDisabled}
            options={projects.map((item) => ({ value: item.slug, label: `${item.name} · ${item.slug}` }))}
            onChange={(value) => setFilter('project', value || '')}
          />
          <Select
            allowClear
            showSearch
            value={filters.requirement || undefined}
            placeholder="全部需求"
            aria-label="需求筛选"
            disabled={structuredDisabled}
            options={requirements.map((item) => ({ value: item.code, label: `${item.code} · ${item.title}` }))}
            onChange={(value) => setFilter('requirement', value || '')}
          />
          <Select
            allowClear
            showSearch
            value={filters.milestone || undefined}
            placeholder="全部迭代"
            aria-label="迭代筛选"
            disabled={structuredDisabled}
            options={milestones.map((item) => ({ value: item.name, label: item.title ? `${item.name} · ${item.title}` : item.name }))}
            onChange={(value) => setFilter('milestone', value || '')}
          />
          <Select value={filters.field} options={fieldOptions} disabled={structuredDisabled} aria-label="搜索字段" onChange={(value) => setFilter('field', value)} />
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={submit}>搜索</Button>
        </div>
        {structuredDisabled ? <span className="fl-muted">跨工作区结果按关键词检索，并保留工作区来源。</span> : null}
      </section>

      <State loading={loading} error={error} onRetry={submit} empty={hasSearched && !result.results?.length} emptyText="没有匹配结果">
        {!hasSearched ? (
          <div className="fl-state fl-state-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入关键词或选择筛选条件开始搜索" />
          </div>
        ) : (
          <section className="fl-surface fl-list-surface" aria-label="搜索结果">
            <div className="fl-section-toolbar"><strong>{result.total || 0} 个结果</strong></div>
            <List
              dataSource={result.results || []}
              renderItem={(item: any) => (
                <List.Item extra={<Space wrap>{item.versionStatus ? <Tag>{item.versionStatus}</Tag> : null}{item.reviewStatus ? <Tag>{item.reviewStatus}</Tag> : null}</Space>}>
                  <List.Item.Meta
                    title={(
                      <Space size="small" wrap>
                        <Tag>{resultTypeLabel(item)}</Tag>
                        <Button type="link" className="fl-result-link" onClick={() => openResult(item)}>
                          {textOf(item.versionTitle || item.requirementTitle || item.milestoneTitle || item.title || item.projectName || item.name)}
                        </Button>
                      </Space>
                    )}
                    description={(
                      <span>
                        <span className="fl-search-result-source">
                          {textOf(item.workspaceName || item.projectName || item.requirementCode || item.milestoneName || item.project || item.workspace)}
                          {' · '}{textOf(item.fieldLabel || item.field || item.type)}{item.updatedAt ? ` · ${fmtTime(item.updatedAt)}` : ''}
                        </span>
                        <br />
                        {snippetText(item)}
                      </span>
                    )}
                  />
                </List.Item>
              )}
            />
          </section>
        )}
      </State>

      <Modal title="保存团队视图" open={saveOpen} confirmLoading={savingView} onOk={saveView} onCancel={() => setSaveOpen(false)}>
        <Form form={viewForm} layout="vertical">
          <Form.Item name="id" label="视图标识" rules={[{ required: true, message: '请填写视图标识' }]}>
            <Input className="fl-mono" placeholder="pending-review" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请填写视图名称' }]}>
            <Input placeholder="待评审版本" />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
