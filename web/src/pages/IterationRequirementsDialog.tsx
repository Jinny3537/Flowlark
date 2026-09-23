import { Alert, App, Input, Modal, Select } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';

export function IterationRequirementsDialog({ open, item, requirements, onClose, onChanged }: any) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<any>(null);
  useEffect(() => { if (open) { setSelected(item.requirements || []); setReason(''); setError(''); setPlan(null); } }, [open, item]);
  const active = item.status === 'active';
  async function save() {
    setBusy(true); setError('');
    try {
      if (active && !plan) {
        const next = await api.planMilestoneSync(item.name, { scopeRequirements: selected, reason });
        setPlan(next); return;
      }
      if (active) await api.executeMilestoneSync(item.name, { scopeRequirements: selected, reason, planHash: plan.hash, confirmed: true, confirmUnfinished: true });
      else await api.updateMilestone(item.name, { requirements: selected, items: item.items.filter((entry: any) => selected.includes(entry.requirement)) });
      message.success(active ? '需求范围及冲刺任务已更新' : '需求范围已保存，请同步更新对应冲刺'); onClose(); await onChanged();
    } catch (e) { setError(errorText(e, '需求范围更新失败')); }
    finally { setBusy(false); }
  }
  return <Modal title={active ? '变更本轮需求范围' : '关联本轮需求'} open={open} confirmLoading={busy} onCancel={onClose} onOk={() => void save()}
    okText={active ? plan ? '确认变更并同步冲刺' : '查看变更影响' : '保存需求范围'} okButtonProps={{ disabled: !selected.length || (active && !reason.trim()) || !!plan?.blockers?.length }}>
    <p>所属项目：{item.project}。移除需求会同时移除本轮的原型引用，源文件保留。</p>
    <Select mode="multiple" style={{ width: '100%' }} showSearch optionFilterProp="label" value={selected} onChange={v => { setSelected(v); setPlan(null); }}
      options={requirements.filter((r: any) => r.project === item.project).map((r: any) => ({ value: r.code, label: `${r.code} · ${r.title}` }))} placeholder="选择本轮交付需求" />
    {active ? <Input.TextArea style={{ marginTop: 16 }} value={reason} onChange={e => { setReason(e.target.value); setPlan(null); }} placeholder="填写范围变更原因" /> : null}
    {plan ? <Alert style={{ marginTop: 16 }} type={plan.blockers?.length ? 'warning' : 'info'} message={plan.blockers?.length ? plan.blockers.map((b: any) => b.message).join('；') : `创建 ${plan.summary.createTask} 个任务，迁移 ${plan.summary.moveTask} 个任务。确认后同步冲刺并保存需求范围。`} /> : null}
    {error ? <Alert style={{ marginTop: 16 }} type="error" message={error} /> : null}
  </Modal>;
}
