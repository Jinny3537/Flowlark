import { useCallback, useEffect, useState } from 'react';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Descriptions, Space, Tag } from 'antd';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { fmtAbsolute } from '@/utils/format';
import { softwareUpdateState } from './settingsModel.js';
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
  const [verified, setVerified] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const load = useCallback(async (fetchRemote = false) => {
    setChecking(true);
    try {
      const next: any = await api.softwareUpdateStatus({ fetchRemote });
      setStatus(next);
      setVerified(fetchRemote && !next.error && Boolean(next.upstream));
    } catch (error) {
      setVerified(false);
      setStatus((current: any) => ({ ...current, error: errorText(error, '检测软件更新失败') }));
    } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const state = softwareUpdateState(status, { checking, applying, verified, restartNeeded });
  const statusText = restartNeeded ? '请重启 Flowlark，使已更新的软件生效。工作区数据未被此次软件更新替换。'
    : status?.error ? status.error
    : !status?.upstream ? '需要从有上游远端的 Git 软件目录启动。此处管理软件本身，不是工作区同步。'
    : status?.dirty ? '请先处理软件目录里的本地改动，系统不会强制覆盖。'
    : !verified ? '点击“检测更新”获取远端最新状态。当前信息仅来自本机。'
    : `最近检测：${fmtAbsolute(status.checkedAt)}。${status.available ? '更新完成后需要重启。' : ''}`;

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
          setRestartNeeded(Boolean(result.restartNeeded || result.updated));
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
        <Button aria-label="检测更新" icon={<ReloadOutlined />} loading={checking} disabled={applying || checking} onClick={() => void load(true)}>检测更新</Button>
      </div>

      {status?.error ? <Alert type="warning" showIcon message={status.error} className="fl-settings-status" /> : null}

      <Descriptions className="fl-update-info" bordered size="small" column={1}>
        <Descriptions.Item label="当前客户端版本"><code>{status?.currentVersion || version || '未知'}</code></Descriptions.Item>
        <Descriptions.Item label="远端软件版本"><code>{status?.latestVersion || '未检测'}</code></Descriptions.Item>
        <Descriptions.Item label="软件目录"><code>{status?.path || '未知'}</code></Descriptions.Item>
        <Descriptions.Item label="上游远端"><code>{status?.upstream || status?.remoteUrl || '未配置'}</code></Descriptions.Item>
        <Descriptions.Item label="更新状态">
          <Space wrap>
            <Tag>{state.title}</Tag>
            <Tag color={!status ? 'default' : status.dirty ? 'red' : 'green'}>{typeof status?.dirty !== 'boolean' ? '状态未知' : status.dirty ? '存在本地改动' : '目录干净'}</Tag>
          </Space>
        </Descriptions.Item>
      </Descriptions>

      <Alert
        className="fl-settings-status"
        type={state.type}
        showIcon
        message={state.title}
        description={statusText}
      />

      {status?.notes ? <pre className="fl-settings-notes">{status.notes}</pre> : null}

      <Button
        type="primary"
        aria-label="拉取并更新"
        icon={<CloudDownloadOutlined />}
        loading={applying}
        disabled={!canWrite || !state.canApply}
        onClick={confirmUpdate}
      >
        {applying ? '更新中...' : '拉取并更新'}
      </Button>
    </section>
  );
}
