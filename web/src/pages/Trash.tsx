import { App, Button, List, Tooltip } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtTime, textOf } from '@/utils/format';

export default function Trash() {
  const { message, modal } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.trash());
    } catch (nextError) {
      setError(errorText(nextError, '无法读取回收站'));
    } finally {
      setLoading(false);
    }
  }, []);

  const restore = useCallback((item: any) => {
    if (!writable) return;
    const versionNo = textOf(item.versionNo || item.no);
    modal.confirm({
      title: `恢复版本 ${versionNo}？`,
      content: '恢复后状态重置为编辑中，不会自动变回基线。',
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        setRestoring(item.dir || `${item.project}/${versionNo}`);
        try {
          await api.restoreVersion(item.project, versionNo);
          message.success(`${versionNo} 已恢复`);
          await load();
        } catch (nextError) {
          message.error(errorText(nextError, '恢复版本失败'));
        } finally {
          setRestoring('');
        }
      },
    });
  }, [load, message, modal, writable]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="fl-page">
      <PageHeader
        eyebrow="辅助入口"
        title="回收站"
        description="删除的版本完整保存在 .flowlark/trash/，可在版本号未被占用时恢复。"
      />
      <State loading={loading && !items.length} error={error} onRetry={load} empty={!items.length} emptyText="回收站是空的">
        <section className="fl-surface fl-list-surface" aria-label="已删除版本列表">
          <List
            rowKey={(item) => item.dir || `${item.project}/${textOf(item.versionNo || item.no)}`}
            loading={loading}
            dataSource={items}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Tooltip key="restore" title="恢复后状态重置为编辑中，不会自动变回基线">
                    <span>
                      <Button
                        size="small"
                        loading={restoring === (item.dir || `${item.project}/${textOf(item.versionNo || item.no)}`)}
                        disabled={!writable || Boolean(restoring)}
                        onClick={() => restore(item)}
                      >
                        恢复
                      </Button>
                    </span>
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  title={<span className="fl-table-title">{`${textOf(item.project)} / ${textOf(item.versionNo || item.no)}`}</span>}
                  description={`${fmtTime(item.deletedAt || item.updatedAt)} · ${textOf(item.deletedBy, '—')} 删除`}
                />
              </List.Item>
            )}
          />
        </section>
      </State>
    </main>
  );
}
