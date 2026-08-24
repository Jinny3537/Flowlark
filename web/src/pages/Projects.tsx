import { useNavigate } from 'react-router-dom';
import { App, Button, Form, Input, Modal, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime, textOf } from '@/utils/format';

export default function Projects() {
  const navigate = useNavigate();
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
      setItems(await api.listProjects());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取项目');
    } finally {
      setLoading(false);
    }
  }, []);

  async function create() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const project = await api.createProject(values);
      message.success(`项目 ${project.name} 已创建`);
      setOpen(false);
      form.resetFields();
      await load();
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
        eyebrow="项目库"
        title="项目"
        description={`共 ${items.length} 个项目，集中查看原型版本、基线和最近更新。`}
        actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建项目</Button>}
      />
      <State loading={loading} error={error} onRetry={load} empty={!items.length} emptyText="还没有项目">
        <section className="fl-card-grid" aria-label="项目列表">
          {items.map((item) => (
            <button
              className="fl-project-card"
              type="button"
              key={item.slug}
              onClick={() => navigate(`/projects/${encodeURIComponent(item.slug)}`)}
            >
              <span className="fl-project-card-head">
                <span>
                  <h2>{item.name}</h2>
                  <span className="fl-muted fl-mono">{item.slug}</span>
                </span>
                <Tag className={`fl-baseline-tag ${item.baselineVersionNo ? 'is-ready' : 'is-pending'}`}>
                  {item.baselineVersionNo ? '已定基线' : '待定基线'}
                </Tag>
              </span>
              <span className="fl-project-description">{item.description || '暂无项目描述'}</span>
              <span className="fl-project-metrics">
                <span className="fl-project-metric"><span>版本数</span><strong>{item.versionCount || 0}</strong></span>
                <span className="fl-project-metric"><span>当前基线</span><strong className="fl-mono">{textOf(item.baselineVersionNo, '-')}</strong></span>
              </span>
              <span className="fl-project-footer">{fmtTime(item.updatedAt)} · {textOf(item.updatedBy || item.createdBy)}</span>
            </button>
          ))}
        </section>
      </State>

      <Modal title="新建项目" open={open} confirmLoading={saving} onOk={create} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请填写项目名称' }]}>
            <Input maxLength={60} placeholder="例如：订单中心重构" />
          </Form.Item>
          <Form.Item name="code" label="项目标识" rules={[{ required: true, message: '请填写项目标识' }]}>
            <Input className="fl-mono" maxLength={40} placeholder="order-center" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
