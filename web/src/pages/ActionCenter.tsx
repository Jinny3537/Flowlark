import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

type DashboardData = {
  projects: any[];
  requirements: any[];
  milestones: any[];
  deliveries: any[];
  health: HealthInfo | null;
};

const emptyData: DashboardData = {
  projects: [],
  requirements: [],
  milestones: [],
  deliveries: [],
  health: null,
};

export default function ActionCenter() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const failed: string[] = [];
    setLoading(true);
    setError('');
    const [projects, requirements, milestones, deliveries, health] = await Promise.all([
      api.listProjects().catch(() => { failed.push('项目'); return []; }),
      api.listRequirements().catch(() => { failed.push('需求'); return []; }),
      api.listMilestones().catch(() => { failed.push('迭代'); return []; }),
      api.listSnapshots().catch(() => { failed.push('交付'); return []; }),
      api.health().catch(() => null),
    ]);
    setData({ projects, requirements, milestones, deliveries, health });
    if (failed.length) setError(`${failed.join('、')}数据暂时无法读取`);
    setLoading(false);
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
        description="查看项目基线、需求进度、迭代风险和已经冻结的交付。"
        actions={<Button onClick={() => void load()}>刷新数据</Button>}
      />

      {error ? (
        <Alert
          className="fl-dashboard-alert"
          type="warning"
          showIcon
          message={error}
          description="已保留其他可用数据，可以刷新后重试。"
        />
      ) : null}

      <State loading={loading} empty={false}>
        <section className="fl-metric-grid" aria-label="工作台指标">
          <MetricCard icon={<FolderOutlined />} label="活跃项目" value={data.projects.length} hint={`${pendingBaseline} 个待定基线`} to="/projects" />
          <MetricCard icon={<FileTextOutlined />} label="需求" value={data.requirements.length} hint={`${linkedRequirements} 个已关联版本`} to="/requirements" />
          <MetricCard icon={<CalendarOutlined />} label="迭代" value={data.milestones.length} hint={`${riskyMilestones} 个需要关注`} to="/milestones" />
          <MetricCard icon={<SendOutlined />} label="交付快照" value={data.deliveries.length} hint="冻结的评审材料" to="/deliveries" />
        </section>

        <section className="fl-dashboard-grid">
          <div className="fl-dashboard-main">
            <section className="fl-dashboard-panel">
              <div className="fl-section-head">
                <div><h2>继续推进</h2><p>按当前数据整理的工作流入口</p></div>
              </div>
              <div className="fl-work-list">
                <div className="fl-work-item">
                  <span className="fl-work-item-copy"><strong>确认项目基线</strong><span>{pendingBaseline ? `${pendingBaseline} 个项目尚未确定研发基线` : '所有项目都已确定基线'}</span></span>
                  <Button type="link" onClick={() => navigate('/projects')}>查看项目</Button>
                </div>
                <div className="fl-work-item">
                  <span className="fl-work-item-copy"><strong>核对需求关联</strong><span>{data.requirements.length - linkedRequirements} 个需求还没有关联版本</span></span>
                  <Button type="link" onClick={() => navigate('/requirements')}>打开需求</Button>
                </div>
                <div className="fl-work-item">
                  <span className="fl-work-item-copy"><strong>检查迭代风险</strong><span>{riskyMilestones ? `${riskyMilestones} 个迭代存在未完成项` : '当前迭代没有已知风险'}</span></span>
                  <Button type="link" onClick={() => navigate('/milestones')}>查看迭代</Button>
                </div>
                <div className="fl-work-item">
                  <span className="fl-work-item-copy"><strong>准备评审交付</strong><span>冻结版本范围并处理团队通知</span></span>
                  <Button type="link" onClick={() => navigate('/deliveries')}>进入交付</Button>
                </div>
              </div>
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
      </State>
    </main>
  );
}
