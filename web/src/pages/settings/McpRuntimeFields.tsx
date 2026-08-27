import { Alert, App, Button, Form, Input, Space } from 'antd';
import { SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { runtimeDiagnosticStatus } from './mcpModel.js';

type RuntimeValues = {
  command: string;
  argsText: string;
  baseUrl: string;
  account: string;
  expectedSha256: string;
};

type Props = {
  runtimeProfile: string;
  canWrite: boolean;
};

const EMPTY: RuntimeValues = {
  command: '',
  argsText: '[]',
  baseUrl: '',
  account: '',
  expectedSha256: '',
};

export function McpRuntimeFields({ runtimeProfile, canWrite }: Props) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<RuntimeValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [password, setPassword] = useState('');
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!runtimeProfile) {
      form.setFieldsValue(EMPTY);
      return;
    }
    setLoading(true);
    setError('');
    setDiagnostic(null);
    try {
      const value: any = await api.getMcpRuntime(runtimeProfile);
      form.setFieldsValue(value ? {
        command: value.command || '',
        argsText: JSON.stringify(value.args || [], null, 2),
        baseUrl: value.baseUrl || '',
        account: value.account || '',
        expectedSha256: value.expectedSha256 || '',
      } : EMPTY);
    } catch (nextError) {
      setError(errorText(nextError, '无法读取本机运行配置'));
    } finally {
      setLoading(false);
    }
  }, [form, runtimeProfile]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    let values: RuntimeValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    let args: unknown;
    try {
      args = JSON.parse(values.argsText || '[]');
      if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) throw new Error('参数必须是字符串数组');
    } catch (nextError) {
      form.setFields([{ name: 'argsText', errors: [errorText(nextError, '启动参数 JSON 不合法')] }]);
      return;
    }
    setSaving('profile');
    try {
      await api.saveMcpRuntime(runtimeProfile, {
        command: values.command.trim(),
        args,
        baseUrl: values.baseUrl.trim(),
        account: values.account.trim(),
        expectedSha256: values.expectedSha256.trim(),
      });
      message.success('本机运行配置已保存');
      await load();
    } catch (nextError) {
      message.error(errorText(nextError, '本机运行配置保存失败'));
    } finally {
      setSaving('');
    }
  }

  async function diagnose() {
    setSaving('diagnose');
    try {
      const result = await api.diagnoseMcpRuntime(runtimeProfile);
      setDiagnostic(result);
      const status = runtimeDiagnosticStatus(result);
      if (result.ready) message.success(status.label);
      else message.error(status.label);
    } catch (nextError) {
      message.error(errorText(nextError, '运行环境检查失败'));
    } finally {
      setSaving('');
    }
  }

  async function savePassword() {
    if (!password) return;
    setSaving('password');
    try {
      await api.setMcpRuntimePassword(runtimeProfile, password);
      setPassword('');
      message.success('平台密码已保存到系统钥匙串');
    } catch (nextError) {
      message.error(errorText(nextError, '平台密码保存失败'));
    } finally {
      setSaving('');
    }
  }

  function deletePassword() {
    modal.confirm({
      title: '删除本机平台密码？',
      content: '只删除系统钥匙串中的密码，不修改仓库配置或平台账号。',
      okText: '删除密码',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteMcpRuntimePassword(runtimeProfile);
        setPassword('');
        message.success('本机平台密码已删除');
      },
    });
  }

  if (!runtimeProfile) {
    return <Alert type="info" showIcon message="请先填写本机运行配置标识" />;
  }

  const status = diagnostic ? runtimeDiagnosticStatus(diagnostic) : null;
  return (
    <div className="fl-mcp-runtime" aria-busy={loading}>
      <div className="fl-mcp-subtitle">本机 stdio 运行配置</div>
      <p className="fl-muted">二进制路径、账号和平台地址只保存在本机；密码只进入系统钥匙串。</p>
      {error ? <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} /> : null}
      <Form<RuntimeValues> form={form} layout="vertical" disabled={!canWrite || loading} initialValues={EMPTY}>
        <Form.Item name="command" label="MCP 可执行文件" rules={[{ required: true, whitespace: true, message: '请填写可执行文件绝对路径' }]}>
          <Input className="fl-mono" placeholder="/opt/local/assess-task-mcp" />
        </Form.Item>
        <Form.Item name="argsText" label="启动参数 JSON">
          <Input.TextArea rows={2} className="fl-mono" spellCheck={false} />
        </Form.Item>
        <div className="fl-mcp-form-grid">
          <Form.Item name="baseUrl" label="平台地址" rules={[{ required: true, whitespace: true, message: '请填写平台地址' }]}>
            <Input placeholder="https://assess.example.com" />
          </Form.Item>
          <Form.Item name="account" label="个人平台账号" rules={[{ required: true, whitespace: true, message: '请填写个人平台账号' }]}>
            <Input autoComplete="username" />
          </Form.Item>
        </div>
        <Form.Item name="expectedSha256" label="期望 SHA-256" extra="可选；配置后文件哈希不一致将阻止运行。">
          <Input className="fl-mono" maxLength={64} />
        </Form.Item>
      </Form>
      <Form.Item label="平台密码" extra="已保存的密码不会回显。">
        <Input.Password value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
      </Form.Item>
      <Space wrap>
        <Button type="primary" loading={saving === 'profile'} disabled={!canWrite || Boolean(saving)} onClick={() => void save()}>保存本机配置</Button>
        <Button icon={<SafetyCertificateOutlined />} loading={saving === 'diagnose'} disabled={Boolean(saving)} onClick={() => void diagnose()}>检查可执行文件</Button>
        <Button loading={saving === 'password'} disabled={!canWrite || Boolean(saving) || !password} onClick={() => void savePassword()}>保存密码</Button>
        <Button danger disabled={!canWrite || Boolean(saving)} onClick={deletePassword}>删除密码</Button>
        <Button icon={<SyncOutlined />} disabled={Boolean(saving)} onClick={() => void load()}>刷新</Button>
      </Space>
      {status ? (
        <div aria-live="polite">
          <Alert
            className="fl-mcp-result"
            showIcon
            type={status.tone}
            message={status.label}
            description={status.messages.length ? <ul>{status.messages.map((item) => <li key={item}>{item}</li>)}</ul> : `SHA-256：${diagnostic.actualSha256 || '未读取'}`}
          />
        </div>
      ) : null}
    </div>
  );
}
