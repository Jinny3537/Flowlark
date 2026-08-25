import { useNavigate } from 'react-router-dom';
import { App, Badge, Button, Checkbox, Dropdown, Empty, Form, Input, Modal, Select, Space, Tag } from 'antd';
import { ArrowRightOutlined, EditOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
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
  const [archiveFilter, setArchiveFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const filtered = useMemo(
    () => filterProjects(items, { query, archived: archiveFilter }),
    [archiveFilter, items, query],
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
        eyebrow="原型项目"
        title="选择项目，进入原型管理"
        description="查看最新原型版本，并进入项目版本工作区。"
        actions={<Button type="primary" icon={<PlusOutlined />} disabled={!writable} onClick={startCreate}>新建项目</Button>}
      />
      <State loading={loading} error={error} onRetry={load} empty={!items.length} emptyText="还没有项目">
        <div className="fl-section-stack">
          <div className="fl-project-filters">
            <Input.Search
              allowClear
              aria-label="搜索项目"
              placeholder="搜索项目名称或代码"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
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
          {filtered.length ? (
            <section className="fl-project-entry-grid" aria-label="原型项目列表">
              {filtered.map((item) => {
                const latest = item.latestVersion;
                return (
                  <article className="fl-project-entry-card" key={item.slug}>
                    <button
                      className="fl-project-entry-main"
                      type="button"
                      aria-label={`进入 ${item.name} 的原型管理`}
                      onClick={() => navigate(`/projects/${encodeURIComponent(item.slug)}`)}
                    >
                      <span className="fl-project-entry-head">
                        <span className="fl-mono">{textOf(item.code, item.slug)}</span>
                        <Badge status={item.archived ? 'default' : 'success'} text={item.archived ? '已归档' : '进行中'} />
                      </span>
                      <strong className="fl-project-entry-title">{item.name}</strong>
                      {latest ? (
                        <span className="fl-project-version-panel">
                          <span className="fl-project-version-head">
                            <strong className="fl-mono">{latest.versionNo}</strong>
                            <Tag color={latest.display?.color}>{latest.display?.short || latest.display?.label}</Tag>
                          </span>
                          <span className="fl-project-version-title">{textOf(latest.title, '未命名版本')}</span>
                          <span className="fl-project-version-time">更新于 {fmtTime(latest.updatedAt)}</span>
                        </span>
                      ) : (
                        <span className="fl-project-version-panel is-empty">
                          <strong>暂无可用原型版本</strong>
                          <span>进入项目后创建首个版本</span>
                        </span>
                      )}
                      <span className="fl-project-entry-footer">
                        <span>{item.versionCount || 0} 个版本 · 基线 {textOf(item.baselineVersionNo, '未设置')}</span>
                        <strong>进入原型管理 <ArrowRightOutlined /></strong>
                      </span>
                    </button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [{ key: 'edit', label: '编辑项目', icon: <EditOutlined /> }],
                        onClick: () => startEdit(item),
                      }}
                    >
                      <Button
                        className="fl-project-entry-more"
                        type="text"
                        icon={<MoreOutlined />}
                        disabled={!writable}
                        aria-label={`更多项目操作：${item.name}`}
                      />
                    </Dropdown>
                  </article>
                );
              })}
            </section>
          ) : (
            <div className="fl-state fl-state-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的项目" />
            </div>
          )}
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
