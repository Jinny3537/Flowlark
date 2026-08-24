import { useParams } from '@umijs/max';
import { Descriptions, List, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime, textOf } from '@/utils/format';

export default function DeliveryDetail() {
  const { name = '' } = useParams();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError('');
    try {
      setItem(await api.getSnapshot(name));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取交付快照');
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
        eyebrow="交付详情"
        title={item?.title || name}
        description="不可变交付快照及其冻结版本范围。"
        backTo="/deliveries"
      />
      <State loading={loading} error={error} onRetry={load} empty={!item} emptyText="没有找到交付快照">
        <div className="fl-detail-stack">
          <section className="fl-detail-summary">
            <Descriptions column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="标识"><span className="fl-mono">{name}</span></Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="success">已冻结</Tag></Descriptions.Item>
              <Descriptions.Item label="创建人">{textOf(item?.createdBy)}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{fmtTime(item?.createdAt)}</Descriptions.Item>
            </Descriptions>
          </section>
          <section className="fl-detail-section">
            <h2>冻结版本</h2>
            <List
              locale={{ emptyText: '快照中没有冻结版本' }}
              dataSource={item?.items || []}
              renderItem={(entry: any) => <List.Item>{entry.project} / {entry.versionNo || entry.no}</List.Item>}
            />
          </section>
        </div>
      </State>
    </main>
  );
}
