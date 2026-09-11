import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Empty, Radio, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { roleLabels, useTeamAccess } from '@/runtime/TeamAccess';

type TeamSectionProps = {
  lan: any;
  lanOn: boolean;
  canWrite: boolean;
  networkBusy: boolean;
  onSaveLan: (enabled: boolean) => Promise<void>;
  onCopy: (value: string) => Promise<void>;
};

export function TeamSection({ lan, lanOn, canWrite, networkBusy, onSaveLan, onCopy }: TeamSectionProps) {
  const { session, refresh } = useTeamAccess();
  const { message } = App.useApp();
  const [visitors, setVisitors] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { setVisitors(session?.host && session.enabled ? await api.teamVisitors() : []); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setLoading(false); }
  }, [session?.host, session?.enabled]);
  useEffect(() => { void load(); }, [load]);
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); await refresh(); await load(); message.success('已保存'); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <>
    {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重试</Button>} /> : null}
    <div className="fl-section-stack">
      <section className="fl-settings-section">
        <div className="fl-section-head">
          <div><h2>访问设置</h2><p>开放局域网后，团队成员可通过工作台地址访问。</p></div>
          <Switch aria-label="开放局域网访问" checkedChildren="开" unCheckedChildren="关" checked={lanOn} disabled={!session?.host || !canWrite || busy} loading={networkBusy} onChange={(enabled) => void change(() => onSaveLan(enabled))} />
        </div>
        {lan && lanOn !== lan.enabled ? <Alert type="warning" showIcon className="fl-settings-status" message={`配置已保存，重启后${lanOn ? '开放' : '关闭'}局域网访问`} description={`当前服务${lan.enabled ? '仍已开放' : '尚未开放'}。若使用 --lan 启动，请同步调整启动参数。`} /> : null}
        {lan?.enabled && lan.addresses?.length ? <div className="fl-lan-list">
          {lan.addresses.map((address: any) => {
            const url = `${window.location.protocol}//${address.address}:${lan.port}`;
            return <div className="fl-lan-address" key={address.address}>
              <code>{url}</code><span>{address.iface}</span>
              <Button aria-label={`复制工作台地址 ${address.address}`} icon={<CopyOutlined />} onClick={() => void onCopy(url).catch((e) => setError(e instanceof Error ? e.message : '复制失败'))}>复制</Button>
            </div>;
          })}
        </div> : <Alert type="info" showIcon message={lan?.enabled ? '当前已开放，暂未检测到局域网地址，请检查网络连接。' : '当前仅供本机使用，开放并重启后可分享工作台地址。'} />}
      </section>
      <section className="fl-settings-section">
        <div className="fl-section-head"><div><h2>协作方式</h2><p>访问权限立即生效，不影响已保存的角色和历史记录。</p></div></div>
        <Radio.Group aria-label="协作方式" value={session?.enabled ? 'roles' : 'readonly'} disabled={!session?.host || busy || networkBusy} onChange={(event) => void change(() => api.setTeamMode(event.target.value === 'roles'))}>
          <Space direction="vertical" size="middle">
            <Radio value="readonly">只读分享 · 浏览、下载</Radio>
            <Radio value="roles">角色协作 · 按角色评论、反馈进度和提交测试结果</Radio>
          </Space>
        </Radio.Group>
        {session?.enabled ? <>
        <div className="fl-config-row">
          <div className="fl-config-copy"><strong>首次访问角色</strong><span>成员自行选择，后续仅主机可调整。</span></div>
          <Space wrap size={4}><Tag>游客</Tag><Tag>研发</Tag><Tag>测试</Tag></Space>
        </div>
        </> : <p className="fl-settings-help">访客无需选择角色，仅可浏览和下载，不能提交或修改内容。</p>}
        <div className="fl-config-row">
          <div className="fl-config-copy"><strong>数据同步</strong><span>产品独立编辑，协作记录通过 Git 交换。</span></div>
          {session?.host ? <Link to="/settings/gitRemote">Git 远端设置</Link> : null}
        </div>
        {session?.enabled ? <p className="fl-settings-help">评论、开发进度、测试问题及验收结果，请在版本详情的「团队协作」页签提交。</p> : null}
      </section>
      {session?.host && session.enabled ? <section className="fl-settings-section">
        <div className="fl-section-head">
          <div><h2>访问者角色</h2><p>管理已访问此主机的浏览器及其协作角色。</p></div>
          <Button aria-label="刷新访客" icon={<ReloadOutlined />} loading={loading} disabled={busy} onClick={() => void load()}>刷新访客</Button>
        </div>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          loading={loading}
          dataSource={visitors}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无远程访客，分享工作台地址即可开始协作" /> }}
          columns={[
            { title: '访问者', key: 'visitor', render: (_, item) => <Tooltip title={item.id}><span className="fl-mono">{item.id.slice(0, 8)}</span></Tooltip> },
            { title: '访问 IP', dataIndex: 'ip', responsive: ['sm'], render: (ip) => <span className="fl-mono">{ip || '未知 IP'}</span> },
            { title: '协作角色', key: 'role', width: 148, render: (_, item) => (
              <Select aria-label={`调整访客 ${item.id.slice(0, 8)} 的角色`} value={item.role || undefined} placeholder="分配角色" disabled={busy} className="fl-full-width"
                options={['guest', 'developer', 'tester'].map((value) => ({ value, label: roleLabels[value] }))}
                onChange={(role) => void change(() => api.setVisitorRole(item.id, role))} />
            ) },
          ]}
        />
        <p className="fl-settings-help">每个浏览器独立记忆角色，IP 仅辅助识别；清除浏览器数据后将作为新访客访问。</p>
      </section> : null}
    </div>
  </>;
}
