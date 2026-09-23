import { contextualRoute } from './workflowModel.js';
import { SourceContext } from './WorkflowLinks';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Alert, App, Button, Descriptions, List, Space, Tabs, Tag } from 'antd';
import { DownloadOutlined, LinkOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime, fmtSize, textOf } from '@/utils/format';
import { purposeLabels } from './delivery/DeliveryComposer';
import './delivery/Delivery.css';

const fileKinds: Record<string, string> = { prototype: '产品原型', spec: '技术规格说明书', requirement: '需求文档', attachment: '附件', metadata: '版本信息' };
export default function DeliveryDetail() {
  const { name = '' } = useParams();
  const location = useLocation();
  const linked = (target: string) => contextualRoute(target, location.pathname + location.search, `交付 ${name}`);
  const { message } = App.useApp();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [kind, setKind] = useState('all');
  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true); setError(''); setItem(null);
    try { setItem(await api.getSnapshot(name)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取交付包'); }
    finally { setLoading(false); }
  }, [name]);
  useEffect(() => { void load(); }, [load]);
  async function download(relative?: string) {
    setDownloading(relative || 'package');
    try {
      const response = await fetch(`/api/snapshots/${encodeURIComponent(name)}/${relative ? `file?path=${encodeURIComponent(relative)}` : 'download'}`);
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || '下载失败'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = relative?.split('/').pop() || `${name}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '下载失败'); }
    finally { setDownloading(''); }
  }
  const frozen = item?.schemaVersion === 2;
  const versions = item?.versions || item?.items || [];
  const files = item?.files || [];
  return <main className="fl-page">
    <SourceContext />
    <PageHeader eyebrow={purposeLabels[item?.purpose] || '历史交付快照'} title={item?.title || name} backTo="/deliveries"
      description={frozen ? '需求、原型与技术文件已固定在本次交付中。请按此材料沟通和追溯。' : '历史快照保留版本范围，不包含当时的完整材料副本。'}
      actions={<Space wrap>{item?.milestone && <Link to={`/milestones/${encodeURIComponent(item.milestone)}`}>返回来源迭代</Link>}<Button icon={<LinkOutlined />} onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); message.success('交付地址已复制'); } catch { message.error('复制失败，请复制浏览器地址'); } }}>复制交付地址</Button><Button type="primary" icon={<DownloadOutlined />} disabled={!frozen || Boolean(downloading)} loading={downloading === 'package'} onClick={() => download()}>下载完整交付包</Button></Space>} />
    <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到交付包">
      <div className="fl-detail-stack">
        {!frozen && <Alert type="warning" showIcon title="旧快照仅保存版本引用" description="无法证明源技术规格说明书和附件与交付当时一致。如需完整固定材料，请新建交付包。" />}
        <section className="fl-detail-summary">
          <Descriptions column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="交付名称">{textOf(item?.title)}</Descriptions.Item>
              <Descriptions.Item label="交付标识"><span className="fl-mono">{name}</span></Descriptions.Item>
            <Descriptions.Item label="材料状态"><Tag color={frozen ? 'success' : 'warning'}>{frozen ? '材料已冻结' : '仅版本引用'}</Tag></Descriptions.Item>
            <Descriptions.Item label="创建人">{textOf(item?.createdBy)}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{fmtTime(item?.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="交付对象">{item?.audience || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="来源迭代">{item?.milestone ? <Link to={linked(`/milestones/${encodeURIComponent(item.milestone)}`)}>{item.milestone}</Link> : '手动选择版本'}</Descriptions.Item>
            {item?.supersedes && <Descriptions.Item label="上次交付"><Link to={`/deliveries/${encodeURIComponent(item.supersedes)}`}>{item.supersedes}</Link></Descriptions.Item>}
          </Descriptions>
        </section>
        <section className="fl-detail-section delivery-table">
          <Tabs items={[
            { key: 'handoff', label: '交接说明', children: <>
              <div className="delivery-guide"><div><b>产品 / 讲清范围</b><p>确认业务规则、版本变化和待确认事项。</p></div><div><b>研发 / 对照实现</b><p>按需求、原型、技术规格说明书和接口附件阅读；在源版本团队协作中记录进展。</p></div><div><b>测试 / 记录结果</b><p>依据验收口径核对场景；在源版本记录测试结果。冻结材料不代表验收通过。</p></div></div>
              {[['本次交付说明', item?.summary], ['验收口径', item?.acceptance], ['风险与待确认', item?.risks]].map(([label, value]) => <div key={label}><h3>{label}</h3><p className="delivery-text">{value || '未填写，请与产品确认'}</p></div>)}
              {!!item?.warnings?.length && <Alert type="warning" showIcon title="冻结时的材料提示" description={item.warnings.map((entry: any, i: number) => <div key={i}>{entry.message}</div>)} />}
            </> },
            { key: 'requirements', label: `需求范围 (${item?.requirements?.length ?? new Set((item?.items || []).map((entry: any) => entry.requirement).filter(Boolean)).size})`, children: <List locale={{ emptyText: frozen ? '本次未关联需求，请参考交接说明' : '旧快照未保存需求正文，请查阅版本范围' }} dataSource={item?.requirements || []} renderItem={(entry: any) => <List.Item><List.Item.Meta title={`${entry.code} · ${entry.title}`} description={<div className="delivery-text">{entry.description || '未填写需求描述'}<br />负责人：{entry.owner || '未填写'}</div>} /><Tag>冻结时内容</Tag></List.Item>} /> },
            { key: 'versions', label: `原型版本 (${versions.length})`, children: <List dataSource={versions} renderItem={(entry: any) => <List.Item>
              <List.Item.Meta title={`${entry.project} / ${entry.version || entry.versionNo || entry.no}`} description={<><div>{entry.title || ''}</div><div>{(item?.items || []).filter((mapping: any) => mapping.project === entry.project && mapping.version === entry.version).map((mapping: any) => mapping.requirement).filter(Boolean).join(' · ')}</div>{(entry.changes || []).map((change: any, i: number) => <div key={i}>{change.type} · {change.location}：{change.content}</div>)}</>} />
              <Space wrap>{frozen && <Button disabled={Boolean(downloading)} onClick={() => download(`versions/${entry.project}/${entry.version}/prototype.html`)}>下载冻结原型</Button>}<Link to={linked(`/projects/${encodeURIComponent(entry.project)}/versions/${encodeURIComponent(entry.version || entry.versionNo || entry.no)}`)}>查看源版本与协作记录</Link></Space>
            </List.Item>} /> },
            { key: 'files', label: `交付文件 (${files.length})`, children: <>
              <Alert type="info" showIcon title="下载的是冻结副本" description="原型保留原始 HTML，CDN 和接口可能需要网络。在线文档仅保留链接，不包含远端正文。技术方案、接口文档和测试用例可在源版本附件中补充，变更后另建交付。" />
              <Tabs activeKey={kind} onChange={setKind} items={[{ key: 'all', label: '全部文件' }, ...Object.entries(fileKinds).map(([key, label]) => ({ key, label }))]} />
              <List dataSource={files.filter((file: any) => kind === 'all' || file.kind === kind)} locale={{ emptyText: '本次没有此类文件' }} renderItem={(file: any) => <List.Item>
                <List.Item.Meta title={file.path.split('/').pop()} description={<span className="delivery-file-path">{file.path} · {fmtSize(file.size)}</span>} />
                <Space><Tag>{fileKinds[file.kind] || file.kind}</Tag><Button icon={<DownloadOutlined />} loading={downloading === file.path} disabled={Boolean(downloading) && downloading !== file.path} onClick={() => download(file.path)}>下载</Button></Space>
              </List.Item>} />
            </> },
          ]} />
        </section>
      </div>
    </State>
  </main>;
}
