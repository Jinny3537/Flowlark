import {
  BranchesOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { App, Alert, Button, Divider, Drawer, Form, Input, List, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { canWriteGit, gitStage, syncLabel } from './gitModel.js';

type GitDrawerProps = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

const emptyStatus = {
  tracked: false,
  clean: true,
  files: [],
  foreignFiles: [],
  conflicts: [],
};

export function GitDrawer({ open, onClose, onChanged }: GitDrawerProps) {
  const { message } = App.useApp();
  const { health } = useAppRuntime();
  const [form] = Form.useForm();
  const [status, setStatus] = useState<any>(emptyStatus);
  const [doctor, setDoctor] = useState<any>(null);
  const [permission, setPermission] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [steps, setSteps] = useState<any[]>([]);
  const [briefText, setBriefText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextDoctor: any = await api.gitDoctor();
      setDoctor(nextDoctor);
      if (nextDoctor.stage === 'no-git' || nextDoctor.stage === 'no-repo') {
        setStatus(emptyStatus);
        setPermission(null);
        setConflicts([]);
        return;
      }

      const [nextStatus, nextConflicts] = await Promise.all([
        api.gitStatus(),
        api.gitConflicts(),
      ]);
      setStatus(nextStatus);
      setPermission(nextStatus.permission || null);
      setConflicts(nextConflicts || []);
      if (nextDoctor.identity) {
        const current = form.getFieldsValue(['name', 'email']);
        form.setFieldsValue({
          name: current.name || nextDoctor.identity.name || '',
          email: current.email || nextDoctor.identity.email || '',
        });
      }
    } catch (nextError) {
      setError(errorText(nextError, '无法读取 Git 状态'));
    } finally {
      setLoading(false);
    }
  }, [form]);

  const writable = canWriteGit(health?.canWrite !== false, permission);
  const stage = gitStage(doctor, { ...status, conflicts });
  const needIdentity = Boolean(
    doctor
    && stage !== 'no-repo'
    && stage !== 'no-git'
    && doctor.identity
    && !doctor.identity.complete,
  );

  const guard = useCallback(async <T,>(
    action: () => Promise<T>,
    success?: string | ((result: T) => string),
    allowReadonly = false,
  ) => {
    if (!allowReadonly && !writable) {
      message.info('当前是只读模式，不能执行 Git 写操作');
      return null;
    }
    setBusy(true);
    try {
      const result = await action();
      if (success) message.success(typeof success === 'function' ? success(result) : success);
      await load();
      onChanged?.();
      return result;
    } catch (nextError) {
      message.error(errorText(nextError, 'Git 操作失败'));
      return null;
    } finally {
      setBusy(false);
    }
  }, [load, message, onChanged, writable]);

  const initialize = () => guard(
    () => api.gitInit(form.getFieldsValue()),
    (result: any) => result.needIdentity ? '仓库已建立，还差提交身份' : '已纳入 Git 管理',
  );
  const saveIdentity = () => guard(
    () => api.gitSetIdentity(form.getFieldsValue(['name', 'email'])),
    '身份已保存',
  );
  const refreshPermission = () => guard(
    () => api.refreshGitPermission(),
    (result: any) => result.mode === 'readonly' ? '已刷新：当前身份只读' : '已刷新 Git 写权限',
    true,
  );
  const pickBaseline = (slug: string, versionNo: string) => guard(
    () => api.gitResolve(slug, versionNo),
    `已把 ${slug} 的基线定为 ${versionNo}`,
  );
  const markResolved = (path: string) => guard(
    () => api.gitMarkResolved([path]),
    '已标记为解决',
  );
  const continueSync = () => guard(async () => {
    const result: any = await api.gitContinue();
    if (result.conflicts?.length) message.warning(result.message || '仍有冲突需要处理');
    else message.success(result.message || '同步已继续完成');
    return result;
  });
  const abortSync = () => guard(() => api.gitAbort(), '已回到同步之前的状态');
  const sync = () => guard(async () => {
    const result: any = await api.gitSync(commitMessage);
    setSteps(result.steps || []);
    if (result.conflicted) message.warning(result.message || '产生了冲突，下面可以逐个处理');
    else message.success(result.message || '已同步');
    setCommitMessage('');
    return result;
  });

  const fillSuggestion = async () => {
    setBusy(true);
    try {
      const result: any = await api.gitSuggestMessage();
      if (result.message) setCommitMessage(result.message);
      else message.info('没有待提交的改动');
    } catch (nextError) {
      message.error(errorText(nextError, '无法生成提交说明'));
    } finally {
      setBusy(false);
    }
  };

  const copyBrief = async (intent: 'commit' | 'conflict') => {
    setBusy(true);
    try {
      const result: any = await api.gitBrief(intent);
      const text = String(result?.text || '');
      setBriefText(text);
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        message.success('已复制，粘给你的 AI 助理即可');
      } catch {
        message.error('浏览器不允许复制，请手动选中下面的文本');
      }
    } catch (nextError) {
      message.error(errorText(nextError, '无法生成 Git 说明'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSteps([]);
      setBriefText('');
      void load();
    }
  }, [load, open]);

  const checks = doctor?.checks || [];
  const renderCheckIcon = (level: string) => {
    if (level === 'ok') return <CheckCircleOutlined style={{ color: 'var(--pw-color-success)' }} />;
    if (level === 'warn') return <ExclamationCircleOutlined style={{ color: 'var(--pw-color-warning)' }} />;
    return <CloseCircleOutlined style={{ color: 'var(--pw-color-danger)' }} />;
  };

  const brief = briefText ? (
    <Input.TextArea
      aria-label="Git 助理说明"
      readOnly
      autoSize={{ minRows: 5, maxRows: 12 }}
      value={briefText}
    />
  ) : null;

  const permissionStatus = permission?.mode === 'readonly' ? (
    <Alert
      className="fl-drawer-alert"
      type="warning"
      showIcon
      message="当前 Git 身份是只读"
      description="Flowlark 已提前拦截写操作，避免产生推不上去的本地改动。"
      action={<Button size="small" loading={busy} onClick={() => void refreshPermission()}>刷新</Button>}
    />
  ) : permission ? (
    <Space className="fl-drawer-actions" wrap>
      <Typography.Text type="secondary">Git 写权限：</Typography.Text>
      <Tag color={permission.mode === 'writable' ? 'success' : 'default'}>
        {permission.mode === 'writable' ? '可写' : '未探测，暂按可写'}
      </Tag>
      <Button size="small" type="text" loading={busy} onClick={() => void refreshPermission()}>刷新探测</Button>
    </Space>
  ) : null;

  let content;
  if (stage === 'no-git') {
    content = (
      <>
        <Alert
          type="error"
          showIcon
          message="系统里没有找到 Git"
          description="macOS 在终端运行 xcode-select --install 即可安装；其他系统见 git-scm.com/downloads。装好后回来重新检测。"
        />
        <Button className="fl-drawer-actions" block icon={<ReloadOutlined />} onClick={() => void load()}>重新检测</Button>
      </>
    );
  } else if (stage === 'no-repo') {
    content = (
      <>
        <Alert
          type="info"
          showIcon
          message="这个仓库还没纳入 Git"
          description="纳入之后，团队协作、历史追溯、冲突处理都由 Git 承担。下面一步完成初始化、身份和首次提交。"
        />
        <Form form={form} layout="vertical" className="fl-drawer-actions" onFinish={() => void initialize()}>
          <Form.Item name="name" label="你的名字" rules={[{ required: true, message: '请填写提交姓名' }]}>
            <Input placeholder="提交记录上显示的名字" />
          </Form.Item>
          <Form.Item name="email" label="你的邮箱" rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}>
            <Input placeholder="name@example.com" />
          </Form.Item>
          <Form.Item name="remote" label="远端地址">
            <Input placeholder="可留空，之后在设置里配也行" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy} disabled={!writable}>纳入 Git 管理</Button>
        </Form>
      </>
    );
  } else if (needIdentity) {
    content = (
      <>
        {permissionStatus}
        <Alert
          type="warning"
          showIcon
          message="还没有配置提交身份"
          description="Git 需要知道每次提交是谁做的，没有身份它会拒绝提交。填一次就好。"
        />
        <Form form={form} layout="vertical" className="fl-drawer-actions" onFinish={() => void saveIdentity()}>
          <Form.Item name="name" label="你的名字" rules={[{ required: true, message: '请填写提交姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="你的邮箱" rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy} disabled={!writable}>保存身份</Button>
        </Form>
      </>
    );
  } else if (stage === 'conflicted') {
    content = (
      <>
        {permissionStatus}
        <Alert
          type={conflicts.length ? 'warning' : 'success'}
          showIcon
          message={conflicts.length ? `${conflicts.length} 个文件需要处理` : '冲突都解决了，还差最后一步'}
          description={conflicts.length
            ? '基线冲突可以直接选一边；其余的用编辑器改完，回来点“我改好了”。'
            : '点下面的按钮，让这次同步走完。'}
        />

        {conflicts.map((conflict) => (
          <section className="fl-git-conflict" key={conflict.path}>
            {conflict.assisted && conflict.choices ? (
              <>
                <Typography.Paragraph><strong>{conflict.project}</strong> 的基线两边指向了不同版本</Typography.Paragraph>
                <Space wrap>
                  <Button disabled={!writable || busy} onClick={() => void pickBaseline(conflict.project, conflict.choices.mine)}>
                    保留 <strong className="fl-mono">{conflict.choices.mine}</strong>（你这边）
                  </Button>
                  <Button disabled={!writable || busy} onClick={() => void pickBaseline(conflict.project, conflict.choices.others)}>
                    保留 <strong className="fl-mono">{conflict.choices.others}</strong>（对方）
                  </Button>
                </Space>
              </>
            ) : (
              <>
                <Typography.Text className="fl-mono">{conflict.path}</Typography.Text>
                <Typography.Paragraph type="secondary">
                  {conflict.kind} 冲突，用编辑器打开，把不要的那一半连同分隔标记删掉。
                </Typography.Paragraph>
                <Button size="small" loading={busy} disabled={!writable} onClick={() => void markResolved(conflict.path)}>我改好了</Button>
              </>
            )}
          </section>
        ))}

        <Divider />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button type="primary" block loading={busy} disabled={!writable || conflicts.length > 0} onClick={() => void continueSync()}>
            继续完成同步
          </Button>
          <Button block icon={<CopyOutlined />} loading={busy} onClick={() => void copyBrief('conflict')}>复制给 AI 助理</Button>
          <Popconfirm
            title="回到同步之前的状态？"
            description="本地已提交的内容不会丢。"
            okText="放弃"
            cancelText="再想想"
            onConfirm={() => void abortSync()}
          >
            <Button block danger type="text" disabled={!writable || busy}>放弃这次同步</Button>
          </Popconfirm>
          {brief}
        </Space>
      </>
    );
  } else {
    const files = status?.files || [];
    const foreignFiles = status?.foreignFiles || [];
    const syncDisabled = !writable || busy || (status?.clean && !status?.ahead && !status?.behind);
    content = (
      <>
        {permissionStatus}
        <Divider />

        {!status?.clean ? (
          <section aria-label="待提交的改动">
            <Typography.Text type="secondary">待提交的改动</Typography.Text>
            <List
              size="small"
              dataSource={files.slice(0, 15)}
              renderItem={(file: any) => (
                <List.Item>
                  <List.Item.Meta
                    title={<span className="fl-mono">{file.path}</span>}
                    description={file.label || file.code}
                  />
                </List.Item>
              )}
            />
            {files.length > 15 ? <Typography.Text type="secondary">还有 {files.length - 15} 处改动</Typography.Text> : null}
          </section>
        ) : (
          <Alert className="fl-drawer-alert" type="success" showIcon message="工作区没有待提交改动" />
        )}

        {foreignFiles.length ? (
          <Alert
            className="fl-drawer-alert"
            type="info"
            showIcon
            message={`另有 ${foreignFiles.length} 个文件不归 Flowlark 管，不会被提交`}
          />
        ) : null}

        <Input
          value={commitMessage}
          placeholder="提交说明（留空则自动生成）"
          disabled={!writable || busy}
          onChange={(event) => setCommitMessage(event.target.value)}
          onPressEnter={() => { if (!syncDisabled) void sync(); }}
        />
        <Button type="text" disabled={status?.clean || busy} onClick={() => void fillSuggestion()}>帮我写一条</Button>
        <Button type="primary" block icon={<SyncOutlined />} loading={busy} disabled={syncDisabled} onClick={() => void sync()}>
          {syncLabel(status)}
        </Button>

        {steps.length ? (
          <div className="fl-git-steps" aria-label="Git 操作步骤">
            {steps.map((step, index) => (
              <div className="fl-git-check" key={`${step.name}-${index}`}>
                {step.ok
                  ? <CheckCircleOutlined style={{ color: 'var(--pw-color-success)' }} />
                  : <CloseCircleOutlined style={{ color: 'var(--pw-color-danger)' }} />}
                <div>
                  <div>{step.name}</div>
                  {step.detail ? <Typography.Text type="secondary">{step.detail}</Typography.Text> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <Divider />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button block icon={<CopyOutlined />} loading={busy} onClick={() => void copyBrief('commit')}>复制给 AI 助理</Button>
          <Typography.Text type="secondary">
            复制的是仓库处境和容易踩错的约定，不含任何原型内容。
          </Typography.Text>
          {brief}
        </Space>
      </>
    );
  }

  return (
    <Drawer
      width={520}
      title={<Space><BranchesOutlined />Git 状态</Space>}
      open={open}
      onClose={onClose}
      extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>}
    >
      <Spin spinning={loading}>
        {error ? <Alert className="fl-drawer-alert" type="error" showIcon message={error} /> : null}
        {checks.length ? (
          <div className="fl-git-checks" aria-label="Git 体检结果">
            {checks.map((check: any, index: number) => (
              <div className="fl-git-check" key={`${check.title}-${index}`}>
                {renderCheckIcon(check.level)}
                <div>
                  <div>{check.title}</div>
                  {check.detail ? <Typography.Text type="secondary">{check.detail}</Typography.Text> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {doctor && stage !== 'no-git' && stage !== 'no-repo' ? (
          <Space className="fl-drawer-actions" wrap aria-label="Git 状态来源">
            <Tag color="processing">{status?.branch || '未命名分支'}</Tag>
            <Typography.Text type="secondary">
              {status?.cached ? '缓存状态，后台会刷新' : status?.fast ? '快速状态，仅统计 Flowlark 文件' : '完整状态'}
            </Typography.Text>
          </Space>
        ) : null}
        {doctor ? content : null}
      </Spin>
    </Drawer>
  );
}
