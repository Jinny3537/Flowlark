import {
  CopyOutlined,
  ReloadOutlined,
  RollbackOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  InputNumber,
  List,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import type { ConfigItem, HealthInfo } from '@/services/api';
import { SECTION_DESCRIPTIONS, bytesText } from './settingsConfig';

export type SettingsGroup = {
  key: string;
  label: string;
  items: ConfigItem[];
};

type WorkspaceSectionProps = {
  health: HealthInfo | null;
  workspaces: any;
  onCopy: (text: string) => void;
  onReload: () => void;
  onRemove: (path: string) => void;
};

type LanSectionProps = {
  lan: any;
  lanOn: boolean;
  readonlyOn: boolean;
  canWrite: boolean;
  busy: string;
  restartNeeded: boolean;
  onCopy: (text: string) => void;
  onSave: (key: string, value: unknown) => void;
};

type GitRemoteSectionProps = {
  remote: any;
  remoteUrl: string;
  canWrite: boolean;
  busy: string;
  onRemoteUrlChange: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
};

type ConfigGroupSectionProps = {
  group: SettingsGroup;
  canWrite: boolean;
  busy: string;
  onSave: (key: string, value: unknown) => void;
  onConfirmSave: (item: ConfigItem, value: unknown) => void;
  onReset: (key: string) => void;
};

export function WorkspaceSection({
  health,
  workspaces,
  onCopy,
  onReload,
  onRemove,
}: WorkspaceSectionProps) {
  return (
    <section className="fl-settings-section">
      <div className="fl-section-head">
        <div><h2>工作区</h2><p>{SECTION_DESCRIPTIONS.workspace}</p></div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={onReload}>刷新</Button>
        </Space>
      </div>
      <div className="fl-current-workspace">
        <div>
          <strong>当前工作区</strong>
          <code>{health?.repo || '尚未加载工作区'}</code>
        </div>
        <Button icon={<CopyOutlined />} disabled={!health?.repo} onClick={() => onCopy(health?.repo || '')}>复制路径</Button>
      </div>
      <Divider />
      <List
        dataSource={workspaces.items || []}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作区" /> }}
        renderItem={(item: any) => (
          <List.Item actions={[<Button key="remove" type="text" danger onClick={() => onRemove(item.path)}>移除</Button>]}>
            <List.Item.Meta title={item.name} description={<code>{item.path}</code>} />
            <Tag color={item.missing ? 'red' : item.mode === 'mirror' ? 'gold' : 'green'}>
              {item.missing ? '路径缺失' : item.mode === 'mirror' ? '只读镜像' : '可用'}
            </Tag>
          </List.Item>
        )}
      />
    </section>
  );
}

export function LanSection({ lan, lanOn, readonlyOn, canWrite, busy, restartNeeded, onCopy, onSave }: LanSectionProps) {
  return (
    <section className="fl-settings-section">
      <div className="fl-section-head">
        <div><h2>局域网分享</h2><p>{SECTION_DESCRIPTIONS.lan}</p></div>
        <Switch checked={lanOn} disabled={!canWrite} loading={busy === 'server.lan'} checkedChildren="开" unCheckedChildren="关" onChange={(value) => onSave('server.lan', value)} />
      </div>
      {lanOn && lan?.addresses?.length ? (
        <div className="fl-lan-list">
          {lan.addresses.map((address: any) => (
            <div className="fl-lan-address" key={address.address}>
              <code>{`http://${address.address}:${lan.port}`}</code>
              <span>{address.iface}</span>
              <Button icon={<CopyOutlined />} onClick={() => onCopy(`http://${address.address}:${lan.port}`)} />
            </div>
          ))}
        </div>
      ) : (
        <Alert type="info" showIcon message={lanOn ? '没有检测到局域网地址，可能没连网络' : '当前只监听 127.0.0.1，别人访问不到。'} />
      )}
      <Divider />
      <div className="fl-config-row">
        <div className="fl-config-copy">
          <strong>局域网只读</strong>
          <span>开启时局域网来的请求只能查看，写操作仅限运行 Flowlark 的这台机器。</span>
        </div>
        <Switch checked={readonlyOn} disabled={!canWrite} checkedChildren="开" unCheckedChildren="关" onChange={(value) => onSave('server.readonlyFromLan', value)} />
      </div>
      {restartNeeded ? <Alert type="warning" showIcon message="改动需要重启服务才生效" className="fl-settings-status" /> : null}
    </section>
  );
}

export function GitRemoteSection({ remote, remoteUrl, canWrite, busy, onRemoteUrlChange, onSave, onRemove }: GitRemoteSectionProps) {
  return (
    <section className="fl-settings-section">
      <div className="fl-section-head"><div><h2>Git 远端</h2><p>{SECTION_DESCRIPTIONS.gitRemote}</p></div></div>
      <Space.Compact className="fl-full-width">
        <Input value={remoteUrl} onChange={(e) => onRemoteUrlChange(e.target.value)} disabled={!canWrite} placeholder="git@github.com:team/prototypes.git" />
        <Button type="primary" disabled={!canWrite || !remoteUrl.trim()} loading={busy === 'gitRemote'} onClick={onSave}>保存</Button>
        <Button danger disabled={!canWrite || !remote} onClick={onRemove}>移除</Button>
      </Space.Compact>
      {remote ? <p className="fl-settings-help">当前：<code>{remote.url}</code></p> : null}
    </section>
  );
}

export function ConfigGroupSection({ group, canWrite, busy, onSave, onConfirmSave, onReset }: ConfigGroupSectionProps) {
  const renderControl = (item: ConfigItem) => {
    const disabled = !canWrite || busy === item.key;
    if (item.type === 'bool') {
      return <Switch checked={Boolean(item.value)} disabled={disabled} checkedChildren="开" unCheckedChildren="关" onChange={(value) => onConfirmSave(item, value)} />;
    }
    if (item.enum) {
      return (
        <Select
          value={String(item.value)}
          disabled={disabled}
          options={item.enum.map((value) => ({ value, label: value }))}
          onChange={(value) => onSave(item.key, value)}
        />
      );
    }
    if (item.type === 'port' || item.type === 'int') {
      return (
        <InputNumber
          value={Number(item.value)}
          disabled={disabled}
          min={item.min ?? 1}
          max={item.max ?? (item.type === 'port' ? 65535 : undefined)}
          onPressEnter={(event) => onSave(item.key, Number((event.target as HTMLInputElement).value))}
          onBlur={(event) => onSave(item.key, Number(event.target.value))}
        />
      );
    }
    if (item.type === 'list') {
      return (
        <Select
          mode="tags"
          value={Array.isArray(item.value) ? item.value.map(String) : []}
          disabled={disabled}
          placeholder="回车添加"
          onChange={(value) => onSave(item.key, value.join(','))}
        />
      );
    }
    return (
      <Input
        key={`${item.key}:${String(item.value)}`}
        className={item.type === 'bytes' ? 'fl-mono' : undefined}
        defaultValue={item.type === 'bytes' ? bytesText(item.value) : String(item.value ?? '')}
        disabled={disabled}
        placeholder={String(item.default || '')}
        onPressEnter={(event) => onSave(item.key, (event.target as HTMLInputElement).value)}
        onBlur={(event) => onSave(item.key, event.target.value)}
      />
    );
  };

  return (
    <section className="fl-settings-section">
      <div className="fl-section-head">
        <div>
          <h2>{group.label}</h2>
          <p>{SECTION_DESCRIPTIONS[group.key]}</p>
        </div>
      </div>
      <div className="fl-config-list">
        {group.items.map((item) => (
          <div className="fl-config-row" key={item.key}>
            <div className="fl-config-copy">
              <strong>
                {item.label}
                {item.danger ? <Tag color="red">高风险</Tag> : null}
                {!item.isDefault ? <Tag color="green">已修改</Tag> : null}
              </strong>
              {item.note ? <span>{item.note}</span> : null}
              <code>{item.key}</code>
            </div>
            <div className="fl-config-control">
              {renderControl(item)}
              {!item.isDefault && canWrite ? (
                <Tooltip title="恢复默认值">
                  <Button icon={<RollbackOutlined />} onClick={() => onReset(item.key)} />
                </Tooltip>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
