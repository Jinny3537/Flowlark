import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Descriptions, Form, Input, List, Modal, Space, Tag } from 'antd';
import { EditOutlined, ExportOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';

const statusLabels: Record<string, string> = {
  not_started: '未开始',
  designing: '设计中',
  finalized: '已定稿',
  delivered: '已交付',
};

export default function RequirementDetail() {
  const navigate = useNavigate();
  const { code = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      setItem(await api.getRequirement(code));
    } catch (nextError) {
      setError(errorText(nextError, '无法读取需求详情'));
    } finally {
      setLoading(false);
    }
  }, [code]);

  const startEdit = useCallback(() => {
    form.setFieldsValue({
      title: item?.title || '',
      description: item?.description || '',
      owner: item?.owner || '',
    });
    setEditOpen(true);
  }, [form, item]);

  const save = useCallback(async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      setItem(await api.updateRequirement(code, values));
      message.success('需求已更新');
      setEditOpen(false);
    } catch (nextError) {
      message.error(errorText(nextError, '更新需求失败'));
    } finally {
      setSaving(false);
    }
  }, [code, form, message]);

  const exportPackage = useCallback(async () => {
    setExporting(true);
    try {
      const result: any = await api.exportRequirement(code);
      message.success(`已导出到 ${result.outputDir}`);
    } catch (nextError) {
      message.error(errorText(nextError, '导出需求包失败'));
    } finally {
      setExporting(false);
    }
  }, [code, message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="需求详情"
        title={item?.title || code}
        description={item?.description || '查看需求属性与关联原型版本。'}
        backTo="/requirements"
        actions={item ? (
          <Space wrap>
            <Button icon={<EditOutlined />} disabled={!writable} onClick={startEdit}>编辑</Button>
            <Button icon={<ExportOutlined />} loading={exporting} disabled={!writable} onClick={exportPackage}>导出需求包</Button>
          </Space>
        ) : null}
      />
      <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到需求">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="编号"><span className="fl-mono">{code}</span></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{statusLabels[item?.derivedStatus] || textOf(item?.derivedStatus, '未开始')}</Tag></Descriptions.Item>
              <Descriptions.Item label="负责人">{textOf(item?.owner)}</Descriptions.Item>
              <Descriptions.Item label="项目">{textOf(item?.project, '未分项目')}</Descriptions.Item>
              <Descriptions.Item label="模块">{textOf(item?.module, '未分模块')}</Descriptions.Item>
              <Descriptions.Item label="来源">{item?.external ? '需求池' : '本地'}</Descriptions.Item>
              <Descriptions.Item label="类型">{textOf(item?.type)}</Descriptions.Item>
              <Descriptions.Item label="优先级">{textOf(item?.priority)}</Descriptions.Item>
              <Descriptions.Item label="关联版本">{item?.versions?.length || 0}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="fl-detail-section">
            <h2>跨项目版本演进</h2>
            <List
              locale={{ emptyText: '还没有关联版本' }}
              dataSource={item?.versions || []}
              renderItem={(version: any) => {
                const versionNo = version.versionNo || version.no;
                return (
                  <List.Item extra={<Tag color={version.isBaseline ? 'success' : 'default'}>{version.isBaseline ? '当前基线' : '非基线'}</Tag>}>
                    <List.Item.Meta
                      title={(
                        <Button
                          type="link"
                          className="fl-result-link"
                          onClick={() => navigate(`/projects/${encodeURIComponent(version.project)}/versions/${encodeURIComponent(versionNo)}`)}
                        >
                          {version.project} / {versionNo} · {textOf(version.title)}
                        </Button>
                      )}
                      description={version.createdAt ? `创建于 ${fmtTime(version.createdAt)}` : '打开版本工作台'}
                    />
                  </List.Item>
                );
              }}
            />
          </section>
        </div>
      </State>

      <Modal title="编辑需求" open={editOpen} confirmLoading={saving} onOk={save} onCancel={() => setEditOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={5} /></Form.Item>
          <Form.Item name="owner" label="负责人"><Input /></Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
