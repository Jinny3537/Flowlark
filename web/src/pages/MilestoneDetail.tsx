import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, ExportOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormalReleaseDialog } from '@/components/FormalReleaseDialog';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { useTeamAccess } from '@/runtime/TeamAccess';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import {
  milestoneItemAction,
  milestoneItems,
  milestoneReleaseState,
  withoutMilestoneItem,
} from './milestoneModel.js';
import { MilestonePlatformFields } from './MilestonePlatformFields';
import { MilestoneSyncPanel } from './MilestoneSyncPanel';
import { IterationRequirementsDialog } from './IterationRequirementsDialog';
import { ActiveScopeChangeDialog } from './ActiveScopeChangeDialog';

export default function MilestoneDetail() {
  const navigate = useNavigate();
  const { name = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const { session } = useTeamAccess();
  const remoteTeam = Boolean(session && !session.host);
  const writable = health?.canWrite !== false;
  const [item, setItem] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [preflight, setPreflight] = useState<any>(null);
  const [journal, setJournal] = useState<any>(null);
  const [execution, setExecution] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [releaseMails, setReleaseMails] = useState<any[]>([]);
  const [releaseTarget, setReleaseTarget] = useState<any>(null);
  const [releaseLoading, setReleaseLoading] = useState('');
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [removing, setRemoving] = useState('');
  const [exporting, setExporting] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const selectedProject = Form.useWatch('project', form);
  const versionsRequest = useRef(0);

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      const [
        nextItem,
        nextRequirements,
        nextProjects,
        nextPreflight,
        nextJournal,
        nextExecution,
        nextReleaseMails,
      ] = await Promise.all([
        api.getMilestone(name),
        api.listRequirements(),
        api.listProjects(),
        remoteTeam ? null : api.milestonePreflight(name),
        remoteTeam ? null : api.milestoneSyncJournal(name),
        remoteTeam ? null : api.milestoneExecutionSummary(name).catch(() => null),
        remoteTeam ? [] : api.listReleaseMails(),
      ]);
      setItem(nextItem);
      setRequirements(nextRequirements);
      setProjects(nextProjects);
      setPreflight(nextPreflight);
      setJournal(nextJournal);
      setExecution(nextExecution);
      setReleaseMails(nextReleaseMails);
    } catch (nextError) {
      setError(errorText(nextError, '无法读取迭代详情'));
    } finally {
      setLoading(false);
    }
  }, [name, remoteTeam]);

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
      await api.updateMilestone(name, { items });
      form.resetFields();
      setVersions([]);
      setAddOpen(false);
      message.success('版本已加入迭代范围');
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '添加版本失败'));
    } finally {
      setSaving(false);
    }
  }, [form, item, load, message, name]);

  const removeItem = useCallback(async (entry: any) => {
    const key = `${entry.requirement}:${entry.project}:${entry.version}`;
    setRemoving(key);
    try {
      await api.updateMilestone(name, { items: withoutMilestoneItem(item.items, entry) });
      message.success('已从迭代范围移除');
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '移除版本失败'));
    } finally {
      setRemoving('');
    }
  }, [item, load, message, name]);

  const openFormalRelease = useCallback(async (entry: any) => {
    const key = `${entry.project}:${entry.version}`;
    setReleaseLoading(key);
    try {
      const [project, version] = await Promise.all([
        api.getProject(entry.project),
        api.getVersion(entry.project, entry.version),
      ]);
      setReleaseTarget({ slug: entry.project, project, version });
    } catch (nextError) {
      message.error(errorText(nextError, '无法读取发版项目或版本'));
    } finally {
      setReleaseLoading('');
    }
  }, [message]);

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

  const savePlan = useCallback(async () => {
    let values: any;
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }
    setEditSaving(true);
    try {
      await api.updateMilestone(name, values);
      message.success('迭代计划已更新');
      setEditOpen(false);
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '迭代计划更新失败'));
    } finally {
      setEditSaving(false);
    }
  }, [editForm, load, message, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = writable && ['planning', 'reviewing'].includes(item?.status || 'planning');

  const openEdit = () => {
    editForm.setFieldsValue({ goal: item?.goal || '', owner: item?.owner || '', title: item?.title, versionNo: item?.versionNo, startAt: item?.startAt, endAt: item?.endAt, platform: item?.platform ? { ...item.platform, sprintId: item.external?.sprintId || item.platform.sprintId } : null });
    setEditOpen(true);
  };

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="迭代详情"
        title={item?.title || name}
        description="围绕项目版本目标查看需求范围、冲刺执行与原型交付物。"
        backTo="/milestones"
        actions={item ? (
          <Space wrap>
            <Button icon={<EditOutlined />} disabled={!editable} onClick={openEdit}>编辑计划</Button>
            {item.project ? <Button type="primary" disabled={!editable} onClick={() => setRequirementsOpen(true)}>关联需求</Button> : null}
            <Button icon={<PlusOutlined />} disabled={!editable} onClick={() => setAddOpen(true)}>添加原型交付物</Button>
            {item.status === 'active' ? <Button danger icon={<EditOutlined />} disabled={!writable} onClick={() => item.project ? setRequirementsOpen(true) : setScopeOpen(true)}>变更范围</Button> : null}
            <Button icon={<ExportOutlined />} loading={exporting} disabled={!writable} onClick={exportPackage}>导出迭代包</Button>
          </Space>
        ) : null}
      />
      <State loading={loading && !item} error={error} onRetry={load} empty={!item} emptyText="没有找到迭代">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="迭代版本">{item?.versionNo || name}</Descriptions.Item>
              <Descriptions.Item label="所属项目">{item?.project || '历史迭代，待整理'}</Descriptions.Item>
              {!item?.project ? <Descriptions.Item label="标识"><span className="fl-mono">{name}</span></Descriptions.Item> : null}
              <Descriptions.Item label="原型检查"><Tag color={item?.ready ? 'success' : 'warning'}>{!item?.items?.length ? '尚未添加原型' : item?.ready ? '检查通过' : `${item?.warnings?.length || 0} 项风险`}</Tag></Descriptions.Item>
              <Descriptions.Item label="开始">{textOf(item?.startAt)}</Descriptions.Item>
              <Descriptions.Item label="结束">{textOf(item?.endAt)}</Descriptions.Item>
              <Descriptions.Item label="平台项目">{item?.platform?.projectName || '本地迭代'}</Descriptions.Item>
              <Descriptions.Item label="目标发布版本">{item?.platform?.versionName || '未指定'}</Descriptions.Item>
              <Descriptions.Item label="关联冲刺">{item?.platform?.sprintName || (item?.external?.sprintId ? `#${item.external.sprintId}` : '确认同步后新建')}</Descriptions.Item>
              <Descriptions.Item label="迭代目标">{textOf(item?.goal)}</Descriptions.Item>
              <Descriptions.Item label="负责人">{textOf(item?.platform?.ownerName || item?.owner)}</Descriptions.Item>
              <Descriptions.Item label="任务平台">{item?.external ? textOf(item.external.remoteStatus, '已关联') : '本地'}</Descriptions.Item>
              <Descriptions.Item label="同步时间">{item?.external?.syncedAt ? fmtTime(item.external.syncedAt) : '尚未同步'}</Descriptions.Item>
            </Descriptions>
          </section>
          {item?.project ? <section className="fl-detail-section">
            <h2>关联需求 · {item.requirements?.length || 0}</h2>
            <Table rowKey="code" size="small" dataSource={requirements.filter(r => item.requirements?.includes(r.code))} locale={{ emptyText: '尚未关联需求' }}
              columns={[
                { title: '需求', render: (_, r: any) => <Button type="link" onClick={() => navigate(`/requirements/${encodeURIComponent(r.code)}`)}>{r.code} · {r.title}</Button> },
                { title: '优先级', dataIndex: 'priority' }, { title: '负责人', dataIndex: 'owner' },
                { title: '原型交付物', render: (_, r: any) => item.items.filter((entry: any) => entry.requirement === r.code).length || '待补充' },
                { title: '执行任务', render: (_, r: any) => { const binding = r.externalTasks?.find((t: any) => t.server === item.external?.server && t.projectId === item.external?.projectId); return binding ? `#${binding.taskId} · ${binding.remoteStatus ?? '已关联'}` : '待创建'; } },
              ]} />
          </section> : null}
          {item ? (
            <MilestoneSyncPanel
              name={name}
              item={item}
              preflight={preflight}
              journal={journal}
              execution={execution}
              writable={writable}
              onChanged={load}
            />
          ) : null}
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
            <h2>原型与交付物</h2>
            <Table
              rowKey={(entry: any) => `${entry.requirement}:${entry.project}:${entry.version}`}
              pagination={false}
              locale={{ emptyText: '尚未添加原型交付物，需求可先进入冲刺' }}
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
                  title: '发版状态',
                  width: 130,
                  render: (_, entry: any) => {
                    const state = milestoneReleaseState(entry, releaseMails);
                    return <Tag color={state.color}>{state.label}</Tag>;
                  },
                },
                {
                  title: '操作',
                  width: 140,
                  render: (_, entry: any) => {
                    const action = milestoneItemAction(item?.status);
                    if (action === 'release') {
                      const key = `${entry.project}:${entry.version}`;
                      return (
                        <Button
                          type="link"
                          icon={<SendOutlined />}
                          loading={releaseLoading === key}
                          disabled={!writable || Boolean(releaseLoading)}
                          onClick={() => void openFormalRelease(entry)}
                        >
                          正式发版
                        </Button>
                      );
                    }
                    if (action === 'remove') {
                      const key = `${entry.requirement}:${entry.project}:${entry.version}`;
                      return (
                        <Popconfirm
                          title="从迭代范围移除该版本？"
                          okText="移除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => removeItem(entry)}
                        >
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            loading={removing === key}
                            disabled={!editable || Boolean(removing)}
                          >
                            移除
                          </Button>
                        </Popconfirm>
                      );
                    }
                    return <span aria-label="无可用操作">—</span>;
                  },
                },
              ]}
              scroll={{ x: 900 }}
            />
          </section>
        </div>
      </State>

      <FormalReleaseDialog
        open={Boolean(releaseTarget)}
        milestone={name}
        slug={releaseTarget?.slug || ''}
        project={releaseTarget?.project}
        version={releaseTarget?.version}
        onClose={() => setReleaseTarget(null)}
        onChanged={load}
      />

      <Modal
        title="编辑迭代计划"
        open={editOpen}
        confirmLoading={editSaving}
        okButtonProps={{ disabled: !editable }}
        onOk={() => void savePlan()}
        onCancel={() => setEditOpen(false)}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="迭代名称" rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
          {item?.project ? <Form.Item name="versionNo" label="迭代版本号" rules={[{ required: true }]}><Input /></Form.Item> : null}
          <Form.Item name="startAt" label="开始日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="endAt" label="结束日期" rules={[{ required: true }]}><Input type="date" /></Form.Item>
          {editOpen ? <Form.Item name="platform"><MilestonePlatformFields createMode={!!item?.project} locked={!!item?.external?.syncedAt} /></Form.Item> : null}
          <Form.Item name="goal" label="迭代目标" rules={[{ required: true, whitespace: true, message: '请填写迭代目标' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="owner" label="计划联系人（选填）">
            <Input placeholder="用于匹配平台冲刺负责人" />
          </Form.Item>
        </Form>
      </Modal>

      {item?.project ? <IterationRequirementsDialog open={requirementsOpen} item={item} requirements={requirements} onClose={() => setRequirementsOpen(false)} onChanged={load} /> : null}

      {item ? (
        <ActiveScopeChangeDialog
          open={scopeOpen}
          name={name}
          item={item}
          requirements={requirements}
          projects={projects}
          onClose={() => setScopeOpen(false)}
          onChanged={load}
        />
      ) : null}

      <Modal
        title="添加需求版本"
        open={addOpen}
        confirmLoading={saving}
        okButtonProps={{ disabled: !editable }}
        onOk={addItem}
        onCancel={() => setAddOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="requirement" label="需求" rules={[{ required: true, message: '请选择需求' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择需求"
              options={requirements.filter((requirement) => !item?.project || item.requirements?.includes(requirement.code)).map((requirement) => ({ value: requirement.code, label: `${requirement.code} · ${requirement.title}` }))}
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
