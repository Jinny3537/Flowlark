import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, DatePicker, Descriptions, Form, Input, List, Modal, Space, Tag } from 'antd';
import { AuditOutlined, CheckCircleOutlined, EditOutlined, ExportOutlined, LinkOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import { requirementPayload } from './requirementsModel.js';
import {
  externalBindingMeta,
  prototypeProgressMeta,
  requirementPrimaryAction,
  requirementStatusMeta,
  writeActionGuard,
} from './requirementLifecycleModel.js';

function markdownFrom(value: any) {
  if (typeof value === 'string') return value;
  return String(value?.markdown ?? value?.content ?? value?.spec ?? '');
}

function milestoneName(value: any) {
  return String(typeof value === 'string' ? value : value?.name || '');
}

export default function RequirementDetail() {
  const navigate = useNavigate();
  const { code = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const readonlyReason = health?.readonlyReason || '当前为只读模式，只能查看需求信息。';
  const [item, setItem] = useState<any>(null);
  const [spec, setSpec] = useState('');
  const [specDraft, setSpecDraft] = useState('');
  const [specSaving, setSpecSaving] = useState(false);
  const [specFeedback, setSpecFeedback] = useState('');
  const [preflight, setPreflight] = useState<any>({ ready: false, blockers: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingPlanning, setBindingPlanning] = useState(false);
  const [bindingPlan, setBindingPlan] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshingExternal, setRefreshingExternal] = useState(false);
  const [form] = Form.useForm();
  const [bindingForm] = Form.useForm();

  const lifecycle = useMemo(() => requirementStatusMeta(item?.status), [item?.status]);
  const prototypeProgress = useMemo(() => prototypeProgressMeta(item?.derivedStatus), [item?.derivedStatus]);
  const externalBinding = useMemo(() => externalBindingMeta(item || {}), [item]);
  const primaryAction = useMemo(() => requirementPrimaryAction(item || {}), [item]);
  const primaryGuard = useMemo(() => writeActionGuard({
    canWrite: primaryAction?.requiresWrite === false || writable,
    readonlyReason,
    blockers: primaryAction?.key === 'confirm' ? preflight.blockers : [],
  }), [preflight.blockers, primaryAction?.key, primaryAction?.requiresWrite, readonlyReason, writable]);
  const memberships = useMemo(() => item?.milestones || [], [item?.milestones]);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const [detail, specResult, confirmation, allMilestones] = await Promise.all([
        api.getRequirement(code),
        api.getRequirementSpec(code),
        api.requirementConfirmationPreflight(code),
        api.listMilestones(),
      ]);
      const milestoneMembership = detail.milestones || allMilestones.filter((milestone: any) =>
        (milestone.items || []).some((entry: any) => entry.requirement === code));
      const markdown = markdownFrom(specResult);
      setItem({ ...detail, milestones: milestoneMembership });
      setSpec(markdown);
      setSpecDraft(markdown);
      setPreflight(confirmation || { ready: false, blockers: [] });
      setSpecFeedback('');
    } catch (nextError) {
      setError(errorText(nextError, '无法读取需求详情'));
    } finally {
      setLoading(false);
    }
  }, [code]);

  const refreshPreflight = useCallback(async () => {
    setPreflight((await api.requirementConfirmationPreflight(code)) || { ready: false, blockers: [] });
  }, [code]);

  const startEdit = useCallback(() => {
    form.setFieldsValue({
      title: item?.title || '',
      description: item?.description || '',
      owner: item?.owner || '',
      dueDate: item?.dueDate ? dayjs(item.dueDate, 'YYYY-MM-DD') : null,
    });
    setEditOpen(true);
  }, [form, item]);

  const save = useCallback(async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      await api.updateRequirement(code, requirementPayload(values));
      message.success('需求已更新');
      setEditOpen(false);
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '更新需求失败'));
    } finally {
      setSaving(false);
    }
  }, [code, form, load, message]);

  const saveSpec = useCallback(async () => {
    setSpecSaving(true);
    setSpecFeedback('');
    try {
      const saved = await api.updateRequirementSpec(code, specDraft);
      const markdown = markdownFrom(saved) || specDraft;
      setSpec(markdown);
      setSpecDraft(markdown);
      setSpecFeedback('规格书已保存');
      message.success('规格书已保存');
      await refreshPreflight();
    } catch (nextError) {
      setSpecFeedback(errorText(nextError, '规格书保存失败'));
    } finally {
      setSpecSaving(false);
    }
  }, [code, message, refreshPreflight, specDraft]);

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

  const refreshExternal = useCallback(async () => {
    setRefreshingExternal(true);
    try {
      const next = await api.refreshExternalRequirement(code);
      setItem(next);
      if (next?.external?.syncStatus === 'failed') {
        message.warning(next.external.failure?.message || '需求池刷新失败，已记录失败状态');
      } else {
        message.success('需求池引用已刷新');
      }
    } catch (nextError) {
      message.error(errorText(nextError, '刷新需求池失败'));
    } finally {
      setRefreshingExternal(false);
    }
  }, [code, message]);

  const runPrimaryAction = useCallback(async () => {
    if (!primaryAction || primaryGuard.disabled) return;
    if (primaryAction.key === 'confirm') {
      setSaving(true);
      try {
        await api.transitionRequirement(code, 'confirmed');
        message.success('需求已确认');
        await load();
      } catch (nextError) {
        message.error(errorText(nextError, '确认需求失败'));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (primaryAction.key === 'join-milestone') {
      navigate(`/milestones?requirement=${encodeURIComponent(code)}`);
      return;
    }
    const first = milestoneName(memberships[0]);
    navigate(first ? `/milestones/${encodeURIComponent(first)}` : '/milestones');
  }, [code, load, memberships, message, navigate, primaryAction, primaryGuard.disabled]);

  const repairBlocker = useCallback((blocker: any) => {
    if (blocker?.code === 'REQUIREMENT_SPEC_REQUIRED') {
      document.getElementById('requirement-specification')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      startEdit();
    }
  }, [startEdit]);

  const startBinding = useCallback(() => {
    const binding = externalBinding.binding;
    bindingForm.setFieldsValue({
      project: item?.versions?.[0]?.project || item?.project || '',
      remoteId: binding?.taskId || '',
      reason: '',
    });
    setBindingPlan(null);
    setBindingOpen(true);
  }, [bindingForm, externalBinding.binding, item]);

  const previewBinding = useCallback(async () => {
    let values: any;
    try { values = await bindingForm.validateFields(); } catch { return; }
    setBindingPlanning(true);
    try {
      const plan = await api.planRequirementTaskBinding(code, {
        project: values.project,
        remoteId: values.remoteId,
        expectedTaskId: externalBinding.binding?.taskId || null,
        reason: values.reason || '',
      });
      setBindingPlan(plan);
      message.success('任务关联预览已生成');
    } catch (nextError) {
      message.error(errorText(nextError, '无法生成任务关联预览'));
    } finally {
      setBindingPlanning(false);
    }
  }, [bindingForm, code, externalBinding.binding?.taskId, message]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="fl-page fl-requirement-detail-page">
      <PageHeader
        eyebrow="需求详情"
        title={item?.title || code}
        description={item?.description || '查看需求属性、生命周期与关联原型版本。'}
        backTo="/requirements"
        actions={item ? (
          <Space wrap className="fl-requirement-header-actions">
            {primaryAction ? (
              <Button type="primary" icon={primaryAction.key === 'confirm' ? <CheckCircleOutlined /> : <LinkOutlined />} loading={saving && primaryAction.key === 'confirm'} disabled={primaryGuard.disabled} title={primaryGuard.reason || undefined} onClick={() => void runPrimaryAction()}>
                {primaryAction.label}
              </Button>
            ) : null}
            <Button icon={<EditOutlined />} disabled={!writable} title={!writable ? readonlyReason : undefined} onClick={startEdit}>编辑</Button>
            {item.external ? <Button icon={<SyncOutlined />} loading={refreshingExternal} disabled={!writable} title={!writable ? readonlyReason : undefined} onClick={() => void refreshExternal()}>刷新需求池</Button> : null}
            <Button icon={<ExportOutlined />} loading={exporting} disabled={!writable} title={!writable ? readonlyReason : undefined} onClick={exportPackage}>导出需求包</Button>
          </Space>
        ) : null}
      />

      {!writable && item ? <Alert className="fl-dashboard-alert" type="info" showIcon message="只读模式" description={`${readonlyReason} 生命周期、规格书、任务关联和迭代归属仍可查看。`} /> : null}
      {item?.external?.syncStatus === 'failed' ? (
        <Alert
          className="fl-dashboard-alert"
          type="warning"
          showIcon
          message="需求池刷新失败"
          description={`${item.external.failure?.message || '外部需求暂不可访问'}${item.external.failure?.hint ? `；${item.external.failure.hint}` : ''}`}
        />
      ) : null}

      <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到需求">
        <div className="fl-requirement-detail-grid">
          <div className="fl-detail-stack">
            <section className="fl-detail-summary" id="requirement-overview">
              <Descriptions column={{ xs: 1, sm: 2, lg: 3 }}>
                <Descriptions.Item label="编号"><span className="fl-mono">{code}</span></Descriptions.Item>
                <Descriptions.Item label="需求生命周期"><Tag color={lifecycle.color}>{lifecycle.label}</Tag></Descriptions.Item>
                <Descriptions.Item label="原型进度"><Tag color={prototypeProgress.color}>{prototypeProgress.label}</Tag></Descriptions.Item>
                <Descriptions.Item label="负责人">{textOf(item?.owner)}</Descriptions.Item>
                <Descriptions.Item label="项目">{textOf(item?.project, '未分项目')}</Descriptions.Item>
                <Descriptions.Item label="模块">{textOf(item?.module, '未分模块')}</Descriptions.Item>
                <Descriptions.Item label="来源">{item?.external ? '需求池' : '本地'}</Descriptions.Item>
                {item?.external ? <Descriptions.Item label="需求池同步">{item.external.syncStatus === 'failed' ? '刷新失败' : item.external.syncedAt ? `已同步 ${fmtTime(item.external.syncedAt)}` : '尚未同步'}</Descriptions.Item> : null}
                <Descriptions.Item label="类型">{textOf(item?.type)}</Descriptions.Item>
                <Descriptions.Item label="优先级">{textOf(item?.priority)}</Descriptions.Item>
                <Descriptions.Item label="截止日期"><Space size="small" wrap><span>{textOf(item?.dueDate)}</span>{item?.overdue ? <Tag color="error">已逾期</Tag> : null}</Space></Descriptions.Item>
              </Descriptions>
            </section>

            {item?.status === 'draft' ? (
              <section className="fl-detail-section fl-confirmation-panel" id="requirement-confirmation" aria-labelledby="requirement-confirmation-title">
                <div className="fl-section-head">
                  <div><h2 id="requirement-confirmation-title">确认门禁</h2><p>标题、描述、负责人和规格书齐备后，才可确认需求。</p></div>
                  <Tag color={preflight.ready ? 'success' : 'warning'}>{preflight.ready ? '可以确认' : `${preflight.blockers?.length || 0} 项待补充`}</Tag>
                </div>
                {preflight.ready ? <Alert type="success" showIcon message="确认条件已满足" description="页面顶部的“确认需求”是当前唯一主动作。" /> : (
                  <List size="small" dataSource={preflight.blockers || []} locale={{ emptyText: '正在检查确认条件' }} renderItem={(blocker: any) => (
                    <List.Item actions={[<Button key="repair" type="link" onClick={() => repairBlocker(blocker)}>去补充</Button>]}>
                      <span><strong>{blocker.message}</strong><span className="fl-muted fl-blocker-code">{blocker.code}</span></span>
                    </List.Item>
                  )} />
                )}
              </section>
            ) : null}

            <section className="fl-detail-section" id="requirement-specification" aria-labelledby="requirement-specification-title">
              <div className="fl-section-head">
                <div><h2 id="requirement-specification-title">验收与规格书</h2><p>使用 Markdown 记录验收边界；保存规格书不会自动改变生命周期。</p></div>
                <Tag>{spec.trim() ? '已编写' : '待编写'}</Tag>
              </div>
              <label className="fl-field-label" htmlFor="requirement-spec-editor">Markdown 内容</label>
              <Input.TextArea id="requirement-spec-editor" className="fl-requirement-spec-editor fl-mono" value={specDraft} rows={12} disabled={!writable} placeholder="# 验收标准\n\n- 用户可以……\n- 系统必须……" onChange={(event) => { setSpecDraft(event.target.value); setSpecFeedback(''); }} />
              <div className="fl-requirement-editor-actions">
                <span className="fl-inline-feedback" role="status" aria-live="polite">{specFeedback || (specDraft !== spec ? '有未保存修改' : '内容已同步')}</span>
                <Button icon={<SaveOutlined />} loading={specSaving} disabled={!writable || specDraft === spec} title={!writable ? readonlyReason : undefined} onClick={() => void saveSpec()}>保存规格书</Button>
              </div>
            </section>

            <section className="fl-detail-section">
              <div className="fl-section-head">
                <div><h2>原型进度与关联版本</h2><p>生命周期与原型完成度分开计算，避免把“已确认”误当作“已交付”。</p></div>
                <Tag>{item?.versions?.length || 0} 个版本</Tag>
              </div>
              <List locale={{ emptyText: '还没有关联版本' }} dataSource={item?.versions || []} renderItem={(version: any) => {
                const versionNo = version.versionNo || version.no;
                return (
                  <List.Item extra={<Tag color={version.isBaseline ? 'success' : 'default'}>{version.isBaseline ? '当前基线' : '非基线'}</Tag>}>
                    <List.Item.Meta title={<Button type="link" className="fl-result-link" onClick={() => navigate(`/projects/${encodeURIComponent(version.project)}/versions/${encodeURIComponent(versionNo)}`)}>{version.project} / {versionNo} · {textOf(version.title)}</Button>} description={version.createdAt ? `创建于 ${fmtTime(version.createdAt)}` : '打开版本工作台'} />
                  </List.Item>
                );
              }} />
            </section>
          </div>

          <aside className="fl-requirement-context-stack">
            <section className="fl-detail-section">
              <div className="fl-section-head"><div><h2>外部主任务</h2><p>展示当前受控绑定及最近同步状态。</p></div><Tag color={externalBinding.tone}>{externalBinding.label}</Tag></div>
              {externalBinding.binding ? (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="服务">{textOf(externalBinding.binding.server)}</Descriptions.Item>
                  <Descriptions.Item label="外部项目">{textOf(externalBinding.binding.projectId)}</Descriptions.Item>
                  <Descriptions.Item label="任务">{textOf(externalBinding.binding.taskCode || externalBinding.binding.taskId)}</Descriptions.Item>
                  <Descriptions.Item label="远端状态">{textOf(externalBinding.binding.remoteStatus)}</Descriptions.Item>
                  <Descriptions.Item label="最近同步">{externalBinding.binding.syncedAt ? fmtTime(externalBinding.binding.syncedAt) : '尚未同步'}</Descriptions.Item>
                  <Descriptions.Item label="差异状态">{externalBinding.state === 'drift' ? '检测到远端差异' : '尚未完成远端差异检查'}</Descriptions.Item>
                </Descriptions>
              ) : <div className="fl-empty-note">尚未绑定任务平台主任务。</div>}
              <div className="fl-context-actions">
                <Button icon={<AuditOutlined />} onClick={() => navigate(`/sync?requirement=${encodeURIComponent(code)}`)}>查看同步与审计</Button>
                <Button icon={<LinkOutlined />} disabled={!writable} title={!writable ? readonlyReason : undefined} onClick={startBinding}>{externalBinding.binding ? '预览重新关联' : '预览任务关联'}</Button>
              </div>
            </section>

            <section className="fl-detail-section">
              <div className="fl-section-head">
                <div><h2>交付与验收</h2><p>来自正式交付快照，不写入需求文件。</p></div>
                <Tag>{item?.deliveries?.length || 0} 个</Tag>
              </div>
              <List size="small" locale={{ emptyText: '尚未形成正式交付' }} dataSource={item?.deliveries || []} renderItem={(delivery: any) => (
                <List.Item actions={[<Button key="view" type="link" onClick={() => navigate(`/deliveries/${encodeURIComponent(delivery.snapshot)}`)}>查看</Button>]}>
                  <List.Item.Meta
                    title={<span>{delivery.project} / {delivery.version}</span>}
                    description={(
                      <Space direction="vertical" size={2}>
                        <span>{delivery.milestoneTitle || delivery.milestone} · {delivery.deliveredAt ? fmtTime(delivery.deliveredAt) : '正式交付'}</span>
                        <Space size={4} wrap>
                          <Tag color={delivery.acceptance?.ready ? 'success' : delivery.acceptance?.status === 'rejected' ? 'error' : 'warning'}>
                            {delivery.acceptance?.ready ? '验收通过' : delivery.acceptance?.status === 'rejected' ? '验收拒绝' : '待验收'}
                          </Tag>
                          <Tag color={delivery.external?.remoteStatus ? 'blue' : 'default'}>
                            {delivery.external?.remoteStatus ? `外部 ${delivery.external.remoteStatus}` : '外部未回读'}
                          </Tag>
                        </Space>
                      </Space>
                    )}
                  />
                </List.Item>
              )} />
            </section>

            <section className="fl-detail-section">
              <div className="fl-section-head"><div><h2>所属迭代</h2><p>需求进入开发后，以迭代为执行上下文。</p></div><Tag>{memberships.length} 个</Tag></div>
              <List size="small" locale={{ emptyText: '尚未加入迭代' }} dataSource={memberships} renderItem={(milestone: any) => {
                const name = milestoneName(milestone);
                return <List.Item actions={[<Button key="view" type="link" onClick={() => navigate(`/milestones/${encodeURIComponent(name)}`)}>查看</Button>]}><List.Item.Meta title={<span className="fl-mono">{name}</span>} description={textOf(milestone?.title || milestone?.status, '迭代计划')} /></List.Item>;
              }} />
            </section>
          </aside>
        </div>
      </State>

      <Modal title="编辑需求" open={editOpen} confirmLoading={saving} okButtonProps={{ disabled: !writable }} onOk={save} onCancel={() => setEditOpen(false)}>
        <Form form={form} layout="vertical" disabled={!writable}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true, message: '请填写描述' }]}><Input.TextArea rows={5} /></Form.Item>
          <Form.Item name="owner" label="负责人" rules={[{ required: true, message: '请填写负责人' }]}><Input /></Form.Item>
          <Form.Item name="dueDate" label="截止日期"><DatePicker className="fl-full-width" format="YYYY-MM-DD" placeholder="选择截止日期" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={externalBinding.binding ? '预览重新关联主任务' : '预览关联主任务'} open={bindingOpen} confirmLoading={bindingPlanning} okText="生成预览" okButtonProps={{ disabled: !writable }} onOk={() => void previewBinding()} onCancel={() => setBindingOpen(false)}>
        <Form form={bindingForm} layout="vertical" disabled={!writable}>
          <Form.Item name="project" label="本地项目标识" rules={[{ required: true, message: '请选择需求所属的本地项目' }]}><Input placeholder="orders" /></Form.Item>
          <Form.Item name="remoteId" label="远端任务 ID" rules={[{ required: true, message: '请输入远端任务 ID' }]}><Input className="fl-mono" placeholder="123" /></Form.Item>
          <Form.Item name="reason" label="关联原因" rules={[{ required: true, whitespace: true, message: '请填写关联原因' }]}><Input.TextArea rows={3} placeholder="说明首次关联或重新关联原因" /></Form.Item>
        </Form>
        {bindingPlan ? <Alert type="success" showIcon message="关联预览已进入同步中心" description={<Button type="link" onClick={() => navigate('/sync')}>打开同步中心确认执行</Button>} /> : null}
      </Modal>
    </main>
  );
}
