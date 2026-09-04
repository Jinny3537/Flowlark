import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Radio,
  Select,
  Space,
} from 'antd';
import { ApiOutlined, SaveOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  MANAGED_FIELD_OPTIONS,
  projectSyncForm,
  projectSyncPayload,
  trustedModeMessage,
} from './projectSyncModel.js';

type SyncValues = {
  mode: 'manual' | 'trusted-auto';
  server: string;
  projectId: string;
  managedFields: string[];
};

type McpServer = {
  id: string;
  name?: string;
  enabled?: boolean;
};

type McpInfo = {
  config?: { servers?: McpServer[] };
};

const READINESS_REQUIREMENTS = [
  'MCP 连接测试通过',
  '远端写权限已验证',
  '创建与更新行为已验证',
  '状态回写行为已验证',
  '重复请求的幂等行为已验证',
];

export default function ProjectSyncSettings() {
  const navigate = useNavigate();
  const { slug = '' } = useParams();
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const writable = health?.canWrite !== false;
  const [form] = Form.useForm<SyncValues>();
  const [project, setProject] = useState<any>(null);
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mcpError, setMcpError] = useState('');

  const serverOptions = useMemo(() => (mcpInfo?.config?.servers || [])
    .filter((server) => server.enabled !== false)
    .map((server) => ({ value: server.id, label: server.name ? `${server.name}（${server.id}）` : server.id })), [mcpInfo]);

  const loadMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpError('');
    try {
      setMcpInfo(await api.getMcpConfig());
    } catch (nextError) {
      setMcpError(errorText(nextError, '无法读取 MCP 配置'));
    } finally {
      setMcpLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMcpLoading(true);
    setError('');
    setMcpError('');
    const [projectResult, mcpResult] = await Promise.allSettled([
      api.getProject(slug),
      api.getMcpConfig(),
    ]);
    if (projectResult.status === 'fulfilled') {
      setProject(projectResult.value);
      form.setFieldsValue(projectSyncForm(projectResult.value?.sync));
    } else {
      setError(errorText(projectResult.reason, '无法读取项目'));
    }
    if (mcpResult.status === 'fulfilled') {
      setMcpInfo(mcpResult.value);
    } else {
      setMcpError(errorText(mcpResult.reason, '无法读取 MCP 配置'));
    }
    setLoading(false);
    setMcpLoading(false);
  }, [form, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    let values: SyncValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateProject(slug, projectSyncPayload(values));
      setProject(updated);
      form.setFieldsValue(projectSyncForm(updated?.sync));
      message.success('项目同步设置已保存');
    } catch (nextError) {
      message.error(errorText(nextError, '项目同步设置保存失败'));
    } finally {
      setSaving(false);
    }
  }, [form, message, slug]);

  return (
    <main className="fl-page fl-project-sync-page">
      <PageHeader
        eyebrow="项目配置"
        title={project ? `${project.name} · 同步设置` : '项目同步设置'}
        description="配置外部项目绑定、同步模式与由 Flowlark 管理的字段。"
        backTo="/projects"
      />
      <State loading={loading} error={error} onRetry={load} empty={!project} emptyText="项目不存在">
        <div className="fl-project-sync-layout">
          <section className="fl-settings-section">
            <div className="fl-section-head">
              <div>
                <h2>同步策略</h2>
                <p>设置会保存在当前项目数据中，不会创建新的外部连接。</p>
              </div>
              <Button icon={<ApiOutlined />} onClick={() => navigate('/settings/mcp')}>MCP 中心</Button>
            </div>

            {!writable ? (
              <Alert
                className="fl-settings-status"
                type="info"
                showIcon
                message="只读模式"
                description="当前视图不可写，不能保存项目同步设置。"
              />
            ) : null}
            {mcpError ? (
              <Alert
                className="fl-settings-status"
                type="warning"
                showIcon
                message="MCP 配置加载失败"
                description="项目数据和当前绑定值已保留。可继续查看或重试加载服务列表。"
                action={<Button size="small" loading={mcpLoading} onClick={() => void loadMcp()}>重试</Button>}
              />
            ) : null}
            <Alert
              className="fl-project-sync-version-note"
              type="info"
              showIcon
              message="v0.7.2 本页只保存项目级同步准备数据"
              description="这里保存按项目的 MCP 服务、外部项目 ID 和托管字段。当前里程碑执行仍使用 MCP 中心的“迭代能力映射”；真正按项目应用这些字段从 v0.7.3 开始。"
            />

            <Form<SyncValues>
              className="fl-project-sync-form"
              form={form}
              layout="vertical"
              disabled={!writable}
              initialValues={projectSyncForm()}
            >
              <Form.Item name="mode" label="同步模式" rules={[{ required: true, message: '请选择同步模式' }]}>
                <Radio.Group className="fl-project-sync-modes">
                  <Radio value="manual">
                    <span><strong>手动确认</strong><small>生成计划后，由用户确认执行。</small></span>
                  </Radio>
                  <Radio value="trusted-auto">
                    <span><strong>可信自动（准备配置）</strong><small>仅保存未来自动化所需的策略。</small></span>
                  </Radio>
                </Radio.Group>
              </Form.Item>

              <div className="fl-project-sync-fields">
                <Form.Item name="server" label="MCP 服务" extra="这里只显示仓库 MCP 配置中已启用的服务。">
                  <Select
                    allowClear
                    loading={mcpLoading}
                    options={serverOptions}
                    placeholder={mcpError ? '服务列表暂不可用' : '选择已启用的 MCP 服务'}
                  />
                </Form.Item>
                <Form.Item name="projectId" label="外部项目 ID">
                  <Input maxLength={200} placeholder="例如：42 或 PROJECT-KEY" />
                </Form.Item>
              </div>

              <Form.Item
                name="managedFields"
                label="托管字段"
                extra="为 v0.7.3 起的按项目同步声明托管范围。"
              >
                <Checkbox.Group className="fl-project-sync-managed" options={MANAGED_FIELD_OPTIONS} />
              </Form.Item>

              <Form.Item noStyle shouldUpdate={(before, after) => before.mode !== after.mode}>
                {({ getFieldValue }) => getFieldValue('mode') === 'trusted-auto' ? (
                  <Alert
                    className="fl-project-sync-trusted-alert"
                    type="warning"
                    showIcon
                    message="v0.7.2 不会自动执行同步"
                    description={trustedModeMessage({ ready: false })}
                  />
                ) : null}
              </Form.Item>

              <div className="fl-project-sync-actions">
                <Space wrap>
                  <Button onClick={() => navigate('/projects')}>取消</Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    disabled={!writable}
                    onClick={() => void save()}
                  >
                    保存设置
                  </Button>
                </Space>
              </div>
            </Form>
          </section>

          <aside className="fl-settings-section fl-project-sync-readiness">
            <div className="fl-section-head">
              <div>
                <h2>可信自动准备条件</h2>
                <p>这些能力必须全部通过验证，才具备未来启用自动执行的基础。</p>
              </div>
            </div>
            <ul>
              {READINESS_REQUIREMENTS.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <Alert
              type="info"
              showIcon
              message="激活边界：v0.7.5"
              description="即使准备条件全部满足，v0.7.2 也只保存配置，不会自动执行同步。请前往 MCP 中心创建服务并测试能力。"
            />
          </aside>
        </div>
      </State>
    </main>
  );
}
