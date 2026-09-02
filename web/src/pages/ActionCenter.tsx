import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightOutlined,
  CalendarOutlined,
  FileTextOutlined,
  FolderOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { Alert, Button, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { MetricCard } from '@/components/MetricCard';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api, type HealthInfo } from '@/services/api';
import { fmtTime } from '@/utils/format';
import {
  buildRecentWorkCandidates,
  needsTargetValidation,
  projectContinueRoute,
  resolveRecentWorkTarget,
} from './recentWorkModel.js';

type DashboardData = {
  projects: any[];
  requirements: any[];
  milestones: any[];
  deliveries: any[];
  recentWork: any[];
  health: HealthInfo | null;
};

const emptyData: DashboardData = {
  projects: [],
  requirements: [],
  milestones: [],
  deliveries: [],
  recentWork: [],
  health: null,
};

export default function ActionCenter() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const loadRequestId = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    const failed: string[] = [];
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const [projects, requirements, milestones, deliveries, logs, health] = await Promise.all([
        api.listProjects(),
        api.listRequirements().catch(() => { failed.push('需求'); return []; }),
        api.listMilestones().catch(() => { failed.push('迭代'); return []; }),
        api.listSnapshots().catch(() => { failed.push('交付'); return []; }),
        api.oplog(undefined, 100).catch(() => { failed.push('操作日志'); return []; }),
        api.health().catch(() => { failed.push('工作区状态'); return null; }),
      ]);
      const candidates = buildRecentWorkCandidates(projects, logs, 8);
      const checked = await Promise.all(candidates.map(async (item) => {
        if (!needsTargetValidation(item)) return null;
        try {
          return await api.getVersion(item.slug, item.logVersionNo);
        } catch {
          return null;
        }
      }));
      if (requestId !== loadRequestId.current) return;
      setData({
        projects,
        requirements,
        milestones,
        deliveries,
        recentWork: candidates.map((item, index) => resolveRecentWorkTarget(item, checked[index])),
        health,
      });
      if (failed.length) setWarning(`${failed.join('、')}数据暂时无法读取`);
    } catch (nextError) {
      if (requestId !== loadRequestId.current) return;
      setData(emptyData);
      setError(nextError instanceof Error ? nextError.message : '项目数据暂时无法读取');
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingBaseline = useMemo(
    () => data.projects.filter((item) => !item.baselineVersionNo).length,
    [data.projects],
  );
  const linkedRequirements = useMemo(
    () => data.requirements.filter((item) => item.versions?.length).length,
    [data.requirements],
  );
  const riskyMilestones = useMemo(
    () => data.milestones.filter((item) => !item.ready).length,
    [data.milestones],
  );

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="今日概览"
        title="今天从这里继续"
        description="从最近修改的项目和版本继续处理。"
        actions={<Button onClick={() => void load()}>刷新数据</Button>}
      />

      {warning ? (
        <Alert
          className="fl-dashboard-alert"
          type="warning"
          showIcon
          message={warning}
          description="已保留其他可用数据，可以刷新后重试。"
        />
      ) : null}

      <State loading={loading} error={error} onRetry={load} empty={false}>
        <section className="fl-dashboard-grid">
          <div className="fl-dashboard-main">
            <section className="fl-dashboard-panel">
              <div className="fl-section-head">
                <div><h2>最近工作</h2><p>按最近修改时间排列，每个项目只显示一次</p></div>
                <Button type="link" onClick={() => navigate('/projects')}>查看全部项目</Button>
              </div>
              {data.recentWork.length ? (
                <div className="fl-recent-work-list">
                  {data.recentWork.map((item) => (
                    <button
                      className="fl-recent-work-item"
                      type="button"
                      key={item.slug}
                      aria-label={`继续处理 ${item.projectName}${item.targetVersionNo ? ` ${item.targetVersionNo}` : ''}`}
                      onClick={() => navigate(projectContinueRoute(item))}
                    >
                      <span className="fl-recent-work-identity">
                        <strong>{item.projectName}</strong>
                        <span className="fl-mono">{item.projectCode}</span>
                      </span>
                      <span className="fl-recent-work-version">
                        <span className="fl-recent-work-version-head">
                          <strong className="fl-mono">{item.targetVersionNo || '暂无版本'}</strong>
                          {item.targetDisplay ? (
                            <Tag color={item.targetDisplay.color}>
                              {item.targetDisplay.short || item.targetDisplay.label}
                            </Tag>
                          ) : null}
                        </span>
                        <span>{item.targetVersionTitle || '进入项目继续处理'}</span>
                        <small>{item.activityDetail || `当前基线 ${item.baselineVersionNo || '未设置'}`}</small>
                      </span>
                      <span className="fl-recent-work-time">
                        <small>最近更新</small>
                        <strong>{fmtTime(item.activityAt)}</strong>
                      </span>
                      <span className="fl-recent-work-action">继续处理 <ArrowRightOutlined /></span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="fl-dashboard-empty">
                  <strong>还没有可继续的项目</strong>
                  <span>创建或更新项目后，最近工作会显示在这里。</span>
                  <Button type="primary" onClick={() => navigate('/projects')}>进入项目</Button>
                </div>
              )}
            </section>
          </div>

          <aside className="fl-dashboard-aside">
            <section className="fl-dashboard-panel">
              <div className="fl-section-head"><div><h2>工作区状态</h2><p>本地服务与写入能力</p></div></div>
              <div className="fl-status-list">
                <div className="fl-status-row"><span>服务</span><Tag color={data.health ? 'success' : 'default'}>{data.health ? '已连接' : '离线'}</Tag></div>
                <div className="fl-status-row"><span>工作区</span><strong>{data.health?.repoName || '未读取'}</strong></div>
                <div className="fl-status-row"><span>权限</span><strong>{data.health?.canWrite === false ? '只读' : data.health ? '可写' : '-'}</strong></div>
                <div className="fl-status-row"><span>版本</span><strong className="fl-mono">{data.health?.version ? `v${data.health.version}` : '-'}</strong></div>
              </div>
            </section>
          </aside>
        </section>

        <section className="fl-metric-grid fl-metric-grid-secondary" aria-label="工作台指标">
          <MetricCard icon={<FolderOutlined />} label="活跃项目" value={data.projects.length} hint={`${pendingBaseline} 个待定基线`} to="/projects" />
          <MetricCard icon={<FileTextOutlined />} label="需求" value={data.requirements.length} hint={`${linkedRequirements} 个已关联版本`} to="/requirements" />
          <MetricCard icon={<CalendarOutlined />} label="迭代" value={data.milestones.length} hint={`${riskyMilestones} 个需要关注`} to="/milestones" />
          <MetricCard icon={<SendOutlined />} label="交付快照" value={data.deliveries.length} hint="冻结的评审材料" to="/deliveries" />
        </section>
      </State>
    </main>
  );
}
