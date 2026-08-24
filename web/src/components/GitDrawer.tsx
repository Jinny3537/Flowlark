import { App, Alert, Button, Descriptions, Drawer, List, Space, Tag } from 'antd';
import { BranchesOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import { textOf } from '@/utils/format';

type GitDrawerProps = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

export function GitDrawer({ open, onClose, onChanged }: GitDrawerProps) {
  const { message } = App.useApp();
  const [status, setStatus] = useState<any>(null);
  const [doctor, setDoctor] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextDoctor] = await Promise.all([
        api.gitStatus({ fast: true }),
        api.gitDoctor().catch(() => null),
      ]);
      setStatus(nextStatus);
      setDoctor(nextDoctor);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取 Git 状态');
    } finally {
      setLoading(false);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const suggestion: any = await api.gitSuggestMessage().catch(() => null);
      await api.gitSync(suggestion?.message || 'chore: sync flowlark workspace');
      message.success('Git 同步已完成');
      await load();
      onChanged?.();
    } finally {
      setSyncing(false);
    }
  }, [load, message, onChanged]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  return (
    <Drawer
      width={520}
      title={<Space><BranchesOutlined />Git 状态</Space>}
      open={open}
      onClose={onClose}
      extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>}
    >
      {error ? <Alert className="fl-drawer-alert" type="error" showIcon message={error} /> : null}
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="跟踪状态">{status?.tracked ? '已纳入 Git' : '未纳入 Git'}</Descriptions.Item>
        <Descriptions.Item label="分支">{textOf(status?.branch, '-')}</Descriptions.Item>
        <Descriptions.Item label="工作区">{status?.clean ? '干净' : `${status?.files?.length || 0} 个改动`}</Descriptions.Item>
        <Descriptions.Item label="冲突">{status?.conflicts?.length || 0} 个</Descriptions.Item>
      </Descriptions>

      <Space className="fl-drawer-actions" wrap>
        <Button
          type="primary"
          icon={<SyncOutlined />}
          loading={syncing}
          disabled={!status?.tracked || Boolean(status?.conflicts?.length)}
          onClick={() => void sync()}
        >
          同步
        </Button>
        {doctor?.nextAction ? <Tag color="processing">{doctor.nextAction}</Tag> : null}
      </Space>

      {status?.conflicts?.length ? (
        <Alert
          className="fl-drawer-alert"
          type="error"
          showIcon
          message="存在冲突"
          description="需要先解决冲突，再继续同步。"
        />
      ) : null}

      <List
        className="fl-drawer-list"
        size="small"
        dataSource={status?.files || []}
        locale={{ emptyText: '没有未提交改动' }}
        renderItem={(item: any) => (
          <List.Item>
            <List.Item.Meta
              title={<span className="fl-mono">{textOf(item.path || item.file || item)}</span>}
              description={textOf(item.status || item.type)}
            />
          </List.Item>
        )}
      />
    </Drawer>
  );
}
