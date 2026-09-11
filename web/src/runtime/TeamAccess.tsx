import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Radio, Space, Spin, Typography } from 'antd';
import { api } from '@/services/api';
import { useAppRuntime } from './AppRuntime';

export const roleLabels: Record<string, string> = { guest: '游客', product: '产品', developer: '研发', tester: '测试' };
type Session = { enabled: boolean; host: boolean; role: string | null; id: string | null; kinds: string[] };
const Context = createContext<{ session: Session | null; refresh: () => Promise<void> }>({ session: null, refresh: async () => {} });
export const useTeamAccess = () => useContext(Context);
let pendingSession: Promise<Session> | null = null;
function loadSession() {
  if (!pendingSession) pendingSession = api.teamSession().finally(() => { pendingSession = null; });
  return pendingSession;
}

export function TeamAccess({ children }: { children: ReactNode }) {
  const { reload } = useAppRuntime();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState<string>();
  const [busy, setBusy] = useState(false);
  const previous = useRef('');
  const refresh = useCallback(async () => {
    try {
      const next = await loadSession();
      setSession(next);
      setError('');
      const signature = JSON.stringify(next);
      if (previous.current !== signature) { previous.current = signature; await reload(); }
    } catch (e) { setError(e instanceof Error ? e.message : '无法读取协作角色'); }
  }, [reload]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const choose = async () => {
    if (!role) return;
    setBusy(true);
    try { await api.chooseTeamRole(role); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '无法保存角色'); }
    finally { setBusy(false); }
  };
  if (!session || (session.enabled && !session.host && !session.role)) return (
    <main style={{ maxWidth: 540, margin: '10vh auto', padding: 24 }}>
      <Card title="进入团队工作台">
        {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}
        {!session ? <Spin aria-label="读取协作模式" /> : <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Typography.Paragraph>无需登录。请选择本次协作身份，浏览器会记住选择；之后如需修改，请联系主机。</Typography.Paragraph>
          <Radio.Group value={role} onChange={(event) => setRole(event.target.value)} aria-label="协作角色">
            <Space direction="vertical">
              <Radio value="guest">游客 · 浏览、评论、下载</Radio>
              <Radio value="developer">研发 · 反馈开发进度</Radio>
              <Radio value="tester">测试 · 提交问题与验收结果</Radio>
            </Space>
          </Radio.Group>
          <Button type="primary" block loading={busy} disabled={!role} onClick={() => void choose()}>确认角色并进入</Button>
        </Space>}
      </Card>
    </main>
  );
  return <Context.Provider value={{ session, refresh }}>
    {error ? <Alert type="warning" message={error} /> : null}{children}
  </Context.Provider>;
}
