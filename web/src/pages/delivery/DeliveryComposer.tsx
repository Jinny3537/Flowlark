import { Alert, Button, Form, Input, List, Modal, Select, Space, Steps, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { contextualRoute, deliveryDraftKey } from '../workflowModel.js';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';

export const purposeLabels: Record<string, string> = { review: '评审材料', development: '研发交接', acceptance: '验收归档' };
export default function DeliveryComposer({ open, onClose, onCreated, milestones, snapshots, writable, initialMilestone = "", draftOrigin = "", returnContext = "" }: any) {
  const [form] = Form.useForm();
  const { health } = useAppRuntime();
  const draftKey = deliveryDraftKey(health?.repo || window.location.origin, draftOrigin);
  const initialized = useRef('');
  const [draftWarning, setDraftWarning] = useState('');
  const persist = (_: any, values: any) => {
    try { sessionStorage.setItem(draftKey, JSON.stringify(values)); }
    catch { setDraftWarning('当前浏览器无法暂存输入，请在离开前自行保存交接说明。'); }
  };
  const discard = () => { try { sessionStorage.removeItem(draftKey); } catch {} form.resetFields(); initialized.current = ''; onClose(); };
  const pause = () => { persist(null, form.getFieldsValue(true)); initialized.current = ''; onClose(); };
  const resumeParams = new URLSearchParams(returnContext);
  resumeParams.set('prepare', Form.useWatch('milestone', form) || initialMilestone);
  resumeParams.set('draft', draftOrigin);
  const resumeRoute = `/deliveries?${resumeParams}`;
  const milestone = Form.useWatch('milestone', form);
  const [step, setStep] = useState(0);
  const [check, setCheck] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) { initialized.current = ''; return; }
    if (!health?.repo || initialized.current === draftKey) return;
    initialized.current = draftKey;
    let draft: any = null;
    try { draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); } catch { setDraftWarning('暂存资料无法读取，请重新填写。'); }
    form.resetFields();
    form.setFieldsValue({ purpose: 'development', milestone: initialMilestone || undefined, ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}) });
    setStep(0); setError(''); setRefresh(n => n + 1);
  }, [open, draftKey, health?.repo, form, initialMilestone]);
  useEffect(() => {
    let active = true;
    setCheck(null);
    if (!open || !milestone) { setChecking(false); return; }
    setChecking(true); setError('');
    api.inspectSnapshot({ milestone }).then(value => { if (active) setCheck(value); })
      .catch(cause => { if (active) setError(errorText(cause, '材料检查失败')); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [milestone, open, refresh]);
  async function next() {
    try { await form.validateFields(['name', 'title', 'milestone', 'purpose']); setStep(1); } catch { /* Field messages */ }
  }
  const submitting = useRef(false);
  async function create() {
    if (submitting.current || !writable) return;
    submitting.current = true;
    try {
      const values = await form.validateFields();
      setSaving(true); setError('');
      const result = await api.createSnapshot(values);
      try { sessionStorage.removeItem(draftKey); } catch {}
      initialized.current = ''; form.resetFields(); onCreated(result);
    } catch (cause: any) { if (!cause?.errorFields) setError(errorText(cause, '创建交付包失败')); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal title="准备交付包" open={open} width={820} style={{ top: 20 }} styles={{ body: { maxHeight: 'calc(100dvh - 230px)', overflowY: 'auto' } }} onCancel={saving ? undefined : pause} closable={!saving} maskClosable={!saving}
    footer={<Space wrap><Button disabled={saving} onClick={discard}>放弃草稿</Button><Button disabled={saving} onClick={pause}>暂存并关闭</Button>{step > 0 && <Button disabled={saving} onClick={() => setStep(step - 1)}>上一步</Button>}
      {step === 0 ? <Button type="primary" onClick={next}>检查交付材料</Button> : step === 1 ? <Button type="primary" disabled={!check?.ready || checking} onClick={() => setStep(2)}>填写交接说明</Button> : <Button type="primary" loading={saving} disabled={!writable || !check?.ready} onClick={create}>冻结并创建交付包</Button>}</Space>}>
    <Steps size="small" current={step} items={[{ title: '确定范围' }, { title: '检查材料' }, { title: '冻结交接' }]} className="delivery-steps" />
    {draftWarning && <Alert type="warning" message={draftWarning} />}
    {error && <Alert type="error" showIcon title={error} />}
    <Form form={form} layout="vertical" onValuesChange={persist} initialValues={{ purpose: 'development' }}>
      <div hidden={step !== 0}>
        <Form.Item name="title" label="交付标题" rules={[{ required: true, whitespace: true, message: '请填写便于团队识别的标题' }]}><Input placeholder="例如：订单中心 · 第一期研发交接" /></Form.Item>
        <div className="delivery-form-grid">
          <Form.Item name="name" label="交付标识" rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, message: '1–64 位英文、数字、点、横线或下划线' }]}><Input placeholder="orders-s12-handoff-01" /></Form.Item>
          <Form.Item name="purpose" label="交付用途" rules={[{ required: true }]}><Select options={Object.entries(purposeLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        </div>
        <Form.Item name="milestone" label="来源迭代" rules={[{ required: true, message: '请选择来源迭代' }]} extra="按迭代中明确选定的需求和原型版本冻结，不自动改为最新版本。"><Select showSearch optionFilterProp="label" placeholder="选择本次交付范围" options={milestones.map((item: any) => ({ value: item.name, label: `${item.title || item.name} · ${item.name}` }))} /></Form.Item>
        {!milestones.length && <Alert type="info" showIcon title="先建立交付范围" description={<Link to="/milestones" onClick={pause}>前往迭代，关联需求与原型版本</Link>} />}
        <Form.Item name="supersedes" label="接续哪次交付（可选）" extra="需求变更时创建新交付包，保留上次材料以便追溯。"><Select allowClear placeholder="首次交付可不选" options={snapshots.map((item: any) => ({ value: item.name, label: item.title || item.name }))} /></Form.Item>
      </div>
      <div hidden={step !== 1}>
        <div className="delivery-section-head"><h3>材料检查</h3><Button loading={checking} onClick={() => setRefresh(n => n + 1)}>重新检查</Button></div>
        {check && <Alert type={check.ready ? 'success' : 'error'} showIcon title={check.ready ? '范围可冻结，请核对材料内容' : `${check.blockers.length} 个问题需要先处理`} description="版本须已确认且原型存在；技术规格说明书缺失为提醒。文件齐全不等于业务和技术内容已评审通过。" />}
        {[...(check?.blockers || []), ...(check?.warnings || [])].map((item: any, i) => <p key={i} className="delivery-check-message">{item.message}</p>)}
        <List loading={checking} dataSource={check?.items || []} locale={{ emptyText: '选择来源迭代后检查材料' }} renderItem={(item: any) => <List.Item key={`${item.requirement}/${item.project}/${item.version}`}>
          <List.Item.Meta title={`${item.requirement || '未关联需求'} ${item.requirementTitle || ''}`} description={`${item.project} / ${item.version} · ${item.title || ''}`} />
          <Space wrap><Tag color={item.hasSpec ? 'success' : 'warning'}>{item.hasSpec ? '有技术规格说明书' : '缺技术规格说明书'}</Tag><Tag>{item.attachmentCount || 0} 附件</Tag><Link to={contextualRoute(`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.version)}?tab=files`, resumeRoute, "交付准备")} onClick={() => persist(null, form.getFieldsValue(true))}>补充材料</Link></Space>
        </List.Item>} />
      </div>
      <div hidden={step !== 2}>
        <Form.Item name="audience" label="交付给谁"><Input placeholder="例如：订单研发组、测试组、业务验收人" /></Form.Item>
        <Form.Item name="summary" label="本次交付说明"><Input.TextArea rows={3} placeholder="目标、本次范围、不包含的内容，以及相对上次的变化" /></Form.Item>
        <Form.Item name="acceptance" label="验收口径"><Input.TextArea rows={3} placeholder="关键场景、通过标准、验证方式；未确定的规则请注明待确认" /></Form.Item>
        <Form.Item name="risks" label="风险与待确认"><Input.TextArea rows={2} placeholder="依赖、待补文件、开放问题及对应负责人" /></Form.Item>
        <Alert type="info" showIcon title="冻结当前材料，后续变更另建交付" description="保存需求正文、原型、技术规格说明书及本地附件的独立副本。在线链接和原型外部依赖不会自动下载。创建不代表研发接收或测试验收通过。" />
      </div>
    </Form>
  </Modal>;
}
