import { useSearchParams } from 'react-router-dom';
import { App, Button, Checkbox, Input, List, Select, Table, Tag, Tooltip } from 'antd';
import { type Key, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { filterTrashItems, patchQueueParams, restoreReasonLabel, runQueueBatch } from './draftTrashModel.js';

export default function Trash() {
  const [params, setParams] = useSearchParams();
  const filters = {
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
  const [restoring, setRestoring] = useState('');
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [batching, setBatching] = useState(false);
  const projectOptions = useMemo(() => [...new Set(items.map((item) => item.project).filter(Boolean))]
    .sort().map((value) => ({ value, label: value })), [items]);
  const filtered = useMemo(() => filterTrashItems(items, filters), [filters, items]);
  const selected = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.trash());
    } catch (nextError) {
      setError(errorText(nextError, '无法读取回收站'));
    } finally {
      setLoading(false);
    }
  }, []);

  const restore = useCallback((item: any) => {
    if (!writable || !item.canRestore) return;
    const versionNo = textOf(item.versionNo);
    modal.confirm({
      title: `恢复版本 ${versionNo}？`,
      content: '恢复后状态重置为编辑中，不会自动变回基线。',
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        setRestoring(item.id);
        try {
          await api.restoreTrashItem(item.id);
          message.success(`${versionNo} 已恢复`);
          await load();
        } catch (nextError) {
          message.error(errorText(nextError, '恢复版本失败'));
        } finally {
          setRestoring('');
        }
      },
    });
  }, [load, message, modal, writable]);

  const runRestoreBatch = useCallback(async () => {
    if (!selected.length) return;
    setBatching(true);
    try {
      const result = await runQueueBatch(selected, {
        concurrency: 3,
        skip: (item) => item.canRestore ? '' : restoreReasonLabel(item.blockedReason),
        run: (item) => api.restoreTrashItem(item.id),
      });
      setSelectedIds(result.failed.map((entry) => entry.item.id));
      await load();
      const details = [...result.skipped, ...result.failed];
      const detailText = details
        .map((entry) => `${entry.item.project} / ${entry.item.versionNo}：${entry.reason}`)
        .join('\n');
      modal.info({
        title: '批量恢复结果',
        content: (
          <div aria-live="polite">
            <p>成功 {result.succeeded.length} 项，跳过 {result.skipped.length} 项，失败 {result.failed.length} 项</p>
            {details.map((entry) => (
              <p key={entry.item.id}>{entry.item.project} / {entry.item.versionNo}：{entry.reason}</p>
            ))}
            {details.length ? (
              <Button
                aria-label="复制跳过和失败明细"
                onClick={() => void navigator.clipboard.writeText(detailText)}
              >
                复制明细
              </Button>
            ) : null}
          </div>
        ),
      });
    } finally {
      setBatching(false);
    }
  }, [load, modal, selected]);

  const confirmBatchRestore = () => {
    const eligible = selected.filter((item) => item.canRestore).length;
    modal.confirm({
      title: `恢复 ${eligible} 个版本？`,
      content: `已选择 ${selected.length} 项；${eligible} 项可恢复，${selected.length - eligible} 项将因冲突或数据问题跳过。`,
      okText: '批量恢复',
      cancelText: '取消',
      onOk: runRestoreBatch,
    });
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

  useEffect(() => {
    void load();
  }, [load]);

  const restoreStatus = (item: any) => (
    <Tag color={item.canRestore ? 'green' : 'orange'}>
      {item.canRestore ? '可恢复' : restoreReasonLabel(item.blockedReason)}
    </Tag>
  );
  const restoreAction = (item: any) => (
    <Tooltip key="restore" title={item.canRestore ? '恢复后状态重置为编辑中' : restoreReasonLabel(item.blockedReason)}>
      <span>
        <Button
          size="small"
          loading={restoring === item.id}
          disabled={!writable || !item.canRestore || Boolean(restoring) || batching}
          onClick={() => restore(item)}
        >
          恢复
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="辅助入口"
        title="回收站"
        description="删除的版本完整保存在 .flowlark/trash/，可在版本号未被占用时恢复。"
      />
      <section className="fl-surface fl-list-surface fl-queue-stack" aria-label="已删除版本列表">
        <div className="fl-queue-filters">
          <Select allowClear aria-label="按项目筛选回收站" placeholder="全部项目" value={filters.project || undefined} options={projectOptions} onChange={(value) => updateFilters({ project: value || '' })} />
          <Input.Search allowClear aria-label="搜索回收站项目或版本号" placeholder="搜索项目或版本号" value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} />
          <Input type="date" aria-label="删除开始日期" value={filters.dateFrom} onChange={(event) => updateFilters({ from: event.target.value })} />
          <Input type="date" aria-label="删除结束日期" value={filters.dateTo} onChange={(event) => updateFilters({ to: event.target.value })} />
        </div>
        <State loading={loading && !items.length} error={error} onRetry={load} empty={!filtered.length} emptyText="没有符合当前筛选条件的回收站记录">
          <div className="fl-queue-desktop">
            <Table
              rowKey="id"
              pagination={false}
              loading={loading}
              dataSource={filtered}
              rowSelection={{
                selectedRowKeys: selectedIds,
                onChange: setSelectedIds,
                getCheckboxProps: () => ({ disabled: !writable || batching }),
              }}
              columns={[
                { title: '项目', dataIndex: 'project', key: 'project', render: (value) => textOf(value) },
                { title: '版本', dataIndex: 'versionNo', key: 'versionNo', render: (value) => textOf(value) },
                { title: '删除时间', dataIndex: 'deletedAt', key: 'deletedAt', render: fmtTime },
                { title: '删除人', dataIndex: 'deletedBy', key: 'deletedBy', render: (value) => textOf(value, '—') },
                { title: '恢复状态', key: 'status', render: (_, item) => restoreStatus(item) },
                { title: '操作', key: 'action', render: (_, item) => restoreAction(item) },
              ]}
            />
          </div>
          <div className="fl-queue-mobile">
          <List
            rowKey="id"
            dataSource={filtered}
            renderItem={(item) => (
              <List.Item actions={[restoreAction(item)]}>
                <Checkbox
                  aria-label={`选择回收站版本 ${item.project} / ${item.versionNo}`}
                  checked={selectedIds.includes(item.id)}
                  disabled={!writable || batching}
                  onChange={(event) => toggleSelected(item.id, event.target.checked)}
                />
                <List.Item.Meta
                  title={`${textOf(item.project)} / ${textOf(item.versionNo)}`}
                  description={`${fmtTime(item.deletedAt)} · ${textOf(item.deletedBy, '—')} 删除`}
                />
                {restoreStatus(item)}
              </List.Item>
            )}
          />
          </div>
        </State>
        {selectedIds.length ? (
          <div className="fl-queue-batch" aria-label="回收站批量操作">
            <span>已选择 {selectedIds.length} 项，可恢复 {selected.filter((item) => item.canRestore).length} 项</span>
            <Button type="primary" loading={batching} disabled={!writable} onClick={confirmBatchRestore}>批量恢复</Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
