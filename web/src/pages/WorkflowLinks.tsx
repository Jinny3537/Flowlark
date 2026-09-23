import { useEffect, useState } from 'react';
import { Alert, Button, List, Popover, Space, Spin, Tag } from 'antd';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '@/services/api';
import { contextualRoute, phaseLabels, safeReturn, scopeLabel } from './workflowModel.js';
import './WorkflowLinks.css';

export function SourceContext() {
  const [params] = useSearchParams();
  const returnTo = safeReturn(params.get('returnTo'));
  return returnTo ? <div className="fl-workflow-source"><span>来自：{params.get('from') || '关联页面'}</span><Link to={returnTo}>返回{params.get('from') || '来源页面'}</Link></div> : null;
}

export function useWorkflowLinks(query: Record<string, string>, refresh?: unknown) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<{ data: any; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ data: null, error: '', loading: true });
    api.workflowLinks(JSON.parse(key)).then(data => { if (active) setState({ data, error: '', loading: false }); })
      .catch(error => { if (active) setState({ data: null, error: error.message || '关联读取失败', loading: false }); });
    return () => { active = false; };
  }, [key, refresh, retry]);
  return { ...state, reload: () => setRetry(n => n + 1) };
}

export default function WorkflowLinks({ query, refresh, actions }: { query: Record<string, string>; refresh?: unknown; actions?: React.ReactNode }) {
  const { data, loading, error, reload } = useWorkflowLinks(query, refresh);
  const location = useLocation();
  const source = location.pathname + location.search;
  const label = query.requirement ? `需求 ${query.requirement}` : query.milestone ? `迭代 ${query.milestone}` : `${query.project} / ${query.version}`;
  const route = (target: string) => contextualRoute(target, source, label);
  const sectionRoute = (section: string) => {
    const params = new URLSearchParams(location.search); params.set('tab', 'workflow'); params.set('section', section);
    return `${location.pathname}?${params}`;
  };
  if (error) return <Alert type="warning" showIcon message="关联信息读取失败" description={error} action={<Button onClick={reload}>重试关联</Button>} />;
  return <section className="fl-workflow-links" aria-label="功能关联">
    <Space wrap size={[8, 6]}><strong>关联去向</strong>{loading ? <Spin size="small" /> : <>
      {!query.requirement && <Popover trigger="click" title="关联需求" content={<List size="small" className="fl-workflow-popover" dataSource={data?.requirements || []} locale={{ emptyText: '尚未关联需求' }} renderItem={(r: any) => <List.Item>{r.missing ? <span>{r.code} · 需求缺失</span> : <Link to={route(`/requirements/${encodeURIComponent(r.code)}`)}>{r.code} · {r.title}{r.deletedAt ? '（回收站）' : ''}</Link>}</List.Item>} />}><Button size="small">需求 {data?.requirements.length || 0}</Button></Popover>}
      {!!query.requirement && <Popover trigger="click" title={<Space wrap>关联原型<Link to={sectionRoute("archives")}>在本页查看</Link></Space>} content={<List size="small" className="fl-workflow-popover" dataSource={data?.versions || []} locale={{ emptyText: '尚未关联归档原型' }} renderItem={(v: any) => <List.Item><Link to={route(`/projects/${encodeURIComponent(v.project)}/versions/${encodeURIComponent(v.version)}`)}>{v.project} / {v.version} · {v.title}{v.status === 'VOID' ? '（已废弃）' : ''}</Link></List.Item>} />}><Button size="small">原型 {data?.versions.length || 0}</Button></Popover>}
      <Popover trigger="click" title={<Space wrap>候选与采用迭代{query.requirement && <Link to={sectionRoute("iterations")}>在本页查看</Link>}</Space>} content={<List size="small" className="fl-workflow-popover" dataSource={data?.milestones || []} locale={{ emptyText: '尚未安排迭代' }} renderItem={(m: any) => <List.Item><div><Link to={route(`/milestones/${encodeURIComponent(m.name)}`)}>{m.title || m.name}</Link><p><Tag>{phaseLabels[m.status] || m.status}</Tag>{scopeLabel(m.status)}</p>{m.items.map((x: any, i: number) => <div key={i}>{x.project} / {x.version}{x.missing ? '（归档缺失）' : ''}</div>)}</div></List.Item>} />}><Button size="small">迭代 {data?.milestones.length || 0}</Button></Popover>
      <Popover trigger="click" title="相关交付" content={<List size="small" className="fl-workflow-popover" dataSource={data?.deliveries || []} locale={{ emptyText: '暂无明确关联的交付' }} renderItem={(d: any) => <List.Item><Link to={route(`/deliveries/${encodeURIComponent(d.name)}`)}>{d.title || d.name}{d.schemaVersion !== 2 ? '（旧版范围引用）' : ''}</Link></List.Item>} />}><Button size="small">交付 {data?.deliveries.length || 0}</Button></Popover>
      {data?.newerArchive && <Link to={route(`/projects/${encodeURIComponent(query.project)}/versions/${encodeURIComponent(data.newerArchive.version)}`)}>有新归档 {data.newerArchive.version}{data.milestones.length ? '，迭代范围未变' : ''}</Link>}
    </>}{actions}</Space>
  </section>;
}

export function MilestoneDeliveries({ name }: { name: string }) {
  const { data, error, loading, reload } = useWorkflowLinks({ milestone: name });
  const location = useLocation();
  return <section className="fl-detail-section"><h2>本迭代交付</h2>
    {error ? <Alert type="warning" message={error} action={<Button onClick={reload}>重试</Button>} /> : <List loading={loading} dataSource={data?.deliveries || []} locale={{ emptyText: '尚未准备交付包。核对本次需求与原型后，使用“准备交付包”。' }} renderItem={(d: any) => <List.Item><Link to={contextualRoute(`/deliveries/${encodeURIComponent(d.name)}`, location.pathname + location.search, `迭代 ${name}`)}>{d.title || d.name}</Link><Tag>{d.schemaVersion === 2 ? '材料已冻结' : '旧版范围引用'}</Tag></List.Item>} />}
  </section>;
}
