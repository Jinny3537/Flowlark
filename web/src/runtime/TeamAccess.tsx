import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Radio, Space, Spin, Typography } from 'antd';
import { WechatOutlined, UserOutlined } from '@ant-design/icons';
import { api } from '@/services/api';
import { useAppRuntime } from './AppRuntime';

export const roleLabels: Record<string, string> = { guest: '游客', product: '产品', developer: '研发', tester: '测试' };
type Session = { enabled: boolean; host: boolean; role: string | null; id: string | null; kinds: string[]; wechatAvailable: boolean; wechatUnavailableReason?: string; user: { provider: string; name: string } | null };
const Context = createContext<{ session: Session | null; refresh: (fresh?: boolean) => Promise<void> }>({ session: null, refresh: async () => {} });
export const useTeamAccess = () => useContext(Context);
let pendingSession: Promise<Session> | null = null;
async function loadSession(fresh = false) {
  if (fresh && pendingSession) await pendingSession.catch(() => {});
  if (!pendingSession) pendingSession = api.teamSession().finally(() => { pendingSession = null; });
  return pendingSession;
}

export function TeamAccess({ children }: { children: ReactNode }) {
  const { reload } = useAppRuntime();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).has('login_error') ? '微信登录未完成或已过期，请重新登录，也可以游客访问。' : '');
  const [sessionError, setSessionError] = useState('');
  const refreshSequence = useRef(0);
  const [entry, setEntry] = useState<'login' | 'guest'>('login');
  const [role, setRole] = useState<string>();
  const [busy, setBusy] = useState(false);
  const previous = useRef('');
  const refresh = useCallback(async (fresh = false) => {
    const sequence = ++refreshSequence.current;
    try {
      const next = await loadSession(fresh);
      if (sequence !== refreshSequence.current) return;
      const prior = previous.current ? JSON.parse(previous.current) : null;
      if ((prior?.role || prior?.user) && !next.role && !next.user) { setEntry('login'); setRole(undefined); }
      setSession(next);
      setSessionError('');
      const signature = JSON.stringify(next);
      if (previous.current !== signature) { previous.current = signature; await reload(); }
    } catch (e) { if (sequence === refreshSequence.current) setSessionError(e instanceof Error ? e.message : '无法读取协作角色'); }
  }, [reload]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    const focus = () => void refresh();
    const pageshow = () => { setBusy(false); void refresh(true); };
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('pageshow', pageshow); };
  }, [refresh]);
  const login = async () => {
    setBusy(true); setError('');
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    try { const result = await api.startWechatLogin(window.location.hash.slice(1) || '/actions'); window.location.assign(result.url); }
    catch (e) { setError(e instanceof Error ? e.message : '无法发起微信登录'); setBusy(false); }
  };
  const choose = async () => {
    if (!role) return;
    setBusy(true); setError('');
    try { await api.chooseTeamRole(role); window.history.replaceState(null, '', window.location.pathname + window.location.hash); await refresh(true); }
    catch (e) { setError(e instanceof Error ? e.message : '无法保存角色'); }
    finally { setBusy(false); }
  };
  if (!session || (session.enabled && !session.host && !session.role)) return (
    <main style={{ maxWidth: 540, margin: '10vh auto', padding: 24 }}>
      <Card title="进入团队工作台">
        {sessionError ? <Alert type="error" showIcon message={sessionError} action={<Button onClick={() => void refresh(true)}>重试</Button>} /> : null}
        {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}
        {!session ? <Spin aria-label="读取协作模式" /> : <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>欢迎使用 Flowlark</Typography.Title>
          {session.user ? <Alert type="success" showIcon message={`${session.user.name}，微信登录成功`} description="请选择协作角色，开始参与项目。" /> : <>
            <Radio.Group value={entry} onChange={event => setEntry(event.target.value)} optionType="button" buttonStyle="solid" aria-label="访问方式" options={[{ label: '用户登录', value: 'login' }, { label: '游客访问', value: 'guest' }]} />
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {entry === 'login' ? '使用微信扫码登录，登录后仍可选择协作角色。' : '无需账号，选择本次协作角色即可进入。浏览器会记住你的选择。'}
            </Typography.Paragraph>
          </>}
          {!session.user && entry === 'login' ? <>
            {!session.wechatAvailable ? <Alert type="info" showIcon message="微信登录暂未开通" description={session.wechatUnavailableReason || '请联系主机完成配置，或选择游客访问。'} /> : null}
            <Button type="primary" block icon={<WechatOutlined />} loading={busy} disabled={!session.wechatAvailable} onClick={() => void login()}>微信扫码登录</Button>
            <Button block icon={<UserOutlined />} onClick={() => setEntry('guest')}>以游客身份继续</Button>
          </> : <>
          <Radio.Group value={role} onChange={(event) => setRole(event.target.value)} aria-label="协作角色">
            <Space direction="vertical">
              <Radio value="guest">游客 · 浏览、评论、下载</Radio>
              <Radio value="developer">研发 · 反馈开发进度</Radio>
              <Radio value="tester">测试 · 提交问题与验收结果</Radio>
            </Space>
          </Radio.Group>
          <Button type="primary" block loading={busy} disabled={!role} onClick={() => void choose()}>确认角色并进入</Button>
          <Typography.Text type="secondary">角色确定后如需调整，请联系主机。</Typography.Text>
          {session.user ? <Button onClick={async () => { try { await api.logoutTeam(); await refresh(true); } catch (e) { setError(e instanceof Error ? e.message : '退出失败'); } }}>退出登录</Button> : null}
          </>}
        </Space>}
      </Card>
    </main>
  );
  return <Context.Provider value={{ session, refresh }}>
    {sessionError ? <Alert type="warning" message={sessionError} /> : null}
    {error ? <Alert type="warning" message={error} closable onClose={() => setError('')} /> : null}{children}
  </Context.Provider>;
}
