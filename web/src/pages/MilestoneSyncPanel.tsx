import { Alert, App, Button, Checkbox, Descriptions, Input, Modal, Space, Steps, Table, Tag } from 'antd';
import { PlayCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  allowedMilestoneActions,
  groupPlanOperations,
  isHighRiskAction,
  milestoneStatusMeta,
  syncHealth,
} from './milestoneSyncModel.js';

type Props = {
  name: string;
  item: any;
  preflight: any;
  journal: any;
  writable: boolean;
  onChanged: () => Promise<void> | void;
};

const ACTION_LABELS: Record<string, string> = {
  review: '进入评审',
  back: '退回计划中',
  freeze: '冻结迭代',
  unfreeze: '解除冻结',
  start: '开始冲刺',
  end: '结束交付',
  cancel: '取消迭代',
  archive: '归档',
};

const LOCAL_TARGETS: Record<string, string> = {
  review: 'reviewing',
  back: 'planning',
  freeze: 'frozen',
  unfreeze: 'reviewing',
  archive: 'archived',
};

export function MilestoneSyncPanel({ name, item, preflight, journal, writable, onChanged }: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<any>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planAction, setPlanAction] = useState('');
  const [reason, setReason] = useState('');
  const [confirmUnfinished, setConfirmUnfinished] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [operationError, setOperationError] = useState('');
  const [localCancelOpen, setLocalCancelOpen] = useState(false);
  const groups = useMemo(() => groupPlanOperations(plan || {}), [plan]);
  const health = syncHealth({ external: item?.external, journal });
  const lifecycle = milestoneStatusMeta(item?.status);
  const actions = allowedMilestoneActions(item);

  async function prepare(action = '', nextResolutions: Record<string, string> = {}) {
    setBusy(action ? `plan:${action}` : 'plan');
    setOperationError('');
    try {
      const next = await api.planMilestoneSync(name, { action: action || null, resolutions: nextResolutions });
      setPlan(next);
      setPlanAction(action);
      setResolutions(nextResolutions);
      setReason('');
      setConfirmUnfinished(false);
      setPlanOpen(true);
    } catch (error) {
      message.error(errorText(error, '生成同步计划失败'));
    } finally {
      setBusy('');
    }
  }

  async function execute() {
    if (!plan) return;
    setBusy('execute');
    setOperationError('');
    try {
      await api.executeMilestoneSync(name, {
        planHash: plan.hash,
        action: planAction || null,
        confirmed: true,
        reason: reason.trim(),
        confirmUnfinished,
        resolutions,
      });
      message.success(planAction ? `${ACTION_LABELS[planAction]}完成` : '迭代同步完成');
      setPlanOpen(false);
      setPlan(null);
      await onChanged();
    } catch (error) {
      setOperationError(errorText(error, '同步执行失败'));
    } finally {
      setBusy('');
    }
  }

  async function resume() {
    setBusy('resume');
    try {
      await api.resumeMilestoneSync(name, { reason: journal?.reason || '恢复同步' });
      message.success('同步已恢复并完成');
      await onChanged();
    } catch (error) {
      message.error(errorText(error, '恢复同步失败'));
    } finally {
      setBusy('');
    }
  }

  async function transition(action: string) {
    if (['start', 'end'].includes(action) || (action === 'cancel' && item?.external?.sprintId)) {
      await prepare(action);
      return;
    }
    if (action === 'cancel') {
      setReason('');
      setLocalCancelOpen(true);
      return;
    }
    const target = action === 'cancel' ? 'canceled' : LOCAL_TARGETS[action];
    setBusy(`transition:${action}`);
    try {
      await api.transitionMilestone(name, { target });
      message.success(`${ACTION_LABELS[action]}完成`);
      await onChanged();
    } catch (error) {
      message.error(errorText(error, `${ACTION_LABELS[action]}失败`));
    } finally {
      setBusy('');
    }
  }

  async function confirmLocalCancel() {
    setBusy('transition:cancel');
    try {
      await api.transitionMilestone(name, { target: 'canceled', reason: reason.trim() });
      message.success('取消迭代完成');
      setLocalCancelOpen(false);
      await onChanged();
    } catch (error) {
      message.error(errorText(error, '取消迭代失败'));
    } finally {
      setBusy('');
    }
  }

  async function resolveConflict(operation: any, resolution: 'restore-local' | 'accept-remote') {
    const key = String(operation.key || '').replace(/:conflict$/, '');
    await prepare(planAction, { ...resolutions, [key]: resolution });
  }

  const highRisk = isHighRiskAction(planAction) || Boolean(plan?.operations?.some((operation: any) => operation.risk === 'high'));
  const blockers = plan?.blockers || [];
  return (
    <section className="fl-detail-section" aria-live="polite">
      <div className="fl-section-head">
        <div>
          <h2>迭代推进与平台同步</h2>
          <p>先检查、再生成计划；所有平台写入都需要审阅后确认。</p>
        </div>
        <Space wrap>
          <Button icon={<SyncOutlined />} loading={busy === 'plan'} disabled={!writable || Boolean(busy)} onClick={() => void prepare()}>生成同步计划</Button>
          {actions.map((action) => (
            <Button
              key={action}
              type={action === 'start' ? 'primary' : 'default'}
              danger={action === 'cancel'}
              icon={action === 'start' ? <PlayCircleOutlined /> : undefined}
              loading={busy === `transition:${action}` || busy === `plan:${action}`}
              disabled={!writable || Boolean(busy) || (action === 'freeze' && !preflight?.ready)}
              onClick={() => void transition(action)}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </Space>
      </div>

      <Descriptions column={{ xs: 1, sm: 3 }} size="small">
        <Descriptions.Item label="生命周期"><Tag color={lifecycle.color}>{lifecycle.label}</Tag></Descriptions.Item>
        <Descriptions.Item label="平台同步"><Tag color={health.tone}>{health.label}</Tag></Descriptions.Item>
        <Descriptions.Item label="冻结检查"><Tag color={preflight?.ready ? 'success' : 'warning'}>{preflight?.ready ? '已通过' : `${preflight?.blockers?.length || 0} 项阻塞`}</Tag></Descriptions.Item>
      </Descriptions>

      {preflight?.blockers?.length ? (
        <Alert
          type="warning"
          showIcon
          message="冻结前仍需处理"
          description={(
            <ul>
              {preflight.blockers.map((blocker: any, index: number) => (
                <li key={`${blocker.code}-${index}`}>
                  {blocker.message}
                  {blocker.repairTo ? <Button type="link" size="small" onClick={() => navigate(blocker.repairTo)}>前往处理</Button> : null}
                </li>
              ))}
            </ul>
          )}
        />
      ) : null}

      {journal?.status === 'failed' ? (
        <Alert
          className="fl-mcp-result"
          type="error"
          showIcon
          message="上次同步未完成"
          description={journal.operations?.find((operation: any) => operation.status === 'failed')?.error?.message || '可以从未完成步骤继续'}
          action={<Button icon={<ReloadOutlined />} loading={busy === 'resume'} onClick={() => void resume()}>重试未完成步骤</Button>}
        />
      ) : null}

      <Modal
        width={900}
        title={planAction ? `${ACTION_LABELS[planAction]} · 确认计划` : '确认迭代同步计划'}
        open={planOpen}
        okText={planAction ? ACTION_LABELS[planAction] : '确认并执行'}
        confirmLoading={busy === 'execute'}
        okButtonProps={{ danger: planAction === 'cancel', disabled: Boolean(blockers.length) || (highRisk && (!reason.trim() || !confirmUnfinished)) }}
        onOk={() => void execute()}
        onCancel={() => setPlanOpen(false)}
        destroyOnHidden
      >
        <Steps
          size="small"
          current={busy === 'execute' ? 2 : 1}
          items={[{ title: '生成计划' }, { title: '审阅确认' }, { title: '执行验证' }]}
        />
        <Space wrap className="fl-mcp-result">
          <Tag>创建 {groups.create.length}</Tag>
          <Tag>更新 {groups.update.length}</Tag>
          <Tag>迁移 {groups.move.length}</Tag>
          <Tag color={groups.conflict.length ? 'error' : 'default'}>冲突 {groups.conflict.length}</Tag>
          <Tag color={groups.lifecycle.length ? 'blue' : 'default'}>状态操作 {groups.lifecycle.length}</Tag>
        </Space>
        {blockers.length ? <Alert type="error" showIcon message={`仍有 ${blockers.length} 个阻塞项，不能执行`} description={blockers.map((item: any) => item.message).join('；')} /> : null}
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={plan?.operations || []}
          columns={[
            { title: '操作', dataIndex: 'kind', width: 150, render: (value) => <code>{value}</code> },
            { title: '对象', render: (_, operation: any) => operation.requirement || operation.taskId || operation.sprintId || name },
            { title: '变更摘要', render: (_, operation: any) => <span className="fl-muted">{JSON.stringify(operation.after || operation.before || {}).slice(0, 180)}</span> },
            { title: '风险', dataIndex: 'risk', width: 90, render: (value) => <Tag color={value === 'high' ? 'error' : 'default'}>{value === 'high' ? '高风险' : '普通'}</Tag> },
            {
              title: '处理',
              width: 190,
              render: (_, operation: any) => operation.kind === 'conflict' ? (
                <Space size={4}>
                  <Button size="small" onClick={() => void resolveConflict(operation, 'restore-local')}>保留 Flowlark</Button>
                  <Button size="small" onClick={() => void resolveConflict(operation, 'accept-remote')}>接受平台值</Button>
                </Space>
              ) : null,
            },
          ]}
          scroll={{ x: 760, y: 280 }}
        />
        {highRisk ? (
          <>
            <label htmlFor="milestone-sync-reason">操作原因</label>
            <Input.TextArea id="milestone-sync-reason" value={reason} rows={3} maxLength={255} showCount onChange={(event) => setReason(event.target.value)} />
            <Checkbox checked={confirmUnfinished} onChange={(event) => setConfirmUnfinished(event.target.checked)}>我已确认平台上的未完成任务处理方式</Checkbox>
          </>
        ) : null}
        {operationError ? <Alert className="fl-mcp-result" type="error" showIcon message={operationError} /> : null}
        <Alert className="fl-mcp-result" type="info" showIcon icon={<SafetyCertificateOutlined />} message={`计划哈希：${plan?.hash || ''}`} />
      </Modal>
      <Modal
        title="取消本地迭代？"
        open={localCancelOpen}
        okText="确认取消"
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        confirmLoading={busy === 'transition:cancel'}
        onOk={() => void confirmLocalCancel()}
        onCancel={() => setLocalCancelOpen(false)}
      >
        <p>取消后将进入终态，不能继续编辑。该迭代尚未关联平台冲刺，因此只修改 Flowlark 本地状态。</p>
        <label htmlFor="milestone-local-cancel-reason">取消原因</label>
        <Input.TextArea id="milestone-local-cancel-reason" value={reason} rows={3} maxLength={255} showCount onChange={(event) => setReason(event.target.value)} />
      </Modal>
    </section>
  );
}
