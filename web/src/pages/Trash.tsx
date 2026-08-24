import { List, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime, textOf } from '@/utils/format';

export default function Trash() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.trash());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取回收站');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader eyebrow="辅助入口" title="回收站" description="查看已删除或废弃的版本记录。" />
      <State loading={loading} error={error} onRetry={load} empty={!items.length} emptyText="回收站是空的">
        <section className="fl-surface fl-list-surface">
          <List
            dataSource={items}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={<span className="fl-table-title">{`${textOf(item.project)} / ${textOf(item.versionNo || item.no)}`}</span>}
                  description={fmtTime(item.deletedAt || item.updatedAt)}
                />
                <Tag color="default">{textOf(item.status, '已删除')}</Tag>
              </List.Item>
            )}
          />
        </section>
      </State>
    </main>
  );
}
