import { useMemo, useState } from 'react';
import { Button, Empty, Input, List, Space, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { sortProjectsByRecent } from './recentWorkModel.js';
import { fmtTime } from '@/utils/format';

export default function RoleWorkspace({ role, projects, requirements }: { role: string; projects: any[]; requirements: any[] }) {
  const [query, setQuery] = useState('');
  const requirementRole = role === 'developer' || role === 'tester';
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = requirementRole ? requirements.filter(item => !item.deletedAt && !item.archivedAt).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) : sortProjectsByRecent(projects.filter(p => !p.archived));
    return items.filter(item => (requirementRole
      ? [item.code, item.title, item.project, item.module, item.owner, item.versionName]
      : [item.code, item.name, item.slug, item.latestVersion?.title, item.latestVersion?.versionNo, item.latestVersion?.no, item.baselineVersionNo]
    ).filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [requirementRole, projects, requirements, query]);

  return <section className="fl-dashboard-panel">
    <div className="fl-section-head">
      <div><h2>{role === 'tester' ? '验收需求' : requirementRole ? '需求速查' : '原型速览'}</h2><p>{requirementRole ? '先查看迭代采用版本，再核对业务规则、验收标准与协作记录' : '按最近更新时间排列，打开最新原型或选择其他版本'}</p></div>
      <Link to={requirementRole ? '/requirements' : '/projects'}>{requirementRole ? '全部需求' : '全部项目'}</Link>
    </div>
    <Input size="large" allowClear prefix={<SearchOutlined />} value={query} onChange={e => setQuery(e.target.value)}
      aria-label={requirementRole ? '搜索需求' : '搜索原型'} placeholder={requirementRole ? '搜索需求编号、标题、项目、模块或负责人' : '搜索项目名称、编号、原型标题或版本号'} />
    <p className="fl-role-result-count" role="status">共 {matching.length} {requirementRole ? '条需求' : '个项目'}</p>
    <List dataSource={matching} pagination={matching.length > 8 ? { pageSize: 8, showSizeChanger: false, hideOnSinglePage: true } : false}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配结果，请尝试其他关键词' : requirementRole ? '暂无需求' : '暂无项目'}>{query ? <Button onClick={() => setQuery('')}>清除搜索</Button> : null}</Empty> }}
      renderItem={(item: any) => {
        const version = item.latestVersion;
        const no = version?.versionNo || version?.no;
        const projectRoute = `/projects/${encodeURIComponent(item.slug || '')}`;
        const versionRoute = `${projectRoute}/versions/${encodeURIComponent(no || '')}`;
        return <List.Item className="fl-role-work-item" key={requirementRole ? item.code : item.slug}>
          <div className="fl-role-work-copy">
            <Space wrap><Tag>{item.code || item.slug}</Tag><Link to={requirementRole ? `/requirements/${encodeURIComponent(item.code)}` : projectRoute}><strong>{requirementRole ? item.title || item.code : item.name || item.slug}</strong></Link></Space>
            <p>{requirementRole ? [item.project, item.module, item.owner && `负责人 ${item.owner}`].filter(Boolean).join(' · ') || '未填写项目与负责人' : no ? `${no} · ${version.title || '未命名原型'}` : '暂无原型版本'}</p>
            <small>{requirementRole ? `${item.versions?.length || 0} 个关联版本` : `当前基线 ${item.baselineVersionNo || '未设置'}`} · 最近更新 {fmtTime(item.updatedAt)}</small>
          </div>
          <Space wrap className="fl-role-work-actions">
            {requirementRole ? <Button type="primary" href={`#/requirements/${encodeURIComponent(item.code)}`}>{role === 'tester' ? '查看验收依据' : '查看开发依据'}</Button> : <>
              {no ? <Button type="primary" href={`#${versionRoute}`}>查看原型</Button> : null}
              <Link to={projectRoute}>全部版本</Link>
            </>}
          </Space>
        </List.Item>;
      }} />
  </section>;
}
