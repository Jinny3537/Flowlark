import { Alert, App, Button, DatePicker, Descriptions, Form, Input, Modal, Select, Space, Steps, Table, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { MilestonePlatformFields } from './MilestonePlatformFields';

export function CreateIterationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (name: string) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [iterations, setIterations] = useState<any[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdName, setCreatedName] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const operationId = useRef('');
  const project = Form.useWatch('project', form);
  const values = Form.useWatch([], form) || {};
  useEffect(() => {
    if (!open) return;
    let live = true;
    setStep(0); setSelected([]); setQuery(''); setError(''); setCreatedName(''); setPlan(null); form.resetFields();
    operationId.current = `IT-${crypto.randomUUID()}`;
    setLoading(true);
    Promise.all([api.listRequirements(), api.listMilestones(), api.listProjects()]).then(([reqs, items, localProjects]) => {
      if (!live) return;
      setRequirements(reqs); setIterations(items);
      setProjects([...new Set([...reqs.map(r => r.project), ...localProjects.map(p => p.slug)].filter(Boolean))].sort());
    }).catch(e => { if (live) setError(errorText(e, '读取项目需求失败')); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, form]);
  const occupied = (code: string) => iterations.find(item => !['delivered', 'archived', 'canceled'].includes(item.status)
    && (item.requirements || item.items?.map((entry: any) => entry.requirement) || []).includes(code));
  const candidates = requirements.filter(r => r.project === project && `${r.code} ${r.title}`.toLowerCase().includes(query.toLowerCase()));
  const selectedRows = requirements.filter(r => selected.includes(r.code));

  async function save(draft: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    let name = createdName;
    try {
      await form.validateFields(draft ? ['project', 'versionNo', 'title'] : undefined);
      const v = form.getFieldsValue(true);
      if (!draft && !selected.length) { setError('请至少选择一条需求'); return; }
      if (!name) {
        const range = v.range;
        const created = await api.createMilestone({ ...v, name: operationId.current, requirements: selected, items: [],
          startAt: range?.[0]?.format('YYYY-MM-DD') || '', endAt: range?.[1]?.format('YYYY-MM-DD') || '', range: undefined });
        name = created.name; setCreatedName(name);
      }
      if (draft) { message.success('迭代草稿已保存'); onCreated(name); return; }
      const next = await api.planMilestoneSync(name);
      setPlan(next); setStep(2);
      if (next.blockers?.length) setError('迭代计划已保存，请处理下方问题后在详情继续创建冲刺。');
    } catch (e: any) {
      if (!name && !e.errorFields) {
        try { const existing = await api.getMilestone(operationId.current); name = existing.name; setCreatedName(name); } catch {}
      }
      if (!e.errorFields) setError(errorText(e, name ? '计划已保存，冲刺准备失败，可进入详情重试' : '保存迭代失败'));
    } finally { setBusy(false); }
  }
  async function execute() {
    setBusy(true); setError('');
    try {
      await api.executeMilestoneSync(createdName, { planHash: plan.hash, confirmed: true });
      message.success('迭代及对应冲刺已创建，需求已关联'); onCreated(createdName);
    } catch (e) { setError(errorText(e, '冲刺创建未全部完成，请进入详情重试未完成步骤')); setPlan(null); }
    finally { setBusy(false); }
  }
  const close = () => createdName ? onCreated(createdName) : onClose();
  return <Modal title="新建项目版本迭代" open={open} width={900} onCancel={close} closable={!busy} maskClosable={false} footer={
    <Space wrap>
      <Button disabled={busy} onClick={close}>{createdName ? '进入迭代详情' : '取消'}</Button>
      {step > 0 && !createdName ? <Button disabled={busy} onClick={() => setStep(step - 1)}>上一步</Button> : null}
      {!createdName ? <Button loading={busy} disabled={loading} onClick={() => void save(true)}>保存草稿</Button> : null}
      {step === 0 ? <Button type="primary" disabled={loading || busy} onClick={async () => { try { await form.validateFields(); setStep(1); } catch {} }}>下一步：关联需求</Button> : null}
      {step === 1 ? <Button type="primary" disabled={!selected.length || loading} loading={busy} onClick={() => void save(false)}>下一步：确认创建</Button> : null}
      {step === 2 && plan ? <Button type="primary" loading={busy} disabled={!!plan.blockers?.length} onClick={() => void execute()}>创建迭代并新建冲刺</Button> : null}
    </Space>
  }>
    <Steps current={step} items={[{ title: '版本计划' }, { title: '关联需求' }, { title: '确认创建' }]} style={{ marginBottom: 24 }} />
    {error ? <Alert showIcon type="error" message={error} style={{ marginBottom: 16 }} /> : null}
    <Form form={form} layout="vertical" style={{ display: step === 0 ? 'block' : 'none' }}>
      <Form.Item name="project" label="所属项目" rules={[{ required: true, message: '请选择需求所属项目' }]} extra="需求按此项目筛选；研发执行项目在下方明确绑定。">
        <Select showSearch options={projects.map(value => ({ value, label: value }))} placeholder="选择本轮需求所属项目" onChange={() => { setSelected([]); form.setFieldValue('platform', null); }} />
      </Form.Item>
      <Space align="start" style={{ display: 'flex' }}>
        <Form.Item name="versionNo" label="迭代版本号" rules={[{ required: true, whitespace: true, message: '请填写版本号' }]}><Input placeholder="v1.3.0-S1" maxLength={64} /></Form.Item>
        <Form.Item name="title" label="迭代名称" rules={[{ required: true, whitespace: true, message: '请填写迭代名称' }]}><Input placeholder="隐患整改闭环" maxLength={64} /></Form.Item>
      </Space>
      <Form.Item name="goal" label="迭代目标" rules={[{ required: true, whitespace: true, message: '请填写本轮目标' }]}><Input.TextArea rows={2} placeholder="说明本轮计划交付的业务能力" /></Form.Item>
      <Form.Item name="range" label="迭代周期" rules={[{ required: true, message: '请选择完整周期' }]}><DatePicker.RangePicker className="fl-full-width" /></Form.Item>
      <Form.Item name="platform" rules={[{ validator: (_, value) => value?.projectId && value?.ownerId ? Promise.resolve() : Promise.reject(new Error('请选择研发执行项目和冲刺负责人')) }]}>
        {open ? <MilestonePlatformFields createMode /> : null}
      </Form.Item>
    </Form>
    {step === 1 ? <>
      <Alert type="info" showIcon message={`${project} · 已选 ${selected.length} 条需求`} description="需求可独立加入迭代，原型可在详情补充。其他未结束迭代占用的需求需先移除或结转。" />
      <Input.Search style={{ margin: '16px 0' }} placeholder="搜索需求编号或名称" value={query} onChange={e => setQuery(e.target.value)} />
      <Table rowKey="code" loading={loading} dataSource={candidates} size="small" pagination={{ pageSize: 6 }} locale={{ emptyText: '该项目暂无可选需求，请先在需求池创建并设置所属项目' }}
        rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: keys => setSelected(keys as string[]), getCheckboxProps: r => ({ disabled: !!occupied(r.code) }) }}
        columns={[{ title: '需求', render: (_, r: any) => <><div>{r.title}</div><span className="fl-muted">{r.code}</span></> }, { title: '优先级', dataIndex: 'priority' }, { title: '负责人', dataIndex: 'owner' }, { title: '当前迭代', render: (_, r: any) => occupied(r.code)?.title || '待排期' }]} />
    </> : null}
    {step === 2 ? <>
      <Descriptions column={2} bordered size="small" items={[
        { key: 'project', label: '所属项目', children: values.project }, { key: 'version', label: '迭代版本', children: values.versionNo },
        { key: 'period', label: '迭代周期', children: values.range?.map((date: any) => date.format('YYYY-MM-DD')).join(' 至 ') },
        { key: 'owner', label: '负责人', children: values.platform?.ownerName || '—' },
        { key: 'title', label: '对应冲刺', children: `${values.versionNo} · ${values.title}` }, { key: 'count', label: '需求范围', children: `${selected.length} 条` },
        { key: 'platform', label: '研发执行项目', children: values.platform?.projectName }, { key: 'goal', label: '迭代目标', children: values.goal },
      ]} />
      <div style={{ margin: '16px 0' }}>{selectedRows.map(r => <Tag key={r.code}>{r.code} · {r.title}</Tag>)}</div>
      {plan?.blockers?.map((b: any) => <Alert key={`${b.code}-${b.target}`} type="warning" message={b.message} style={{ marginBottom: 8 }} />)}
      {plan ? <Alert type="info" showIcon message={`将新建 ${plan.summary.createSprint} 个冲刺，创建 ${plan.summary.createTask} 个需求任务，更新 ${plan.summary.updateTask} 个任务，关联迁移 ${plan.summary.moveTask} 个任务。`} /> : null}
    </> : null}
  </Modal>;
}
