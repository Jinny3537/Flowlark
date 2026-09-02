import { useNavigate } from 'react-router-dom';
import { App, Button, Checkbox, DatePicker, Form, Input, Modal, Space, Table, Tag } from 'antd';
import { PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { milestoneStatusMeta, syncHealth } from './milestoneSyncModel.js';

export default function Milestones() {
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
  const [form] = Form.useForm();

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

  async function create() {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const { syncExternal, range, ...draft } = values;
      let item: any = await api.createMilestone({
        ...draft,
        startAt: range?.[0]?.format('YYYY-MM-DD') || '',
        endAt: range?.[1]?.format('YYYY-MM-DD') || '',
        items: [],
      });
      if (syncExternal) item = await api.syncMilestone(item.name);
      message.success(syncExternal ? `已创建并同步 ${item.name}` : `已创建 ${item.name}`);
      setOpen(false);
      form.resetFields();
      navigate(`/milestones/${encodeURIComponent(item.name)}`);
    } catch (nextError) {
      message.error(errorText(nextError, '创建迭代失败'));
    } finally {
      setSaving(false);
    }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      const result: any = await api.syncMilestones();
      setItems(result.items || []);
      const failed = Array.isArray(result.failed) ? result.failed.length : 0;
      const summary = `同步完成：新建 ${result.created || 0} 个，更新 ${result.updated || 0} 个，失败 ${failed} 个`;
      if (failed) message.warning(summary);
      else message.success(summary);
    } catch (nextError) {
      message.error(errorText(nextError, '同步迭代失败'));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="交付周期"
        title="迭代"
        description="按交付周期组织需求、版本范围和定稿风险。"
        actions={(
          <Space wrap>
            <Button icon={<SyncOutlined />} loading={syncing} disabled={!writable} onClick={syncAll}>同步全部</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={() => setOpen(true)}>新建迭代</Button>
          </Space>
        )}
      />
      <State loading={loading && !items.length} error={error} onRetry={load} empty={false}>
        <Table
          rowKey="name"
          loading={loading}
          locale={{ emptyText: '还没有迭代' }}
          dataSource={items}
          onRow={(record) => ({ className: 'fl-clickable-row', onClick: () => navigate(`/milestones/${encodeURIComponent(record.name)}`) })}
          columns={[
            { title: '迭代', render: (_, record: any) => <><span className="fl-table-title">{record.title || record.name}</span><div className="fl-muted fl-mono">{record.name}</div></> },
            { title: '周期', render: (_, record: any) => `${textOf(record.startAt)} 至 ${textOf(record.endAt)}` },
            { title: '版本数', render: (_, record: any) => record.items?.length || 0 },
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
            { title: '状态', render: (_, record: any) => <Tag color={record.ready ? 'success' : 'warning'}>{record.ready ? '可交付' : `${record.warnings?.length || 0} 项风险`}</Tag> },
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

      <Modal title="新建迭代" open={open} confirmLoading={saving} okButtonProps={{ disabled: !writable }} onOk={create} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="迭代标识" rules={[{ required: true, message: '请填写迭代标识' }]}>
            <Input className="fl-mono" placeholder="2026-S12" />
          </Form.Item>
          <Form.Item name="title" label="标题"><Input /></Form.Item>
          <Form.Item name="range" label="周期"><DatePicker.RangePicker className="fl-full-width" /></Form.Item>
          <Form.Item name="syncExternal" valuePropName="checked" initialValue={false}>
            <Checkbox>创建后同步到任务平台</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
