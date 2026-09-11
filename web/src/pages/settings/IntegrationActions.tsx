import { useState } from 'react';
import { Alert, App, Button, Input, Space } from 'antd';
import { api, type ConfigItem } from '@/services/api';
import { errorText } from '@/services/requestModel.js';

export function IntegrationActions({ kind, items, canWrite }: { kind: string; items: ConfigItem[]; canWrite: boolean }) {
  const { modal } = App.useApp();
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const value = (key: string) => items.find(item => item.key === `integrations.${key}`)?.value;
  const feedback = kind === 'feedback';
  const provider = String(value(feedback ? 'issueProvider' : 'notificationProvider') || 'none');
  const cli = !feedback && provider === 'wecom' && (value('wecomTransport') === 'cli' || Boolean(value('wecomChatId')));
  if (provider === 'none' || provider === 'markdown') return null;
  const run = async (action: () => Promise<unknown>, text: string) => {
    setBusy(true); setResult(null);
    try { await action(); setResult({ ok: true, text }); }
    catch (error) { setResult({ ok: false, text: errorText(error, '操作失败，请检查配置与授权') }); }
    finally { setBusy(false); }
  };
  const sendTest = () => {
    const template = String(value('notificationTemplate') || '');
    modal.confirm({
      title: `向 ${provider} 发送测试通知？`,
      content: <div><p>目标：{cli ? `企业微信会话 ${String(value('wecomChatId') || '未配置')}` : `${provider} 已保存的 Webhook（或环境变量配置）`}</p><p>使用已保存的模板：{template}</p><p>事件为 test，项目为当前工作区名称，其余字段为空。此操作会实际发送一条消息。</p></div>,
      okText: '发送测试通知',
      onOk: () => run(() => api.testNotification({ provider }), '测试通知已发送'),
    });
  };
  return <section className="fl-settings-section">
    <h2>{feedback ? '授权与连接测试' : '授权与发送测试'}</h2>
    <p>以下操作使用已保存配置。连接状态尚未验证；一次测试成功不代表实时在线。</p>
    {!cli ? <>
      <p>凭据仅保存在本机秘密存储，不写入工作区配置或 Git。不回显已有凭据；留空不会覆盖。</p>
      <Input.Password aria-label={feedback ? '平台访问令牌' : '通知 Webhook'} autoComplete="new-password" placeholder={feedback ? '输入平台访问令牌' : '输入通知 Webhook 地址'} value={secret} disabled={!canWrite || busy} onChange={event => setSecret(event.target.value)} />
      <Space wrap className="fl-settings-form-actions">
        <Button disabled={!canWrite || busy || !secret.trim()} onClick={() => void run(async () => {
          const clean = secret.trim();
          if (!feedback) { const url = new URL(clean); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook 必须使用 HTTP 或 HTTPS'); }
          if (feedback) await api.setIssueToken(provider, clean); else await api.setNotificationWebhook(provider, clean);
          setSecret('');
        }, '本机凭据已保存；请重新测试')}>保存凭据</Button>
        <Button danger disabled={!canWrite || busy} onClick={() => modal.confirm({ title: '移除本机凭据？', content: `仅移除 ${provider} 的本机凭据；环境变量中的凭据不受影响。`, onOk: () => run(() => feedback ? api.deleteIssueToken(provider) : api.deleteNotificationWebhook(provider), '本机凭据已移除') })}>移除本机凭据</Button>
      </Space>
    </> : <Alert type="info" showIcon message="企业微信 CLI 使用本机已有授权" description="CLI 命令与会话 ID 在上方配置。此渠道用于团队通知，正式发版邮件的收件人和模板仍由项目管理。" />}
    <Space wrap className="fl-settings-form-actions">
      <Button disabled={!canWrite || busy} loading={busy} onClick={() => feedback ? void run(() => api.testIssueIntegration(provider), `已验证 ${provider} 连接；验证时间 ${new Date().toLocaleString()}`) : sendTest()}>{feedback ? '测试已保存连接（只读）' : '发送测试通知…'}</Button>
    </Space>
    {result ? <Alert type={result.ok ? 'success' : 'error'} showIcon message={result.text} /> : null}
  </section>;
}
