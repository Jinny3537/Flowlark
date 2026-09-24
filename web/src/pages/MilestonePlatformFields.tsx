import { Alert, Button, Form, Select, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';

type Platform = { projectId?: number; projectName?: string; versionId?: number | null; versionName?: string; sprintId?: number | null; sprintName?: string; ownerId?: number | null; [key: string]: any };

export function MilestonePlatformFields({ value, onChange, locked = false, createMode = false }: { value?: Platform | null; onChange?: (value: Platform | null) => void; locked?: boolean; createMode?: boolean }) {
  const [options, setOptions] = useState<any>({ projects: [], versions: [], sprints: [], members: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current;
    setLoading(true); setError('');
    setOptions((old: any) => ({ ...old, versions: [], sprints: [], members: [] }));
    api.milestonePlatformOptions(value?.projectId).then((next) => {
      if (request === requestId.current) setOptions(next);
    }).catch((reason) => {
      if (request === requestId.current) setError(errorText(reason, '无法读取平台选项'));
    }).finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current++; };
  }, [value?.projectId, retry]);
  const update = (patch: Partial<Platform>) => onChange?.({ ...value, ...patch });
  const choices = (items: any[], id?: number | null, label?: string) => {
    const result = items.map((item) => ({ value: item.id, label: item.name || `#${item.id}` }));
    if (id && !result.some((item) => item.value === id)) result.push({ value: id, label: label || `#${id}` });
    return result;
  };
  return <div>
    {error ? <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={() => setRetry((n) => n + 1)}>重试</Button>} /> : null}
    <Form.Item label="研发执行项目">
      <Select aria-label="研发执行项目" showSearch optionFilterProp="label" allowClear disabled={locked} loading={loading}
        value={value?.projectId} placeholder="选择对应的研发平台项目"
        options={choices(options.projects, value?.projectId, value?.projectName)}
        onChange={(id) => onChange?.(id ? { projectId: id, projectName: options.projects.find((p: any) => p.id === id)?.name, versionId: null, sprintId: null, ownerId: null } : null)} />
    </Form.Item>
    <Form.Item label="目标发布版本">
      <Select aria-label="目标发布版本" allowClear showSearch optionFilterProp="label" loading={loading} disabled={!value?.projectId || loading || !!error}
        value={value?.versionId ?? undefined} placeholder={value?.projectId ? '选择本轮交付的发布版本（可选）' : '请先选择项目'}
        options={choices(options.versions, value?.versionId, value?.versionName)}
        onChange={(id) => update({ versionId: id ?? null, versionName: options.versions.find((v: any) => v.id === id)?.name || '' })} />
    </Form.Item>
    {!createMode ? <Form.Item label="关联冲刺">
      <Select aria-label="关联冲刺" allowClear showSearch optionFilterProp="label" loading={loading} disabled={locked || !value?.projectId || loading || !!error}
        value={value?.sprintId ?? undefined} placeholder={value?.projectId ? '选择已有冲刺；留空则在确认同步后新建' : '请先选择项目'}
        options={choices(options.sprints, value?.sprintId, value?.sprintName)}
        onChange={(id) => { const sprint = options.sprints.find((s: any) => s.id === id); update({ sprintId: id ?? null, sprintName: sprint?.name || '', ...(sprint?.ownerId ? { ownerId: sprint.ownerId } : {}) }); }} />
    </Form.Item>
    : null}
    <Form.Item label="冲刺负责人">
      <Select aria-label="冲刺负责人" allowClear showSearch optionFilterProp="label" loading={loading} disabled={!value?.projectId || loading || !!error}
        value={value?.ownerId ?? undefined} placeholder="选择当前项目成员"
        options={choices(options.members, value?.ownerId)} onChange={(id) => update({ ownerId: id ?? null, ownerName: options.members.find((member: any) => member.id === id)?.name || '' })} />
    </Form.Item>
    <Space direction="vertical" size={0}>
      <Typography.Text type="secondary">{createMode ? '将按本轮名称、目标和周期新建对应冲刺，并关联所选需求。发布版本用于交付归属，可选。' : '发布版本用于交付归属，冲刺负责本轮执行。原型可在交付物中补充。'}</Typography.Text>
      {locked ? <Typography.Text type="secondary">已同步的项目和冲刺固定，新的交付周期请新建迭代。</Typography.Text> : null}
    </Space>
  </div>;
}
