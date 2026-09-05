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
import { ProjectAcceptanceRules } from '@/components/ProjectAcceptanceRules';
import { State } from '@/components/State';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import {
  MANAGED_FIELD_OPTIONS,
  projectSyncForm,
  projectSyncChanged,
  projectSyncPayload,
  projectSyncReadiness,
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
  type?: string;
  adapter?: string;
  runtimeProfile?: string;
};

type McpInfo = {
  problems?: string[];
  config?: {
    servers?: McpServer[];
    capabilities?: { milestones?: { enabled?: boolean } };
  };
};

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
  const watched = Form.useWatch([], form) as SyncValues | undefined;

  const serverOptions = useMemo(() => (mcpInfo?.config?.servers || [])
    .filter((server) => server.enabled !== false)
    .map((server) => ({ value: server.id, label: server.name ? `${server.name}（${server.id}）` : server.id })), [mcpInfo]);
  const dirty = useMemo(() => projectSyncChanged(project?.sync, watched || project?.sync), [project?.sync, watched]);
  const readiness = useMemo(() => projectSyncReadiness(watched || project?.sync, mcpInfo || {}), [mcpInfo, project?.sync, watched]);

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
    const invalidatesPreview = projectSyncChanged(project?.sync, values);
    try {
      const updated = await api.updateProject(slug, projectSyncPayload(values));
      setProject(updated);
      form.setFieldsValue(projectSyncForm(updated?.sync));
      message.success(invalidatesPreview ? '项目同步设置已保存；已有同步预览已失效' : '项目同步设置已保存');
    } catch (nextError) {
      message.error(errorText(nextError, '项目同步设置保存失败'));
    } finally {
      setSaving(false);
    }
  }, [form, message, project?.sync, slug]);

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
                <p>这里的服务、项目 ID 与托管字段会直接决定后续同步计划。</p>
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
            {dirty ? (
              <Alert
                className="fl-project-sync-version-note"
                role="alert"
                type="warning"
                showIcon
                message="保存后，已有同步预览将失效"
                description="服务、外部项目 ID 或托管字段已经变化。请保存后回到相关迭代重新生成预览。"
              />
            ) : null}

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
                    <span><strong>手动确认</strong><small>生成计划、审阅差异，再由用户确认执行。</small></span>
                  </Radio>
                  <Radio value="trusted-auto" disabled>
                    <span><strong>可信自动（尚未开放）</strong><small>预计 v0.7.5 提供；当前不可选择或保存。</small></span>
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
                <Form.Item name="projectId" label="外部项目 ID" rules={[{ validator: (_, value) => !value || (/^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) ? Promise.resolve() : Promise.reject(new Error('Assess Task 项目 ID 必须是正整数')) }]}>
                  <Input maxLength={16} inputMode="numeric" placeholder="例如：42" />
                </Form.Item>
              </div>

              <Form.Item
                name="managedFields"
                label="托管字段"
                extra="只有选中的字段会由 Flowlark 比较并写回平台。"
              >
                <Checkbox.Group className="fl-project-sync-managed" options={MANAGED_FIELD_OPTIONS} />
              </Form.Item>

              <Alert
                className="fl-project-sync-trusted-alert"
                type="info"
                showIcon
                message="所有远端写入仍需人工确认"
                description={trustedModeMessage({ ready: readiness.connection.state === 'ready' })}
              />

              <div className="fl-project-sync-actions">
                <Space wrap>
                  <Button onClick={() => navigate('/projects')}>取消</Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    disabled={!writable || !dirty}
                    onClick={() => void save()}
                  >
                    保存设置
                  </Button>
                </Space>
              </div>
            </Form>
          </section>

          <aside className="fl-settings-section fl-project-sync-readiness" aria-live="polite">
            <div className="fl-section-head">
              <div>
                <h2>连接与权限</h2>
                <p>配置可用和平台授权是两件事；这里只展示当前已知事实。</p>
              </div>
            </div>
            <div className="fl-project-sync-status-list">
              {[{ name: '连接配置', ...readiness.connection }, { name: '平台写权限', ...readiness.permission }].map((status) => (
                <div className={`fl-project-sync-status is-${status.state}`} key={status.name}>
                  <span>{status.name}</span>
                  <strong>{status.label}</strong>
                  <small>{status.detail}</small>
                </div>
              ))}
            </div>
            <Button block icon={<ApiOutlined />} onClick={() => navigate('/settings/mcp')}>前往 MCP 中心验证</Button>
          </aside>
        </div>
        <ProjectAcceptanceRules slug={slug} value={project?.acceptance} writable={writable} onSaved={setProject} />
      </State>
    </main>
  );
}
