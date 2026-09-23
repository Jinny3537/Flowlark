import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, List, Modal, Radio, Select, Space, Tag } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { api } from '@/services/api';
import { assignmentPreview, contextualRoute, editablePhase, phaseLabels, versionKey } from './workflowModel.js';
import './WorkflowLinks.css';

export default function AssignIterationDialog({ open, onClose, source, writable, onChanged }: {
  open: boolean; onClose: () => void; source: Record<string, string>; writable: boolean; onChanged: () => void;
}) {
  const [form] = Form.useForm();
  const [links, setLinks] = useState<any>(null);
  const [iterations, setIterations] = useState<any[]>([]);
  const [targetName, setTargetName] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [mode, setMode] = useState('');
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<any>(null);
  const submitting = useRef(false);
  const location = useLocation();
  const key = JSON.stringify(source);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLinks(null); setIterations([]); setTargetName(''); setSelectedVersion(''); setSelectedCodes([]); setMode(''); setCreating(false); setReviewing(false); setDone(null); setError(''); setBusy(true); form.resetFields();
    Promise.all([api.workflowLinks(JSON.parse(key)), api.listMilestones()]).then(([nextLinks, nextIterations]) => {
      if (active) { setLinks(nextLinks); setIterations(nextIterations); }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, key, form]);
  const selected = source.requirement
    ? (links?.versions || []).filter((v: any) => versionKey(v) === selectedVersion).map((v: any) => ({ requirement: source.requirement, project: v.project, version: v.version }))
    : selectedCodes.map(requirement => ({ requirement, project: source.project, version: source.version }));
  const target = iterations.find(m => m.name === targetName);
  const preview = assignmentPreview(creating ? [] : target?.items || [], selected, mode || 'append');
  const canReview = selected.length > 0 && (creating || target && editablePhase(target.status)) && (!preview.conflicts.length || !!mode);
  const review = async () => {
    if (creating) { try { await form.validateFields(); } catch { return; } }
    setReviewing(true); setError('');
  };
  const save = async () => {
    if (submitting.current || !writable || !canReview) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = creating ? await api.createMilestone({ ...form.getFieldsValue(), items: selected, contextual: true })
        : await api.assignMilestone(target.name, { items: selected, expectedRevision: target.revision, mode: mode || 'append' });
      setDone(result); onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '安排失败'); setReviewing(false);
      // Keep the user's choices, but refresh the authoritative scope before another review.
      try { setIterations(await api.listMilestones()); } catch { setTargetName(''); }
    } finally { submitting.current = false; setBusy(false); }
  };
  return <Modal title="安排到迭代" open={open} onCancel={busy ? undefined : onClose} width={620} style={{ top: 20 }} styles={{ body: { maxHeight: 'calc(100dvh - 210px)', overflowY: 'auto' } }} footer={done ? <Button onClick={onClose}>留在当前页</Button> : <Space wrap><Button disabled={busy} onClick={onClose}>取消</Button>{reviewing ? <><Button disabled={busy} onClick={() => setReviewing(false)}>返回调整</Button><Button type="primary" disabled={!writable || !canReview} loading={busy} onClick={() => void save()}>确认并加入</Button></> : <Button type="primary" disabled={!writable || !canReview || busy} onClick={() => void review()}>核对范围</Button>}</Space>}>
    {error && <Alert type="error" message={error} />}
    {done ? <Alert type="success" showIcon message={`已安排到 ${done.title || done.name}`} description={<><p>{selected.map(x => `${x.requirement} · ${x.project} / ${x.version}`).join('；')}</p><Link to={contextualRoute(`/milestones/${encodeURIComponent(done.name)}`, location.pathname + location.search, source.requirement ? `需求 ${source.requirement}` : `${source.project} / ${source.version}`)} onClick={onClose}>查看迭代</Link></>} /> : <>
      <p>将本次需求与原型组织到一起。加入的是候选范围，采用版本仍通过现有迭代流程确认。</p>
      <div hidden={reviewing}>
        {source.requirement ? <label>候选归档版本<Select aria-label="候选归档版本" style={{ width: '100%', marginBottom: 12 }} value={selectedVersion || undefined} onChange={v => { setSelectedVersion(v); setMode(''); }} options={(links?.versions || []).filter((v: any) => v.status !== 'VOID').map((v: any) => ({ value: versionKey(v), label: `${v.project} / ${v.version}` }))} /></label>
          : <><p><strong>当前原型：{source.project} / {source.version}</strong></p><label>本次需求<Select mode="multiple" aria-label="本次需求" style={{ width: '100%', marginBottom: 12 }} value={selectedCodes} onChange={v => { setSelectedCodes(v); setMode(''); }} options={(links?.requirements || []).filter((r: any) => !r.missing && !r.deletedAt).map((r: any) => ({ value: r.code, label: `${r.code} · ${r.title || ''}` }))} /></label></>}
        {links && !(source.requirement ? links.versions.length : links.requirements.filter((r: any) => !r.missing && !r.deletedAt).length) && <Alert type="info" message="请先关联需求与归档原型，再安排到迭代" />}
        <Radio.Group value={creating} onChange={e => { setCreating(e.target.value); setMode(''); }} style={{ marginBottom: 12 }}><Radio value={false}>已有迭代</Radio><Radio value={true}>新建迭代并加入</Radio></Radio.Group>
        {!creating ? <><label>目标迭代<Select aria-label="目标迭代" loading={busy} style={{ width: '100%' }} value={targetName || undefined} onChange={v => { setTargetName(v); setMode(''); }} options={iterations.map(m => ({ value: m.name, label: m.title || m.name, disabled: !editablePhase(m.status), title: `${phaseLabels[m.status]}${editablePhase(m.status) ? '' : '，请从迭代处理范围变更'}` }))} /></label>
          {!busy && !iterations.length && <p>还没有迭代，可选择“新建迭代并加入”。</p>}
          {iterations.some(m => !editablePhase(m.status)) && <details><summary>查看不可直接加入的迭代</summary>{iterations.filter(m => !editablePhase(m.status)).map(m => <p key={m.name}><Link to={contextualRoute(`/milestones/${encodeURIComponent(m.name)}`, location.pathname + location.search, '安排来源')}>{m.title}</Link> · {phaseLabels[m.status]}，请按现有生命周期处理范围。</p>)}</details>}
        </> : <Form form={form} layout="vertical"><Form.Item name="name" label="迭代标识" rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, message: '填写 1–64 位英文、数字、点、横线或下划线' }]}><Input placeholder="2026-S12" /></Form.Item><Form.Item name="title" label="迭代标题"><Input /></Form.Item><Space wrap><Form.Item name="startAt" label="开始日期"><Input type="date" /></Form.Item><Form.Item name="endAt" label="结束日期"><Input type="date" /></Form.Item></Space></Form>}
        {!!preview.conflicts.length && <Alert style={{ marginTop: 12 }} type="warning" message="该需求在此项目已有其他候选版本" description={<><p>规划期可保留多个候选；冻结前仍需按现有规则明确单一版本。</p><p>{preview.conflicts.map(x => `${x.requirement} · ${x.project} / ${x.version}`).join('；')}</p><Radio.Group value={mode} onChange={e => setMode(e.target.value)}><Space direction="vertical"><Radio value="append">保留原版本，并加入本次版本</Radio><Radio value="replace">替换所选需求在该项目的原候选版本</Radio></Space></Radio.Group></>} />}
      </div>
      {reviewing && <div className="fl-assignment-preview"><strong>{creating ? `新建：${form.getFieldValue('title') || form.getFieldValue('name')}` : `目标：${target?.title || targetName}`}</strong><List size="small" dataSource={selected} renderItem={(x: any) => <List.Item>{x.requirement} · {x.project} / {x.version}<Tag>{preview.duplicate.some(d => d.requirement === x.requirement && d.project === x.project && d.version === x.version) ? '已在范围中' : '加入候选'}</Tag></List.Item>} />{!!preview.conflicts.length && <p>{mode === 'replace' ? '将替换' : '将保留'}：{preview.conflicts.map(x => `${x.requirement} ${x.project}/${x.version}`).join('；')}</p>}<p>确认后共 {preview.items.length} 条需求与原型映射。其他需求的范围保留。</p></div>}
    </>}
  </Modal>;
}
