import { history } from '@umijs/max';
import { App, Button, Form, Input, List, Modal, Select, Space, Tag } from 'antd';
import { BellOutlined, PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime } from '@/utils/format';

export default function Deliveries() {
  const { message } = App.useApp();
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const pending = useMemo(() => notifications.filter((item) => item.status === 'pending'), [notifications]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextSnapshots, nextMilestones, nextNotifications] = await Promise.all([
        api.listSnapshots(),
        api.listMilestones(),
        api.listNotifications(),
      ]);
      setSnapshots(nextSnapshots);
      setMilestones(nextMilestones);
      setNotifications(nextNotifications);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取交付数据');
    } finally {
      setLoading(false);
    }
  }, []);

  async function create() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const item = await api.createSnapshot(values);
      message.success('交付快照已冻结');
      setOpen(false);
      history.push(`/deliveries/${encodeURIComponent(item.name)}`);
    } finally {
      setSaving(false);
    }
  }

  async function flush() {
    await api.flushNotifications();
    message.success('通知队列已处理');
    await load();
  }

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="冻结与通知"
        title="交付"
        description="冻结评审材料、导出静态包并追踪团队通知。"
        actions={(
          <Space wrap>
            <Button icon={<BellOutlined />} disabled={!pending.length} onClick={flush}>{pending.length} 条待重试</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>创建快照</Button>
          </Space>
        )}
      />
      <State loading={loading} error={error} onRetry={load} empty={!snapshots.length} emptyText="还没有交付快照">
        <section className="fl-surface fl-list-surface" aria-label="交付快照列表">
          <List
            dataSource={snapshots}
            renderItem={(item) => (
              <List.Item className="fl-clickable-row" onClick={() => history.push(`/deliveries/${encodeURIComponent(item.name)}`)}>
                <List.Item.Meta
                  title={<span className="fl-table-title">{item.title || item.name}</span>}
                  description={<><span className="fl-mono">{item.name}</span> · {item.items?.length || 0} 个版本 · {fmtTime(item.createdAt)}</>}
                />
                <Tag color="success">已冻结</Tag>
              </List.Item>
            )}
          />
        </section>
      </State>

      <Modal title="创建不可变交付快照" open={open} confirmLoading={saving} onOk={create} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="快照标识" rules={[{ required: true, message: '请填写快照标识' }]}>
            <Input className="fl-mono" placeholder="2026-S12-review" />
          </Form.Item>
          <Form.Item name="title" label="标题"><Input /></Form.Item>
          <Form.Item name="milestone" label="来源迭代" rules={[{ required: true, message: '请选择来源迭代' }]}>
            <Select options={milestones.map((item) => ({ value: item.name, label: `${item.name} · ${item.title || ''}` }))} />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
