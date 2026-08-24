import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Form, Input, List, Modal, Select, Space, Tag } from 'antd';
import { BellOutlined, PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime } from '@/utils/format';

export default function Deliveries() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { health, reload: reloadRuntime } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [flushing, setFlushing] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [testing, setTesting] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [form] = Form.useForm();
  const [notificationForm] = Form.useForm();
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
      setError(errorText(nextError, '无法读取交付数据'));
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
    setCreateError('');
    try {
      const item = await api.createSnapshot(values);
      message.success('交付快照已冻结');
      setOpen(false);
      form.resetFields();
      navigate(`/deliveries/${encodeURIComponent(item.name)}`);
    } catch (nextError) {
      const nextMessage = errorText(nextError, '创建交付快照失败');
      setCreateError(nextMessage);
      message.error(nextMessage);
    } finally {
      setSaving(false);
    }
  }

  async function flush() {
    setFlushing(true);
    try {
      const results: any = await api.flushNotifications();
      const failed = Array.isArray(results) ? results.filter((item) => item.ok === false) : [];
      if (failed.length) {
        message.warning(`通知队列已处理，仍有 ${failed.length} 条失败：${failed[0]?.error || '请稍后重试'}`);
      } else {
        message.success('通知队列已处理');
      }
      await Promise.all([load(), reloadRuntime()]);
    } catch (nextError) {
      message.error(errorText(nextError, '通知重试失败'));
    } finally {
      setFlushing(false);
    }
  }

  async function testNotification() {
    let values: any;
    try {
      values = await notificationForm.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    setNotificationError('');
    try {
      await api.testNotification(values);
      message.success('测试通知已发送');
    } catch (nextError) {
      const nextMessage = errorText(nextError, '测试通知失败');
      setNotificationError(nextMessage);
      message.error(nextMessage);
    } finally {
      setTesting(false);
    }
  }

  async function saveWebhook() {
    let values: any;
    try {
      values = await notificationForm.validateFields();
    } catch {
      return;
    }
    setSavingWebhook(true);
    setNotificationError('');
    try {
      await api.setNotificationWebhook(values.provider, values.webhookUrl);
      notificationForm.setFieldValue('webhookUrl', '');
      message.success('Webhook 已保存到钥匙串');
    } catch (nextError) {
      const nextMessage = errorText(nextError, '保存 Webhook 失败');
      setNotificationError(nextMessage);
      message.error(nextMessage);
    } finally {
      setSavingWebhook(false);
    }
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
            <Button
              icon={<BellOutlined />}
              onClick={() => { setNotificationError(''); setNotificationOpen(true); }}
            >
              通知设置
            </Button>
            <Button loading={flushing} disabled={!writable || !pending.length} onClick={flush}>{pending.length} 条待重试</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!writable}
              onClick={() => { setCreateError(''); setOpen(true); }}
            >
              创建快照
            </Button>
          </Space>
        )}
      />
      <State loading={loading} error={error} onRetry={load} empty={!snapshots.length} emptyText="还没有交付快照">
        <section className="fl-surface fl-list-surface" aria-label="交付快照列表">
          <List
            rowKey="name"
            dataSource={snapshots}
            renderItem={(item) => (
              <List.Item className="fl-clickable-row" onClick={() => navigate(`/deliveries/${encodeURIComponent(item.name)}`)}>
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

      <Modal
        title="创建不可变交付快照"
        open={open}
        confirmLoading={saving}
        okButtonProps={{ disabled: !writable }}
        onOk={create}
        onCancel={() => setOpen(false)}
      >
        {createError ? (
          <Alert className="fl-modal-alert" type="error" showIcon message="创建失败" description={createError} />
        ) : null}
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

      <Modal
        title="通知设置"
        open={notificationOpen}
        footer={null}
        onCancel={() => setNotificationOpen(false)}
      >
        {notificationError ? (
          <Alert className="fl-modal-alert" type="error" showIcon message="通知操作失败" description={notificationError} />
        ) : null}
        <Form form={notificationForm} layout="vertical" initialValues={{ provider: 'wecom', webhookUrl: '' }}>
          <Form.Item name="provider" label="平台" rules={[{ required: true, message: '请选择通知平台' }]}>
            <Select options={[
              { value: 'wecom', label: '企业微信' },
              { value: 'dingtalk', label: '钉钉' },
              { value: 'slack', label: 'Slack' },
            ]} />
          </Form.Item>
          <Form.Item
            name="webhookUrl"
            label="Webhook"
            extra="已保存的地址不会回显；保存成功后输入会立即清空。"
            rules={[
              { required: true, message: '请输入 Webhook' },
              { type: 'url', message: '请输入完整的 Webhook URL' },
            ]}
          >
            <Input.Password autoComplete="off" placeholder="https://..." />
          </Form.Item>
          <Space wrap>
            <Button loading={testing} disabled={!writable || savingWebhook} onClick={testNotification}>发送测试</Button>
            <Button type="primary" loading={savingWebhook} disabled={!writable || testing} onClick={saveWebhook}>保存 Webhook</Button>
          </Space>
        </Form>
      </Modal>
    </main>
  );
}
