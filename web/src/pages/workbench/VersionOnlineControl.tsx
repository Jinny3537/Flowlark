import { Alert, App, Button, InputNumber, Popover, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { api } from '@/services/api';

export function VersionOnlineControl({ slug, version, disabled, onChanged }: {
  slug: string; version: any; disabled: boolean; onChanged: (value: any) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [versionId, setVersionId] = useState<number | null>(version.releaseBinding?.versionId || null);
  const [busy, setBusy] = useState(false);
  const sync = version.onlineSync;
  const canRebind = !sync || (sync.status === 'failed' && sync.operations.every((step: any) => !step.attemptedAt && !step.completedAt));
  const bound = Boolean(version.releaseBinding);
  const online = version.deliveryStatus === 'online';
  const run = async (binding = false) => {
    setBusy(true);
    try {
      const next: any = binding
        ? await api.bindVersionRelease(slug, version.versionNo, Number(versionId))
        : await api.markVersionOnline(slug, version.versionNo);
      await onChanged(next);
      if (next.onlineSync?.status === 'failed') message.warning(next.onlineSync.error?.message || '已上线，任务平台同步失败');
      else message.success(binding ? '任务平台版本已关联' : '已上线，冲刺已结束、版本已关闭');
    } catch (error: any) {
      message.error(error.message || '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  return <Space size={4}>
    <Popover trigger="click" title="上线联动" content={<Space direction="vertical" style={{ width: 340 }}>
      <Typography.Text>标记已上线后，自动结束关联冲刺并关闭任务平台版本。</Typography.Text>
      <Typography.Text type="secondary">请先在迭代中关联当前版本。跨版本共用冲刺需先拆分，未完成任务需在任务平台处理。</Typography.Text>
      {version.releaseBinding && <Typography.Text>平台项目 {version.releaseBinding.projectId} · 版本 {version.releaseBinding.versionId}</Typography.Text>}
      {canRebind && <Space.Compact style={{ width: '100%' }}>
        <InputNumber aria-label="任务平台版本 ID" placeholder="任务平台版本 ID" min={1} precision={0} value={versionId} onChange={setVersionId} disabled={disabled || busy} style={{ width: '100%' }} />
        <Button disabled={disabled || busy || !versionId} loading={busy} onClick={() => void run(true)}>保存关联</Button>
      </Space.Compact>}
      {sync?.error && <Alert type="warning" showIcon message={sync.error.message} />}
      {(sync?.operations || []).map((step: any) => <Typography.Text key={`${step.kind}:${step.id}`}>
        {step.kind === 'sprint.end' ? '结束冲刺' : '关闭版本'} {step.id} · {step.status === 'completed' ? '已完成' : step.status === 'failed' ? '失败，待重试' : step.status === 'running' ? '执行中' : '待执行'}
      </Typography.Text>)}
      {sync?.startedAt && <Typography.Text type="secondary">操作人：{sync.actor} · {new Date(sync.startedAt).toLocaleString()}</Typography.Text>}
    </Space>}>
      <Button type="text">{online ? <Tag color={sync?.status === 'completed' ? 'success' : 'warning'}>
        已上线 · {sync?.status === 'completed' ? '同步完成' : '待同步'}
      </Tag> : bound ? '上线关联' : '配置上线联动'}</Button>
    </Popover>
    {bound && sync?.status !== 'completed' && <Button disabled={disabled || busy || version.status === 'VOID'} loading={busy}
      title="同步结束关联冲刺并关闭任务平台版本" onClick={() => void run()}>
      {online ? '重试上线同步' : '标记已上线'}
    </Button>}
  </Space>;
}
