import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Checkbox, Input, List, Select, Space, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { type Key, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { WATCH_STATUS, statusMeta } from '@/domain/status.js';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import {
  draftCounts, draftSelection, filterDraftItems, patchQueueParams, runQueueBatch,
} from './draftTrashModel.js';

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
  const { message, modal } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [batching, setBatching] = useState(false);
  const projectOptions = useMemo(() => [...new Set(items.map((item) => item.project).filter(Boolean))]
    .sort().map((value) => ({ value, label: value })), [items]);
  const scoped = useMemo(() => filterDraftItems(items, { ...filters, view: 'all' }), [filters, items]);
  const counts = useMemo(() => draftCounts(scoped), [scoped]);
  const filtered = useMemo(() => filterDraftItems(items, filters), [filters, items]);
  const selection = useMemo(() => draftSelection(items, selectedIds.map(String)), [items, selectedIds]);
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

  const runDraftBatch = useCallback(async (kind: 'retry' | 'clear') => {
    const ids = kind === 'retry' ? selection.failed : selection.archived;
    const selected = items.filter((item) => ids.includes(item.id));
    if (!selected.length) return;
    setBatching(true);
    const result = await runQueueBatch(selected, {
      concurrency: 3,
      run: (item) => kind === 'retry' ? api.retryWatchItem(item.id) : api.clearWatchItem(item.id),
    });
    setSelectedIds(result.failed.map((entry) => entry.item.id));
    await load();
    modal.info({
      title: kind === 'retry' ? '批量重试结果' : '清理结果',
      content: (
        <div aria-live="polite">
          <p>成功 {result.succeeded.length} 项，失败 {result.failed.length} 项</p>
          {result.failed.map((entry) => <p key={entry.item.id}>{textOf(entry.item.title, entry.item.filename)}：{entry.reason}</p>)}
        </div>
      ),
    });
    setBatching(false);
  }, [items, load, modal, selection.archived, selection.failed]);

  const confirmClear = () => modal.confirm({
    title: `清理 ${selection.archived.length} 条已归档记录？`,
    content: '只会移除草稿箱中的已归档记录，不会删除已创建版本，也不会删除原始 HTML 文件。',
    okText: '清理记录',
    cancelText: '取消',
    onOk: () => runDraftBatch('clear'),
  });

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

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
              rowSelection={{
                selectedRowKeys: selectedIds,
                onChange: setSelectedIds,
                getCheckboxProps: (item) => ({ disabled: !writable || batching || item.status === 'pending' }),
              }}
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
                  <Checkbox
                    aria-label={`选择草稿 ${textOf(item.title, item.filename)}`}
                    checked={selectedIds.includes(item.id)}
                    disabled={!writable || batching || item.status === 'pending'}
                    onChange={(event) => toggleSelected(item.id, event.target.checked)}
                  />
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
        {selectedIds.length ? (
          <div className="fl-queue-batch" aria-label="草稿批量操作">
            <span>已选择 {selectedIds.length} 项</span>
            <Button loading={batching} disabled={!writable || !selection.failed.length} onClick={() => void runDraftBatch('retry')}>
              重试失败项（{selection.failed.length}）
            </Button>
            <Button loading={batching} disabled={!writable || !selection.archived.length} onClick={confirmClear}>
              清理已归档记录（{selection.archived.length}）
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
