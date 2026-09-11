import { Link, useNavigate } from 'react-router-dom';
import { Alert, App, Button, Form, Input, List, Modal, Select, Space, Tag } from 'antd';
import { BellOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime } from '@/utils/format';
import DeliveryComposer, { purposeLabels } from './delivery/DeliveryComposer';
import './delivery/Delivery.css';

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
  const [query, setQuery] = useState('');
  const [purpose, setPurpose] = useState('all');
  const [flushing, setFlushing] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [testing, setTesting] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [notificationForm] = Form.useForm();
  const pending = useMemo(() => notifications.filter((item) => item.status === 'pending'), [notifications]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextSnapshots, nextMilestones, nextNotifications] = await Promise.all([
        api.listSnapshots(),
        api.listMilestones(),
        writable ? api.listNotifications().catch(() => []) : Promise.resolve([]),
      ]);
      setSnapshots(nextSnapshots);
      setMilestones(nextMilestones);
      setNotifications(nextNotifications);
    } catch (nextError) {
      setError(errorText(nextError, '无法读取交付数据'));
    } finally {
      setLoading(false);
    }
  }, [writable]);

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
        eyebrow="产品交付中心"
        title="交付"
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
              onClick={() => setOpen(true)}
            >
              准备交付包
            </Button>
          </Space>
        )}
      />
      <section className="delivery-overview" aria-label="交付概况">
        <div><h2>同一范围，同一套材料</h2><span>准备 → 检查 → 冻结 → 交接</span></div>
        <div><strong>{snapshots.filter(item => item.schemaVersion === 2).length}</strong><span>完整交付包</span></div>
        <div><strong>{new Set(snapshots.flatMap(item => (item.items || []).map((entry: any) => entry.requirement).filter(Boolean))).size}</strong><span>覆盖需求</span></div>
        <div><strong>{snapshots.filter(item => item.purpose === 'acceptance').length}</strong><span>验收归档材料</span></div>
      </section>
      <section className="delivery-guide" aria-label="产品交付流程">
        <div><b>01 / 整理需求</b><p>在迭代里确定范围，补齐业务规则、目标与边界。</p><Link to="/milestones">整理迭代范围 →</Link></div>
        <div><b>02 / 对齐材料</b><p>确认原型版本，在版本工作台补充技术规格说明书、接口说明和测试附件。</p><Link to="/projects">进入原型项目 →</Link></div>
        <div><b>03 / 冻结与交接</b><p>创建固定材料包供研发、测试下载。变更新建交付并关联上一份材料。</p></div>
      </section>
      <div className="delivery-toolbar">
        <Input prefix={<SearchOutlined />} allowClear placeholder="搜索交付标题、标识或需求编号" value={query} onChange={event => setQuery(event.target.value)} />
        <Select aria-label="交付用途筛选" value={purpose} onChange={setPurpose} options={[{ value: 'all', label: '全部用途' }, ...Object.entries(purposeLabels).map(([value, label]) => ({ value, label }))]} />
      </div>
      <State loading={loading} error={error} onRetry={load} empty={!snapshots.length} emptyText="还没有交付包：先在迭代中关联需求和版本，再准备交付">
        <section className="fl-surface fl-list-surface delivery-table" aria-label="交付快照列表">
          <List
            rowKey="name"
            locale={{ emptyText: '没有匹配的交付包' }}
            dataSource={snapshots.filter(item => (purpose === 'all' || item.purpose === purpose) && `${item.title} ${item.name} ${(item.items || []).map((entry: any) => entry.requirement).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={<Link className="fl-table-title" to={`/deliveries/${encodeURIComponent(item.name)}`}>{item.title || item.name}</Link>}
                  description={<><span className="fl-mono">{item.name}</span> · {new Set((item.items || []).map((entry: any) => `${entry.project}/${entry.version}`)).size} 个版本 · {fmtTime(item.createdAt)}</>}
                />
                <Space wrap><Tag>{purposeLabels[item.purpose] || '历史快照'}</Tag><Tag color={item.schemaVersion === 2 ? 'success' : 'warning'}>{item.schemaVersion === 2 ? '材料已冻结' : '仅版本引用'}</Tag></Space>
              </List.Item>
            )}
          />
        </section>
      </State>

      <DeliveryComposer open={open} onClose={() => setOpen(false)} writable={writable} milestones={milestones} snapshots={snapshots}
        onCreated={(item: any) => { setOpen(false); message.success('交付材料已冻结'); navigate(`/deliveries/${encodeURIComponent(item.name)}`); }} />

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
