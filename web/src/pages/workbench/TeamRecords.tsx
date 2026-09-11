import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, List, Select, Space, Tag, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/services/api';
import { roleLabels, useTeamAccess } from '@/runtime/TeamAccess';

const labels: Record<string, string> = { comment: '问题 / 回复', progress: '开发进度', issue: '测试问题', acceptance: '验收结果' };
const outcomes: Record<string, string> = { open: '待处理', resolved: '已在归档版本处理', confirmed: '已确认解决', reopened: '仍有问题', in_progress: '开发中', completed: '开发完成', acknowledged: '已确认开发依据', passed: '验收通过', failed: '验收不通过' };
export function TeamRecords({ slug, versionNo, requirement: fixedRequirement, onChanged }: { slug: string; versionNo: string; requirement?: string; onChanged?: () => void }) {
  const { session } = useTeamAccess();
  const [params] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [requirement, setRequirement] = useState(fixedRequirement || params.get('requirement') || '');
  const [kind, setKind] = useState('comment');
  const [content, setContent] = useState('');
  const [outcome, setOutcome] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [resolutionVersion, setResolutionVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [locked, setLocked] = useState(false);
  const kinds = session?.kinds || [];
  useEffect(() => {
    setKind(kinds.includes(params.get('kind') || '') ? params.get('kind')! : kinds[0] || 'comment');
    setContent(''); setOutcome(''); setReplyTo(''); setResolutionVersion(''); setSaved(false);
  }, [slug, versionNo, session?.role, kinds.join(',')]);
  useEffect(() => { setRequirement(fixedRequirement || params.get('requirement') || ''); }, [fixedRequirement, slug, versionNo]);
  const load = useCallback(async () => {
    try {
      const version: any = await api.getVersion(slug, versionNo);
      setRequirements(version.requirements || []);
      if (requirement) {
        const req = await api.getRequirement(requirement);
        setLocked(!!req.deletedAt); setItems(req.records || []); setVersions((req.versions || []).filter((v: any) => v.project === slug && v.status !== 'VOID'));
      } else { setLocked(false); setItems(await api.teamRecords(slug, versionNo)); setVersions([]); }
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '无法读取记录'); }
  }, [slug, versionNo, requirement]);
  useEffect(() => { if (session?.role) void load(); }, [load, session?.role]);
  const choices = kind === 'progress' ? ['acknowledged', 'in_progress', 'completed'] : kind === 'acceptance' ? ['passed', 'failed']
    : session?.role === 'product' ? ['open', 'resolved', 'reopened'] : ['developer', 'tester'].includes(session?.role || '') ? ['open', 'confirmed', 'reopened'] : ['open'];
  const submit = async () => {
    setBusy(true); setSaved(false);
    try {
      await api.addTeamRecord(slug, versionNo, { kind, content, requirement, outcome, replyTo, resolutionVersion });
      setContent(''); setOutcome(''); setReplyTo(''); setResolutionVersion(''); await load(); setSaved(true); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败'); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Typography.Text strong>协作记录 · {slug} / {versionNo}</Typography.Text>
    <Typography.Text type="secondary">原型在外部修改后重新归档。记录保留具体版本，不自动改变开发依据或上线状态。操作者为浏览器协作身份。</Typography.Text>
    {error ? <Alert type="error" showIcon message={error} /> : null}
    {saved ? <Alert type="success" showIcon message="记录已保存到主机" /> : null}
    {kinds.length && !locked ? <>
      <label>对应需求<Select aria-label="对应需求" style={{ width: '100%' }} value={requirement || undefined} disabled={!!fixedRequirement} allowClear={!fixedRequirement} placeholder="选择本版本关联需求" options={requirements.filter(r => !r.deletedAt).map(r => ({ value: r.code, label: `${r.code} · ${r.title}` }))} onChange={value => { setRequirement(value || ''); setReplyTo(''); setOutcome(''); }} /></label>
      <label>记录类型<Select aria-label="记录类型" style={{ width: '100%' }} value={kind} options={kinds.map(value => ({ value, label: labels[value] }))} onChange={value => { setKind(value); setOutcome(''); }} /></label>
      <label>回复问题（可选）<Select aria-label="回复问题" style={{ width: '100%' }} value={replyTo || undefined} allowClear options={items.filter(i => !i.replyTo && i.project === slug && i.requirement === requirement && ['comment', 'issue'].includes(i.kind)).map(i => ({ value: i.id, label: `${i.versionNo} · ${i.content.slice(0, 80)}` }))} onChange={value => { setReplyTo(value || ''); setOutcome(''); }} /></label>
      <label>处理结果<Select aria-label="处理结果" style={{ width: '100%' }} value={outcome || undefined} allowClear placeholder="选择结果" options={choices.filter(value => replyTo || !['resolved', 'confirmed', 'reopened'].includes(value)).map(value => ({ value, label: outcomes[value] }))} onChange={value => setOutcome(value || '')} /></label>
      {outcome === 'resolved' ? <label>处理后的归档版本<Select aria-label="处理后的归档版本" style={{ width: '100%' }} value={resolutionVersion || undefined} options={versions.map(v => ({ value: v.versionNo, label: `${v.versionNo} · ${v.title}` }))} onChange={setResolutionVersion} /></label> : null}
      <label>内容<Input.TextArea aria-label="内容" value={content} maxLength={10000} showCount autoSize={{ minRows: 3, maxRows: 9 }} onChange={event => { setContent(event.target.value); setSaved(false); }} /></label>
      <Button type="primary" loading={busy} disabled={!content.trim() || (outcome === 'resolved' && !resolutionVersion)} onClick={() => void submit()}>提交{labels[kind]}</Button>
    </> : null}
    <Button onClick={() => void load()}>刷新记录</Button>
    <List dataSource={items} locale={{ emptyText: '暂无协作记录' }} renderItem={item => <List.Item>
      <div style={{ width: '100%' }}><Space wrap><Tag>{labels[item.kind]}</Tag>{item.outcome ? <Tag>{outcomes[item.outcome]}</Tag> : null}
        <Typography.Text>{roleLabels[item.role]} · {item.visitorId === 'host' ? '主机' : item.visitorId?.slice(0, 8)}</Typography.Text>
        <Link to={`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}?tab=team`}>{item.project} / {item.versionNo}</Link>
        <Typography.Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Typography.Text></Space>
        {item.replyTo ? <p className="fl-muted">回复：{items.find(i => i.id === item.replyTo)?.content || item.replyTo}</p> : null}
        {item.requirement ? <Link to={`/requirements/${encodeURIComponent(item.requirement)}`}>{item.requirement}</Link> : null}
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</p>
        {item.resolutionVersion ? <Link to={`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.resolutionVersion)}?tab=reqs`}>查看处理版本 {item.resolutionVersion}</Link> : null}
      </div>
    </List.Item>} />
  </Space>;
}
