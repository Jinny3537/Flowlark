import { useParams } from '@umijs/max';
import { Descriptions, List, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { textOf } from '@/utils/format';

export default function MilestoneDetail() {
  const { name = '' } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      setItem(await api.getMilestone(name));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取迭代详情');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="迭代详情"
        title={item?.title || name}
        description="查看周期、交付状态和本轮版本范围。"
        backTo="/milestones"
      />
      <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到迭代">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="标识"><span className="fl-mono">{name}</span></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={item?.ready ? 'success' : 'warning'}>{item?.ready ? '可交付' : '有风险'}</Tag></Descriptions.Item>
              <Descriptions.Item label="开始">{textOf(item?.startAt)}</Descriptions.Item>
              <Descriptions.Item label="结束">{textOf(item?.endAt)}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="fl-detail-section">
            <h2>版本范围</h2>
            <List
              locale={{ emptyText: '本轮还没有版本' }}
              dataSource={item?.items || []}
              renderItem={(entry: any) => <List.Item>{entry.project} / {entry.versionNo || entry.no}</List.Item>}
            />
          </section>
        </div>
      </State>
    </main>
  );
}
