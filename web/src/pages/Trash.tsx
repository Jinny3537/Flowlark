import { useSearchParams } from 'react-router-dom';
import { App, Button, Input, List, Select, Table, Tag, Tooltip } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { filterTrashItems, patchQueueParams, restoreReasonLabel } from './draftTrashModel.js';

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
  const projectOptions = useMemo(() => [...new Set(items.map((item) => item.project).filter(Boolean))]
    .sort().map((value) => ({ value, label: value })), [items]);
  const filtered = useMemo(() => filterTrashItems(items, filters), [filters, items]);

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
    if (!writable) return;
    const versionNo = textOf(item.versionNo || item.no);
    modal.confirm({
      title: `恢复版本 ${versionNo}？`,
      content: '恢复后状态重置为编辑中，不会自动变回基线。',
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        setRestoring(item.id);
        try {
          await api.restoreVersion(item.project, versionNo);
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
          disabled={!writable || !item.canRestore || Boolean(restoring)}
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
      </section>
    </main>
  );
}
