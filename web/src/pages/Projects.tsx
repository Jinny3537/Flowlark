import { useNavigate } from 'react-router-dom';
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Tooltip } from 'antd';
import { EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import {
  filterProjects, initialProjectValues, isProjectCodeAllowed, projectPayload, PROJECT_PRIORITIES,
} from './projectsModel.js';

export default function Projects() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('');
  const [archiveFilter, setArchiveFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const filtered = useMemo(
    () => filterProjects(items, { query, priority, archived: archiveFilter }),
    [archiveFilter, items, priority, query],
  );

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

  const startCreate = useCallback(() => {
    setEditingProject(null);
    form.setFieldsValue(initialProjectValues());
    setEditorOpen(true);
  }, [form]);

  const startEdit = useCallback((project: any) => {
    setEditingProject(project);
    form.setFieldsValue(initialProjectValues(project));
    setEditorOpen(true);
  }, [form]);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingProject(null);
    form.resetFields();
  }, [form]);

  const saveProject = useCallback(async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const payload = projectPayload(values);
      const project = editingProject
        ? await api.updateProject(editingProject.slug, payload)
        : await api.createProject(payload);
      message.success(editingProject ? `项目 ${project.name} 已更新` : `项目 ${project.name} 已创建`);
      closeEditor();
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, editingProject ? '更新项目失败' : '创建项目失败'));
    } finally {
      setSaving(false);
    }
  }, [closeEditor, editingProject, form, load, message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="项目库"
        title="项目"
        description={`共 ${items.length} 个项目，集中查看原型版本、基线和最近更新。`}
        actions={<Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={startCreate}>新建项目</Button>}
      />
      <State loading={loading} error={error} onRetry={load} empty={!items.length} emptyText="还没有项目">
        <div className="fl-section-stack">
          <div className="fl-project-filters">
            <Input.Search
              allowClear
              aria-label="搜索项目"
              placeholder="搜索项目名称、代码或描述"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              allowClear
              aria-label="项目优先级筛选"
              placeholder="全部优先级"
              value={priority || undefined}
              options={PROJECT_PRIORITIES.map((value) => ({ value, label: value }))}
              onChange={(value) => setPriority(value || '')}
            />
            <Select
              aria-label="项目归档状态筛选"
              value={archiveFilter}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '进行中' },
                { value: 'archived', label: '已归档' },
              ]}
              onChange={setArchiveFilter}
            />
          </div>
          <Table
            rowKey="slug"
            loading={loading}
            dataSource={filtered}
            locale={{ emptyText: query || priority || archiveFilter !== 'all' ? '没有匹配的项目' : '还没有项目' }}
            scroll={{ x: 1180 }}
            columns={[
              {
                title: '项目', width: 230,
                render: (_, record: any) => (
                  <div className="fl-project-name">
                    <Button type="link" className="fl-result-link" onClick={() => navigate(`/projects/${encodeURIComponent(record.slug)}`)}>{record.name}</Button>
                    <span className="fl-muted fl-mono">{textOf(record.code, record.slug)}</span>
                  </div>
                ),
              },
              {
                title: '项目描述', dataIndex: 'description', width: 260, ellipsis: true,
                render: (value) => <Tooltip title={value || undefined}>{textOf(value, '暂无描述')}</Tooltip>,
              },
              {
                title: '项目概览', width: 260,
                render: (_, record: any) => (
                  <Space className="fl-project-overview" size="small" wrap>
                    <span>{record.requirementCount || 0} 条需求</span>
                    {record.overdueCount > 0 ? <Tag color="error">{record.overdueCount} 条逾期</Tag> : <span>0 条逾期</span>}
                    <span>{record.versionCount || 0} 个版本</span>
                  </Space>
                ),
              },
              { title: '优先级', dataIndex: 'priority', width: 100, render: (value) => value ? <Tag color="gold">{value}</Tag> : '未设置' },
              { title: '状态', dataIndex: 'archived', width: 110, render: (value) => <Tag color={value ? 'default' : 'success'}>{value ? '已归档' : '进行中'}</Tag> },
              { title: '更新时间', dataIndex: 'updatedAt', width: 150, render: (value) => fmtTime(value) },
              {
                title: '操作', fixed: 'right', width: 150,
                render: (_, record: any) => (
                  <Space size="small">
                    <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/projects/${encodeURIComponent(record.slug)}`)}>查看</Button>
                    <Button type="link" icon={<EditOutlined />} disabled={!writable} onClick={() => startEdit(record)}>编辑</Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </State>

      <Modal
        title={editingProject ? '编辑项目' : '新建项目'}
        open={editorOpen}
        width={720}
        confirmLoading={saving}
        okButtonProps={{ disabled: !writable }}
        onOk={saveProject}
        onCancel={closeEditor}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目全名" rules={[{ required: true, whitespace: true, message: '请填写项目全名' }]}>
            <Input maxLength={60} placeholder="例如：华油中蓝" />
          </Form.Item>
          <Form.Item
            name="code"
            label="项目代码"
            extra="修改代码不会改变项目路径、历史版本或已有需求编号。"
            rules={[
              { required: true, whitespace: true, message: '请填写项目代码' },
              {
                validator: (_, value) => isProjectCodeAllowed(value, editingProject?.code)
                  ? Promise.resolve()
                  : Promise.reject(new Error('仅允许 1–40 位大写字母和数字')),
              },
            ]}
          >
            <Input className="fl-mono" maxLength={40} placeholder="HYZL" />
          </Form.Item>
          {editingProject ? (
            <Form.Item label="项目概览">
              <div className="fl-project-editor-overview">
                <span><strong>{editingProject.requirementCount || 0}</strong> 条需求</span>
                <span><strong>{editingProject.overdueCount || 0}</strong> 条逾期</span>
                <span><strong>{editingProject.versionCount || 0}</strong> 个版本</span>
              </div>
            </Form.Item>
          ) : null}
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="简要描述项目目标和范围" />
          </Form.Item>
          <Space align="start" size="large" wrap>
            <Form.Item name="priority" label="项目优先级">
              <Select allowClear className="fl-project-priority-select" placeholder="未设置" options={PROJECT_PRIORITIES.map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item name="archived" valuePropName="checked" label="项目状态">
              <Checkbox>已归档</Checkbox>
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </main>
  );
}
