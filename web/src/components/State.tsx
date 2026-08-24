import { Alert, Button, Empty, Skeleton } from 'antd';
import type { ReactNode } from 'react';

type StateProps = {
  loading?: boolean;
  empty?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyText?: string;
  children: ReactNode;
};

export function State({ loading, empty, error, onRetry, emptyText = '暂无数据', children }: StateProps) {
  if (loading) {
    return (
      <div className="fl-state fl-state-loading" aria-label="正在加载">
        <Skeleton active title paragraph={{ rows: 5 }} />
      </div>
    );
  }
  if (error) {
    return (
      <Alert
        className="fl-state"
        type="error"
        showIcon
        message="内容加载失败"
        description={error}
        action={onRetry ? <Button onClick={onRetry}>重试</Button> : null}
      />
    );
  }
  if (empty) {
    return (
      <div className="fl-state fl-state-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      </div>
    );
  }
  return <>{children}</>;
}
