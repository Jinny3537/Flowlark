import { history } from '@umijs/max';
import { App, Button, DatePicker, Form, Input, Modal, Table, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { textOf } from '@/utils/format';

export default function Milestones() {
  const { message } = App.useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.listMilestones());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取迭代');
    } finally {
      setLoading(false);
    }
  }, []);

  async function create() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const item = await api.createMilestone({
        ...values,
        startAt: values.range?.[0]?.format('YYYY-MM-DD') || '',
        endAt: values.range?.[1]?.format('YYYY-MM-DD') || '',
        items: [],
      });
      message.success(`已创建 ${item.name}`);
      setOpen(false);
      history.push(`/milestones/${encodeURIComponent(item.name)}`);
    } finally {
      setSaving(false);
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
        actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建迭代</Button>}
      />
      <State loading={loading && !items.length} error={error} onRetry={load} empty={false}>
        <Table
          rowKey="name"
          loading={loading}
          locale={{ emptyText: '还没有迭代' }}
          dataSource={items}
          onRow={(record) => ({ className: 'fl-clickable-row', onClick: () => history.push(`/milestones/${encodeURIComponent(record.name)}`) })}
          columns={[
            { title: '迭代', render: (_, record: any) => <><span className="fl-table-title">{record.title || record.name}</span><div className="fl-muted fl-mono">{record.name}</div></> },
            { title: '周期', render: (_, record: any) => `${textOf(record.startAt)} 至 ${textOf(record.endAt)}` },
            { title: '版本数', render: (_, record: any) => record.items?.length || 0 },
            { title: '状态', render: (_, record: any) => <Tag color={record.ready ? 'success' : 'warning'}>{record.ready ? '可交付' : `${record.warnings?.length || 0} 项风险`}</Tag> },
          ]}
          scroll={{ x: 760 }}
        />
      </State>

      <Modal title="新建迭代" open={open} confirmLoading={saving} onOk={create} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="迭代标识" rules={[{ required: true, message: '请填写迭代标识' }]}>
            <Input className="fl-mono" placeholder="2026-S12" />
          </Form.Item>
          <Form.Item name="title" label="标题"><Input /></Form.Item>
          <Form.Item name="range" label="周期"><DatePicker.RangePicker className="fl-full-width" /></Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
