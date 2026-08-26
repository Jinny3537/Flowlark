import { useNavigate } from 'react-router-dom';
import { App, Button, List, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { WATCH_STATUS, statusMeta } from '@/domain/status.js';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';

export default function WatchInbox() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.watchInbox());
    } catch (nextError) {
      setError(errorText(nextError, '无法读取草稿箱'));
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(async (item: any) => {
    setBusy(item.id);
    try {
      await api.retryWatchItem(item.id);
      message.success('已重新归档');
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '重新归档失败'));
    } finally {
      setBusy('');
    }
  }, [load, message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="导入暂存"
        title="草稿箱"
        description="自动归档成功后可进入版本补充变更日志；失败项会保留原因并允许重试。"
        actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>}
      />
      <State loading={loading && !items.length} error={error} onRetry={load} empty={!items.length} emptyText="还没有草稿">
        <section className="fl-surface fl-list-surface" aria-label="草稿箱列表">
          <List
            rowKey="id"
            loading={loading}
            dataSource={items}
            renderItem={(item) => {
              const status = statusMeta(WATCH_STATUS, item.status);
              const action = item.status === 'archived' ? (
                <Button
                  key="open"
                  size="small"
                  disabled={!item.project || !item.versionNo}
                  onClick={() => navigate(`/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}`)}
                >
                  打开版本
                </Button>
              ) : item.status === 'failed' ? (
                <Button
                  key="retry"
                  size="small"
                  loading={busy === item.id}
                  disabled={!writable || (Boolean(busy) && busy !== item.id)}
                  onClick={() => void retry(item)}
                >
                  重试
                </Button>
              ) : null;
              return (
                <List.Item actions={action ? [action] : undefined}>
                  <List.Item.Meta
                    title={<span className="fl-table-title">{textOf(item.title, '未命名草稿')}</span>}
                    description={(
                      <div className="fl-watch-details">
                        <span className="fl-mono">{textOf(item.filename, '未记录文件名')}</span>
                        <span>项目：{textOf(item.project)} · 建议版本：{textOf(item.suggestedVersionNo)}</span>
                        {item.error ? <span className="fl-inline-error" role="alert">失败原因：{textOf(item.error)}</span> : null}
                        <span>收集于 {fmtTime(item.collectedAt)}</span>
                      </div>
                    )}
                  />
                  <Tag color={status.color}>{status.label}</Tag>
                </List.Item>
              );
            }}
          />
        </section>
      </State>
    </main>
  );
}
