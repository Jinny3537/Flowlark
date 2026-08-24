import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  CalendarOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOutlined,
  InboxOutlined,
  MenuOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  BellOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import { App, Badge, Button, Drawer, Dropdown, Form, Grid, Input, Layout, List, Menu, Modal, Popover, Select, Space, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { errorText } from '@/services/requestModel.js';
import { useAppRuntime } from '@/runtime/AppRuntime';
import { GitDrawer } from './GitDrawer';

const { Header, Sider, Content } = Layout;

const navigation: MenuProps['items'] = [
  { key: 'actions', icon: <AppstoreOutlined />, label: '个人工作台' },
  { key: 'projects', icon: <FolderOutlined />, label: '项目' },
  { key: 'requirements', icon: <FileTextOutlined />, label: '需求' },
  { key: 'milestones', icon: <CalendarOutlined />, label: '迭代' },
  { key: 'deliveries', icon: <SendOutlined />, label: '交付' },
  { type: 'divider' },
  { key: 'watch', icon: <InboxOutlined />, label: '草稿箱' },
  { key: 'trash', icon: <DeleteOutlined />, label: '回收站' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];

const pageNames: Record<string, string> = {
  actions: '个人工作台',
  projects: '项目',
  requirements: '需求',
  milestones: '迭代',
  deliveries: '交付',
  watch: '草稿箱',
  trash: '回收站',
  settings: '设置',
};

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const { health, git, notifications, reload } = useAppRuntime();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [savingVersion, setSavingVersion] = useState(false);
  const [flushingNotifications, setFlushingNotifications] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<any>(null);
  const [versionForm] = Form.useForm();
  const selected = location.pathname.split('/')[1] || 'actions';
  const pageName = pageNames[selected] || '工作台';
  const canWrite = health?.canWrite !== false;
  const pendingNotifications = notifications.filter((item) => item.status === 'pending');
  const gitBadge = git?.conflicts?.length || git?.files?.length || 0;
  const gitTooltip = !git?.tracked
    ? '未纳入 Git'
    : git?.conflicts?.length
      ? `${git.conflicts.length} 个冲突待解决`
      : `${git.clean ? '工作区干净' : `${git.files?.length || 0} 处未提交改动`}（${git.cached ? '缓存状态，后台会刷新' : git.fast ? '快速状态，仅统计 Flowlark 文件' : '完整状态'}）`;

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    if (!health?.updateManifestUrl) {
      setUpdateAvailable(null);
      return () => { cancelled = true; };
    }
    void api.checkUpdate(health.version || '0.0.0', health.updateManifestUrl)
      .then((result: any) => {
        if (!cancelled) setUpdateAvailable(result.available ? result.manifest : null);
      })
      .catch(() => {
        if (!cancelled) setUpdateAvailable(null);
      });
    return () => { cancelled = true; };
  }, [health?.updateManifestUrl, health?.version]);

  const menu = useMemo(() => (
    <Menu
      className="fl-app-menu"
      mode="inline"
      selectedKeys={[selected]}
      items={navigation}
      onClick={({ key }) => navigate(`/${key}`)}
    />
  ), [navigate, selected]);

  const quickItems: MenuProps['items'] = [
    { key: 'version', icon: <FileTextOutlined />, label: '导入原型' },
    { key: 'requirement', icon: <FileTextOutlined />, label: '新建需求' },
    { key: 'milestone', icon: <CalendarOutlined />, label: '新建迭代' },
    { key: 'delivery', icon: <SendOutlined />, label: '创建交付快照' },
  ];

  const handleQuickCreate: MenuProps['onClick'] = async ({ key }) => {
    if (!canWrite) {
      message.info('当前是只读模式，不能创建内容');
      return;
    }
    if (key === 'version') {
      setVersionOpen(true);
      try {
        setProjects(await api.listProjects());
      } catch {
        setProjects([]);
      }
      return;
    }
    if (key === 'requirement') navigate('/requirements');
    if (key === 'milestone') navigate('/milestones');
    if (key === 'delivery') navigate('/deliveries');
  };

  const createVersion = async () => {
    const values = await versionForm.validateFields();
    setSavingVersion(true);
    try {
      let html = values.html;
      if (!html && values.url) {
        const imported: any = await api.importUrl(values.url);
        html = imported.html;
      }
      await api.addVersion(values.project, {
        versionNo: values.versionNo,
        title: values.title,
        html,
      });
      message.success(`版本 ${values.versionNo} 已导入`);
      setVersionOpen(false);
      versionForm.resetFields();
      navigate(`/projects/${encodeURIComponent(values.project)}/versions/${encodeURIComponent(values.versionNo)}`);
    } finally {
      setSavingVersion(false);
    }
  };

  const flushNotifications = async () => {
    setFlushingNotifications(true);
    try {
      await api.flushNotifications();
      message.success('通知队列已处理');
      await reload();
    } catch (nextError) {
      message.error(errorText(nextError, '通知重试失败'));
    } finally {
      setFlushingNotifications(false);
    }
  };

  const brand = (
    <button
      className="fl-brand"
      type="button"
      onClick={() => navigate('/actions')}
      aria-label="回到个人工作台"
    >
      <span className="fl-brand-mark" aria-hidden="true">
        <img src="/logo.svg" alt="" />
      </span>
      <span className="fl-brand-copy">
        <strong>Flowlark</strong>
        <small>{health?.repoName || '本地原型工作区'}</small>
      </span>
    </button>
  );

  const notificationContent = (
    <div className="fl-notification-popover">
      <List
        size="small"
        dataSource={pendingNotifications.slice(0, 4)}
        locale={{ emptyText: '暂无待重试通知' }}
        renderItem={(item: any) => (
          <List.Item extra={<Tag color="warning">待重试</Tag>}>
            <List.Item.Meta
              title={item.event?.event || '交付通知'}
              description={`${item.event?.project || '未知项目'} ${item.event?.version || item.event?.snapshot || ''}`.trim()}
            />
          </List.Item>
        )}
      />
      <Space className="fl-drawer-actions" wrap>
        <Button size="small" onClick={() => navigate('/deliveries')}>查看交付</Button>
        <Button
          size="small"
          type="primary"
          loading={flushingNotifications}
          disabled={!pendingNotifications.length}
          onClick={() => void flushNotifications()}
        >
          立即重试
        </Button>
      </Space>
    </div>
  );

  return (
    <Layout className="fl-app-shell">
      <a className="fl-skip-link" href="#main-content">跳到主要内容</a>
      {!mobile ? (
        <Sider width={240} theme="light" className="fl-app-sider">
          <div className="fl-sider-inner">
            {brand}
            <nav className="fl-primary-nav" aria-label="主要导航">{menu}</nav>
            <div className="fl-sider-status">
              <Badge status={health ? 'success' : 'default'} />
              <span>{health ? '本地服务运行中' : '本地服务未连接'}</span>
            </div>
          </div>
        </Sider>
      ) : null}

      <Layout className="fl-app-main">
        <Header className="fl-app-header">
          <div className="fl-header-leading">
            {mobile ? (
              <Tooltip title="打开导航">
                <Button
                  className="fl-header-icon"
                  type="text"
                  icon={<MenuOutlined />}
                  aria-label="打开导航"
                  onClick={() => setDrawerOpen(true)}
                />
              </Tooltip>
            ) : null}
            {mobile ? brand : null}
            {!mobile ? (
              <div className="fl-header-context">
                <span>工作区</span>
                <strong>{pageName}</strong>
              </div>
            ) : null}
          </div>
          <div className="fl-header-actions">
            <Tooltip title="全局搜索">
              <Button
                className="fl-header-search"
                icon={<SearchOutlined />}
                onClick={() => navigate('/search')}
              >
                {!mobile ? '搜索' : null}
              </Button>
            </Tooltip>
            <Dropdown menu={{ items: quickItems, onClick: handleQuickCreate }} trigger={['click']}>
              <Button type="primary" icon={<PlusOutlined />} disabled={!canWrite}>
                {!mobile ? '快速创建' : null}
              </Button>
            </Dropdown>
            <Popover content={notificationContent} title="待办与通知" trigger="click" placement="bottomRight">
              <Badge count={pendingNotifications.length} size="small">
                <Button
                  className="fl-header-icon"
                  type="text"
                  icon={<BellOutlined />}
                  aria-label="待办与通知"
                />
              </Badge>
            </Popover>
            <Tooltip title={gitTooltip}>
              <Badge count={gitBadge} size="small">
                <Button
                  className="fl-header-icon"
                  type="text"
                  icon={<BranchesOutlined />}
                  aria-label="Git 状态"
                  onClick={() => setGitOpen(true)}
                />
              </Badge>
            </Tooltip>
            <Tooltip title="设置">
              <Button
                className="fl-header-icon"
                type="text"
                icon={<SettingOutlined />}
                aria-label="设置"
                onClick={() => navigate('/settings')}
              />
            </Tooltip>
          </div>
          <div className="fl-header-status fl-runtime-tags" aria-label="运行状态">
            <span className={`fl-status-dot ${health ? 'is-online' : ''}`} aria-hidden="true" />
            <span>{health ? '已连接' : '离线'}</span>
            {health?.canWrite === false ? (
              <Tooltip title={health.readonlyReason === 'git'
                ? '当前 Git 身份没有远端写权限，写操作已被禁用。'
                : '当前视图只读，写操作仅限运行 Flowlark 的机器。'}>
                <Tag color="warning">{health.readonlyReason === 'git' ? 'Git 只读' : '只读'}</Tag>
              </Tooltip>
            ) : null}
            {health?.lan ? <Tag color="cyan">局域网已开放</Tag> : null}
            {health?.version ? <code>v{health.version}</code> : null}
            {updateAvailable?.version ? <Tag color="cyan">可更新至 {updateAvailable.version}</Tag> : null}
          </div>
        </Header>

        <Content id="main-content" className="fl-app-content">
          {children}
        </Content>
      </Layout>

      <Drawer
        className="fl-mobile-nav"
        placement="left"
        size="min(86vw, 320px)"
        open={drawerOpen}
        title={brand}
        onClose={() => setDrawerOpen(false)}
      >
        <nav aria-label="移动端主要导航">{menu}</nav>
        <div className="fl-sider-status">
          <Badge status={health ? 'success' : 'default'} />
          <span>{health ? '本地服务运行中' : '本地服务未连接'}</span>
        </div>
      </Drawer>
      <GitDrawer open={gitOpen} onClose={() => setGitOpen(false)} onChanged={reload} />
      <Modal
        title="导入原型版本"
        open={versionOpen}
        confirmLoading={savingVersion}
        onOk={createVersion}
        onCancel={() => setVersionOpen(false)}
        destroyOnClose
      >
        <Form form={versionForm} layout="vertical">
          <Form.Item name="project" label="项目" rules={[{ required: true, message: '请选择项目' }]}>
            <Select
              showSearch
              options={projects.map((item) => ({ value: item.slug, label: `${item.name} · ${item.slug}` }))}
              placeholder="选择项目"
            />
          </Form.Item>
          <Form.Item name="versionNo" label="版本号" rules={[{ required: true, message: '请填写版本号' }]}>
            <Input className="fl-mono" placeholder="v1.2" />
          </Form.Item>
          <Form.Item name="title" label="标题"><Input /></Form.Item>
          <Form.Item name="url" label="从 URL 导入"><Input placeholder="https://example.com/prototype.html" /></Form.Item>
          <Form.Item
            name="html"
            label="或粘贴 HTML"
            dependencies={['url']}
            rules={[({ getFieldValue }) => ({
              validator(_, value) {
                if (value || getFieldValue('url')) return Promise.resolve();
                return Promise.reject(new Error('请填写 URL 或粘贴 HTML'));
              },
            })]}
          >
            <Input.TextArea rows={6} placeholder="<!doctype html>..." />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
