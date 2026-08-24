import { useNavigate } from 'react-router-dom';
import { App, Button, Form, Input, Modal, Statistic, Table, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { textOf } from '@/utils/format';

export default function Requirements() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [form] = Form.useForm();
  const filtered = useMemo(
    () => items.filter((item) => `${item.code} ${item.title} ${item.project || ''}`.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.listRequirements());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取需求');
    } finally {
      setLoading(false);
    }
  }, []);

  async function create() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const item = await api.createRequirement(values);
      message.success(`已创建 ${item.code}`);
      setOpen(false);
      navigate(`/requirements/${encodeURIComponent(item.code)}`);
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
        eyebrow="需求协作"
        title="需求"
        description="接入需求池数据，并追踪需求与本地原型版本的演进关系。"
        actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建需求</Button>}
      />
      <State loading={loading && !items.length} error={error} onRetry={load} empty={false}>
        <div className="fl-section-stack">
          <section className="fl-inline-metrics" aria-label="需求指标">
            <Statistic title="需求总数" value={items.length} />
            <Statistic title="来自需求池" value={items.filter((item) => item.external).length} />
            <Statistic title="已关联版本" value={items.filter((item) => item.versions?.length).length} />
          </section>
          <div className="fl-toolbar">
            <Input.Search className="fl-toolbar-search" allowClear placeholder="搜索编号、标题或项目" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Table
            rowKey="code"
            loading={loading}
            locale={{ emptyText: query ? '没有匹配的需求' : '还没有需求' }}
            dataSource={filtered}
            onRow={(record) => ({ className: 'fl-clickable-row', onClick: () => navigate(`/requirements/${encodeURIComponent(record.code)}`) })}
            columns={[
              { title: '需求编号', dataIndex: 'code', width: 140, render: (value) => <span className="fl-mono">{value}</span> },
              { title: '标题', dataIndex: 'title', render: (value) => <span className="fl-table-title">{value}</span> },
              { title: '项目 / 模块', render: (_, record: any) => `${textOf(record.project, '未分项目')} / ${textOf(record.module, '未分模块')}` },
              { title: '状态', dataIndex: 'derivedStatus', render: (value) => <Tag>{textOf(value, '未开始')}</Tag> },
              { title: '来源', render: (_, record: any) => <Tag color={record.external ? 'success' : 'default'}>{record.external ? '需求池' : '本地'}</Tag> },
              { title: '负责人', dataIndex: 'owner', render: (value) => textOf(value) },
            ]}
            scroll={{ x: 900 }}
          />
        </div>
      </State>

      <Modal title="新建需求" open={open} confirmLoading={saving} onOk={create} onCancel={() => setOpen(false)} width={720}>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="需求编号" rules={[{ required: true, message: '请填写需求编号' }]}>
            <Input className="fl-mono" placeholder="REQ-0275" />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
            <Input placeholder="一句话描述业务目标" />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
