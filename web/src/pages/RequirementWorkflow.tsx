import { useState } from 'react';
import { Alert, App, Button, Form, Input, List, Modal, Select, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useTeamAccess } from '@/runtime/TeamAccess';
import { TeamRecords } from './workbench/TeamRecords';
import { PrototypeLink } from './RequirementPrototypeButton';

const phase: Record<string, string> = { planning: '规划中', reviewing: '评审中', frozen: '已冻结', active: '进行中', delivered: '已交付', archived: '已归档', canceled: '已取消' };
export function RequirementActions({ item, writable, onChanged }: { item: any; writable: boolean; onChanged: () => void }) {
  const { modal, message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const run = async (action: string) => {
    setBusy(true);
    try { await api.requirementLifecycle(item.code, action); message.success('需求已更新'); onChanged(); }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const impact = await api.requirementImpact(item.code);
      modal.confirm({ title: `删除需求 ${item.code}？`, okText: '移入回收站', cancelText: '取消', okButtonProps: { danger: true, disabled: !impact.canDelete },
        content: <div><p>关联 {impact.versions.length} 个原型版本、{impact.milestones.length} 个迭代、{impact.externalTasks.length} 个研发任务。原型文件与历史记录保留。</p>
          {impact.milestones.map((m: any) => <p key={m.name}>{m.title} · {phase[m.status] || m.status}</p>)}
          {impact.external ? <p>只删除本地副本，后续同步将跳过此需求；恢复后可继续同步。</p> : null}
          {!impact.canDelete ? <Alert type="warning" message="已冻结或进行中的迭代仍在引用，请先在迭代中调整范围；也可归档需求。" /> : null}</div>,
        onOk: () => run('delete') });
    } catch (e) { message.error(e instanceof Error ? e.message : '无法检查关联影响'); }
    finally { setBusy(false); }
  };
  return <Space wrap>{item.deletedAt ? <Button disabled={!writable} loading={busy} onClick={() => void run('restore')}>恢复需求</Button> : <>
    <Button disabled={!writable || busy} onClick={() => void run(item.archivedAt ? 'unarchive' : 'archive')}>{item.archivedAt ? '取消归档' : '归档需求'}</Button>
    <Button danger disabled={!writable || busy} onClick={() => void remove()}>删除需求</Button></>}</Space>;
}

