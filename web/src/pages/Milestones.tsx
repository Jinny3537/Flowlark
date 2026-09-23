import { useNavigate } from 'react-router-dom';
import { Button, Input, Select, Space, Table, Tag } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { milestoneStatusMeta, syncHealth } from './milestoneSyncModel.js';

import { CreateIterationDialog } from './CreateIterationDialog';

export default function Milestones() {
  const navigate = useNavigate();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>();
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.listMilestones());
    } catch (nextError) {
      setError(errorText(nextError, '无法读取迭代'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="交付周期"
        title="迭代"
        description="围绕项目版本目标关联需求，创建冲刺并跟踪本轮交付。"
        actions={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={() => setOpen(true)}>新建迭代</Button>
          </Space>
        )}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="筛选所属项目" allowClear placeholder="全部项目" style={{ width: 220 }} value={projectFilter} onChange={setProjectFilter} options={[...new Set(items.map(item => item.project || item.platform?.projectName).filter(Boolean))].map(value => ({ value, label: value }))} />
        <Input.Search placeholder="搜索迭代版本或名称" value={query} onChange={e => setQuery(e.target.value)} style={{ width: 280 }} />
      </Space>
      <State loading={loading && !items.length} error={error} onRetry={load} empty={false}>
        <Table
          rowKey="name"
          loading={loading}
          locale={{ emptyText: '还没有迭代' }}
          dataSource={items.filter(item => (!projectFilter || (item.project || item.platform?.projectName) === projectFilter) && `${item.title} ${item.versionNo || item.name}`.toLowerCase().includes(query.toLowerCase()))}
          onRow={(record) => ({ className: 'fl-clickable-row', onClick: () => navigate(`/milestones/${encodeURIComponent(record.name)}`) })}
          columns={[
            { title: '迭代', render: (_, record: any) => <><span className="fl-table-title">{record.title || record.name}</span><div className="fl-muted fl-mono">{record.versionNo || record.name}</div></> },
            { title: '周期', render: (_, record: any) => `${textOf(record.startAt)} 至 ${textOf(record.endAt)}` },
            { title: '所属项目', render: (_, record: any) => record.project || record.platform?.projectName || '待整理' },
            { title: '发布版本', render: (_, record: any) => record.platform?.versionName || '—' },
            { title: '冲刺', render: (_, record: any) => record.platform?.sprintName || (record.external?.sprintId ? `#${record.external.sprintId}` : '待新建') },
            { title: '需求数', render: (_, record: any) => (record.requirements || [...new Set((record.items || []).map((i: any) => i.requirement))]).length },
            {
              title: '阶段',
              render: (_, record: any) => {
                const status = milestoneStatusMeta(record.status);
                return <Tag color={status.color}>{status.label}</Tag>;
              },
            },
            {
              title: '任务平台',
              render: (_, record: any) => (
                <div className="fl-milestone-sync-state">
                  <Tag color={record.external ? 'success' : 'default'}>{record.external ? '已关联任务平台' : '本地'}</Tag>
                  {record.external?.syncedAt ? <span className="fl-muted">{fmtTime(record.external.syncedAt)}</span> : null}
                </div>
              ),
            },
            { title: '原型检查', render: (_, record: any) => <Tag color={record.ready ? 'success' : 'warning'}>{!record.items?.length ? '尚未添加' : record.ready ? '检查通过' : `${record.warnings?.length || 0} 项风险`}</Tag> },
            {
              title: '同步',
              render: (_, record: any) => {
                const health = syncHealth({ external: record.external });
                return <Tag color={health.tone}>{health.label}</Tag>;
              },
            },
          ]}
          scroll={{ x: 920 }}
        />
      </State>

      <CreateIterationDialog open={open} onClose={() => setOpen(false)} onCreated={(name) => { setOpen(false); navigate(`/milestones/${encodeURIComponent(name)}`); }} />
    </main>
  );
}
