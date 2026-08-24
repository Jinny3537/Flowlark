import { Button, List, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { api } from '@/services/api';
import { fmtTime, textOf } from '@/utils/format';

export default function WatchInbox() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.watchInbox());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取草稿箱');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="导入暂存"
        title="草稿箱"
        description="查看待处理的导入内容和 AI 草稿。"
        actions={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}
      />
      <State loading={loading} error={error} onRetry={load} empty={!items.length} emptyText="还没有草稿">
        <section className="fl-surface fl-list-surface">
          <List
            dataSource={items}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={<span className="fl-table-title">{textOf(item.title || item.name, '未命名草稿')}</span>}
                  description={`${fmtTime(item.updatedAt || item.createdAt)} · ${textOf(item.status)}`}
                />
                <Tag>{textOf(item.type, '草稿')}</Tag>
              </List.Item>
            )}
          />
        </section>
      </State>
    </main>
  );
}