export default function RequirementWorkflow({ item, writable, onChanged }: { item: any; writable: boolean; onChanged: () => void }) {
  const { session } = useTeamAccess();
  const { message, modal } = App.useApp();
  const [linkOpen, setLinkOpen] = useState(false);
  const [iterationOpen, setIterationOpen] = useState(false);
  const [iterations, setIterations] = useState<any[]>([]);
  const [iterationName, setIterationName] = useState('');
  const [iterationVersion, setIterationVersion] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recordVersion, setRecordVersion] = useState('');
  const editable = writable && !item.deletedAt;
  const current = (item.versions || []).find((v: any) => `${v.project}/${v.versionNo}` === recordVersion);
  const openIteration = async () => {
    setBusy(true); setError('');
    try { setIterations(await api.listMilestones()); setIterationName(''); setIterationVersion(''); setIterationOpen(true); }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取迭代'); }
    finally { setBusy(false); }
  };
  const assignIteration = async () => {
    const target = iterations.find(m => m.name === iterationName);
    const version = item.versions.find((v: any) => `${v.project}/${v.versionNo}` === iterationVersion);
    if (!target || !version) return;
    setBusy(true);
    try {
      const latest = await api.getMilestone(target.name);
      if (latest.updatedAt !== target.updatedAt) throw new Error('迭代范围已变化，请重新打开排期窗口');
      await api.updateMilestone(target.name, { items: [...latest.items.filter((entry: any) => !(entry.requirement === item.code && entry.project === version.project)), { requirement: item.code, project: version.project, version: version.versionNo }] });
      setIterationOpen(false); onChanged(); message.success('已更新候选范围，请在迭代中评审并冻结采用版本');
    } catch (e) { setError(e instanceof Error ? e.message : '更新迭代失败'); }
    finally { setBusy(false); }
  };
  const openLink = async () => {
    setError(''); setBusy(true);
    try { setProjects(await api.listProjects()); setVersions([]); form.resetFields(); setLinkOpen(true); }
    catch (e) { setError(e instanceof Error ? e.message : '无法读取项目'); }
    finally { setBusy(false); }
  };
  const link = async () => {
    let values; try { values = await form.validateFields(); } catch { return; }
    setBusy(true);
    try { await api.linkRequirement(item.code, values); setLinkOpen(false); onChanged(); message.success('已关联归档版本'); }
    catch (e) { setError(e instanceof Error ? e.message : '关联失败'); }
    finally { setBusy(false); }
  };
  const unlink = (v: any) => modal.confirm({ title: `解除 ${v.project}/${v.versionNo} 的关联？`, content: '仅移除需求与版本的关系，保留原型文件；已锁定的版本或已采用的迭代依据不能直接解除。', onOk: async () => {
    try { await api.unlinkRequirement(item.code, v.project, v.versionNo); onChanged(); }
    catch (e) { message.error(e instanceof Error ? e.message : '解除失败'); }
  } });
  const promote = async (draft: any) => {
    setBusy(true);
    try { await api.addTeamRecord(draft.project, draft.version, { kind: 'comment', content: `${draft.title}\n${draft.description}`, requirement: item.code, feedbackId: draft.id, outcome: 'open' }); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : '转为协作问题失败'); }
    finally { setBusy(false); }
  };
  const roleCopy: Record<string, string> = {
    product: '归档外部修改后的原型，关联需求并说明变化；在迭代中明确采用版本，处理团队反馈。',
    developer: '先核对本次迭代采用版本，再查看业务规则与变更；在对应版本记录问题和开发进展。',
    tester: '按本次采用版本和验收标准检查；问题与验收结果保留到具体需求和版本。',
    guest: '查看需求、归档原型与协作进展；团队模式开启时可以提交评论。'
  };
  return <div className="fl-detail-stack">
    <Alert type="info" showIcon message={roleCopy[session?.role || 'guest']} />
    {error ? <Alert type="error" message={error} closable onClose={() => setError('')} /> : null}
    {item.deletedAt ? <Alert type="warning" message="需求已在回收站，历史引用保留；恢复后可继续编辑和同步。" /> : item.archivedAt ? <Alert type="info" message="需求已归档，不影响历史版本与同步。" /> : null}
    <Space wrap>
      {item.pending?.missingPrototype ? <Tag color="orange">待关联原型</Tag> : null}
      {item.pending?.missingAcceptance ? <Tag color="orange">待补充验收标准</Tag> : null}
      {item.pending?.unresolved ? <Tag color="orange">{item.pending.unresolved} 个问题待确认</Tag> : null}
      {item.pending?.newerArchive ? <Tag color="blue">有新归档，开发依据未变</Tag> : null}
    </Space>
    <section className="fl-detail-section"><h2>本次开发依据</h2>
      <p className="fl-muted">采用版本来自迭代明确保存的范围。归档新版或切换项目基线均不会自动替换；请进入对应迭代调整范围。</p>
      <List dataSource={item.milestones || []} locale={{ emptyText: '尚未安排迭代，开发依据未确定。请在迭代中加入该需求及归档版本。' }} renderItem={(m: any) => <List.Item>
        <Space direction="vertical"><Space><Link to={`/milestones/${encodeURIComponent(m.name)}`}>{m.title}</Link><Tag>{phase[m.status] || m.status}</Tag></Space>
          {m.items.map((entry: any) => <Space wrap key={`${entry.project}/${entry.version}`}><strong>{entry.project} / {entry.version}</strong>
            <Tag>{['frozen', 'active', 'delivered', 'archived'].includes(m.status) ? '采用版本' : '候选范围'}</Tag>
            {entry.missing ? <Tag color="error">归档文件缺失</Tag> : <PrototypeLink project={entry.project} versionNo={entry.version} code={item.code} />}</Space>)}
        </Space>
      </List.Item>} />
      <Space wrap><Button disabled={!editable || !item.versions?.length} loading={busy} onClick={() => void openIteration()}>安排到迭代</Button><Link to="/milestones">管理迭代与采用范围</Link></Space>
    </section>
    <section className="fl-detail-section"><Space wrap><h2>归档原型与变更</h2><Button disabled={!editable} loading={busy} onClick={() => void openLink()}>关联已有归档</Button></Space>
      <p className="fl-muted">在项目中导入外部制作完成的原型。归档时可一并选择需求、填写页面位置与承载范围。</p>
      <List dataSource={[...(item.versions || [])].reverse()} locale={{ emptyText: '尚未关联归档版本' }} renderItem={(v: any) => <List.Item>
        <Space direction="vertical" style={{ width: '100%' }}><Space wrap><strong>{v.project} / {v.versionNo} · {v.title}</strong>
          {item.latest?.some((x: any) => x.project === v.project && x.versionNo === v.versionNo) ? <Tag>最新归档</Tag> : null}
          {v.isBaseline ? <Tag>项目当前基线</Tag> : null}{v.status === 'VOID' ? <Tag color="error">已废弃</Tag> : null}
        </Space><Typography.Text>页面位置：{v.coverage?.location || '待补充'}</Typography.Text><Typography.Text>承载范围：{v.coverage?.scope || '待补充'}</Typography.Text>
          {(v.changes || []).map((change: any, i: number) => <div key={i}>{change.location}：{change.content}</div>)}
          <Space wrap><PrototypeLink project={v.project} versionNo={v.versionNo} code={item.code} />
            <Button onClick={() => setRecordVersion(`${v.project}/${v.versionNo}`)}>查看 / 提交协作记录</Button>
            {editable ? <Button type="text" onClick={() => unlink(v)}>解除关联</Button> : null}</Space>
        </Space>
      </List.Item>} />
    </section>
    <section className="fl-detail-section"><h2>反馈与角色协作</h2>
      <List dataSource={item.questions || []} locale={{ emptyText: '暂无需求关联的问题' }} renderItem={(q: any) => <List.Item>
        <Space direction="vertical"><Space><Tag>{q.state === 'confirmed' ? '已确认解决' : q.state === 'resolved' ? '待确认处理结果' : '待处理'}</Tag><span>{q.project} / {q.versionNo}</span></Space>
          <span style={{ whiteSpace: 'pre-wrap' }}>{q.content}</span><span className="fl-muted">{q.replies.length} 条处理 / 回复</span>
          <Button onClick={() => setRecordVersion(`${q.project}/${q.versionNo}`)}>查看并回复</Button></Space>
      </List.Item>} />
      <List dataSource={item.feedbacks || []} locale={{ emptyText: '暂无本机标注反馈草稿' }} renderItem={(draft: any) => <List.Item>
        <Space direction="vertical"><strong>{draft.title}</strong><span>{draft.project} / {draft.version} · {draft.description}</span>
          <Button disabled={!editable || busy || item.records?.some((r: any) => r.sourceFeedback?.id === draft.id)} onClick={() => void promote(draft)}>转为可追踪协作问题</Button></Space>
      </List.Item>} />
      <label>选择协作版本<Select aria-label="选择协作版本" style={{ width: '100%' }} value={recordVersion || undefined} placeholder="选择要讨论或验收的归档版本" options={(item.versions || []).map((v: any) => ({ value: `${v.project}/${v.versionNo}`, label: `${v.project} / ${v.versionNo}` }))} onChange={setRecordVersion} /></label>
      {current ? <TeamRecords key={`${item.code}/${recordVersion}`} slug={current.project} versionNo={current.versionNo} requirement={item.code} onChanged={onChanged} /> : null}
    </section>
    <section className="fl-detail-section"><h2>研发任务与验收记录</h2>
      <List dataSource={item.externalTasks || []} locale={{ emptyText: '暂无关联研发任务，可在迭代同步中建立关联' }} renderItem={(task: any) => <List.Item><span>{task.provider} · 任务 {task.taskId} · 远端状态 {String(task.remoteStatus ?? '未知')} · 同步于 {task.syncedAt || '未知'}</span></List.Item>} />
      <List dataSource={(item.records || []).filter((r: any) => ['progress', 'acceptance'].includes(r.kind))} locale={{ emptyText: '暂无开发进度或验收结果，原型确认不代表研发完成或上线' }} renderItem={(r: any) => <List.Item><span>{r.kind === 'acceptance' ? '验收' : '研发'} · {r.project}/{r.versionNo} · {r.outcome || '记录'} · {r.content}</span></List.Item>} />
    </section>
    <Modal title="安排到迭代" open={iterationOpen} onCancel={() => setIterationOpen(false)} onOk={() => void assignIteration()} confirmLoading={busy} okButtonProps={{ disabled: !iterationName || !iterationVersion }}>
      <p>仅能直接调整规划中或评审中的迭代。冻结后需按已有生命周期处理；进行中请进入迭代执行范围变更。</p>
      {error ? <Alert type="error" message={error} /> : null}
      <Space direction="vertical" style={{ width: '100%' }}>
        <label>目标迭代<Select aria-label="目标迭代" style={{ width: '100%' }} value={iterationName || undefined} options={iterations.filter(m => ['planning', 'reviewing'].includes(m.status)).map(m => ({ value: m.name, label: m.title }))} onChange={setIterationName} /></label>
        <label>候选归档版本<Select aria-label="候选归档版本" style={{ width: '100%' }} value={iterationVersion || undefined} options={(item.versions || []).filter((v: any) => v.status !== 'VOID').map((v: any) => ({ value: `${v.project}/${v.versionNo}`, label: `${v.project} / ${v.versionNo}` }))} onChange={setIterationVersion} /></label>
        {iterations.find(m => m.name === iterationName)?.items.filter((entry: any) => entry.requirement === item.code).map((entry: any) => <p key={`${entry.project}/${entry.version}`}>当前范围：{entry.project} / {entry.version}。确认将替换该需求在所选项目的候选版本。</p>)}
      </Space>
    </Modal>
    <Modal title="关联归档原型" open={linkOpen} onCancel={() => setLinkOpen(false)} onOk={() => void link()} confirmLoading={busy}>
      <p>已有基线锁定规则继续生效。请在项目中归档新版本，再关联本次变更。</p>
      {error ? <Alert type="error" message={error} /> : null}
      <Form form={form} layout="vertical">
        <Form.Item name="project" label="项目" rules={[{ required: true }]}><Select options={projects.map(p => ({ value: p.slug, label: p.name }))} onChange={async value => {
          setVersions([]); form.setFieldValue('versionNo', undefined);
          try { setVersions(await api.listVersions(value)); } catch (e) { setError(e instanceof Error ? e.message : '读取版本失败'); }
        }} /></Form.Item>
        <Form.Item name="versionNo" label="归档版本" rules={[{ required: true }]}><Select options={versions.map(v => ({ value: v.versionNo, label: `${v.versionNo} · ${v.title}` }))} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
