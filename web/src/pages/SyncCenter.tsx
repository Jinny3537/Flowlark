import {
  Alert,
  App,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Timeline,
} from 'antd';
import {
  DownOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';
import {
  countSyncStatuses,
  filterSyncRecords,
  syncPrimaryAction,
  syncStatusMeta,
} from './syncCenterModel.js';

type SyncAction = 'execute' | 'retry' | 'cancel';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'attention', label: '需处理' },
  { value: 'running', label: '同步中' },
  { value: 'completed', label: '已完成' },
];

const ENTITY_LABELS: Record<string, string> = {
  milestone: '迭代',
};

const OPERATION_STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  executing: '执行中',
  'remote-complete': '远端已完成',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停',
  skipped: '已跳过',
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  queued: '已加入队列',
  running: '开始执行',
  completed: '同步完成',
  failed: '同步失败',
  paused: '同步暂停',
  canceled: '同步取消',
  'sync.running': '同步执行中',
  'sync.completed': '同步完成',
  'sync.paused': '同步暂停',
  'sync.canceled': '同步取消',
  'step.started': '步骤开始',
  'step.executing': '步骤执行中',
  'step.completed': '步骤完成',
  'step.failed': '步骤失败',
};

function recordOperations(record: any) {
  if (Array.isArray(record?.operations) && record.operations.length) {
    return record.operations;
  }
  return (record?.plan?.operations || []).map((operation: any) => ({
    key: operation.key,
    kind: operation.kind,
    status: 'pending',
    operation,
  }));
}

function planOperations(record: any) {
  return record?.plan?.operations || recordOperations(record).map((item: any) => item.operation || item);
}

function isHighRisk(record: any) {
  return planOperations(record).some((operation: any) => operation?.risk === 'high');
}

function isHighImpact(record: any) {
  const directImpact = new Set(['sprint.start', 'sprint.end', 'sprint.cancel', 'local.scope-change']);
  return planOperations(record).some((operation: any) => (
    directImpact.has(operation?.kind) || (operation?.kind === 'task.move' && operation?.risk === 'high')
  ));
}

function latestError(record: any) {
  return record?.error?.message || recordOperations(record)
    .find((operation: any) => operation.status === 'failed')?.error?.message || '';
}

function planSummary(record: any) {
  const operations = planOperations(record);
  const highRiskCount = operations.filter((operation: any) => operation?.risk === 'high').length;
  if (!operations.length) return '没有待执行步骤';
  return `${operations.length} 个步骤${highRiskCount ? ` · ${highRiskCount} 个高风险` : ''}`;
}

function operationDiff(item: any) {
  const operation = item?.operation || item || {};
  const hasBefore = Object.prototype.hasOwnProperty.call(operation, 'before');
  const hasAfter = Object.prototype.hasOwnProperty.call(operation, 'after');
  if (!hasBefore && !hasAfter) return { summary: '无字段差异', sections: [] };
  if (operation.kind === 'local.scope-change') {
    return {
      summary: '目标范围',
      sections: [{ label: '目标范围', value: operation.after, present: hasAfter, emptyText: '无目标范围' }],
    };
  }
  if (operation.kind === 'local.accept-remote') {
    return {
      summary: '本地当前值 → 接受的外部值',
      sections: [
        { label: '本地当前值', value: operation.before, present: hasBefore, emptyText: '无本地当前值' },
        { label: '接受的外部值', value: operation.after, present: hasAfter, emptyText: '无外部值' },
      ],
    };
  }
  return {
    summary: '外部当前值 → Flowlark 目标值',
    sections: [
      { label: '外部当前值', value: operation.before, present: hasBefore, emptyText: '无外部当前值' },
      { label: 'Flowlark 目标值', value: operation.after, present: hasAfter, emptyText: '无目标值' },
    ],
  };
}

function formattedJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function OperationDiff({ item }: { item: any }) {
  const diff = operationDiff(item);
  if (!diff.sections.length) return <p className="fl-sync-diff-empty">无字段差异</p>;
  return (
    <div className="fl-sync-diff">
      <p>变更数据已由后端脱敏。</p>
      <div className={`fl-sync-diff-grid ${diff.sections.length === 1 ? 'is-single' : ''}`}>
        {diff.sections.map((section) => (
          <section className="fl-sync-diff-panel" key={section.label}>
            <h4>{section.label}</h4>
            <pre className="fl-sync-diff-json" tabIndex={0}>
              {section.present ? formattedJson(section.value) : section.emptyText}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}

function SyncStatus({ value }: { value: string }) {
  const meta = syncStatusMeta(value);
  return (
    <span className="fl-sync-status">
      <Badge status={meta.color} />
      <span>{meta.label}</span>
    </span>
  );
}

export default function SyncCenter() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { health, reload: reloadRuntime } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [records, setRecords] = useState<any[]>([]);
  const [counts, setCounts] = useState({ attention: 0, running: 0, completed: 0 });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [confirming, setConfirming] = useState<{ type: SyncAction; record: any } | null>(null);
  const [reason, setReason] = useState('');
  const [confirmUnfinished, setConfirmUnfinished] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response: any = await api.listSyncRecords();
      const items = Array.isArray(response) ? response : response?.items || [];
      setRecords(items);
      setCounts(response?.counts || countSyncStatuses(items));
    } catch (error) {
      setLoadError(`${errorText(error, '无法读取同步记录')}。请确认本地服务正在运行后重试。`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    const [recordResult, auditResult] = await Promise.allSettled([
      api.getSyncRecord(id),
      api.listSyncAudit(id),
    ]);
    const errors: string[] = [];
    if (recordResult.status === 'fulfilled') {
      setDetailRecord(recordResult.value);
    } else {
      errors.push(errorText(recordResult.reason, '同步详情加载失败'));
    }
    if (auditResult.status === 'fulfilled') {
      setAudit(auditResult.value || []);
    } else {
      errors.push(errorText(auditResult.reason, '审计记录加载失败'));
    }
    if (errors.length) setDetailError(`${errors.join('；')}。可重试加载，列表记录不会丢失。`);
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => filterSyncRecords(records, filter), [filter, records]);

  const openDetail = (record: any) => {
    setDetailRecord(record);
    setAudit([]);
    setDetailOpen(true);
    void loadDetail(record.id);
  };

  const askAction = (type: SyncAction, record: any) => {
    setReason('');
    setConfirmUnfinished(false);
    setActionError('');
    setConfirming({ type, record });
  };

  const closeConfirmation = () => {
    setConfirming(null);
    setReason('');
    setConfirmUnfinished(false);
    setActionError('');
  };

  const refreshAfterAction = async (id: string) => {
    await Promise.all([
      load(),
      reloadRuntime(),
      detailOpen ? loadDetail(id) : Promise.resolve(),
    ]);
  };

  const runAction = async () => {
    if (!confirming || !writable) return;
    const { type, record } = confirming;
    const highRisk = isHighRisk(record);
    const highImpact = ['execute', 'retry'].includes(type) && isHighImpact(record);
    if (type === 'execute' && !String(record.planHash || '').trim()) return;
    if ((type === 'cancel' || (type === 'execute' && highRisk)) && !reason.trim()) return;
    if (highImpact && !confirmUnfinished) return;
    setActionLoading(true);
    setActionError('');
    try {
      if (type === 'execute') {
        await api.executeSyncRecord(record.id, {
          planHash: record.planHash,
          reason: highRisk ? reason.trim() : '确认同步计划',
          confirmUnfinished: highImpact,
        });
      } else if (type === 'retry') {
        await api.retrySyncRecord(record.id, {
          reason: '从同步中心重试',
          confirmUnfinished: highImpact,
        });
      } else {
        await api.cancelSyncRecord(record.id, reason.trim());
      }
      message.success(type === 'execute' ? '同步已执行' : type === 'retry' ? '同步已重试' : '同步已取消');
      closeConfirmation();
      await refreshAfterAction(record.id);
    } catch (error) {
      setActionError(`${errorText(error, '同步操作失败')}。请检查详情与本地服务状态后重试。`);
    } finally {
      setActionLoading(false);
    }
  };

  const rowAction = (record: any) => {
    const action = syncPrimaryAction(record);
    return (
      <Space className="fl-sync-actions" size={4} wrap>
        <Button icon={<EyeOutlined />} onClick={() => openDetail(record)}>查看</Button>
        {action === 'execute' ? (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={!writable}
            onClick={() => askAction('execute', record)}
          >
            执行
          </Button>
        ) : null}
        {action === 'retry' ? (
          <Button
            icon={<ReloadOutlined />}
            disabled={!writable}
            onClick={() => askAction('retry', record)}
          >
            重试
          </Button>
        ) : null}
      </Space>
    );
  };

  const operationColumns = [
    {
      title: '步骤',
      render: (_: unknown, item: any) => (
        <div>
          <code>{textOf(item.kind || item.operation?.kind)}</code>
          <div className="fl-muted fl-mono">{textOf(item.key || item.operation?.key)}</div>
        </div>
      ),
    },
    {
      title: '状态',
      width: 110,
      render: (_: unknown, item: any) => (
        <Tag color={item.status === 'failed' ? 'error' : item.status === 'completed' ? 'success' : 'default'}>
          {OPERATION_STATUS_LABELS[item.status] || textOf(item.status, '未知')}
        </Tag>
      ),
    },
    {
      title: '风险',
      width: 100,
      render: (_: unknown, item: any) => {
        const risk = item.operation?.risk || item.risk;
        return <Tag color={risk === 'high' ? 'error' : 'default'}>{risk === 'high' ? '高风险' : '普通'}</Tag>;
      },
    },
    {
      title: '变更预览',
      width: 240,
      render: (_: unknown, item: any) => <span className="fl-sync-diff-summary">{operationDiff(item).summary}</span>,
    },
    {
      title: '结果 / 错误',
      width: 260,
      render: (_: unknown, item: any) => (
        <span className="fl-sync-error">
          {item.error?.message || (item.remoteResult ? '平台已返回结果' : '—')}
        </span>
      ),
    },
  ];

  const confirmType = confirming?.type;
  const confirmHighRisk = confirming ? isHighRisk(confirming.record) : false;
  const confirmHighImpact = Boolean(
    confirming && ['execute', 'retry'].includes(confirming.type) && isHighImpact(confirming.record),
  );
  const confirmNeedsReason = confirmType === 'cancel' || (confirmType === 'execute' && confirmHighRisk);
  const confirmMissingPlanHash = confirmType === 'execute' && !String(confirming?.record?.planHash || '').trim();

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="运行台账"
        title="同步中心"
        description="集中检查同步计划、执行状态与脱敏审计记录；所有平台写入仍需人工确认。"
        actions={(
          <Button className="fl-sync-touch-target" icon={<SyncOutlined />} loading={loading} onClick={() => void load()}>
            刷新记录
          </Button>
        )}
      />

      <section className="fl-sync-summary" aria-label="同步状态摘要">
        <div className="fl-sync-summary-item">
          <span><Badge status="warning" />需处理</span>
          <strong>{counts.attention}</strong>
          <small>待确认、失败或暂停</small>
        </div>
        <div className="fl-sync-summary-item">
          <span><Badge status="processing" />同步中</span>
          <strong>{counts.running}</strong>
          <small>正在执行的记录</small>
        </div>
        <div className="fl-sync-summary-item">
          <span><Badge status="success" />已完成</span>
          <strong>{counts.completed}</strong>
          <small>已完成的同步记录</small>
        </div>
      </section>

      {!writable ? (
        <Alert
          className="fl-sync-alert"
          type="info"
          showIcon
          message="当前为只读模式"
          description="同步记录、执行步骤和审计信息仍可查看；执行、重试和取消操作已禁用。"
        />
      ) : null}

      <section className="fl-sync-ledger" aria-labelledby="sync-ledger-title">
        <div className="fl-sync-ledger-head">
          <div>
            <h2 id="sync-ledger-title">同步记录</h2>
            <p>按更新时间倒序排列。未知状态不会提供写操作。</p>
          </div>
          <Radio.Group
            className="fl-sync-filter"
            optionType="button"
            buttonStyle="solid"
            options={FILTERS}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="筛选同步记录"
          />
        </div>

        {loadError ? (
          <Alert
            className="fl-sync-alert"
            role="alert"
            aria-live="assertive"
            type="error"
            showIcon
            message="同步记录未能刷新"
            description={loadError}
            action={<Button icon={<ReloadOutlined />} onClick={() => void load()}>重试加载</Button>}
          />
        ) : null}

        <div className="fl-sync-table-wrap">
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={filtered}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={filter === 'all' ? '还没有同步记录' : '当前筛选下没有同步记录'}
                >
                  {filter === 'all' ? <Button onClick={() => navigate('/milestones')}>前往迭代生成预览</Button> : null}
                </Empty>
              ),
            }}
            columns={[
              {
                title: '对象',
                width: 220,
                render: (_, record: any) => (
                  <div>
                    <span className="fl-table-title">{ENTITY_LABELS[record.entityType] || '未知对象'} · {textOf(record.entityKey)}</span>
                    <div className="fl-muted fl-mono">{textOf(record.entityType)}</div>
                  </div>
                ),
              },
              { title: '计划摘要', width: 190, render: (_, record: any) => planSummary(record) },
              { title: '状态', width: 120, render: (_, record: any) => <SyncStatus value={record.status} /> },
              { title: '更新时间', width: 160, render: (_, record: any) => fmtTime(record.updatedAt) },
              {
                title: '最近错误',
                width: 280,
                render: (_, record: any) => (
                  <span className="fl-sync-error">
                    {latestError(record) || '—'}
                    {latestError(record) ? <small>打开详情检查失败步骤后重试</small> : null}
                  </span>
                ),
              },
              { title: '操作', width: 190, fixed: 'right', render: (_, record: any) => rowAction(record) },
            ]}
            scroll={{ x: 1160 }}
          />
        </div>
      </section>

      <Drawer
        className="fl-sync-drawer"
        width="min(100vw, 760px)"
        open={detailOpen}
        title={detailRecord ? `${ENTITY_LABELS[detailRecord.entityType] || '同步对象'} · ${textOf(detailRecord.entityKey)}` : '同步详情'}
        onClose={() => setDetailOpen(false)}
        extra={detailRecord ? (
          <Space className="fl-sync-actions" size={4} wrap>
            {detailRecord.route?.startsWith('/') ? (
              <Button onClick={() => navigate(detailRecord.route)}>打开对象</Button>
            ) : null}
            {syncPrimaryAction(detailRecord) === 'execute' ? (
              <Button type="primary" disabled={!writable} onClick={() => askAction('execute', detailRecord)}>执行</Button>
            ) : null}
            {syncPrimaryAction(detailRecord) === 'retry' ? (
              <Button disabled={!writable} onClick={() => askAction('retry', detailRecord)}>重试</Button>
            ) : null}
            {['pending-confirmation', 'failed', 'paused'].includes(detailRecord.status) ? (
              <Button danger icon={<StopOutlined />} disabled={!writable} onClick={() => askAction('cancel', detailRecord)}>取消</Button>
            ) : null}
          </Space>
        ) : null}
      >
        {detailError ? (
          <Alert
            className="fl-sync-alert"
            role="alert"
            aria-live="assertive"
            type="error"
            showIcon
            message="详情未完整加载"
            description={detailError}
            action={<Button icon={<ReloadOutlined />} onClick={() => void loadDetail(detailRecord?.id)}>重试加载</Button>}
          />
        ) : null}

        {detailRecord ? (
          <div className="fl-sync-detail" aria-busy={detailLoading}>
            <section className="fl-sync-detail-section">
              <h3>记录概览</h3>
              <dl className="fl-sync-detail-grid">
                <div><dt>状态</dt><dd><SyncStatus value={detailRecord.status} /></dd></div>
                <div><dt>模式</dt><dd>{textOf(detailRecord.mode)}</dd></div>
                <div><dt>更新时间</dt><dd>{fmtTime(detailRecord.updatedAt)}</dd></div>
                <div><dt>计划哈希</dt><dd><code>{textOf(detailRecord.planHash)}</code></dd></div>
              </dl>
              {latestError(detailRecord) ? (
                <Alert
                  className="fl-sync-alert"
                  role="alert"
                  aria-live="polite"
                  type="error"
                  showIcon
                  message="最近一次执行失败"
                  description={`${latestError(detailRecord)}。检查下方失败步骤后，可使用“重试”继续。`}
                />
              ) : null}
            </section>

            <section className="fl-sync-detail-section">
              <h3>执行步骤</h3>
              <div className="fl-sync-operation-table">
                <Table
                  rowKey={(item) => item.key || item.operation?.key}
                  size="small"
                  loading={detailLoading && !recordOperations(detailRecord).length}
                  pagination={false}
                  dataSource={recordOperations(detailRecord)}
                  columns={operationColumns}
                  expandable={{
                    columnTitle: '展开',
                    expandIcon: ({ expanded, onExpand, record }) => {
                      const kind = textOf(record.kind || record.operation?.kind, '步骤');
                      return (
                        <Button
                          className="fl-sync-expand-button"
                          type="text"
                          icon={expanded ? <DownOutlined /> : <RightOutlined />}
                          aria-label={`${expanded ? '收起' : '展开'} ${kind} 变更预览`}
                          onClick={(event) => onExpand(record, event)}
                        />
                      );
                    },
                    expandedRowRender: (item) => <OperationDiff item={item} />,
                  }}
                  scroll={{ x: 960 }}
                  locale={{ emptyText: '没有持久化的执行步骤' }}
                />
              </div>
            </section>

            <section className="fl-sync-detail-section">
              <h3>脱敏审计</h3>
              {audit.length ? (
                <Timeline
                  items={audit.map((entry: any) => ({
                    color: entry.error ? 'var(--fl-danger)' : entry.status === 'completed' ? 'var(--fl-primary)' : 'var(--fl-text-3)',
                    children: (
                      <div className="fl-sync-audit-item">
                        <strong>{AUDIT_ACTION_LABELS[entry.action] || textOf(entry.action, '审计事件')}</strong>
                        <span>{fmtTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ''}</span>
                        {entry.operationKey ? <code>{entry.operationKey}</code> : null}
                        {entry.error?.message ? <p className="fl-sync-error">{entry.error.message}</p> : null}
                      </div>
                    ),
                  }))}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={detailLoading ? '正在读取审计记录' : '暂无审计记录'} />}
            </section>
          </div>
        ) : null}
      </Drawer>

      <Modal
        className="fl-sync-action-modal"
        title={confirmType === 'execute' ? '确认执行同步计划' : confirmType === 'retry' ? '确认重试同步' : '确认取消同步'}
        open={Boolean(confirming)}
        okText={confirmType === 'execute' ? '确认执行' : confirmType === 'retry' ? '确认重试' : '确认取消'}
        okButtonProps={{
          danger: confirmType === 'cancel',
          disabled: !writable || confirmMissingPlanHash || (confirmNeedsReason && !reason.trim()) || (confirmHighImpact && !confirmUnfinished),
        }}
        confirmLoading={actionLoading}
        onOk={() => void runAction()}
        onCancel={closeConfirmation}
        destroyOnHidden
      >
        {confirming ? (
          <div className="fl-sync-confirm">
            {confirmType === 'execute' ? (
              <>
                <p>将按已持久化的计划执行 {planSummary(confirming.record)}。服务端会重新校验计划哈希。</p>
                <div className="fl-sync-plan-hash"><span>计划哈希</span><code>{textOf(confirming.record.planHash)}</code></div>
                {confirmMissingPlanHash ? (
                  <Alert
                    className="fl-sync-alert"
                    role="alert"
                    aria-live="assertive"
                    type="error"
                    showIcon
                    message="记录缺少计划哈希，不能执行"
                    description="请返回对应迭代重新生成同步预览，再从同步中心确认。"
                    action={confirming.record.route?.startsWith('/') ? (
                      <Button onClick={() => navigate(confirming.record.route)}>打开迭代</Button>
                    ) : null}
                  />
                ) : null}
                {confirmHighRisk ? (
                  <>
                    <Alert type="warning" showIcon message="计划包含高风险步骤，请说明执行原因。" />
                    <label htmlFor="sync-action-reason">执行原因</label>
                    <Input.TextArea
                      id="sync-action-reason"
                      value={reason}
                      rows={3}
                      maxLength={255}
                      showCount
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            {confirmType === 'retry' ? <p>将从未完成步骤继续。已完成的远端对象不会由浏览器重复提交。</p> : null}
            {confirmHighImpact ? (
              <Checkbox checked={confirmUnfinished} onChange={(event) => setConfirmUnfinished(event.target.checked)}>
                已确认未完成任务和范围变化影响
              </Checkbox>
            ) : null}
            {confirmType === 'cancel' ? (
              <>
                <p>取消会终止这条同步记录，且不能从已取消状态恢复。</p>
                <label htmlFor="sync-cancel-reason">取消原因</label>
                <Input.TextArea
                  id="sync-cancel-reason"
                  value={reason}
                  rows={3}
                  maxLength={255}
                  showCount
                  onChange={(event) => setReason(event.target.value)}
                />
              </>
            ) : null}
            {actionError ? (
              <Alert
                className="fl-sync-alert"
                role="alert"
                aria-live="assertive"
                type="error"
                showIcon
                message="操作未完成"
                description={actionError}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </main>
  );
}
