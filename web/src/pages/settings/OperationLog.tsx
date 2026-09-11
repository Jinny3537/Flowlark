import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table, Tag } from 'antd';
import { State } from '@/components/State';
import { operationMeta } from '@/domain/status.js';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtAbsolute } from '@/utils/format';

type OperationLogEntry = {
  at?: string;
  by?: string;
  project?: string;
  action?: string;
  detail?: string;
};

export function OperationLog({ embedded = false }: { embedded?: boolean }) {
  const [logs, setLogs] = useState<OperationLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<string>();
  const [date, setDate] = useState('');
  const filtered = useMemo(() => logs.filter(item => (!query || `${item.project || ''} ${item.by || ''} ${item.detail || ''}`.toLowerCase().includes(query.toLowerCase())) && (!action || item.action === action) && (!date || item.at?.slice(0, 10) === date)), [logs, query, action, date]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.oplog(undefined, 300);
      setLogs(Array.isArray(result) ? result : []);
    }
    catch (error) { setError(errorText(error, '无法读取操作日志')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={embedded ? 'fl-settings-section fl-operation-log fl-operation-log-embedded' : 'fl-settings-section fl-operation-log'}>
      {!embedded ? <h2>操作日志</h2> : null}
      <p className="fl-operation-log-copy">
        记录保存在 <code>.flowlark/oplog.ndjson</code>，以追加方式随 Git 一起提交。
      </p>
      <p>仅展示最近 300 条记录；以下筛选作用于这批记录，不代表完整历史。</p>
      <Space wrap className="fl-settings-form-actions">
        <Input aria-label="搜索操作日志" placeholder="项目、操作人或详情" value={query} onChange={event => setQuery(event.target.value)} allowClear />
        <Select aria-label="筛选日志动作" placeholder="全部动作" allowClear style={{ minWidth: 160 }} value={action} onChange={setAction} options={[...new Set(logs.map(item => item.action).filter(Boolean))].map(value => ({ value, label: operationMeta(value).label }))} />
        <Input aria-label="日志日期（UTC）" type="date" value={date} onChange={event => setDate(event.target.value)} title="按日志 UTC 日期筛选" />
        <Button loading={loading} onClick={() => void load()}>刷新日志</Button>
      </Space>
      <State error={error} onRetry={load} empty={false}>
        <Table<OperationLogEntry>
          rowKey={(record, index) => `${record.at || 'unknown'}:${record.action || 'unknown'}:${index}`}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 760 }}
          columns={[
            { title: '时间', dataIndex: 'at', width: 170, render: (value) => fmtAbsolute(value) },
            { title: '操作人', dataIndex: 'by', width: 120, render: (value) => value || '—' },
            { title: '项目', dataIndex: 'project', width: 140, render: (value) => <code>{value || '—'}</code> },
            {
              title: '动作',
              dataIndex: 'action',
              width: 150,
              render: (value) => {
                const meta = operationMeta(value);
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            { title: '详情', dataIndex: 'detail', render: (value) => value || '—' },
          ]}
        />
      </State>
    </section>
  );
}
