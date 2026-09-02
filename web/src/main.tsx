import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/global.css';

import { AppShell } from './components/AppShell';
import { AppRuntimeProvider } from './runtime/AppRuntime';
import ActionCenter from './pages/ActionCenter';
import Compare from './pages/Compare';
import Deliveries from './pages/Deliveries';
import DeliveryDetail from './pages/DeliveryDetail';
import Milestones from './pages/Milestones';
import MilestoneDetail from './pages/MilestoneDetail';
import NotFound from './pages/NotFound';
import PrototypeEditor from './pages/PrototypeEditor';
import ProjectVersions from './pages/ProjectVersions';
import Projects from './pages/Projects';
import RequirementDetail from './pages/RequirementDetail';
import Requirements from './pages/Requirements';
import Settings from './pages/Settings';
import Search from './pages/Search';
import Trash from './pages/Trash';
import VersionWorkbench from './pages/VersionWorkbench';
import WatchInbox from './pages/WatchInbox';

function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/actions" replace />} />
        <Route path="/actions" element={<ActionCenter />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:slug" element={<ProjectVersions />} />
        <Route path="/projects/:slug/compare" element={<Compare />} />
        <Route path="/projects/:slug/versions/:versionNo" element={<VersionWorkbench />} />
        <Route path="/search" element={<Search />} />
        <Route path="/requirements" element={<Requirements />} />
        <Route path="/requirements/:code" element={<RequirementDetail />} />
        <Route path="/milestones" element={<Milestones />} />
        <Route path="/milestones/:name" element={<MilestoneDetail />} />
        <Route path="/deliveries" element={<Deliveries />} />
        <Route path="/deliveries/:name" element={<DeliveryDetail />} />
        <Route path="/watch" element={<WatchInbox />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
        <Route path="/oplog" element={<Navigate to="/settings/oplog" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function RootRoutes() {
  return (
    <Routes>
      <Route path="/projects/:slug/versions/:versionNo/edit" element={<PrototypeEditor />} />
      <Route path="*" element={<AppRoutes />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        cssVar: true,
        token: {
          colorPrimary: '#328D61',
          colorInfo: '#3B82F6',
          colorSuccess: '#328D61',
          colorWarning: '#D99A22',
          colorError: '#D94A4A',
          colorText: '#151B18',
          colorTextSecondary: '#5F6B66',
          colorBorder: '#E5EBE7',
          colorBgLayout: '#F7F9F8',
          colorBgContainer: '#FFFFFF',
          borderRadius: 8,
          borderRadiusLG: 12,
          controlHeight: 38,
          fontSize: 14,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
          boxShadow: '0 12px 32px rgba(17, 24, 20, 0.08)',
          boxShadowSecondary: '0 4px 12px rgba(17, 24, 20, 0.06)',
        },
        components: {
          Button: { primaryShadow: 'none', borderRadius: 8 },
          Card: { headerFontSize: 14, borderRadiusLG: 12 },
          Layout: { bodyBg: '#F7F9F8', headerBg: 'transparent', siderBg: 'transparent' },
          Menu: { itemBorderRadius: 8, itemHeight: 40, itemMarginInline: 12 },
          Modal: { borderRadiusLG: 16 },
          Table: { headerBg: '#F7F9F8', headerColor: '#5F6B66' },
        },
      }}
    >
      <AntApp>
        <HashRouter>
          <AppRuntimeProvider>
            <RootRoutes />
          </AppRuntimeProvider>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
