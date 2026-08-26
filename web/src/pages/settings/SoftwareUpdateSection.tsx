import { useCallback, useEffect, useState } from 'react';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Descriptions, Space, Tag } from 'antd';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtAbsolute } from '@/utils/format';
import { SECTION_DESCRIPTIONS } from './settingsConfig';

type SoftwareUpdateSectionProps = {
  canWrite: boolean;
  version?: string;
};

export function SoftwareUpdateSection({ canWrite, version }: SoftwareUpdateSectionProps) {
  const { message, modal } = App.useApp();
  const [status, setStatus] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async (fetchRemote = false) => {
    setChecking(true);
    try {
      setStatus(await api.softwareUpdateStatus({ fetchRemote }));
    } catch (error) {
      setStatus((current: any) => ({ ...current, error: errorText(error, '检测软件更新失败') }));
    } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusTitle = !status
    ? '正在读取软件更新状态'
    : !status.tracked
      ? '当前软件目录不可自动更新'
      : status.dirty
        ? '软件目录存在本地改动'
        : status.available
          ? '检测到可用更新'
          : '当前已是最新版本';

  const statusText = !status
    ? '正在检查当前 Flowlark 软件目录。'
    : !status.tracked
      ? '需要从 Git 克隆的 Flowlark 软件目录启动，才能使用远端拉取更新。'
      : status.dirty
        ? '请先提交或清理软件目录里的本地改动，再执行自动更新。'
        : status.available
          ? `${status.behind ? `远端领先 ${status.behind} 个提交。` : ''}更新后请重启 Flowlark。`
          : status.checkedAt
            ? `最近检测：${fmtAbsolute(status.checkedAt)}`
            : '点击“检测更新”可重新拉取远端状态。';

  const confirmUpdate = () => {
    modal.confirm({
      title: '拉取并更新 Flowlark？',
      content: '更新完成后需要重启服务。未提交的软件目录改动会阻止更新。',
      okText: '拉取并更新',
      onOk: async () => {
        setApplying(true);
        try {
          const result: any = await api.pullSoftwareUpdate();
          message.success(result.message || '软件已更新，请重启 Flowlark');
          await load(true);
        } catch (error) {
          message.error(errorText(error, '软件更新失败'));
          throw error;
        } finally { setApplying(false); }
      },
    });
  };

  return (
    <section className="fl-settings-section">
      <div className="fl-section-head">
        <div><h2>软件更新</h2><p>{SECTION_DESCRIPTIONS.softwareUpdate}</p></div>
        <Button icon={<ReloadOutlined />} loading={checking} onClick={() => void load(true)}>检测更新</Button>
      </div>

      {status?.error ? <Alert type="warning" showIcon message={status.error} className="fl-settings-status" /> : null}

      <Descriptions className="fl-update-info" bordered size="small" column={1}>
        <Descriptions.Item label="当前客户端版本"><code>{status?.currentVersion || version || '未知'}</code></Descriptions.Item>
        <Descriptions.Item label="远端软件版本"><code>{status?.latestVersion || '未检测'}</code></Descriptions.Item>
        <Descriptions.Item label="软件目录"><code>{status?.path || '未知'}</code></Descriptions.Item>
        <Descriptions.Item label="上游远端"><code>{status?.upstream || status?.remoteUrl || '未配置'}</code></Descriptions.Item>
        <Descriptions.Item label="更新状态">
          <Space wrap>
            <Tag color={status?.available ? 'green' : 'default'}>{!status ? '尚未检测' : status.available ? '有可用更新' : '暂无更新'}</Tag>
            <Tag color={!status ? 'default' : status.dirty ? 'red' : 'green'}>{!status ? '状态未知' : status.dirty ? '存在本地改动' : '目录干净'}</Tag>
          </Space>
        </Descriptions.Item>
      </Descriptions>

      <Alert
        className="fl-settings-status"
        type={status?.dirty ? 'warning' : status?.available ? 'success' : 'info'}
        showIcon
        message={statusTitle}
        description={statusText}
      />

      {status?.notes ? <pre className="fl-settings-notes">{status.notes}</pre> : null}

      <Button
        type="primary"
        icon={<CloudDownloadOutlined />}
        loading={applying}
        disabled={!canWrite || !status?.available || Boolean(status?.dirty) || applying}
        onClick={confirmUpdate}
      >
        {applying ? '更新中...' : '拉取并更新'}
      </Button>
    </section>
  );
}
