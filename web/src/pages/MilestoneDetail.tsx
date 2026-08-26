import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Form, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { DeleteOutlined, ExportOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { milestoneItems, withoutMilestoneItem } from './milestoneModel.js';

export default function MilestoneDetail() {
  const navigate = useNavigate();
  const { name = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [item, setItem] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [removing, setRemoving] = useState('');
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form] = Form.useForm();
  const selectedProject = Form.useWatch('project', form);
  const versionsRequest = useRef(0);

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      const [nextItem, nextRequirements, nextProjects] = await Promise.all([
        api.getMilestone(name),
        api.listRequirements(),
        api.listProjects(),
      ]);
      setItem(nextItem);
      setRequirements(nextRequirements);
      setProjects(nextProjects);
    } catch (nextError) {
      setError(errorText(nextError, '无法读取迭代详情'));
    } finally {
      setLoading(false);
    }
  }, [name]);

  const loadVersions = useCallback(async (project: string) => {
    const request = ++versionsRequest.current;
    setVersions([]);
    form.setFieldValue('version', undefined);
    if (!project) return;
    setVersionsLoading(true);
    try {
      const nextVersions = await api.listVersions(project, { includeDraft: true, includeVoid: false });
      if (request === versionsRequest.current) setVersions(nextVersions);
    } catch (nextError) {
      if (request === versionsRequest.current) message.error(errorText(nextError, '无法读取项目版本'));
    } finally {
      if (request === versionsRequest.current) setVersionsLoading(false);
    }
  }, [form, message]);

  const addItem = useCallback(async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const items = [...milestoneItems(item.items), values];
      setItem(await api.updateMilestone(name, { items }));
      form.resetFields();
      setVersions([]);
      setAddOpen(false);
      message.success('版本已加入迭代范围');
    } catch (nextError) {
      message.error(errorText(nextError, '添加版本失败'));
    } finally {
      setSaving(false);
    }
  }, [form, item, message, name]);

  const removeItem = useCallback(async (entry: any) => {
    const key = `${entry.requirement}:${entry.project}:${entry.version}`;
    setRemoving(key);
    try {
      setItem(await api.updateMilestone(name, { items: withoutMilestoneItem(item.items, entry) }));
      message.success('已从迭代范围移除');
    } catch (nextError) {
      message.error(errorText(nextError, '移除版本失败'));
    } finally {
      setRemoving('');
    }
  }, [item, message, name]);

  const exportPackage = useCallback(async () => {
    setExporting(true);
    try {
      const result: any = await api.exportMilestone(name);
      message.success(`已导出到 ${result.outputDir}`);
    } catch (nextError) {
      message.error(errorText(nextError, '导出迭代包失败'));
    } finally {
      setExporting(false);
    }
  }, [message, name]);

  const syncExternal = useCallback(async () => {
    setSyncing(true);
    try {
      setItem(await api.syncMilestone(name));
      message.success('已同步到任务平台');
    } catch (nextError) {
      message.error(errorText(nextError, '同步到任务平台失败'));
    } finally {
      setSyncing(false);
    }
  }, [message, name]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="迭代详情"
        title={item?.title || name}
        description="查看周期、交付状态和本轮版本范围。"
        backTo="/milestones"
        actions={item ? (
          <Space wrap>
            <Button icon={<PlusOutlined />} disabled={!writable} onClick={() => setAddOpen(true)}>添加版本</Button>
            <Button icon={<SyncOutlined />} loading={syncing} disabled={!writable} onClick={syncExternal}>同步到任务平台</Button>
            <Button icon={<ExportOutlined />} loading={exporting} disabled={!writable} onClick={exportPackage}>导出迭代包</Button>
          </Space>
        ) : null}
      />
      <State loading={loading && !item} error={error} onRetry={load} empty={!item} emptyText="没有找到迭代">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="标识"><span className="fl-mono">{name}</span></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={item?.ready ? 'success' : 'warning'}>{item?.ready ? '可交付' : `${item?.warnings?.length || 0} 项风险`}</Tag></Descriptions.Item>
              <Descriptions.Item label="开始">{textOf(item?.startAt)}</Descriptions.Item>
              <Descriptions.Item label="结束">{textOf(item?.endAt)}</Descriptions.Item>
              <Descriptions.Item label="任务平台">{item?.external ? textOf(item.external.status, '已关联') : '本地'}</Descriptions.Item>
              <Descriptions.Item label="同步时间">{item?.external?.syncedAt ? fmtTime(item.external.syncedAt) : '尚未同步'}</Descriptions.Item>
            </Descriptions>
          </section>
          {item?.warnings?.length ? (
            <Alert
              className="fl-milestone-warnings"
              type="warning"
              showIcon
              message={`${item.warnings.length} 项交付风险`}
              description={<ul>{item.warnings.map((warning: any, index: number) => <li key={`${warning.code}-${warning.project}-${warning.version}-${index}`}>{warning.message}</li>)}</ul>}
            />
          ) : null}
          <section className="fl-detail-section">
            <h2>版本范围</h2>
            <Table
              rowKey={(entry: any) => `${entry.requirement}:${entry.project}:${entry.version}`}
              pagination={false}
              locale={{ emptyText: '本轮还没有版本' }}
              dataSource={item?.items || []}
              columns={[
                { title: '需求', dataIndex: 'requirement', width: 170, render: (value) => <span className="fl-mono">{value}</span> },
                { title: '项目', dataIndex: 'project', width: 160 },
                {
                  title: '版本',
                  render: (_, entry: any) => (
                    <Button
                      type="link"
                      className="fl-result-link"
                      onClick={() => navigate(`/projects/${encodeURIComponent(entry.project)}/versions/${encodeURIComponent(entry.version)}`)}
                    >
                      {entry.version} · {textOf(entry.versionTitle)}
                    </Button>
                  ),
                },
                {
                  title: '基线',
                  width: 140,
                  render: (_, entry: any) => <Tag color={entry.currentBaseline === entry.version ? 'success' : 'warning'}>{entry.currentBaseline === entry.version ? '当前基线' : '基线已变化'}</Tag>,
                },
                {
                  title: '操作',
                  width: 100,
                  render: (_, entry: any) => {
                    const key = `${entry.requirement}:${entry.project}:${entry.version}`;
                    return (
                      <Popconfirm title="从迭代范围移除该版本？" okText="移除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeItem(entry)}>
                        <Button type="text" danger icon={<DeleteOutlined />} loading={removing === key} disabled={!writable || Boolean(removing)}>移除</Button>
                      </Popconfirm>
                    );
                  },
                },
              ]}
              scroll={{ x: 760 }}
            />
          </section>
        </div>
      </State>

      <Modal
        title="添加需求版本"
        open={addOpen}
        confirmLoading={saving}
        okButtonProps={{ disabled: !writable }}
        onOk={addItem}
        onCancel={() => setAddOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="requirement" label="需求" rules={[{ required: true, message: '请选择需求' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择需求"
              options={requirements.map((requirement) => ({ value: requirement.code, label: `${requirement.code} · ${requirement.title}` }))}
            />
          </Form.Item>
          <Form.Item name="project" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择项目"
              options={projects.map((project) => ({ value: project.slug, label: project.name || project.slug }))}
              onChange={loadVersions}
            />
          </Form.Item>
          <Form.Item name="version" label="版本" rules={[{ required: true, message: '请选择版本' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={selectedProject ? '选择版本' : '请先选择项目'}
              disabled={!selectedProject}
              loading={versionsLoading}
              options={versions.map((version) => ({ value: version.versionNo, label: `${version.versionNo} · ${version.title}` }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
