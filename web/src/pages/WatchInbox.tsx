import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Input, List, Select, Space, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { WATCH_STATUS, statusMeta } from '@/domain/status.js';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { draftCounts, filterDraftItems, patchQueueParams } from './draftTrashModel.js';

export default function WatchInbox() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = {
    view: params.get('view') || 'attention',
    project: params.get('project') || '',
    query: params.get('query') || '',
    dateFrom: params.get('from') || '',
    dateTo: params.get('to') || '',
  };
  const updateFilters = (patch: Record<string, string>) =>
    setParams(patchQueueParams(params, patch), { replace: true });
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const projectOptions = useMemo(() => [...new Set(items.map((item) => item.project).filter(Boolean))]
    .sort().map((value) => ({ value, label: value })), [items]);
  const scoped = useMemo(() => filterDraftItems(items, { ...filters, view: 'all' }), [filters, items]);
  const counts = useMemo(() => draftCounts(scoped), [scoped]);
  const filtered = useMemo(() => filterDraftItems(items, filters), [filters, items]);
  const queueEmpty = !filtered.length;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.watchInbox());
    } catch (nextError) {
      setError(errorText(nextError, '无法读取草稿箱'));
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(async (item: any) => {
    setBusy(item.id);
    try {
      await api.retryWatchItem(item.id);
      message.success('已重新归档');
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '重新归档失败'));
    } finally {
      setBusy('');
    }
  }, [load, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftAction = (item: any) => item.status === 'archived' ? (
    <Button
      key="open"
      size="small"
      disabled={!item.project || !item.versionNo}
      onClick={() => navigate(`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}`)}
    >
      打开版本
    </Button>
  ) : item.status === 'failed' ? (
    <Button
      key="retry"
      size="small"
      loading={busy === item.id}
      disabled={!writable || (Boolean(busy) && busy !== item.id)}
      onClick={() => void retry(item)}
    >
      重试
    </Button>
  ) : null;

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="导入暂存"
        title={filters.project ? `草稿箱 · ${filters.project}` : '草稿箱'}
        description="失败项优先显示；可按项目、关键词和收集时间快速定位。"
        actions={(
          <>
            {filters.project ? <Button onClick={() => updateFilters({ project: '' })}>查看全部项目</Button> : null}
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
          </>
        )}
      />
      <section className="fl-surface fl-list-surface fl-queue-stack" aria-label="草稿箱列表">
        <Space wrap className="fl-queue-tabs" aria-label="草稿视图">
          <Button type={filters.view === 'attention' ? 'primary' : 'default'} onClick={() => updateFilters({ view: 'attention' })}>待处理 {counts.attention}</Button>
          <Button type={filters.view === 'failed' ? 'primary' : 'default'} onClick={() => updateFilters({ view: 'failed' })}>归档失败 {counts.failed}</Button>
          <Button type={filters.view === 'archived' ? 'primary' : 'default'} onClick={() => updateFilters({ view: 'archived' })}>已归档 {counts.archived}</Button>
        </Space>
        <div className="fl-queue-filters">
          <Select allowClear aria-label="按项目筛选草稿" placeholder="全部项目" value={filters.project || undefined} options={projectOptions} onChange={(value) => updateFilters({ project: value || '' })} />
          <Input.Search allowClear aria-label="搜索草稿标题或文件名" placeholder="搜索标题或文件名" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} />
          <Input type="date" aria-label="草稿收集开始日期" value={filters.dateFrom} onChange={(event) => updateFilters({ from: event.target.value })} />
          <Input type="date" aria-label="草稿收集结束日期" value={filters.dateTo} onChange={(event) => updateFilters({ to: event.target.value })} />
        </div>
        <State
          loading={loading && !items.length}
          error={error}
          onRetry={load}
          empty={queueEmpty}
          emptyText="没有符合当前筛选条件的草稿"
        >
          <div className="fl-queue-desktop">
            <Table
              rowKey="id"
              pagination={false}
              loading={loading}
              dataSource={filtered}
              columns={[
                { title: '草稿', key: 'draft', render: (_, item) => <><strong>{textOf(item.title, '未命名草稿')}</strong><br /><span className="fl-mono">{textOf(item.filename, '未记录文件名')}</span></> },
                { title: '项目', dataIndex: 'project', key: 'project', render: (value) => textOf(value) },
                { title: '状态', key: 'status', render: (_, item) => { const meta = statusMeta(WATCH_STATUS, item.status); return <Tag color={meta.color}>{meta.label}</Tag>; } },
                { title: '收集时间', dataIndex: 'collectedAt', key: 'collectedAt', render: fmtTime },
                { title: '操作', key: 'action', render: (_, item) => draftAction(item) },
              ]}
            />
          </div>
          <div className="fl-queue-mobile">
          <List
            rowKey="id"
            dataSource={filtered}
            renderItem={(item) => {
              const meta = statusMeta(WATCH_STATUS, item.status);
              const action = draftAction(item);
              return (
                <List.Item actions={action ? [action] : undefined}>
                  <List.Item.Meta
                    title={textOf(item.title, '未命名草稿')}
                    description={`${textOf(item.project)} · ${textOf(item.filename, '未记录文件名')} · ${fmtTime(item.collectedAt)}`}
                  />
                  <Tag color={meta.color}>{meta.label}</Tag>
                </List.Item>
              );
            }}
          />
          </div>
        </State>
      </section>
    </main>
  );
}
