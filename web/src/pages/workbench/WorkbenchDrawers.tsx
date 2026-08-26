import { Drawer, Empty, Spin, Tag, Timeline } from 'antd';
import { fmtTime, textOf } from '@/utils/format';
import styles from './VersionWorkbench.module.css';

type VersionHistoryDrawerProps = {
  open: boolean;
  commits: any[];
  loading?: boolean;
  onClose: () => void;
};

export function VersionHistoryDrawer({
  open,
  commits,
  loading = false,
  onClose,
}: VersionHistoryDrawerProps) {
  return (
    <Drawer
      open={open}
      title="这一版的演进历史"
      width={520}
      destroyOnHidden
      onClose={onClose}
    >
      <Spin spinning={loading}>
        {!loading && commits.length === 0 ? (
          <Empty description="还没有 Git 提交记录">
            <span className="fl-muted">把仓库纳入 Git 并提交后，这里会显示每次改动</span>
          </Empty>
        ) : (
          <Timeline
            className={styles.historyTimeline}
            items={commits.map((commit) => ({
              children: (
                <article className={styles.historyItem}>
                  <strong>{textOf(commit.subject, '未命名提交')}</strong>
                  <div className={styles.historyMeta}>
                    <code>{textOf(commit.short || commit.hash)}</code>
                    <span>{textOf(commit.author)}</span>
                    <span>{fmtTime(commit.date)}</span>
                  </div>
                  {commit.kinds?.length ? (
                    <div className={styles.historyKinds}>
                      {commit.kinds.map((kind: string) => <Tag key={kind}>{kind}</Tag>)}
                    </div>
                  ) : null}
                </article>
              ),
            }))}
          />
        )}
      </Spin>
    </Drawer>
  );
}
