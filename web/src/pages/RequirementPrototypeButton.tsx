import { useState } from 'react';
import { Alert, Button, List, Modal, Space, Tag } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { contextualRoute } from './workflowModel.js';
import { api } from '@/services/api';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { previewUrl } from './workbench/workbenchModel.js';

export function PrototypeLink({ project, versionNo, code, label = '预览原型' }: { project: string; versionNo: string; code?: string; label?: string }) {
  const { health } = useAppRuntime();
  const location = useLocation();
  const href = previewUrl({ protocol: window.location.protocol, hostname: window.location.hostname,
    previewPort: health?.previewPort || 7789, slug: project, versionNo });
  return <Space wrap><a href={href} target="_blank" rel="noreferrer">{label}</a>
    <Link to={contextualRoute(`/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(versionNo)}?tab=reqs${code ? `&requirement=${encodeURIComponent(code)}` : ''}`, location.pathname + location.search, code ? `需求 ${code}` : "需求原型")}>版本与需求</Link></Space>;
}

export default function RequirementPrototypeButton({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState<any>(null);
  const [error, setError] = useState('');
  const load = async () => {
    setOpen(true); setBusy(true); setItem(null); setError('');
    try { setItem(await api.getRequirement(code)); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setBusy(false); }
  };
  return <><Button onClick={() => void load()}>查看原型</Button>
    <Modal title={`${code} · 选择归档原型`} open={open} onCancel={() => setOpen(false)} footer={null}>
      {error ? <Alert type="error" message={error} action={<Button onClick={() => void load()}>重试</Button>} /> : null}
      <p>开发依据以对应迭代采用版本为准；最新归档不会自动替代它。</p>
      <List loading={busy} dataSource={[...(item?.versions || [])].reverse()} locale={{ emptyText: '尚未关联原型，请进入需求详情关联归档版本' }} renderItem={(version: any) => <List.Item>
        <Space direction="vertical"><strong>{version.project} / {version.versionNo}</strong>
          <Space wrap>{item?.adopted?.filter((a: any) => a.project === version.project && a.version === version.versionNo).map((a: any) => <Tag key={a.milestone} color="blue">{a.milestoneTitle} 采用</Tag>)}
          {item?.latest?.some((v: any) => v.project === version.project && v.versionNo === version.versionNo) ? <Tag>最新归档</Tag> : null}
          {version.status === 'VOID' ? <Tag color="error">已废弃</Tag> : null}</Space>
          <span>{version.coverage?.location || '未填写页面位置'} · {version.coverage?.scope || '未填写承载范围'}</span>
          <PrototypeLink project={version.project} versionNo={version.versionNo} code={code} />
        </Space>
      </List.Item>} />
      <Link to={`/requirements/${encodeURIComponent(code)}`}>打开需求协作详情</Link>
    </Modal></>;
}
