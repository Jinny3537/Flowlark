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
import { App, Badge, Button, Drawer, Dropdown, Form, Grid, Input, Layout, Menu, Modal, Select, Space, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type HealthInfo } from '@/services/api';
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
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [git, setGit] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [gitOpen, setGitOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [savingVersion, setSavingVersion] = useState(false);
  const [versionForm] = Form.useForm();
  const selected = location.pathname.split('/')[1] || 'actions';
  const pageName = pageNames[selected] || '工作台';
  const canWrite = health?.canWrite !== false;
  const pendingNotifications = notifications.filter((item) => item.status === 'pending');
  const gitBadge = git?.conflicts?.length || git?.files?.length || 0;

  const loadShell = useMemo(() => async () => {
    const [nextHealth, nextGit, nextNotifications] = await Promise.all([
      api.health().catch(() => null),
      api.gitStatus({ fast: true, cache: true }).catch(() => null),
      api.listNotifications().catch(() => []),
    ]);
    setHealth(nextHealth);
    setGit(nextGit);
    setNotifications(nextNotifications);
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
    await api.flushNotifications();
    message.success('通知队列已处理');
    await loadShell();
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
            <Tooltip title={pendingNotifications.length ? '通知待重试' : '暂无待重试通知'}>
              <Badge count={pendingNotifications.length} size="small">
                <Button
                  className="fl-header-icon"
                  type="text"
                  icon={<BellOutlined />}
                  aria-label="待办与通知"
                  onClick={() => pendingNotifications.length ? void flushNotifications() : navigate('/deliveries')}
                />
              </Badge>
            </Tooltip>
            <Tooltip title={git?.tracked ? `${gitBadge} 个 Git 项` : 'Git 状态'}>
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
          <div className="fl-header-status" aria-label="运行状态">
            <span className={`fl-status-dot ${health ? 'is-online' : ''}`} aria-hidden="true" />
            <span>{health ? '已连接' : '离线'}</span>
            {health?.version ? <code>v{health.version}</code> : null}
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
      <GitDrawer open={gitOpen} onClose={() => setGitOpen(false)} onChanged={loadShell} />
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
